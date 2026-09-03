# Public Share Pages (Portal) — contract extraction pack

**Issue:** #2453, part of #1663 ("Feature: Public Share Pages (Portal)"), part of #1485
(EPIC: Portal). Method per #1642. Extracted, not authored — every field below traces to
one of the files listed, cited to file:line. This is Phase 2 of the Portal build order
(architect → build the endpoints → regenerate the contract pack → Design → wire) — no
page/UI-shape decisions are made here.

## Step 1 result — endpoint verification against #2453's own named list

All 3 endpoints named in #2453's Step 1 are real and live, but **all 3 have a different
real shape than the issue's own text**: the issue names them `:id`; every one of them is
actually keyed by an opaque `:shareToken` (or `:token`), not a numeric row id. That is
real, current information for this pack, not a typo to silently correct:

- `public/documents/:id` → **`GET /api/public/documents/:shareToken`** —
  `portal-documents.ts:286` (route exists; param is `shareToken`, not `id`)
- `public/live-document-shares/:id` → **`GET /api/public/live-document-shares/:token`** —
  `live-document-shares.ts:180` (route exists; param is `token`, not `id`)
- `public/sows/:id` → **`GET /api/public/sows/:shareToken`** —
  `msp-sow.ts:754` (route exists; param is `shareToken`, not `id`)

Each of the 3 also has a real sibling mutation route that #2453's list didn't name but
that this pack pulls in because it's part of the same public, unauthenticated flow:

- `POST /api/public/documents/:shareToken/doc-views` — `portal-documents.ts:351`
  (dwell-time tracking on the shared document viewer)
- `POST /api/public/sows/:shareToken/sign` — `msp-sow.ts:816` (customer signs the SOW via
  the share link — the actual point of a public SOW page existing)

`live-document-shares` has no sibling public mutation route — it is read-only from the
public side; the only write (minting the token) is the authenticated
`POST /portal/live-documents/share` (`live-document-shares.ts:130`), pulled in here only
to establish where a `live_document_shares` row and its `token` come from.

