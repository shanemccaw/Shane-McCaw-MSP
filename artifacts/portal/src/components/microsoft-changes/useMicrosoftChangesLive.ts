import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { MessageCenterResponse, WirePost } from "./types";

const MESSAGE_CENTER_URL = "/api/portal/message-center";

export type DataState = "loading" | "live" | "failed";

/** A routed CR still open for the customer to act on — the "needs a decision" triage set. */
export function isActionableRouting(post: WirePost): boolean {
  const r = post.routing;
  if (!r) return false;
  if (r.decision !== "auto_created") return false;
  if (r.intake !== "approval") return false;
  if (r.declined) return false;
  if (r.changeRequestStatus && ["completed", "rolled_back", "rejected"].includes(r.changeRequestStatus)) return false;
  return true;
}

/** One wave column, aggregated from the real 11-bucket axis (`buckets[i].wave`) — never a hardcoded band. */
export interface WaveGroup {
  readonly key: string;
  readonly label: string;
  readonly span: string;
  readonly bucketIndexes: readonly number[];
  /** Counted over the WHOLE corpus (from `density`), not just the capped `posts` sent for this wave. */
  readonly count: number;
}

export interface MicrosoftChangesState {
  readonly dataState: DataState;
  readonly data: MessageCenterResponse | null;
  readonly waveGroups: readonly WaveGroup[];
  /** Every post across the whole payload whose routing still needs the customer's decision. */
  readonly triagePosts: readonly WirePost[];
  /** How many posts carry a confirmed interpretation at all — 0 today, live (contract pack §"dormant pipeline"). */
  readonly analysedCount: number;
  readonly refetch: () => void;
  readonly declining: string | null;
  readonly declineError: string | null;
  decline: (post: WirePost, fullName: string, statement: string) => Promise<boolean>;
}

function buildWaveGroups(data: MessageCenterResponse): WaveGroup[] {
  const groups: WaveGroup[] = [];
  let cur: { key: string; bucketIndexes: number[] } | null = null;
  data.buckets.forEach((b, i) => {
    if (!cur || cur.key !== b.wave) {
      cur = { key: b.wave, bucketIndexes: [i] };
      groups.push({ key: b.wave, label: b.wave, span: "", bucketIndexes: cur.bucketIndexes, count: 0 });
    } else {
      cur.bucketIndexes.push(i);
    }
  });
  return groups.map((g) => {
    const first = data.buckets[g.bucketIndexes[0]];
    const last = data.buckets[g.bucketIndexes[g.bucketIndexes.length - 1]];
    const span =
      g.bucketIndexes.length === 1
        ? `${first.label} ${first.sub}`
        : `${first.label} – ${last.label} ${last.sub}`.trim();
    const count =
      data.scoped &&
      data.density.reduce(
        (sum, row) =>
          sum + g.bucketIndexes.reduce((s, bi) => s + (row.cells[bi]?.[0] ?? 0) + (row.cells[bi]?.[1] ?? 0) + (row.cells[bi]?.[2] ?? 0) + (row.cells[bi]?.[3] ?? 0), 0),
        0,
      );
    return { ...g, span, count: typeof count === "number" ? count : 0 };
  });
}

/**
 * Data layer for the Microsoft Changes page (#1744), backing
 * `GET /api/portal/message-center` (contract pack §1a) and the customer
 * decline action `POST /api/portal/change-control/:code/decline` (§1c).
 * No fixture data — every number the page renders comes from this fetch.
 */
export function useMicrosoftChangesLive(): MicrosoftChangesState {
  const { fetchWithAuth } = useAuth();
  const [dataState, setDataState] = useState<DataState>("loading");
  const [data, setData] = useState<MessageCenterResponse | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [declining, setDeclining] = useState<string | null>(null);
  const [declineError, setDeclineError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setDataState("loading");
    try {
      const res = await fetchWithAuth(MESSAGE_CENTER_URL);
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      const body = (await res.json()) as MessageCenterResponse;
      setData(body);
      setDataState("live");
    } catch {
      setDataState("failed");
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  const refetch = useCallback(() => setAttempt((n) => n + 1), []);

  const waveGroups = data ? buildWaveGroups(data) : [];
  const triagePosts = data && data.scoped ? data.posts.filter(isActionableRouting) : [];
  const analysedCount = data && data.scoped ? data.posts.filter((p) => p.analysis !== null).length : 0;

  const decline = useCallback(
    async (post: WirePost, fullName: string, statement: string): Promise<boolean> => {
      const code = post.routing?.changeRequestCode;
      if (!code) return false;
      setDeclining(post.id);
      setDeclineError(null);
      try {
        const res = await fetchWithAuth(`/api/portal/change-control/${encodeURIComponent(code)}/decline`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName, statement }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `decline failed (${res.status})`);
        }
        await load();
        return true;
      } catch (err) {
        setDeclineError(err instanceof Error ? err.message : "Failed to decline the change.");
        return false;
      } finally {
        setDeclining(null);
      }
    },
    [fetchWithAuth, load],
  );

  return { dataState, data, waveGroups, triagePosts, analysedCount, refetch, declining, declineError, decline };
}
