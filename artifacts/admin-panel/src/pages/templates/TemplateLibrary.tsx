import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface DriveItem {
  driveItemId: string;
  name: string;
  webUrl: string;
  mimeType: string | null;
  folder: boolean;
  lastModifiedDateTime: string | null;
}

interface NodeState {
  expanded: boolean;
  children: DriveItem[] | null;
  loading: boolean;
}

type SiteConfig = {
  templateSiteUrl: string | null;
  templateSiteId: string | null;
  graphConfigured: boolean;
};

function fileTypeKey(item: DriveItem): string {
  if (item.folder) return "folder";
  const mime = item.mimeType ?? "";
  const name = item.name.toLowerCase();
  if (name.endsWith(".docx") || name.endsWith(".doc") || mime.includes("word")) return "word";
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || mime.includes("excel") || mime.includes("spreadsheet")) return "excel";
  if (name.endsWith(".pptx") || name.endsWith(".ppt") || mime.includes("powerpoint") || mime.includes("presentation")) return "powerpoint";
  if (name.endsWith(".pdf") || mime.includes("pdf")) return "pdf";
  if (mime.startsWith("image/")) return "image";
  return "file";
}

function FileIcon({ item }: { item: DriveItem }) {
  const type = fileTypeKey(item);
  if (type === "folder") return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2F6FED" strokeWidth={1.75} className="flex-shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
  if (type === "word") return (
    <svg width="16" height="16" viewBox="0 0 24 24" className="flex-shrink-0">
      <rect width="24" height="24" rx="3" fill="#2B579A" />
      <text x="5" y="17" fontSize="11" fontWeight="bold" fill="white">W</text>
    </svg>
  );
  if (type === "excel") return (
    <svg width="16" height="16" viewBox="0 0 24 24" className="flex-shrink-0">
      <rect width="24" height="24" rx="3" fill="#217346" />
      <text x="5" y="17" fontSize="11" fontWeight="bold" fill="white">X</text>
    </svg>
  );
  if (type === "powerpoint") return (
    <svg width="16" height="16" viewBox="0 0 24 24" className="flex-shrink-0">
      <rect width="24" height="24" rx="3" fill="#D24726" />
      <text x="5" y="17" fontSize="11" fontWeight="bold" fill="white">P</text>
    </svg>
  );
  if (type === "pdf") return (
    <svg width="16" height="16" viewBox="0 0 24 24" className="flex-shrink-0">
      <rect width="24" height="24" rx="3" fill="#E53E3E" />
      <text x="2" y="17" fontSize="9" fontWeight="bold" fill="white">PDF</text>
    </svg>
  );
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth={1.5} className="flex-shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return ""; }
}

