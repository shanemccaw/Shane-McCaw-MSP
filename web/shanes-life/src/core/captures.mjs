// The universal capture box (contract pack Section 3 -- "one box, not category-specific forms").
//
// Everything enters here: typed text, a voice memo, a photo of a prescription slip, or a push
// from a Claude conversation over MCP. A capture is deliberately dumb -- raw content plus how it
// arrived. It carries no category, because classification is a separate step that happens in a
// Claude conversation (Section 10: the hosted app does no runtime inference of its own).

import { many, one, query } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";

const KINDS = new Set(["text", "voice", "photo"]);
const SOURCES = new Set(["web", "mcp", "share"]);

export async function createCapture({ userId, kind = "text", bodyText = null, mediaId = null, source = "web" }) {
  if (!KINDS.has(kind)) throw badRequest(`kind must be one of: ${[...KINDS].join(", ")}`);
  if (!SOURCES.has(source)) throw badRequest(`source must be one of: ${[...SOURCES].join(", ")}`);

  const text = bodyText === null || bodyText === undefined ? null : String(bodyText).trim();
  if (!text && !mediaId) throw badRequest("A capture needs either text or an attachment");
  if (text && text.length > 20000) throw badRequest("Capture text is too long (20000 char limit)");

  if (mediaId) {
    const media = await one("SELECT id FROM media WHERE id = $1 AND user_id = $2", [mediaId, userId]);
    if (!media) throw notFound("Attachment not found");
  }

  return one(
    `INSERT INTO captures (user_id, kind, body_text, media_id, source)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, kind, body_text, media_id, source, status, entity_id, created_at`,
    [userId, kind, text || null, mediaId, source],
  );
}

export async function listCaptures(userId, { status = "pending", limit = 100 } = {}) {
  const params = [userId];
  let filter = "";
  if (status && status !== "all") {
    params.push(status);
    filter = `AND c.status = $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 100, 500));
  return many(
    `SELECT c.id, c.kind, c.body_text, c.media_id, c.source, c.status, c.entity_id,
            c.classified_at, c.created_at,
            m.mime_type, m.byte_size, m.original_name,
            e.title AS entity_title, e.category AS entity_category
       FROM captures c
       LEFT JOIN media m ON m.id = c.media_id
       LEFT JOIN entities e ON e.id = c.entity_id
      WHERE c.user_id = $1 ${filter}
      ORDER BY c.created_at DESC
      LIMIT $${params.length}`,
    params,
  );
}

export async function getCapture(userId, captureId) {
  return one(
    `SELECT c.*, m.mime_type, m.byte_size, m.original_name
       FROM captures c
       LEFT JOIN media m ON m.id = c.media_id
      WHERE c.id = $1 AND c.user_id = $2`,
    [captureId, userId],
  );
}

export async function dismissCapture(userId, captureId) {
  const row = await one(
    `UPDATE captures SET status = 'dismissed', classified_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'pending'
      RETURNING id, status`,
    [captureId, userId],
  );
  if (!row) throw notFound("Capture not found, or it is not pending");
  return row;
}

export async function pendingCount(userId) {
  const row = await one(
    "SELECT count(*)::int AS n FROM captures WHERE user_id = $1 AND status = 'pending'",
    [userId],
  );
  return row?.n ?? 0;
}

/** Used by the MCP tool that lets Claude read the inbox it is being asked to classify. */
export async function markClassified(userId, captureId, entityId) {
  const { rowCount } = await query(
    `UPDATE captures SET status = 'classified', classified_at = now(), entity_id = $3
      WHERE id = $1 AND user_id = $2`,
    [captureId, userId, entityId],
  );
  if (rowCount === 0) throw notFound("Capture not found");
}
