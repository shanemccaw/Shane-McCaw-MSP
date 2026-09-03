# Scan Progress SSE — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line against
the code on `main`.** Read-only build: no product code, no schema, no UI were changed to produce
this document.

Module: **Scan Progress SSE** (leaf issue #2520, parented under Application Core #1096 — this is
a shared engine-layer capability underneath Shell, Mission Control, and the Assessment wizard, not
one page's property).

**This pack documents a live, fully-working backend mechanism with zero customer-facing callers in
the current `artifacts/portal`.** Every real client of this stream lived in retired portal-v2,
archived at tag `portal-archive-2026-08-29` — `MissionControl.tsx`,
`useAssessmentLiveStatus.ts`, `scan-status-context.tsx`. The only live consumer today is internal
tooling (`admin-panel`'s `SimulatorAssessmentCanvas.tsx`). This is the same orphaned-endpoint shape
documented elsewhere pre-Design/wire — not a defect. See §5.

---

## 0. What this is

A run-scoped Server-Sent Events stream that broadcasts real-time per-check progress for a
diagnostics/monitoring run (`msp_diagnostic_runs`), from "check N of total started" through the
run's terminal state (`completed` / `partial` / `failed`). It is the live mechanism sitting
alongside — not replacing — two polling GETs that report the same underlying run from a
lower-frequency, state-snapshot angle (§4).

---

## 1. Stream endpoint — wire contract

**`GET /api/msp/customers/:customerId/diagnostics/runs/:runId/sse`**
Source: `artifacts/api-server/src/routes/msp-diagnostics.ts:534-629`.

### 1a. Auth — query-string JWT, not header

`?jwt=<token>` (`:543-544`). Deliberate: browser `EventSource` cannot set custom headers, so this
route hand-verifies the JWT inline (`jwt.verify(token, jwtSecret)`, `:546-552`) rather than going
through the standard `requireAuth`/`requireRole` middleware every other route in this file uses.
401 if the param is missing or the token fails verification.

### 1b. Three real scoping paths (`:558-594`)

| Caller | Scope rule | Source |
|---|---|---|
| `CustomerUser` / `Assessment` role (customer/prospect) | `decoded.customerId` must equal the `:customerId` route param exactly, or **403** | `:559-568` |
| `MSPOperator` / `MSPAdmin` / `PlatformAdmin` | `assertCustomerBelongsToMsp(customerId, userMspId)` + `isCustomerBlockedByStaffScope` — a per-staff-scoped operator gets **404, not 403**, on a customer outside their assigned set, deliberately, so the blocked response never reveals the run exists | `:569-593` |
| `decoded.role === "admin"` | Bypasses all of the above (`isAdmin` short-circuit at `:556-558`) | `:556` |

The `CustomerUser`/`Assessment` branch is what both the retired portal-v2 consumers and any future
portal wiring use — `Assessment` covers the assessment-wizard's live deep-scan step, `CustomerUser`
covers the full-portal Mission Control scan-progress strip, per the route's own comment (`:562-564`).

Because the MSP-staff auth path can't reuse the shared `assertCustomerAccess` helper (no `req.user`
on a query-JWT-only route), it hand-rebuilds a minimal `AuthUser` from the verified claims
(`:582-589`) to call `isCustomerBlockedByStaffScope`.

### 1c. Run existence check (`:596-606`)

Before opening the stream, the route re-verifies the run row exists for that `customerId` —
**404** (`{ error: "Run not found" }`) if not. This is the same predicate the picker/history routes
use (`runId` + `customerId` composite), so a `runId` valid for a different customer 404s here too,
not just at auth.

### 1d. Stream open — headers + heartbeat (`:608-622`)

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```
`res.flushHeaders()` immediately, then `registerDiagnosticsRunSSEClient(runId, res, onClose)`
(§2). A 25-second heartbeat comment (`: heartbeat\n\n`) fires on an interval to keep intermediary
proxies from closing an idle connection; the interval is cleared on `res.on("close", ...)`.

### 1e. What a client sees on connect (late-join replay)

`registerDiagnosticsRunSSEClient` registers with `replayOnConnect = true`
(`sse-channels.ts:166` — see §2). A client that connects **after** the run has already emitted
progress (a real, common race — progress can fire within milliseconds of the run starting, often
before the browser has opened its `EventSource`) immediately receives the single most-recently
cached event for that `runId`, not the full history. A client that connects after the run has
already **completed or errored** receives that terminal event as its very first message — it never
sees any of the intermediate `diagnostics_progress` events that preceded it, because only the
*last* event per key is cached (`sse-hub.ts`'s `lastStateCache`, one entry per key, overwritten on
every broadcast — `:18,145`).

### 1f. What a client sees on run completion / error

The cached replay state is explicitly cleared the moment a run reaches either terminal outcome —
`clearDiagnosticsRunSSEState(runId)` is called from **both** the success path
(`diagnostics-runner.ts:1078`, right after `broadcastDiagnosticsRunComplete` at `:1067`) and the
failure path (`diagnostics-runner.ts:1181`, right after `broadcastDiagnosticsRunError` at `:1180`).
A client that connects
to a `runId` whose run finished and had its cache cleared receives **nothing on connect** — no
replay, no error — until/unless a *new* run starts under a different `runId`. This is a real gap a
consumer must design around: **the SSE stream alone cannot tell a late-arriving client "this run
already finished, here's how it ended"** once the cache window has closed. §4 covers how the
polling endpoints fill that gap.

### 1g. What a client sees on disconnect

`res.on("close")` fires `registerDiagnosticsRunSSEClient`'s own `onClose` callback
(logs `"diagnostics SSE client disconnected"`, `msp-diagnostics.ts:615`) and clears the heartbeat
interval. There is no server-initiated close on run completion — the client (all three real
consumers, current and archived) is responsible for calling `es.close()` itself once it receives a
`diagnostics_complete` or `diagnostics_error` frame (see `SimulatorAssessmentCanvas.tsx:308,323`,
§3).

---

## 2. Emit side — channel, registration, and broadcast functions

Source: `artifacts/api-server/src/lib/sse-channels.ts:162-207`, backed by the generic hub in
`artifacts/api-server/src/lib/sse-hub.ts`.

**Channel:** `"engine.monitor"`. **Scope key:** `runId` (a UUID string).

```ts
registerDiagnosticsRunSSEClient(runId: string, res: Response, onClose: () => void): void
// → registerHubClient("engine.monitor", runId, res, onClose, /* replayOnConnect */ true)

broadcastDiagnosticsRunProgress(runId: string, data: { checkKey, checkLabel, status, index,
  total, requiresCustomerScript, errorMessage?, severityMatched?, severityLabel? }): void
// → broadcastToHubWithReplay("engine.monitor", runId, { type: "diagnostics_progress", ...data })

broadcastDiagnosticsRunComplete(runId: string, data: { status, checksTotal, checksOk,
  checksError, requiresScript, findings }): void
// → broadcastToHubWithReplay("engine.monitor", runId, { type: "diagnostics_complete", ...data })

broadcastDiagnosticsRunError(runId: string, message: string): void
// → broadcastToHubWithReplay("engine.monitor", runId, { type: "diagnostics_error", message })

clearDiagnosticsRunSSEState(runId: string): void
// → clearHubReplayState("engine.monitor", runId)
```

All three broadcast functions use `broadcastToHubWithReplay` (`sse-hub.ts:139-148`), which both
writes the SSE frame to every currently-registered client on that `runId` **and** overwrites
`lastStateCache`'s single entry for that key — this is what makes §1e/§1f true. Every frame on the
wire is a bare SSE `data:` line, JSON-encoded, no `event:` name — all three event shapes multiplex
onto the same stream and a consumer discriminates by the payload's own `type` field (§3).

`registerHubClient` (`sse-hub.ts:41-58`) is the shared low-level primitive behind every SSE channel
in this codebase (notifications, kanban, presentation pipelines, workflow runs, MSP engine events,
offer pipelines) — this stream is one scope-keyed instance of that same generic registry, not a
bespoke mechanism.

---

## 3. Event payload shapes

### 3a. `ProgressCallback` — the source type

Source: `artifacts/api-server/src/lib/monitor-executor.ts:422-448`. This is the callback signature
`executeMonitoringPackage` invokes once per check, synchronously as each check resolves:

```ts
export type ProgressCallback = (event: {
  checkKey: string;
  checkLabel: string;
  status: CheckResult["status"];      // "ok" | "error" | "requires_script" | "consent_revoked" | ...
  index: number;
  total: number;
  requiresCustomerScript: boolean;
  errorMessage?: string;
  /** Severity band this check's own severity_rules matched, if any (#245) — lets a live consumer
   *  classify a check's finding severity exactly as diagnostics-runner's classifyCheckSeverity
   *  will when it persists the run. */
  severityMatched?: string | null;
  /** The matched severity rule's already-interpolated finding sentence (#528) — carried
   *  alongside severityMatched so a live consumer can show the real finding text instead of the
   *  generic static check label. Absent when no rule matched — falls back to
   *  checkLabel/checkKey downstream (#418). */
  severityLabel?: string | null;
}) => void;
```

`severityMatched`/`severityLabel` are the load-bearing fields Design should know about: without
them, a live consumer can only render pass/fail per check — a check that returns `status: "ok"`
while its `severity_rules` still matched a real finding (a genuine, customer-relevant result) is
otherwise invisible until the run's findings are persisted at the very end. With them, a live
consumer (e.g. a "Top Discrepancies" panel) can show the real finding sentence **as the check
completes**, not after the whole run finishes.

### 3b. `diagnostics_progress`

Emitted once per check from `diagnostics-runner.ts:808-822`, inside `executeMonitoringPackage`'s
`onProgress` handler — the wire event is the `ProgressCallback` payload verbatim, wrapped with a
`type` discriminator:

```json
{ "type": "diagnostics_progress", "checkKey": "conditionalAccess:mfaRequired",
  "checkLabel": "Conditional Access requires MFA", "status": "error", "index": 3, "total": 22,
  "requiresCustomerScript": false, "errorMessage": null,
  "severityMatched": "critical", "severityLabel": "No Conditional Access policy requires MFA" }
```

### 3c. `diagnostics_complete`

Emitted once, from `diagnostics-runner.ts:1067-1074`, right after the run row is persisted as
`completed`/`partial`:

```ts
{ status: "completed" | "partial", checksTotal: number, checksOk: number, checksError: number,
  requiresScript: number, findings: number }
```
`status` here is the run's own `finalStatus` — never `"failed"` (that's a distinct event, §3d).
`findings` is the persisted `findingsCount` — the same number the run row's `summary.findingsCount`
carries.

### 3d. `diagnostics_error`

Emitted once, from `diagnostics-runner.ts:1180` (the run's outer `catch` block), when the run dies
before reaching a terminal `completed`/`partial` state (e.g. no M365 tenant connected — the
pre-flight throw at `:792-794` — or an unhandled exception mid-run):

```ts
{ message: string }  // errorMessage, truncated to 1000 chars before persisting to the run row
```
This is a **distinct outcome from a per-check `status: "error"`** inside `diagnostics_progress` —
individual checks failing is normal and still lets the run finish `partial`; `diagnostics_error` is
the whole run dying.

### 3e. Real client-side discrimination (the live consumer)

`artifacts/admin-panel/src/components/SimulatorAssessmentCanvas.tsx:298-337` is the one currently
live, wired consumer:

```ts
const es = new EventSource(
  `/api/msp/customers/${selectedCustomerId}/diagnostics/runs/${runId}/sse?jwt=${encodeURIComponent(accessToken)}`,
);
es.onmessage = (event) => {
  const parsed = JSON.parse(event.data) as DiagnosticsSSEEvent;
  if (parsed.type === "diagnostics_progress") {
    setProgress({ index: parsed.index, total: parsed.total });
    setLog((prev) => [...prev, { checkKey: parsed.checkKey, checkLabel: parsed.checkLabel, status: parsed.status }]);
  } else if (parsed.type === "diagnostics_complete") {
    es.close(); /* ...setPhase("complete"), setSummary(...), toast, reload findings+history */
  } else if (parsed.type === "diagnostics_error") {
    es.close(); /* ...setPhase("error"), setErrorMessage(parsed.message) */
  }
};
es.onerror = () => {
  es.close();
  if (phase !== "complete") { setPhase("error"); setErrorMessage((prev) => prev ?? "Live progress stream disconnected"); }
};
```

Real, load-bearing pattern for Design to draw against: a raw connection-level `onerror` (proxy
drop, network blip, server restart) is treated identically to a genuine `diagnostics_error`
frame — an honest "Live progress stream disconnected" state, distinct from the run's own reported
failure message, and only shown if the run hadn't already reached `"complete"` (so a transient
disconnect *after* the terminal event doesn't overwrite a real success with a false error).

---

## 4. Cross-reference — the two polling siblings covering the same run

The SSE stream is the **live-progress mechanism only**; two lower-frequency polling GETs report
state snapshots of the same `msp_diagnostic_runs` row from a different angle, and a full live
consumer combines all three. Both live in `artifacts/api-server/src/routes/portal-assessment.ts`.

### 4a. `GET /api/portal/scan-status` (`:954-1117`, `requireRole("Assessment")`)

Polled every 30-60s (or every 3s while a run is live, per the `scan-plan` route's own comment,
`:1144`) from the whole portal shell. Deliberately minimal — reads only the customer's latest
`msp_diagnostic_runs` row, not the full assessment-wizard payload. Real fields relevant to a live
progress UI:

```ts
{
  everScanned: boolean,
  lastScanAt: string | null,
  active: { runId, status, checksOk, checksError, checksLicenseGap, checksTotal, startedAt } | null,
  lastRunSummary: { runId, status, checksTotal, checksOk, checksError, checksLicenseGap,
                    startedAt, completedAt } | null,
  docWorkflow: { runId, status } | null,
  isTestbed: boolean, consentStatus, scopesStale, sharePointConsentStatus, sharePointPermissionsStale
}
```

This is exactly the fallback the SSE stream's §1f gap needs: `active` (a run in `ACTIVE_RUN_STATUSES`)
gives a client the `runId` to open/re-open an `EventSource` against, and `lastRunSummary` gives it
the terminal outcome of a run whose SSE replay cache has already been cleared — the two mechanisms
are meant to be read together, not as alternatives. `active` goes `null` the instant a run finishes
(`:1069`), which is precisely why `lastRunSummary` exists as a separate, always-present field
(`:1080-1086`'s own comment states this).

### 4b. `GET /api/portal/scan-plan` (`:1152-1194`, `requireRole("Assessment")`)

The real check **plan** — the ordered list of `checkKey`s the customer's latest run actually
executes, sourced from the same `loadOrderedPackageChecks(packageKey)` call the executor itself
iterates (so the plan can never drift from what `diagnostics_progress` events will actually emit).
Fetched once per `runId`, not polled continuously (`:1143-1145`'s comment: "the plan for a given
run never changes"). Exists because the per-check SSE stream alone can only say which checks
**have** reported — never how many a given pillar/grouping is still owed mid-scan (the #340 bug
this route fixed: a pillar with five real checks reading "done" after the first one reported).

```ts
{ runId: string | null, packageKey: string | null, checkKeys: string[] }
// { runId: null, packageKey: null, checkKeys: [] } when the customer has never scanned — a real,
// reportable state, not an error.
```

Grouping `checkKeys` into pillars is deliberately left to the client (the domain→pillar mapping
lives in `msp-portal`'s `warRoomScan.ts`, `WAR_ROOM_PILLAR_DOMAINS` — a second copy here would be
free to drift).

---

## 5. Real consumers — one live, three retired

### 5a. Live today

**`artifacts/admin-panel/src/components/SimulatorAssessmentCanvas.tsx`** — Simulator Studio's
Assessments node (internal MSP/admin tooling, not customer-facing). Full event handling quoted at
§3e. Also see the sibling generic admin stream `artifacts/admin-panel/src/hooks/useLiveStream.ts`
(`GET /api/admin/live-stream?channel=...`) — a **different**, unscoped firehose-style mechanism
(§2's `registerChannelFirehoseClient`/`registerFirehoseClient` in `sse-hub.ts`), not this run-scoped
stream; do not conflate the two when reading admin-panel code.

### 5b. Retired — archived at tag `portal-archive-2026-08-29`

All three lived under the retired portal-v2 and are **not** to be treated as a current baseline
(per this repo's standing rule — portal-v2 is retired, not a fallback target for new work). Cited
here only because their real, already-proven wiring is the pattern any new portal consumer should
follow, same discipline as any other archived-but-instructive code:

- `artifacts/msp-portal/src/lib/scan-status-context.tsx` — the shell-wide context both
  `ScanStatusIndicator` and the Assessment telemetry page's Scan step read; polls
  `/portal/scan-status`, and additionally opens the run-scoped SSE stream
  (`EventSource(".../diagnostics/runs/${streamRunId}/sse?jwt=...")`, its own comment at `:343,361`)
  when a run is active — the same combined poll+stream pattern described in §4a.
- `artifacts/msp-portal/src/components/assessment-test/useAssessmentLiveStatus.ts` — a direct
  mirror of `AssessmentWizard.tsx`'s already-verified two-phase progress model: scan maps to a
  0-50% combined `progressPercentage` (driven by this SSE stream's `index`/`total`), documents to
  50-100% (driven by a *separate* workflow-run SSE stream, `workflow.run-progress` channel — not
  this one). Real `AssessmentStatus.scan` shape: `{ active, runId, status, startedAt, checksTotal,
  checksOk, checksError, checksLicenseGap, licenseGapFeatures, lastScanAt, everScanned }` — a
  superset of `/portal/scan-status`'s `active`/`lastRunSummary` fields, assembled client-side.
- `artifacts/msp-portal/src/components/mission-control/MissionControl.tsx` — Mission Control's
  own scan-progress strip, the customer-facing surface this issue's own body names as the reason
  the stream exists ("the mechanism behind Shell's 'scan status and progress' component").

---

## 6. Findings from this pass (not fixed here — flagged only)

**#1817's own endpoint table is missing this route.** Portal Shell's Feature body lists only the
two polling GETs (`/portal/scan-status`, `/portal/scan-plan`) under "Scan" — this SSE stream is the
actual live-progress mechanism and isn't in that table. Filed as a sibling finding under #1096; see
the issue this pack's own build filed (linked in the #2520 completion comment). Not corrected here
per this issue's own instruction to flag, not silently fix, #1817.
