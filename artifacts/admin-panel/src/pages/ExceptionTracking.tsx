import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

interface ExceptionGroup {
  fingerprint: string;
  errorName: string;
  errorMessage: string;
  file: string | null;
  line: number | null;
  functionName: string | null;
  codeFrame: string | null;
  stackSample: string | null;
  channel: string;
  source: string;
  status: "open" | "suppressed" | "resolved";
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  resolvedBy: number | null;
  resolutionNote: string | null;
  suppressedAt: string | null;
  suppressedBy: number | null;
  suppressionReason: string | null;
}

interface ExceptionOccurrence {
  id: number;
  fingerprint: string;
  correlationId: string | null;
  channel: string;
  mspId: number | null;
  customerId: number | null;
  occurredAt: string;
}

type StatusFilter = "open" | "suppressed" | "resolved" | "all";
type SortMode = "lastSeen" | "count";

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "open"
      ? "bg-amber-900/40 text-amber-400 border-amber-800"
      : status === "suppressed"
      ? "bg-accent text-muted-foreground border-border"
      : "bg-emerald-900/40 text-emerald-400 border-emerald-800";
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-muted-foreground hover:text-primary transition-colors shrink-0"
      title="Copy correlation ID"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

export default function ExceptionTracking() {
  const { fetchWithAuth } = useAuth();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [sort, setSort] = useState<SortMode>("lastSeen");
  const [groups, setGroups] = useState<ExceptionGroup[]>([]);
  const [listLoading, setListLoading] = useState(true);

  const [selectedFingerprint, setSelectedFingerprint] = useState<string | null>(null);
  const [detailGroup, setDetailGroup] = useState<ExceptionGroup | null>(null);
  const [occurrences, setOccurrences] = useState<ExceptionOccurrence[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [resolveNote, setResolveNote] = useState("");
  const [suppressReason, setSuppressReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const [testMarker, setTestMarker] = useState("");
  const [triggering, setTriggering] = useState(false);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/exceptions?status=${statusFilter}&sort=${sort}`);
      const data = await res.json();
      setGroups(data.groups ?? []);
    } catch {
      /* non-fatal */
    } finally {
      setListLoading(false);
    }
  }, [fetchWithAuth, statusFilter, sort]);

  useEffect(() => { void loadList(); }, [loadList]);

  const loadDetail = useCallback(async (fingerprint: string) => {
    setDetailLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/exceptions/${fingerprint}`);
      const data = await res.json();
      setDetailGroup(data.group ?? null);
      setOccurrences(data.occurrences ?? []);
    } catch {
      setDetailGroup(null);
      setOccurrences([]);
    } finally {
      setDetailLoading(false);
    }
  }, [fetchWithAuth]);

  function openDetail(fingerprint: string) {
    setSelectedFingerprint(fingerprint);
    setResolveNote("");
    setSuppressReason("");
    void loadDetail(fingerprint);
  }

  function backToList() {
    setSelectedFingerprint(null);
    setDetailGroup(null);
    void loadList();
  }

  async function handleResolve() {
    if (!selectedFingerprint) return;
    setActionBusy(true);
    try {
      await fetchWithAuth(`/api/admin/exceptions/${selectedFingerprint}/resolve`, {
        method: "PATCH",
        body: JSON.stringify({ note: resolveNote || undefined }),
      });
      await loadDetail(selectedFingerprint);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSuppress() {
    if (!selectedFingerprint || !suppressReason.trim()) return;
    setActionBusy(true);
    try {
      await fetchWithAuth(`/api/admin/exceptions/${selectedFingerprint}/suppress`, {
        method: "PATCH",
        body: JSON.stringify({ reason: suppressReason }),
      });
      await loadDetail(selectedFingerprint);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleUnsuppress() {
    if (!selectedFingerprint) return;
    setActionBusy(true);
    try {
      await fetchWithAuth(`/api/admin/exceptions/${selectedFingerprint}/unsuppress`, { method: "PATCH" });
      await loadDetail(selectedFingerprint);
    } finally {
      setActionBusy(false);
    }
  }

  // Fires a synthetic exception through the real captureException path so
  // grouping/reopen/suppress behavior can be exercised without a real bug.
  // Blank marker reuses the fixed "manual-test" group across clicks; a
  // typed marker isolates that click's exception into its own group.
  async function triggerTest() {
    setTriggering(true);
    try {
      const marker = testMarker.trim() || "manual-test";
      await fetchWithAuth(`/api/admin/exceptions/_test/trigger?marker=${encodeURIComponent(marker)}`, { method: "POST" });
      await loadList();
    } finally {
      setTriggering(false);
    }
  }

  if (selectedFingerprint) {
    return (
      <div className="p-6 space-y-6 max-w-5xl">
        <button
          onClick={backToList}
          className="text-xs text-primary hover:text-blue-400 transition-colors"
        >
          ← Back to list
        </button>

        {detailLoading && !detailGroup && (
          <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
            Loading exception detail…
          </div>
        )}

        {!detailLoading && !detailGroup && (
          <div className="flex items-center justify-center h-64 text-red-400 text-sm">
            Exception group not found.
          </div>
        )}

        {detailGroup && (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <StatusBadge status={detailGroup.status} />
                  <span className="text-muted-foreground text-xs font-mono">{detailGroup.channel}</span>
                  <span className="text-muted-foreground text-xs">·</span>
                  <span className="text-muted-foreground text-xs uppercase tracking-wide">{detailGroup.source}</span>
                </div>
                <h1 className="text-foreground text-xl font-semibold break-words">{detailGroup.errorName}</h1>
                <p className="text-muted-foreground text-sm mt-1 break-words">{detailGroup.errorMessage}</p>
                <p className="text-muted-foreground/60 text-xs mt-2 font-mono">
                  {detailGroup.file ?? "unknown file"}{detailGroup.line != null ? `:${detailGroup.line}` : ""}
                  {detailGroup.functionName ? ` in ${detailGroup.functionName}()` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-2xl font-bold text-foreground">{detailGroup.occurrenceCount}</p>
                <p className="text-muted-foreground text-xs">occurrences</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="bg-card border border-border rounded-lg p-3">
                <p className="text-muted-foreground">First Seen</p>
                <p className="text-foreground mt-0.5">{new Date(detailGroup.firstSeenAt).toLocaleString()}</p>
              </div>
              <div className="bg-card border border-border rounded-lg p-3">
                <p className="text-muted-foreground">Last Seen</p>
                <p className="text-foreground mt-0.5">{new Date(detailGroup.lastSeenAt).toLocaleString()}</p>
              </div>
            </div>

            {/* Stack sample */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-foreground text-sm font-semibold mb-2">Stack Trace</h2>
              {detailGroup.stackSample ? (
                <pre className="text-muted-foreground text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-80 overflow-y-auto">
                  {detailGroup.stackSample}
                </pre>
              ) : (
                <p className="text-muted-foreground/60 text-xs italic">No stack sample captured.</p>
              )}
            </div>

            {/* Code frame */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-foreground text-sm font-semibold mb-2">Code Frame</h2>
              {detailGroup.codeFrame ? (
                <pre className="text-muted-foreground/60 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">
                  {detailGroup.codeFrame}
                </pre>
              ) : (
                <p className="text-muted-foreground/60 text-xs italic">Not available in production.</p>
              )}
            </div>

            {/* Status detail + actions */}
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <h2 className="text-foreground text-sm font-semibold">Status</h2>

              {detailGroup.status === "resolved" && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Resolved {detailGroup.resolvedAt ? new Date(detailGroup.resolvedAt).toLocaleString() : ""}
                    {detailGroup.resolvedBy != null ? ` by user #${detailGroup.resolvedBy}` : ""}</p>
                  {detailGroup.resolutionNote && (
                    <p className="text-foreground">Note: {detailGroup.resolutionNote}</p>
                  )}
                  <p className="text-muted-foreground/60 italic">Only reopens automatically if the error recurs.</p>
                </div>
              )}

              {detailGroup.status === "suppressed" && (
                <div className="text-xs text-muted-foreground space-y-2">
                  <p>Suppressed {detailGroup.suppressedAt ? new Date(detailGroup.suppressedAt).toLocaleString() : ""}
                    {detailGroup.suppressedBy != null ? ` by user #${detailGroup.suppressedBy}` : ""}</p>
                  {detailGroup.suppressionReason && (
                    <p className="text-foreground">Reason: {detailGroup.suppressionReason}</p>
                  )}
                  <button
                    onClick={() => void handleUnsuppress()}
                    disabled={actionBusy}
                    className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-blue-800 transition-colors disabled:opacity-50"
                  >
                    {actionBusy ? "…" : "Unsuppress"}
                  </button>
                </div>
              )}

              {detailGroup.status === "open" && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Resolution note (optional)</label>
                    <textarea
                      value={resolveNote}
                      onChange={(e) => setResolveNote(e.target.value)}
                      rows={2}
                      className="w-full bg-background border border-border rounded p-2 text-xs text-foreground focus:outline-none focus:border-blue-700"
                      placeholder="What was done to fix this?"
                    />
                    <button
                      onClick={() => void handleResolve()}
                      disabled={actionBusy}
                      className="text-xs px-3 py-1.5 rounded border border-emerald-800 text-emerald-400 hover:bg-emerald-900/20 transition-colors disabled:opacity-50"
                    >
                      {actionBusy ? "…" : "Resolve"}
                    </button>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-accent">
                    <label className="text-xs text-muted-foreground">Suppression reason (required)</label>
                    <textarea
                      value={suppressReason}
                      onChange={(e) => setSuppressReason(e.target.value)}
                      rows={2}
                      className="w-full bg-background border border-border rounded p-2 text-xs text-foreground focus:outline-none focus:border-blue-700"
                      placeholder="Why is this being suppressed? (required)"
                    />
                    <button
                      onClick={() => void handleSuppress()}
                      disabled={actionBusy || !suppressReason.trim()}
                      className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/60 transition-colors disabled:opacity-50"
                    >
                      {actionBusy ? "…" : "Suppress"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Occurrence history */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-foreground text-sm font-semibold mb-3">Occurrence History</h2>
              {occurrences.length === 0 ? (
                <p className="text-muted-foreground text-xs">No occurrences recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-accent hover:bg-transparent">
                      <TableHead className="text-muted-foreground text-xs">Correlation ID</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Channel</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Timestamp</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {occurrences.map((occ) => (
                      <TableRow key={occ.id} className="border-accent hover:bg-accent">
                        <TableCell className="text-xs font-mono text-foreground">
                          {occ.correlationId ? (
                            <div className="flex items-center gap-2">
                              <span className="truncate max-w-[220px]">{occ.correlationId}</span>
                              <CopyButton value={occ.correlationId} />
                            </div>
                          ) : (
                            <span className="text-muted-foreground/60 italic">none</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{occ.channel}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(occ.occurredAt).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-foreground text-xl font-semibold">Exception Tracking</h1>
          <p className="text-muted-foreground text-sm mt-1">Captured server-side exceptions, grouped by fingerprint.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={testMarker}
            onChange={(e) => setTestMarker(e.target.value)}
            placeholder="manual-test"
            title="Marker for the test exception — same marker reuses the same group, blank defaults to 'manual-test'"
            className="text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground placeholder-muted-foreground/60 focus:outline-none focus:border-blue-700 w-32"
          />
          <button
            onClick={() => void triggerTest()}
            disabled={triggering}
            className="text-xs text-primary hover:text-blue-400 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {triggering ? "Triggering…" : "+ Trigger Test Exception"}
          </button>
          <button
            onClick={() => void loadList()}
            className="text-xs text-primary hover:text-blue-400 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1 w-fit">
          {(["open", "suppressed", "resolved", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-1.5 rounded-md capitalize transition-colors ${
                statusFilter === s
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Sort:</span>
          {([
            { key: "lastSeen", label: "Last seen" },
            { key: "count", label: "Occurrence count" },
          ] as { key: SortMode; label: string }[]).map((opt) => (
            <button
              key={opt.key}
              onClick={() => setSort(opt.key)}
              className={`px-2 py-1 rounded transition-colors ${
                sort === opt.key ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        {listLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            Loading exceptions…
          </div>
        ) : groups.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">
            No {statusFilter === "all" ? "" : statusFilter} exceptions found.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-accent hover:bg-transparent">
                <TableHead className="text-muted-foreground text-xs">Error</TableHead>
                <TableHead className="text-muted-foreground text-xs">Channel</TableHead>
                <TableHead className="text-muted-foreground text-xs">Count</TableHead>
                <TableHead className="text-muted-foreground text-xs">First Seen</TableHead>
                <TableHead className="text-muted-foreground text-xs">Last Seen</TableHead>
                <TableHead className="text-muted-foreground text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow
                  key={g.fingerprint}
                  onClick={() => openDetail(g.fingerprint)}
                  className="border-accent hover:bg-accent cursor-pointer"
                >
                  <TableCell className="max-w-sm">
                    <p className="text-foreground text-xs font-medium truncate">{g.errorName}</p>
                    <p className="text-muted-foreground text-xs truncate">{g.errorMessage}</p>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">{g.channel}</TableCell>
                  <TableCell className="text-xs text-foreground font-mono">{g.occurrenceCount}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(g.firstSeenAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(g.lastSeenAt).toLocaleString()}</TableCell>
                  <TableCell><StatusBadge status={g.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