function TreeNode({
  item,
  itemPath,
  depth,
  nodeStates,
  onToggle,
}: {
  item: DriveItem;
  itemPath: string;
  depth: number;
  nodeStates: Record<string, NodeState>;
  onToggle: (item: DriveItem, itemPath: string) => void;
}) {
  const state = nodeStates[item.driveItemId];
  const isExpanded = state?.expanded ?? false;
  const isLoading = state?.loading ?? false;
  const children = state?.children ?? null;
  const indentPx = depth * 20;

  const sorted = children
    ? [...children].sort((a, b) => {
        if (a.folder && !b.folder) return -1;
        if (!a.folder && b.folder) return 1;
        return a.name.localeCompare(b.name);
      })
    : null;

  return (
    <>
      <div
        className={`flex items-center gap-2 py-2 pr-4 rounded-lg transition-colors group ${item.folder ? "cursor-pointer hover:bg-accent" : "hover:bg-accent/60"}`}
        style={{ paddingLeft: `${indentPx + 12}px` }}
        onClick={item.folder ? () => onToggle(item, itemPath) : undefined}
      >
        {/* Expand/collapse chevron for folders */}
        <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
          {item.folder && (
            isLoading ? (
              <div className="w-3 h-3 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
            ) : (
              <svg
                className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            )
          )}
        </span>

        <FileIcon item={item} />

        <span className={`flex-1 min-w-0 text-sm truncate ${item.folder ? "font-medium text-foreground" : "text-foreground"}`}>
          {item.name}
        </span>

        {!item.folder && item.lastModifiedDateTime && (
          <span className="text-xs text-muted-foreground flex-shrink-0 hidden sm:block">
            {formatDate(item.lastModifiedDateTime)}
          </span>
        )}

        {!item.folder && (
          <a
            href={item.webUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1 text-xs text-primary hover:underline font-medium flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            Open
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
        )}
      </div>

      {/* Children (rendered inline when expanded) */}
      {isExpanded && sorted && sorted.map(child => (
        <TreeNode
          key={child.driveItemId}
          item={child}
          itemPath={itemPath ? `${itemPath}/${child.name}` : child.name}
          depth={depth + 1}
          nodeStates={nodeStates}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

export default function TemplateLibraryPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [siteInput, setSiteInput] = useState("");
  const [saving, setSaving] = useState(false);

  const [rootItems, setRootItems] = useState<DriveItem[] | null>(null);
  const [rootLoading, setRootLoading] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);

  const [nodeStates, setNodeStates] = useState<Record<string, NodeState>>({});

  const fetchItems = useCallback(async (folderPath: string): Promise<DriveItem[]> => {
    const qs = folderPath ? `?folder=${encodeURIComponent(folderPath)}` : "";
    const res = await fetchWithAuth(`/api/admin/sharepoint/templates/items${qs}`);
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      throw new Error(d.error ?? "Failed to load files");
    }
    const d = await res.json() as { items: DriveItem[] };
    return d.items ?? [];
  }, [fetchWithAuth]);

  const loadRoot = useCallback(async () => {
    setRootLoading(true);
    setRootError(null);
    try {
      const items = await fetchItems("");
      setRootItems(items.sort((a, b) => {
        if (a.folder && !b.folder) return -1;
        if (!a.folder && b.folder) return 1;
        return a.name.localeCompare(b.name);
      }));
    } catch (err) {
      setRootError((err as Error).message);
      setRootItems(null);
    } finally {
      setRootLoading(false);
    }
  }, [fetchItems]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/sharepoint/template-site");
        if (res.ok) {
          const d = await res.json() as SiteConfig;
          setConfig(d);
          setSiteInput(d.templateSiteUrl ?? "");
          if (d.templateSiteId) void loadRoot();
        }
      } finally {
        setConfigLoading(false);
      }
    })();
  }, [fetchWithAuth, loadRoot]);

  const handleSaveUrl = async () => {
    if (!siteInput.trim()) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/admin/sharepoint/template-site", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateSiteUrl: siteInput.trim() }),
      });
      if (res.ok) {
        const d = await res.json() as SiteConfig;
        setConfig(d);
        setNodeStates({});
        if (d.templateSiteId) {
          toast({ title: "Template site URL saved" });
          void loadRoot();
        } else if (!d.graphConfigured) {
          toast({ title: "URL saved", description: "Configure Graph credentials to browse files." });
        } else {
          toast({ title: "URL saved but could not resolve site", description: "Check URL and Graph permissions.", variant: "destructive" });
        }
      } else {
        const d = await res.json() as { error?: string };
        toast({ title: d.error ?? "Error saving URL", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = useCallback(async (item: DriveItem, itemPath: string) => {
    const current = nodeStates[item.driveItemId];
    const isExpanded = current?.expanded ?? false;
    const hasChildren = current?.children !== null && current?.children !== undefined;

    if (isExpanded) {
      setNodeStates(prev => ({ ...prev, [item.driveItemId]: { ...prev[item.driveItemId], expanded: false } }));
      return;
    }

    if (hasChildren) {
      setNodeStates(prev => ({ ...prev, [item.driveItemId]: { ...prev[item.driveItemId], expanded: true } }));
      return;
    }

    setNodeStates(prev => ({
      ...prev,
      [item.driveItemId]: { expanded: false, children: null, loading: true },
    }));
    try {
      const children = await fetchItems(itemPath);
      setNodeStates(prev => ({
        ...prev,
        [item.driveItemId]: { expanded: true, children, loading: false },
      }));
    } catch (err) {
      setNodeStates(prev => ({
        ...prev,
        [item.driveItemId]: { expanded: false, children: null, loading: false },
      }));
      toast({ title: (err as Error).message, variant: "destructive" });
    }
  }, [nodeStates, fetchItems, toast]);

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const configured = Boolean(config?.templateSiteId);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Template Library</h1>
          <p className="text-sm text-muted-foreground mt-1">Browse files from the Template Team SharePoint site</p>
        </div>
        {config?.templateSiteUrl && (
          <a
            href={config.templateSiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-primary hover:underline flex-shrink-0"
          >
            Open in SharePoint
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
        )}
      </div>

      {/* ── Site URL config card ─────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-5 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Template Team Site URL</p>
        <div className="flex gap-2">
          <input
            type="url"
            value={siteInput}
            onChange={e => setSiteInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") void handleSaveUrl(); }}
            placeholder="https://tenant.sharepoint.com/sites/TemplateTeam"
            className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            onClick={() => void handleSaveUrl()}
            disabled={saving || !siteInput.trim()}
            className="flex items-center gap-1.5 bg-[#0A2540] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0A2540]/90 disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {saving && <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        {!config?.graphConfigured && (
          <p className="text-xs text-amber-600 mt-2">
            Graph credentials not configured — set{" "}
            <code className="font-mono bg-amber-500/10 px-1 rounded">GRAPH_TENANT_ID</code>,{" "}
            <code className="font-mono bg-amber-500/10 px-1 rounded">GRAPH_CLIENT_ID</code>, and{" "}
            <code className="font-mono bg-amber-500/10 px-1 rounded">GRAPH_CLIENT_SECRET</code>{" "}
            to browse files.
          </p>
        )}
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!configured && (
        <div className="bg-card border border-border rounded-xl p-12 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-foreground mb-2">Template site not connected</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Paste the URL of your Template Team SharePoint site above and click Save. Once connected, all documents and folders will appear here with expand/collapse controls.
          </p>
          {!config?.graphConfigured && (
            <p className="text-xs text-amber-600 mt-3 max-w-sm">
              You'll also need Graph API credentials configured before files can be browsed.
            </p>
          )}
        </div>
      )}

      {/* ── Tree browser ────────────────────────────────────────────────────── */}
      {configured && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-accent">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span className="text-sm font-semibold text-foreground">Document Library</span>
            </div>
            <button
              onClick={() => { setNodeStates({}); void loadRoot(); }}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>

          {/* Tree content */}
          <div className="p-2">
            {rootLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-7 h-7 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : rootError ? (
              <div className="flex flex-col items-center py-16 text-center px-6">
                <svg className="w-10 h-10 text-red-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <p className="text-sm font-semibold text-foreground mb-1">{rootError}</p>
                <button onClick={() => void loadRoot()} className="text-sm text-primary hover:underline">
                  Try again
                </button>
              </div>
            ) : !rootItems || rootItems.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <svg className="w-10 h-10 text-muted-foreground/40 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <p className="text-sm text-muted-foreground">The document library is empty</p>
              </div>
            ) : (
              rootItems.map(item => (
                <TreeNode
                  key={item.driveItemId}
                  item={item}
                  itemPath={item.name}
                  depth={0}
                  nodeStates={nodeStates}
                  onToggle={handleToggle}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
