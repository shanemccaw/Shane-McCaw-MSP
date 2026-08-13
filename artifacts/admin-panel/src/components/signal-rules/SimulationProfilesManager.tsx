import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Beaker,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  PlayCircle,
  UserPlus,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

// ─── Matches the real backend shapes in admin-signal-rules.ts ─────────────────
// GET/POST/PATCH/DELETE /admin/signal-rules/simulation-profiles (signal_simulation_profiles)
// GET /admin/signal-rules/clients-with-runs — real consented tenants
// (msp_customers JOIN tenant_consent, consent_status='granted'), for seeding a
// profile from an actual tenant's live Graph monitor data.
// POST /admin/signal-rules/simulation-profiles/from-client — creates a profile by
// running buildTenantProfile() against that customer's consented tenant.
// POST /admin/signal-rules/simulation-profiles/:id/run — evaluates the profile
// against the live rule set, stores the result, and returns a diff vs the
// profile's previous run.

interface FiredSignal {
  key: string;
  label: string;
  expectedImpact: string;
}

interface ProjectRef {
  id: number;
  title: string;
  priceRange?: string | null;
}

interface ExcludedProject {
  project: { id: number; title: string };
  reason: string;
}

interface ProjectDiff {
  includedProjects: ProjectRef[];
  excludedProjects: ExcludedProject[];
}

interface SimulationProfile {
  id: number;
  name: string;
  description: string | null;
  profileUpdates: Record<string, unknown>;
  parsedFindings: string[];
  tags: string[];
  lastRunAt: string | null;
  lastRunResult: FiredSignal[] | null;
  lastRunProjectDiff: ProjectDiff | null;
  createdAt: string;
  updatedAt: string;
}

// A real customer with a granted Microsoft Graph consent — a tenant whose live
// monitor data can seed a simulation profile.
interface ConsentedTenant {
  id: number;
  name: string | null;
  tenantId: string | null;
  isTestbed: boolean;
  consentStatus: string;
  consentedAt: string | null;
}

interface RunResult {
  firedSignals: FiredSignal[];
  ruleTrace: Array<{ signalKey: string; groupId: number | null; ruleId: number; result: boolean; reason: string }>;
  includedProjects: ProjectRef[];
  excludedProjects: ExcludedProject[];
  previousRunDiff: {
    newlyIncluded: Array<{ id: number; title: string }>;
    movedToExcluded: Array<{ id: number; title: string }>;
    newlyFired: Array<{ key: string; label: string }>;
    stoppedFiring: Array<{ key: string; label: string }>;
  } | null;
}

interface ProfileForm {
  name: string;
  description: string;
  profileUpdatesText: string;
  findingsText: string;
  tagsText: string;
}

const emptyForm: ProfileForm = {
  name: "",
  description: "",
  profileUpdatesText: "{}",
  findingsText: "",
  tagsText: "",
};

function formFromProfile(p: SimulationProfile): ProfileForm {
  return {
    name: p.name,
    description: p.description ?? "",
    profileUpdatesText: JSON.stringify(p.profileUpdates ?? {}, null, 2),
    findingsText: (p.parsedFindings ?? []).join("\n"),
    tagsText: (p.tags ?? []).join(", "),
  };
}

function parseProfileUpdates(text: string): { value: Record<string, unknown>; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { value: {}, error: null };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: {}, error: "Profile updates must be a JSON object" };
    }
    return { value: parsed as Record<string, unknown>, error: null };
  } catch {
    return { value: {}, error: "Profile updates is not valid JSON" };
  }
}

const parseLines = (text: string) => text.split("\n").map(l => l.trim()).filter(Boolean);
const parseTags = (text: string) => text.split(",").map(t => t.trim()).filter(Boolean);

const inputCls =
  "w-full border border-border bg-background text-foreground rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60";
const selectCls = inputCls;
const btnPrimaryCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors";
const btnGhostCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-foreground/90 text-xs font-semibold rounded-lg border border-border hover:border-primary/40 disabled:opacity-40 transition-colors";

