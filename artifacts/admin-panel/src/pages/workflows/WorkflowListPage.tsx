import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { format } from "date-fns";

interface WfDefinition {
  id: number;
  name: string;
  description: string | null;
  concurrencyLimit: number;
  publishedVersionLabel: string | null;
  publishedVersionNumber: number | null;
  triggerCount: number;
  lastRunStatus: string | null;
  lastRunAt: string | null;
  createdAt: string;
  metadata?: { system?: boolean };
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  running:   "bg-blue-500/20 text-blue-400 border-blue-500/30",
  failed:    "bg-red-500/20 text-red-400 border-red-500/30",
  pending:   "bg-amber-500/20 text-amber-400 border-amber-500/30",
  cancelled: "bg-[#30363D] text-[#7D8590] border-[#30363D]",
};

function StatusChip({ status }: { status: string | null }) {
  if (!status) return <span className="text-[#484F58] text-xs">—</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_COLORS[status] ?? "bg-[#1C2128] text-[#7D8590] border-[#30363D]"}`}>
      {status}
    </span>
  );
}

function WorkflowCard({
  def,
  isSystem,
  onDelete,
  navigate,
  prodDbConnected,
  onPublishToProd,
}: {
  def: WfDefinition;
  isSystem: boolean;
  onDelete: (id: number) => void;
  navigate: (path: string) => void;
  prodDbConnected: boolean;
  onPublishToProd: (id: number) => void;
}) {
  return (
    <div className="bg-[#161B22] border border-[#30363D] hover:border-[#0078D4]/40 rounded-xl p-4 flex items-center gap-4 group transition-colors">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${isSystem ? "bg-violet-500/5 border-violet-500/20" : "bg-[#0078D4]/10 border-[#0078D4]/20"}`}>
        {isSystem ? (
          <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-[#0078D4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-[#E6EDF3] truncate">{def.name}</span>
          {def.publishedVersionLabel && (
            <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
              {def.publishedVersionLabel}
            </span>
          )}
        </div>
        {def.description && (
          <p className="text-xs text-[#7D8590] truncate mt-0.5">{def.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1.5 text-xs text-[#484F58]">
          <span>{def.triggerCount} trigger{def.triggerCount !== 1 ? "s" : ""}</span>
          <span>·</span>
          <span>max {def.concurrencyLimit} concurrent</span>
          {def.lastRunAt && (
            <>
              <span>·</span>
              <span>last run {format(new Date(def.lastRunAt), "MMM d")}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <StatusChip status={def.lastRunStatus} />

        <button
          onClick={() => navigate(`/workflows/runs?definitionId=${def.id}`)}
          className="p-1.5 text-[#484F58] hover:text-[#7D8590] rounded-lg hover:bg-[#1C2128] transition-colors"
          title="Run history"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </button>

        <button
          onClick={() => navigate(`/workflows/triggers/${def.id}`)}
          className="p-1.5 text-[#484F58] hover:text-[#7D8590] rounded-lg hover:bg-[#1C2128] transition-colors"
          title="Triggers"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </button>

        <button
          onClick={() => navigate(`/workflows/builder/${def.id}`)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0078D4]/10 hover:bg-[#0078D4]/20 text-[#0078D4] text-xs font-medium rounded-lg border border-[#0078D4]/20 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
          Open Builder
        </button>

        <button
          onClick={() => onPublishToProd(def.id)}
          disabled={!prodDbConnected || def.publishedVersionNumber === null}
          title={
            !prodDbConnected
              ? "Production database not configured — set DATABASE_URL_PROD in Replit Secrets"
              : def.publishedVersionNumber === null
              ? "Publish a version first — no published version exists for this workflow"
              : "Publish this workflow to the production database"
          }
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-medium rounded-lg border border-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Publish to Prod
        </button>

        {isSystem ? (
          <span
            className="p-1.5 text-[#30363D] rounded-lg cursor-not-allowed"
            title="System workflows cannot be deleted"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </span>
        ) : (
          <button
            onClick={() => onDelete(def.id)}
            className="p-1.5 text-[#484F58] hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
            title="Delete"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

export default function WorkflowListPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [systemExpanded, setSystemExpanded] = useState(false);

  const { data: defs = [], isLoading } = useQuery<WfDefinition[]>({
    queryKey: ["wf-definitions"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/workflows/definitions");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const userDefs = defs.filter(d => !d.metadata?.system);
  const systemDefs = defs.filter(d => d.metadata?.system);

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/admin/workflows/definitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined }),
      });
      if (!res.ok) throw new Error("Failed to create");
      return res.json() as Promise<{ id: number; draftVersionId: number }>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["wf-definitions"] });
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
      navigate(`/workflows/builder/${data.id}?vid=${data.draftVersionId}`);
    },
  });

  const { data: prodDbStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["prod-db-status"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/prod-db/status");
      if (!res.ok) return { connected: false };
      return res.json();
    },
    staleTime: 60_000,
  });
  const prodDbConnected = prodDbStatus?.connected ?? false;

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wf-definitions"] });
      setDeleteId(null);
    },
  });

  const publishToProdMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${id}/publish-to-prod`, { method: "POST" });
      const body = await res.json() as { ok?: boolean; name?: string; publishedVersionId?: number | null; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to publish to production");
      return body;
    },
    onSuccess: (data) => {
      if (data.publishedVersionId == null) {
        toast({
          title: "No version published",
          description: `"${data.name ?? "Workflow"}" was synced but has no published version — open the builder and publish a version first.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Published to production", description: `"${data.name ?? "Workflow"}" is now in the production database.` });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Publish failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#E6EDF3]">Workflows</h1>
            <p className="text-sm text-[#7D8590] mt-0.5">
              Design, version, and run automated workflows.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#006CBD] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Workflow
          </button>
        </div>

        {/* Create dialog */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
            <div className="bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
              <h2 className="font-semibold text-[#E6EDF3]">New Workflow</h2>
              <div className="space-y-3">
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Workflow name"
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
                  autoFocus
                />
                <textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  placeholder="Description (optional)"
                  rows={2}
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 resize-none"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-[#7D8590] hover:text-[#E6EDF3] transition-colors">Cancel</button>
                <button
                  onClick={() => createMut.mutate()}
                  disabled={!newName.trim() || createMut.isPending}
                  className="px-4 py-2 bg-[#0078D4] hover:bg-[#006CBD] disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {createMut.isPending ? "Creating…" : "Create & Open Builder"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete confirm */}
        {deleteId !== null && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setDeleteId(null)}>
            <div className="bg-[#161B22] border border-red-500/30 rounded-xl p-6 max-w-sm w-full space-y-4" onClick={e => e.stopPropagation()}>
              <h2 className="font-semibold text-[#E6EDF3]">Delete Workflow</h2>
              <p className="text-sm text-[#7D8590]">This will permanently delete the workflow and all its versions, triggers, and run history.</p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm text-[#7D8590] hover:text-[#E6EDF3] transition-colors">Cancel</button>
                <button
                  onClick={() => deleteMut.mutate(deleteId)}
                  disabled={deleteMut.isPending}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {deleteMut.isPending ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 bg-[#161B22] border border-[#30363D] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">

            {/* User workflows */}
            {userDefs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="w-16 h-16 bg-[#1C2128] border border-[#30363D] rounded-2xl flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-[#484F58]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                </div>
                <p className="text-[#E6EDF3] font-medium">No workflows yet</p>
                <p className="text-sm text-[#7D8590] mt-1">Create your first workflow to get started.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {userDefs.map(def => (
                  <WorkflowCard
                    key={def.id}
                    def={def}
                    isSystem={false}
                    onDelete={setDeleteId}
                    navigate={navigate}
                    prodDbConnected={prodDbConnected}
                    onPublishToProd={id => publishToProdMut.mutate(id)}
                  />
                ))}
              </div>
            )}

            {/* System workflows — collapsible, collapsed by default */}
            {systemDefs.length > 0 && (
              <div>
                <button
                  onClick={() => setSystemExpanded(v => !v)}
                  className="flex items-center gap-2 w-full text-left group mb-2"
                >
                  <span className="flex-1 h-px bg-[#21262D]" />
                  <span className="flex items-center gap-1.5 text-xs text-[#484F58] group-hover:text-[#7D8590] transition-colors px-1 select-none">
                    <svg
                      className={`w-3 h-3 transition-transform ${systemExpanded ? "rotate-90" : ""}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    System workflows
                    <span className="bg-[#1C2128] border border-[#30363D] rounded-full px-1.5 py-px text-[10px] font-medium">
                      {systemDefs.length}
                    </span>
                  </span>
                  <span className="flex-1 h-px bg-[#21262D]" />
                </button>

                {systemExpanded && (
                  <div className="space-y-2">
                    {systemDefs.map(def => (
                      <WorkflowCard
                        key={def.id}
                        def={def}
                        isSystem={true}
                        onDelete={setDeleteId}
                        navigate={navigate}
                        prodDbConnected={prodDbConnected}
                        onPublishToProd={id => publishToProdMut.mutate(id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
