/**
 * secret-crypto.ts
 *
 * AES-256-GCM encryption for break-glass secrets at rest.
 *
 * Deliberately its own module (not shared with mfa.ts) and its own key:
 * TOTP seeds and break-glass admin passwords are different secret classes with
 * different rotation needs and must never share a key. The AES-256-GCM scheme
 * mirrors the TOTP helper's on-disk format ("ivHex:encHex:tagHex") for
 * consistency, but the key derivation is independent.
 *
 * Key = BREAK_GLASS_ENCRYPTION_KEY (32-byte hex) when set; otherwise a SHA-256 of
 * JWT_SECRET as a dev-only fallback (matches the mfa.ts fallback pattern so local
 * dev needs zero new secrets). Production must set BREAK_GLASS_ENCRYPTION_KEY.
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";

function getBreakGlassEncryptionKey(): Buffer {
  const raw = process.env.BREAK_GLASS_ENCRYPTION_KEY;
  if (raw) return Buffer.from(raw, "hex").subarray(0, 32);
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error("BREAK_GLASS_ENCRYPTION_KEY (or JWT_SECRET fallback) not configured");
  return createHash("sha256").update(jwtSecret).digest();
}

/** Encrypt a plaintext secret. Returns "ivHex:encHex:tagHex". */
export function encryptSecret(plaintext: string): string {
  const key = getBreakGlassEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${enc.toString("hex")}:${tag.toString("hex")}`;
}

/** Decrypt a value produced by {@link encryptSecret}. Throws on tamper/format error. */
export function decryptSecret(ciphertext: string): string {
  const [ivHex, encHex, tagHex] = ciphertext.split(":");
  if (!ivHex || !encHex || !tagHex) throw new Error("secret-crypto: malformed ciphertext");
  const key = getBreakGlassEncryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
}
