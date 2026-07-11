import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface MonitorCheck {
  id: number;
  key: string;
  label: string;
  endpoint: string;
  frequency: string;
  requiresCustomerScript: boolean;
  status: string;
}

interface MonitoringPackage {
  id: number;
  packageId: string;
  key: string;
  label: string;
  description: string | null;
  engines: string[];
  status: "active" | "archived";
  createdAt: string;
}

interface PackageCheckLink {
  checkKey: string;
  sortOrder: number;
  check?: MonitorCheck;
}

const EMPTY_PKG: Partial<MonitoringPackage> = {
  key: "",
  label: "",
  description: "",
  engines: [],
};

export default function MonitoringPackagesPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [packages, setPackages] = useState<MonitoringPackage[]>([]);
  const [allChecks, setAllChecks] = useState<MonitorCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editingPkg, setEditingPkg] = useState<Partial<MonitoringPackage> | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedPkg, setExpandedPkg] = useState<string | null>(null);
  const [pkgChecks, setPkgChecks] = useState<Record<string, PackageCheckLink[]>>({});
  const [showChecksDialog, setShowChecksDialog] = useState(false);
  const [selectedPkgKey, setSelectedPkgKey] = useState<string | null>(null);
  const [assignedCheckKeys, setAssignedCheckKeys] = useState<string[]>([]);

  const loadPackages = useCallback(async () => {
    setLoading(true);
    try {
      const [pkgRes, checkRes] = await Promise.all([
        fetchWithAuth("/api/admin/monitoring-packages"),
        fetchWithAuth("/api/admin/monitor-checks"),
      ]);
      const pkgData = await pkgRes.json() as { packages: MonitoringPackage[] };
      const checkData = await checkRes.json() as { checks: MonitorCheck[] };
      setPackages(pkgData.packages ?? []);
      setAllChecks(checkData.checks ?? []);
    } catch {
      toast({ title: "Error", description: "Failed to load monitoring packages", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => { void loadPackages(); }, [loadPackages]);

  const loadPkgChecks = async (key: string) => {
    try {
      const res = await fetchWithAuth(`/api/admin/monitoring-packages/${key}`);
      const data = await res.json() as { checks: PackageCheckLink[] };
      setPkgChecks(prev => ({ ...prev, [key]: data.checks ?? [] }));
    } catch {
      /* non-fatal */
    }
  };

  const toggleExpanded = async (key: string) => {
    if (expandedPkg === key) {
      setExpandedPkg(null);
    } else {
      setExpandedPkg(key);
      if (!pkgChecks[key]) await loadPkgChecks(key);
    }
  };

  const openCreate = () => { setEditingPkg({ ...EMPTY_PKG }); setShowDialog(true); };
  const openEdit = (p: MonitoringPackage) => { setEditingPkg({ ...p }); setShowDialog(true); };

  const openChecksAssignment = async (key: string) => {
    setSelectedPkgKey(key);
    if (!pkgChecks[key]) await loadPkgChecks(key);
    const currentKeys = (pkgChecks[key] ?? []).map(c => c.checkKey);
    setAssignedCheckKeys(currentKeys);
    setShowChecksDialog(true);
  };

  const handleSave = async () => {
    if (!editingPkg) return;
    setSaving(true);
    try {
      const isEdit = Boolean(editingPkg.id);
      const url = isEdit ? `/api/admin/monitoring-packages/${editingPkg.key}` : "/api/admin/monitoring-packages";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetchWithAuth(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(editingPkg) });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Save failed");
      }
      toast({ title: isEdit ? "Package updated" : "Package created" });
      setShowDialog(false);
      void loadPackages();
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveChecks = async () => {
    if (!selectedPkgKey) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/monitoring-packages/${selectedPkgKey}/checks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkKeys: assignedCheckKeys }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: "Package checks updated" });
      setPkgChecks(prev => {
        const updated = { ...prev };
        delete updated[selectedPkgKey];
        return updated;
      });
      setShowChecksDialog(false);
    } catch {
      toast({ title: "Error", description: "Failed to update checks", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (p: MonitoringPackage) => {
    if (!confirm(`Archive package "${p.label}"?`)) return;
    try {
      await fetchWithAuth(`/api/admin/monitoring-packages/${p.key}`, { method: "DELETE" });
      toast({ title: "Package archived" });
      void loadPackages();
    } catch {
      toast({ title: "Error", description: "Failed to archive package", variant: "destructive" });
    }
  };

  const toggleCheckAssignment = (checkKey: string) => {
    setAssignedCheckKeys(prev =>
      prev.includes(checkKey) ? prev.filter(k => k !== checkKey) : [...prev, checkKey]
    );
  };

  const updateField = <K extends keyof MonitoringPackage>(key: K, value: MonitoringPackage[K]) => {
    setEditingPkg(prev => prev ? { ...prev, [key]: value } : prev);
  };

  const filtered = packages.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.key.toLowerCase().includes(q) || p.label.toLowerCase().includes(q);
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Monitoring Packages</h2>
          <p className="text-sm text-gray-400 mt-1">Named groups of Monitor Checks assigned to customer tenants</p>
        </div>
        <Button onClick={openCreate} className="bg-[#0078D4] hover:bg-[#006cbf] text-white">
          + New Package
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <Input
          placeholder="Search packages…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm bg-[#161B22] border-[#30363D] text-white"
        />
        <span className="text-sm text-gray-500">{filtered.length} packages</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-500">No monitoring packages yet — create the first one</div>
          )}
          {filtered.map(pkg => (
            <div key={pkg.key} className="bg-[#161B22] border border-[#30363D] rounded-lg overflow-hidden">
              <div className="p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm text-[#0078D4]">{pkg.key}</span>
                    <Badge variant="outline" className={pkg.status === "active" ? "border-green-500/30 text-green-400" : "border-gray-500/30 text-gray-400"}>
                      {pkg.status}
                    </Badge>
                    {pkg.engines.length > 0 && (
                      <span className="text-xs text-gray-500">{pkg.engines.join(", ")} engines</span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-white font-medium">{pkg.label}</div>
                  {pkg.description && <div className="text-xs text-gray-400 mt-0.5">{pkg.description}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleExpanded(pkg.key)}
                    className="text-gray-400 hover:text-white h-8 text-xs"
                  >
                    {expandedPkg === pkg.key ? "▲ Checks" : "▼ Checks"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openChecksAssignment(pkg.key)} className="text-blue-400 hover:text-blue-300 h-8 text-xs">
                    Assign
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(pkg)} className="text-gray-400 hover:text-white h-8">
                    Edit
                  </Button>
                  {pkg.status === "active" && (
                    <Button size="sm" variant="ghost" onClick={() => handleArchive(pkg)} className="text-red-400 hover:text-red-300 h-8">
                      Archive
                    </Button>
                  )}
                </div>
              </div>

              {expandedPkg === pkg.key && (
                <div className="border-t border-[#30363D] bg-[#0D1117] px-4 py-3">
                  {(pkgChecks[pkg.key] ?? []).length === 0 ? (
                    <p className="text-sm text-gray-500">No checks assigned — click Assign to add checks</p>
                  ) : (
                    <div className="space-y-2">
                      {(pkgChecks[pkg.key] ?? []).map((link, i) => (
                        <div key={link.checkKey} className="flex items-center gap-3 text-sm">
                          <span className="text-gray-500 w-4 text-right">{i + 1}.</span>
                          <span className="font-mono text-[#0078D4] text-xs">{link.checkKey}</span>
                          {link.check && (
                            <>
                              <span className="text-gray-300">{link.check.label}</span>
                              {link.check.requiresCustomerScript && (
                                <Badge variant="outline" className="border-purple-500/30 text-purple-400 text-xs">script</Badge>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-[#161B22] border-[#30363D] text-white max-w-lg">
          <DialogHeader><DialogTitle>{editingPkg?.id ? "Edit Package" : "New Monitoring Package"}</DialogTitle></DialogHeader>
          {editingPkg && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-gray-400 text-xs">Key *</Label>
                  <Input
                    value={editingPkg.key ?? ""}
                    onChange={e => updateField("key", e.target.value)}
                    placeholder="m365-security-baseline"
                    disabled={Boolean(editingPkg.id)}
                    className="bg-[#0D1117] border-[#30363D] text-white mt-1 font-mono text-sm"
                  />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">Label *</Label>
                  <Input
                    value={editingPkg.label ?? ""}
                    onChange={e => updateField("label", e.target.value)}
                    placeholder="M365 Security Baseline"
                    className="bg-[#0D1117] border-[#30363D] text-white mt-1"
                  />
                </div>
              </div>
              <div>
                <Label className="text-gray-400 text-xs">Description</Label>
                <Textarea
                  value={editingPkg.description ?? ""}
                  onChange={e => updateField("description", e.target.value)}
                  rows={2}
                  className="bg-[#0D1117] border-[#30363D] text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-gray-400 text-xs">Engines to recompute on new results (comma-separated)</Label>
                <Input
                  value={(editingPkg.engines ?? []).join(", ")}
                  onChange={e => updateField("engines", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                  placeholder="health, monitoring, priority"
                  className="bg-[#0D1117] border-[#30363D] text-white mt-1 font-mono text-sm"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDialog(false)} className="text-gray-400">Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-[#0078D4] hover:bg-[#006cbf] text-white">
              {saving ? "Saving…" : "Save Package"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showChecksDialog} onOpenChange={setShowChecksDialog}>
        <DialogContent className="bg-[#161B22] border-[#30363D] text-white max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Assign Checks to {selectedPkgKey}</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-400">Select the checks to include in this package. Order is preserved.</p>
          <div className="space-y-2 mt-2">
            {allChecks.filter(c => c.status === "active").map(check => (
              <label key={check.key} className="flex items-start gap-3 p-3 rounded-lg hover:bg-[#0D1117] cursor-pointer">
                <input
                  type="checkbox"
                  checked={assignedCheckKeys.includes(check.key)}
                  onChange={() => toggleCheckAssignment(check.key)}
                  className="mt-0.5 accent-[#0078D4]"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[#0078D4]">{check.key}</span>
                    <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-400">{check.frequency}</Badge>
                    {check.requiresCustomerScript && (
                      <Badge variant="outline" className="text-xs border-purple-500/30 text-purple-400">script</Badge>
                    )}
                  </div>
                  <div className="text-sm text-white">{check.label}</div>
                  <div className="text-xs text-gray-500 font-mono">{check.endpoint}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="mt-2 text-sm text-gray-400">
            {assignedCheckKeys.length} selected: {assignedCheckKeys.join(", ") || "none"}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowChecksDialog(false)} className="text-gray-400">Cancel</Button>
            <Button onClick={handleSaveChecks} disabled={saving} className="bg-[#0078D4] hover:bg-[#006cbf] text-white">
              {saving ? "Saving…" : "Save Assignment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
