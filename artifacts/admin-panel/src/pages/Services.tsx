import { useState, useEffect, useRef } from "react";
import { useServices, useReparentCategory } from "@/hooks/useServices";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import CatalogCategoryTree from "@/components/services/CatalogCategoryTree";
import CatalogProductList from "@/components/services/CatalogProductList";
import CatalogDetailPanel from "@/components/services/CatalogDetailPanel";
import CatalogQuickJump from "@/components/services/CatalogQuickJump";

export default function ServicesPage() {
  const { data: services = [], isLoading, refetch } = useServices();
  const reparentMutation = useReparentCategory();
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [selectedCategoryPath, setSelectedCategoryPath] = useState<string | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [cmdKOpen, setCmdKOpen] = useState(false);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdKOpen(o => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const allCategoryPaths = [...new Set(
    services.map(s => s.categoryPath ?? s.category).filter(Boolean) as string[]
  )].sort();

  function handleReparentCategory(fromPath: string, toParentPath: string | null) {
    const lastName = fromPath.includes("/") ? fromPath.split("/").pop()! : fromPath;
    const newPath = toParentPath ? `${toParentPath}/${lastName}` : lastName;
    reparentMutation.mutate(
      { fromPath, toParentPath },
      {
        onSuccess: () => {
          if (selectedCategoryPath === fromPath || selectedCategoryPath?.startsWith(fromPath + "/")) {
            setSelectedCategoryPath(
              selectedCategoryPath === fromPath
                ? newPath
                : newPath + selectedCategoryPath.slice(fromPath.length),
            );
          }
        },
      },
    );
  }

  async function handleDownloadTemplate() {
    try {
      const res = await fetchWithAuth("/api/admin/catalog/import-template");
      if (!res.ok) { toast({ title: "Download failed", variant: "destructive" }); return; }
      const data = await res.json() as unknown;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "services-import-template.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  }

  async function handleExport() {
    try {
      const res = await fetchWithAuth("/api/admin/catalog/export");
      if (!res.ok) { toast({ title: "Export failed", variant: "destructive" }); return; }
      const data = await res.json() as unknown;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `services-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  }

  async function handleImport() {
    setImporting(true);
    try {
      let body: unknown;
      try { body = JSON.parse(importJson); } catch { toast({ title: "Invalid JSON", variant: "destructive" }); return; }
      const res = await fetchWithAuth("/api/admin/catalog/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json() as { imported: number; skipped: number; errors: string[] };
        toast({ title: `Imported ${data.imported} service${data.imported !== 1 ? "s" : ""}.${data.skipped > 0 ? ` ${data.skipped} skipped.` : ""}` });
        if (data.errors.length > 0) {
          toast({ title: `Import warnings: ${data.errors.slice(0, 3).join("; ")}`, variant: "destructive" });
        }
        setShowImportModal(false);
        setImportJson("");
        void refetch();
      } else {
        const err = await res.json().catch(() => ({ error: "Import failed" })) as { error: string };
        toast({ title: err.error ?? "Import failed", variant: "destructive" });
      }
    } finally { setImporting(false); }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setImportJson(String(ev.target?.result ?? ""));
    reader.readAsText(file);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-end gap-2 px-4 py-2 border-b border-[#21262D] bg-[#0D1117]">
        <button
          onClick={() => void handleDownloadTemplate()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-[#161B22] border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#1C2128] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Download Template
        </button>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-[#161B22] border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#1C2128] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export JSON
        </button>
        <button
          onClick={() => { setImportJson(""); setShowImportModal(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-[#161B22] border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#1C2128] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
          </svg>
          Import JSON
        </button>
      </div>

      {/* Main 3-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        <CatalogCategoryTree
          services={services}
          selectedPath={selectedCategoryPath}
          onSelect={(path) => {
            setSelectedCategoryPath(path);
            setSelectedServiceId(null);
            setIsCreating(false);
          }}
          onReparentCategory={handleReparentCategory}
          reparenting={reparentMutation.isPending}
        />
        <CatalogProductList
          services={services}
          isLoading={isLoading}
          categoryPath={selectedCategoryPath}
          selectedId={selectedServiceId}
          onSelect={(id) => {
            setSelectedServiceId(id);
            setIsCreating(false);
          }}
          onCreateNew={() => {
            setSelectedServiceId(null);
            setIsCreating(true);
          }}
        />
        <CatalogDetailPanel
          serviceId={isCreating ? null : selectedServiceId}
          isCreating={isCreating}
          onCreated={(id) => {
            setSelectedServiceId(id);
            setIsCreating(false);
          }}
          onDeselect={() => {
            setSelectedServiceId(null);
            setIsCreating(false);
          }}
          allCategoryPaths={allCategoryPaths}
        />
        <CatalogQuickJump
          open={cmdKOpen}
          onClose={() => setCmdKOpen(false)}
          services={services}
          onSelect={(id, categoryPath) => {
            setSelectedCategoryPath(categoryPath);
            setSelectedServiceId(id);
            setIsCreating(false);
            setCmdKOpen(false);
          }}
        />
      </div>

      {/* Import modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl w-full max-w-xl mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363D]">
              <h2 className="text-sm font-semibold text-[#E6EDF3]">Import Service Catalog</h2>
              <button onClick={() => setShowImportModal(false)} className="text-[#484F58] hover:text-[#C9D1D9] transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-[#7D8590]">
                Paste a services export JSON or load a file. Each service is upserted by <code className="bg-[#21262D] px-1 rounded">slug</code> — existing services with the same slug are updated.
              </p>
              <div>
                <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileChange} className="hidden" />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs px-3 py-1.5 rounded border border-[#30363D] bg-[#21262D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#30363D] transition-colors"
                >
                  Load from file…
                </button>
              </div>
              <textarea
                value={importJson}
                onChange={e => setImportJson(e.target.value)}
                placeholder='{"version":1,"services":[...]}'
                rows={10}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#C9D1D9] placeholder-[#484F58] font-mono focus:outline-none focus:border-[#0078D4] transition-colors resize-none"
              />
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#30363D]">
              <button onClick={() => setShowImportModal(false)} className="px-4 py-2 text-xs rounded-lg border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] transition-colors">
                Cancel
              </button>
              <button
                onClick={() => void handleImport()}
                disabled={!importJson.trim() || importing}
                className="px-4 py-2 text-xs rounded-lg bg-[#0078D4] text-white hover:bg-[#106EBE] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {importing ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
