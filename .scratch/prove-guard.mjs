// Proves the STEP 2 guard catches the exact #855 failure mode.
// Reads a good PEM from argv[2]; NEVER prints key material.
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

const good = readFileSync(process.argv[2], "utf8");
// Reproduce the real #855 break: the PEM stored as ONE line with spaces where
// the newlines should be (incl. around BEGIN/END) and no "\n" escapes for the
// code's .replace(/\\n/g,"\n") to restore — i.e. how a single-line paste looks.
const mangled = good.trim().replace(/\r?\n/g, " ");

function guard(pem) {           // mirrors the new buildClientAssertion() guard
  try { crypto.createPrivateKey(pem); return { ok: true }; }
  catch (err) { return { ok: false, cause: err.message }; }
}
console.log("GOOD key  -> guard:", guard(good).ok ? "PASS (parses)" : "FAIL");
const m = guard(mangled);
console.log("MANGLED   -> guard:", m.ok ? "did NOT catch (bad)" : "CAUGHT cause=" + m.cause);
// (The old, cryptic jwt.sign failure for this same mangled input is exactly the
//  "secretOrPrivateKey must be an asymmetric key when using RS256" in #855's stack trace.)
