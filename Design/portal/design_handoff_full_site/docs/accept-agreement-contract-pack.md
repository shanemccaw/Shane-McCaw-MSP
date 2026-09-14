# accept-agreement.tsx — contract extraction pack

**Issue:** #4049, part of #1649 ("Feature: Signup, Agreement and Invite (Portal)"), part of
#1485 (EPIC: Portal). Written only once #4048 (restoring `platform-agreements.ts` + the admin
page, reversal of #3412) was genuinely closed — confirmed via `get_issue(4048)` returning
`state: "closed"`, `stateReason: "completed"`, plus #4048's own DONE bookend and
`verify-branch-merged.mjs`-confirmed commit `2b98ead2278d70a6f05784aeb27ba79b9da19998`. Extracted,
not authored — every field below traces to one of the files listed, cited to file:line.

This supersedes, for the three endpoints below only, the corresponding entries in §2 of the
sibling pack `signup-agreement-and-invite-contract-pack.md` (#2442) — that pack was written
against the pre-#3412/pre-#4048 code (`requireAuth`, `requireRole("PlatformAdmin")`). This pack
documents the real, current, post-restore state. The rest of that pack (signup tiers/start/success,
staff invite) is untouched by #4048 and still current as written there.

Design surface: **none exists for a standalone `accept-agreement.tsx` page.** `Design/portal/`
contains exactly one relevant export, `design_handoff_full_site/screens/Signup Agreement and
Invite.dc.html`, and it covers only 3 scenes — `tiers` (signup.tsx), `success`
(signup-success.tsx), `invite` (accept-invite.tsx) — confirmed by re-reading that file's own
scene list; no 4th scene for the authenticated post-login agreement-re-acceptance gate exists.
Per CLAUDE.md, a page with no `.dc.html` export has no design. This pack is extracted straight
from the backend so it's ready the moment a design lands; it does not itself unblock building the
page.

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/platform-agreements.ts` — full file, restored by #4048
- `artifacts/api-server/src/routes/index.ts:85,364` — mount confirmation (`router.use(platformAgreementsRouter)`, live under `/api`)
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `requireCapability()`, the live #2460 RBAC gate this route now uses
- `lib/db/src/schema/msp.ts:1254-1291` — `platform_agreements`, `msp_agreement_acceptances` table definitions
- `artifacts/admin-panel/src/pages/PlatformAgreements.tsx` — the only surface that can currently publish a version
- `artifacts/portal/src/lib/msp-signup-api.ts:9-17`, `artifacts/portal/src/pages/signup.tsx:26-40` — stale header comments (see §4 finding)
- Local PostgreSQL (`shanemccawmsp`, `DATABASE_URL`) — queried live 2026-09-14 for §2's real-state check

---

## 1. Wire contract

### `GET /api/platform/agreement/current` — public, no auth (`platform-agreements.ts:34-51`)

Unchanged in shape from #2442's pack. Returns the full `platform_agreements` row where
`isCurrentVersion = true`, or `{ agreement: null }` if none is published.

Full row shape (`msp.ts:1254-1266`): `id`, `version` (`text`, not null), `title` (`text`, not
null, default `"Platform MSA + DPA"`), `body` (`text`, not null — raw text, no rendering hint in
the row itself), `publishedAt` (`timestamptz \| null`), `publishedByUserId` (`integer \| null`),
`isCurrentVersion` (`boolean`, not null), `createdAt`, `updatedAt` (`timestamptz`, not null).

### `GET /api/platform/agreement/acceptance-status` — MSP-authenticated, `requireCapability("ladder.free")` (`platform-agreements.ts:55-92`)

**Changed from #2442's pack: gate is now `requireCapability("ladder.free")`, not bare
`requireAuth`.** No request body. Looks up the current agreement; if none, returns `{
required: false, accepted: true }` (nothing to accept — genuine no-op, not an error). If one
exists, looks up an `msp_agreement_acceptances` row for `(userId, agreementVersion)`:

| Field | Type | Nullability | Source |
|---|---|---|---|
| `required` | `boolean` | not null | `true` once a current agreement exists |
| `accepted` | `boolean` | not null | `!!acceptance` |
| `acceptedAt` | `Date \| null` | nullable | `acceptance?.acceptedAt ?? null` |
| `version` | `string` | present only when `required` | `current.version` |

### `POST /api/platform/agreement/accept` — MSP-authenticated, `requireCapability("ladder.free")` (`platform-agreements.ts:96-161`)

**Changed from #2442's pack: same gate change as above.** Body: `{ checkboxConfirmed: boolean
}`. 400 (`"You must check the agreement checkbox to proceed"`) if not `true`. If no current
agreement, no-op success (`{ ok: true, message: "No agreement currently published" }`).
Idempotent: an existing `(userId, current.version)` row short-circuits to `{ ok: true }` with
no second insert. Otherwise inserts into `msp_agreement_acceptances`:

| Column | Source |
|---|---|
| `mspId` | `user.mspId ?? null` |
| `userId` | `user.id` |
| `agreementVersion` | `current.version` |
| `agreementId` | `current.id` |
| `ipAddress` | `req.ip ?? req.socket?.remoteAddress ?? null` |
| `userAgent` | `req.headers["user-agent"] ?? null` |
| `checkboxConfirmed` | `true` (hardcoded — route already 400'd otherwise) |

`effectiveRole` (`user.role === "admin" ? "PlatformAdmin" : user.mspRole`) is computed and
logged (`platform-agreements.ts:138,151-154`) but **not written to any column** — it exists only
for the `log.info` audit line, not the inserted row. Real, not an oversight worth flagging on
its own — the inserted row already carries `userId`/`mspId`, from which role is derivable.

### Admin CRUD — `requireCapability("ladder.platform-admin")` (all four routes)

**Changed from #2442's pack: was `requireRole("PlatformAdmin")` (retired middleware, deleted
along with the rest of the file by #3412); now `requireCapability("ladder.platform-admin")`,
the live #2460 ladder pattern** — confirmed by #4048's own restore and this session's re-read of
`platform-agreements.ts:165,180,209,248`.

`GET /api/admin/platform-agreements` (list all, newest-created-first) · `POST
/api/admin/platform-agreements` (create draft, `{version, title?, body}`, 400 if
version/body missing) · `PUT /api/admin/platform-agreements/:id` (edit a draft only — 400 if
`isCurrentVersion`) · `PATCH /api/admin/platform-agreements/:id/publish` (transactional:
unsets `isCurrentVersion` on every row, then sets it on the target — single-current-version
invariant enforced inside a `db.transaction`, `platform-agreements.ts:262-276`).

This is **the only surface that can publish a version** — confirmed live and reachable again
via `artifacts/admin-panel/src/pages/PlatformAgreements.tsx`, mounted under the
`sys-platform-agreements` nav entry (`workspaceNav.tsx`), its `SystemWorkspace.tsx` case, per
#4048's restore.

---

## 2. CURRENT / DECIDED

**Real, live state of the local database (queried live, 2026-09-14 — same query #2442's pack
ran on 2026-09-03):**

```
 id | version |        title        | is_current_version | published_at |          created_at
----+---------+---------------------+---------------------+--------------+-------------------------------
  1 | Test    | Platform MSA + DPA  | f                   | (null)       | 2026-07-20 15:33:36.07987-04
```

`msp_agreement_acceptances` row count: **0.**

**This confirms the exact fact #4049 asked this pack to check: the answer is unchanged by
#4048.** The only row that has ever existed (`id=1`, version `"Test"`) is still unpublished.
`GET /api/platform/agreement/current` still genuinely returns `{ agreement: null }` today. What
*did* change is that a real path to publish one now exists again (§1's Admin CRUD, restored) —
before #4048 there was no way left to ever change this state; now there is, it just hasn't been
exercised.

| Surface | Status | Note |
|---|---|---|
| `GET /api/platform/agreement/current` | **CURRENT — genuinely empty (`{agreement: null}`) today** | not a read failure; real DB state, unchanged since #2442's pack |
| `GET /api/platform/agreement/acceptance-status` | **CURRENT** | gate changed to `ladder.free` (§1); correctly no-ops when nothing is published |
| `POST /api/platform/agreement/accept` | **CURRENT** | gate changed to `ladder.free` (§1); idempotent |
| Admin agreement CRUD (`/api/admin/platform-agreements*`) | **CURRENT** | gate changed to `ladder.platform-admin` (§1); restored by #4048, live and reachable via the Admin Panel again |
| `accept-agreement.tsx` itself | **DECIDED, not yet buildable** | no `.dc.html` export exists in `Design/portal/` for this scene (see header); this pack does not change that — Design phase is still the blocker, per #4009 and the fixed architect → endpoints → contract pack → Design → wire order |

---

## 3. Real enum unions

- **Agreement version** — free-text (`platform_agreements.version`, `text`, not an enum) —
  whatever string an admin publishes. `"Test"` is the only value that has ever existed.
- No other enum surfaces on these three endpoints' request/response shapes — `required`,
  `accepted`, `checkboxConfirmed` are all plain booleans, not enums.

---

## 4. Real finding — two portal source comments claim the backend is still gone

**Filed as #4073**, direct sibling sub-issue of #1649 (this issue's own Feature-tier parent),
labeled `bug`.

Two header comments in `artifacts/portal/` state, as present-tense fact, that
`/api/platform/agreement/*` and the admin CRUD "were deleted by Git #3412 ... and there is no
way left to publish one":

- `artifacts/portal/src/lib/msp-signup-api.ts:9-17`
- `artifacts/portal/src/pages/signup.tsx:26-40`

Both are now stale — #4048 restored the route file, the admin page, and its nav entry, six
hours before this pack was written (#4048 closed 2026-09-14T15:09:46Z; this pack written
2026-09-14T~19:00Z same day). The underlying behavior these comments describe (no function in
`msp-signup-api.ts` calls the agreement endpoints; `signup.tsx` renders the "no agreement
published" banner as permanent) is **still functionally correct today** — §2 above confirms the
one existing row is still unpublished — so nothing is broken at runtime. But the comments'
stated *reason* ("there is no way left to publish one") is now false: §1's Admin CRUD is live
and reachable again. A future session reading only these comments, not this pack or #4048,
would wrongly conclude the admin-publish path still doesn't exist.

Not `security` (no privilege boundary, no data exposure — a stale doc comment). Not prefixed
`URGENT:` (the code these comments describe is still correct; only the comments' claim about
*why* is wrong, and #1649's own Design-phase build order means nothing consumes these files
differently as a result).

---

## 5. Orphaned-endpoint check

All three endpoints this pack covers are live, mounted, and reachable — **none are orphaned in
the technical sense** (they resolve, they don't 404) — but **none has a page consumer today**,
confirmed by grep: no file under `artifacts/portal/src` calls
`platform/agreement/acceptance-status` or `platform/agreement/accept`, and
`platform/agreement/current` appears only in comments (`msp-signup-api.ts:10`,
`offers-sow-api.ts:20`, `customer-offers.tsx:55`, `signup.tsx:33`), never a real fetch call.

Per this issue's own standing rule ("if a real, live endpoint has no page consumer, file it as a
sub-issue at pack time, parented to #1649") — **not filed separately**, because this absence is
not a new discovery: it is the exact, already-tracked gap #4009 exists to describe (no Design
export for `accept-agreement.tsx`, therefore nothing to wire these three endpoints to yet), and
#1649's own structured index already carries this Feature's build-order state. Filing a second
issue for the same known gap would be redundant with #4009, not a new finding.

| Endpoint | Mount confirmed | Consumer |
|---|---|---|
| `GET /api/platform/agreement/current` | `routes/index.ts:85,364` (`platform-agreements.ts:34`) | comment-only references, no real fetch call |
| `GET /api/platform/agreement/acceptance-status` | same | none |
| `POST /api/platform/agreement/accept` | same | none |

---

## 6. Cross-surface edges

- **`signup.tsx`'s own inline gate is untouched by any of this.** `msp-signup.ts:150-196`
  queries `platform_agreements` directly (not via these three routes) and takes its "no current
  agreement, proceed" branch today, same as #2442's pack already documented — #4048 restoring
  the admin-CRUD publish path doesn't change that branch unless/until someone actually publishes
  a version through it.
- **The Admin Panel is the only place this can change.** If Shane publishes a version via
  `PlatformAgreements.tsx`, three things flip simultaneously: `GET
  /api/platform/agreement/current` starts returning a real row, `signup.tsx`'s inline gate
  starts requiring `checkboxConfirmed`/`agreementVersion`, and (once built) `accept-agreement.tsx`
  would have something real to gate on. None of that has happened in this environment as of this
  pack.
