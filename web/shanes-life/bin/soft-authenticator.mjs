// A real, working WebAuthn authenticator in software — for `npm run check` only.
//
// It generates a real P-256 key pair, assembles real authenticator data with the real flag bits,
// and produces real ECDSA signatures over the real signed-data construction the spec defines.
// The server verifying it (src/auth/webauthn.mjs) has no idea it is not a phone.
//
// This is what makes the passkey flow genuinely testable without a browser and without a
// fingerprint reader on a build machine. It is NOT a fake: nothing is stubbed, no verification is
// skipped, and if the server's CBOR parsing, COSE key import, rpIdHash check, flag check or
// signature check is wrong, the check goes red. What it cannot prove is the browser half — that
// navigator.credentials.create() and .get() are called with the right options — which is stated
// honestly in the check output rather than glossed over.
//
// It is deliberately in bin/ and imported by nothing the server loads.

import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

// -- a minimal CBOR encoder, just enough for an attestationObject and a COSE_Key -------------

function cborHead(major, length) {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
  if (length < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(length, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(length, 1);
  return b;
}

function cborEncode(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([cborHead(2, value.length), value]);
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error("only integers are encodable here");
    return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  }
  if (value instanceof Map) {
    const parts = [cborHead(5, value.size)];
    for (const [k, v] of value) parts.push(cborEncode(k), cborEncode(v));
    return Buffer.concat(parts);
  }
  throw new Error(`cannot encode ${typeof value}`);
}

// -- the authenticator -----------------------------------------------------------------------

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

export class SoftAuthenticator {
  constructor({ rpId, origin }) {
    this.rpId = rpId;
    this.origin = origin;
    this.credentialId = randomBytes(32);
    this.aaguid = Buffer.alloc(16, 0);
    this.signCount = 0;
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }

  get id() {
    return b64url(this.credentialId);
  }

  /** COSE_Key for ES256: kty EC2, alg -7, crv P-256, x, y. */
  coseKey() {
    const jwk = this.publicKey.export({ format: "jwk" });
    return cborEncode(
      new Map([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x, "base64url")],
        [-3, Buffer.from(jwk.y, "base64url")],
      ]),
    );
  }

  clientData(type, challenge) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }), "utf8");
  }

  authenticatorData({ attested }) {
    const rpIdHash = createHash("sha256").update(this.rpId, "utf8").digest();
    let flags = FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS;
    if (attested) flags |= FLAG_AT;
    const head = Buffer.alloc(5);
    head.writeUInt8(flags, 0);
    head.writeUInt32BE(this.signCount, 1);
    if (!attested) return Buffer.concat([rpIdHash, head]);

    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length, 0);
    return Buffer.concat([rpIdHash, head, this.aaguid, idLength, this.credentialId, this.coseKey()]);
  }

  /** The navigator.credentials.create() response, in the shape the app's client sends it. */
  register(challenge) {
    const clientDataJSON = this.clientData("webauthn.create", challenge);
    const authData = this.authenticatorData({ attested: true });
    const attestationObject = cborEncode(
      new Map([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    return {
      id: this.id,
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
    };
  }

  /** The navigator.credentials.get() response, with a real signature. */
  assert(challenge, { tamperSignature = false } = {}) {
    this.signCount += 1;
    const clientDataJSON = this.clientData("webauthn.get", challenge);
    const authData = this.authenticatorData({ attested: false });
    const signedData = Buffer.concat([authData, createHash("sha256").update(clientDataJSON).digest()]);
    const signer = createSign("sha256");
    signer.update(signedData);
    signer.end();
    const signature = signer.sign(this.privateKey);
    if (tamperSignature) signature[signature.length - 1] ^= 0xff;
    return {
      id: this.id,
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: null,
      },
    };
  }
}
