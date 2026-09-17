/**
 * Synchronous name/fact cache for MSP Directory records.
 *
 * `PeekResolver` is synchronous (`(id) => PeekModel | null`) but every real
 * record here comes from an async fetch — so peek resolvers (and, through
 * them, `docLabel()` for tab titles and the Back group) can only ever read a
 * cache, never fetch on demand. `DirExplorerTree` populates this the moment
 * the tree loads, which already carries every MSP/customer/user name, group
 * role and OU name in one shot — everything `docLabel` needs to show a real
 * name instead of a bare id. Canvases additionally enrich an entry with a
 * couple of extra facts once their own detail fetch resolves, but the base
 * name is never blocked on that.
 *
 * Not a React store — `docLabel`/peek resolution happens outside React
 * (`registry.ts`), so this stays a plain mutable module object. Components
 * that need to re-render when it changes (the Explorer tree redrawing labels)
 * already re-render from their own fetch state; nothing currently needs a
 * subscription.
 */

import type { DirTree } from "./dirTypes";

export interface DirCachedRecord {
  title: string;
  sub?: string;
  tag?: string;
  tagTone?: "good" | "warn" | "bad";
}

const cache = {
  msp: new Map<string, DirCachedRecord>(),
  customer: new Map<string, DirCachedRecord>(),
  user: new Map<string, DirCachedRecord>(),
  group: new Map<string, DirCachedRecord>(),
  ou: new Map<string, DirCachedRecord>(),
};

export type DirCacheKind = keyof typeof cache;

/** Test seam. Not used by the app. */
export function resetDirNameCacheForTest(): void {
  for (const kind of Object.keys(cache) as DirCacheKind[]) cache[kind].clear();
}

export function getDirCachedRecord(kind: DirCacheKind, id: string): DirCachedRecord | null {
  return cache[kind].get(id) ?? null;
}

/** Cheap live counts for the palette's `?` answer rows — reads the same cache, never fetches. */
export function getDirCacheSize(kind: DirCacheKind): number {
  return cache[kind].size;
}

/** Every cached record of one kind, for building palette `#` record rows without a second fetch. */
export function getAllDirCachedRecords(kind: DirCacheKind): Array<{ id: string; record: DirCachedRecord }> {
  return [...cache[kind].entries()].map(([id, record]) => ({ id, record }));
}

export function setDirCachedRecord(kind: DirCacheKind, id: string, record: DirCachedRecord): void {
  cache[kind].set(id, record);
}

/** Populated once per tree load — the single cheapest source for every name this screen needs. */
export function primeDirNameCacheFromTree(tree: DirTree): void {
  for (const msp of tree.msps) {
    cache.msp.set(String(msp.id), {
      title: msp.name,
      sub: msp.domain ?? msp.slug,
      tag: msp.status,
      tagTone: msp.status === "active" ? "good" : msp.status === "suspended" ? "bad" : "warn",
    });
    for (const customer of msp.customers) {
      cache.customer.set(String(customer.id), {
        title: customer.name,
        sub: customer.domain ?? msp.name,
        tag: customer.status,
        tagTone: customer.status === "active" ? "good" : "warn",
      });
      for (const user of customer.users) {
        cache.user.set(String(user.id), {
          title: user.name || user.email,
          sub: user.mspRole,
          tag: user.isActive ? undefined : "disabled",
          tagTone: "bad",
        });
      }
    }
  }
  for (const group of tree.groups) {
    cache.group.set(group.role, { title: group.role, sub: `${group.count} member${group.count === 1 ? "" : "s"}` });
  }
  for (const ou of tree.ous) {
    cache.ou.set(String(ou.id), { title: ou.name });
  }
}
