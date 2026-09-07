// Real WebAuthn (passkey) verification, written against the W3C spec with node:crypto and no
// added dependency.
//
// WHY THIS IS PASSKEYS AND NOT A PASSWORD
// ---------------------------------------
// Design/design_handoff_shanes_life/README.md, "Auth and sharing": "Passkeys (WebAuthn) for the
// app", and screen 1 ("Sign in") draws exactly two controls -- "Continue with Face ID" and "Use
// a passkey from another device". There is no email field and no password field on that screen,
// which is a design decision, not an omission: the app guards a bill-payment reference vault,
// and the vault's reveal requires a FRESH assertion even inside a live session. A password
// cannot express "prove it is still you, right now"; an assertion can.
//
// WHY IT IS HAND-WRITTEN
// ----------------------
// CLAUDE.md makes bandwidth a real constraint (Git #1987), and this app carries one runtime
// dependency on purpose. The server half of WebAuthn is a challenge, a signature check and a
// handful of flag bits. Everything below is verification only -- nothing here mints a
// credential, so there is no key material for this file to get wrong.
//
// WHAT IS DELIBERATELY NOT DONE
// -----------------------------
// Attestation statements are not verified, and registration asks for attestation "none". That is
// the correct choice for a single-user app: attestation verification exists to let an enterprise
// restrict WHICH authenticator models may enrol, against a metadata service. Shane is the only
// person who will ever enrol one. Registration is instead gated by a single-use out-of-band
// enrolment token (webauthn_enrollments), which is the real control here.

import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";
import { cborDecode, cborDecodeFirst } from "./cbor.mjs";
import { config } from "../config.mjs";
import { one, query } from "../db.mjs";

export const CHALLENGE_TTL_SECONDS = 5 * 60;

// COSE algorithm identifiers, in the order we ask for them. ES256 first: it is what every Apple
// and Android platform authenticator produces, which is the real path this app is used on.
export const SUPPORTED_ALGORITHMS = [
  { alg: -7, name: "ES256" },
  { alg: -257, name: "RS256" },
  { alg: -8, name: "EdDSA" },
];

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const fromB64url = (str) => Buffer.from(String(str), "base64url");

/** The Relying Party ID is the registrable domain of the public origin -- a bare hostname. */
export function relyingPartyId() {
  return new URL(config.publicOrigin).hostname;
}

export function relyingPartyName() {
  return "Shane's Life";
}

/**
 * Origins a clientDataJSON is allowed to claim. In development the app is reached at both
 * localhost and 127.0.0.1 and WebAuthn treats them as distinct origins, so both are accepted --
 * but only when NODE_ENV is not production, where exactly one origin is legitimate.
 */
export function allowedOrigins() {
  const origins = new Set([config.publicOrigin]);
  if (!config.isProduction) {
    origins.add(`http://localhost:${config.port}`);
    origins.add(`http://127.0.0.1:${config.port}`);
  }
  return origins;
}

// ---------------------------------------------------------------------------
// challenges -- server-issued, single-use, short-lived
// ---------------------------------------------------------------------------

