/**
 * React Query hook + SSE subscription for the customer-facing Projects
 * surface, #1739 (Feature #1570).
 *
 * Wired to the one real customer route,
 * `GET /api/portal/projects/:id` (`artifacts/api-server/src/routes/portal-projects.ts`),
 * plus its `kanban-events` SSE sibling. There is no list route — this hook is
 * only ever called with an id reached via a link, never from an index this
 * app renders itself.
 *
 * No fixture module, no fallback data. A 404 (no project at that id, or one
 * that belongs to another organisation — the route gives no way to tell
 * those apart) and a thrown/5xx read are distinct, honestly-rendered states.
 */
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type {
  ApiErrorBody,
  KanbanChangeEvent,
  SignProjectClosureRequest,
  WireProjectClosure,
  WireProjectDetail,
} from "@/lib/projects-types";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

const QK = {
  project: (id: string) => ["portal", "projects", id] as const,
};

export function useProjectDetail(id: string) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: QK.project(id),
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/portal/projects/${id}`, undefined, { silent: true });
      return parseJsonOrThrow<WireProjectDetail>(res);
    },
    enabled: !!id,
    retry: false,
  });
}

/**
 * `POST /api/portal/projects/:id/closure` (#4058) — the customer sign-off act
 * itself (#4025). This route only ever UPDATES the closure row the admin's
 * closure-request already inserted; it 404s if none exists and 409s if it's
 * already signed. On settle, invalidate the project-detail query rather than
 * optimistically patch it — the same reasoning as `useSignRbdDocument`'s
 * `onSettled`, since a 409 means our local view of `closure` was stale.
 */
export function useSignProjectClosure(id: string) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: SignProjectClosureRequest) => {
      const res = await fetchWithAuth(`/api/portal/projects/${id}/closure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<WireProjectClosure>(res);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: QK.project(id) });
    },
  });
}

/**
 * Subscribes to `GET /api/portal/projects/:id/kanban-events` and patches the
 * `tasks` array of the already-cached project-detail query on every real
 * `kanban_change` broadcast — the same created/updated/deleted actions
 * `admin-panel`'s `ProjectDetail.tsx` applies against its own local state,
 * here applied against the react-query cache instead since this page has no
 * parallel local `tasks` state of its own.
 */
export function useProjectKanbanEvents(id: string, enabled: boolean) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const idRef = useRef(id);
  idRef.current = id;

  useEffect(() => {
    if (!enabled || !id || !accessToken) return;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1000;
    let mounted = true;

    const connect = () => {
      if (!mounted) return;
      es = new EventSource(`/api/portal/projects/${id}/kanban-events?token=${encodeURIComponent(accessToken)}`);

      es.onmessage = (event) => {
        let payload: KanbanChangeEvent;
        try {
          payload = JSON.parse(event.data as string) as KanbanChangeEvent;
        } catch {
          return;
        }
        backoff = 1000;
        const { action, task } = payload;
        queryClient.setQueryData<WireProjectDetail>(QK.project(idRef.current), (prev) => {
          if (!prev) return prev;
          if (action === "updated") {
            return { ...prev, tasks: prev.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)) };
          }
          if (action === "created") {
            return prev.tasks.some((t) => t.id === task.id) ? prev : { ...prev, tasks: [...prev.tasks, task] };
          }
          if (action === "deleted") {
            return { ...prev, tasks: prev.tasks.filter((t) => t.id !== task.id) };
          }
          return prev;
        });
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (!mounted) return;
        reconnectTimer = setTimeout(() => {
          backoff = Math.min(backoff * 2, 30_000);
          void queryClient.invalidateQueries({ queryKey: QK.project(idRef.current) });
          connect();
        }, backoff);
      };
    };

    connect();
    return () => {
      mounted = false;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, accessToken, enabled]);
}
