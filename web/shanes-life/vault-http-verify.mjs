// Scratch end-to-end harness for Git #3150 -- deleted before the session ends.
//
// Drives the real /api/vault* routes over real HTTP against a real running server, with a
// software authenticator standing in for Face ID (a real P-256 keypair producing real ES256
// assertions the server verifies with its own unmodified code path).
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { closePool, one, query } from "./src/db.mjs";
import { createSession } from "./src/auth/sessions.mjs";

const BASE = `http://localhost:${process.env.PORT}`;
const USER = "66ddf602-8103-4c15-bfc6-8914eeeb4e7a";
const SECRET = "Acct 0041 2339 1482 1";
const b64u = (b) => Buffer.from(b).toString("base64url");
let failed = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${extra ? ` -- ${extra}` : ""}`);
  if (!ok) failed++;
};

// --- a real software authenticator -----------------------------------------
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const raw = publicKey.export({ type: "spki", format: "der" }); // last 65 bytes are 04||x||y
const point = raw.subarray(raw.length - 65);
const x = point.subarray(1, 33);
const y = point.subarray(33, 65);
// COSE_Key, hand-encoded: {1:2, 3:-7, -1:1, -2:x, -3:y}
const cose = Buffer.concat([
  Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
  x,
  Buffer.from([0x22, 0x58, 0x20]),
  y,
]);
const credentialId = b64u(randomBytes(32));

function assertFor(challenge, { origin = BASE, rpId = "localhost" } = {}) {
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }),
  );
  const authData = Buffer.concat([
    createHash("sha256").update(rpId, "utf8").digest(),
    Buffer.from([0x05]), // UP | UV -- the server refuses anything without userVerified
    Buffer.from([0, 0, 0, 0]), // signCount 0, what every synced passkey really reports
  ]);
  const signed = Buffer.concat([authData, createHash("sha256").update(clientDataJSON).digest()]);
  const signature = createSign("sha256").update(signed).sign(privateKey);
  return {
    challenge,
    id: credentialId,
    response: {
      clientDataJSON: b64u(clientDataJSON),
      authenticatorData: b64u(authData),
      signature: b64u(signature),
    },
  };
}

// --- a real session + a real enrolled credential ---------------------------
const { token } = await createSession(USER, { userAgent: "vault-http-verify", ip: "127.0.0.1" });
await query(
  `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, sign_count, transports, label)
   VALUES ($1, $2, $3, 0, '{}', '3150 verify')`,
  [USER, credentialId, cose],
);

const jar = `sl_session=${token}`;
async function call(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", cookie: jar, origin: BASE, ...(init.headers || {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const cleanup = [];
try {
  // 1. the room loads, and says the key is really configured
  const listed = await call("/api/vault");
  check(listed.status === 200, "GET /api/vault", `status ${listed.status}`);
  check(listed.body.keyConfigured === true, "keyConfigured is really true");
  check(listed.body.windowSeconds === 20, "window is the design's real 20 seconds", `${listed.body.windowSeconds}s`);
  check(listed.body.clipboardClearSeconds === 60, "clipboard clears at the design's real 60 seconds");

  // 2. two real entries
  const a = await call("/api/vault", {
    method: "POST",
    body: JSON.stringify({ label: "3150 http · mortgage", site: "mrcooper.com", secret: SECRET }),
  });
  const b = await call("/api/vault", {
    method: "POST",
    body: JSON.stringify({ label: "3150 http · second", site: "chryslercapital.com", secret: "Card 4400" }),
  });
  cleanup.push(a.body.id, b.body.id);
  check(a.status === 201, "POST /api/vault created a row", `status ${a.status}`);
  check(!JSON.stringify(a.body).includes(SECRET), "the create response does NOT echo the secret");

  // 3. the list is masked, over the wire
  const masked = await call("/api/vault");
  check(!JSON.stringify(masked.body).includes("0041"), "GET /api/vault carries no plaintext at all");
  check(masked.body.entries.some((e) => e.masked === "•••• 4821"), "the masked hint is what it renders");

  // 4. THE point of the issue: a live, valid session is NOT enough to reveal.
  const noAssertion = await call(`/api/vault/${a.body.id}/reveal`, { method: "POST", body: "{}" });
  check(noAssertion.status === 401, "reveal with a live session but NO assertion is refused", `status ${noAssertion.status}`);

  // ...and neither is the generic session re-verify stamp: prove it by re-verifying the session
  // through /api/auth/reverify (which really does move sessions.last_verified_at to now) and
  // then trying the reveal again with nothing else.
  const reOpts = await call("/api/auth/reverify/options", { method: "POST", body: "{}" });
  const reDone = await call("/api/auth/reverify", { method: "POST", body: JSON.stringify(assertFor(reOpts.body.challenge)) });
  check(reDone.status === 200, "the session really did just pass a fresh assertion", `status ${reDone.status}`);
  const stamped = await one("SELECT last_verified_at FROM sessions WHERE token_hash = encode(digest($1,'sha256'),'hex')", [token]).catch(() => null);
  const afterReverify = await call(`/api/vault/${a.body.id}/reveal`, { method: "POST", body: "{}" });
  check(
    afterReverify.status === 401,
    "a SECOND-AGO session re-verify still does not reveal (not just session presence)",
    `status ${afterReverify.status}${stamped ? `, last_verified_at ${stamped.last_verified_at?.toISOString?.() ?? stamped.last_verified_at}` : ""}`,
  );

  // 5. a real per-entry assertion does reveal
  const opts = await call(`/api/vault/${a.body.id}/reveal/options`, { method: "POST", body: "{}" });
  check(opts.status === 200 && Boolean(opts.body.challenge), "reveal/options issued a challenge");
  check(opts.body.userVerification === "required", "the challenge demands user verification");
  const ok = await call(`/api/vault/${a.body.id}/reveal`, { method: "POST", body: JSON.stringify(assertFor(opts.body.challenge)) });
  check(ok.status === 200, "reveal WITH a real assertion succeeds", `status ${ok.status} ${JSON.stringify(ok.body).slice(0, 120)}`);
  check(ok.body.value === SECRET, "the revealed value is the real one", ok.body.value);
  check(
    new Date(ok.body.expiresAt) - new Date(ok.body.revealedAt) === 20000,
    "the server's own deadline is exactly 20 seconds",
  );

  // 6. that challenge is single-use -- a replay cannot reveal twice
  const replay = await call(`/api/vault/${a.body.id}/reveal`, { method: "POST", body: JSON.stringify(assertFor(opts.body.challenge)) });
  check(replay.status === 401, "replaying the same assertion is refused", `status ${replay.status}`);

  // 7. a challenge issued for entry A cannot reveal entry B
  const optsA = await call(`/api/vault/${a.body.id}/reveal/options`, { method: "POST", body: "{}" });
  const crossed = await call(`/api/vault/${b.body.id}/reveal`, { method: "POST", body: JSON.stringify(assertFor(optsA.body.challenge)) });
  check(crossed.status === 401, "an assertion for one entry cannot reveal another", `status ${crossed.status}`);

  // 8. a real audit row per successful reveal, and none for the refused ones
  const audit = await call(`/api/vault/${a.body.id}/reveals`);
  check(audit.body.reveals.length === 1, "exactly one vault_reveals row for one real reveal", `${audit.body.reveals.length}`);
  check(audit.body.reveals[0]?.credential_id === credentialId, "the audit row names the passkey that authorised it");
  check(audit.body.reveals[0]?.credential_label === "3150 verify", "and resolves it to a real credential label");

  // 9. signed out, nothing is reachable
  const anon = await fetch(`${BASE}/api/vault`, { headers: { origin: BASE } });
  check(anon.status === 401, "GET /api/vault without a session is 401", `status ${anon.status}`);
} finally {
  for (const id of cleanup) if (id) await call(`/api/vault/${id}`, { method: "DELETE" });
  await query("DELETE FROM webauthn_credentials WHERE credential_id = $1", [credentialId]);
  await query("UPDATE sessions SET revoked_at = now() WHERE user_agent = 'vault-http-verify'");
  const left = await one("SELECT count(*)::int n FROM vault WHERE user_id = $1", [USER]);
  console.log("  cleanup: vault rows left for this user:", left.n);
  if (left.n !== 0) failed++;
  await closePool();
}
console.log(failed ? `\nRESULT: ${failed} FAILURE(S)` : "\nRESULT: all end-to-end vault checks passed");
process.exit(failed ? 1 : 0);
