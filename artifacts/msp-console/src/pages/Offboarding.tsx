/**
 * Offboarding (Operations, MSP-wide) — Git #2636.
 *
 * Built against `Design/MSP_Console/design_handoff_msp_console/Offboarding.dc.html`
 * (screen 45) and the real routes in `artifacts/api-server/src/routes/msp-portal.ts`
 * (`docs/msp-console/offboarding-msp-console-contract-pack.md` is the full extraction):
 *
 *   GET  /api/msp/dashboard              — `msp.offboardingState` / `offboardingRequestedAt` /
 *                                           `exportReadyAt` / `status` fields only (pack §1)
 *   POST /api/msp/offboarding/request    — null → cancellation_requested (§2, MSPAdmin)
 *   POST /api/msp/offboarding/export     — cancellation_requested → export_ready (§3, MSPAdmin)
 *   POST /api/msp/offboarding/archive    — export_ready → archival_flagged (§4, PlatformAdmin)
 *
 * One MSP-scoped state machine, forward-only — no route resets `offboardingState`
 * (pack §0). The export step never verifies cancellation actually happened; the
 * step sequence below is enforced by this screen, not the server. Archival
 * suspends the MSP with the same `status` value non-payment produces — real and
 * correct, not a distinct visual state the backend can't represent.
 *
 * The export package itself is never returned by a GET — it only comes back on
 * the `/export` POST response (fresh, real data, every call). This page holds it
 * in local component state rather than fetching it eagerly on mount, so no
 * unrequested side-effecting call is ever made just to paint the screen; the
 * operator sees it once they've actually generated (or regenerated) it in this
 * session, same as the design's own state model.
 */
import { useState } from "react";
import type { MspUserProfile } from "@workspace/api-client-react";
import {
  useArchiveMsp, useGenerateExport, useOffboardingStatus, useRequestOffboarding,
  type OffboardingExportPackage, type OffboardingState,
} from "@/api/offboarding-api";
import { border, signal, text } from "@/console/tokens";

type Tone = { strong: string; text?: string; tint: string; border: string };

const ORDER: OffboardingState[] = [null, "cancellation_requested", "export_ready", "archival_flagged"];

function fmt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const fg = tone.text ?? tone.strong;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999,
      background: tone.tint, border: `1px solid ${tone.border}`, fontSize: 10.5, fontWeight: 600, color: fg,
    }}>
      {children}
    </span>
  );
}

// ── Stepper ───────────────────────────────────────────────────────────────────

interface StepDef { n: string; title: string; body: string; who: string; }

const STEP_DEFS: StepDef[] = [
  { n: "1", title: "Nothing requested", body: "The default. No offboarding is under way and every customer is served as normal.", who: "READ BY ANY OPERATOR" },
  { n: "2", title: "Cancellation requested", body: "The MSP has said it is leaving. Nothing is switched off by this step.", who: "MSP ADMIN" },
  { n: "3", title: "Export ready", body: "A full data package for every customer has been generated and can be handed over.", who: "MSP ADMIN" },
  { n: "4", title: "Archival flagged", body: "The platform confirms the exit. The MSP is suspended and the record retained.", who: "PLATFORM ADMIN" },
];

