// artifacts/admin-panel/src/components/ApiTesterDialog.tsx
//
// Ad-hoc API tester for Simulator Studio: pick a method + path, optionally
// send a JSON body, and fire it through the same authenticated fetch wrapper
// every other admin-panel page uses (useAdminFetch) so requests carry real
// auth. In-memory-only request/response history for the dialog session.

import { useState } from "react";
import { Send, Trash2 } from "lucide-react";

import { useAdminFetch } from "@/lib/useAdminFetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

interface HistoryEntry {
  id: number;
  method: HttpMethod;
  path: string;
  requestBody: string | null;
  status: number | null;
  ok: boolean;
  responseText: string;
  error: string | null;
}

function formatResponseBody(text: string): string {
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

let nextHistoryId = 1;

export function ApiTesterDialog({ children }: { children: React.ReactNode }) {
  const { adminFetch } = useAdminFetch();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [path, setPath] = useState("/api/");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const bodyEligible = method === "POST" || method === "PUT";

  const handleSend = async () => {
    if (!path.trim() || sending) return;
    setSending(true);
    const requestBody = bodyEligible && body.trim() ? body : null;
    try {
      const res = await adminFetch(path.trim(), {
        method,
        ...(requestBody ? { body: requestBody } : {}),
      });
      const text = await res.text();
      setHistory((prev) => [
        {
          id: nextHistoryId++,
          method,
          path: path.trim(),
          requestBody,
          status: res.status,
          ok: res.ok,
          responseText: text,
          error: null,
        },
        ...prev,
      ]);
    } catch (err) {
      setHistory((prev) => [
        {
          id: nextHistoryId++,
          method,
          path: path.trim(),
          requestBody,
          status: null,
          ok: false,
          responseText: "",
          error: err instanceof Error ? err.message : String(err),
        },
        ...prev,
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">API Tester</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-xs">
          <div className="flex items-center gap-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as HttpMethod)}
              className="rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:border-ring focus:outline-none"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
            </select>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/api/admin/msps"
              className="flex-1 rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:border-ring focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              onClick={handleSend}
              disabled={sending || !path.trim()}
              className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
            >
              <Send className="h-3 w-3" />
              {sending ? "Sending…" : "Send"}
            </button>
          </div>

          {bodyEligible && (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder='{"key": "value"}'
              rows={4}
              className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:border-ring focus:outline-none"
            />
          )}

          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              History ({history.length})
            </span>
            {history.length > 0 && (
              <button
                onClick={() => setHistory([])}
                className="flex items-center gap-1 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                title="Clear history"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {history.length === 0 && (
              <div className="rounded border border-dashed border-border py-6 text-center text-muted-foreground">
                No requests sent yet.
              </div>
            )}
            {history.map((entry) => (
              <div key={entry.id} className="rounded border border-border bg-card p-2">
                <div className="flex items-center gap-2 font-mono">
                  <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold">{entry.method}</span>
                  <span className="flex-1 truncate text-foreground">{entry.path}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      entry.error
                        ? "bg-destructive/20 text-destructive"
                        : entry.ok
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-amber-500/20 text-amber-400"
                    }`}
                  >
                    {entry.error ? "ERR" : entry.status}
                  </span>
                </div>
                {entry.requestBody && (
                  <pre className="mt-1 max-h-24 overflow-y-auto rounded bg-background p-1.5 font-mono text-[10px] text-muted-foreground">
                    {entry.requestBody}
                  </pre>
                )}
                <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-background p-1.5 font-mono text-[10px] text-foreground">
                  {entry.error ?? formatResponseBody(entry.responseText)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
