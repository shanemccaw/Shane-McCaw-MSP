/**
 * portalV2People.ts — the one people list the portal edits and reads.
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
 * ── Client state, for now, and honestly so ─────────────────────────────────
 * There is no people/roles endpoint behind this yet, so edits live for the
 * session and reset on reload — the same standing as the prototype, which also
 * persists nothing. The seed is `OWN_PEOPLE_SEED` in one place so it can be
 * swapped for a fetch without touching either page, which is the project's
 * standing fixture rule. When the endpoint lands, `setPeople` becomes the
 * mutation and `usePortalV2People` the query; no caller changes.
 */

import { useCallback, useSyncExternalStore } from "react";

import { OWN_ESC_DAYS_SEED, OWN_PEOPLE_SEED, type OwnPerson } from "./settingsData";

let people: readonly OwnPerson[] = OWN_PEOPLE_SEED;

/**
 * The escalation threshold, which lives here for the SAME reason the people
 * list does: Settings → Ownership routing sets it ("Escalate to the accountable
 * name after N days of no movement"), and the Ownership matrix reads it to
 * decide which cells are past the clock. Two pages, one number. Left in
 * Settings' local state it would silently do nothing to the matrix, which is
 * the exact drift this store exists to prevent.
 */
let escDays: number = OWN_ESC_DAYS_SEED;

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
  escDays = OWN_ESC_DAYS_SEED;
  notify();
}

/**
 * The shell-owned people list plus its writer.
 *
 * Settings edits through `setPeople`; Ownership passes the same pair down as
 * the design's `people` / `onPeopleChange`, so the module keeps working
 * standalone against its own local state — see PortalV2OwnershipMatrix.
 */
export function usePortalV2People(): {
  people: readonly OwnPerson[];
  setPeople: (next: readonly OwnPerson[]) => void;
} {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setPeople = useCallback((next: readonly OwnPerson[]) => {
    setPortalV2People(next);
  }, []);
  return { people: list, setPeople };
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
