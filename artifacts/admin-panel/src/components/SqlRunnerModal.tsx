import React, { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import { 
  Database, Play, Save, Trash2, Download, Search, X, 
  Folder, FolderOpen, Plus, Terminal, RefreshCw, FileText
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SavedScript {
  id: string;
  name: string;
  category: string;
  sql: string;
  description?: string;
  createdAt: string;
}

interface SqlRunnerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_SCRIPTS: SavedScript[] = [
  {
    id: "1",
    name: "List Active MSP Tenants",
    category: "Diagnostics",
    sql: "SELECT id, name, slug, status, created_at \nFROM msps \nWHERE status = 'active' \nORDER BY created_at DESC;",
    description: "Queries all active MSP profiles on the platform.",
    createdAt: new Date().toISOString()
  },
  {
    id: "2",
    name: "Audit Unresolved Alert Events",
    category: "Alerting",
    sql: "SELECT id, rule_key, severity, fired_at, summary \nFROM alert_events \nWHERE resolved_at IS NULL \nORDER BY fired_at DESC LIMIT 50;",
    description: "Checks for active alerts that require operator attention.",
    createdAt: new Date().toISOString()
  },
  {
    id: "3",
    name: "Active Users List",
    category: "Reporting",
    sql: "SELECT id, email, role, msp_id, last_login \nFROM users \nORDER BY last_login DESC;",
    description: "Returns lists of administrators and platform operators.",
    createdAt: new Date().toISOString()
  }
];

// Mock database data generator for queries
const MOCK_DATASETS: Record<string, Array<Record<string, any>>> = {
  msps: [
    { id: 101, name: "Shane McCaw Consulting", slug: "smc-consulting", status: "active", created_at: "2026-01-10 09:30:00" },
    { id: 102, name: "Apex IT Services", slug: "apex-it", status: "active", created_at: "2026-02-15 14:22:10" },
    { id: 103, name: "Summit Cloud MSP", slug: "summit-cloud", status: "trial", created_at: "2026-05-20 11:05:45" },
    { id: 104, name: "Vanguard Systems", slug: "vanguard", status: "suspended", created_at: "2025-11-01 08:00:00" },
    { id: 105, name: "Nova Infotech", slug: "nova-info", status: "active", created_at: "2026-06-01 16:45:12" }
  ],
  alert_events: [
    { id: 4501, rule_key: "dlq-age-exceeded", severity: "critical", fired_at: "2026-07-16 01:10:00", summary: "DLQ items older than 4 hours" },
    { id: 4502, rule_key: "webhook-delivery-failure", severity: "warning", fired_at: "2026-07-16 00:55:12", summary: "Failed hook response from end-point: 502 Bad Gateway" },
    { id: 4503, rule_key: "engine-score-drift", severity: "critical", fired_at: "2026-07-15 22:40:00", summary: "Score drift detected for customer-203. Engine: SLA-timer" }
  ],
  users: [
    { id: 1, email: "ronnie.operator@smc.io", role: "admin", msp_id: "smc-consulting", last_login: "2026-07-16 01:22:00" },
    { id: 2, email: "alex.support@apex.io", role: "operator", msp_id: "apex-it", last_login: "2026-07-15 18:40:11" },
    { id: 3, email: "clara.billing@summit.io", role: "operator", msp_id: "summit-cloud", last_login: "2026-07-16 00:05:00" }
  ]
};

export function SqlRunnerModal({ isOpen, onClose }: SqlRunnerModalProps) {
  const [sql, setSql] = useState<string>(DEFAULT_SCRIPTS[0].sql);
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    Diagnostics: true,
    Alerting: true,
    Reporting: true
  });

  // Saving Script State
  const [scriptName, setScriptName] = useState("");
  const [scriptCategory, setScriptCategory] = useState("Diagnostics");
  const [scriptDescription, setScriptDescription] = useState("");
  const [isSavingFormOpen, setIsSavingFormOpen] = useState(false);

  // Execution Results State
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<{ columns: string[]; rows: Array<Record<string, any>> } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [executionTimeMs, setExecutionTimeMs] = useState<number | null>(null);

  // Table Search and Pagination
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  useEffect(() => {
    const local = localStorage.getItem("admin_saved_sql_scripts");
    if (local) {
      try {
        setSavedScripts(JSON.parse(local));
      } catch {
        setSavedScripts(DEFAULT_SCRIPTS);
      }
    } else {
      setSavedScripts(DEFAULT_SCRIPTS);
      localStorage.setItem("admin_saved_sql_scripts", JSON.stringify(DEFAULT_SCRIPTS));
    }
  }, []);

  if (!isOpen) return null;

  // Save new script
  const handleSaveScript = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scriptName.trim()) return;

    const newScript: SavedScript = {
      id: Math.random().toString(36).substring(7),
      name: scriptName,
      category: scriptCategory,
      sql,
      description: scriptDescription,
      createdAt: new Date().toISOString()
    };

    const updated = [newScript, ...savedScripts];
    setSavedScripts(updated);
    localStorage.setItem("admin_saved_sql_scripts", JSON.stringify(updated));

    // Reset Form
    setScriptName("");
    setScriptDescription("");
    setIsSavingFormOpen(false);

    // Expand target category automatically
    setExpandedCategories(prev => ({ ...prev, [scriptCategory]: true }));
  };

  // Delete script
  const handleDeleteScript = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedScripts.filter(s => s.id !== id);
    setSavedScripts(updated);
    localStorage.setItem("admin_saved_sql_scripts", JSON.stringify(updated));
  };

  // Group scripts by category
  const categories = Array.from(new Set(savedScripts.map(s => s.category)));

  // Run Query
  const handleRunQuery = () => {
    setIsLoading(true);
    setErrorMsg(null);
    setResults(null);
    const start = performance.now();

    setTimeout(() => {
      const sqlLower = sql.toLowerCase();
      
      // Basic syntax validation
      if (!sqlLower.includes("select") && !sqlLower.includes("update") && !sqlLower.includes("delete") && !sqlLower.includes("insert")) {
        setErrorMsg("SQL Syntax Error: Query must begin with a valid SQL statement (SELECT, UPDATE, INSERT, DELETE).");
        setIsLoading(false);
        return;
      }

      // Check for table match
      let targetTable = "";
      if (sqlLower.includes("msps")) targetTable = "msps";
      else if (sqlLower.includes("alert_events")) targetTable = "alert_events";
      else if (sqlLower.includes("users")) targetTable = "users";

      if (targetTable && MOCK_DATASETS[targetTable]) {
        const data = MOCK_DATASETS[targetTable];
        const columns = Object.keys(data[0]);
        setResults({ columns, rows: data });
      } else {
        // Generic response
        setResults({
          columns: ["affected_rows", "status", "timestamp"],
          rows: [{ affected_rows: 0, status: "Success (Empty Result / Non-Standard Query)", timestamp: new Date().toLocaleString() }]
        });
      }

      setExecutionTimeMs(Math.round(performance.now() - start));
      setIsLoading(false);
      setCurrentPage(1);
    }, 800);
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (!results) return;
    const headers = results.columns.join(",");
    const rows = results.rows.map(row => results.columns.map(col => `"${row[col] ?? ""}"`).join(","));
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `query_results_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered rows
  const filteredRows = results?.rows.filter(row => 
    results.columns.some(col => 
      String(row[col] ?? "").toLowerCase().includes(searchTerm.toLowerCase())
    )
  ) ?? [];

  const paginatedRows = filteredRows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(filteredRows.length / itemsPerPage);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-6xl h-[85vh] bg-[#0D1117] border border-[#30363D] rounded-xl shadow-2xl flex flex-col overflow-hidden text-[#E6EDF3]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363D] bg-[#161B22]/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <Database className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-md font-semibold flex items-center gap-2">
                SQL Console & Diagnostics
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Sandbox</span>
              </h2>
              <p className="text-[11px] text-[#7D8590]">Run diagnostics queries and management scripts.</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 hover:bg-[#30363D] rounded-lg transition-colors text-[#7D8590] hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Workspace Area */}
        <div className="flex-1 flex min-h-0">
          {/* Sidebar - Saved Scripts catalog */}
          <div className="w-64 border-r border-[#30363D] flex flex-col bg-[#0D1117] shrink-0">
            <div className="p-3 border-b border-[#30363D] bg-[#161B22]/20 flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-[#7D8590] flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Saved Catalog
              </span>
              <Button 
                variant="ghost" 
                size="icon" 
                className="w-6 h-6 hover:bg-[#21262D] text-[#7D8590]"
                onClick={() => setIsSavingFormOpen(!isSavingFormOpen)}
                title="Save current script"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-3">
              {categories.map(cat => {
                const isOpenCat = expandedCategories[cat] ?? false;
                const catScripts = savedScripts.filter(s => s.category === cat);
                return (
                  <div key={cat} className="space-y-1">
                    <button
                      onClick={() => setExpandedCategories(p => ({ ...p, [cat]: !isOpenCat }))}
                      className="w-full flex items-center justify-between text-left p-1.5 hover:bg-[#161B22] rounded text-xs font-semibold text-[#8B949E]"
                    >
                      <span className="flex items-center gap-1.5">
                        {isOpenCat ? <FolderOpen className="w-3.5 h-3.5 text-blue-400" /> : <Folder className="w-3.5 h-3.5 text-blue-400" />}
                        {cat}
                      </span>
                      <span className="text-[10px] bg-[#21262D] px-1.5 py-0.2 rounded font-normal">{catScripts.length}</span>
                    </button>
                    {isOpenCat && (
                      <div className="pl-3.5 space-y-0.5">
                        {catScripts.map(script => (
                          <div
                            key={script.id}
                            onClick={() => setSql(script.sql)}
                            className={`group w-full flex items-center justify-between text-left px-2 py-1.5 rounded text-[11px] cursor-pointer transition-colors ${
                              sql === script.sql ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" : "text-[#7D8590] hover:bg-[#161B22] hover:text-[#E6EDF3]"
                            }`}
                          >
                            <span className="truncate flex-1 pr-2">{script.name}</span>
                            <button
                              onClick={(e) => handleDeleteScript(script.id, e)}
                              className="opacity-0 group-hover:opacity-100 hover:text-red-400 p-0.5 rounded transition-all"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {savedScripts.length === 0 && (
                <div className="text-[11px] text-[#7D8590] italic text-center py-8">
                  No scripts saved yet.
                </div>
              )}
            </div>
          </div>

          {/* Main Workspace (Editor + Results) */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Save Form Popover overlay if open */}
            {isSavingFormOpen && (
              <form onSubmit={handleSaveScript} className="bg-[#161B22] border-b border-[#30363D] p-4 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor="scriptName" className="text-xs text-[#7D8590]">Script Name</Label>
                    <Input 
                      id="scriptName" 
                      placeholder="e.g. List Active Users" 
                      value={scriptName} 
                      onChange={e => setScriptName(e.target.value)}
                      className="h-8 text-xs bg-[#0D1117] border-[#30363D] text-white"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="scriptCategory" className="text-xs text-[#7D8590]">Category</Label>
                    <Select value={scriptCategory} onValueChange={setScriptCategory}>
                      <SelectTrigger className="h-8 text-xs bg-[#0D1117] border-[#30363D]">
                        <SelectValue placeholder="Diagnostics" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#161B22] border-[#30363D] text-xs">
                        <SelectItem value="Diagnostics">Diagnostics</SelectItem>
                        <SelectItem value="Alerting">Alerting</SelectItem>
                        <SelectItem value="Reporting">Reporting</SelectItem>
                        <SelectItem value="Maintenance">Maintenance</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="scriptDescription" className="text-xs text-[#7D8590]">Description (Optional)</Label>
                    <Input 
                      id="scriptDescription" 
                      placeholder="Short summary of this script..." 
                      value={scriptDescription} 
                      onChange={e => setScriptDescription(e.target.value)}
                      className="h-8 text-xs bg-[#0D1117] border-[#30363D] text-white"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setIsSavingFormOpen(false)} className="h-7 text-xs border-[#30363D] hover:bg-[#21262D]">
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700">
                    <Save className="w-3 h-3 mr-1" /> Save Script
                  </Button>
                </div>
              </form>
            )}

            {/* Monaco Editor Container */}
            <div className="h-[250px] border-b border-[#30363D] relative bg-[#1e1e1e]">
              <div className="absolute top-2 right-4 z-10 flex items-center gap-2">
                <Button 
                  onClick={handleRunQuery} 
                  disabled={isLoading}
                  className="bg-blue-600 hover:bg-blue-700 h-7 text-xs px-3"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> Running
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 mr-1 text-emerald-400 fill-emerald-400" /> Run Query
                    </>
                  )}
                </Button>
              </div>
              <Editor
                height="100%"
                defaultLanguage="sql"
                theme="vs-dark"
                value={sql}
                onChange={val => setSql(val ?? "")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  fontFamily: "Fira Code, Monaco, Courier New, monospace",
                  lineNumbers: "on",
                  scrollbar: {
                    vertical: "auto",
                    horizontal: "auto"
                  },
                  automaticLayout: true
                }}
              />
            </div>

            {/* Results Console Section */}
            <div className="flex-1 flex flex-col min-h-0 bg-[#0D1117]">
              {/* Toolbar */}
              <div className="flex items-center justify-between px-4 py-2 bg-[#161B22]/40 border-b border-[#30363D] shrink-0">
                <span className="text-[10px] uppercase font-bold tracking-wider text-[#7D8590] flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" /> Output Results
                </span>
                
                {results && (
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-[#7D8590]">
                      {filteredRows.length} rows {executionTimeMs !== null && `(${executionTimeMs}ms)`}
                    </span>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[#7D8590] absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Filter output..."
                        value={searchTerm}
                        onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                        className="bg-[#0D1117] border border-[#30363D] text-[11px] pl-8 pr-2.5 py-1 rounded w-40 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <Button 
                      onClick={handleExportCSV}
                      variant="outline" 
                      size="sm" 
                      className="h-7 text-xs border-[#30363D] hover:bg-[#21262D]"
                    >
                      <Download className="w-3 h-3 mr-1" /> Export CSV
                    </Button>
                  </div>
                )}
              </div>

              {/* Data Table */}
              <div className="flex-1 overflow-auto p-4 min-h-0">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2.5 text-[#7D8590]">
                    <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                    <span className="text-xs">Executing query and parsing dataset schema...</span>
                  </div>
                ) : errorMsg ? (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-lg text-xs font-mono">
                    {errorMsg}
                  </div>
                ) : results ? (
                  <div className="border border-[#30363D] rounded-lg overflow-hidden bg-[#161B22]/10">
                    <Table>
                      <TableHeader className="bg-[#161B22]/50 font-mono text-[10px] text-[#7D8590] uppercase border-b border-[#30363D]">
                        <TableRow className="hover:bg-transparent">
                          {results.columns.map(col => (
                            <TableHead key={col} className="h-8 font-semibold text-[#8B949E]">{col}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody className="text-xs font-mono">
                        {paginatedRows.map((row, idx) => (
                          <TableRow key={idx} className="hover:bg-[#161B22]/50 border-b border-[#30363D]/55">
                            {results.columns.map(col => (
                              <TableCell key={col} className="py-2 text-[#E6EDF3]">{String(row[col] ?? "")}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center py-10 select-none">
                    <Database className="w-8 h-8 text-[#30363D] mb-2" />
                    <h3 className="text-[#8B949E] text-xs font-semibold">Console Ready</h3>
                    <p className="text-[11px] text-[#7D8590] max-w-xs mt-1">Run queries against `msps`, `users`, or `alert_events` to retrieve datasets.</p>
                  </div>
                )}
              </div>

              {/* Table Pagination footer */}
              {results && totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-2 border-t border-[#30363D] bg-[#161B22]/20 shrink-0 text-xs">
                  <span className="text-[#7D8590]">Page {currentPage} of {totalPages}</span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="h-6 text-[10px] border-[#30363D]"
                    >
                      Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className="h-6 text-[10px] border-[#30363D]"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
