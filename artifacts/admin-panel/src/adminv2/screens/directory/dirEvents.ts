/**
 * MSP Directory — cross-component event bus.
 *
 * Two things need to reach a component they have no prop path to:
 *
 *  - Any write action (OU create, MSP create/suspend) needs the Explorer
 *    tree to reload, but the tree is a sibling panel, not a parent/child.
 *  - The contextual-tab ribbon buttons (`registry/types.ts`'s
 *    `ContextualTabSpec`) are built in `screens/directory/index.tsx`, outside the
 *    canvas component that actually owns the loading/outcome state for the
 *    open record — routing the click through an event keeps exactly one
 *    place (the canvas) doing the fetch and showing the result, rather than
 *    duplicating both in the ribbon closure.
 *
 * Same `CustomEvent` convention the old admin panel's own
 * `ActiveDirectoryTree.tsx` already uses for its select-object handoff
 * (`DIR_SELECT_EVENT`) — not a new pattern.
 */

export const DIR_TREE_REFRESH_EVENT = "av2:ad:tree-refresh";

export function requestDirTreeRefresh(): void {
  window.dispatchEvent(new Event(DIR_TREE_REFRESH_EVENT));
}

/** What a contextual-tab ribbon button asks the open record's canvas to do. */
export type DirRecordAction =
  | "run-scan"
  | "revoke-graph-consent"
  | "copy-reconsent-link"
  | "impersonate"
  | "force-password-reset"
  | "reset-mfa"
  | "suspend-msp"
  | "reactivate-msp";

export interface DirRecordActionDetail {
  action: DirRecordAction;
  kind: string;
  id: string;
}

export const DIR_RECORD_ACTION_EVENT = "av2:ad:record-action";

export function requestDirRecordAction(detail: DirRecordActionDetail): void {
  window.dispatchEvent(new CustomEvent<DirRecordActionDetail>(DIR_RECORD_ACTION_EVENT, { detail }));
}

/** Canvas components call this once to listen for ribbon-triggered actions targeting the record they own. */
export function onDirRecordAction(
  kind: string,
  id: string,
  handler: (action: DirRecordAction) => void,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<DirRecordActionDetail>).detail;
    if (detail.kind === kind && detail.id === id) handler(detail.action);
  };
  window.addEventListener(DIR_RECORD_ACTION_EVENT, listener);
  return () => window.removeEventListener(DIR_RECORD_ACTION_EVENT, listener);
}
