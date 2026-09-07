// Attachment storage for the capture box's photo and voice modes.
//
// Bytes live in Postgres rather than on disk on purpose: Replit's filesystem does not survive a
// redeploy, and a photo of an after-visit summary (contract pack Section 3, "in-visit notes and
// photos") is exactly the kind of thing that must.

import { createHash } from "node:crypto";
import { config } from "../config.mjs";
import { one } from "../db.mjs";
import { badRequest } from "../http.mjs";

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/aac",
]);

export function kindForMime(mime) {
  if (String(mime).startsWith("image/")) return "photo";
  if (String(mime).startsWith("audio/")) return "voice";
  return "text";
}

export async function storeMedia({ userId, mimeType, bytes, originalName = null }) {
  const mime = String(mimeType || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED.has(mime)) {
    throw badRequest(`Unsupported attachment type "${mime || "(none)"}"`, {
      allowed: [...ALLOWED],
    });
  }
  if (!bytes || bytes.length === 0) throw badRequest("Attachment body is empty");
  if (bytes.length > config.maxUploadBytes) {
    throw badRequest(`Attachment is larger than the ${config.maxUploadBytes} byte limit`);
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return one(
    `INSERT INTO media (user_id, mime_type, byte_size, sha256, original_name, bytes)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, mime_type, byte_size, sha256, original_name, created_at`,
    [userId, mime, bytes.length, sha256, originalName ? String(originalName).slice(0, 200) : null, bytes],
  );
}

export async function readMedia(userId, mediaId) {
  return one(
    "SELECT id, mime_type, byte_size, original_name, bytes FROM media WHERE id = $1 AND user_id = $2",
    [mediaId, userId],
  );
}
