/**
 * portalV2People.ts — the one people list the portal edits and reads, and now
 * the one place the Ownership matrix's data is loaded.
 *
 * ── What the design asks for ────────────────────────────────────────────────
 * Round Two moved People & roles out of Ownership and into Settings, and made
 * the list SHARED rather than duplicated. The README states the contract:
 *
 *   "The people list (name, role, side, kind, away/deputy) is now owned by the
 *    shell (`state.ownPeople`) and passed into `Ownership.dc.html` as a
 *    `people` prop plus an `onPeopleChange` callback; Ownership falls back to
 *    its own local state when used standalone. Edit it from Settings → People &
 *    roles; the Ownership matrix reads the same data live."
 *
 * In the prototype that is trivial, because Settings and Ownership are two
 * sections of ONE component and `state.ownPeople` is just a field on it. Here
 * they are two routed pages, so "owned by the shell" needs a real mechanism.
 *
 * ── Why an external store and not React context ────────────────────────────
 * The obvious answer is a provider inside `PortalV2Shell`. It does not work,
 * for a structural reason worth writing down so it is not re-attempted:
 *
 *   • Every portal-v2 page renders `<PortalV2Shell>…</PortalV2Shell>` from
 *     inside its OWN component body. A provider mounted in the shell is
 *     therefore BELOW the page in the render tree, so a `useContext` call in
 *     the page's body cannot see it.
 *   • Hoisting the provider into `App.tsx` around the portal-v2 routes does not
 *     work either: wouter's `<Switch>` matches its DIRECT `<Route>` children,
 *     so wrapping a subset of them in a provider element stops them matching.
 *
 * `useSyncExternalStore` over a module-level list solves both, and it is a
 * closer match to what the design actually describes: ONE list for the whole
 * portal surface, not one per mounted subtree. Navigating Settings → Ownership
 * keeps the edits, which is the behaviour the README's "reads the same data
 * live" sentence is really specifying — a provider that remounted would lose
 * them.
 *
 * ── The people list is now REAL, and it is still ONE list ──────────────────
 * `GET /api/portal/ownership` supplies it: the tenant's own active users, from
 * `users.tenant_id = customerId`. The load lands HERE rather than in either
 * page, which is the whole point — Settings and Ownership read the same store,
 * so neither had to change how it gets people, and there is no second source to
 * drift from the first. The route's own header states what is real on it and
 * what is not; `ownershipWire.ts` decides which source is on screen.
 *
 * The read runs ONCE per session (`loadPromise`), because a module-level store
 * mounted by two pages would otherwise re-fetch on every navigation between
 * them.
 *
 * ── Edits still do not persist, and that is still honest ───────────────────
 * There is no people/roles WRITE endpoint, and no ownership/RACI table for one
 * to write to. Renaming someone in Settings still lives for the session and
 * resets on reload — the same standing as the prototype, which persists nothing
 * either. What changed is only where the list STARTS: the tenant's real roster
 * instead of the design's nine invented names. A local edit is never clobbered
 * by a hydrate that lands afterwards (`peopleEdited`), because silently
 * reverting something a user typed is worse than showing it unsaved.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { useAuth } from "@/lib/auth-context";

import { OWN_ESC_DAYS_SEED, OWN_PEOPLE_SEED, OWN_SIDES, type OwnPerson } from "./settingsData";
import type { OwnObject } from "./ownershipData";
import {
  OWNERSHIP_FIXTURE,
  toOwnershipData,
  type OwnDataState,
  type OwnershipData,
  type WireOwnershipPayload,
} from "./ownershipWire";

const OWNERSHIP_URL = "/api/portal/ownership";

let people: readonly OwnPerson[] = OWN_PEOPLE_SEED;

/**
 * Set the moment anything writes through `setPortalV2People`, so a hydrate that
 * arrives afterwards leaves the edit alone. Without it, a slow first response
 * landing after a fast rename would undo the rename with no trace of why.
 */
let peopleEdited = false;

/**
 * The escalation threshold, which lives here for the SAME reason the people
 * list does: Settings → Ownership routing sets it ("Escalate to the accountable
 * name after N days of no movement"), and the Ownership matrix reads it to
 * decide which cells are past the clock. Two pages, one number. Left in
 * Settings' local state it would silently do nothing to the matrix, which is
 * the exact drift this store exists to prevent.
 */
let escDays: number = OWN_ESC_DAYS_SEED;

/** The matrix rows and their provenance. Null until the first read settles. */
let ownership: OwnershipData | null = null;
let dataState: OwnDataState = "loading";
let loadPromise: Promise<void> | null = null;

const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Returns the SAME array reference until something writes, which is what
 * `useSyncExternalStore` requires — returning a fresh array here would loop.
 */
function getSnapshot(): readonly OwnPerson[] {
  return people;
}

/** Writes and notifies. Exported for tests and for a future mutation hook. */
export function setPortalV2People(next: readonly OwnPerson[]): void {
  people = next;
  peopleEdited = true;
  notify();
}