export async function issueChallenge(purpose, userId = null) {
  const challenge = b64url(randomBytes(32));
  await query(
    `INSERT INTO webauthn_challenges (challenge, purpose, user_id, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
    [challenge, purpose, userId, String(CHALLENGE_TTL_SECONDS)],
  );
  return challenge;
}

/**
 * Consume a challenge, atomically. The UPDATE ... WHERE consumed_at IS NULL RETURNING is the
 * whole point: two simultaneous replays of the same assertion cannot both win it.
 */
export async function consumeChallenge(challenge, purpose) {
  if (!challenge) return null;
  const row = await one(
    `UPDATE webauthn_challenges
        SET consumed_at = now()
      WHERE challenge = $1
        AND purpose = $2
        AND consumed_at IS NULL
        AND expires_at > now()
      RETURNING challenge, user_id`,
    [String(challenge), purpose],
  );
  return row;
}

/** Housekeeping: challenges are worthless the moment they expire. */
export async function purgeDeadChallenges() {
  const { rowCount } = await query(
    "DELETE FROM webauthn_challenges WHERE expires_at < now() - interval '1 hour'",
  );
  return rowCount;
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

export function parseClientData(clientDataJSONb64) {
  const raw = fromB64url(clientDataJSONb64);
  let parsed;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error("clientDataJSON is not valid JSON");
  }
  return { raw, data: parsed };
}

/**
 * Authenticator data, per the WebAuthn "Authenticator Data" layout:
 *   rpIdHash (32) | flags (1) | signCount (4) | [attestedCredentialData] | [extensions]
 */
export function parseAuthenticatorData(buf) {
  if (buf.length < 37) throw new Error("authenticator data is too short");
  const rpIdHash = buf.subarray(0, 32);
  const flags = buf.readUInt8(32);
  const signCount = buf.readUInt32BE(33);

  const result = {
    rpIdHash,
    flags,
    signCount,
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    backupEligible: (flags & 0x08) !== 0,
    backedUp: (flags & 0x10) !== 0,
    attestedCredentialData: (flags & 0x40) !== 0,
    extensionData: (flags & 0x80) !== 0,
    credentialId: null,
    aaguid: null,
    coseKey: null,
  };

  let offset = 37;
  if (result.attestedCredentialData) {
    if (buf.length < offset + 18) throw new Error("attested credential data is truncated");
    result.aaguid = buf.subarray(offset, offset + 16).toString("hex");
    offset += 16;
    const idLength = buf.readUInt16BE(offset);
    offset += 2;
    if (buf.length < offset + idLength) throw new Error("credential id is truncated");
    result.credentialId = buf.subarray(offset, offset + idLength);
    offset += idLength;
    // The COSE key's own length is only knowable by decoding it -- extensions may follow.
    const { value, bytesRead } = cborDecodeFirst(buf.subarray(offset));
    result.coseKey = value;
    result.coseKeyBytes = buf.subarray(offset, offset + bytesRead);
    offset += bytesRead;
  }

  return result;
}

/**
 * Turn a COSE_Key into a Node public key. Node imports JWK directly, which is the shortest
 * correct path from COSE -- both are just the same curve point / modulus in different clothes.
 */
export function coseToPublicKey(coseKey) {
  if (!(coseKey instanceof Map)) throw new Error("COSE key is not a map");
  const kty = coseKey.get(1);
  const alg = coseKey.get(3);

  if (kty === 2) {
    // EC2. crv 1 = P-256, 2 = P-384, 3 = P-521.
    const crvId = coseKey.get(-1);
    const crv = { 1: "P-256", 2: "P-384", 3: "P-521" }[crvId];
    if (!crv) throw new Error(`unsupported EC curve ${crvId}`);
    const x = coseKey.get(-2);
    const y = coseKey.get(-3);
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y)) throw new Error("EC key is missing x/y");
    return {
      alg,
      key: createPublicKey({
        key: { kty: "EC", crv, x: b64url(x), y: b64url(y) },
        format: "jwk",
      }),
    };
  }

  if (kty === 3) {
    // RSA
    const n = coseKey.get(-1);
    const e = coseKey.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) throw new Error("RSA key is missing n/e");
    return {
      alg,
      key: createPublicKey({
        key: { kty: "RSA", n: b64url(n), e: b64url(e) },
        format: "jwk",
      }),
    };
  }

  if (kty === 1) {
    // OKP (Ed25519)
    const crvId = coseKey.get(-1);
    if (crvId !== 6) throw new Error(`unsupported OKP curve ${crvId}`);
    const x = coseKey.get(-2);
    if (!Buffer.isBuffer(x)) throw new Error("OKP key is missing x");
    return {
      alg,
      key: createPublicKey({
        key: { kty: "OKP", crv: "Ed25519", x: b64url(x) },
        format: "jwk",
      }),
    };
  }

  throw new Error(`unsupported COSE key type ${kty}`);
}

function verifySignature(alg, publicKey, data, signature) {
  // ES256/384/512 signatures arrive DER-encoded, which is Node's default dsaEncoding.
  if (alg === -7) return cryptoVerify("sha256", data, publicKey, signature);
  if (alg === -35) return cryptoVerify("sha384", data, publicKey, signature);
  if (alg === -36) return cryptoVerify("sha512", data, publicKey, signature);
  if (alg === -257) return cryptoVerify("sha256", data, publicKey, signature);
  if (alg === -258) return cryptoVerify("sha384", data, publicKey, signature);
  if (alg === -259) return cryptoVerify("sha512", data, publicKey, signature);
  // EdDSA hashes internally; Node wants a null algorithm for it.
  if (alg === -8) return cryptoVerify(null, data, publicKey, signature);
  throw new Error(`unsupported signature algorithm ${alg}`);
}

function assertClientData({ data, expectedType, expectedChallenge }) {
  if (data.type !== expectedType) {
    throw new Error(`clientData type is "${data.type}", expected "${expectedType}"`);
  }
  if (data.challenge !== expectedChallenge) {
    throw new Error("clientData challenge does not match the one this server issued");
  }
  if (!allowedOrigins().has(data.origin)) {
    throw new Error(`clientData origin "${data.origin}" is not an origin this app accepts`);
  }
  if (data.crossOrigin === true) {
    throw new Error("cross-origin credential use is refused");
  }
}

function assertRpIdHash(rpIdHash) {
  const expected = createHash("sha256").update(relyingPartyId(), "utf8").digest();
  if (!rpIdHash.equals(expected)) {
    throw new Error("authenticator data was signed for a different relying party");
  }
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

/**
 * Verify a navigator.credentials.create() response.
 * Throws with a real reason on any failure; returns the credential to store on success.
 */
export function verifyRegistration({ expectedChallenge, response }) {
  const { data } = parseClientData(response.clientDataJSON);
  assertClientData({ data, expectedType: "webauthn.create", expectedChallenge });

  const attestation = cborDecode(fromB64url(response.attestationObject));
  const authDataBytes = attestation.get("authData");
  if (!Buffer.isBuffer(authDataBytes)) throw new Error("attestationObject has no authData");

  const authData = parseAuthenticatorData(authDataBytes);
  assertRpIdHash(authData.rpIdHash);
  if (!authData.userPresent) throw new Error("the authenticator did not report user presence");
  if (!authData.userVerified) {
    // userVerification is "required" in the options this server issues -- a passkey that did not
    // actually check a face, a fingerprint or a PIN is not the thing the design asked for.
    throw new Error("the authenticator did not verify the user");
  }
  if (!authData.attestedCredentialData || !authData.credentialId || !authData.coseKey) {
    throw new Error("the attestation carried no credential");
  }

  // Parse the key now rather than at first sign-in: a key this server cannot verify with must
  // fail at registration, when there is a person there to try another authenticator.
  const { alg } = coseToPublicKey(authData.coseKey);
  if (!SUPPORTED_ALGORITHMS.some((a) => a.alg === alg)) {
    throw new Error(`the authenticator used an algorithm this server does not accept (${alg})`);
  }

  return {
    credentialId: b64url(authData.credentialId),
    publicKey: authData.coseKeyBytes,
    signCount: authData.signCount,
    aaguid: authData.aaguid,
    backedUp: authData.backedUp,
    transports: Array.isArray(response.transports) ? response.transports.filter((t) => typeof t === "string") : [],
    fmt: attestation.get("fmt") ?? "none",
  };
}

// ---------------------------------------------------------------------------
// authentication
// ---------------------------------------------------------------------------

/**
 * Verify a navigator.credentials.get() response against a stored credential.
 * Returns { signCount, backedUp, userVerified }; throws with a real reason otherwise.
 */
export function verifyAssertion({ expectedChallenge, response, credential }) {
  const { raw: clientDataRaw, data } = parseClientData(response.clientDataJSON);
  assertClientData({ data, expectedType: "webauthn.get", expectedChallenge });

  const authDataBytes = fromB64url(response.authenticatorData);
  const authData = parseAuthenticatorData(authDataBytes);
  assertRpIdHash(authData.rpIdHash);
  if (!authData.userPresent) throw new Error("the authenticator did not report user presence");
  if (!authData.userVerified) throw new Error("the authenticator did not verify the user");

  const { alg, key } = coseToPublicKey(cborDecode(credential.public_key));
  const signedData = Buffer.concat([
    authDataBytes,
    createHash("sha256").update(clientDataRaw).digest(),
  ]);
  const signature = fromB64url(response.signature);
  if (!verifySignature(alg, key, signedData, signature)) {
    throw new Error("the assertion signature did not verify");
  }

  // Signature-counter cloning check. Many real passkeys (every synced one, which is what Face ID
  // produces) legitimately report 0 forever; a counter is only meaningful once it has moved.
  const stored = Number(credential.sign_count || 0);
  if (authData.signCount > 0 && stored > 0 && authData.signCount <= stored) {
    throw new Error("the authenticator's signature counter went backwards");
  }

  return {
    signCount: authData.signCount,
    backedUp: authData.backedUp,
    userVerified: authData.userVerified,
  };
}
