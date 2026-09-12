/**
 * Remediation — MSP Console module page (Git #2588, Feature #1684). Mounts
 * into the shell's `ScreenSlot` at `/tenants/:id/rem`
 * (`Design/MSP_Console/design_handoff_msp_console/Remediation.dc.html`,
 * README screen 6). Four tabs, faithful to the design's own logic class:
 *
 *   Tracker    — the s1-s30 catalogue, each step's claim + verification state.
 *   Checklist  — the current scan's real findings, one row per open item.
 *   Fix routes — the resolved shape per check (we_can_run / you_must_run /
 *                admin_center_only) and the CR-gated script reveal.
 *   Outside CR — the observational bypass-resolution correlation.
 *
 * Every row, tile and badge comes from the live routes in
 * `src/api/remediation-api.ts` — no fixture, no fabricated row. Where the
 * design's mock UI shows an affordance this build's real route surface
 * doesn't cover (arming a `we_can_run` fix is Change Control's own Executions
 * page, not this one), the card says so honestly instead of wiring a button
 * to nothing.
 */
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { surface, text, signal, action, border } from "@/console/tokens";
import {
  useAttachStepEvidence,
  useFixRoutes,
  useOpenEvidenceFile,
  usePillarScores,
  useRaiseChangeFromChecklistItem,
  useRemediationCatalogue,
  useRemediationChecklist,
  useRemediationExport,
  useRevealFix,
  useSetTrackerStep,
  useStepEvidence,
  useVerificationGuide,
  useVerifyTrackerStep,
  useBypassResolutions,
  type RemediationExportKind,
} from "@/api/remediation-api";
import {
  REMEDIATION_TRACKER_STEP_STATUS_WRITABLE,
  type CatalogueStep,
  type ChecklistItem,
  type FixRouteItem,
  type RemediationFixRoute,
  type RemediationTrackerStepStatus,
} from "@/api/remediation-types";

type Tab = "tracker" | "checklist" | "routes" | "bypass";

const TONE: Record<string, { strong: string; text: string; tint: string; border: string }> = {
  green: signal.ok,
  amber: signal.warning,
  red: signal.critical,
  blue: signal.info,
  violet: { strong: signal.notice.strong, text: "#ddd6fe", tint: signal.notice.tint, border: signal.notice.border },
  slate: { strong: signal.neutral.strong, text: text.muted, tint: signal.neutral.tint, border: signal.neutral.border },
};

const VERIFICATION_TONE: Record<string, keyof typeof TONE> = { verified: "green", drift: "amber", unverified: "slate" };
const VERIFICATION_ICON: Record<string, string> = { verified: "circle-check-big", drift: "triangle-alert", unverified: "circle-dashed" };
const TERMINAL_COLOR: Record<string, string> = { verified: signal.ok.text, accepted: "#c4b5fd", outstanding: signal.warning.text };
const SEVERITY_TONE: Record<string, keyof typeof TONE> = { critical: "red", warning: "amber" };
const FIX_ROUTE_TONE: Record<RemediationFixRoute, keyof typeof TONE> = {
  we_can_run: "blue",
  you_must_run: "violet",
  admin_center_only: "slate",
};
const FIX_ROUTE_LABEL: Record<RemediationFixRoute, string> = {
  we_can_run: "we can run it",
  you_must_run: "you run it",
  admin_center_only: "admin centre only",
};
const FIX_ROUTE_ICON: Record<RemediationFixRoute, string> = {
  we_can_run: "zap",
  you_must_run: "clipboard-copy",
  admin_center_only: "external-link",
};

function cardStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, ...extra };
}

function pill(t: { strong: string; text: string; tint: string; border: string }): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999,
    background: t.tint, border: `1px solid ${t.border}`, fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: "nowrap",
  };
}