function getEscDays(): number {
  return escDays;
}

export function setPortalV2EscDays(next: number): void {
  escDays = next;
  notify();
}

/** Test-only: put the store back to its seeds between cases. */
export function resetPortalV2People(): void {
  people = OWN_PEOPLE_SEED;
  peopleEdited = false;
  escDays = OWN_ESC_DAYS_SEED;
  ownership = null;
  dataState = "loading";
  loadPromise = null;
  notify();
}

function getOwnership(): OwnershipData | null {
  return ownership;
}

function getDataState(): OwnDataState {
  return dataState;
}

type FetchWithAuth = (
  input: string,
  init?: RequestInit,
  opts?: { silent?: boolean },
) => Promise<Response>;

/**
 * Reads the matrix once per session and hydrates the store from it.
 *
 * A failed, forbidden or empty read settles `dataState` to "fixture" and leaves
 * the design's estate on screen rather than emptying a page a customer is
 * looking at. `ownershipWire.toOwnershipData` decides what counts as empty, and
 * says why there.
 */
export function ensurePortalV2OwnershipLoaded(fetchWithAuth: FetchWithAuth): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const res = await fetchWithAuth(OWNERSHIP_URL, {}, { silent: true });
      if (!res.ok) {
        dataState = "fixture";
        notify();
        return;
      }
      const body = (await res.json()) as WireOwnershipPayload;
      const parsed = toOwnershipData(body);
      if (!parsed) {
        dataState = "fixture";
        notify();
        return;
      }
      ownership = parsed;
      dataState = "live";
      if (!peopleEdited) people = parsed.people;
      notify();
    } catch {
      dataState = "fixture";
      notify();
    }
  })();

  return loadPromise;
}

/**
 * The shell-owned people list plus its writer.
 *
 * Settings edits through `setPeople`; Ownership passes the same pair down as
 * the design's `people` / `onPeopleChange`, so the module keeps working
 * standalone against its own local state — see `OwnershipMatrix`.
 *
 * Mounting this hook is also what triggers the one read, so BOTH pages get the
 * real roster without either of them having to know there is an endpoint.
 */
export function usePortalV2People(): {
  people: readonly OwnPerson[];
  setPeople: (next: readonly OwnPerson[]) => void;
  /** The cycle order for a person's side, with the tenant's real name first. */
  sides: readonly string[];
  dataState: OwnDataState;
} {
  const { fetchWithAuth } = useAuth();
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;

  // `fetchWithAuth` is rebuilt on every silent token refresh, so it is held in
  // a ref rather than in the dependency array — the same reason every polling
  // hook in this codebase does.
  useEffect(() => {
    void ensurePortalV2OwnershipLoaded((input, init, opts) => fetchRef.current(input, init, opts));
  }, []);

  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const state = useSyncExternalStore(subscribe, getDataState, getDataState);
  const data = useSyncExternalStore(subscribe, getOwnership, getOwnership);

  const setPeople = useCallback((next: readonly OwnPerson[]) => {
    setPortalV2People(next);
  }, []);

  return { people: list, setPeople, sides: data?.sides ?? OWN_SIDES, dataState: state };
}

/**
 * The matrix's rows, for the page that renders them.
 *
 * Separate from `usePortalV2People` because the two have different fallbacks —
 * an unloaded people list is the design's nine names, an unloaded matrix is its
 * twenty-four objects — and a caller wanting one should not have to reason
 * about the other.
 */
export function usePortalV2OwnershipObjects(): {
  objects: readonly OwnObject[];
  dataState: OwnDataState;
  sources: OwnershipData["sources"];
  customerName: string;
  tenantScoped: boolean;
} {
  const { fetchWithAuth } = useAuth();
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;

  useEffect(() => {
    void ensurePortalV2OwnershipLoaded((input, init, opts) => fetchRef.current(input, init, opts));
  }, []);

  const data = useSyncExternalStore(subscribe, getOwnership, getOwnership);
  const state = useSyncExternalStore(subscribe, getDataState, getDataState);
  const source = data ?? OWNERSHIP_FIXTURE;

  return {
    objects: source.objects,
    dataState: state,
    sources: source.sources,
    customerName: source.customerName,
    tenantScoped: source.tenantScoped,
  };
}

/**
 * The escalation threshold from Settings → Ownership routing.
 *
 * Settings writes it; the Ownership matrix reads it to mark cells past the
 * clock. A cell is late when its idle days STRICTLY exceed this, so raising it
 * from 5 to 10 clears the two late marks on the seeded estate live — which is
 * the behaviour the two pages have to share for the number to mean anything.
 */
export function usePortalV2EscDays(): {
  escDays: number;
  setEscDays: (next: number) => void;
} {
  const value = useSyncExternalStore(subscribe, getEscDays, getEscDays);
  const setEscDays = useCallback((next: number) => {
    setPortalV2EscDays(next);
  }, []);
  return { escDays: value, setEscDays };
}
