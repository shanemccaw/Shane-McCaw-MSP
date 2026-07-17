import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { 
  Database, 
  Search, 
  Copy, 
  Eye, 
  RefreshCw, 
  Loader2, 
  AlertCircle, 
  FileJson
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";

interface Profile {
  id: number;
  profileId: string;
  tenantId: string;
  checkKey: string;
  checkSchemaVersion: number;
  triggerId: string;
  idempotencyKey: string;
  status: "ok" | "error" | "consent_revoked" | "requires_script";
  rawResponse: Record<string, any> | null;
  extractedProperties: Record<string, any> | null;
  severityMatched: string | null;
  errorMessage: string | null;
  itemCount: number | null;
  pageCount: number | null;
  collectedAt: string;
  createdAt: string;
  clientName?: string;
  clientCompany?: string;
}

export default function GraphApiResultsPage() {
  const { fetchWithAuth } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters state
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [limit, setLimit] = useState<number>(100);

  // Inspector dialog state
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [activeJsonTab, setActiveJsonTab] = useState<"raw" | "extracted">("raw");

  const loadProfiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/monitor-checks/profiles?limit=${limit}`);
      if (res.ok) {
        const data = await res.json();
        setProfiles(data.profiles || []);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to load Graph API results");
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to communicate with server");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, [limit]);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label} JSON to clipboard`);
  };

  // Filter logic
  const filteredProfiles = profiles.filter(p => {
    const matchSearch = 
      p.checkKey.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.tenantId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.clientName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.clientCompany || "").toLowerCase().includes(searchTerm.toLowerCase());

    const matchStatus = statusFilter === "all" || p.status === statusFilter;

    return matchSearch && matchStatus;
  });

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "ok":
        return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25";
      case "error":
        return "bg-rose-500/10 text-rose-400 border border-rose-500/25";
      case "consent_revoked":
        return "bg-amber-500/10 text-amber-400 border border-amber-500/25";
      default:
        return "bg-slate-800 text-slate-400 border border-slate-700";
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#070b13] text-slate-100 font-sans p-6 overflow-y-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4 shrink-0">
        <div>
          <h2 className="text-base font-bold text-slate-200 uppercase tracking-wide flex items-center gap-2">
            <Database className="w-4 h-4 text-indigo-400" /> Graph API Response Cache Explorer
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Browse and inspect raw JSON payloads returned from Microsoft Graph API monitor checks.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadProfiles}
          disabled={loading}
          className="h-8 border-slate-800 hover:bg-slate-900 bg-transparent text-slate-400 hover:text-slate-200"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {/* Toolbar / Filters */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 flex flex-wrap gap-4 items-center shrink-0">
        {/* Search */}
        <div className="flex-1 min-w-[240px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search by client name, company, or check key..."
            className="pl-9 h-9 bg-slate-950 border-slate-800 text-slate-200 text-xs focus:ring-indigo-600/30"
          />
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Status:</span>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-semibold"
          >
            <option value="all">All Statuses</option>
            <option value="ok">OK</option>
            <option value="error">Error</option>
            <option value="consent_revoked">Consent Revoked</option>
            <option value="requires_script">Requires Script</option>
          </select>
        </div>

        {/* Limit Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Limit:</span>
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-semibold"
          >
            <option value={50}>Last 50</option>
            <option value={100}>Last 100</option>
            <option value={200}>Last 200</option>
            <option value={500}>Last 500</option>
            <option value={1000}>Last 1000</option>
          </select>
        </div>
      </div>

      {/* Main Table Content */}
      <div className="flex-1 min-h-0 bg-slate-955/40 border border-slate-900 rounded-xl overflow-hidden">
        {loading && profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
            <span className="text-xs font-semibold">Loading Graph API Cache records...</span>
          </div>
        ) : error ? (
          <div className="p-6 text-center text-rose-400 bg-rose-950/10 border border-rose-900/30 rounded-xl flex items-center justify-center gap-2 max-w-2xl mx-auto my-10">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-xs font-medium">{error}</span>
          </div>
        ) : filteredProfiles.length === 0 ? (
          <div className="text-center py-20 text-slate-500 border border-dashed border-slate-900 rounded-xl">
            <Database className="w-12 h-12 text-slate-800 mx-auto mb-3" />
            <h4 className="font-semibold text-slate-400">No Cache Results Found</h4>
            <p className="text-xs max-w-sm mx-auto mt-1">Please try modifying your search parameters or query filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[60vh] scrollbar-thin scrollbar-thumb-slate-800">
            <Table>
              <TableHeader className="bg-slate-900/40 border-slate-900">
                <TableRow className="border-slate-900 hover:bg-transparent">
                  <TableHead className="text-xs font-semibold text-slate-400 py-3 px-4 font-mono uppercase tracking-wider select-none">Client/Tenant</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-400 py-3 px-4 font-mono uppercase tracking-wider select-none">Check Key</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-400 py-3 px-4 font-mono uppercase tracking-wider select-none text-center">Status</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-400 py-3 px-4 font-mono uppercase tracking-wider select-none text-center">Items (Pages)</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-400 py-3 px-4 font-mono uppercase tracking-wider select-none">Collected At</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-400 py-3 px-4 font-mono uppercase tracking-wider select-none text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProfiles.map((p) => (
                  <TableRow key={p.id} className="border-slate-900 hover:bg-slate-900/20 transition-colors">
                    {/* Client Column */}
                    <TableCell className="py-3.5 px-4">
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-slate-200">{p.clientName || "Unknown Client"}</span>
                        <span className="text-[10px] text-slate-500 font-mono mt-0.5">{p.clientCompany || "System User"} (ID: {p.tenantId})</span>
                      </div>
                    </TableCell>

                    {/* CheckKey Column */}
                    <TableCell className="py-3.5 px-4 font-mono text-xs text-slate-300">
                      {p.checkKey}
                    </TableCell>

                    {/* Status Column */}
                    <TableCell className="py-3.5 px-4 text-center">
                      <Badge className={`rounded px-1.5 py-0.5 text-[9px] font-mono font-bold capitalize select-none ${getStatusBadgeClass(p.status)}`}>
                        {p.status}
                      </Badge>
                    </TableCell>

                    {/* Item Count Column */}
                    <TableCell className="py-3.5 px-4 text-center font-mono text-xs text-slate-400">
                      {p.itemCount !== null ? `${p.itemCount} (${p.pageCount ?? 1})` : "-"}
                    </TableCell>

                    {/* Collected At Column */}
                    <TableCell className="py-3.5 px-4 font-mono text-[11px] text-slate-500">
                      {new Date(p.collectedAt).toLocaleString()}
                    </TableCell>

                    {/* Actions Column */}
                    <TableCell className="py-3.5 px-4 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setSelectedProfile(p);
                            setActiveJsonTab("raw");
                          }}
                          className="h-7 w-7 hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                          title="Inspect JSON Payload"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleCopy(JSON.stringify(p.rawResponse || {}, null, 2), "Raw")}
                          disabled={!p.rawResponse}
                          className="h-7 w-7 hover:bg-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-30"
                          title="Copy Raw JSON"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleCopy(JSON.stringify(p.extractedProperties || {}, null, 2), "Extracted")}
                          disabled={!p.extractedProperties}
                          className="h-7 w-7 hover:bg-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-30"
                          title="Copy Extracted JSON"
                        >
                          <FileJson className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* JSON Inspector Dialog */}
      <Dialog open={selectedProfile !== null} onOpenChange={(open) => { if (!open) setSelectedProfile(null); }}>
        {selectedProfile && (
          <DialogContent className="max-w-4xl bg-slate-955 border border-slate-800 text-slate-100 shadow-2xl p-6 rounded-xl flex flex-col max-h-[85vh]">
            <DialogHeader className="shrink-0 flex flex-row items-start justify-between border-b border-slate-900 pb-3">
              <div>
                <DialogTitle className="text-slate-200 text-base font-semibold">
                  JSON Inspector: {selectedProfile.checkKey}
                </DialogTitle>
                <DialogDescription className="text-slate-500 text-xs mt-1">
                  Tenant: {selectedProfile.clientName} | Collected at: {new Date(selectedProfile.collectedAt).toLocaleString()}
                </DialogDescription>
              </div>
            </DialogHeader>

            {/* JSON Tabs Selection */}
            <div className="shrink-0 flex border-b border-slate-900 mt-3">
              <button
                onClick={() => setActiveJsonTab("raw")}
                className={`px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors uppercase tracking-wider ${
                  activeJsonTab === "raw"
                    ? "text-[#58A6FF] border-[#0078D4] bg-slate-900/30"
                    : "text-[#7D8590] border-transparent hover:text-[#E6EDF3]"
                }`}
              >
                Raw Graph API Response
              </button>
              <button
                onClick={() => setActiveJsonTab("extracted")}
                className={`px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors uppercase tracking-wider ${
                  activeJsonTab === "extracted"
                    ? "text-[#58A6FF] border-[#0078D4] bg-slate-900/30"
                    : "text-[#7D8590] border-transparent hover:text-[#E6EDF3]"
                }`}
              >
                Extracted Properties
              </button>
            </div>

            {/* JSON Explorer Area */}
            <div className="flex-1 min-h-0 overflow-y-auto mt-4 rounded-lg bg-slate-900 border border-slate-800 relative scrollbar-thin scrollbar-thumb-slate-850">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const targetJson = activeJsonTab === "raw" ? selectedProfile.rawResponse : selectedProfile.extractedProperties;
                  handleCopy(JSON.stringify(targetJson || {}, null, 2), activeJsonTab === "raw" ? "Raw" : "Extracted");
                }}
                className="absolute right-3 top-3 bg-slate-950/80 border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-900 text-[10px] h-7 px-2"
              >
                <Copy className="w-3 h-3 mr-1" /> Copy JSON
              </Button>
              <pre className="p-4 font-mono text-[11px] text-emerald-400 leading-relaxed overflow-x-auto select-text selection:bg-indigo-600/30">
                {JSON.stringify(
                  (activeJsonTab === "raw" ? selectedProfile.rawResponse : selectedProfile.extractedProperties) || {},
                  null,
                  2
                )}
              </pre>
            </div>

            <DialogFooter className="shrink-0 border-t border-slate-900 pt-3 flex justify-between items-center mt-4">
              <span className="text-[10px] text-slate-500 font-mono">
                Size: {JSON.stringify(activeJsonTab === "raw" ? selectedProfile.rawResponse : selectedProfile.extractedProperties || {}).length} bytes
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedProfile(null)}
                className="bg-transparent border-slate-800 hover:bg-slate-900 hover:text-slate-100 text-xs px-4"
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
