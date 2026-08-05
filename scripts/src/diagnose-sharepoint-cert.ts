// TEMPORARY DIAGNOSTIC — delete after use, see #394.
//
// Diagnoses "secretOrPrivateKey must be an asymmetric key when using RS256"
// from sharepoint-admin.ts by parsing MT_APP_CERT_PRIVATE_KEY with Node's
// own crypto module. Prints ONLY metadata about the key (parsed?, key type,
// RSA modulus length) — never the key value itself.

import { createPrivateKey } from "node:crypto";

const raw = process.env.MT_APP_CERT_PRIVATE_KEY;

if (!raw) {
  console.log("parsed: false");
  console.log("error: MT_APP_CERT_PRIVATE_KEY is not set in this environment");
  process.exit(1);
}

const privateKey = raw.replace(/\\n/g, "\n");

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
