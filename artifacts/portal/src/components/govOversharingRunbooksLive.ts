/**
 * govOversharingRunbooksLive.ts — real per-kind runbook state for the
 * Overshared SharePoint drill-down's per-site fix actions (#1286).
 *
 * The drill-down's own design keeps this state per-KIND and global, not
 * per-site (see `portal-v2-gov-oversharing.tsx`'s header) — opening "Convert
 * to Private" on one site and checking a step is the same runbook everywhere
 * that action appears. That maps directly onto ONE `portal_runbooks` row per
 * kind per customer, which is exactly what this hook reads/writes:
 *
 *   POST /api/portal/oversharing/runbooks/:sopKind   — ensure + fetch, once per kind
 *   PUT  /api/portal/runbooks/:runbookId/steps/:position — the EXISTING generic
 *        toggle route `portal-runbooks.ts` already built; no new toggle route.
 *
 * A kind's runbook is only fetched the first time it is opened — the page
 * does not eagerly create three rows for a customer who never opens any of
 * them. If the ensure call fails, the kind simply stays unresolved and its
 * checklist renders with nothing checked rather than blocking the page.
 */

import { useCallback, useState } from "react";

import { useAuth } from "@/lib/auth-context";

export type OversharingSopKind = "convert" | "reduceAdmins" | "manageGuests";

const SOP_KINDS: readonly OversharingSopKind[] = ["convert", "reduceAdmins", "manageGuests"];

interface RunbookWireStep {
  readonly position: number;
  readonly text: string;
  readonly checked: boolean;
}

interface RunbookWire {
  readonly id: number;
  readonly steps: readonly RunbookWireStep[];
}

interface LoadedRunbook {
  readonly id: number;
  /** 0-based checked indices — RunbookSteps.tsx's own `checked` prop shape. */
  readonly checked: readonly number[];
}

export function useOversharingRunbooksLive() {
  const { fetchWithAuth } = useAuth();
  const [open, setOpen] = useState<Record<OversharingSopKind, boolean>>({
    convert: false,
    reduceAdmins: false,
    manageGuests: false,
  });
  const [runbooks, setRunbooks] = useState<Partial<Record<OversharingSopKind, LoadedRunbook>>>({});
  const [loading, setLoading] = useState<Partial<Record<OversharingSopKind, boolean>>>({});

  const ensure = useCallback(
    async (kind: OversharingSopKind) => {
      if (runbooks[kind] || loading[kind]) return;
      setLoading((l) => ({ ...l, [kind]: true }));
      try {
        const res = await fetchWithAuth(
          `/api/portal/oversharing/runbooks/${kind}`,
          { method: "POST" },
          { silent: true },
        );
        if (!res.ok) throw new Error(`ensure runbook ${kind} ${res.status}`);
        const body = (await res.json()) as RunbookWire;
        const checked = body.steps.filter((s) => s.checked).map((s) => s.position - 1);
        setRunbooks((r) => ({ ...r, [kind]: { id: body.id, checked } }));
      } catch {
        // Left unresolved — the checklist still renders, just with nothing
        // checked and no persistence until the next successful ensure.
      } finally {
        setLoading((l) => ({ ...l, [kind]: false }));
      }
    },
    [runbooks, loading, fetchWithAuth],
  );

  const toggleOpen = useCallback(
    (kind: OversharingSopKind) => {
      setOpen((o) => {
        const next = !o[kind];
        if (next) void ensure(kind);
        return { ...o, [kind]: next };
      });
    },
    [ensure],
  );

  const toggleStep = useCallback(
    (kind: OversharingSopKind, index: number) => {
      const runbook = runbooks[kind];
      if (!runbook) return;
      const position = index + 1;
      const wasChecked = runbook.checked.includes(position);
      setRunbooks((r) => ({
        ...r,
        [kind]: {
          ...runbook,
          checked: wasChecked ? runbook.checked.filter((p) => p !== position) : [...runbook.checked, position],
        },
      }));
      void fetchWithAuth(
        `/api/portal/runbooks/${runbook.id}/steps/${position}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checked: !wasChecked }),
        },
        { silent: true },
      );
    },
    [runbooks, fetchWithAuth],
  );

  const checkedByKind = Object.fromEntries(
    SOP_KINDS.map((k) => [k, runbooks[k]?.checked ?? []]),
  ) as Record<OversharingSopKind, readonly number[]>;

  return { open, checkedByKind, toggleOpen, toggleStep };
}
