// TEMPORARY DIAGNOSTIC — delete after use, see #394.
//
// Diagnoses "secretOrPrivateKey must be an asymmetric key when using RS256"
// from sharepoint-admin.ts by parsing MT_APP_CERT_PRIVATE_KEY with Node's
// own crypto module. Prints ONLY metadata about the key (parsed?, key type,
// RSA modulus length) — never the key value itself.
//
// Follow-up (still #394): parsed:false persisted even after the existing
// .replace(/\\n/g, "\n") transform, which points at a structural PEM
// formatting problem rather than a wrong-key-type one. Added below: a
// structure-only report on the string AFTER that transform — length,
// whether a literal "\n" (backslash-n) sequence still remains, real
// newline count, leading/trailing whitespace, presence of \r, and a
// SHA-256 hex digest (one-way, safe to print, never reconstructs the key).

import { createHash, createPrivateKey } from "node:crypto";

const raw = process.env.MT_APP_CERT_PRIVATE_KEY;

if (!raw) {
  console.log("parsed: false");
  console.log("error: MT_APP_CERT_PRIVATE_KEY is not set in this environment");
  process.exit(1);
}

// Git #4156 — canonical form is single-line base64 of the PEM; a legacy raw PEM
// (real newlines or literal \n) is still accepted. Mirrors decodeMtAppCertPrivateKey()
// in artifacts/api-server/src/lib/mt-app-cert-key.ts (scripts/ can't import api-server).
const privateKey = raw.includes("-----BEGIN")
  ? raw.trim().replace(/\\n/g, "\n")
  : Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf8");

try {
  const keyObject = createPrivateKey({ key: privateKey, format: "pem" });
  console.log("parsed: true");
  console.log(`asymmetricKeyType: ${keyObject.asymmetricKeyType}`);
  if (keyObject.asymmetricKeyType === "rsa") {
    console.log(`modulusLength: ${keyObject.asymmetricKeyDetails?.modulusLength}`);
  }
} catch (err) {
  console.log("parsed: false");
  console.log(`error: ${err instanceof Error ? err.message : String(err)}`);
}

console.log("--- structure (post-transform, no key content) ---");
console.log(`length: ${privateKey.length}`);
console.log(`stillContainsLiteralBackslashN: ${privateKey.includes("\\n")}`);
console.log(`realNewlineCount: ${(privateKey.match(/\n/g) ?? []).length}`);
console.log(`startsWithWhitespace: ${/^\s/.test(privateKey)}`);
console.log(`endsWithWhitespace: ${/\s$/.test(privateKey)}`);
console.log(`containsCarriageReturn: ${privateKey.includes("\r")}`);
console.log(`sha256: ${createHash("sha256").update(privateKey).digest("hex")}`);
