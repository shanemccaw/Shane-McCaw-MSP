import { AlertCircle } from "lucide-react";

import { useConfigStateLive } from "@/components/configStateLive";
import { ATTR_INK, shortResourceKey } from "@/components/configStateWire";

const HAIRLINE = "rgba(255,255,255,.09)";
const CARD_BG = "rgba(255,255,255,.02)";
const RED = "#f87171";

/**
 * Configuration State (#3004, part of #3002/#1485). Adapted from
 * `Design/portal/design_handoff_full_site/screens/Configuration State.dc.html`
 * per that package's own README ("recreate these designs... using this
 * codebase's existing... patterns, not ship the HTML files as-is") and wired
 * per `docs/configuration-state-contract-pack.md` §5 against the real
 * `/api/portal/config-state/*` endpoints (see `configStateLive.ts`).
 *
 * Every number here is a real read — no `configStateData.ts` fixture module
 * exists, and none is created. The design's own hand-authored, tenant-specific
 * commentary (e.g. its Intune/Teams workload notes, its "a third of these
 * changes are one telemetry resource" line) is NOT copied verbatim: that prose
 * describes one specific historical snapshot/diff pair on the testbed tenant
 * and does not generalize to a different tenant or a later collection run.
 * `configStateWire.ts` derives the same *kind* of honest, evidence-backed
 * commentary live from whichever tenant and snapshot pair is actually being
 * read (most-common skip reason per workload, largest resource per diff,
 * real not-comparable-reason breakdowns) — see its own header comment.
 */
