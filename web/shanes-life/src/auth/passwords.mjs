// Real password hashing with Node's built-in scrypt.
//
// scrypt is a memory-hard KDF and one of OWASP's recommended choices where argon2id is not
// available. It ships inside Node, which matters here: this app carries exactly one runtime
// dependency on purpose (see README), and reaching for a native argon2 binding would add a
// compiled dependency that has to build on both Windows and Replit's Linux container.
//
// Parameters are stored per-row (password_params), so they can be raised later and old rows
// keep verifying against the parameters they were actually written with.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

// N=2^15, r=8, p=1, 64-byte output. maxmem must be raised above Node's 32MB default because
// 128 * N * r is 32MB exactly at these parameters.
export const DEFAULT_PARAMS = { N: 32768, r: 8, p: 1, keylen: 64 };

function encodeParams(p) {
  return `scrypt$N=${p.N},r=${p.r},p=${p.p},keylen=${p.keylen}`;
}

function decodeParams(encoded) {
  const [algo, rest] = String(encoded).split("$");
  if (algo !== "scrypt" || !rest) throw new Error(`unsupported password params: ${encoded}`);
  const out = {};
  for (const pair of rest.split(",")) {
    const [k, v] = pair.split("=");
    out[k] = Number(v);
  }
  if (!out.N || !out.r || !out.p || !out.keylen) throw new Error(`bad password params: ${encoded}`);
  return out;
}

async function derive(password, saltHex, params) {
  return scrypt(Buffer.from(password, "utf8"), Buffer.from(saltHex, "hex"), params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 256 * 1024 * 1024,
  });
}

export async function hashPassword(password, params = DEFAULT_PARAMS) {
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(password, salt, params);
  return {
    password_hash: hash.toString("hex"),
    password_salt: salt,
    password_params: encodeParams(params),
  };
}

export async function verifyPassword(password, row) {
  if (!row?.password_hash || !row?.password_salt || !row?.password_params) return false;
  let params;
  try {
    params = decodeParams(row.password_params);
  } catch {
    return false;
  }
  const expected = Buffer.from(row.password_hash, "hex");
  const actual = await derive(password, row.password_salt, params);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * A real, checked password policy. Deliberately length-first rather than a character-class
 * gauntlet -- long passphrases beat short mangled ones, and this account guards real financial
 * reference data (contract pack Section 3, "bill-payment reference vault").
 */
export function validatePasswordStrength(password) {
  if (typeof password !== "string") return "Password is required.";
  if (password.length < 12) return "Password must be at least 12 characters.";
  if (password.length > 512) return "Password must be at most 512 characters.";
  if (/^\s|\s$/.test(password)) return "Password must not start or end with whitespace.";
  return null;
}
