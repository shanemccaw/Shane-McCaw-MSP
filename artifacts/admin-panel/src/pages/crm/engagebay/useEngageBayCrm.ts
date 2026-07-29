// EngageBay CRM Admin Panel data layer (#106). Mirrors useZohoCrm.ts's
// read/write split and its idle→queued→syncing→synced|failed queued-write
// state machine exactly — a write here answers 202 with a jobId, never a
// completed record, because the real EngageBay write happens on the next
// 5-minute "EngageBay Queue Drain".
//
// One structural difference from Zoho: EngageBay's list reads are
// cursor-paginated (page_size/sort_key/cursor), not page-numbered, so
// useEngageBayList keeps a small cursor stack internally and exposes
// loadNext/loadPrev instead of an arbitrary page number.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

export type EngageBayEntity = "contacts";

export interface EngageBayRecord {
  id?: string | number;
  [key: string]: unknown;
}

export interface EngageBayListResponse {
  entity: string;
  records: EngageBayRecord[];
  cursor: string | null;
  more: boolean;
}

export interface QueuedWrite {
  queued: boolean;
  jobId: string;
  jobType: string;
  action: string;
  message: string;
}

export interface EngageBayJobStatus {
  jobId: string;
  jobType: string;
  status: "pending" | "running" | "completed" | "failed";
  attemptCount: number;
  maxAttempts: number;
  errorMessage: string | null;
  result: Record<string, unknown> | null;
  scheduledAt: string | null;
  completedAt: string | null;
}

/** Pulls the readable message out of an error body without inventing one. */
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json() as { error?: string; code?: string };
    if (body.code === "engagebay_not_connected") {
      return "EngageBay is not connected. Connect it from Settings before using these pages.";
    }
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function useEngageBayList(entity: EngageBayEntity) {
  const { fetchWithAuth } = useAuth();
  const [records, setRecords] = useState<EngageBayRecord[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cursor used to fetch page N is pageCursorsRef.current[N] (page 0 = null).
  // nextCursorRef holds the cursor the LAST fetch returned — the one that
  // would fetch page (currentPage + 1).
  const pageCursorsRef = useRef<Array<string | null>>([null]);
  const nextCursorRef = useRef<string | null>(null);
  const lastSearchRef = useRef("");

  const fetchPage = useCallback(async (idx: number, cursor: string | null, search: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pageSize: "50" });
      if (cursor) params.set("cursor", cursor);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetchWithAuth(`/api/engagebay/crm/${entity}?${params.toString()}`);
      if (!res.ok) {
        setError(await readError(res, `Failed to load ${entity} from EngageBay`));
        setRecords([]);
        setMore(false);
        nextCursorRef.current = null;
        return;
      }
      const data = await res.json() as EngageBayListResponse;
      setRecords(data.records ?? []);
      setMore(Boolean(data.more));
      nextCursorRef.current = data.cursor ?? null;
      setPageIndex(idx);
    } catch {
      setError(`Failed to load ${entity} from EngageBay`);
      setRecords([]);
      nextCursorRef.current = null;
    } finally {
      setLoading(false);
    }
  }, [entity, fetchWithAuth]);

  /** Resets to the first page — used on mount and on a fresh search. */
  const load = useCallback(async (search: string) => {
    pageCursorsRef.current = [null];
    lastSearchRef.current = search;
    await fetchPage(0, null, search);
  }, [fetchPage]);

  const loadNext = useCallback(async () => {
    if (!more) return;
    const idx = pageIndex + 1;
    if (pageCursorsRef.current.length <= idx) {
      pageCursorsRef.current = [...pageCursorsRef.current, nextCursorRef.current];
    }
    await fetchPage(idx, pageCursorsRef.current[idx], lastSearchRef.current);
  }, [fetchPage, more, pageIndex]);

  const loadPrev = useCallback(async () => {
    if (pageIndex <= 0) return;
    const idx = pageIndex - 1;
    await fetchPage(idx, pageCursorsRef.current[idx], lastSearchRef.current);
  }, [fetchPage, pageIndex]);

  return { records, pageIndex, more, loading, error, load, loadNext, loadPrev, setRecords };
}

export function useEngageBayRecord(entity: EngageBayEntity) {
  const { fetchWithAuth } = useAuth();
  const [record, setRecord] = useState<EngageBayRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setRecord(null);
    try {
      const res = await fetchWithAuth(`/api/engagebay/crm/${entity}/${encodeURIComponent(id)}`);
      if (!res.ok) {
        setError(await readError(res, "Failed to load record from EngageBay"));
        return;
      }
      const data = await res.json() as { record: EngageBayRecord };
      setRecord(data.record);
    } catch {
      setError("Failed to load record from EngageBay");
    } finally {
      setLoading(false);
    }
  }, [entity, fetchWithAuth]);

  return { record, loading, error, load, clear: () => setRecord(null) };
}

/**
 * Runs a queued write and then tracks the real msp_job_queue row until it
 * settles. Deliberately does NOT report success on the 202: at that moment
 * EngageBay has not been contacted at all. `state` walks
 * idle → queued → syncing → synced | failed, mirroring the job row —
 * identical contract to Zoho's useQueuedWrite, just pointed at
 * /api/engagebay/jobs/:jobId instead of /api/zoho/crm/jobs/:jobId.
 */
export function useQueuedWrite() {
  const { fetchWithAuth } = useAuth();
  const [state, setState] = useState<"idle" | "queued" | "syncing" | "synced" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => () => {
    cancelledRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const poll = useCallback(async (id: string) => {
    if (cancelledRef.current) return;
    try {
      const res = await fetchWithAuth(`/api/engagebay/jobs/${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const job = await res.json() as EngageBayJobStatus;

      if (job.status === "completed") {
        setState("synced");
        setMessage("Synced to EngageBay.");
        return;
      }
      if (job.status === "failed") {
        setState("failed");
        setMessage(job.errorMessage ?? "The EngageBay write failed. See the job queue for details.");
        return;
      }
      setState(job.status === "running" ? "syncing" : "queued");
      // The drain runs every 5 minutes, so poll on a slow cadence — a tight
      // loop would just burn requests against an endpoint that cannot change
      // faster than the drain does.
      timerRef.current = setTimeout(() => { void poll(id); }, 15_000);
    } catch {
      /* transient — the next poll tick retries */
    }
  }, [fetchWithAuth]);

  const submit = useCallback(async (
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<boolean> => {
    setState("queued");
    setMessage(null);
    setJobId(null);
    try {
      const res = await fetchWithAuth(path, {
        method: init.method,
        headers: { "Content-Type": "application/json" },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });

      if (!res.ok) {
        setState("failed");
        setMessage(await readError(res, "Failed to queue the change"));
        return false;
      }

      const data = await res.json() as QueuedWrite;
      setJobId(data.jobId);
      setMessage(data.message ?? "Queued — applied on the next EngageBay sync.");
      void poll(data.jobId);
      return true;
    } catch {
      setState("failed");
      setMessage("Failed to queue the change");
      return false;
    }
  }, [fetchWithAuth, poll]);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState("idle");
    setMessage(null);
    setJobId(null);
  }, []);

  return { state, message, jobId, submit, reset };
}
