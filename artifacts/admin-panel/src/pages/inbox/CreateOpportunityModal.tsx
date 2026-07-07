import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface Lead {
  id: number;
  name: string;
  email: string;
  company: string | null;
  score: number;
}

interface OpportunitySignals {
  detected: boolean;
  confidence: string;
  signals: string[];
  opportunityName: string;
  recommendedNextStep: string;
}

interface Props {
  graphMessageId: string;
  subject: string | null;
  opportunitySignals: OpportunitySignals;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateOpportunityModal({ graphMessageId, subject, opportunitySignals, onClose, onCreated }: Props) {
  const { fetchWithAuth } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [opportunityName, setOpportunityName] = useState(opportunitySignals.opportunityName || subject || "");
  const [workflowType, setWorkflowType] = useState("discovery");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  useEffect(() => {
    fetchWithAuth("/api/leads")
      .then(r => r.ok ? r.json() as Promise<{ leads: Lead[] }> : { leads: [] })
      .then(d => setLeads(d.leads ?? []))
      .catch(() => {})
      .finally(() => setLoadingLeads(false));
  }, [fetchWithAuth]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLeadId) return;
    setSubmitting(true);
    setError(null);
    try {
      const leadId = parseInt(selectedLeadId, 10);
      const res = await fetchWithAuth(`/api/inbox/messages/${graphMessageId}/create-opportunity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          opportunityName,
          signals: opportunitySignals.signals,
          recommendedNextStep: opportunitySignals.recommendedNextStep,
          workflowType,
        }),
      });

      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }

      setCreated(true);
      setTimeout(onCreated, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create opportunity");
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="w-full max-w-sm bg-[#161B22] border border-[#30363D] rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-900/30 border border-emerald-800/40 flex items-center justify-center text-2xl">🎯</div>
          <div className="text-center">
            <p className="text-sm font-semibold text-[#E6EDF3]">Opportunity Created!</p>
            <p className="text-xs text-[#7D8590] mt-1">Lead upgraded to Warm · Workflow tasks generated · Email linked</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-[#161B22] border border-[#30363D] rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363D] sticky top-0 bg-[#161B22] z-10">
          <h2 className="text-sm font-semibold text-[#E6EDF3]">Create Opportunity from Email</h2>
          <button onClick={onClose} className="text-[#7D8590] hover:text-[#C9D1D9]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Signals card */}
          <div className="bg-emerald-900/10 border border-emerald-800/30 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-emerald-400">🎯 Buying Signals Detected</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-900/30 text-emerald-500 capitalize">{opportunitySignals.confidence} confidence</span>
            </div>
            <ul className="space-y-0.5">
              {opportunitySignals.signals.slice(0, 4).map((s, i) => (
                <li key={i} className="text-[11px] text-emerald-300 flex items-start gap-1">
                  <span className="text-emerald-600 mt-0.5">•</span>{s}
                </li>
              ))}
            </ul>
            {opportunitySignals.recommendedNextStep && (
              <p className="text-[11px] text-[#7D8590] pt-1 border-t border-emerald-800/20">
                <span className="text-[#C9D1D9] font-medium">Next step: </span>
                {opportunitySignals.recommendedNextStep}
              </p>
            )}
          </div>

          {/* What this does */}
          <div className="bg-[#0D1117] border border-[#30363D] rounded-xl p-3">
            <p className="text-[10px] font-semibold text-[#7D8590] uppercase mb-2">What this will do</p>
            <ul className="space-y-1">
              {[
                "Upgrade lead score +15 and stage → Warm",
                "Create an opportunity linked to the lead",
                "Generate workflow tasks based on workflow type",
                "Link this email to the opportunity",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-[11px] text-[#C9D1D9]">
                  <svg className="w-3 h-3 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-[#7D8590] uppercase mb-1">Opportunity Name</label>
            <input
              type="text"
              value={opportunityName}
              onChange={e => setOpportunityName(e.target.value)}
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-3 py-1.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#0078D4]"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-[#7D8590] uppercase mb-1">Link to Lead *</label>
            {loadingLeads ? (
              <div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
            ) : (
              <select
                value={selectedLeadId}
                onChange={e => setSelectedLeadId(e.target.value)}
                required
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-3 py-1.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#0078D4]"
              >
                <option value="">Select lead…</option>
                {leads.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name} — {l.company ?? l.email} (score: {l.score})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-[#7D8590] uppercase mb-1">Workflow Type</label>
            <select
              value={workflowType}
              onChange={e => setWorkflowType(e.target.value)}
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-3 py-1.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#0078D4]"
            >
              <option value="discovery">Discovery Call</option>
              <option value="proposal">Proposal</option>
              <option value="pilot">Pilot Project</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose} className="px-4 py-1.5 text-xs text-[#7D8590] border border-[#30363D] rounded-md hover:bg-[#1C2128]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !selectedLeadId}
              className="px-4 py-1.5 text-xs font-medium bg-emerald-700 text-white rounded-md hover:bg-emerald-600 disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create Opportunity"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
