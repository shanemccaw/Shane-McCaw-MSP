// Real Web Push (RFC 8291 payload encryption + RFC 8292 VAPID), hand-rolled on Node's built-in
// `crypto` -- this app deliberately carries one runtime dependency (`pg`, see config.mjs) and
// webauthn/cbor were hand-implemented rather than reaching for a library for exactly the same
// reason. There is nothing exotic below; it is the same well-documented algorithm the `web-push`
// npm package implements, just without adding it.
//
// Nothing calls this until push-subscriptions.mjs / nudges.mjs wire a real send path to it --
// see those files for the "when does a push actually go out" answer.

import { createECDH, createHmac, createSign, createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

// -- VAPID application-server identity ---------------------------------------------------------
//
// One real P-256 key pair for the whole app, read from env (SL_VAPID_PUBLIC_KEY /
// SL_VAPID_PRIVATE_KEY, both base64url -- see .env.example for how to generate them). Loaded
// lazily so a deployment with no push subscriptions yet doesn't fail to boot over a missing key.
let vapidKeys = null;
function getVapidKeys() {
  if (vapidKeys) return vapidKeys;
  const publicKey = process.env.SL_VAPID_PUBLIC_KEY;
  const privateKey = process.env.SL_VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  vapidKeys = { publicKey, privateKey };
  return vapidKeys;
}

export function vapidPublicKey() {
  return getVapidKeys()?.publicKey ?? null;
}

/** Real, fresh ES256-signable VAPID JWT for one push request, per RFC 8292. */
function buildVapidHeaders(endpoint) {
  const keys = getVapidKeys();
  if (!keys) throw new Error("SL_VAPID_PUBLIC_KEY / SL_VAPID_PRIVATE_KEY not set -- see .env.example");

  const audience = new URL(endpoint).origin;
  const header = base64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = base64url(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: `mailto:${process.env.SL_VAPID_SUBJECT_EMAIL || "shane@shanemccawconsulting.com"}`,
      }),
    ),
  );
  const unsigned = `${header}.${payload}`;

  // The private key is a raw 32-byte P-256 scalar (base64url). Wrap it as a PKCS#8 DER key so
  // Node's crypto module will sign with it -- avoids pulling in a PEM/JWK library for one shape.
  const d = fromBase64url(keys.privateKey);
  const pkcs8 = buildEcPkcs8(d);
  const der = createSign("SHA256").update(unsigned).sign({ key: pkcs8, format: "der", type: "pkcs8", dsaEncoding: "ieee-p1363" });
  const signature = base64url(der);

  return {
    authorization: `vapid t=${unsigned}.${signature}, k=${keys.publicKey}`,
  };
}

