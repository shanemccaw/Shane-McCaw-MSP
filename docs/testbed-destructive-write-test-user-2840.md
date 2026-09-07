# The sanctioned destructive-write test user (Git #2840)

**Status:** real, provisioned, live-verified — 2026-09-06.

## Why this exists

The testbed tenant is simultaneously Shane's **real production Microsoft 365 tenant**
(`c4c814d4-3afe-441e-9145-62461d0a4fd3`, org display name **McCawSoft, Inc.**). Because of
that, no session could ever exercise a destructive *per-user* Graph write — deleting a
user's registered MFA methods, revoking sign-in sessions, disabling an account, forcing a
password reset — without risking a real employee identity. #1899 shipped
`mfa-enforcement-v1`'s real re-registration fan-out with the code path unit-tested and the
Graph *permission grant* live-verified, but **the destructive DELETE itself was never
executed against a real directory object**, for exactly that reason.

Shane's decision on #2840: provision one dedicated, clearly-marked, non-privileged user
as the sanctioned target. This document records it.

## The account

| Field | Value |
|---|---|
| **UPN** | `zz-test-graphwrite-01@mccawsoft2.onmicrosoft.com` |
| **objectId** | `bdb21dc3-146a-4d97-a128-a2b8ff618d35` |
| **displayName** | `ZZ TEST ACCOUNT - destructive Graph write target (Git #2840) - DO NOT USE` |
| **jobTitle** | `Synthetic test account - not a person` |
| **companyName** | `SYNTHETIC TEST - Shane McCaw Consulting platform` |
| **Created** | `2026-09-06T14:22:23Z`, via `POST /users` on the **DEV** write app registration `9f6f4772-b5be-421f-815e-b392336c373a` |
| **Directory roles** | **none** (verified by a real `transitiveMemberOf` read) |
| **Group memberships** | **none** (same read) |
| **Assigned licences** | **none** (`assignedLicenses: []`) — no mailbox, no OneDrive, no Teams identity |
| **accountEnabled** | `true` — it must be enabled for authentication-method writes to be accepted |
| **Password** | generated at creation, written to the untracked `.env.local` as `TESTBED_TEST_USER_PASSWORD`. Never committed, never in an issue comment. |

### Naming convention — the reserved prefix is load-bearing

**`zz-test-*@mccawsoft2.onmicrosoft.com` is reserved for synthetic test identities.** It is
not merely a label: `scripts/azure/testbed-test-user-2840.mjs` refuses, in code, to act on
any UPN outside that prefix and domain (`assertReservedUpn`). A future second test target
should follow the same shape (`zz-test-<purpose>-<nn>@…`) so the same guard covers it.

The `zz-` prefix also sorts the account to the bottom of every alphabetical user list in
the Entra admin center and the Microsoft 365 admin center, so it reads as an obvious
non-person at a glance.

## How to use it

`scripts/azure/testbed-test-user-2840.mjs` is the single entry point. It exports the UPN,
objectId-bearing constants and the reserved prefix, so other scripts import them rather
than re-typing an identity.

```bash
# read-only state report: tenant identity, verified domains, and the user's real
# roles / groups / licences / registered authentication methods
node scripts/azure/testbed-test-user-2840.mjs

# mutating modes — each additionally requires the explicit --i-mean-it flag
node scripts/azure/testbed-test-user-2840.mjs --create             --i-mean-it
node scripts/azure/testbed-test-user-2840.mjs --revoke-sessions    --i-mean-it
node scripts/azure/testbed-test-user-2840.mjs --seed-phone-method  --i-mean-it
node scripts/azure/testbed-test-user-2840.mjs --purge-auth-methods --i-mean-it

# #2981's repro: the ORIGINAL single-pass purge, kept so the stale-read failure
# can still be reproduced on demand. Production no longer behaves this way.
node scripts/azure/testbed-test-user-2840.mjs --purge-auth-methods-single-pass --i-mean-it
```

`--purge-auth-methods` now mirrors what production runs after #2981: enumerate → delete →
**re-enumerate** until two consecutive delayed reads corroborate that nothing removable is
left (bounded at 6 reads / 45s), reporting failure rather than success if it cannot. The
authoritative implementation is `artifacts/api-server/src/lib/mfa-reregistration.ts`; the
script's copy is a deliberate dependency-free mirror, so keep the two in step.

### Safety rails, enforced in code rather than in prose

1. **Refuses the PROD write app registration** `3308b280-e41e-42ba-9f73-73aac2ad3dee` by
   appId, unconditionally — the Git #1913 production-change gate, made mechanical.
2. **Refuses any tenant** other than `c4c814d4-3afe-441e-9145-62461d0a4fd3`.
3. **Refuses any UPN** outside the reserved `zz-test-*@mccawsoft2.onmicrosoft.com` shape.
4. **Every mutating mode requires `--i-mean-it`** as a second, explicit flag.

