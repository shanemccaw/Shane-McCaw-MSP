import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface Project {
  id: number;
  title: string;
  status: string;
  clientUserId: number | null;
}

interface Lead {
  id: number;
  name: string;
  email: string;
  company: string | null;
}

interface Opportunity {
  id: number;
  leadId: number;
  scoreSnapshot: number;
}

interface Customer {
  id: number;
  name: string | null;
  email: string;
  company: string | null;
}

interface Props {
  graphMessageId: string;
  subject: string | null;
  aiTasks?: Array<{ title: string; description?: string; dueDate?: string | null; priority?: string }>;
  onClose: () => void;
  onCreated: (tasks: Array<{ id: number; title: string }>) => void;
}

export default function ConvertToTaskModal({ graphMessageId, subject, aiTasks, onClose, onCreated }: Props) {
  const { fetchWithAuth } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // If aiTasks provided, show batch mode; otherwise single task
  const batchMode = !!aiTasks && aiTasks.length > 1;

  const [title, setTitle] = useState(aiTasks?.[0]?.title ?? subject ?? "");
  const [description, setDescription] = useState(aiTasks?.[0]?.description ?? "");
  const [dueDate, setDueDate] = useState(aiTasks?.[0]?.dueDate ?? "");
  const [priority, setPriority] = useState(aiTasks?.[0]?.priority ?? "medium");

  const [selectedTaskIndices, setSelectedTaskIndices] = useState<Set<number>>(
    new Set(aiTasks?.map((_, i) => i) ?? [])
  );
  const [projectId, setProjectId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [customerId, setCustomerId] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoadingData(true);
      try {
        const [pRes, lRes, uRes] = await Promise.all([
          fetchWithAuth("/api/admin/projects"),
          fetchWithAuth("/api/leads"),
          fetchWithAuth("/api/admin/users"),
        ]);
        if (pRes.ok) {
          const data = await pRes.json() as Project[];
          setProjects(data.filter(p => p.status === "active"));
        }
        if (lRes.ok) {
          const data = await lRes.json() as { leads: Lead[] };
          setLeads(data.leads ?? []);
        }
        if (uRes.ok) {
          const data = await uRes.json() as Customer[];
          setCustomers(data);
        }
      } finally {
        setLoadingData(false);
      }
    }
    void load();
  }, [fetchWithAuth]);

  // Load opportunities when lead is selected
  useEffect(() => {
    if (!leadId) { setOpportunities([]); setOpportunityId(""); return; }
    fetchWithAuth(`/api/opportunities?leadId=${leadId}`)
      .then(r => r.ok ? r.json() as Promise<{ opportunities: Opportunity[] }> : { opportunities: [] })
      .then(d => setOpportunities(d.opportunities ?? []))
      .catch(() => {});
  }, [leadId, fetchWithAuth]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    setSubmitting(true);
    setError(null);
    try {
      const lid = leadId ? parseInt(leadId, 10) : undefined;
      const oid = opportunityId ? parseInt(opportunityId, 10) : undefined;
      const cid = customerId ? parseInt(customerId, 10) : undefined;

      let createdTasks: Array<{ id: number; title: string }> = [];

      if (batchMode && aiTasks) {
        // Batch creation
        const selectedTasks = aiTasks.filter((_, i) => selectedTaskIndices.has(i));
        const res = await fetchWithAuth(`/api/inbox/messages/${graphMessageId}/extract-tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: parseInt(projectId, 10),
            tasks: selectedTasks,
            leadId: lid,
            opportunityId: oid,
            customerId: cid,
          }),
        });
        if (!res.ok) {
          const d = await res.json() as { error?: string };
          throw new Error(d.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json() as { tasks: Array<{ id: number; title: string }> };
        createdTasks = data.tasks;
      } else {
        // Single task
        if (!title.trim()) return;
        const res = await fetchWithAuth(`/api/inbox/messages/${graphMessageId}/convert-to-task`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: parseInt(projectId, 10),
            title: title.trim(),
            description: description.trim() || undefined,
            dueDate: dueDate || undefined,
            priority: priority || undefined,
            leadId: lid,
            opportunityId: oid,
            customerId: cid,
          }),
        });
        if (!res.ok) {
          const d = await res.json() as { error?: string };
          throw new Error(d.error ?? `HTTP ${res.status}`);
        }
        const { task } = await res.json() as { task: { id: number; title: string } };
        createdTasks = [task];
      }

      onCreated(createdTasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create task(s)");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleTask(idx: number) {
    setSelectedTaskIndices(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-[#161B22] border border-[#30363D] rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363D] shrink-0">
          <h2 className="text-sm font-semibold text-[#E6EDF3]">
            {batchMode ? `Create ${selectedTaskIndices.size} Tasks` : "Convert to Kanban Task"}
          </h2>
          <button onClick={onClose} className="text-[#7D8590] hover:text-[#C9D1D9]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {loadingData ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
              {/* Batch: checklist of AI-extracted tasks */}
              {batchMode && aiTasks && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-[#7D8590] uppercase">Select Tasks to Create</p>
                  {aiTasks.map((t, i) => (
                    <label key={i} className="flex items-start gap-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={selectedTaskIndices.has(i)}
                        onChange={() => toggleTask(i)}
                        className="mt-0.5 rounded accent-[#0078D4]"
                      />
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium ${selectedTaskIndices.has(i) ? "text-[#E6EDF3]" : "text-[#7D8590] line-through"}`}>{t.title}</p>
                        {t.description && <p className="text-[11px] text-[#7D8590] truncate">{t.description}</p>}
                        <div className="flex gap-2 text-[10px] text-[#7D8590] mt-0.5">
                          {t.priority && <span className="capitalize">{t.priority}</span>}
                          {t.dueDate && <span>{t.dueDate}</span>}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {/* Single task fields */}
              {!batchMode && (
                <>
                  <div>
                    <label className="block text-[10px] font-semibold text-[#7D8590] uppercase mb-1">Task Title *</label>
                    <input
                      type="text"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      required
                      className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-3 py-1.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#0078D4]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-[#7D8590] uppercase mb-1">Description</label>
                    <textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      rows={3}
                      className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-3 py-1.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#0078D4] resize-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-[#7D8590] uppercase mb-1">Due Date</label>
                      <input
                        type="date"
                        value={dueDate ?? ""}
                        onChange={e => setDueDate(e.target.value)}
                        className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-3 py-1.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#0078D4]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-[#7D8590] uppercase mb-1">Priority</label>
                      <select
                        value={priority}
                        onChange={e => setPriority(e.target.value)}
                        className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-3 py-1.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#0078D4]"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              {/* Shared: project + CRM entity linking */}
              <div>
                <label className="block text-[10px] font-semibold text-[#7D8590] uppercase mb-1">Project *</label>
                <select
                  value={projectId}
                  onChange={e => setProjectId(e.target.value)}
                  required
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-3 py-1.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#0078D4]"
                >
                  <option value="">Select project…</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-[#7D8590] uppercase mb-1">Link to Lead (optional)</label>
                <select
                  value={leadId}
                  onChange={e => setLeadId(e.target.value)}
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-3 py-1.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#0078D4]"
                >
                  <option value="">None</option>
                  {leads.map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.email})</option>
                  ))}
                </select>
              </div>

              {leadId && opportunities.length > 0 && (
                <div>
                  <label className="block text-[10px] font-semibold text-[#7D8590] uppercase mb-1">Link to Opportunity (optional)</label>
                  <select
                    value={opportunityId}
                    onChange={e => setOpportunityId(e.target.value)}
                    className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-3 py-1.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#0078D4]"
                  >
                    <option value="">None</option>
                    {opportunities.map(o => (
                      <option key={o.id} value={o.id}>Opportunity #{o.id} (score: {o.scoreSnapshot})</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-semibold text-[#7D8590] uppercase mb-1">Link to Customer (optional)</label>
                <select
                  value={customerId}
                  onChange={e => setCustomerId(e.target.value)}
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-3 py-1.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#0078D4]"
                >
                  <option value="">None</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name ?? c.email} {c.company ? `— ${c.company}` : ""}</option>
                  ))}
                </select>
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={onClose} className="px-4 py-1.5 text-xs text-[#7D8590] border border-[#30363D] rounded-md hover:bg-[#1C2128]">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !projectId || (batchMode ? selectedTaskIndices.size === 0 : !title.trim())}
                  className="px-4 py-1.5 text-xs font-medium bg-[#0078D4] text-white rounded-md hover:bg-[#1A90E0] disabled:opacity-50"
                >
                  {submitting ? "Creating…" : batchMode ? `Create ${selectedTaskIndices.size} Task${selectedTaskIndices.size !== 1 ? "s" : ""}` : "Create Task"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
