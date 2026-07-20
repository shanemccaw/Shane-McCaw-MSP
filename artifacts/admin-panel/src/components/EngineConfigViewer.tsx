import { useState, useEffect, useCallback } from "react";
import { Loader2, Table2, Info } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

// ─── Types ───────────────────────────────────────────────────────────────────
// Read-only Configuration tab for engines whose real configuration does NOT
// live in signal_derivation_rules:
//   • the 4 non-signal-derived engines (sla, scope_creep, monitoring,
//     sales_offer) — config lives in dedicated backing tables, rendered as a
//     generic table.
//   • the msp aggregator — no config of its own, rendered as an explainer.
// The backend (`GET /api/admin/engines/:key/configuration`) drives which mode
// is rendered. Editing happens on each subsystem's own admin page, not here.

interface ConfigColumn {
  key: string;
  label: string;
  type?: "text" | "number" | "bool" | "array" | "date";
}

interface BackingTableConfig {
  mode: "backing-table";
  engine: string;
  backingTable: string;
  title: string;
  description: string;
  columns: ConfigColumn[];
  items: Array<Record<string, unknown>>;
  count: number;
}

interface AggregatorConfig {
  mode: "aggregator";
  engine: string;
  title: string;
  description: string;
  dependsOn: string[];
}

type ConfigResponse = BackingTableConfig | AggregatorConfig;

// ─── Cell rendering ──────────────────────────────────────────────────────────

function Cell({ value, type }: { value: unknown; type?: ConfigColumn["type"] }) {
  if (value == null || value === "") return <span className="text-muted-foreground/40">—</span>;
  switch (type) {
    case "bool":
      return value
        ? <span className="text-[10px] bg-green-900/30 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-full">yes</span>
        : <span className="text-[10px] bg-border text-muted-foreground px-1.5 py-0.5 rounded-full">no</span>;
    case "array": {
      const arr = Array.isArray(value) ? value : [];
      if (arr.length === 0) return <span className="text-muted-foreground/40">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {arr.map((v, i) => (
            <span key={i} className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full font-mono">
              {String(v)}
            </span>
          ))}
        </div>
      );
    }
    case "date": {
      const d = new Date(String(value));
      return <span className="text-muted-foreground">{isNaN(d.getTime()) ? String(value) : d.toLocaleDateString()}</span>;
    }
    case "number":
      return <span className="font-mono">{String(value)}</span>;
    default:
      return <span>{String(value)}</span>;
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EngineConfigViewer({ engineKey }: { engineKey: string }) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/engines/${engineKey}/configuration`);
      if (res.ok) {
        setData(await res.json() as ConfigResponse);
      } else {
        toast({ title: "Failed to load engine configuration", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to load engine configuration", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [engineKey, fetchWithAuth, toast]);

  useEffect(() => { void loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
        <Loader2 className="w-4 h-4 animate-spin" />Loading engine configuration…
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground italic py-4">No configuration available.</p>;
  }

  if (data.mode === "aggregator") {
    return (
      <div className="border border-border rounded-xl p-5 bg-background space-y-3">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground/90">{data.title}</h3>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{data.description}</p>
        {data.dependsOn.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Aggregates:</span>
            {data.dependsOn.map(k => (
              <span key={k} className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full font-mono">
                {k}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // backing-table mode
  return (
    <div className="space-y-3">
      <div className="border border-border rounded-xl p-4 bg-background space-y-1.5">
        <div className="flex items-center gap-2">
          <Table2 className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground/90">{data.title}</h3>
          <span className="text-[10px] bg-accent text-muted-foreground border border-border px-1.5 py-0.5 rounded-full font-mono">
            {data.backingTable}
          </span>
          <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full ml-auto">
            {data.count} row{data.count !== 1 ? "s" : ""}
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{data.description}</p>
      </div>

      {data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-4 px-1">
          No rows configured in <code className="font-mono">{data.backingTable}</code> yet.
        </p>
      ) : (
        <div className="border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-accent">
                {data.columns.map(col => (
                  <th key={col.key} className="text-left font-semibold text-muted-foreground px-3 py-2 whitespace-nowrap">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-accent/40">
                  {data.columns.map(col => (
                    <td key={col.key} className="px-3 py-2 align-top text-foreground/90">
                      <Cell value={item[col.key]} type={col.type} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
