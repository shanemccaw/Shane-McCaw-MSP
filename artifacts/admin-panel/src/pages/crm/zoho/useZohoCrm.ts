// Zoho CRM Admin Panel data layer (#83).
//
// Reads are synchronous passthroughs to Zoho and resolve with real records.
// Writes are NOT: every write endpoint answers 202 with a jobId, because the
// actual Zoho write happens on the next 5-minute queue drain. The UI must
// therefore show "queued / syncing" rather than success — `useQueuedWrite`
// below is what makes that the path of least resistance for callers.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

export type ZohoEntity = "leads" | "deals" | "contacts" | "accounts";

export interface ZohoRecord {
  id?: string;
  [key: string]: unknown;
}

export interface ZohoListResponse {
  module: string;
  records: ZohoRecord[];
  page: number;
  perPage: number;
  more: boolean;
}

export interface QueuedWrite {
  queued: boolean;
  jobId: string;
  jobType: string;
  action: string;
  message: string;
}

export interface ZohoJobStatus {
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
    if (body.code === "zoho_not_connected") {
      return "Zoho is not connected. Connect it from Settings before using these pages.";
    }
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function useZohoList(entity: ZohoEntity) {
  const { fetchWithAuth } = useAuth();
  const [records, setRecords] = useState<ZohoRecord[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextPage: number, search: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(nextPage), perPage: "50" });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetchWithAuth(`/api/zoho/crm/${entity}?${params.toString()}`);
      if (!res.ok) {
        setError(await readError(res, `Failed to load ${entity} from Zoho`));
        setRecords([]);
        setMore(false);
        return;
      }
      const data = await res.json() as ZohoListResponse;
      setRecords(data.records ?? []);
      setMore(Boolean(data.more));
      setPage(data.page ?? nextPage);
    } catch {
      setError(`Failed to load ${entity} from Zoho`);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [entity, fetchWithAuth]);

  return { records, page, more, loading, error, load, setRecords };
}

export function useZohoRecord(entity: ZohoEntity) {
  const { fetchWithAuth } = useAuth();
  const [record, setRecord] = useState<ZohoRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setRecord(null);
    try {
      const res = await fetchWithAuth(`/api/zoho/crm/${entity}/${encodeURIComponent(id)}`);
      if (!res.ok) {
        setError(await readError(res, "Failed to load record from Zoho"));
        return;
      }
      const data = await res.json() as { record: ZohoRecord };
      setRecord(data.record);
    } catch {
      setError("Failed to load record from Zoho");
    } finally {
      setLoading(false);
    }
  }, [entity, fetchWithAuth]);

  return { record, loading, error, load, clear: () => setRecord(null) };
}

/**
 * Runs a queued write and then tracks the real msp_job_queue row until it
 * settles. Deliberately does NOT report success on the 202: at that moment
 * Zoho has not been contacted at all. `state` walks
 * idle → queued → syncing → synced | failed, mirroring the job row.
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
      const res = await fetchWithAuth(`/api/zoho/crm/jobs/${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const job = await res.json() as ZohoJobStatus;

      if (job.status === "completed") {
        setState("synced");
        setMessage("Synced to Zoho.");
        return;
      }
      if (job.status === "failed") {
        setState("failed");
        setMessage(job.errorMessage ?? "The Zoho write failed. See the job queue for details.");
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
      setMessage(data.message ?? "Queued — applied on the next Zoho sync.");
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
