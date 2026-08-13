// msp-portal Zoho Projects data layer (#85).
//
// Mirrors admin-panel's useZohoCrm.ts (#83): reads are synchronous
// passthroughs to Zoho and resolve with real records. Writes are NOT — every
// write endpoint answers 202 with a jobId, because the actual Zoho write
// happens on the next 5-minute queue drain. useQueuedWrite below is what
// makes "queued / syncing" the path of least resistance for callers, same
// state machine (idle → queued → syncing → synced | failed) CRM established.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";

export interface ZohoProjectsRecord {
  id?: string | number;
  [key: string]: unknown;
}

export interface ZohoProjectsListResponse {
  entity: string;
  records: ZohoProjectsRecord[];
  page: number;
  perPage: number;
  more: boolean;
  linked?: boolean;
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
    const body = (await res.json()) as { error?: string; code?: string };
    if (body.code === "zoho_not_connected") {
      return "Zoho is not connected for this MSP yet — an admin needs to connect it before this board has data.";
    }
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function useZohoProjectLink(projectId: number) {
  const { fetchWithAuth } = useAuth();
  const [linked, setLinked] = useState(false);
  const [record, setRecord] = useState<ZohoProjectsRecord | null>(null);
  const [zohoProjectId, setZohoProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(projectId)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/portal/projects/${projectId}/zoho-project`);
      if (!res.ok) {
        setError(await readError(res, "Failed to load the linked Zoho Project"));
        return;
      }
      const data = (await res.json()) as { linked: boolean; zohoProjectId: string | null; record: ZohoProjectsRecord | null };
      setLinked(data.linked);
      setZohoProjectId(data.zohoProjectId);
      setRecord(data.record);
    } catch {
      setError("Failed to load the linked Zoho Project");
    } finally {
      setLoading(false);
    }
  }, [projectId, fetchWithAuth]);

  return { linked, record, zohoProjectId, loading, error, load };
}

export function useZohoList(path: string, deps: unknown[] = []) {
  const { fetchWithAuth } = useAuth();
  const [records, setRecords] = useState<ZohoProjectsRecord[]>([]);
  const [linked, setLinked] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(path);
      if (!res.ok) {
        setError(await readError(res, "Failed to load from Zoho"));
        setRecords([]);
        return;
      }
      const data = (await res.json()) as ZohoProjectsListResponse;
      setRecords(data.records ?? []);
      setLinked(data.linked !== false);
    } catch {
      setError("Failed to load from Zoho");
      setRecords([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, fetchWithAuth, ...deps]);

  return { records, linked, loading, error, load, setRecords };
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
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => () => {
    cancelledRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const poll = useCallback(async (id: string) => {
    if (cancelledRef.current) return;
    try {
      const res = await fetchWithAuth(`/api/portal/zoho-projects/jobs/${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const job = (await res.json()) as ZohoJobStatus;

      if (job.status === "completed") {
        setState("synced");
        setMessage("Synced to Zoho.");
        setResult(job.result);
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
    setResult(null);
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

      const data = (await res.json()) as QueuedWrite;
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
    setResult(null);
  }, []);

  return { state, message, jobId, result, submit, reset };
}

export type { FetchWithAuth };