// Minimal PKCS#8 DER wrapper for a raw P-256 (prime256v1, OID 1.2.840.10045.3.1.7) private
// scalar, so Node's crypto can load it without a PEM file on disk. Fixed-shape DER; only the
// 32-byte scalar varies.
function buildEcPkcs8(dBytes) {
  const oidEcPublicKey = Buffer.from([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
  const oidP256 = Buffer.from([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
  const algId = der(0x30, Buffer.concat([oidEcPublicKey, oidP256]));
  const privKeyOctet = der(0x04, dBytes); // ECPrivateKey.privateKey (no public key attached)
  const ecPrivateKey = der(0x30, Buffer.concat([der(0x02, Buffer.from([0x01])), privKeyOctet]));
  const privateKeyOctetString = der(0x04, ecPrivateKey);
  const version = der(0x02, Buffer.from([0x00]));
  const pkcs8 = der(0x30, Buffer.concat([version, algId, privateKeyOctetString]));
  return pkcs8;
}

function derLength(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag, contentBuf) {
  return Buffer.concat([Buffer.from([tag]), derLength(contentBuf.length), contentBuf]);
}

// -- RFC 8291 payload encryption (aes128gcm content-encoding) ------------------------------------

const HKDF_INFO_AUTH = Buffer.from("WebPush: info\0", "utf8");

function hkdf(salt, ikm, info, length) {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  let output = Buffer.alloc(0);
  let t = Buffer.alloc(0);
  let counter = 1;
  while (output.length < length) {
    t = createHmac("sha256", prk).update(Buffer.concat([t, info, Buffer.from([counter])])).digest();
    output = Buffer.concat([output, t]);
    counter += 1;
  }
  return output.subarray(0, length);
}

/**
 * Encrypts `payload` (a JSON-serializable object) for one subscription per RFC 8291. Returns the
 * real aes128gcm body ready to POST, plus the headers a push service expects alongside it.
 */
function encryptPayload(payload, subscription) {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const clientPublic = fromBase64url(subscription.p256dh);
  const authSecret = fromBase64url(subscription.auth);

  const salt = randomBytes(16);
  const localEcdh = createECDH("prime256v1");
  localEcdh.generateKeys();
  const localPublic = localEcdh.getPublicKey();
  const sharedSecret = localEcdh.computeSecret(clientPublic);

  // Real RFC 8291 key combine step: ikm derived from the ECDH shared secret plus both public
  // keys, keyed by the subscription's own auth secret.
  const keyInfo = Buffer.concat([
    HKDF_INFO_AUTH,
    clientPublic,
    localPublic,
  ]);
  const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32);

  const cekInfo = Buffer.from("Content-Encoding: aes128gcm\0", "utf8");
  const nonceInfo = Buffer.from("Content-Encoding: nonce\0", "utf8");
  const cek = hkdf(salt, ikm, cekInfo, 16);
  const nonce = hkdf(salt, ikm, nonceInfo, 12);

  // aes128gcm record: plaintext + delimiter byte (0x02, "last record") padded to nothing extra.
  const padded = Buffer.concat([plaintext, Buffer.from([0x02])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([encrypted, authTag]);

  // aes128gcm header: salt(16) | record size(4, BE) | idlen(1) | keyid(idlen)
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(ciphertext.length + 86, 0); // generous; only needs to be >= body
  const header = Buffer.concat([salt, recordSize, Buffer.from([localPublic.length]), localPublic]);

  return Buffer.concat([header, ciphertext]);
}

/**
 * Sends one real push message to one real subscription. Returns `{ ok, status, gone }` --
 * `gone: true` means the push service reported the endpoint dead (404/410), which is the real,
 * expected way a subscription goes stale (uninstalled, permission revoked) and the caller should
 * delete the row rather than keep retrying it forever.
 */
export async function sendWebPush(subscription, payload, { ttl = 60 * 60 * 12 } = {}) {
  const body = encryptPayload(payload, subscription);
  const { authorization } = buildVapidHeaders(subscription.endpoint);

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: String(ttl),
      Authorization: authorization,
    },
    body,
  });

  if (res.status === 404 || res.status === 410) {
    return { ok: false, status: res.status, gone: true };
  }
  return { ok: res.ok, status: res.status, gone: false };
}

/** Generates a real fresh VAPID key pair. Used by bin/generate-vapid-keys.mjs, not at runtime. */
export function generateVapidKeyPair() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: base64url(ecdh.getPublicKey()),
    privateKey: base64url(ecdh.getPrivateKey()),
  };
}

// -- Decrypt, receiver-side. Real production code never calls this (a push service's receiving
// browser does that decryption, not this server) -- it exists so bin/selftest-webpush.mjs can
// round-trip encrypt->decrypt against a simulated subscriber and prove the RFC 8291 derivation
// above is internally consistent, since this session has no real device to verify against.
function decryptPayloadForTest(encoded, receiverEcdh, authSecret) {
  const salt = encoded.subarray(0, 16);
  const idlen = encoded.readUInt8(20);
  const localPublic = encoded.subarray(21, 21 + idlen);
  const ciphertext = encoded.subarray(21 + idlen);

  const sharedSecret = receiverEcdh.computeSecret(localPublic);
  const clientPublic = receiverEcdh.getPublicKey();
  const keyInfo = Buffer.concat([HKDF_INFO_AUTH, clientPublic, localPublic]);
  const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32);

  const cekInfo = Buffer.from("Content-Encoding: aes128gcm\0", "utf8");
  const nonceInfo = Buffer.from("Content-Encoding: nonce\0", "utf8");
  const cek = hkdf(salt, ikm, cekInfo, 16);
  const nonce = hkdf(salt, ikm, nonceInfo, 12);

  const body = ciphertext.subarray(0, ciphertext.length - 16);
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(authTag);
  const padded = Buffer.concat([decipher.update(body), decipher.final()]);
  // Strip the trailing 0x02 "last record" delimiter byte.
  return padded.subarray(0, padded.length - 1).toString("utf8");
}

export const __test = {
  base64url,
  fromBase64url,
  buildEcPkcs8,
  encryptPayload,
  decryptPayloadForTest,
  buildVapidHeaders,
  randomUUID,
};
