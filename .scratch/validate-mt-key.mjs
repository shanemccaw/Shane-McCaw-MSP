// STEP 1 structural diagnostic — runs the EXACT checks #855 specifies.
// Reads the candidate PEM from a file path in argv[2]; NEVER prints key material.
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

const path = process.argv[2];
const thumbprint = process.argv[3] ?? "";

// Simulate how the value would be stored in the env var: some deployments store
// the PEM as a single line with literal backslash-n. Test BOTH the raw file
// content and a "\n"-escaped form through the same unescape buildClientAssertion uses.
const rawFile = readFileSync(path, "utf8");
const escaped = rawFile.replace(/\r?\n/g, "\\n"); // worst-case: stored escaped

function check(label, value) {
  const unescaped = value.replace(/\\n/g, "\n");
  const trimmed = unescaped.trim();
  const set = value.length > 0;
  const beginEnd = trimmed.startsWith("-----BEGIN") && trimmed.endsWith("-----END PRIVATE KEY-----");
  let parses = false, err = "";
  try { crypto.createPrivateKey(unescaped); parses = true; }
  catch (e) { err = e.message; }
  console.log(`[${label}]`);
  console.log(`  set & non-empty:        ${set ? "PASS" : "FAIL"}`);
  console.log(`  BEGIN/END after unesc:  ${beginEnd ? "PASS" : "FAIL"}`);
  console.log(`  createPrivateKey():     ${parses ? "PASS" : "FAIL" + (err ? " (" + err + ")" : "")}`);
}

check("value stored WITH real newlines", rawFile);
check("value stored ESCAPED (\\n literals)", escaped);

const hex40 = /^[0-9a-fA-F]{40}$/.test(thumbprint.replace(/[:\s]/g, ""));
console.log(`[thumbprint]`);
console.log(`  40-char hex SHA-1:      ${hex40 ? "PASS" : "FAIL"}  (${thumbprint.replace(/[:\s]/g, "").length} chars)`);
