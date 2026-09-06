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
 *   --purge-auth-methods  #1899's real fan-out: GET authentication/methods, then DELETE
 *                         each phone / Microsoft Authenticator / software OATH method.
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

/** #1899's real mechanism: enumerate, then DELETE each MFA method individually. */
async function purgeAuthMethods(tok, id) {
  const listed = await graph(tok, "GET", `/users/${id}/authentication/methods`);
  if (!listed.ok) throw new Error(`enumerate failed ${listed.status}: ${listed.text}`);
  const DELETABLE = {
    "#microsoft.graph.phoneAuthenticationMethod": "phoneMethods",
    "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod": "microsoftAuthenticatorMethods",
    "#microsoft.graph.softwareOathAuthenticationMethod": "softwareOathMethods",
  };
  const all = listed.json?.value || [];
  const targets = all.filter((m) => DELETABLE[m["@odata.type"]]);
  console.log(`enumerated ${all.length} method(s); ${targets.length} deletable`);
  for (const m of targets) {
    const seg = DELETABLE[m["@odata.type"]];
    const res = await graph(tok, "DELETE", `/users/${id}/authentication/${seg}/${m.id}`);
    console.log(`  DELETE ${seg}/${m.id} -> ${res.status} ${res.ok ? "OK" : res.text.slice(0, 200)}`);
  }
  return targets.length;
}

// ── main ─────────────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("testbed-test-user-2840.mjs")) {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const mutating =
    has("--create") ||
    has("--revoke-sessions") ||
    has("--seed-phone-method") ||
    has("--purge-auth-methods");
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
    console.log("\n-- #1899 fan-out: purge MFA methods -----------------------------------");
    await purgeAuthMethods(tok, user.id);
  }
}
