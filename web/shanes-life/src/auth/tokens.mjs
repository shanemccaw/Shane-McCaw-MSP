// One place that mints and fingerprints every bearer-style secret in the app: session cookies,
// share-link tokens and MCP tokens. They all follow the same rule -- a high-entropy random
// value is handed out exactly once, and only its SHA-256 is ever written to the database.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 random bytes, base64url. Long enough that a share URL is not guessable. */
export function mintToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function fingerprint(token) {
  return createHash("sha256").update(String(token), "utf8").digest("hex");
}

export function safeEqualHex(a, b) {
  const bufA = Buffer.from(String(a), "hex");
  const bufB = Buffer.from(String(b), "hex");
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