export function Remediation({ customerId }: { customerId: number }) {
  const [tab, setTab] = useState<Tab>("tracker");
  const [stepSel, setStepSel] = useState<string | null>(null);

  const catalogue = useRemediationCatalogue(customerId);
  const checklist = useRemediationChecklist(customerId);
  const fixRoutes = useFixRoutes(customerId);
  const bypass = useBypassResolutions(customerId);
  const pillars = usePillarScores(customerId);

  const steps = catalogue.data?.steps ?? [];
  const items = checklist.data?.items ?? [];
  const fixItems = fixRoutes.data?.items ?? [];
  const bypassRows = bypass.data ?? [];
  const sel = stepSel ? steps.find((s) => s.stepId === stepSel) ?? null : null;

  const tabDefs: { id: Tab; label: string; count: string }[] = [
    { id: "tracker", label: "Tracker", count: `${steps.length} of ${steps.length}` },
    { id: "checklist", label: "Checklist", count: String(items.length) },
    { id: "routes", label: "Fix routes", count: String(fixItems.length) },
    { id: "bypass", label: "Outside CR", count: String(bypassRows.length) },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <PillarTiles customerId={customerId} data={pillars.data} loading={pillars.isLoading} error={pillars.isError} />

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {tabDefs.map((t) => {
          const activeTab = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setStepSel(null); }}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 7,
                border: `1px solid ${activeTab ? "rgba(96,165,250,.3)" : border.card}`,
                background: activeTab ? "rgba(37,99,235,.18)" : "transparent",
                color: activeTab ? "#bfdbfe" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {t.label}
              <span style={{ fontSize: 10.5, color: activeTab ? signal.info.strong : text.faint }}>{t.count}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <ExportBar customerId={customerId} verifiedCount={steps.filter((s) => s.verificationState === "verified").length} />
      </div>

      {tab === "tracker" && (
        <TrackerTab
          customerId={customerId}
          steps={steps}
          loading={catalogue.isLoading}
          error={catalogue.isError}
          selId={stepSel}
          onSelect={setStepSel}
        />
      )}
      {tab === "tracker" && sel && (
        <StepDrawer customerId={customerId} step={sel} onClose={() => setStepSel(null)} />
      )}

      {tab === "checklist" && (
        <ChecklistTab customerId={customerId} items={items} loading={checklist.isLoading} error={checklist.isError} />
      )}

      {tab === "routes" && (
        <FixRoutesTab customerId={customerId} data={fixRoutes.data} loading={fixRoutes.isLoading} error={fixRoutes.isError} />
      )}

      {tab === "bypass" && (
        <BypassTab rows={bypassRows} loading={bypass.isLoading} error={bypass.isError} />
      )}
    </div>
  );
}

// ── Pillar tiles ──────────────────────────────────────────────────────────────

function PillarTiles({
  data, loading, error,
}: { customerId: number; data: ReturnType<typeof usePillarScores>["data"]; loading: boolean; error: boolean }) {
  const entries = useMemo(() => Object.entries(data?.pillars ?? {}), [data]);
  if (loading) return <div style={{ fontSize: 11.5, color: text.muted }}>Loading pillar scores…</div>;
  if (error) return <div style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load pillar scores.</div>;
  if (entries.length === 0) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(168px,1fr))", gap: 12 }}>
      {entries.map(([key, p]) => {
        const score = p.now;
        const t = TONE[score === null ? "slate" : score >= 70 ? "green" : score >= 45 ? "amber" : "red"];
        const deltaLabel = p.delta === null ? "—" : p.delta > 0 ? `+${p.delta}` : String(p.delta);
        const deltaColor = p.delta === null ? text.label : p.delta > 0 ? signal.ok.text : p.delta < 0 ? signal.critical.text : text.label;
        const meta =
          p.status === "never_scanned" ? "never scanned"
          : p.status === "insufficient_history" ? "not enough history yet"
          : `${p.scanCount} scan${p.scanCount === 1 ? "" : "s"}`;
        return (
          <div key={key} style={cardStyle({ padding: 14, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 })}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.label }}>{key.toUpperCase()}</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", color: text.title }}>{score ?? "—"}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: deltaColor }}>{deltaLabel}</span>
            </div>
            <div style={{ height: 4, borderRadius: 999, background: "rgba(148,163,184,.14)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${score ?? 0}%`, background: t.strong }} />
            </div>
            <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>{meta}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Export bar ────────────────────────────────────────────────────────────────

function ExportBar({ customerId, verifiedCount }: { customerId: number; verifiedCount: number }) {
  const csv = useRemediationExport(customerId, "csv");
  const pdf = useRemediationExport(customerId, "pdf");
  const evidence = useRemediationExport(customerId, "evidence-pack");
  const evidenceOff = verifiedCount === 0;

  const btn = (kind: RemediationExportKind, mutation: typeof csv, label: string, disabled?: boolean) => (
    <button
      key={kind}
      onClick={() =>
        mutation.mutate(undefined, { onError: (err) => toast.error(err instanceof Error ? err.message : "Export failed") })
      }
      disabled={disabled || mutation.isPending}
      title={label}
      style={{
        display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 7,
        border: `1px solid ${border.card}`, background: "transparent",
        color: disabled ? text.faint : text.secondary, fontSize: 12, fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap", opacity: disabled ? 0.55 : 1,
      }}
    >
      <Icon name={mutation.isPending ? "loader" : kind === "csv" ? "table" : kind === "pdf" ? "file-text" : "shield-check"} size={13} className={mutation.isPending ? "smc-spin" : undefined} />
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      {btn("csv", csv, "CSV")}
      {btn("pdf", pdf, "PDF")}
      {btn("evidence-pack", evidence, evidenceOff ? "Evidence pack — nothing verified" : `Evidence pack · ${verifiedCount}`, evidenceOff)}
    </div>
  );
}

// ── Tracker tab ───────────────────────────────────────────────────────────────

function TrackerTab({
  steps, loading, error, selId, onSelect,
}: {
  customerId: number; steps: readonly CatalogueStep[]; loading: boolean; error: boolean;
  selId: string | null; onSelect: (id: string) => void;
}) {
  if (loading) return <div style={{ fontSize: 11.5, color: text.muted }}>Loading the tracker…</div>;
  if (error) return <div style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load the remediation tracker.</div>;

  return (
    <div style={cardStyle({ overflowX: "auto" })}>
      <div style={{ minWidth: 760 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2.6fr 1.3fr 1fr 1fr 1fr", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.sidebar}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
          <span>STEP</span><span>STATUS</span><span>VERIFICATION</span><span>STATE</span><span>UPDATED</span>
        </div>
        {steps.map((s) => {
          const vTone = TONE[VERIFICATION_TONE[s.verificationState] ?? "slate"];
          const isSel = selId === s.stepId;
          return (
            <div
              key={s.stepId}
              onClick={() => onSelect(s.stepId)}
              style={{
                display: "grid", gridTemplateColumns: "2.6fr 1.3fr 1fr 1fr 1fr", gap: 12, alignItems: "center",
                padding: "11px 16px", borderBottom: `1px solid ${border.faint}`, cursor: "pointer",
                background: isSel ? "rgba(37,99,235,.1)" : "transparent",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.label, flex: "0 0 30px" }}>{s.stepLabel.replace("Step ", "s")}</span>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{s.title}</span>
                  <span style={{ fontSize: 11, color: text.label, textTransform: "capitalize" }}>{s.pillar}</span>
                </span>
              </span>
              <span style={{ fontSize: 12, color: text.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.statusLabel}</span>
              <span style={pill(vTone)}>
                <Icon name={VERIFICATION_ICON[s.verificationState] ?? "circle-dashed"} size={11} />
                {s.verificationState}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: TERMINAL_COLOR[s.terminalState] ?? text.muted, whiteSpace: "nowrap" }}>{s.terminalState}</span>
              <span style={{ fontSize: 12, color: text.muted, whiteSpace: "nowrap" }}>{s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepDrawer({ customerId, step, onClose }: { customerId: number; step: CatalogueStep; onClose: () => void }) {
  const queryClient = useQueryClient();
  const setStatus = useSetTrackerStep(customerId);
  const verify = useVerifyTrackerStep(customerId);
  const guide = useVerificationGuide(customerId, step.stepId);
  const evidence = useStepEvidence(customerId, step.stepId);
  const attach = useAttachStepEvidence(customerId, step.stepId);
  const openFile = useOpenEvidenceFile();

  const [caption, setCaption] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const runVerify = () => {
    verify.mutate(step.stepId, {
      onSuccess: (res) => {
        toast.info(`Pointed verification started for ${res.checkKeys.join(", ")}. Refreshing shortly.`);
        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ["msp", "remediation-tracker", customerId] });
        }, 6000);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Could not start verification"),
    });
  };

  const attachments = evidence.data?.attachments ?? [];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(440px,92%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.label }}>{step.stepId} · {step.pillar}</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>{step.title}</span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>MARK THIS STEP</span>
          {REMEDIATION_TRACKER_STEP_STATUS_WRITABLE.map((k) => {
            const active = step.status === k;
            return (
              <button
                key={k}
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ stepId: step.stepId, status: k as RemediationTrackerStepStatus }, {
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update step"),
                })}
                style={{
                  display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", borderRadius: 9,
                  border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
                  background: active ? "rgba(37,99,235,.14)" : "rgba(2,6,23,.4)",
                  color: "#e2e8f0", fontSize: 12.5, fontWeight: 600, cursor: "pointer", textAlign: "left",
                }}
              >
                <Icon name={active ? "circle-check-big" : "circle"} size={14} color={active ? signal.info.strong : text.faint} />
                <span style={{ flex: 1, minWidth: 0, textWrap: "pretty" }}>{labelFor(k)}</span>
                {active && <span style={{ fontSize: 11, color: text.label }}>current</span>}
              </button>
            );
          })}
          <button disabled title="Only the customer can accept a risk — it is a signed record in their name" style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", borderRadius: 9, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.4)", color: text.label, fontSize: 12.5, fontWeight: 600, cursor: "not-allowed", textAlign: "left", opacity: 0.6 }}>
            <Icon name="lock" size={14} color={text.label} />
            <span style={{ flex: 1 }}>Accepted as a risk — signed</span>
            <span style={{ fontSize: 11, color: text.label }}>customer only</span>
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 12, borderTop: `1px solid ${border.soft}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <button
              onClick={runVerify}
              disabled={verify.isPending}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 12px", borderRadius: 8,
                border: `1px solid ${action.base}`, background: action.base, color: "#fff", fontSize: 12.5, fontWeight: 600,
                cursor: verify.isPending ? "wait" : "pointer",
              }}
            >
              <Icon name="radar" size={13} />
              {verify.isPending ? "Starting…" : "Re-check this step now"}
            </button>
            <span style={{ fontSize: 11.5, color: text.muted, flex: 1, minWidth: 120, textWrap: "pretty" }}>
              {step.verificationState === "drift"
                ? "This step was verified once and has since drifted back. A re-check confirms where it stands today."
                : "A pointed scan runs the mapped checks only, and returns while it works."}
            </span>
          </div>

          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>HOW THIS GETS VERIFIED</span>
          {guide.isLoading && <span style={{ fontSize: 11.5, color: text.muted }}>Loading guidance…</span>}
          {guide.isError && (
            <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
              This step has no automated check behind it — its state is a claim rather than a verified fact.
            </span>
          )}
          {guide.data?.guidance.map((g) => (
            <div key={g.checkKey} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <Icon name="check" size={13} color={signal.info.strong} style={{ marginTop: 3, flex: "0 0 13px" }} />
              <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, color: text.body, textWrap: "pretty" }}>{g.validationStep ?? "Checked against the tenant's live configuration"}</span>
                <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.label }}>{g.checkKey}</span>
              </span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 12, borderTop: `1px solid ${border.soft}` }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>EVIDENCE</span>
          {evidence.isLoading && <span style={{ fontSize: 11.5, color: text.muted }}>Loading evidence…</span>}
          {attachments.length === 0 && !evidence.isLoading && (
            <span style={{ fontSize: 11.5, color: text.muted }}>No evidence attached to this step yet.</span>
          )}
          {attachments.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 8, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.4)" }}>
              <Icon name="image" size={14} color={text.label} />
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 12, color: text.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.caption || a.originalFilename || `Evidence #${a.id}`}</span>
                <span style={{ fontSize: 10.5, color: text.label }}>{new Date(a.createdAt).toLocaleString()}</span>
              </div>
              <button onClick={() => openFile.mutate(a, { onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to open file") })} style={{ fontSize: 11, fontWeight: 600, color: signal.info.strong, background: "transparent", border: "none", cursor: "pointer" }}>
                View
              </button>
            </div>
          ))}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" style={{ fontSize: 11.5, color: text.muted }} />
            <input
              type="text" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption (optional)"
              style={{ height: 30, borderRadius: 7, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.4)", color: text.body, fontSize: 12, padding: "0 9px" }}
            />
            <button
              onClick={() => {
                const file = fileRef.current?.files?.[0];
                if (!file) { toast.error("Choose a screenshot to attach first"); return; }
                attach.mutate({ file, caption }, {
                  onSuccess: () => { setCaption(""); if (fileRef.current) fileRef.current.value = ""; toast.success("Evidence attached"); },
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to attach evidence"),
                });
              }}
              disabled={attach.isPending}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, height: 32, borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 12.5, fontWeight: 600, cursor: attach.isPending ? "wait" : "pointer" }}
            >
              <Icon name="upload" size={13} />
              {attach.isPending ? "Attaching…" : "Attach evidence"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function labelFor(status: string): string {
  const LABELS: Record<string, string> = {
    not_started: "Not started",
    completed: "Completed",
    already_handled: "Already handled another way",
    not_applicable: "Not applicable to this tenant",
    deferred: "Deferring to a later phase",
    shane_handles: "Have Shane do this one",
  };
  return LABELS[status] ?? status;
}

// ── Checklist tab ─────────────────────────────────────────────────────────────

function ChecklistTab({
  customerId, items, loading, error,
}: { customerId: number; items: readonly ChecklistItem[]; loading: boolean; error: boolean }) {
  const raise = useRaiseChangeFromChecklistItem(customerId);

  if (loading) return <div style={{ fontSize: 11.5, color: text.muted }}>Loading the checklist…</div>;
  if (error) return <div style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load the checklist.</div>;

  if (items.length === 0) {
    return (
      <div style={cardStyle({ padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" })}>
        <span style={{ width: 42, height: 42, borderRadius: 13, background: signal.info.tint, border: `1px solid ${signal.info.border}`, padding: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="list-checks" size={20} color={signal.info.strong} />
        </span>
        <span style={{ fontSize: 15.5, fontWeight: 700, color: text.title }}>Nothing to remediate yet</span>
        <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 430, textWrap: "pretty" }}>
          This list is built from the critical and warning findings a diagnostic run produced. Run diagnostics against this tenant and the work appears here.
        </span>
      </div>
    );
  }

  return (
    <div style={cardStyle({ overflowX: "auto" })}>
      <div style={{ minWidth: 1000 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2.4fr .9fr 1.4fr 1.2fr 130px", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.sidebar}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
          <span>FINDING</span><span>SEVERITY</span><span>STATUS</span><span>FIX ROUTE</span><span style={{ textAlign: "right" }}>ACTION</span>
        </div>
        {items.map((c) => {
          const sv = TONE[SEVERITY_TONE[c.severity] ?? "amber"];
          const rt = TONE[FIX_ROUTE_TONE[c.fixRoute]];
          const raiseable = true;
          return (
            <div key={c.checkKey} style={{ display: "grid", gridTemplateColumns: "2.4fr .9fr 1.4fr 1.2fr 130px", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${border.faint}` }}>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{c.title}</span>
                <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.checkKey}</span>
              </span>
              <span style={pill(sv)}>{c.severity}</span>
              <span style={{ fontSize: 12, color: text.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{labelFor(c.status)}</span>
              <span style={pill(rt)}>
                <Icon name={FIX_ROUTE_ICON[c.fixRoute]} size={11} />
                {FIX_ROUTE_LABEL[c.fixRoute]}
              </span>
              <button
                onClick={() => raise.mutate(c.checkKey, {
                  onSuccess: (r) => toast.success(`Change request ${r.code} raised`),
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to raise the change request"),
                })}
                disabled={raise.isPending}
                style={{
                  justifySelf: "end", height: 30, padding: "0 11px", borderRadius: 7,
                  border: `1px solid ${action.base}`, background: action.base, color: "#fff", fontSize: 12, fontWeight: 600,
                  cursor: raise.isPending ? "wait" : "pointer", whiteSpace: "nowrap",
                }}
              >
                {raiseable ? "Raise change" : "View request"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Fix routes tab ────────────────────────────────────────────────────────────

function FixRoutesTab({
  customerId, data, loading, error,
}: { customerId: number; data: ReturnType<typeof useFixRoutes>["data"]; loading: boolean; error: boolean }) {
  const reveal = useRevealFix(customerId);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealError, setRevealError] = useState<Record<string, string>>({});

  if (loading) return <div style={{ fontSize: 11.5, color: text.muted }}>Loading fix routes…</div>;
  if (error) return <div style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load fix routes.</div>;

  const ceilGranted = data?.tenantWriteCeiling === "we_can_run";
  const ceilTone = ceilGranted ? TONE.green : TONE.amber;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 11, border: `1px solid ${ceilTone.border}`, background: ceilTone.tint, flexWrap: "wrap" }}>
        <Icon name={ceilGranted ? "shield-check" : "shield-alert"} size={15} color={ceilTone.strong} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong }}>
          {ceilGranted ? "Write-back consent granted" : "Write-back consent not granted"}
        </span>
        <span style={{ fontSize: 11.5, color: text.muted, flex: 1, minWidth: 160, textWrap: "pretty" }}>
          {ceilGranted
            ? "Fixes with a live config pack can be applied from this tenant's Change Control Executions once their change request clears."
            : "Every fix caps at a script the customer runs themselves. Nothing in this console writes to their tenant."}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 12 }}>
        {(data?.items ?? []).map((f: FixRouteItem) => {
          const t = TONE[FIX_ROUTE_TONE[f.fixRoute]];
          const script = revealed[f.checkKey];
          const err = revealError[f.checkKey];
          return (
            <div key={f.checkKey} style={cardStyle({ padding: 15, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 })}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: t.tint, border: `1px solid ${t.border}`, padding: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name={FIX_ROUTE_ICON[f.fixRoute]} size={14} color={t.strong} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{f.title}</span>
                  <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.checkKey}</span>
                </span>
              </div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                <span style={pill(t)}>{FIX_ROUTE_LABEL[f.fixRoute]}</span>
                {f.hasWritePack && <span style={pill(TONE.slate)}>live config pack</span>}
              </div>

              {f.fixRoute === "you_must_run" && !script && (
                <button
                  onClick={() =>
                    reveal.mutate(f.checkKey, {
                      onSuccess: (outcome) => {
                        if (outcome.status === 200) {
                          setRevealed((s) => ({ ...s, [f.checkKey]: outcome.data.remediationSteps.map((r) => r.text).join("\n") }));
                          setRevealError((s) => ({ ...s, [f.checkKey]: "" }));
                        } else {
                          setRevealError((s) => ({ ...s, [f.checkKey]: outcome.error }));
                        }
                      },
                      onError: (e) => setRevealError((s) => ({ ...s, [f.checkKey]: e instanceof Error ? e.message : "Reveal failed" })),
                    })
                  }
                  disabled={reveal.isPending}
                  style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.tint, color: t.text, fontSize: 12.5, fontWeight: 600, cursor: reveal.isPending ? "wait" : "pointer" }}
                >
                  <Icon name="eye" size={13} />
                  {reveal.isPending ? "Checking…" : "Reveal script"}
                </button>
              )}
              {f.fixRoute === "you_must_run" && script && (
                <div style={{ border: `1px solid ${border.hover}`, borderRadius: 9, background: "rgba(2,6,23,.6)", padding: 11, display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.label }}>SCRIPT FOR THE CUSTOMER TO RUN</span>
                  <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.secondary, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{script}</span>
                </div>
              )}
              {err && <span style={{ fontSize: 11.5, color: signal.critical.text, textWrap: "pretty" }}>{err}</span>}

              {f.fixRoute === "admin_center_only" && (
                <button
                  onClick={() => (f.adminCenterUrl ? window.open(f.adminCenterUrl, "_blank", "noopener") : undefined)}
                  disabled={!f.adminCenterUrl}
                  style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 12px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: f.adminCenterUrl ? text.secondary : text.faint, fontSize: 12.5, fontWeight: 600, cursor: f.adminCenterUrl ? "pointer" : "not-allowed" }}
                >
                  <Icon name="external-link" size={13} />
                  Open admin centre
                </button>
              )}

              {f.fixRoute === "we_can_run" && (
                <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
                  Executed through Change Control once its change request is approved — see this tenant's Executions page.
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Bypass tab ────────────────────────────────────────────────────────────────

function BypassTab({ rows, loading, error }: { rows: readonly import("@/api/remediation-types").BypassResolution[]; loading: boolean; error: boolean }) {
  if (loading) return <div style={{ fontSize: 11.5, color: text.muted }}>Loading…</div>;
  if (error) return <div style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load bypass resolutions.</div>;

  if (rows.length === 0) {
    return (
      <div style={cardStyle({ padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" })}>
        <span style={{ width: 42, height: 42, borderRadius: 13, background: signal.ok.tint, border: `1px solid ${signal.ok.border}`, padding: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="git-merge" size={20} color={signal.ok.strong} />
        </span>
        <span style={{ fontSize: 15.5, fontWeight: 700, color: text.title }}>No work landed outside change control</span>
        <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 440, textWrap: "pretty" }}>
          Every verified step in this tenant matches an approved change. Anything fixed without one would be listed here.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((b) => {
        const t = TONE[b.driftEvent.verdict === "attributed_unapproved" ? "red" : "amber"];
        return (
          <div key={b.driftEvent.eventId} style={cardStyle({ padding: "14px 15px", display: "flex", gap: 13, alignItems: "flex-start", minWidth: 0 })}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: t.tint, border: `1px solid ${t.border}`, padding: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="git-merge" size={14} color={t.strong} />
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>
                {b.driftEvent.setting} {b.driftEvent.op} on {b.domainKey} — step {b.stepId} was verified in the same run
              </span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
                {b.driftEvent.changedBy ? `Changed by ${b.driftEvent.changedBy}` : "No actor could be attributed in the tenant's audit log"}, detected {new Date(b.driftEvent.detectedAt).toLocaleString()}.
              </span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                <span style={pill(t)}>{b.driftEvent.verdict.replace("_", " ")}</span>
                <span style={pill(TONE.slate)}>{b.driftEvent.status}</span>
              </div>
            </div>
          </div>
        );
      })}
      <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
        Read-only. A resolution records that the estate changed outside change control — it does not score the tenant or reopen the step.
      </span>
    </div>
  );
}
