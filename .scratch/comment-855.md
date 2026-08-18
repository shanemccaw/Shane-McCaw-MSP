## Diagnosed to root cause + self-diagnosing guard shipped

**Root cause:** `MT_APP_CERT_THUMBPRINT` on the live server is already **correct** (`251BDCD5895FB127F44648F29999F3B1820CA2D3`). The `RS256 / secretOrPrivateKey must be an asymmetric key` failure is caused **solely by a broken, unparseable `MT_APP_CERT_PRIVATE_KEY`** value — not the thumbprint, and not a code bug.

### STEP 0 — cert identity (verified, no key material shown)
- MT app confirmed: `MT_APP_CLIENT_ID = 9ea2e409-…` → **"MSP Platform – Multi-Tenant Consent"**. Its uploaded keyCredential thumbprint (`az ad app`) = `251BDCD5…`, cert `CN=ShaneMcCawMSP-MT-App`, valid **Jul 2026 → Jul 2028**.
- The `McCawSoft.pfx` / `McCawSoft2.pfx` at `C:\Source` root are for **different** app registrations (NASA-OverSharing / NASA-OverSharing-Scope) — red herrings, not the MT app cert.
- The real MT cert **and** its private key were recovered from **git history** (accidental check-in, commit `819c7131`: `mt-app-cert.pem` / `mt-app-private-key.pem`).

### STEP 1 — structural diagnostic on the **correct** value (pass/fail only)
| Check | Result |
|---|---|
| `MT_APP_CERT_PRIVATE_KEY` set & non-empty | ✅ PASS |
| After `.replace(/\n/g,"\n")` → starts `-----BEGIN` / ends `-----END` | ✅ PASS |
| Node `crypto.createPrivateKey()` parses it | ✅ PASS |
| Private key's public key matches the cert (SHA-256 pubkey fp `3378e5ae…`) | ✅ PASS |
| Recomputed cert SHA-1 == `251BDCD5…` | ✅ PASS |
| `MT_APP_CERT_THUMBPRINT` well-formed 40-hex SHA-1 | ✅ PASS |

The correct value passes clean both when stored with real newlines and when stored `\n`-escaped. (I could not run the *before* snapshot against the live server env — the session's SSH env-read of the secret var is policy-blocked — but the failing value is by definition the current one; #855 is the proof.)

### STEP 2 — self-diagnosing guard (shipped, commit `f9fbffec`)
`buildClientAssertion()` (`artifacts/api-server/src/lib/sharepoint-admin.ts`) now runs `crypto.createPrivateKey()` on the unescaped PEM **before** `jwt.sign()`, and on failure throws an actionable error naming the env var + cause instead of jsonwebtoken's source-less message. Verified locally: a good key passes; the realistic single-line-paste break is caught (`DECODER routines::unsupported`). No key material is ever logged/echoed. `tsc --noEmit`: 0 errors in the touched file (76 pre-existing baseline unchanged).

### STEP 0c / STEP 3 — needs a Shane action (why I can't self-heal it)
The env vars come from **Replit Secrets** (no `.env`/dotenv in the app; restart is a `kill 1` container reboot, which re-injects secrets from the store). An SSH shell `export` therefore **cannot** persist the value to the running Node process — the fix must be set in the **Replit Secrets** pane. Only `MT_APP_CERT_PRIVATE_KEY` needs changing (the thumbprint is already correct).

## 🔴 Shane To-Do
1. **Fix the live error:** set Replit Secret `MT_APP_CERT_PRIVATE_KEY` to the correct PEM (it's the `mt-app-private-key.pem` from git blob `32bff2ad` / commit `819c7131`, formatted with real newlines), then restart. That resolves #855. STEP 3 end-to-end monitor verification pends this.
2. **Security — rotate:** the MT app cert **and its private key are exposed in git history** (commit `819c7131`). Recommend rotating the certificate on the app registration and purging it from history. (Since it's exposed, replacing the cert entirely is the clean fix — and you'd set the new key into the same secret.)

Leaving this open for your review per protocol — not closing it myself.
