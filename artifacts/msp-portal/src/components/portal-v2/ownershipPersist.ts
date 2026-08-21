/**
 * ownershipPersist.ts — the write side of the Ownership matrix.
 *
 * The module already updates its own React state the instant a name is assigned,
 * a handover starts, or a row is added — that optimism is what makes the page
 * feel immediate. What was missing was making any of it OUTLIVE the session:
 * every one of those mutations was local state and nothing else, so a reload
 * showed the tenant's read-only base matrix again.
 *
 * These five calls are that persistence. Each POSTs to the customer-scoped write
 * routes on `portal-ownership.ts` and reports whether the save landed, so the
 * caller can leave a failed edit on screen with an honest "not saved" note rather
 * than pretend it stuck. They are deliberately fire-safe: the UI has already
 * moved, so a rejected promise here must never throw into a click handler.
 *
 * `{ silent: true }` suppresses `fetchWithAuth`'s global error toast — the matrix
 * surfaces a save failure in its own toast, in the matrix's own voice, rather
 * than the generic one.
 */

type FetchWithAuth = (
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: { silent?: boolean },
) => Promise<Response>;

const BASE = "/api/portal/ownership";

async function post(
  fetchWithAuth: FetchWithAuth,
  path: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetchWithAuth(
      `${BASE}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { silent: true },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The five matrix mutations, as persistence calls. Each resolves `true` when the
 * write landed and `false` on any failure — never rejects, so a caller can `void`
 * it or await the boolean without a try/catch.
 */
export interface OwnershipPersist {
  /** Assign (owner id) or clear ("") a cell. Clearing is a real "gap" value. */
  assign(objectId: string, roleKey: string, ownerPersonId: string): Promise<boolean>;
  /** Mark a pending cell accepted. */
  accept(objectId: string, roleKey: string): Promise<boolean>;
  /** Start a dated handover from one person to another. */
  startHandover(
    fromPersonId: string,
    toPersonId: string,
    until: string,
    scope: string,
  ): Promise<boolean>;
  /** End the active handover(s) from a person. */
  endHandover(fromPersonId: string): Promise<boolean>;
  /** Add a row — a hand-made "custom" one, or a promoted "coverage" one. */
  addRow(
    rowId: string,
    source: "custom" | "coverage",
    objType: string,
    name: string,
    sub: string,
  ): Promise<boolean>;
}

/** Bind the five calls to a `fetchWithAuth`. */
export function makeOwnershipPersist(fetchWithAuth: FetchWithAuth): OwnershipPersist {
  return {
    assign: (objectId, roleKey, ownerPersonId) =>
      post(fetchWithAuth, "/assign", { objectId, roleKey, ownerPersonId }),
    accept: (objectId, roleKey) => post(fetchWithAuth, "/accept", { objectId, roleKey }),
    startHandover: (fromPersonId, toPersonId, until, scope) =>
      post(fetchWithAuth, "/delegations", { fromPersonId, toPersonId, until, scope }),
    endHandover: (fromPersonId) => post(fetchWithAuth, "/delegations/end", { fromPersonId }),
    addRow: (rowId, source, objType, name, sub) =>
      post(fetchWithAuth, "/rows", { rowId, source, objType, name, sub }),
  };
}