One of `public/documents/:shareToken`'s two routes — `GET` and the `doc-views` POST — is
**already fully documented** in `docs/documents-contract-pack.md` §2c–2e, under the
Documents Feature (#1642-era pack, extracted before this Feature's own issue existed).
This pack does not re-derive that contract from scratch (re-deriving from the same source
file risks drift between two packs describing one route); §1 below is a condensed
cross-reference to that pack's own field-level table, not a competing derivation. §2 and
§3 (live-document-shares, sows) have no prior pack and are extracted here in full.

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/portal-documents.ts` — `:222-278` (mint), `:286-344`
  (public read), `:351-384` (public doc-views) — read for §1's condensed contract and to
  confirm the mint route's own auth/ownership shape
- `artifacts/api-server/src/routes/live-document-shares.ts` — read in full (301 lines);
  both routes, the file's own header (the deliberate design-decision record for §2's
  "live, not snapshot" and "no expiresAt" behavior), and `LIVE_DOCUMENT_SHARE_REPORTS`
- `artifacts/api-server/src/routes/msp-sow.ts` — `:1-40` (route map comment), `:76-77`
  (`generateShareToken`), `:230-269` (accept-offer → SOW creation share-token mint),
  `:420-470` (`POST /msp/sows` manual SOW creation, same mint shape), `:594-598`
  (`signSowSchema`), `:750-888` (both public routes)
- `lib/db/src/schema/index.ts` — `liveDocumentSharesTable` (`:1015`, plus its own
  preceding design-decision comment block `:1005-1014`), `quickWinResultSharesTable`
  (`:2787`)
- `lib/db/src/schema/msp.ts` — `mspSowsTable` (`:3424`), `MSP_SOW_STATUSES` (`:3421`)
- `artifacts/api-server/src/routes/public-rbd-document.ts` — read in full, for the
  Cross-surface edges note in §6 only; it is a different Feature's (#1487) public
  share-and-sign pair, not part of #1663
- `docs/documents-contract-pack.md` §2c–2e — cited, not re-derived, for §1

---

## 1. Wire contract — `GET /api/public/documents/:shareToken` (condensed; full contract in `docs/documents-contract-pack.md` §2c–2e)

No auth — gated entirely by knowledge of the token. 400 if the token param is empty. 404
if no `quick_win_result_shares` row matches `(shareToken, shareKind="document")`, or if
it matches but `documentId` is null. 410 if `now() > expiresAt`. On success, response is
`{ title, htmlContent, docType, expiresAt }` — `htmlContent` run through
`stripStagedForReviewBanner()` only (`portal-documents.ts:336`). Side effects (both
fire-and-forget, failures swallowed): `quick_win_result_shares.viewCount` incremented,
a `presentation_doc_views` row inserted with `presentationId: null`, `eventType: "view"`
(`:322-332`).

`POST /api/public/documents/:shareToken/doc-views` — same token lookup/expiry gate, body
`{ dwellSeconds: number }` (400 if missing or negative), inserts a second
`presentation_doc_views` row with `eventType` presumably `"dwell"` (see
`docs/documents-contract-pack.md` §2e for the exact field — not re-derived here).

**Mint route** (`POST /api/portal/documents/:id/share`, `requireAuth`,
`portal-documents.ts:222`): sibling-bridged ownership (`resolveSiblingUserIds()`), status
gate `"approved" | "delivered"` or `docType === "scoped_sow"`, deletes any existing share
for *this* document (not per-client) before minting, 30-day expiry, response
`{ shareUrl, expiresAt }` where `shareUrl = {getMspPortalBaseUrl()}/shared-documents/{shareToken}`.

---

## 2. Wire contract — `GET /api/public/live-document-shares/:token`

**No auth** — the token itself is the credential (`live-document-shares.ts:180`, file
header `:15-22`). 400 if the token param is empty. 404
`{ error: "This link doesn't exist or has been removed" }` if no
`live_document_shares` row matches. 410 `{ error: "This link has been revoked" }` if
`revokedAt` is set. **No expiry check** — this table has no `expiresAt` column at all
(`index.ts:1015-1022`), by deliberate design documented in the schema's own preceding
comment (`:1005-1014`): a share is handed to someone for a purchasing approval that "can
take weeks," and `revokedAt` — a manual action, nothing in this codebase sets it
automatically — is the only real control.

Two response shapes depending on `share.variant` (`"review" | "purchasing"`, set at mint
time, immutable after):

**`variant: "review"`** (`:255-257`):

| Field | Type | Source |
|---|---|---|
| `variant` | `"review"` | literal |
| `companyName` | `string \| null` | `tenants.customer_name` |
| `pillars` | `Pillar[]` | `buildPillarSummary(tenantsId)` — same helper the authenticated pillar dashboards use |
| `reports` | `Report[]` | 7 narrative sections (`copilot_readiness`, `security_posture_report`, `governance_maturity_report`, `compliance_alignment_report`, `license_optimization_report`, `adoption_report`, `operational_health_report`), each `{ docType, title, sections }` — generated live via the same 7 narrative generators the authenticated portal narrative routes call (`LIVE_DOCUMENT_SHARE_REPORTS`, `:104-121`); a generator failure is caught per-report and degrades to `sections: []`, not a request-level failure |

**`variant: "purchasing"`** — everything `"review"` returns, plus `offers`
(`:277-290`): `{ offers: OfferLine[], addons: Addon[] }` where `offers` is
`runSalesOfferEngineForTenant()`'s live candidate output re-shaped to match
`GET /portal/assessment/recommended-offers`'s own response assembly exactly (deliberate
duplication of ~15 lines of JSON-shaping, not of pricing logic — file header `:24-42`),
and `addons` is `[monitoringAddon, retainerAddon].filter(a => a !== null)` from the same
two resolvers (`resolveTenantMonitoringAddon`, `resolveArchitectRetainerAddon`) the
authenticated recommended-offers route calls.

**Caching**: a 5-minute in-process TTL cache (`shareContentCache`, keyed on
`{token}:narratives` / `{token}:offers`) sits in front of the narrative-generation and
offer-engine calls only — `pillars` itself is never cached, computed fresh every request
(`:229-230`). Deliberate, file-header-documented mitigation against metered Anthropic
narrative-generation cost on a link reachable by anyone who has it; explicitly **not** a
substitute for real persistent caching if this link is ever advertised more widely than
one-customer-forwards-to-one-reviewer (`:53-65`).

**Mint route** (`POST /portal/live-documents/share`, `requireAuth`,
`live-document-shares.ts:130`): body `{ variant: "review" | "purchasing" }`, 400 if
neither. `customerId` on the stored row is `req.user!.id` (a `users.id`, the logged-in
login sharing their own results) — **not** sibling-bridged, unlike the mint route in §1.
Response `{ shareUrl, token, variant, mspSlug }` where
`shareUrl = {getMspPortalBaseUrl()}/shared-live-documents/{token}`.

---

## 3. Wire contract — `GET /api/public/sows/:shareToken`

**No auth** (`msp-sow.ts:754`). Lookup by `eq(mspSowsTable.shareToken, shareToken)`. 404
`{ error: "SOW not found or link has expired" }` if no row matches (the message
deliberately doesn't distinguish "never existed" from "expired," matching the
no-ownership-leak pattern other packs' 404s already use). 410
`{ error: "This share link has expired" }` if `shareTokenExpiresAt` is set and past.

Response — **not** the raw `msp_sows` row (signature data withheld by explicit comment,
`:784`):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `sowId` | `string` (uuid) | not null | `msp_sows.sow_id` |
| `title` | `string` | not null | `.title` |
| `description` | `string \| null` | nullable | `.description` |
| `amountCents` | `number` | not null, default `0` | `.amount_cents` |
| `currency` | `string` | not null, default `"usd"` | `.currency` |
| `status` | `"draft" \| "sent" \| "signed" \| "paid" \| "failed" \| "expired"` | not null, default `"draft"` | `.status` (`MSP_SOW_STATUSES`, `msp.ts:3421`) |
| `documentHtml` | `string \| null` | nullable | `.document_html` |
| `expiresAt` | `string \| null` (ISO) | nullable | `.expires_at` — the SOW's own lifecycle expiry, **distinct from** `shareTokenExpiresAt` (checked separately above and never returned in the body) |
| `signedAt` | `string \| null` (ISO) | nullable | `.signed_at` |
| `signerName` | `string \| null` | nullable | `.signer_name` |
| `customerAgreementText` | `string \| null` | nullable | `.customer_agreement_snapshot_text` — an MSP-authored clickwrap snapshot embedded at SOW-creation time (`:245-254, 432-440`), not re-fetched live |

`signatureData` (base64 PNG) is selected in the query (`:771`) but deliberately never
placed in the response object — the same withholding pattern §7 of the
Offers-and-SOW-Acceptance pack documents for its own public presentation viewer.

---

## 4. Wire contract — `POST /api/public/sows/:shareToken/sign`

**No auth**, rate-limited (`publicSignLimiter`: 10 attempts / 15 min in production, 500 in
non-production — `:807-813`, the same limiter shape `public-rbd-document.ts` uses for its
own public sign route). Body: `signSowSchema` — `{ signerName: string (1-200 chars),
signatureData: string (min 10 chars, base64 PNG) }`, the identical schema the
**authenticated** `POST /msp/sows/:sowId/sign` route also uses (`:594-598`, shared, not
duplicated).

Guards, in order:
1. 404 if no row matches `shareToken`.
2. 410 if `shareTokenExpiresAt` is past.
3. 409 if `status` is not `"sent"` or `"draft"` — `"signed"`/`"paid"` get the specific
   message `"This SOW has already been signed"`; any other status (`"failed"`,
   `"expired"`) gets a generic `SOW cannot be signed in its current status: "<status>"`.
4. If `expiresAt` (the SOW's own lifecycle expiry, not the share-token expiry) is past:
   the row is updated to `status: "expired"` **as a side effect of this check itself**,
   then 410 `{ error: "This SOW has expired" }` — a caller that re-checks status after
   this 410 will see the write already landed.

On success (`:856-887`): writes `status: "signed"`, `signerName`, `signatureData`,
`signedAt: now()`, `signedIp` (from `x-forwarded-for` first, socket address fallback),
and re-extends `expiresAt` to `now() + 30 days` (a signed-but-unpaid SOW gets a fresh
30-day clock, distinct from the pre-sign expiry checked in guard 4). Emits
`emitSowEvent(..., "sow.signed", null, "customer_via_share_link", ...)` — actor is `null`
(no authenticated user), attribution recorded as the literal string
`"customer_via_share_link"` rather than a real user id, the honest signal that this
happened outside any login. Also emits `emitMspEvent(..., "msp.sow.signed", ...,
{ viaShareLink: true })`. Fire-and-forget: `triggerMspCharge(sow.sowId, sow.mspId,
sow.amountCents, null)` — a failure here is logged as a warning and never surfaces to the
caller; the SOW stays `"signed"` regardless of whether the MSP's card charge succeeded,
identical in shape to the Offers pack §3's `fulfillAcceptedProjectOffer()` fire-and-forget
pattern.

Response: `{ ok: true, status: "signed" }`.

**Where the share token and SOW row come from**: two authenticated MSP-side mint paths —
`POST /msp/offers/:offerId/accept` (branch for `serviceClass = "project"` offers,
`:230-269`) and `POST /msp/sows` (manual creation, `requireRole("MSPOperator")`,
`:420-470`) — both call the same `generateShareToken()` (`randomBytes(24).toString("hex")`,
`:76-77`) and set a 30-day `shareTokenExpiresAt` at creation time, before the SOW is ever
sent or signed. Neither mint path is in #2453's named list; noted here only to establish
where a real, live `shareToken` originates.

---

## 5. Findings

No new findings filed. §1's condensed contract and the `:id` → `:shareToken`/`:token`
param-name mismatch (Step 1 result, above) are both real, current facts about this
Feature's endpoints, not defects — the issue's own body already anticipated that the old
portal-v2 endpoint list "may have moved, changed, or orphaned"; a mismatched path param
name is exactly that kind of drift, documented honestly rather than silently corrected in
this pack's own endpoint list.

---

## 6. Honest-empty / partial-data contract

- **`GET /api/public/documents/:shareToken`**: no "genuinely empty" state — a missing or
  expired token is 404/410, not an empty body (see `docs/documents-contract-pack.md`
  §2d for the full derivation).
- **`GET /api/public/live-document-shares/:token`**: `pillars`/`reports` are always
  populated when the route returns 200 (a real tenant with real scan data backs every
  live share) — a per-report *generation failure* degrades that one report to
  `sections: []` rather than failing the whole response (`:237-239`); this is the
  route's real partial-failure state, not a fixture fallback. `offers`/`addons` under
  `"purchasing"` can legitimately be `{ offers: [], addons: [] }` if the sales-offer
  engine and both add-on resolvers genuinely find nothing to recommend for this tenant —
  a real empty state, not an error.
- **`GET /api/public/sows/:shareToken`**: no genuinely-empty state — a nonexistent or
  expired share token is 404/410; a SOW that exists is fully populated at creation time
  (`documentHtml` is generated synchronously in the same mint call, `:262-269, 446-452`),
  so there is no "SOW exists but document not ready yet" partial state on this route,
  unlike `public-rbd-document.ts`'s "not yet prepared" 404 for the same concept on a
  different Feature.

---

## 7. Cross-surface edges

- **`docs/documents-contract-pack.md` §2c–2e** — same two `public/documents` routes,
  already fully documented there under the Documents Feature; §1 above cross-references
  rather than duplicates.
- **`docs/offers-and-sow-acceptance-contract-pack.md`** — that pack's §5–§7 document the
  *authenticated* Quick Win presentation SOW-signing flow
  (`GET /portal/presentations/:id`, `/sow-document`, `POST /sign`), a parallel but
  structurally separate SOW-signing surface from this pack's §3–§4
  (`msp_sows` table, MSP-billing-model SOWs) — the two tables (`quick_win_presentations`
  vs `msp_sows`) are not the same signing flow and do not share rows. Design should treat
  "Offers and SOW Acceptance" and "Public Share Pages" as two genuinely different SOW
  concepts in this codebase, not two views onto one.
- **`public-rbd-document.ts`** (`GET`/`POST /api/public/rbd/:shareToken[/sign]`) — the
  same unauthenticated share-token-viewer-plus-sign shape as this pack's §3–§4, for a
  different document type (RBD versions) under a different Feature (#1487). Not part of
  #1663's named endpoint list; noted only because a reader of this pack comparing public
  share routes across the codebase should know a third instance of this pattern exists.
- **`insights_generated_documents`** — §1's `public/documents/:shareToken` reads this
  table (via `quick_win_result_shares.documentId`), the same table
  `docs/documents-contract-pack.md` and `docs/customer-home-and-timeline-contract-pack.md`
  both already document from their own authenticated routes.

---

## Orphaned-endpoint check

```
grep -rln "public/documents\|public/live-document-shares\|public/sows\|shared-documents\|shared-live-documents\|shared-sow" artifacts/portal/src artifacts/msp-website artifacts/shane-mccaw-consulting
```

Real result: **zero matches** in any of the three current frontend trees. The new
`artifacts/portal` scaffold (#1485) has no page for any of these 3 routes yet — no
`Design/portal/` export exists for Public Share Pages either. `artifacts/admin-panel`
references the `shareUrl` shape twice (`adminv2/screens/shared-links/sharedLinksTypes.ts:103`,
`pages/crm/DiagnosticShares.tsx:121`) but only to **construct and display** a
`/portal/shared-documents/{shareToken}` URL for an MSP operator to copy/send — neither
file calls any of this pack's endpoints itself; the actual `GET` happens only when
whoever receives that URL opens it in a browser, on a page that does not yet exist. The
retired portal-v2 was the only prior renderer of these routes (retired 2026-08-29, same
as every other pack under #1485 has found). Design should build against these 5 real,
live, currently-unexercised endpoints (3 named + 2 pulled-in siblings), not treat the
absence of a live caller as evidence something is broken.

---

## Not covered by this pack

Per #2453 Step 3, no page/UI-shape decisions are made here. The two authenticated mint
routes (`POST /portal/documents/:id/share`, `POST /portal/live-documents/share`) and the
two authenticated `msp_sows`-creation routes (`POST /msp/offers/:offerId/accept`,
`POST /msp/sows`) are documented only to the extent needed to establish where each
public route's underlying row and token originate — their own full request/response
contracts belong to whichever Feature actually owns the authenticated portal/MSP-operator
surface, not this one. `public-rbd-document.ts` (§7) is out of scope entirely — it
belongs to Feature #1487.
