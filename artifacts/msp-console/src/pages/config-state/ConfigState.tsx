/**
 * ConfigState — the MSP operator's configuration-state DIFF view (Git #3836), a
 * direct sibling of #2820 which wired the equivalent Portal-side read.
 *
 * Design: `Design/MSP_Console/design_handoff_msp_console/Configuration State.dc.html`
 * ("Comparisons" tab + the diff-detail drawer). That file describes five tabs
 * (Coverage, Reads, Comparisons, References, What we can read) — #3836's own scope is
 * deliberately narrower than all five: only the comparisons list, the diff detail
 * (attribution + lifecycle per change row, #2759), and the attribution re-run trigger.
 * Coverage/Reads/References/Registry each read a different set of real endpoints
 * (snapshots, baselines, the resource registry) and are their own separate work.
 *
 * Mounts into `ScreenSlot` for `sel.kind === "msp" && sel.page === "config"`.
 *
 * Every field rendered comes from `GET /api/msp/config-state/diffs`,
 * `GET /api/msp/config-state/diffs/:diffId` and `POST .../attribution` — no fixture
 * data. Tenant names come from the same directory read (`GET /api/msp/customers`,
 * via `useDirectory`) the shell itself already uses; the diff endpoints only return
 * numeric tenant row ids.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { border, text } from "@/console/tokens";
import { useDirectory } from "@/api/console-api";
import {
  useConfigDiff, useConfigDiffs, useRunAttribution,
  type ConfigChangeVerdict, type ConfigDiffMode, type DiffDetailResponse,
  type WireChangeAttribution, type WireChangeLifecycle, type WireChangeRow, type WireDiffSummary,
} from "./api";

// ── Tone + labels (design's own `tone()`/`MODE`/`VERDICT` maps, README-locked hex) ──

type ToneKey = "green" | "amber" | "red" | "blue" | "violet" | "slate";
const TONE: Record<ToneKey, readonly [string, string, string]> = {
  green: ["#34d399", "rgba(52,211,153,.1)", "rgba(52,211,153,.26)"],
  amber: ["#fbbf24", "rgba(251,191,36,.1)", "rgba(251,191,36,.26)"],
  red: ["#f87171", "rgba(248,113,113,.1)", "rgba(248,113,113,.26)"],
  blue: ["#60a5fa", "rgba(96,165,250,.1)", "rgba(96,165,250,.26)"],
  violet: ["#a78bfa", "rgba(167,139,250,.1)", "rgba(167,139,250,.26)"],
  slate: ["#94a3b8", "rgba(148,163,184,.08)", "rgba(148,163,184,.2)"],
};

const MODE_LABEL: Record<ConfigDiffMode, string> = {
  drift: "How it moved",
  baseline_assessment: "Against a reference",
  tenant_compare: "Tenant against tenant",
  promotion: "Promotion check",
};
const MODE_TONE: Record<ConfigDiffMode, ToneKey> = {
  drift: "violet",
  baseline_assessment: "blue",
  tenant_compare: "amber",
  promotion: "green",
};

const VERDICT_LABEL: Record<ConfigChangeVerdict, string> = {
  attributed_change: "explained",
  accepted_risk: "accepted risk",
  contested: "disputed",
  unattributed: "unexplained",
  ignored: "noise",
};
const VERDICT_TONE: Record<ConfigChangeVerdict, ToneKey> = {
  attributed_change: "green",
  accepted_risk: "violet",
  contested: "amber",
  unattributed: "red",
  ignored: "slate",
};
const VERDICT_ICON: Record<ConfigChangeVerdict, string> = {
  attributed_change: "circle-check-big",
  accepted_risk: "shield",
  contested: "triangle-alert",
  unattributed: "circle-help",
  ignored: "eye-off",
};
const VERDICT_ORDER: readonly ConfigChangeVerdict[] = [
  "attributed_change", "accepted_risk", "contested", "unattributed", "ignored",
];

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${day} · ${time} UTC`;
}

function fmtVal(v: unknown, present: boolean): string {
  if (!present) return "not set";
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return v.length > 160 ? `${v.slice(0, 160)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 160 ? `${s.slice(0, 160)}…` : s;
  } catch {
    return String(v);
  }
}

function describeAttribution(a: WireChangeAttribution | null): string {
  if (!a) return "The attribution pass has not run over this comparison yet.";
  const ref = a.crRef ?? a.rbdRef;
  const scopeNote = a.matchScope ? ` (matched at the ${a.matchScope} level)` : "";
  switch (a.verdict) {
    case "attributed_change":
      return ref ? `Matches change request ${ref}${scopeNote}.` : `Matches a real, executed change request${scopeNote}.`;
    case "accepted_risk":
      return ref ? `Covered by accepted risk ${ref}${scopeNote}.` : `Covered by a real, active accepted-risk decision${scopeNote}.`;
    case "contested":
      return `A change request and an accepted risk both cover this row but disagree — kept as its own state for a human to resolve${scopeNote}.`;
    case "unattributed":
      return "Nothing in Change Control or the Risk Register explains this change.";
    case "ignored":
      return "Suppressed by a noise rule — kept as its own verdict, never folded into unattributed.";
  }
}

function describeLifecycle(l: WireChangeLifecycle | null): string | null {
  if (!l) return null;
  if (l.status === "open") return `Open · first seen ${fmtWhen(l.firstDetectedAt)}`;
  if (l.status === "resolved") return `Resolved ${l.resolvedAt ? fmtWhen(l.resolvedAt) : ""}`.trim();
  return `Reopened ${l.reopenCount}× · last seen ${fmtWhen(l.lastDetectedAt)}`;
}

function Pill({ label, tone: t }: { label: string; tone: ToneKey }) {
  const [color, tint, line] = TONE[t];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 7, background: tint, border: `1px solid ${line}`, fontSize: 11, fontWeight: 600, color, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

// ── The list ─────────────────────────────────────────────────────────────────

const MODE_FILTERS: readonly (ConfigDiffMode | "all")[] = ["all", "drift", "baseline_assessment", "tenant_compare", "promotion"];

export function ConfigState() {
  const [modeFilter, setModeFilter] = useState<ConfigDiffMode | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);

  const diffsQuery = useConfigDiffs(modeFilter);
  const directory = useDirectory();

  const tenantName = useMemo(() => {
    const byId = new Map((directory.data?.customers ?? []).map((c) => [c.id, c.name]));
    return (id: number) => byId.get(id) ?? `Tenant #${id}`;
  }, [directory.data]);

  const diffs = diffsQuery.data?.diffs ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {MODE_FILTERS.map((f) => {
          const active = modeFilter === f;
          return (
            <button
              key={f}
              onClick={() => setModeFilter(f)}
              style={{
                height: 28, padding: "0 10px", borderRadius: 7,
                border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
                background: active ? "rgba(37,99,235,.18)" : "transparent",
                color: active ? "#bfdbfe" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {f === "all" ? "All comparisons" : MODE_LABEL[f]}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: text.label, whiteSpace: "nowrap" }}>
          {diffsQuery.isLoading ? "Loading…" : `${diffsQuery.data?.paging.total ?? 0} comparisons in your book`}
        </span>
      </div>

      {diffsQuery.isError && (
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: "rgba(15,23,42,.6)", padding: 20, color: "#fca5a5", fontSize: 12.5 }}>
          Could not read your book's comparisons: {diffsQuery.error.message}
        </div>
      )}

      {!diffsQuery.isLoading && !diffsQuery.isError && diffs.length === 0 && (
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: "rgba(15,23,42,.6)", padding: "44px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(96,165,250,.1)", border: "1px solid rgba(96,165,250,.22)", color: "#60a5fa", padding: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="git-pull-request" size={20} />
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>
            {modeFilter === "all" ? "Nothing compared yet" : "No comparisons of that kind"}
          </span>
          <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 440, textWrap: "pretty" }}>
            A comparison needs two sealed configuration reads and is started against
            <code style={{ fontFamily: "Menlo,monospace" }}> POST /api/msp/config-state/diffs</code>. None are in your book yet.
          </span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {diffs.map((d) => (
          <DiffCard key={d.diffId} diff={d} tenantName={tenantName} onOpen={() => setSelected(d.diffId)} />
        ))}
      </div>

      {selected && <DiffDetailDrawer diffId={selected} tenantName={tenantName} onClose={() => setSelected(null)} />}
    </div>
  );
}

function DiffCard({ diff, tenantName, onOpen }: { diff: WireDiffSummary; tenantName: (id: number) => string; onOpen: () => void }) {
  const [color, tint, line] = TONE[MODE_TONE[diff.mode]];
  const title = diff.mode === "tenant_compare"
    ? `${tenantName(diff.baseTenantId)} against ${tenantName(diff.headTenantId)}`
    : diff.mode === "promotion"
      ? `${tenantName(diff.baseTenantId)} promoted into ${tenantName(diff.headTenantId)}`
      : diff.mode === "baseline_assessment"
        ? `${tenantName(diff.headTenantId)} against a reference`
        : `${tenantName(diff.headTenantId)} — how it moved`;
  const sides = `${tenantName(diff.baseTenantId)} snapshot #${diff.baseSnapshotRowId} vs ${tenantName(diff.headTenantId)} snapshot #${diff.headSnapshotRowId}`;
  const c = diff.completeness;

  return (
    <div
      onClick={onOpen}
      style={{ border: `1px solid ${border.card}`, borderRadius: 11, background: "rgba(15,23,42,.6)", padding: 14, display: "flex", flexDirection: "column", gap: 10, minWidth: 0, cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 999, background: tint, border: `1px solid ${line}`, fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", color, whiteSpace: "nowrap" }}>
          {MODE_LABEL[diff.mode].toUpperCase()}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: text.strong, textWrap: "pretty", minWidth: 0 }}>{title}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: text.label, whiteSpace: "nowrap" }}>{diff.sealedAt ? fmtWhen(diff.sealedAt) : fmtWhen(diff.createdAt)}</span>
      </div>
      <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{sides}</span>
      <span style={{ fontSize: 11.5, color: text.label }}>
        {c.changesSignificant.toLocaleString("en-US")} significant change(s)
        {c.comparableFraction !== null && ` · ${Math.round(c.comparableFraction * 100)}% of resource types compared`}
      </span>
    </div>
  );
}

// ── The diff-detail drawer ────────────────────────────────────────────────────

function DiffDetailDrawer({ diffId, tenantName, onClose }: { diffId: string; tenantName: (id: number) => string; onClose: () => void }) {
  const diffQuery = useConfigDiff(diffId);
  const runAttribution = useRunAttribution();

  const detail = diffQuery.data;
  const verdictPills = detail
    ? VERDICT_ORDER.filter((v) => detail.attribution.counts[v] > 0).map((v) => ({
        verdict: v,
        count: detail.attribution.counts[v],
        label: `${detail.attribution.counts[v]} ${VERDICT_LABEL[v]}`,
        tone: VERDICT_TONE[v],
      }))
    : [];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px,95%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
            {detail && (
              <>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: TONE[MODE_TONE[detail.mode]][0] }}>{MODE_LABEL[detail.mode].toUpperCase()}</span>
                <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>
                  {detail.mode === "tenant_compare"
                    ? `${tenantName(detail.snapshots.base?.tenantId ?? 0)} against ${tenantName(detail.snapshots.head?.tenantId ?? 0)}`
                    : detail.mode === "promotion"
                      ? `${tenantName(detail.snapshots.base?.tenantId ?? 0)} promoted into ${tenantName(detail.snapshots.head?.tenantId ?? 0)}`
                      : detail.mode === "baseline_assessment"
                        ? `${tenantName(detail.snapshots.head?.tenantId ?? 0)} against a reference`
                        : `${tenantName(detail.snapshots.head?.tenantId ?? 0)} — how it moved`}
                </span>
                <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
                  {detail.snapshots.base && `Base captured ${fmtWhen(detail.snapshots.base.capturedAt)}`}
                  {detail.snapshots.base && detail.snapshots.head && " · "}
                  {detail.snapshots.head && `Head captured ${fmtWhen(detail.snapshots.head.capturedAt)}`}
                </span>
              </>
            )}
            {!detail && <span style={{ fontSize: 17, fontWeight: 700, color: text.title }}>Comparison</span>}
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        {diffQuery.isLoading && <span style={{ fontSize: 12.5, color: text.muted }}>Reading this comparison…</span>}
        {diffQuery.isError && <span style={{ fontSize: 12.5, color: "#fca5a5" }}>Could not read this comparison: {diffQuery.error.message}</span>}

        {detail && (
          <>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {verdictPills.length > 0
                ? verdictPills.map((v) => <Pill key={v.verdict} label={v.label} tone={v.tone} />)
                : (
                  <span style={{ fontSize: 11.5, color: text.label }}>
                    {detail.attribution.attributed ? "Every change is significant-noise-free with no verdicts recorded." : "Attribution has not run over this comparison yet."}
                  </span>
                )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>WHAT CHANGED</span>
              {detail.changes.length === 0 && (
                <span style={{ fontSize: 12.5, color: text.muted }}>No significant changes on this comparison.</span>
              )}
              {detail.changes.map((c) => (
                <ChangeRow key={c.sequence} change={c} />
              ))}
              {detail.paging.hasMore && (
                <span style={{ fontSize: 11, color: text.faint }}>
                  Showing {detail.changes.length} of {detail.paging.total.toLocaleString("en-US")} changes.
                </span>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
              <button
                onClick={() => {
                  runAttribution.mutate(diffId, {
                    onSuccess: (res) => toast.success(`Matched again — ${res.changesAttributed} change(s) attributed.`),
                    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not re-run attribution."),
                  });
                }}
                disabled={runAttribution.isPending}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 36, borderRadius: 8,
                  border: `1px solid ${border.soft}`, background: "transparent", color: text.secondary, fontSize: 12.5, fontWeight: 600,
                  cursor: runAttribution.isPending ? "wait" : "pointer", opacity: runAttribution.isPending ? 0.6 : 1,
                }}
              >
                <Icon name="rotate-ccw" size={13} />
                {runAttribution.isPending ? "Matching against approvals…" : "Match against approvals again"}
              </button>
              <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
                Matching changes to approvals again is safe to repeat. It reads Change Control and the Risk Register and
                writes nothing back to either — and it never alters the comparison itself.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ChangeRow({ change: c }: { change: WireChangeRow }) {
  const label = c.objectDisplayName ?? c.resourceDisplayName;
  const verdict = c.attribution?.verdict ?? null;
  const [vColor, vTint, vLine] = verdict ? TONE[VERDICT_TONE[verdict]] : TONE.slate;
  const lifecycleLine = describeLifecycle(c.lifecycle);

  return (
    <div style={{ border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{label}</span>
        <span style={{ display: "inline-flex", padding: "2px 8px", borderRadius: 999, background: "rgba(96,165,250,.1)", border: "1px solid rgba(96,165,250,.24)", fontSize: 10, fontWeight: 700, letterSpacing: ".04em", color: "#93c5fd", whiteSpace: "nowrap" }}>
          {c.changeKind.replace(/_/g, " ").toUpperCase()}
        </span>
      </div>
      <span style={{ fontFamily: "Menlo,monospace", fontSize: 10.5, color: text.label, wordBreak: "break-all" }}>{c.propertyPath ?? c.resourceKey}</span>
      <div style={{ display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "#fca5a5", textDecoration: "line-through", textWrap: "pretty" }}>{fmtVal(c.oldValue, c.oldValuePresent)}</span>
        <Icon name="arrow-right" size={12} color={text.faint} />
        <span style={{ fontSize: 12, color: "#6ee7b7", textWrap: "pretty" }}>{fmtVal(c.newValue, c.newValuePresent)}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 7, background: vTint, border: `1px solid ${vLine}`, fontSize: 11, fontWeight: 600, color: vColor, whiteSpace: "nowrap" }}>
          <Icon name={verdict ? VERDICT_ICON[verdict] : "clock"} size={11} />
          {verdict ? VERDICT_LABEL[verdict] : "not attributed yet"}
        </span>
        <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty", flex: 1, minWidth: 120 }}>{describeAttribution(c.attribution)}</span>
      </div>
      {lifecycleLine && <span style={{ fontSize: 11, color: text.faint }}>{lifecycleLine}</span>}
    </div>
  );
}

export type { DiffDetailResponse };