export default function SimulationProfilesManager() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [profiles, setProfiles] = useState<SimulationProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SimulationProfile | null>(null);
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [fromClientOpen, setFromClientOpen] = useState(false);
  const [clients, setClients] = useState<ConsentedTenant[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [fromClientName, setFromClientName] = useState("");
  const [fromClientSaving, setFromClientSaving] = useState(false);
  const [fromClientError, setFromClientError] = useState<string | null>(null);

  const [runningId, setRunningId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [runResults, setRunResults] = useState<Record<number, RunResult>>({});

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/signal-rules/simulation-profiles");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load simulation profiles");
      setProfiles(Array.isArray(data) ? data : []);
    } catch (err) {
      toast({
        title: "Failed to load simulation profiles",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const loadClients = useCallback(async () => {
    setClientsLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/signal-rules/clients-with-runs");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load clients");
      setClients(Array.isArray(data) ? data : []);
    } catch (err) {
      toast({
        title: "Failed to load clients",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setClientsLoading(false);
    }
  }, [fetchWithAuth, toast]);

  const openCreate = () => {
    setEditingProfile(null);
    setForm(emptyForm);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (profile: SimulationProfile) => {
    setEditingProfile(profile);
    setForm(formFromProfile(profile));
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError("Name is required.");
      return;
    }
    const { value: profileUpdates, error: parseError } = parseProfileUpdates(form.profileUpdatesText);
    if (parseError) {
      setFormError(parseError);
      return;
    }
    setSaving(true);
    setFormError(null);
    const body = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      profileUpdates,
      parsedFindings: parseLines(form.findingsText),
      tags: parseTags(form.tagsText),
    };
    try {
      const res = await fetchWithAuth(
        editingProfile
          ? `/api/admin/signal-rules/simulation-profiles/${editingProfile.id}`
          : "/api/admin/signal-rules/simulation-profiles",
        {
          method: editingProfile ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save profile");
      toast({ title: editingProfile ? "Profile updated" : "Profile created" });
      setModalOpen(false);
      void loadProfiles();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (profile: SimulationProfile) => {
    if (!confirm(`Delete simulation profile "${profile.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetchWithAuth(`/api/admin/signal-rules/simulation-profiles/${profile.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete profile");
      toast({ title: "Profile deleted" });
      setRunResults(prev => { const next = { ...prev }; delete next[profile.id]; return next; });
      if (expandedId === profile.id) setExpandedId(null);
      void loadProfiles();
    } catch (err) {
      toast({
        title: "Failed to delete profile",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const openFromClient = () => {
    setSelectedClientId("");
    setFromClientName("");
    setFromClientError(null);
    setFromClientOpen(true);
    void loadClients();
  };

  const handleCreateFromClient = async () => {
    if (!selectedClientId) {
      setFromClientError("Select a consented tenant.");
      return;
    }
    setFromClientSaving(true);
    setFromClientError(null);
    try {
      const res = await fetchWithAuth("/api/admin/signal-rules/simulation-profiles/from-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: Number(selectedClientId), name: fromClientName.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create profile from tenant");
      toast({ title: "Profile created from tenant data" });
      setFromClientOpen(false);
      void loadProfiles();
    } catch (err) {
      setFromClientError(err instanceof Error ? err.message : "Failed to create profile from tenant");
    } finally {
      setFromClientSaving(false);
    }
  };

  const handleRun = async (profile: SimulationProfile) => {
    setRunningId(profile.id);
    try {
      const res = await fetchWithAuth(`/api/admin/signal-rules/simulation-profiles/${profile.id}/run`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to run profile");
      setRunResults(prev => ({ ...prev, [profile.id]: data as RunResult }));
      setExpandedId(profile.id);
      void loadProfiles();
    } catch (err) {
      toast({
        title: "Failed to run profile",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-foreground text-sm font-semibold flex items-center gap-2">
            <Beaker className="h-4 w-4 text-primary" />
            Simulation Profiles
          </h2>
          <p className="text-muted-foreground text-xs mt-1 max-w-2xl">
            Saved tenant profiles you can re-run against the live rule set any time — a persistent version of the
            Evaluate/Preview tester. Each run stores which signals fired and which Projects surfaced, and diffs
            against the profile's previous run so you can see exactly what a rule change moved.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={openFromClient} className={btnGhostCls} title="Seed a profile from a real consented tenant's live Microsoft Graph monitor data">
            <UserPlus className="h-3.5 w-3.5" /> Create from Tenant
          </button>
          <button onClick={openCreate} className={btnPrimaryCls}>
            <Plus className="h-3.5 w-3.5" /> New Profile
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading simulation profiles…
        </div>
      ) : profiles.length === 0 ? (
        <div className="px-4 py-6 text-xs italic text-muted-foreground/70 text-center bg-card border border-border rounded-lg">
          No simulation profiles yet. Create one manually or seed it from a real consented tenant's live monitor data.
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.map(profile => {
            const expanded = expandedId === profile.id;
            const result = runResults[profile.id];
            return (
              <div key={profile.id} className="bg-card border border-border rounded-lg overflow-hidden">
                <div
                  className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-accent/40"
                  onClick={() => setExpandedId(expanded ? null : profile.id)}
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-sm text-foreground font-medium truncate">{profile.name}</span>
                  {profile.tags.length > 0 && (
                    <div className="flex items-center gap-1 shrink-0">
                      {profile.tags.map(t => (
                        <span key={t} className="rounded-full px-2 py-0.5 text-[10px] font-mono bg-primary/10 text-primary border border-primary/25">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {profile.lastRunResult
                      ? `${profile.lastRunResult.length} signal${profile.lastRunResult.length !== 1 ? "s" : ""} fired`
                      : "Never run"}
                  </span>
                  <span className="ml-auto text-[11px] text-muted-foreground/60 shrink-0">
                    {profile.lastRunAt ? `Last run ${new Date(profile.lastRunAt).toLocaleString()}` : ""}
                  </span>
                  <div className="shrink-0 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => void handleRun(profile)}
                      disabled={runningId === profile.id}
                      className="rounded p-1.5 text-muted-foreground hover:text-emerald-400 hover:bg-accent disabled:opacity-40"
                      title="Run this profile against the live rule set"
                    >
                      {runningId === profile.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={() => openEdit(profile)} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent" title="Edit profile">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => void handleDelete(profile)} className="rounded p-1.5 text-muted-foreground hover:text-red-400 hover:bg-accent" title="Delete profile">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-border p-4 space-y-4">
                    {profile.description && <p className="text-xs text-muted-foreground">{profile.description}</p>}

                    {!result && profile.lastRunResult && (
                      <div className="flex flex-wrap gap-1.5">
                        {profile.lastRunResult.map(s => (
                          <span key={s.key} title={s.expectedImpact} className="rounded-full px-2.5 py-1 text-[11px] font-mono bg-emerald-400/10 text-emerald-400 border border-emerald-400/25">
                            {s.key}
                          </span>
                        ))}
                      </div>
                    )}

                    {result && (
                      <div className="space-y-4">
                        <div>
                          <div className="text-xs font-semibold text-foreground/90 mb-1.5">
                            Fired Signals ({result.firedSignals.length})
                          </div>
                          {result.firedSignals.length === 0 ? (
                            <p className="text-xs italic text-muted-foreground/70">No signals fired.</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {result.firedSignals.map(s => (
                                <span key={s.key} title={s.expectedImpact} className="rounded-full px-2.5 py-1 text-[11px] font-mono bg-emerald-400/10 text-emerald-400 border border-emerald-400/25">
                                  {s.key}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div>
                            <div className="text-xs font-semibold text-foreground/90 mb-1.5">
                              Included Projects ({result.includedProjects.length})
                            </div>
                            {result.includedProjects.length === 0 ? (
                              <p className="text-xs italic text-muted-foreground/70">None.</p>
                            ) : (
                              <div className="divide-y divide-border/60 rounded-lg border border-border">
                                {result.includedProjects.map(p => (
                                  <div key={p.id} className="px-3 py-2 text-xs">
                                    <div className="text-foreground/90 font-medium">{p.title}</div>
                                    {p.priceRange && <div className="text-muted-foreground/70">{p.priceRange}</div>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-foreground/90 mb-1.5">
                              Excluded Projects ({result.excludedProjects.length})
                            </div>
                            {result.excludedProjects.length === 0 ? (
                              <p className="text-xs italic text-muted-foreground/70">None.</p>
                            ) : (
                              <div className="divide-y divide-border/60 rounded-lg border border-border">
                                {result.excludedProjects.map(({ project, reason }) => (
                                  <div key={project.id} className="px-3 py-2 text-xs">
                                    <div className="text-foreground/90 font-medium">{project.title}</div>
                                    <div className="text-muted-foreground/70">{reason}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {result.previousRunDiff && (
                          <div>
                            <div className="text-xs font-semibold text-foreground/90 mb-1.5">Change vs previous run</div>
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                              {result.previousRunDiff.newlyFired.map(s => (
                                <div key={`nf-${s.key}`} className="flex items-center gap-1.5 text-emerald-400">
                                  <ArrowUpRight className="h-3 w-3 shrink-0" /> {s.label} started firing
                                </div>
                              ))}
                              {result.previousRunDiff.stoppedFiring.map(s => (
                                <div key={`sf-${s.key}`} className="flex items-center gap-1.5 text-red-400">
                                  <ArrowDownRight className="h-3 w-3 shrink-0" /> {s.label} stopped firing
                                </div>
                              ))}
                              {result.previousRunDiff.newlyIncluded.map(p => (
                                <div key={`ni-${p.id}`} className="flex items-center gap-1.5 text-emerald-400">
                                  <ArrowUpRight className="h-3 w-3 shrink-0" /> {p.title} newly included
                                </div>
                              ))}
                              {result.previousRunDiff.movedToExcluded.map(p => (
                                <div key={`me-${p.id}`} className="flex items-center gap-1.5 text-red-400">
                                  <ArrowDownRight className="h-3 w-3 shrink-0" /> {p.title} moved to excluded
                                </div>
                              ))}
                              {result.previousRunDiff.newlyFired.length === 0 &&
                                result.previousRunDiff.stoppedFiring.length === 0 &&
                                result.previousRunDiff.newlyIncluded.length === 0 &&
                                result.previousRunDiff.movedToExcluded.length === 0 && (
                                  <p className="col-span-2 text-xs italic text-muted-foreground/70">No change since the previous run.</p>
                                )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {!result && !profile.lastRunResult && (
                      <p className="text-xs italic text-muted-foreground/70">
                        This profile hasn't been run yet. Click the play icon above to evaluate it against the live rule set.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create/Edit modal ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !saving && setModalOpen(false)}>
          <div
            className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-foreground mb-4">
              {editingProfile ? "Edit Simulation Profile" : "New Simulation Profile"}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name</label>
                <input className={inputCls} value={form.name} autoFocus onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Description</label>
                <input
                  className={inputCls}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What this profile represents"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Profile updates (JSON object)</label>
                <textarea
                  className={`${inputCls} font-mono h-36 resize-y`}
                  value={form.profileUpdatesText}
                  onChange={e => setForm(f => ({ ...f, profileUpdatesText: e.target.value }))}
                  placeholder='{"hasSecurityGaps": true, "mfaCoveragePercent": 40}'
                  spellCheck={false}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Parsed findings (one per line)</label>
                <textarea
                  className={`${inputCls} h-24 resize-y`}
                  value={form.findingsText}
                  onChange={e => setForm(f => ({ ...f, findingsText: e.target.value }))}
                  placeholder={"Legacy authentication protocols detected\nNo conditional access policies configured"}
                  spellCheck={false}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Tags (comma-separated)</label>
                <input
                  className={inputCls}
                  value={form.tagsText}
                  onChange={e => setForm(f => ({ ...f, tagsText: e.target.value }))}
                  placeholder="e.g. baseline, high-risk"
                />
              </div>
            </div>

            {formError && <p className="mt-3 text-xs text-red-400">{formError}</p>}

            <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
              <button onClick={() => setModalOpen(false)} disabled={saving} className={btnGhostCls}>
                Cancel
              </button>
              <button onClick={() => void handleSave()} disabled={saving} className={btnPrimaryCls}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editingProfile ? "Save Changes" : "Create Profile"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create from Tenant modal ── */}
      {fromClientOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !fromClientSaving && setFromClientOpen(false)}>
          <div
            className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md mx-4 p-6"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-foreground mb-4">Create Profile from Tenant</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Pulls a consented tenant's real, current Microsoft Graph monitor data into a single profile via
              the platform's canonical tenant-profile merge. Only customers with a granted consent appear.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Consented tenant</label>
                {clientsLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-xs py-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading tenants…
                  </div>
                ) : (
                  <select className={selectCls} value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)}>
                    <option value="">Select a tenant…</option>
                    {clients.map(c => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name ?? `Customer ${c.id}`}{c.isTestbed ? " [testbed]" : ""}{c.tenantId ? ` — ${c.tenantId}` : ""}
                      </option>
                    ))}
                  </select>
                )}
                {!clientsLoading && clients.length === 0 && (
                  <p className="mt-1 text-[11px] italic text-muted-foreground/70">No consented tenants found. A customer needs a granted Microsoft Graph consent first.</p>
                )}
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Profile name (optional)</label>
                <input
                  className={inputCls}
                  value={fromClientName}
                  onChange={e => setFromClientName(e.target.value)}
                  placeholder="Defaults to the customer's name + date"
                />
              </div>
            </div>

            {fromClientError && <p className="mt-3 text-xs text-red-400">{fromClientError}</p>}

            <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
              <button onClick={() => setFromClientOpen(false)} disabled={fromClientSaving} className={btnGhostCls}>
                Cancel
              </button>
              <button onClick={() => void handleCreateFromClient()} disabled={fromClientSaving || !selectedClientId} className={btnPrimaryCls}>
                {fromClientSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create Profile
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
