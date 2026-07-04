import { useState, useEffect, useRef } from "react";

interface SowPhase {
  id: string;
  title: string;
  description: string;
  price: number;
  selected: boolean;
  deliveryDate?: string | null;
}

interface AdjustmentLine {
  title: string;
  description: string;
  price: number;
}

interface SowSelectorPanelProps {
  phases: SowPhase[];
  totalPrice: number;
  saving: boolean;
  readOnly?: boolean;
  onReady?: () => void;
  onTogglePhase: (phaseId: string) => void;
  scopedSowHtml?: string | null;
  originalSowHtml?: string | null;
  adjustmentLines?: AdjustmentLine[];
  adjustmentsTotal?: number;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export default function SowSelectorPanel({
  phases,
  totalPrice,
  saving,
  readOnly = false,
  onReady,
  onTogglePhase,
  scopedSowHtml,
  originalSowHtml,
  adjustmentLines = [],
  adjustmentsTotal = 0,
}: SowSelectorPanelProps) {
  const [mobileTab, setMobileTab] = useState<"scope" | "doc">("scope");
  // Separate heights for each document so toggling never resets the layout.
  const [scopedIframeHeight, setScopedIframeHeight] = useState(600);
  const [fullIframeHeight, setFullIframeHeight] = useState(600);
  const [dependencyWarning, setDependencyWarning] = useState<string | null>(null);

  // viewMode controls which document is shown when both exist.
  // Defaults to "scoped" whenever a scoped SOW is present.
  // Resets to "scoped" when scopedSowHtml transitions from null → value.
  // Resets to "full" when scopedSowHtml transitions from value → null.
  const [viewMode, setViewMode] = useState<"scoped" | "full">(
    scopedSowHtml ? "scoped" : "full"
  );
  const prevScopedRef = useRef<string | null | undefined>(scopedSowHtml);

  useEffect(() => {
    const prev = prevScopedRef.current;
    prevScopedRef.current = scopedSowHtml;
    if (!prev && scopedSowHtml) {
      // Scoped SOW just became available → show it
      setViewMode("scoped");
    } else if (prev && !scopedSowHtml) {
      // Scoped SOW was cleared → fall back to full
      setViewMode("full");
    }
  }, [scopedSowHtml]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => { onReady?.(); });
    return () => cancelAnimationFrame(raf);
  }, [onReady]);

  const selectedPhases = phases.filter(p => p.selected);
  const selectedTotal = selectedPhases.reduce((sum, p) => sum + p.price, 0);
  const phasesSubtotal = readOnly ? totalPrice : (selectedTotal || totalPrice);
  const displayTotal = phasesSubtotal + adjustmentsTotal;
  const hasAdjustments = adjustmentLines.length > 0 && adjustmentsTotal > 0;

  const hasScopeReduction = phases.length > 0 && selectedPhases.length < phases.length;
  // Toggle is shown when a scoped SOW exists AND either:
  //   a) the client has deselected at least one phase (interactive scoping), or
  //   b) the panel is in read-only mode (post-sign) — the scope was already committed.
  const showToggle = !!scopedSowHtml && (readOnly || hasScopeReduction);

  // When the toggle is not active, show whichever document is available.
  const fallbackHtml = originalSowHtml ?? null;

  // ── Copilot Deployment dependency rule ────────────────────────────────────
  // Copilot Deployment cannot be selected without at least one of:
  //   Governance Remediation | Security & Compliance | Information Architecture
  // (only enforced when those prerequisite phases exist in this SOW)
  const isCopilotDeployPhase = (title: string) =>
    /copilot/i.test(title) && /deploy/i.test(title);
  const isPrerequisitePhase = (title: string) =>
    /governance/i.test(title) ||
    (/security/i.test(title) && /compliance/i.test(title)) ||
    (/information/i.test(title) && /architecture/i.test(title));

  const prereqsExistInSow = phases.some(p => isPrerequisitePhase(p.title));

  const handlePhaseClick = (phaseId: string) => {
    if (readOnly || saving) return;

    // Compute what the selection would look like after this toggle
    const tentative = phases.map(p =>
      p.id === phaseId ? { ...p, selected: !p.selected } : p
    );
    const tentativeSelected = tentative.filter(p => p.selected);

    // Check: Copilot Deployment selected alone (no prerequisite alongside it)?
    const copilotAlone =
      prereqsExistInSow &&
      tentativeSelected.some(p => isCopilotDeployPhase(p.title)) &&
      !tentativeSelected.some(p => isPrerequisitePhase(p.title));

    if (copilotAlone) {
      setDependencyWarning(
        "Copilot Deployment requires at least one of: Governance Remediation, Security & Compliance, or Information Architecture."
      );
      return;
    }

    setDependencyWarning(null);
    onTogglePhase(phaseId);
  };

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Mobile tab bar — only visible below md */}
      <div className="md:hidden flex-shrink-0 flex border-b border-border bg-white">
        <button
          onClick={() => setMobileTab("scope")}
          className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-widest transition-colors border-b-2 ${
            mobileTab === "scope"
              ? "text-[#0078D4] border-[#0078D4]"
              : "text-muted-foreground border-transparent"
          }`}
        >
          Select Scope
        </button>
        <button
          onClick={() => setMobileTab("doc")}
          className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-widest transition-colors border-b-2 ${
            mobileTab === "doc"
              ? "text-[#0078D4] border-[#0078D4]"
              : "text-muted-foreground border-transparent"
          }`}
        >
          Preview
        </button>
      </div>

      {/* Panels container */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">

        {/* LEFT: Phase selector — full-width on mobile, w-72 sidebar on desktop */}
        <div className={`${mobileTab === "scope" ? "flex" : "hidden"} md:flex flex-col w-full md:w-72 md:flex-shrink-0 border-b md:border-b-0 md:border-r border-border bg-white min-h-0`}>
          {/* Header */}
          <div className="px-4 pt-4 pb-3 flex-shrink-0">
            <h2 className="text-sm font-extrabold text-[#0A2540]">Select Your Scope</h2>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {readOnly
                ? "Phases included in this engagement."
                : "Deselect any phases you'd like to defer."}
            </p>
          </div>

          {/* Scrollable phase list */}
          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2 min-h-0">
            {phases.map((phase) => (
              <div
                key={phase.id}
                onClick={() => handlePhaseClick(phase.id)}
                className={`rounded-xl border-2 p-3 transition-all select-none ${
                  readOnly
                    ? "cursor-default"
                    : "cursor-pointer hover:border-[#0078D4]/60"
                } ${
                  phase.selected
                    ? "border-[#0078D4] bg-[#0078D4]/5"
                    : "border-border bg-white"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {!readOnly && (
                    <div className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      phase.selected
                        ? "border-[#0078D4] bg-[#0078D4]"
                        : "border-gray-300 bg-white"
                    }`}>
                      {phase.selected && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-xs font-bold leading-snug ${phase.selected ? "text-[#0A2540]" : "text-gray-400"}`}>
                        {phase.title}
                      </p>
                      <span className={`text-xs font-extrabold whitespace-nowrap flex-shrink-0 ${
                        phase.selected ? "text-[#0078D4]" : "text-gray-300"
                      }`}>
                        {formatCurrency(phase.price)}
                      </span>
                    </div>
                    {phase.description && (
                      <p className={`text-xs mt-1 leading-relaxed ${phase.selected ? "text-muted-foreground" : "text-gray-300"}`}>
                        {phase.description}
                      </p>
                    )}
                    {phase.deliveryDate && (
                      <p className={`text-[10px] mt-1 font-medium ${phase.selected ? "text-[#0078D4]/70" : "text-gray-300"}`}>
                        Est. delivery:{" "}
                        {new Date(phase.deliveryDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Price adjustments — muted, non-interactive, always included in total */}
            {hasAdjustments && (
              <div className="pt-1">
                <div className="flex items-center gap-2 px-1 pb-1.5">
                  <div className="h-px flex-1 bg-gray-200" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Price Adjustments
                  </span>
                  <div className="h-px flex-1 bg-gray-200" />
                </div>
                <div className="space-y-1.5">
                  {adjustmentLines.map((adj, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-dashed border-gray-200 bg-gray-50/70 p-3 select-none cursor-default"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-gray-400 leading-snug">{adj.title}</p>
                        <span className="text-xs font-extrabold whitespace-nowrap flex-shrink-0 text-gray-400">
                          +{formatCurrency(adj.price)}
                        </span>
                      </div>
                      {adj.description && (
                        <p className="text-[11px] mt-1 leading-relaxed text-gray-400">{adj.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Dependency warning — shown when Copilot Deployment is selected alone */}
          {dependencyWarning && (
            <div className="flex-shrink-0 mx-3 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-start gap-2">
              <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-xs text-amber-700 leading-snug">{dependencyWarning}</p>
            </div>
          )}

          {/* Pinned total footer */}
          <div className="flex-shrink-0 border-t border-border px-4 py-3">
            {/* Breakdown rows — only shown when there are adjustments */}
            {hasAdjustments && (
              <div className="mb-2.5 space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{hasScopeReduction ? "Selected phases" : "Phases"}</span>
                  <span>{formatCurrency(phasesSubtotal)}</span>
                </div>
                {adjustmentLines.map((adj, i) => (
                  <div key={i} className="flex items-center justify-between text-xs text-gray-400">
                    <span className="truncate mr-2">{adj.title}</span>
                    <span className="flex-shrink-0">+{formatCurrency(adj.price)}</span>
                  </div>
                ))}
                <div className="h-px bg-gray-200 mt-1" />
              </div>
            )}
            <div className="flex items-center justify-between mb-0.5">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Total Investment
              </p>
              {!readOnly && (
                <p className="text-xs text-muted-foreground">
                  {selectedPhases.length}/{phases.length} phases
                </p>
              )}
            </div>
            <p className="text-2xl font-extrabold text-[#0A2540]">{formatCurrency(displayTotal)}</p>
            {saving && (
              <div className="flex items-center gap-1.5 text-xs text-[#0078D4] mt-1">
                <div className="w-3 h-3 border border-[#0078D4]/30 border-t-[#0078D4] rounded-full animate-spin" />
                Saving…
              </div>
            )}
            {showToggle && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold mt-1.5">
                <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Scoped SOW ready
              </div>
            )}
            {/* On mobile, link to switch to the document preview tab */}
            {(scopedSowHtml || fallbackHtml) && (
              <button
                onClick={() => setMobileTab("doc")}
                className="md:hidden mt-2 w-full text-xs font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors"
              >
                View document preview →
              </button>
            )}
          </div>
        </div>

        {/* RIGHT: Document viewer */}
        <div className={`${mobileTab === "doc" ? "flex" : "hidden"} md:flex flex-1 flex-col min-h-0`}>

          {/* ── Toggle control (replaces the old label strip when scoped SOW exists) ── */}
          {showToggle ? (
            <div className="flex-shrink-0 flex flex-col gap-0 border-b border-[#0078D4]/20 bg-[#EBF5FF] px-4 py-2.5">
              {/* Pill toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 bg-white/70 border border-[#0078D4]/20 rounded-full p-0.5">
                  <button
                    onClick={() => setViewMode("scoped")}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                      viewMode === "scoped"
                        ? "bg-[#0078D4] text-white shadow-sm"
                        : "text-slate-500 hover:text-[#0078D4]"
                    }`}
                  >
                    Scoped SOW
                  </button>
                  <button
                    onClick={() => setViewMode("full")}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                      viewMode === "full"
                        ? "bg-[#0078D4] text-white shadow-sm"
                        : "text-slate-500 hover:text-[#0078D4]"
                    }`}
                  >
                    Full SOW
                  </button>
                </div>
                <span className="text-xs font-bold text-[#0078D4]">
                  {formatCurrency(displayTotal)}
                </span>
              </div>
            </div>
          ) : (
            /* Original label strip — shown only when no scoped SOW exists */
            fallbackHtml && (
              <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b bg-slate-50 border-border">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
                    Full Statement of Work
                  </span>
                </div>
                <span className="text-xs font-bold text-slate-500">
                  {formatCurrency(displayTotal)}
                </span>
              </div>
            )
          )}

          {/* "Superseded" notice — shown below the toggle when viewing the Full SOW */}
          {showToggle && viewMode === "full" && (
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200">
              <svg className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-slate-500">
                This is the original full-scope version. The{" "}
                <button
                  onClick={() => setViewMode("scoped")}
                  className="font-semibold text-[#0078D4] hover:underline"
                >
                  Scoped SOW
                </button>{" "}
                is the active document for this engagement.
              </p>
            </div>
          )}

          {/* SOW iframe(s) — both rendered once; inactive one hidden via CSS so scroll
              position and iframe height are preserved on toggle. Uses overflow-y-scroll
              on the wrapper (not absolute/h-full on the iframe) so iOS Safari can scroll
              in both directions inside fixed overlays. */}
          {(showToggle || fallbackHtml) ? (
            <div
              className="flex-1 min-h-0 overflow-y-scroll"
              style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
            >
              {/* Scoped SOW — rendered only when the toggle is active so it never
                  stacks with the full iframe in single-document mode */}
              {showToggle && scopedSowHtml && (
                <iframe
                  srcDoc={scopedSowHtml}
                  title="Scoped Statement of Work"
                  className="w-full border-0 block"
                  style={{
                    height: scopedIframeHeight,
                    display: showToggle && viewMode !== "scoped" ? "none" : undefined,
                  }}
                  sandbox="allow-same-origin"
                  onLoad={(e) => {
                    const h = e.currentTarget.contentDocument?.body?.scrollHeight;
                    if (h) setScopedIframeHeight(Math.max(600, h + 32));
                  }}
                />
              )}
              {/* Full / original SOW */}
              {(originalSowHtml ?? fallbackHtml) && (
                <iframe
                  srcDoc={(originalSowHtml ?? fallbackHtml)!}
                  title="Full Statement of Work"
                  className="w-full border-0 block"
                  style={{
                    height: fullIframeHeight,
                    display: showToggle && viewMode !== "full" ? "none" : undefined,
                  }}
                  sandbox="allow-same-origin"
                  onLoad={(e) => {
                    const h = e.currentTarget.contentDocument?.body?.scrollHeight;
                    if (h) setFullIframeHeight(Math.max(600, h + 32));
                  }}
                />
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              No document available
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