export default function ConfigStatePage() {
  const live = useConfigStateLive();
  const { dataState } = live;
  const isLoading = dataState === "loading";
  const isFixture = dataState === "fixture";
  const neverCollected = dataState === "never-collected";
  const hasSnap = dataState === "live" && !!live.current;

  const stateLine = isLoading ? "Loading" : isFixture ? "Could not be read" : neverCollected ? "No snapshot yet" : "Live";
  const stateDot = isLoading ? "#64748b" : isFixture ? RED : neverCollected ? "#64748b" : "#34d399";
  const stateInk = isFixture ? RED : "#64748b";
  const cv = live.changes;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 px-[26px] py-5" style={{ color: "#cbd5e1" }} data-testid="config-state-source" data-config-state-source={dataState}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[20px] font-bold text-[#f8fafc]" style={{ letterSpacing: "-.01em" }}>
          Configuration state
        </span>
        <span
          title="A point-in-time snapshot of your tenant's configuration, read by your MSP. Read-only end to end — nothing here writes to your tenant."
          className="flex size-[17px] items-center justify-center rounded-full text-[10px] font-bold text-[#64748b]"
          style={{ border: "1px solid rgba(148,163,184,.35)" }}
        >
          i
        </span>
        <span className="flex items-center gap-[6px] text-[11px]" style={{ color: stateInk }}>
          <span className="size-[6px] rounded-full" style={{ background: stateDot }} />
          {stateLine}
        </span>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-[10px]">
          {[{ w1: "34%", w2: "70%" }, { w1: "26%", w2: "82%" }, { w1: "42%", w2: "60%" }].map((s, i) => (
            <div key={i} className="flex animate-pulse flex-col gap-[9px] rounded-[14px] p-4" style={{ border: "1px solid rgba(255,255,255,.07)", background: CARD_BG }}>
              <div className="h-[10px] rounded-full" style={{ width: s.w1, background: "rgba(255,255,255,.07)" }} />
              <div className="h-[9px] rounded-full" style={{ width: s.w2, background: "rgba(255,255,255,.05)" }} />
            </div>
          ))}
        </div>
      ) : null}

      {isFixture ? (
        <div className="flex gap-[10px] rounded-xl px-4 py-[14px]" style={{ border: "1px dashed rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }}>
          <AlertCircle className="mt-[2px] size-[15px] shrink-0" color={RED} />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-[#f8fafc]">Your configuration state could not be read</span>
            <span className="max-w-[620px] text-[12px] leading-[1.55] text-[#94a3b8]">
              This is a failed read, not proof there is nothing to show. Nothing is listed below because nothing could be fetched.
            </span>
            <button type="button" onClick={live.refetch} className="w-fit pt-[2px] text-left text-[11.5px] font-semibold text-[#60a5fa] hover:text-[#93c5fd]" data-testid="config-state-retry">
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {neverCollected ? (
        <div className="flex flex-col items-center gap-[7px] rounded-[14px] px-[26px] py-[30px] text-center" style={{ border: "1px dashed rgba(148,163,184,.25)" }}>
          <span className="text-[13.5px] font-semibold text-[#f8fafc]">No configuration snapshot yet</span>
          <span className="max-w-[520px] text-[12px] leading-[1.55] text-[#94a3b8]">
            No sealed snapshot exists for this tenant, so there is nothing to report — which is not the same as reporting that your tenant has no
            configuration.
          </span>
          <span className="text-[11.5px] text-[#64748b]">Your MSP triggers the first collection. There is no schedule.</span>
        </div>
      ) : null}

      {hasSnap && live.current ? (
        <>
          {/* Current snapshot */}
          <div className="rounded-[14px] px-5 pb-4 pt-4" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
            <div className="flex flex-wrap items-center gap-[10px]">
              <span className="text-[13.5px] font-semibold text-[#f8fafc]">Current snapshot</span>
              <span className="rounded-full px-[9px] py-[2px] text-[10px] font-semibold text-[#94a3b8]" style={{ border: "1px solid rgba(148,163,184,.35)" }}>
                {live.current.header.status.toUpperCase()}
              </span>
              <span className="ml-auto text-[11px] text-[#64748b]">{live.current.meta}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-baseline gap-[9px]">
              <span className="text-[24px] font-extrabold text-[#f8fafc]" style={{ letterSpacing: "-.01em", fontVariantNumeric: "tabular-nums" }}>
                {live.current.answered.toLocaleString("en-US")} of {live.current.completeness.resourceTypesTargeted.toLocaleString("en-US")}
              </span>
              <span className="text-[12px] text-[#94a3b8]">resource types answered</span>
              <span className="ml-auto text-[11.5px] text-[#64748b]">{live.current.completeness.objectCount.toLocaleString("en-US")} objects stored</span>
            </div>
            <div className="mt-[10px] flex h-[8px] overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.05)" }}>
              {live.current.segments.map((s, i) => (
                <div key={i} style={{ width: s.width, background: s.bg, flex: "none" }} />
              ))}
            </div>
            <div className="mt-[9px] flex flex-wrap gap-[14px]">
              {live.current.legend.map((l) => (
                <span key={l.key} title={l.tip} className="flex cursor-help items-center gap-[6px] text-[11px]" style={{ color: l.ink }}>
                  <span className="size-[8px] rounded-[2.5px]" style={{ background: l.dot }} />
                  {l.label} {l.value}
                </span>
              ))}
            </div>
            <span className="mt-[11px] block text-[11.5px] text-[#94a3b8]">{live.current.fracLine}</span>
            <span className="mt-1 block text-[10.5px] text-[#475569]">
              Skipped and failed measure what we could not read — they are never a statement about your tenant.
            </span>
          </div>

          {/* By workload */}
          {live.current.workloads.length > 0 ? (
            <div className="rounded-[14px] px-5 pb-3 pt-[6px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
              <div className="flex items-baseline gap-[10px] py-[11px] pb-1">
                <span className="text-[13.5px] font-semibold text-[#f8fafc]">By workload</span>
                <span className="text-[11px] text-[#64748b]">{live.current.workloads.length} workloads on this snapshot · click one for its unread reasons</span>
              </div>
              {live.current.workloads.map((w) => {
                const total = w.resourceTypes;
                const segs = (["collected", "empty", "partial", "skipped", "failed"] as const).map((k) => {
                  const n = w.totals[k];
                  const width = total > 0 ? Math.max((n / total) * 100, n > 0 ? 0.4 : 0) : 0;
                  const bg = { collected: "#34d399", empty: "#60a5fa", partial: "#c2a63d", skipped: "#475569", failed: "#8494ab" }[k];
                  return { width: `${width}%`, bg };
                });
                return (
                  <div
                    key={w.workload}
                    onClick={() => live.openWorkloadPanel(w)}
                    className="flex cursor-pointer flex-wrap items-center gap-[11px] py-[8.5px] hover:opacity-85"
                    style={{ borderTop: "1px solid rgba(255,255,255,.05)" }}
                    data-testid="config-state-workload-row"
                  >
                    <span className="w-[150px] shrink-0 text-[12px] font-semibold text-[#e2e8f0]">{w.workload}</span>
                    <span className="w-[150px] shrink-0 text-[11px] text-[#64748b]" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {w.resourceTypes} types · {w.objectCount.toLocaleString("en-US")} obj
                    </span>
                    <div className="flex h-[5px] min-w-[60px] flex-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.05)" }}>
                      {segs.map((s, i) => (
                        <div key={i} style={{ width: s.width, background: s.bg, flex: "none" }} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Changes since last snapshot */}
          <div className="rounded-[14px] px-5 pb-[15px] pt-4" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
            <div className="flex flex-wrap items-center gap-[10px]">
              <span className="text-[13.5px] font-semibold text-[#f8fafc]">Changes since last snapshot</span>
              {cv && cv.kind !== "unavailable" ? <span className="ml-auto text-[11px] text-[#64748b]">{cv.meta}</span> : null}
            </div>

            {!cv ? null : cv.kind === "unavailable" ? (
              <div className="mt-[11px] flex flex-col gap-[6px]">
                <span className="max-w-[620px] text-[12px] leading-[1.55] text-[#94a3b8]">{cv.detail}</span>
              </div>
            ) : cv.kind === "nothing-comparable" ? (
              <div className="mt-[11px] flex flex-col gap-[6px]">
                <span className="text-[12.5px] font-semibold text-[#e2e8f0]">Nothing was comparable</span>
                <span className="max-w-[600px] text-[12px] leading-[1.55] text-[#94a3b8]">{cv.detail}</span>
                <button type="button" onClick={live.openNotComparablePanel} className="w-fit text-left text-[11.5px] font-semibold text-[#60a5fa]" data-testid="config-state-why-not-comparable">
                  Why nothing was comparable
                </button>
              </div>
            ) : (
              <>
                <div className="mt-[11px] flex flex-wrap items-baseline gap-[9px]">
                  <span className="text-[24px] font-extrabold text-[#f8fafc]" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {cv.changesSignificant.toLocaleString("en-US")}
                  </span>
                  <span className="text-[12px] text-[#94a3b8]">changes across {cv.changeTypeCount} resource types</span>
                  <button
                    type="button"
                    onClick={live.openNotComparablePanel}
                    className="ml-auto text-[11.5px] font-semibold"
                    style={{ color: "#c2a63d" }}
                    data-testid="config-state-why-not-comparable"
                  >
                    {cv.notComparableCount.toLocaleString("en-US")} resource types could not be compared
                  </button>
                </div>

                {cv.attribution ? (
                  <div className="mt-3 flex flex-wrap items-center gap-[10px] rounded-[10px] px-[13px] py-[11px]" style={{ border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.015)" }}>
                    <span className="text-[9.5px] font-bold text-[#475569]" style={{ letterSpacing: ".1em" }}>
                      EXPLAINED SINCE
                    </span>
                    {(["attributed_change", "accepted_risk", "contested", "unattributed", "ignored"] as const).map((v) => {
                      const counts = cv.attribution!.counts;
                      return (
                      <span
                        key={v}
                        title={
                          {
                            attributed_change: "Covered by a real, executed Change Request.",
                            accepted_risk: "Covered by a real, active accepted-risk decision.",
                            contested: "Both a Change Request and an accepted risk cover this row — kept as its own state for a human to resolve.",
                            unattributed: "Neither a Change Request nor an accepted risk explains this row yet.",
                            ignored: "Suppressed by a noise rule — kept as its own verdict, not folded into unattributed.",
                          }[v]
                        }
                        className="flex cursor-help items-center gap-[5px] rounded-full px-[9px] py-[3px]"
                        style={{ border: "1px solid rgba(255,255,255,.1)" }}
                      >
                        <span className="text-[11px] font-extrabold" style={{ color: ATTR_INK[v], fontVariantNumeric: "tabular-nums" }}>
                          {counts[v].toLocaleString("en-US")}
                        </span>
                        <span className="text-[9.5px] font-bold text-[#64748b]" style={{ letterSpacing: ".05em" }}>
                          {{ attributed_change: "CHANGE REQUEST", accepted_risk: "ACCEPTED RISK", contested: "CONTESTED", unattributed: "UNATTRIBUTED", ignored: "IGNORED" }[v]}
                        </span>
                      </span>
                      );
                    })}
                    <button type="button" onClick={live.openAttributionPanel} className="ml-auto text-[10.5px] font-semibold text-[#60a5fa]" data-testid="config-state-why-unattributed">
                      Why so many are unattributed
                    </button>
                  </div>
                ) : null}

                {cv.kindChips.length > 0 ? (
                  <div className="mt-[10px] flex flex-wrap gap-[6px]">
                    {cv.kindChips.map((k) => (
                      <span key={k.kind} className="rounded-full px-[9px] py-[3px] text-[10px] text-[#94a3b8]" style={{ fontFamily: "ui-monospace, Menlo, monospace", border: "1px solid rgba(255,255,255,.10)" }}>
                        {k.kind} · {k.n}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-2 flex flex-col">
                  {cv.changeGroups.map((g) => (
                    <div
                      key={g.resourceKey}
                      onClick={() => live.openChangeGroupPanel(g)}
                      className="flex cursor-pointer items-center gap-[11px] py-[9px] hover:opacity-85"
                      style={{ borderTop: "1px solid rgba(255,255,255,.05)" }}
                      data-testid="config-state-change-group-row"
                    >
                      <span className="min-w-0 text-[11.5px] text-[#cbd5e1]" style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
                        {g.shortKey}
                      </span>
                      {g.partial ? (
                        <span className="shrink-0 rounded-full px-[6px] py-[1.5px] text-[8.5px] font-bold" style={{ color: "#c2a63d", border: "1px solid rgba(194,166,61,.4)", letterSpacing: ".08em" }}>
                          PARTIAL
                        </span>
                      ) : null}
                      <span className="ml-auto shrink-0 text-[11.5px] font-bold text-[#94a3b8]" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {g.n}
                      </span>
                    </div>
                  ))}
                </div>
                {cv.footnote ? (
                  <span className="mt-2 block pt-[9px] text-[10.5px] text-[#475569]" style={{ borderTop: "1px solid rgba(255,255,255,.05)" }}>
                    {cv.footnote} {cv.ignoredCount.toLocaleString("en-US")} suppressed by noise rules.
                  </span>
                ) : null}
              </>
            )}
          </div>

          {/* Snapshot history */}
          <div className="rounded-[14px] px-5 pb-3 pt-[6px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
            <div className="flex items-baseline gap-[10px] py-[11px] pb-1">
              <span className="text-[13.5px] font-semibold text-[#f8fafc]">Snapshot history</span>
              <span className="text-[11px] text-[#64748b]">{live.historyTotal} kept — a failed collection is evidence too</span>
            </div>
            {live.history.map((h) => (
              <div
                key={h.id}
                onClick={() => live.openHistoryPanel(h)}
                className="flex cursor-pointer items-center gap-[11px] py-[9px] hover:opacity-85"
                style={{ borderTop: "1px solid rgba(255,255,255,.05)" }}
                data-testid="config-state-history-row"
              >
                <span className="w-[30px] shrink-0 text-[11px] text-[#64748b]" style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
                  #{h.id}
                </span>
                <span className="w-[130px] shrink-0 text-[12px] text-[#e2e8f0]" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {h.capturedAt ? new Date(h.capturedAt).toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) : ""}
                </span>
                <span className="shrink-0 rounded-full px-2 py-[2px] text-[10px] text-[#64748b]" style={{ border: "1px solid rgba(255,255,255,.10)" }}>
                  {h.trigger}
                </span>
                <span className="min-w-0 text-[11.5px] text-[#94a3b8]">
                  {h.completeness.resourceTypesTargeted.toLocaleString("en-US")} targeted ·{" "}
                  {(h.completeness.resourceTypesCollected + h.completeness.resourceTypesEmpty).toLocaleString("en-US")} answered ·{" "}
                  {h.completeness.objectCount.toLocaleString("en-US")} objects
                </span>
                <span className="ml-auto shrink-0 rounded-full px-2 py-[2px] text-[10px] font-semibold text-[#94a3b8]" style={{ border: "1px solid rgba(148,163,184,.35)" }}>
                  {h.status.toUpperCase()}
                </span>
              </div>
            ))}
          </div>

          <span className="text-[10.5px] text-[#475569]">
            Read-only end to end — collections are triggered by your MSP as visible workflow runs. Snapshots are pruned nightly to the most recent 20 per
            tenant; any snapshot referenced by a comparison or a known-good baseline is protected and never pruned.
          </span>
        </>
      ) : null}

      {/* Drill-down slide-over */}
      {live.panel ? (
        <div className="fixed inset-0 z-20" onClick={live.closePanel} style={{ background: "rgba(2,6,23,.35)" }}>
          <div
            className="absolute inset-y-0 right-0 flex w-[368px] flex-col"
            style={{ borderLeft: "1px solid rgba(255,255,255,.10)", background: "#0b1120", boxShadow: "-18px 0 48px rgba(0,0,0,.5)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-[10px] px-[18px] pb-[14px] pt-4" style={{ borderBottom: "1px solid rgba(255,255,255,.08)" }}>
              <div className="flex min-w-0 flex-col gap-[2px]">
                <span className="text-[14px] font-semibold text-[#f8fafc]">{live.panel.title}</span>
                <span className="text-[11.5px] text-[#64748b]">{live.panel.state}</span>
              </div>
              <button type="button" onClick={live.closePanel} className="ml-auto flex size-[30px] items-center justify-center rounded-md hover:bg-white/[.06]" data-testid="config-state-panel-close">
                <span className="text-[15px] text-[#64748b]">×</span>
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-[18px] pb-5 pt-4">
              {live.panel.rows.length > 0 ? (
                <div className="flex flex-col rounded-[10px] px-[14px] pb-[10px] pt-1" style={{ border: `1px solid ${HAIRLINE}` }}>
                  {live.panel.rows.map((r, i) => (
                    <div key={i} className="flex items-start gap-[10px] py-[11px]" style={{ borderBottom: i < live.panel!.rows.length - 1 ? "1px solid rgba(255,255,255,.06)" : "none" }}>
                      <span className="mt-[5px] size-[6px] shrink-0 rounded-full" style={{ background: "#64748b" }} />
                      <div className="flex min-w-0 flex-col gap-[1px]">
                        <span className="text-[12px] font-semibold text-[#e2e8f0]">{r.k}</span>
                        <span className="text-[11px] leading-[1.5] text-[#64748b]">{r.v}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : live.panel.loading ? (
                <span className="text-[11.5px] text-[#64748b]">Loading…</span>
              ) : null}
              {live.panel.note ? <span className="text-[11.5px] leading-[1.55] text-[#94a3b8]">{live.panel.note}</span> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Re-exported for tests / consumers that want the raw resource-key formatter.
export { shortResourceKey };
