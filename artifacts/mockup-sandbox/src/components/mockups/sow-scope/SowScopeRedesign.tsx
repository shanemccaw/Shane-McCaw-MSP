import { useState } from "react";

interface Phase {
  id: string;
  title: string;
  description: string;
  price: number;
  selected: boolean;
}

const SAMPLE_PHASES: Phase[] = [
  { id: "p1", title: "M365 Tenant Health Assessment", description: "Full diagnostic of your Microsoft 365 environment, security posture, and compliance gaps.", price: 8500, selected: true },
  { id: "p2", title: "SharePoint & Teams Architecture", description: "Design and implement a scalable intranet and collaboration framework aligned to your org structure.", price: 14000, selected: true },
  { id: "p3", title: "Copilot AI Readiness & Rollout", description: "Governance framework, data sensitivity labelling, and phased Copilot enablement for 250 users.", price: 18000, selected: true },
  { id: "p4", title: "Security & Compliance Hardening", description: "Conditional Access policies, DLP rules, and Purview configuration for NIST 800-53 alignment.", price: 12500, selected: false },
  { id: "p5", title: "Power Platform Enablement", description: "Citizen developer programme, CoE toolkit deployment, and two production Power Apps delivered.", price: 9500, selected: false },
];

const FULL_SOW_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;color:#0A2540;background:#fff;padding:28px 32px;font-size:13px}
h1{font-size:19px;font-weight:800;color:#0A2540;margin-bottom:2px}
.sub{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#0078D4;margin-bottom:16px}
h2{font-size:13px;font-weight:700;color:#0A2540;margin:20px 0 8px;padding-bottom:4px;border-bottom:1.5px solid #E5EAF1}
p{margin-bottom:8px;line-height:1.55;color:#374151}
ul{margin:0 0 8px 16px}li{margin-bottom:3px;line-height:1.5;color:#374151}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
thead tr{background:#0A2540}thead th{padding:7px 10px;color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;text-align:left}
td{padding:8px 10px;border-bottom:1px solid #E5EAF1;font-size:12px}
.price{text-align:right;font-weight:700;color:#0078D4}
.total-row td{border-top:2px solid #0A2540;font-weight:800;font-size:13px}
</style></head><body>
<h1>Consolidated Statement of Work</h1>
<p class="sub">Shane McCaw Consulting — Full Engagement Scope</p>
<h2>Executive Summary</h2>
<p>This Statement of Work outlines the complete Microsoft 365 modernisation programme for Contoso Corporation. Over a 6-month engagement, Shane McCaw Consulting will deliver a health assessment, SharePoint architecture, Copilot AI rollout, security hardening, and Power Platform enablement.</p>
<h2>Phase 1 — M365 Tenant Health Assessment</h2>
<p><strong>Approach:</strong> 14 proprietary PowerShell diagnostic scripts surfacing configuration gaps, licensing waste, and security misconfigurations, synthesised into a prioritised remediation backlog.</p>
<ul><li>Executive health scorecard (PDF)</li><li>Prioritised remediation backlog (Planner)</li><li>Licensing optimisation report</li></ul>
<p><em>Timeline: Weeks 1–2</em></p>
<h2>Phase 2 — SharePoint &amp; Teams Architecture</h2>
<p><strong>Approach:</strong> Stakeholder workshops to map information architecture, followed by hub site configuration, navigation taxonomy, and Teams provisioning templates aligned to your division structure.</p>
<ul><li>Information architecture blueprint</li><li>Hub site + 4 associated sites</li><li>Teams provisioning template + governance rules</li><li>2-hour site owner training workshop</li></ul>
<p><em>Timeline: Weeks 3–6</em></p>
<h2>Phase 3 — Copilot AI Readiness &amp; Rollout</h2>
<p><strong>Approach:</strong> Assess data oversharing risks, implement sensitivity labels and DLP prerequisites, then execute a phased rollout to 250 users.</p>
<ul><li>Copilot readiness report</li><li>5 sensitivity label tiers</li><li>30-user pilot + retrospective</li><li>Full 250-seat enablement</li></ul>
<p><em>Timeline: Weeks 5–14</em></p>
<h2>Phase 4 — Security &amp; Compliance Hardening</h2>
<p><strong>Approach:</strong> Implement Conditional Access policies, DLP rules for financial and PII data, and Microsoft Purview for NIST 800-53 compliance mapping.</p>
<ul><li>12 Conditional Access policies</li><li>DLP rule set for 6 data categories</li><li>Purview compliance manager baseline</li></ul>
<p><em>Timeline: Weeks 4–8</em></p>
<h2>Phase 5 — Power Platform Enablement</h2>
<p><strong>Approach:</strong> Deploy the CoE Starter Kit, run a citizen developer bootcamp, and deliver two production Power Apps.</p>
<ul><li>CoE Starter Kit deployment</li><li>2-day citizen developer bootcamp</li><li>2× production Power Apps</li></ul>
<p><em>Timeline: Weeks 8–18</em></p>
<h2>Project Pricing</h2>
<table><thead><tr><th>Phase</th><th style="text-align:right">Investment</th></tr></thead><tbody>
<tr><td>M365 Tenant Health Assessment</td><td class="price">$8,500</td></tr>
<tr><td>SharePoint &amp; Teams Architecture</td><td class="price">$14,000</td></tr>
<tr><td>Copilot AI Readiness &amp; Rollout</td><td class="price">$18,000</td></tr>
<tr><td>Security &amp; Compliance Hardening</td><td class="price">$12,500</td></tr>
<tr><td>Power Platform Enablement</td><td class="price">$9,500</td></tr>
<tr class="total-row"><td>Grand Total</td><td class="price" style="color:#0A2540">$62,500</td></tr>
</tbody></table>
<h2>Signature Block</h2>
<p><strong>Shane McCaw Consulting</strong> _________________________ Date: __________</p>
<p><strong>Contoso Corporation</strong> _________________________ Date: __________</p>
</body></html>`;

const SCOPED_SOW_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;color:#0A2540;background:#fff;padding:28px 32px;font-size:13px}
h1{font-size:19px;font-weight:800;color:#0A2540;margin-bottom:2px}
.sub{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#0078D4;margin-bottom:12px}
.banner{background:#EBF5FF;border:1.5px solid #0078D4;border-radius:8px;padding:9px 14px;margin-bottom:16px;font-size:11px;color:#0A2540;line-height:1.5}
h2{font-size:13px;font-weight:700;color:#0A2540;margin:20px 0 8px;padding-bottom:4px;border-bottom:1.5px solid #E5EAF1}
p{margin-bottom:8px;line-height:1.55;color:#374151}
ul{margin:0 0 8px 16px}li{margin-bottom:3px;line-height:1.5;color:#374151}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
thead tr{background:#0A2540}thead th{padding:7px 10px;color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;text-align:left}
td{padding:8px 10px;border-bottom:1px solid #E5EAF1;font-size:12px}
.price{text-align:right;font-weight:700;color:#0078D4}
.total-row td{border-top:2px solid #0A2540;font-weight:800;font-size:13px}
</style></head><body>
<h1>Consolidated Statement of Work</h1>
<p class="sub">Shane McCaw Consulting — Scoped Engagement</p>
<div class="banner"><strong>Scoped Engagement</strong> — This version covers your 3 selected phases. Phases 4 and 5 have been deferred and are not included in this agreement.</div>
<h2>Executive Summary</h2>
<p>This scoped Statement of Work covers three phases of Contoso's Microsoft 365 modernisation programme. Over approximately 14 weeks, Shane McCaw Consulting will deliver a tenant health assessment, SharePoint and Teams architecture, and full Copilot AI readiness and rollout.</p>
<h2>Phase 1 — M365 Tenant Health Assessment</h2>
<p><strong>Approach:</strong> 14 proprietary PowerShell diagnostic scripts surfacing configuration gaps, licensing waste, and security misconfigurations, synthesised into a prioritised remediation backlog.</p>
<ul><li>Executive health scorecard (PDF)</li><li>Prioritised remediation backlog (Planner)</li><li>Licensing optimisation report</li></ul>
<p><em>Timeline: Weeks 1–2</em></p>
<h2>Phase 2 — SharePoint &amp; Teams Architecture</h2>
<p><strong>Approach:</strong> Stakeholder workshops to map information architecture, followed by hub site configuration and Teams provisioning templates.</p>
<ul><li>Information architecture blueprint</li><li>Hub site + 4 associated sites</li><li>Teams provisioning template + governance rules</li><li>2-hour site owner training workshop</li></ul>
<p><em>Timeline: Weeks 3–6</em></p>
<h2>Phase 3 — Copilot AI Readiness &amp; Rollout</h2>
<p><strong>Approach:</strong> Assess data oversharing risks, implement sensitivity labels, then execute a phased rollout to 250 users.</p>
<ul><li>Copilot readiness report</li><li>5 sensitivity label tiers</li><li>30-user pilot + retrospective</li><li>Full 250-seat enablement</li></ul>
<p><em>Timeline: Weeks 5–14</em></p>
<h2>Project Pricing</h2>
<table><thead><tr><th>Phase</th><th style="text-align:right">Investment</th></tr></thead><tbody>
<tr><td>M365 Tenant Health Assessment</td><td class="price">$8,500</td></tr>
<tr><td>SharePoint &amp; Teams Architecture</td><td class="price">$14,000</td></tr>
<tr><td>Copilot AI Readiness &amp; Rollout</td><td class="price">$18,000</td></tr>
<tr class="total-row"><td>Scoped Total</td><td class="price" style="color:#0A2540">$40,500</td></tr>
</tbody></table>
<h2>Signature Block</h2>
<p><strong>Shane McCaw Consulting</strong> _________________________ Date: __________</p>
<p><strong>Contoso Corporation</strong> _________________________ Date: __________</p>
</body></html>`;

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function SowScopeRedesign() {
  const [phases, setPhases] = useState<Phase[]>(SAMPLE_PHASES);
  const [hasScoped, setHasScoped] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const selectedPhases = phases.filter(p => p.selected);
  const selectedTotal = selectedPhases.reduce((s, p) => s + p.price, 0);
  const hasScopeReduction = selectedPhases.length < phases.length;
  const needsRegeneration = hasScopeReduction && !hasScoped;

  // Which document to show in the right panel
  const showScoped = hasScoped && hasScopeReduction;
  const activeHtml = showScoped ? SCOPED_SOW_HTML : FULL_SOW_HTML;
  const docLabel = showScoped ? "Scoped Statement of Work" : "Full Statement of Work";
  const docTotal = showScoped ? selectedTotal : 62500;

  function togglePhase(id: string) {
    setPhases(prev => prev.map(p => p.id === id ? { ...p, selected: !p.selected } : p));
    setHasScoped(false);
  }

  function handleRegenerate() {
    setRegenerating(true);
    setTimeout(() => { setRegenerating(false); setHasScoped(true); }, 1800);
  }

  return (
    <div className="flex flex-col h-screen bg-[#F7F9FC] font-sans">
      {/* Top bar */}
      <div className="flex-shrink-0 border-b border-slate-200 bg-white px-6 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-[#0078D4] uppercase tracking-widest">Step 8 of 11</p>
          <h1 className="text-lg font-extrabold text-[#0A2540] leading-tight">Scope &amp; Pricing</h1>
        </div>
        <div className="flex items-center gap-3">
          {needsRegeneration && (
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0078D4] text-white text-sm font-bold hover:bg-[#0063B1] transition-colors disabled:opacity-60"
            >
              {regenerating ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Tailoring your SOW…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Regenerate SOW
                </>
              )}
            </button>
          )}
          <button
            disabled={needsRegeneration}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
              needsRegeneration
                ? "bg-slate-100 text-slate-400 cursor-not-allowed border border-dashed border-slate-300"
                : "bg-[#0A2540] text-white hover:bg-[#0A2540]/90"
            }`}
          >
            Continue to Agreement
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">

        {/* LEFT: Phase selector — fixed width, independently scrollable */}
        <div className="w-80 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col">
          <div className="px-5 pt-5 pb-3 flex-shrink-0">
            <h2 className="text-sm font-extrabold text-[#0A2540]">Select Your Scope</h2>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Check the phases you want to include. Deselect any you'd like to defer.
            </p>
          </div>

          {/* Scrollable phase list */}
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
            {phases.map(phase => (
              <div
                key={phase.id}
                onClick={() => togglePhase(phase.id)}
                className={`rounded-xl border-2 p-3 cursor-pointer transition-all select-none ${
                  phase.selected
                    ? "border-[#0078D4] bg-[#EBF5FF]"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                    phase.selected ? "border-[#0078D4] bg-[#0078D4]" : "border-slate-300"
                  }`}>
                    {phase.selected && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-xs font-bold leading-snug ${phase.selected ? "text-[#0A2540]" : "text-slate-400"}`}>
                        {phase.title}
                      </p>
                      <span className={`text-xs font-extrabold whitespace-nowrap flex-shrink-0 ${
                        phase.selected ? "text-[#0078D4]" : "text-slate-300"
                      }`}>
                        {formatCurrency(phase.price)}
                      </span>
                    </div>
                    <p className={`text-xs mt-1 leading-relaxed ${phase.selected ? "text-slate-500" : "text-slate-300"}`}>
                      {phase.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Total footer */}
          <div className="flex-shrink-0 border-t border-slate-100 px-5 py-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                {hasScopeReduction ? "Selected Total" : "Total Investment"}
              </p>
              <p className="text-xs text-slate-400">{selectedPhases.length}/{phases.length} phases</p>
            </div>
            <p className="text-2xl font-extrabold text-[#0A2540]">{formatCurrency(selectedTotal)}</p>

            {needsRegeneration && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 font-semibold">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                Regenerate SOW to continue
              </div>
            )}
            {showScoped && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Scoped SOW ready
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Single document view — fills remaining space */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Document header strip */}
          <div className={`flex-shrink-0 px-5 py-2.5 border-b flex items-center justify-between ${
            showScoped
              ? "bg-[#EBF5FF] border-[#0078D4]/20"
              : "bg-slate-50 border-slate-200"
          }`}>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${showScoped ? "bg-[#0078D4]" : "bg-slate-400"}`} />
              <span className={`text-xs font-bold uppercase tracking-widest ${
                showScoped ? "text-[#0078D4]" : "text-slate-500"
              }`}>
                {docLabel}
              </span>
            </div>
            <span className={`text-xs font-bold ${showScoped ? "text-[#0078D4]" : "text-slate-500"}`}>
              {formatCurrency(docTotal)}
            </span>
          </div>

          {/* Document iframe — fills the rest */}
          {regenerating ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-white gap-4">
              <div className="w-10 h-10 border-4 border-[#0078D4]/20 border-t-[#0078D4] rounded-full animate-spin" />
              <div className="text-center">
                <p className="text-sm font-bold text-[#0A2540]">Tailoring your Statement of Work…</p>
                <p className="text-xs text-slate-400 mt-1">Removing deselected phases and updating pricing</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0">
              <iframe
                key={showScoped ? "scoped" : "full"}
                srcDoc={activeHtml}
                title={docLabel}
                className="w-full h-full border-0"
                sandbox="allow-same-origin"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
