#!/usr/bin/env node
/**
 * Git #2840 — the sanctioned destructive-write test user in the testbed tenant.
 *
 * The testbed tenant (c4c814d4-3afe-441e-9145-62461d0a4fd3 / mccawsoft2.onmicrosoft.com)
 * is simultaneously Shane's REAL production Microsoft 365 tenant. Per CLAUDE.md's
 * "Production-change gate (Git #1913)", the boundary that actually holds is the app
 * registration, not the tenant — so this script:
 *
 *   • refuses to run against the PROD write app registration
 *     (3308b280-e41e-42ba-9f73-73aac2ad3dee), by appId, unconditionally;
 *   • refuses to run against any tenant other than the testbed tenant;
 *   • refuses to touch any user whose UPN does not match the reserved
 *     `zz-test-*@` naming convention this issue established.
 *
 * Modes:
 *   (default)             read-only state report: org identity, verified domains, and the
 *                         test user's real roles / group memberships / licenses / methods.
 *   --create              create the test user (a real tenant mutation). No-op if present.
 *   --revoke-sessions     destructive smoke test: POST /users/{id}/revokeSignInSessions.
 *   --seed-phone-method   register a fictitious-range phone auth method on the test user,
 *                         so --purge-auth-methods has something real to actually DELETE.
 *   --purge-auth-methods  #1899's real fan-out, with #2981's verification: GET
 *                         authentication/methods, DELETE each phone / Microsoft
 *                         Authenticator / software OATH method, then RE-enumerate until
 *                         two consecutive delayed reads corroborate that nothing removable
 *                         is left. Mirrors what production now runs.
 *   --purge-auth-methods-single-pass
 *                         #2981's repro: the ORIGINAL single-pass version (one GET, then
 *                         deletes, then unconditional success). Against a stale replica it
 *                         reports "0 deletable" and deletes nothing without erroring.
 *
 * Every mutating mode requires --i-mean-it as a second, explicit flag.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", "..", ".env.local");

// ── The real, reserved identity this issue provisions ────────────────────────
export const TESTBED_TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
export const TESTBED_INITIAL_DOMAIN = "mccawsoft2.onmicrosoft.com";
/** Reserved prefix. Nothing outside it is touchable by this script. */
export const TEST_USER_PREFIX = "zz-test-";
export const TEST_USER_UPN = `zz-test-graphwrite-01@${TESTBED_INITIAL_DOMAIN}`;
export const TEST_USER_DISPLAY_NAME =
  "ZZ TEST ACCOUNT - destructive Graph write target (Git #2840) - DO NOT USE";
export const TEST_USER_MAIL_NICKNAME = "zz-test-graphwrite-01";
export const TEST_USER_JOB_TITLE = "Synthetic test account - not a person";

const DEV_WRITE_APP_ID = "9f6f4772-b5be-421f-815e-b392336c373a";
const PROD_WRITE_APP_ID = "3308b280-e41e-42ba-9f73-73aac2ad3dee";
const GRAPH = "https://graph.microsoft.com/v1.0";