## Live verification actually performed (2026-09-06)

Real calls, real responses, against the real directory object above:

| Operation | Graph call | Result |
|---|---|---|
| Create | `POST /users` | **201** — objectId `bdb21dc3-146a-4d97-a128-a2b8ff618d35` |
| Non-privilege check | `GET /users/{id}/transitiveMemberOf` | `0` roles, `0` groups |
| Revoke sessions | `POST /users/{id}/revokeSignInSessions` | **200 OK** |
| Seed a deletable method | `POST /users/{id}/authentication/phoneMethods` | **201** — id `3179e48a-750b-4051-897c-87b9720928f7`, number `+1 5555550142` (reserved fictitious 555-01xx range, cannot reach a real handset) |
| **#1899's fan-out** | `GET /users/{id}/authentication/methods` then `DELETE /users/{id}/authentication/phoneMethods/{methodId}` | **enumerated 2, 1 deletable, DELETE → 204 OK** |

That last row is the point of this issue: **#1899's destructive DELETE is now genuinely
live-verified end-to-end**, not just unit-tested. The account was left in a clean state
afterwards — only the non-deletable `passwordAuthenticationMethod` remains.

### A real behaviour observed: Entra directory replication lag

The seed → purge sequence, run in a single process seconds apart, **enumerated only 1
method (0 deletable) and silently deleted nothing**, even though the phone method had just
returned 201. A re-run moments later saw 2 methods and deleted correctly. Two consecutive
`GET /users/{id}/authentication/methods` reads within the same run also disagreed (2 vs 1).

This is Entra directory replication between Graph replicas, not a script bug — but it has a
real consequence for `mfa-enforcement-v1`, which enumerates and deletes in one pass and
reports success on a `0 deletable` read. Filed as its own issue (see below).

### Re-verified after the #2981 fix (2026-09-07)

Both halves of the lag, and the fix, observed live against the same account in one sitting:

| Sequence | Result |
|---|---|
| `--seed-phone-method --purge-auth-methods-single-pass` (the OLD production behaviour) | `POST phoneMethods` → **201**, then `enumerated 1 method(s); 0 deletable` — **deleted nothing, reported no error.** #2981 reproduced verbatim. |
| `--purge-auth-methods` (the NEW behaviour) on that same still-registered method | `read 1: enumerated 2 method(s); 1 outstanding` → `DELETE phoneMethods/3179e48a-750b-4051-897c-87b9720928f7` → **204**; `read 2: 0 outstanding`; `read 3: 0 outstanding` → **VERIFIED empty after 3 reads, 2 corroborating clean reads.** |
| An earlier `--seed-phone-method --purge-auth-methods` in the same sitting | read 1 deleted the method (204), and **read 2 still enumerated 2 methods** — the lag running in the *other* direction, a converged replica still listing a method already deleted. Treated as clean because the confirmed 204 outranks the lagging read, exactly as Microsoft's own guidance says; read 3 enumerated 1 and it verified. |

The account was left clean again afterwards — only `passwordAuthenticationMethod` remains.

## What this does *not* unlock

- **Password / privileged-user operations still need more than a permission grant.**
  `graph-write-permissions.ts` already records that `User.ReadWrite.All` alone does not let
  the app reset a privileged user's password — the app must additionally hold a directory
  role. Assigning one is a **production change** (Git #1913) and is not agent work.
- **No registered Microsoft Authenticator or software-OATH method exists on this account**,
  and neither can be seeded app-only — both require an interactive registration flow. Only
  the `phoneMethods` branch of #1899's three-way fan-out has been exercised against a real
  object; the Authenticator and software-OATH branches remain unit-tested only. They are
  the same code path with a different URL segment, but that is inference, not evidence.
- **This account is not a portal user.** It has no row in the platform's `users` table and
  no licence, so it does not close the separate gap noted in
  `docs/account-security-contract-pack.md` §8 (portal identities are personal
  outlook.com/gmail.com addresses with no verified link to an M365 user object).

## Related

- **#1899** — `mfa-enforcement-v1` step 1's real re-registration mechanism; this account is
  what its DELETE fan-out was missing.
- **#2981** — the replication-lag consequence found here, now fixed: the fan-out
  re-enumerates and reports failure rather than success when it cannot corroborate the
  wipe (`artifacts/api-server/src/lib/mfa-reregistration.ts`).
- **#1913 / CLAUDE.md "Production-change gate"** — why the app registration, not the tenant,
  is the boundary this account is created inside.
- `docs/write-app-permissions.md` — the write app's real permission inventory.
- `docs/writepackmapping.md` — the pack/template map whose §9 "no successful write payload
  has ever been observed" unknown this account partially retires.
