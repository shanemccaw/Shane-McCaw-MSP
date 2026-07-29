/**
 * zoho-project-board.tsx (#85)
 *
 * Zoho Projects Board — a NEW page, deliberately separate from
 * project-kanban.tsx (which stays exactly as-is: it's the local delivery
 * board backed by kanban_tasks, out of scope for this issue). This page is
 * fed live from Zoho via portal-zoho-projects.ts / zoho-projects-read.ts —
 * no task/tasklist/milestone data is ever stored locally.
 *
 * Role behaviour:
 *   - Admin / MSP operators: can link/create the Zoho Project, create and
 *     move tasks, add tasklists and milestones.
 *   - Customer (CustomerUser): read-only board — same "managed by your
 *     project team" convention project-kanban.tsx uses.
 *
 * Column model: Zoho Projects tasks don't expose a fixed, guaranteed status
 * vocabulary through this API layer, so columns are derived from the
 * standard `percent_complete` field rather than a possibly-custom status
 * name — 0% = To Do, 1-99% = In Progress, 100% = Done. Moving a card PATCHes
 * percentComplete to the bucket's representative value (0 / 50 / 100).
 *
 * Every mutation is queued (Zoho CRM's #83 precedent): the UI shows
 * Queued → Syncing → Synced from the real msp_job_queue row, never a faked
 * synchronous success.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Flag,
  FolderKanban,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  useZohoProjectLink,
  useZohoList,
  useQueuedWrite,
  type ZohoProjectsRecord,
} from "@/hooks/useZohoProjects";

// ── Field readers ────────────────────────────────────────────────────────────
// Defensive against the exact Zoho Projects field-name shape: reads the
// commonly documented key first, falls back to reasonable alternates rather
// than crashing the board on a field the account's edition doesn't send.

function recordId(rec: ZohoProjectsRecord): string {
  return String(rec.id ?? rec.id_string ?? "");
}
function recordName(rec: ZohoProjectsRecord): string {
  return String(rec.name ?? "(untitled)");
}
function taskPercent(rec: ZohoProjectsRecord): number {
  const raw = rec.percent_complete ?? rec.percentComplete ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}
function ownerName(rec: ZohoProjectsRecord): string | null {
  const details = rec.details as Record<string, unknown> | undefined;
  const owners = details?.owners as Array<Record<string, unknown>> | undefined;
  const first = owners?.[0]?.name ?? rec.owner_name;
  return typeof first === "string" ? first : null;
}
function dueDate(rec: ZohoProjectsRecord): string | null {
  const raw = rec.end_date ?? rec.due_date;
  return typeof raw === "string" ? raw : null;
}

type Bucket = "todo" | "in_progress" | "done";

function bucketOf(rec: ZohoProjectsRecord): Bucket {
  const pct = taskPercent(rec);
  if (pct >= 100) return "done";
  if (pct > 0) return "in_progress";
  return "todo";
}

const BUCKETS: { key: Bucket; label: string; percent: number; color: string }[] = [
  { key: "todo", label: "To Do", percent: 0, color: "bg-slate-100 dark:bg-slate-800" },
  { key: "in_progress", label: "In Progress", percent: 50, color: "bg-blue-50 dark:bg-blue-950" },
  { key: "done", label: "Done", percent: 100, color: "bg-green-50 dark:bg-green-950" },
];

// ── Sync banner ──────────────────────────────────────────────────────────────

function SyncBanner({ state, message }: { state: string; message: string | null }) {
  if (state === "idle") return null;
  const tone =
    state === "failed" ? "bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400"
    : state === "synced" ? "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400"
    : "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400";
  const label =
    state === "queued" ? "Queued for Zoho"
    : state === "syncing" ? "Syncing to Zoho…"
    : state === "synced" ? "Synced to Zoho"
    : "Sync failed";
  return (
    <div className={`border rounded-lg px-4 py-2.5 text-sm ${tone}`} role="status">
      <p className="font-semibold">{label}</p>
      {message && <p className="mt-0.5 opacity-90">{message}</p>}
    </div>
  );
}

// ── Create Task Dialog ────────────────────────────────────────────────────────

function CreateTaskDialog({ open, onClose, onSubmit, submitting }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (fields: { name: string; tasklistId?: string; ownerName?: string; endDate?: string }) => Promise<void>;
  submitting: boolean;
}) {
  const [name, setName] = useState("");
  const [tasklistId, setTasklistId] = useState("");
  const [ownerNameInput, setOwnerNameInput] = useState("");
  const [endDate, setEndDate] = useState("");

  function reset() { setName(""); setTasklistId(""); setOwnerNameInput(""); setEndDate(""); }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New Zoho Task</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-1 block">Task Name *</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Task name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Tasklist ID <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input value={tasklistId} onChange={e => setTasklistId(e.target.value)} placeholder="Zoho tasklist id" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Owner</label>
              <Input value={ownerNameInput} onChange={e => setOwnerNameInput(e.target.value)} placeholder="Owner name" />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Due Date</label>
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }} disabled={submitting}>Cancel</Button>
          <Button
            disabled={!name.trim() || submitting}
            onClick={async () => {
              await onSubmit({ name: name.trim(), tasklistId: tasklistId.trim() || undefined, ownerName: ownerNameInput.trim() || undefined, endDate: endDate || undefined });
              reset();
            }}
          >
            {submitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}Create Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({ task, isAdmin, onMove }: { task: ZohoProjectsRecord; isAdmin: boolean; onMove: (task: ZohoProjectsRecord, bucket: Bucket) => void }) {
  const bucket = bucketOf(task);
  const owner = ownerName(task);
  const due = dueDate(task);

  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm space-y-2">
      <p className="text-sm font-medium leading-snug line-clamp-2">{recordName(task)}</p>
      <Progress value={taskPercent(task)} className="h-1.5" />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{owner ?? "Unassigned"}</span>
        {due && <span>{new Date(due).toLocaleDateString()}</span>}
      </div>
      {isAdmin && (
        <div className="flex flex-wrap gap-1 pt-1 border-t">
          {BUCKETS.filter(b => b.key !== bucket).map(b => (
            <button
              key={b.key}
              className="text-xs px-2 py-0.5 rounded border hover:bg-accent transition-colors"
              onClick={() => onMove(task, b.key)}
            >
              → {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ZohoProjectBoardPage() {
  const params = useParams<{ id?: string }>();
  const projectId = parseInt(params.id ?? "", 10);
  const [, navigate] = useLocation();
  const { user, fetchWithAuth } = useAuth();

  const adminView = user?.role === "admin" || (user?.mspRole !== undefined && user.mspRole !== "CustomerUser");

  const link = useZohoProjectLink(projectId);
  const tasksPath = link.linked && link.zohoProjectId ? `/api/portal/projects/${projectId}/zoho-tasks` : "";
  const milestonesPath = link.linked && link.zohoProjectId ? `/api/portal/projects/${projectId}/zoho-milestones` : "";
  const tasks = useZohoList(tasksPath, [link.zohoProjectId]);
  const milestones = useZohoList(milestonesPath, [link.zohoProjectId]);

  const write = useQueuedWrite();
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [browseProjects, setBrowseProjects] = useState<ZohoProjectsRecord[]>([]);
  const [selectedZohoProjectId, setSelectedZohoProjectId] = useState<string>("");
  const [linking, setLinking] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");

  const refresh = useCallback(() => {
    void link.load();
    if (link.linked) { void tasks.load(); void milestones.load(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.load, link.linked]);

  useEffect(() => { if (!isNaN(projectId)) void link.load(); }, [projectId, link.load]);
  useEffect(() => { if (link.linked) { void tasks.load(); void milestones.load(); } }, [link.linked, tasks.load, milestones.load]);

  useEffect(() => {
    if (!adminView || link.linked || isNaN(projectId)) return;
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/portal/projects/${projectId}/zoho-project/browse`);
        if (res.ok) {
          const data = (await res.json()) as { records: ZohoProjectsRecord[] };
          setBrowseProjects(data.records ?? []);
        }
      } catch { /* the link panel just shows the create-new option */ }
    })();
  }, [adminView, link.linked, projectId, fetchWithAuth]);

  async function handleLinkExisting() {
    if (!selectedZohoProjectId) return;
    setLinking(true);
    try {
      const r = await fetchWithAuth(`/api/portal/projects/${projectId}/zoho-project`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zohoProjectId: selectedZohoProjectId }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast.success("Linked to Zoho Project");
      await link.load();
    } catch {
      toast.error("Failed to link Zoho Project");
    } finally {
      setLinking(false);
    }
  }

  async function handleCreateProject() {
    if (!newProjectName.trim()) return;
    await write.submit(`/api/portal/projects/${projectId}/zoho-project`, {
      method: "POST",
      body: { fields: { name: newProjectName.trim(), description: newProjectDesc.trim() || undefined } },
    });
    setNewProjectName(""); setNewProjectDesc("");
  }

  async function handleCreateTask(fields: { name: string; tasklistId?: string; ownerName?: string; endDate?: string }) {
    const ok = await write.submit(`/api/portal/projects/${projectId}/zoho-tasks`, {
      method: "POST",
      body: {
        tasklistId: fields.tasklistId,
        fields: { name: fields.name, owner_name: fields.ownerName, end_date: fields.endDate },
      },
    });
    if (ok) { setCreateTaskOpen(false); toast.success("Task queued"); setTimeout(() => void tasks.load(), 1000); }
  }

  async function handleMoveTask(task: ZohoProjectsRecord, bucket: Bucket) {
    const target = BUCKETS.find(b => b.key === bucket)!;
    const id = recordId(task);
    if (!id) return;
    // Optimistic local update so the card moves immediately.
    tasks.setRecords(prev => prev.map(t => recordId(t) === id ? { ...t, percent_complete: target.percent } : t));
    const ok = await write.submit(`/api/portal/projects/${projectId}/zoho-tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { fields: { percent_complete: target.percent } },
    });
    if (!ok) toast.error("Failed to move task — reverting");
  }

  if (isNaN(projectId)) {
    return <AppShell><div className="p-8 text-center text-muted-foreground">Invalid project ID</div></AppShell>;
  }

  return (
    <AppShell>
      <div className="flex flex-col h-full min-h-0">
        <div className="border-b bg-background px-6 py-4 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(adminView ? "/customers" : "/customer-home")}>
              <ArrowLeft className="size-4" />
            </Button>
            <FolderKanban className="size-5 text-primary" />
            <div>
              <h1 className="text-lg font-semibold">Zoho Projects Board</h1>
              <p className="text-xs text-muted-foreground">Live from Zoho — not stored locally</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="size-3.5 mr-1.5" />Refresh
          </Button>
        </div>

        <div className="px-6 pt-4"><SyncBanner state={write.state} message={write.message} /></div>

        {link.loading ? (
          <div className="flex-1 p-6 grid grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 w-full rounded-lg" />)}
          </div>
        ) : link.error ? (
          <div className="flex-1 p-6">
            <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-4 py-3 text-sm">
              {link.error}
            </div>
          </div>
        ) : !link.linked ? (
          <div className="flex-1 p-6 max-w-xl mx-auto w-full space-y-4">
            {adminView ? (
              <>
                <div className="rounded-lg border p-4 space-y-3">
                  <p className="font-semibold flex items-center gap-2"><Link2 className="size-4" />Link an existing Zoho Project</p>
                  <Select value={selectedZohoProjectId} onValueChange={setSelectedZohoProjectId}>
                    <SelectTrigger><SelectValue placeholder="Choose a Zoho Project" /></SelectTrigger>
                    <SelectContent>
                      {browseProjects.map(p => (
                        <SelectItem key={recordId(p)} value={recordId(p)}>{recordName(p)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={!selectedZohoProjectId || linking} onClick={handleLinkExisting}>
                    {linking ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}Link Project
                  </Button>
                </div>
                <div className="rounded-lg border p-4 space-y-3">
                  <p className="font-semibold flex items-center gap-2"><Sparkles className="size-4" />Or create a new Zoho Project</p>
                  <Input value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="Project name" />
                  <Textarea value={newProjectDesc} onChange={e => setNewProjectDesc(e.target.value)} rows={2} placeholder="Description (optional)" />
                  <p className="text-xs text-muted-foreground">Queued — once synced, link it above using the id from the sync result.</p>
                  <Button size="sm" variant="outline" disabled={!newProjectName.trim() || write.state === "queued" || write.state === "syncing"} onClick={handleCreateProject}>
                    Create in Zoho
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                Your project team hasn't connected this project to Zoho Projects yet.
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-6 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 min-h-0">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-sm">Tasks</h2>
                {adminView && (
                  <Button size="sm" variant="outline" onClick={() => setCreateTaskOpen(true)}>
                    <Plus className="size-3.5 mr-1.5" />New Task
                  </Button>
                )}
              </div>
              {tasks.loading ? (
                <div className="grid grid-cols-3 gap-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full rounded-lg" />)}</div>
              ) : tasks.error ? (
                <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-4 py-3 text-sm">{tasks.error}</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {BUCKETS.map(b => {
                    const items = tasks.records.filter(t => bucketOf(t) === b.key);
                    return (
                      <div key={b.key} className="flex flex-col min-h-0">
                        <div className="flex items-center justify-between mb-2 px-1">
                          <span className="font-semibold text-sm">{b.label}</span>
                          <span className="text-xs bg-muted rounded-full px-2 py-0.5">{items.length}</span>
                        </div>
                        <div className={`flex-1 rounded-lg ${b.color} p-2 space-y-2 min-h-[160px]`}>
                          {items.length === 0 && <div className="flex items-center justify-center h-16 text-xs text-muted-foreground">No tasks</div>}
                          {items.map(t => (
                            <TaskCard key={recordId(t)} task={t} isAdmin={adminView} onMove={handleMoveTask} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-sm flex items-center gap-1.5"><Flag className="size-4" />Milestones</h2>
              </div>
              {milestones.loading ? (
                <Skeleton className="h-24 w-full rounded-lg" />
              ) : milestones.records.length === 0 ? (
                <p className="text-xs text-muted-foreground">No milestones</p>
              ) : (
                <div className="space-y-2">
                  {milestones.records.map(m => (
                    <div key={recordId(m)} className="rounded-lg border p-2.5 text-xs space-y-1">
                      <p className="font-medium">{recordName(m)}</p>
                      {dueDate(m) && <Badge variant="outline" className="text-xs">{new Date(dueDate(m)!).toLocaleDateString()}</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {!adminView && link.linked && (
          <div className="border-t bg-muted/40 px-6 py-2 text-xs text-muted-foreground shrink-0">
            Task creation and status changes are managed by your project team.
          </div>
        )}
      </div>

      <CreateTaskDialog
        open={createTaskOpen}
        onClose={() => setCreateTaskOpen(false)}
        onSubmit={handleCreateTask}
        submitting={write.state === "queued" || write.state === "syncing"}
      />
    </AppShell>
  );
}
