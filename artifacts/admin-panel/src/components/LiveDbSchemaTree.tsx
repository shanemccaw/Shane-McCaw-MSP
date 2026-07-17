import React, { useEffect, useState } from "react";
import { Database, Table, Key, Link as LinkIcon, ChevronRight, ChevronDown, RefreshCw, AlertCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

interface ColumnMeta {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPk: boolean;
  foreignKey: string | null;
}

interface TableMeta {
  name: string;
  columns: ColumnMeta[];
}

export function LiveDbSchemaTree() {
  const { fetchWithAuth } = useAuth();
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSchema = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/simulator/db-schema");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load schema");
      setTables(data.tables || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSchema();
  }, []);

  const toggleTable = (tableName: string) => {
    setExpandedTables((prev) => ({
      ...prev,
      [tableName]: !prev[tableName],
    }));
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 border-r border-slate-800 font-mono text-xs text-slate-300">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-slate-900/50">
        <div className="flex items-center space-x-2">
          <Database className="w-4 h-4 text-indigo-400" />
          <span className="font-semibold uppercase tracking-wider text-[11px] text-slate-400">Live DB Schema</span>
          <Badge variant="outline" className="text-[10px] text-slate-400 border-slate-700">
            {tables.length} Tables
          </Badge>
        </div>
        <Button size="icon" variant="ghost" className="h-6 w-6 text-slate-400 hover:text-white" onClick={fetchSchema} disabled={isLoading}>
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Tree Area */}
      <ScrollArea className="flex-1 p-2">
        {error && (
          <div className="p-3 text-red-400 flex items-center space-x-2 bg-red-950/30 rounded border border-red-900/50 my-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {tables.map((tbl) => {
          const isExpanded = !!expandedTables[tbl.name];
          return (
            <div key={tbl.name} className="mb-1">
              {/* Table Node */}
              <button
                onClick={() => toggleTable(tbl.name)}
                className="w-full flex items-center justify-between p-1.5 rounded hover:bg-slate-900 text-left transition-colors group"
              >
                <div className="flex items-center space-x-1.5 truncate">
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  )}
                  <Table className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="font-semibold text-slate-200 group-hover:text-white truncate">{tbl.name}</span>
                </div>
                <span className="text-[10px] text-slate-600 ml-2">{tbl.columns.length} cols</span>
              </button>

              {/* Column Children Nodes */}
              {isExpanded && (
                <div className="ml-5 pl-2 border-l border-slate-800 space-y-1 my-1">
                  {tbl.columns.map((col) => (
                    <div key={col.name} className="flex items-start justify-between py-1 px-1.5 rounded hover:bg-slate-900/60">
                      <div className="flex items-center space-x-1.5 min-w-0">
                        {col.isPk ? (
                          <span title="Primary Key"><Key className="w-3 h-3 text-amber-400 shrink-0" /></span>
                        ) : col.foreignKey ? (
                          <span title={col.foreignKey}><LinkIcon className="w-3 h-3 text-cyan-400 shrink-0" /></span>
                        ) : (
                          <div className="w-3 h-3 shrink-0" />
                        )}
                        <span className={`truncate ${col.isPk ? "text-amber-300 font-medium" : "text-slate-300"}`}>
                          {col.name}
                        </span>
                      </div>
                      
                      <div className="flex items-center space-x-2 shrink-0 ml-2">
                        <span className="text-[10px] text-slate-500">{col.dataType}</span>
                        {!col.isNullable && (
                          <span className="text-[9px] text-red-400/80 font-bold" title="NOT NULL">NN</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </ScrollArea>
    </div>
  );
}