function Stepper({ v, requestedAt, exportReadyAt, archivedAt }: {
  v: OffboardingState; requestedAt: string | null; exportReadyAt: string | null; archivedAt: string | null;
}) {
  const idx = ORDER.indexOf(v);
  const stamps = [
    v === null ? "Current state" : "Passed",
    requestedAt ? `Recorded ${fmt(requestedAt)}` : "Not yet",
    exportReadyAt ? `Recorded ${fmt(exportReadyAt)}` : "Not yet",
    archivedAt ? `Recorded ${fmt(archivedAt)}` : v === "archival_flagged" ? "Recorded" : "Not yet",
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
      {STEP_DEFS.map((s, i) => {
        const done = i < idx + 1;
        const isNow = i === idx;
        const tone: Tone = i === 3 && isNow ? signal.critical : isNow ? signal.warning : done ? signal.ok : signal.neutral;
        const dotFg = isNow ? (tone.text ?? tone.strong) : done ? signal.ok.strong : text.muted;
        return (
          <div key={s.n} style={{
            border: `1px solid ${isNow ? tone.border : "rgba(148,163,184,.14)"}`, borderRadius: 12,
            background: isNow ? "rgba(15,23,42,.75)" : "rgba(15,23,42,.5)", padding: 14,
            display: "flex", flexDirection: "column", gap: 7,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{
                width: 22, height: 22, borderRadius: 999, flex: "none",
                background: isNow ? tone.tint : done ? signal.ok.tint : "rgba(148,163,184,.06)",
                border: `1px solid ${isNow ? tone.border : done ? signal.ok.border : "rgba(148,163,184,.18)"}`,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 10.5, fontWeight: 700, color: dotFg,
              }}>{s.n}</span>
              <span style={{ fontSize: 12, fontWeight: 700, flex: 1, minWidth: 80, color: isNow ? text.strong : done ? text.secondary : text.muted }}>{s.title}</span>
            </div>
            <span style={{ fontSize: 11, color: text.muted }}>{s.body}</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: isNow ? (tone.text ?? tone.strong) : done ? signal.ok.strong : text.muted }}>{stamps[i]}</span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: text.muted }}>{s.who}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Action card ───────────────────────────────────────────────────────────────

interface ActionDef { title: string; sub: string; warnTitle: string; warnText: string; btn: string; tone: Tone; }

function actionFor(v: OffboardingState, isPlatform: boolean): ActionDef {
  if (v === null) {
    return {
      title: "Request cancellation",
      sub: "The first and only step available from here.",
      warnTitle: "This starts a process with no way back",
      warnText: "There is no undo. Once recorded, the state can only move forward through export and archival — no route in the system returns this MSP to normal, so a mistaken click has to be resolved by someone outside this product.",
      btn: "Request cancellation", tone: signal.warning,
    };
  }
  if (v === "cancellation_requested") {
    return {
      title: "Generate the export",
      sub: "Build the handover package for every customer under this MSP.",
      warnTitle: "Nothing is deleted by this step",
      warnText: "The package is generated from live data and the state advances. Customers keep working normally — this is the handover material, not a shutdown.",
      btn: "Generate export package", tone: signal.info,
    };
  }
  if (v === "export_ready") {
    return {
      title: "Confirm archival",
      sub: isPlatform ? "The platform's own confirmation, for this specific MSP." : "Only the platform can take this step.",
      warnTitle: "Archival suspends the MSP",
      warnText: "Confirming sets the state to archived and the MSP's status to suspended in the same call. The record is kept rather than deleted, and the step cannot be skipped — archival is refused from any state but this one.",
      btn: "Confirm archival", tone: signal.critical,
    };
  }
  return {
    title: "Archived",
    sub: "Terminal. There is nothing further to do here.",
    warnTitle: "The end of the line",
    warnText: "No route reopens an archived MSP. Repeating the archival call simply reports success again.",
    btn: "Already archived", tone: signal.neutral,
  };
}

interface ResultBanner { code: string; text: string; tone: Tone; }

const NOTES: { dot: string; text: string }[] = [
  { dot: signal.critical.strong, text: "Nothing resets this state. Once cancellation is recorded, no route in the system returns the MSP to normal — which is why the first step carries the heaviest warning on the screen rather than a quiet confirm." },
  { dot: signal.critical.strong, text: "The export step does not verify that cancellation was ever requested. It refuses only an already-archived MSP, so it would run from the untouched state too — the sequence is enforced here, not by the route." },
  { dot: signal.critical.strong, text: "Archival sets the MSP's status to suspended, the same value non-payment produces. Any screen showing status alone cannot tell an archived MSP from a delinquent one; the offboarding state is the only thing that disambiguates." },
  { dot: signal.warning.strong, text: "Archival is the one action taken by the platform rather than the MSP, and the one that names its target explicitly rather than reading it from the session — so it must always be tied to the MSP actually on screen." },
  { dot: signal.warning.strong, text: "Re-requesting cancellation is a conflict, re-exporting silently succeeds without a second audit row, and re-archiving reports success. Three steps, three different repeat behaviours — the copy has to set the right expectation each time." },
  { dot: signal.warning.strong, text: "Only the first export is recorded in the audit trail. Later regenerations leave no trace, so the log cannot answer how many times a customer's data was exported." },
  { dot: signal.info.strong, text: "There is no MSP-to-MSP transfer. The package is the entire handover, and its fixed notice tells the customer to re-onboard elsewhere themselves." },
  { dot: signal.info.strong, text: "The MSP record is retained, never deleted. Nothing in this surface removes rows, so an archived MSP stays visible to the platform afterwards." },
  { dot: text.muted, text: "The current state is one field on a much larger dashboard response, not its own endpoint — a screen that needs only this has to read the whole payload." },
  { dot: text.muted, text: "Two of the three lifecycle events land in the event feed without a real severity because the feed matches on a prefix none of them carry. An events view would show them as routine information." },
];

function ExportPackageCard({ pkg, onRegenerate, regenerating }: {
  pkg: OffboardingExportPackage; onRegenerate: () => void; regenerating: boolean;
}) {
  const summary = [
    { label: "CUSTOMERS", value: String(pkg.summary.totalCustomers) },
    { label: "ACTIVE", value: String(pkg.summary.activeCustomers) },
    { label: "EVENTS", value: String(pkg.summary.totalEvents) },
  ];
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: "rgba(15,23,42,.6)", padding: 16, display: "flex", flexDirection: "column", gap: 13 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 160, flex: 1 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong }}>The export package</span>
          <span style={{ fontSize: 11, color: text.muted }}>Generated {fmt(pkg.exportedAt)} · version {pkg.exportVersion}</span>
        </span>
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          style={{ height: 30, padding: "0 12px", borderRadius: 6, border: `1px solid ${border.card}`, background: "rgba(148,163,184,.06)", color: text.secondary, fontSize: 12, fontWeight: 600, cursor: regenerating ? "wait" : "pointer" }}
        >
          {regenerating ? "Regenerating…" : "Regenerate"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {summary.map((s) => (
          <div key={s.label} style={{ border: "1px solid rgba(148,163,184,.14)", borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>{s.label}</span>
            <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.02em", color: text.strong }}>{s.value}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>CUSTOMERS IN THE PACKAGE</span>
        {pkg.customers.length === 0 && <span style={{ fontSize: 12, color: text.faint }}>No customers under this MSP.</span>}
        {pkg.customers.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap", borderBottom: "1px solid rgba(148,163,184,.1)", paddingBottom: 7 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: text.strong, flex: 1, minWidth: 130 }}>{c.name}</span>
            <span style={{ fontSize: 10.5, fontFamily: "Menlo, monospace", color: text.muted }}>{c.tenantId ?? "—"}</span>
            <span style={{ fontSize: 11, color: c.eventCount === 0 ? text.muted : text.secondary }}>
              {c.eventCount === 0 ? "no events recorded" : `${c.eventCount} events`}
            </span>
          </div>
        ))}
      </div>

      <div style={{ border: "1px solid rgba(96,165,250,.24)", borderRadius: 10, background: "rgba(96,165,250,.07)", padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: signal.info.strong }}>What the package tells the customer</span>
        <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55 }}>{pkg.notice}</span>
      </div>

      <span style={{ fontSize: 11, color: text.muted, borderTop: "1px solid rgba(148,163,184,.12)", paddingTop: 11 }}>
        Regenerating gives a fresh package from current data — never a cached copy — but only the first generation is recorded in the audit trail. Later downloads leave no trace, which keeps the log clean and means the log cannot tell you how many times this data left the building.
      </span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function OffboardingPage({ profile }: { profile: MspUserProfile }) {
  const statusQuery = useOffboardingStatus();
  const requestMutation = useRequestOffboarding();
  const exportMutation = useGenerateExport();
  const archiveMutation = useArchiveMsp();

  const [exportPackage, setExportPackage] = useState<OffboardingExportPackage | null>(null);
  const [archivedAtLocal, setArchivedAtLocal] = useState<string | null>(null);
  const [result, setResult] = useState<ResultBanner | null>(null);

  const isPlatform = profile.mspRole === "PlatformAdmin";

  if (statusQuery.isLoading) {
    return <div style={{ padding: 20, fontSize: 12.5, color: text.muted }}>Loading offboarding state…</div>;
  }
  if (statusQuery.isError) {
    return <div style={{ padding: 20, fontSize: 12.5, color: signal.critical.text }}>Failed to load: {statusQuery.error.message}</div>;
  }

  const status = statusQuery.data!;
  const v = status.offboardingState;
  const action = actionFor(v, isPlatform);
  const canAct = v !== "archival_flagged" && !(v === "export_ready" && !isPlatform);
  const busy = requestMutation.isPending || exportMutation.isPending || archiveMutation.isPending;

  const act = () => {
    if (v === null) {
      requestMutation.mutate(undefined, {
        onSuccess: () => setResult({
          code: "200 · cancellation_requested",
          text: "Recorded, with an event and an audit row naming you. Asking again now answers with a conflict rather than doing nothing quietly — and there is no route that puts this back.",
          tone: signal.warning,
        }),
        onError: (err) => setResult({ code: `${(err as { status?: number }).status ?? "error"}`, text: err.message, tone: signal.critical }),
      });
      return;
    }
    if (v === "cancellation_requested") {
      exportMutation.mutate(undefined, {
        onSuccess: (data) => {
          setExportPackage(data.export);
          setResult({
            code: "200 · export_ready",
            text: "The package was built from live data and the state advanced. Worth knowing: this route does not actually check that the cancellation step happened — it refuses only an already-archived MSP, so it would have run straight from the beginning too.",
            tone: signal.info,
          });
        },
        onError: (err) => setResult({ code: `${(err as { status?: number }).status ?? "error"}`, text: err.message, tone: signal.critical }),
      });
      return;
    }
    if (v === "export_ready") {
      if (!isPlatform) return; // button disabled; the gate banner below already explains why
      const targetMspId = status.mspId ?? profile.mspId ?? null;
      if (targetMspId == null) {
        setResult({ code: "error", text: "No MSP id resolved for this session — cannot confirm archival.", tone: signal.critical });
        return;
      }
      archiveMutation.mutate({ mspId: targetMspId }, {
        onSuccess: (data) => {
          if (!data.alreadyArchived) setArchivedAtLocal((data as { archivedAt: string }).archivedAt);
          setResult({
            code: data.alreadyArchived ? "200 · alreadyArchived: true" : "200 · archival_flagged",
            text: data.alreadyArchived
              ? "Nothing left to do. This last step is genuinely repeatable — it reports success rather than a conflict — but the state is terminal either way."
              : "Archived. The MSP's status was also set to suspended and the record kept rather than deleted. Calling this again is a no-op that reports success, unlike the first two steps.",
            tone: signal.critical,
          });
        },
        onError: (err) => setResult({ code: `${(err as { status?: number }).status ?? "error"}`, text: err.message, tone: signal.critical }),
      });
    }
  };

  const regenerate = () => {
    exportMutation.mutate(undefined, {
      onSuccess: (data) => {
        setExportPackage(data.export);
        setResult({
          code: "200 · fresh package",
          text: "Regenerated from current data. No second audit row was written, because only the first generation records the state advance.",
          tone: signal.neutral,
        });
      },
      onError: (err) => setResult({ code: `${(err as { status?: number }).status ?? "error"}`, text: err.message, tone: signal.critical }),
    });
  };

  const facts = [
    { label: "OFFBOARDING STATE", value: v === null ? "none — the real default" : v.replace(/_/g, " "), color: v === null ? text.muted : (v === "archival_flagged" ? signal.critical.strong : v === "export_ready" ? signal.info.strong : signal.warning.strong) },
    { label: "REQUESTED", value: status.offboardingRequestedAt ? fmt(status.offboardingRequestedAt) : "—", color: status.offboardingRequestedAt ? text.strong : text.muted },
    { label: "EXPORT READY", value: status.exportReadyAt ? fmt(status.exportReadyAt) : "—", color: status.exportReadyAt ? text.strong : text.muted },
    { label: "MSP STATUS", value: status.status, color: status.status === "suspended" ? signal.warning.strong : signal.ok.strong },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ border: "1px solid rgba(248,113,113,.28)", borderRadius: 12, background: "rgba(248,113,113,.07)", padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: signal.critical.strong }}>This is the whole MSP, and it only runs one way</span>
        <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55 }}>
          Every customer under this MSP is in scope, not one account. No route anywhere resets the state once it is set — there is no cancel-the-cancellation, no undo and no route back to the beginning. A separate, customer-facing action lets a single customer close their own account; it shares the word offboarding and nothing else.
        </span>
      </div>

      <Stepper v={v} requestedAt={status.offboardingRequestedAt} exportReadyAt={status.exportReadyAt} archivedAt={archivedAtLocal} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
        {/* The one action available now */}
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: "rgba(15,23,42,.6)", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 170, flex: 1 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: text.strong }}>{action.title}</span>
              <span style={{ fontSize: 11.5, color: text.muted }}>{action.sub}</span>
            </span>
            <Pill tone={v === null ? signal.neutral : v === "archival_flagged" ? signal.critical : v === "export_ready" ? signal.info : signal.warning}>
              {v === null ? "not started" : v.replace(/_/g, " ")}
            </Pill>
          </div>

          <div style={{ border: `1px solid ${action.tone.border}`, borderRadius: 10, background: action.tone.tint, padding: 13, display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: action.tone.text ?? action.tone.strong }}>{action.warnTitle}</span>
            <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55 }}>{action.warnText}</span>
            <button
              onClick={act}
              disabled={!canAct || busy}
              style={{
                alignSelf: "flex-start", height: 34, padding: "0 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 600,
                border: `1px solid ${canAct ? (v === "export_ready" ? "rgba(248,113,113,.4)" : "#2563eb") : "rgba(148,163,184,.14)"}`,
                background: canAct ? (v === "export_ready" ? "rgba(248,113,113,.14)" : "#2563eb") : "rgba(148,163,184,.04)",
                color: canAct ? (v === "export_ready" ? "#f87171" : "#fff") : text.muted,
                cursor: !canAct ? "not-allowed" : busy ? "wait" : "pointer",
              }}
            >
              {busy ? "Working…" : action.btn}
            </button>
            {v === "export_ready" && !isPlatform && (
              <span style={{ fontSize: 11, color: signal.warning.text }}>
                You are signed in as an MSP admin, so this is refused. Confirming archival requires a PlatformAdmin session.
              </span>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, borderTop: "1px solid rgba(148,163,184,.12)", paddingTop: 13 }}>
            {facts.map((f) => (
              <span key={f.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>{f.label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: f.color }}>{f.value}</span>
              </span>
            ))}
          </div>

          {v === "archival_flagged" && (
            <div style={{ border: "1px solid rgba(251,191,36,.3)", borderRadius: 10, background: "rgba(251,191,36,.08)", padding: 13, display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: signal.warning.strong }}>Archived reads as suspended everywhere else</span>
              <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55 }}>
                Archiving also sets the MSP's status to suspended — the same value non-payment produces. Anywhere that shows status alone, an archived MSP and one suspended for an unpaid invoice are indistinguishable; only the offboarding state tells them apart. The record itself is kept, never deleted.
              </span>
            </div>
          )}

          {result && (
            <div style={{ border: `1px solid ${result.tone.border}`, borderRadius: 10, background: result.tone.tint, padding: 13, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "Menlo, monospace", color: result.tone.text ?? result.tone.strong }}>{result.code}</span>
              <span style={{ fontSize: 12, color: text.secondary }}>{result.text}</span>
            </div>
          )}
        </div>

        {/* The export package + notes */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {exportPackage && <ExportPackageCard pkg={exportPackage} onRegenerate={regenerate} regenerating={exportMutation.isPending} />}

          <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: "rgba(15,23,42,.6)", padding: 16, display: "flex", flexDirection: "column", gap: 11 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: text.strong }}>What these routes do and don't give this screen</span>
            {NOTES.map((n, i) => (
              <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: n.dot, marginTop: 6, flex: "none" }} />
                <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55 }}>{n.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