function loadEnvLocal() {
  const out = {};
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function token(env) {
  const tenant = env.GRAPH_TENANT_ID || env.AZURE_TENANT_ID;
  const clientId = env.MT_APP_WRITE_CLIENT_ID;
  const secret = env.MT_APP_WRITE_CLIENT_SECRET;

  // ── Git #1913 gate, enforced in code rather than in prose ─────────────────
  if (clientId === PROD_WRITE_APP_ID) {
    throw new Error(
      `REFUSING: MT_APP_WRITE_CLIENT_ID is the PRODUCTION write app registration ` +
        `(${PROD_WRITE_APP_ID}). Agents never apply changes through it (CLAUDE.md, Git #1913).`,
    );
  }
  if (clientId !== DEV_WRITE_APP_ID) {
    throw new Error(
      `REFUSING: expected the DEV write app registration (${DEV_WRITE_APP_ID}), got ${clientId}.`,
    );
  }
  if (tenant !== TESTBED_TENANT_ID) {
    throw new Error(`REFUSING: expected the testbed tenant ${TESTBED_TENANT_ID}, got ${tenant}.`);
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: secret,
      scope: "https://graph.microsoft.com/.default",
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token failed ${res.status}: ${text}`);
  return JSON.parse(text).access_token;
}

async function graph(tok, method, path, body) {
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${tok}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body (204s etc.) */
  }
  return { ok: res.ok, status: res.status, json, text };
}

/** Nothing in this script may act on a UPN outside the reserved prefix. */
function assertReservedUpn(upn) {
  if (!upn || !upn.toLowerCase().startsWith(TEST_USER_PREFIX)) {
    throw new Error(`REFUSING: '${upn}' is not a reserved '${TEST_USER_PREFIX}*' test identity.`);
  }
  if (!upn.toLowerCase().endsWith(`@${TESTBED_INITIAL_DOMAIN}`)) {
    throw new Error(`REFUSING: '${upn}' is not on ${TESTBED_INITIAL_DOMAIN}.`);
  }
}

function generatePassword() {
  return `Zz9!${randomBytes(24).toString("base64url")}`;
}

/** Persist the generated password to the untracked .env.local, never to git. */
function persistPassword(pw) {
  const key = "TESTBED_TEST_USER_PASSWORD";
  let raw = readFileSync(ENV_PATH, "utf8");
  const line = `${key}=${pw}`;
  if (new RegExp(`^${key}=`, "m").test(raw)) {
    raw = raw.replace(new RegExp(`^${key}=.*$`, "m"), line);
  } else {
    raw =
      raw.replace(/\s*$/, "\n") +
      `\n# Git #2840 - password for ${TEST_USER_UPN} (synthetic test account, no license, no roles)\n${line}\n`;
  }
  writeFileSync(ENV_PATH, raw);
}

async function report(tok) {
  const org = await graph(tok, "GET", "/organization?$select=id,displayName,verifiedDomains");
  const o = org.json?.value?.[0];
  console.log("-- Tenant identity (deliberate confirmation, Git #1913) --------------");
  console.log(`   tenant id       : ${o?.id}`);
  console.log(`   displayName     : ${o?.displayName}`);
  console.log(`   verifiedDomains : ${(o?.verifiedDomains || []).map((d) => d.name).join(", ")}`);
  console.log(`   app registration: DEV write app ${DEV_WRITE_APP_ID}`);

  const u = await graph(
    tok,
    "GET",
    `/users/${encodeURIComponent(TEST_USER_UPN)}?$select=id,userPrincipalName,displayName,accountEnabled,jobTitle,createdDateTime,assignedLicenses,onPremisesSyncEnabled`,
  );
  console.log("\n-- Test user ---------------------------------------------------------");
  if (!u.ok) {
    console.log(`   ${TEST_USER_UPN} -- NOT PRESENT (${u.status})`);
    return null;
  }
  const user = u.json;
  console.log(`   upn             : ${user.userPrincipalName}`);
  console.log(`   objectId        : ${user.id}`);
  console.log(`   displayName     : ${user.displayName}`);
  console.log(`   accountEnabled  : ${user.accountEnabled}`);
  console.log(`   created         : ${user.createdDateTime}`);
  console.log(`   assignedLicenses: ${JSON.stringify(user.assignedLicenses)}`);

  const mem = await graph(tok, "GET", `/users/${user.id}/transitiveMemberOf?$select=id,displayName`);
  const all = mem.json?.value || [];
  const dirRoles = all.filter((m) => m["@odata.type"] === "#microsoft.graph.directoryRole");
  const groups = all.filter((m) => m["@odata.type"] !== "#microsoft.graph.directoryRole");
  console.log(
    `   directory roles : ${dirRoles.length === 0 ? "NONE (correct)" : dirRoles.map((r) => r.displayName).join(", ")}`,
  );
  console.log(
    `   group membership: ${groups.length === 0 ? "NONE (correct)" : groups.map((g) => g.displayName).join(", ")}`,
  );

  const methods = await graph(tok, "GET", `/users/${user.id}/authentication/methods`);
  if (methods.ok) {
    const list = methods.json?.value || [];
    console.log(
      `   auth methods    : ${list.length === 0 ? "none" : list.map((m) => m["@odata.type"]).join(", ")}`,
    );
  } else {
    console.log(`   auth methods    : read failed ${methods.status} ${methods.text.slice(0, 200)}`);
  }
  return user;
}

async function create(tok) {
  assertReservedUpn(TEST_USER_UPN);
  const existing = await graph(tok, "GET", `/users/${encodeURIComponent(TEST_USER_UPN)}?$select=id`);
  if (existing.ok) {
    console.log(`Already exists: ${TEST_USER_UPN} (${existing.json.id}) -- nothing to do.`);
    return existing.json.id;
  }
  const password = generatePassword();
  const res = await graph(tok, "POST", "/users", {
    accountEnabled: true,
    displayName: TEST_USER_DISPLAY_NAME,
    mailNickname: TEST_USER_MAIL_NICKNAME,
    userPrincipalName: TEST_USER_UPN,
    jobTitle: TEST_USER_JOB_TITLE,
    companyName: "SYNTHETIC TEST - Shane McCaw Consulting platform",
    passwordProfile: { forceChangePasswordNextSignIn: false, password },
  });
  if (!res.ok) throw new Error(`create failed ${res.status}: ${res.text}`);
  persistPassword(password);
  console.log(`CREATED ${TEST_USER_UPN}`);
  console.log(`  objectId: ${res.json.id}`);
  console.log(`  password written to .env.local as TESTBED_TEST_USER_PASSWORD (untracked)`);
  return res.json.id;
}

async function revokeSessions(tok, id) {
  const res = await graph(tok, "POST", `/users/${id}/revokeSignInSessions`);
  console.log(`revokeSignInSessions -> ${res.status} ${res.ok ? "OK" : res.text.slice(0, 300)}`);
  return res.ok;
}

/**
 * Register a phone authentication method so the #1899 DELETE fan-out has a real
 * object to remove. Uses a number from the reserved fictitious 555-01xx range, so it
 * can never reach a real handset. POST /users/{id}/authentication/phoneMethods is a
 * real v1.0 app-only write covered by UserAuthenticationMethod.ReadWrite.All.
 */
async function seedPhoneMethod(tok, id) {
  const res = await graph(tok, "POST", `/users/${id}/authentication/phoneMethods`, {
    phoneNumber: "+1 5555550142",
    phoneType: "mobile",
  });
  console.log(
    `POST phoneMethods -> ${res.status} ${res.ok ? `OK (id ${res.json?.id})` : res.text.slice(0, 400)}`,
  );
  return res.ok;
}

const DELETABLE_AUTH_METHODS = {
  "#microsoft.graph.phoneAuthenticationMethod": "phoneMethods",
  "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod": "microsoftAuthenticatorMethods",
  "#microsoft.graph.softwareOathAuthenticationMethod": "softwareOathMethods",
};

/**
 * #1899's ORIGINAL single-pass mechanism: enumerate ONCE, then DELETE each MFA method the
 * one read returned. Retained deliberately, behind its own flag, because this is #2981's
 * repro — against an Entra read replica that has not converged this prints
 * "enumerated N method(s); 0 deletable" and deletes nothing while reporting no error.
 * Production no longer does this; see purgeAuthMethodsVerified() below.
 */
async function purgeAuthMethodsSinglePass(tok, id) {
  const listed = await graph(tok, "GET", `/users/${id}/authentication/methods`);
  if (!listed.ok) throw new Error(`enumerate failed ${listed.status}: ${listed.text}`);
  const all = listed.json?.value || [];
  const targets = all.filter((m) => DELETABLE_AUTH_METHODS[m["@odata.type"]]);
  console.log(`enumerated ${all.length} method(s); ${targets.length} deletable`);
  for (const m of targets) {
    const seg = DELETABLE_AUTH_METHODS[m["@odata.type"]];
    const res = await graph(tok, "DELETE", `/users/${id}/authentication/${seg}/${m.id}`);
    console.log(`  DELETE ${seg}/${m.id} -> ${res.status} ${res.ok ? "OK" : res.text.slice(0, 200)}`);
  }
  return targets.length;
}

/**
 * #2981's real fix, mirroring what production now runs: enumerate -> delete ->
 * RE-enumerate until the removable-method list is corroborated empty by
 * `requiredCleanReads` consecutive delayed reads, or a bounded budget runs out.
 *
 * The authoritative implementation is
 * `artifacts/api-server/src/lib/mfa-reregistration.ts` (runMfaReregistrationConvergence),
 * which is where the reasoning and the unit tests live. This is its deliberate,
 * dependency-free mirror so the same convergence can be exercised against the REAL
 * testbed tenant from a plain node script; keep the two in step if either changes.
 */
async function purgeAuthMethodsVerified(tok, id, policy = {}) {
  const { requiredCleanReads = 2, maxReads = 6, initialDelayMs = 5_000, maxDelayMs = 15_000, totalBudgetMs = 45_000 } =
    policy;
  const startedAt = Date.now();
  const resolved = new Set();
  const deleted = [];
  let reads = 0;
  let cleanReads = 0;

  while (reads < maxReads) {
    if (reads > 0) {
      const remaining = totalBudgetMs - (Date.now() - startedAt);
      if (remaining <= 0) break;
      const delay = Math.min(Math.min(initialDelayMs * 2 ** (reads - 1), maxDelayMs), remaining);
      console.log(`  ...waiting ${delay}ms for replica convergence`);
      await new Promise((r) => setTimeout(r, delay));
    }

    reads++;
    const listed = await graph(tok, "GET", `/users/${id}/authentication/methods`);
    if (!listed.ok) throw new Error(`enumerate failed ${listed.status}: ${listed.text}`);
    const all = listed.json?.value || [];
    const outstanding = all.filter((m) => DELETABLE_AUTH_METHODS[m["@odata.type"]] && !resolved.has(m.id));
    console.log(`read ${reads}: enumerated ${all.length} method(s); ${outstanding.length} outstanding deletable`);

    if (outstanding.length === 0) {
      cleanReads++;
      if (cleanReads >= requiredCleanReads) {
        console.log(`VERIFIED empty after ${reads} read(s), ${cleanReads} corroborating clean read(s); deleted ${deleted.length}`);
        return { verified: true, deleted, reads };
      }
      continue;
    }

    if (reads > 1) {
      console.log(`  !! re-enumeration revealed ${outstanding.length} method(s) an earlier read did not — this is the #2981 stale read`);
    }
    cleanReads = 0;
    for (const m of outstanding) {
      const seg = DELETABLE_AUTH_METHODS[m["@odata.type"]];
      const res = await graph(tok, "DELETE", `/users/${id}/authentication/${seg}/${m.id}`);
      console.log(`  DELETE ${seg}/${m.id} -> ${res.status} ${res.ok ? "OK" : res.text.slice(0, 200)}`);
      if (!res.ok && res.status !== 404) {
        return { verified: false, reason: `delete_failed ${res.status}`, deleted, reads };
      }
      resolved.add(m.id);
      if (res.ok) deleted.push(`${seg}/${m.id}`);
    }
  }

  console.log(`NOT VERIFIED after ${reads} read(s) — reporting failure rather than claiming a wipe (#2981)`);
  return { verified: false, reason: reads >= maxReads ? "read_cap_reached" : "budget_exhausted", deleted, reads };
}

// ── main ─────────────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("testbed-test-user-2840.mjs")) {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const mutating =
    has("--create") ||
    has("--revoke-sessions") ||
    has("--seed-phone-method") ||
    has("--purge-auth-methods") ||
    has("--purge-auth-methods-single-pass");
  if (mutating && !has("--i-mean-it")) {
    console.log("Mutating mode requires --i-mean-it as an explicit second flag. Aborting.");
    process.exit(2);
  }
  const env = loadEnvLocal();
  const tok = await token(env);

  if (has("--create")) await create(tok);
  const user = await report(tok);

  if (user && has("--revoke-sessions")) {
    assertReservedUpn(user.userPrincipalName);
    console.log("\n-- revokeSignInSessions ----------------------------------------------");
    await revokeSessions(tok, user.id);
  }
  if (user && has("--seed-phone-method")) {
    assertReservedUpn(user.userPrincipalName);
    console.log("\n-- seed a deletable phone auth method ---------------------------------");
    await seedPhoneMethod(tok, user.id);
  }
  if (user && has("--purge-auth-methods")) {
    assertReservedUpn(user.userPrincipalName);
    console.log("\n-- #1899 fan-out + #2981 verification: purge MFA methods ---------------");
    await purgeAuthMethodsVerified(tok, user.id);
  }
  if (user && has("--purge-auth-methods-single-pass")) {
    assertReservedUpn(user.userPrincipalName);
    console.log("\n-- #2981 REPRO: original single-pass purge (may delete nothing) --------");
    await purgeAuthMethodsSinglePass(tok, user.id);
  }
}
