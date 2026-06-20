import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface DriveItem {
  id: string;
  name: string;
  type: "folder" | "file";
  webUrl: string;
  size?: number;
  lastModified?: string;
}

interface HubConfig {
  hubSiteUrl: string | null;
  hubSiteId: string | null;
  graphConfigured: boolean;
}

interface ItemsResponse {
  items: DriveItem[];
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ type }: { type: "folder" | "file" }) {
  if (type === "folder") {
    return (
      <svg className="w-4 h-4 text-[#0078D4] flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
        <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-7 h-7 border-3 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function SharePointPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [config, setConfig] = useState<HubConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [hubUrlInput, setHubUrlInput] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  const [items, setItems] = useState<DriveItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ name: string; path: string | null }>>([
    { name: "Hub Storage", path: null },
  ]);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/sharepoint/hub-config");
      if (res.ok) {
        const data = await res.json() as HubConfig;
        setConfig(data);
        setHubUrlInput(data.hubSiteUrl ?? "");
      }
    } catch {
      // non-fatal
    } finally {
      setConfigLoading(false);
    }
  }, [fetchWithAuth]);

  const loadItems = useCallback(async (path: string | null) => {
    setItemsLoading(true);
    setItemsError(null);
    try {
      const url = path
        ? `/api/admin/sharepoint/hub/items?path=${encodeURIComponent(path)}`
        : "/api/admin/sharepoint/hub/items";
      const res = await fetchWithAuth(url);
      const data = await res.json() as ItemsResponse;
      if (!res.ok) {
        setItemsError(data.error ?? "Failed to load items");
        setItems([]);
      } else {
        setItems(data.items);
      }
    } catch {
      setItemsError("Network error loading SharePoint items");
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  useEffect(() => {
    if (config?.hubSiteId && config.graphConfigured) {
      void loadItems(null);
    }
  }, [config, loadItems]);

  const handleSaveConfig = async () => {
    if (!hubUrlInput.trim()) return;
    setSavingConfig(true);
    try {
      const res = await fetchWithAuth("/api/admin/sharepoint/hub-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hubSiteUrl: hubUrlInput.trim() }),
      });
      if (res.ok) {
        toast({ title: "Hub site saved", description: "SharePoint hub site URL has been saved." });
        await loadConfig();
      } else {
        toast({ title: "Error", description: "Failed to save hub site URL.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error.", variant: "destructive" });
    } finally {
      setSavingConfig(false);
    }
  };

  const navigateToFolder = (item: DriveItem) => {
    if (item.type !== "folder") {
      window.open(item.webUrl, "_blank", "noopener noreferrer");
      return;
    }
    const newPath = currentPath ? `${currentPath}/${item.name}` : item.name;
    setCurrentPath(newPath);
    setBreadcrumbs(prev => [...prev, { name: item.name, path: newPath }]);
    void loadItems(newPath);
  };

  const navigateToBreadcrumb = (crumb: { name: string; path: string | null }) => {
    setCurrentPath(crumb.path);
    setBreadcrumbs(prev => {
      const idx = prev.findIndex(c => c.path === crumb.path);
      return idx >= 0 ? prev.slice(0, idx + 1) : prev;
    });
    void loadItems(crumb.path);
  };

  const isConfigured = !!(config?.hubSiteId && config.graphConfigured);

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0A2540]">Hub Storage</h1>
        <p className="text-sm text-muted-foreground mt-1">Browse your SharePoint hub site and manage per-client site provisioning.</p>
      </div>

      {/* Graph credentials warning */}
      {config && !config.graphConfigured && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
          <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber-800">Microsoft Graph not configured</p>
            <p className="text-xs text-amber-700 mt-0.5">Set <code className="bg-amber-100 px-1 rounded">GRAPH_TENANT_ID</code>, <code className="bg-amber-100 px-1 rounded">GRAPH_CLIENT_ID</code>, and <code className="bg-amber-100 px-1 rounded">GRAPH_CLIENT_SECRET</code> in Replit Secrets to enable automatic site browsing and provisioning. Required Graph permissions: <strong>Sites.ReadWrite.All</strong>, <strong>Group.ReadWrite.All</strong>.</p>
          </div>
        </div>
      )}

      {/* Hub site configuration */}
      <div className="bg-white border border-border rounded-xl p-5 mb-6">
        <h2 className="text-sm font-bold text-[#0A2540] uppercase tracking-wider mb-4">Hub Site Configuration</h2>
        {configLoading ? (
          <div className="h-10 bg-muted/20 rounded animate-pulse" />
        ) : (
          <div className="space-y-3">
            {config?.hubSiteUrl && (
              <div className="flex items-center gap-2 text-sm text-[#0A2540]/70">
                <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="truncate">Saved: <a href={config.hubSiteUrl} target="_blank" rel="noopener noreferrer" className="text-[#0078D4] underline">{config.hubSiteUrl}</a></span>
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="url"
                value={hubUrlInput}
                onChange={e => setHubUrlInput(e.target.value)}
                placeholder="https://contoso.sharepoint.com/sites/SMC-Hub"
                className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
              />
              <button
                onClick={() => void handleSaveConfig()}
                disabled={savingConfig || !hubUrlInput.trim()}
                className="bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors disabled:opacity-50"
              >
                {savingConfig ? "Saving…" : "Save"}
              </button>
              {config?.hubSiteUrl && (
                <a
                  href={config.hubSiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 border border-border text-sm font-medium px-3 py-2 rounded-lg hover:bg-[#F7F9FC] transition-colors text-[#0A2540]"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                  Open
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* File browser */}
      <div className="bg-white border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-sm min-w-0">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1.5 min-w-0">
                {i > 0 && <svg className="w-3 h-3 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>}
                <button
                  onClick={() => navigateToBreadcrumb(crumb)}
                  className={`truncate transition-colors ${
                    i === breadcrumbs.length - 1
                      ? "font-semibold text-[#0A2540] cursor-default"
                      : "text-[#0078D4] hover:underline"
                  }`}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
          {config?.hubSiteId && config.graphConfigured && (
            <button
              onClick={() => void loadItems(currentPath)}
              className="text-xs text-muted-foreground hover:text-[#0078D4] flex items-center gap-1 flex-shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              Refresh
            </button>
          )}
        </div>

        {!config || configLoading ? (
          <Spinner />
        ) : !config.graphConfigured ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="w-12 h-12 rounded-2xl bg-muted/20 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-[#0A2540]">Graph credentials required</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">Configure the Graph API credentials in Replit Secrets to browse SharePoint files here.</p>
          </div>
        ) : !config.hubSiteId ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="w-12 h-12 rounded-2xl bg-[#0078D4]/10 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10.5v6m3-3H9m4.06-7.19l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-[#0A2540]">No hub site configured</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">Enter your SharePoint hub site URL above and click Save. The site ID will be resolved automatically.</p>
          </div>
        ) : itemsLoading ? (
          <Spinner />
        ) : itemsError ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-6">
            <p className="text-sm font-semibold text-red-600">Error loading files</p>
            <p className="text-xs text-muted-foreground mt-1">{itemsError}</p>
            <button onClick={() => void loadItems(currentPath)} className="mt-3 text-xs text-[#0078D4] hover:underline">Try again</button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-muted-foreground">This folder is empty</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map(item => (
              <button
                key={item.id}
                onClick={() => navigateToFolder(item)}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-[#F7F9FC] transition-colors text-left group"
              >
                <FileIcon type={item.type} />
                <span className="flex-1 min-w-0">
                  <span className={`text-sm truncate block ${item.type === "folder" ? "font-medium text-[#0A2540]" : "text-[#0A2540]/80"}`}>
                    {item.name}
                  </span>
                  {item.size != null && (
                    <span className="text-xs text-muted-foreground">{formatBytes(item.size)}</span>
                  )}
                </span>
                <svg className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.type === "folder" ? "M9 5l7 7-7 7" : "M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"} />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
