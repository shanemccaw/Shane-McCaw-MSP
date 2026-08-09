/**
 * The screen registry.
 *
 * Screens register once at module load. The shell reads the registry to build
 * the ribbon, the palette index, the peek dispatcher and the router — so a
 * screen is reachable the moment it registers, with no second place to edit.
 */

import { logger } from "@/lib/logger";
import {
  FIXED_TAB_INTENTS,
  type CommandItem,
  type FixedTabId,
  type PeekKind,
  type PeekModel,
  type PeekResolver,
  type RibbonContribution,
  type RibbonGroup,
  type ScreenModule,
} from "./types";

const log = logger.child({ channel: "admin.shell" });

const screens = new Map<string, ScreenModule>();

/** Thrown when a screen breaks a shell invariant. Always a programming error. */
export class ShellContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShellContractError";
  }
}

/**
 * Re-runs handoff.md section 3's audit on one contribution.
 *
 * Returns the offending command labels. Empty means the contribution is legal.
 * Kept pure and exported so the rule is testable without registering anything.
 */
export function auditFixedTabIntents(contribution: RibbonContribution): string[] {
  const { group } = contribution;
  const all = [...(group.large ?? []), ...(group.small ?? []), ...(group.row ?? [])];
  return all.filter((c) => !FIXED_TAB_INTENTS.includes(c.intent)).map((c) => c.label);
}

/**
 * Registers a screen.
 *
 * Throws if the screen puts a `record` command on a fixed tab. That is not
 * defensive coding for its own sake: the audit that produced this rule found
 * six screens had already drifted, and a silent contribution is exactly how
 * they drifted. Failing at load makes the drift impossible to ship.
 */
export function registerScreen(screen: ScreenModule): void {
  if (screens.has(screen.id)) {
    throw new ShellContractError(
      `Screen "${screen.id}" is already registered. Screen ids must be unique.`,
    );
  }

  for (const contribution of screen.ribbon ?? []) {
    const offenders = auditFixedTabIntents(contribution);
    if (offenders.length > 0) {
      throw new ShellContractError(
        `Screen "${screen.id}" puts record-scoped command(s) [${offenders.join(", ")}] on the ` +
          `fixed "${contribution.tab}" tab. A fixed tab may only open, create, or act across ` +
          `everything — anything needing a specific record open belongs on the contextual tab.`,
      );
    }
  }

  screens.set(screen.id, screen);
  log.debug({ screen: screen.id, route: screen.route }, "screen registered");
}

/** Test seam. Not used by the app. */
export function resetRegistry(): void {
  screens.clear();
}

export function getScreen(id: string): ScreenModule | undefined {
  return screens.get(id);
}

export function allScreens(): ScreenModule[] {
  return [...screens.values()];
}

export function screenForRoute(route: string): ScreenModule | undefined {
  return [...screens.values()].find((s) => s.route === route);
}

/**
 * Every group contributed to one fixed tab, ordered.
 *
 * `order` sorts first; registration order breaks ties, which keeps the ribbon
 * stable across reloads instead of following Map iteration luck.
 */
export function groupsForFixedTab(tab: FixedTabId): RibbonGroup[] {
  const contributions: Array<{ group: RibbonGroup; order: number; seq: number }> = [];
  let seq = 0;
  for (const screen of screens.values()) {
    for (const contribution of screen.ribbon ?? []) {
      if (contribution.tab !== tab) continue;
      contributions.push({ group: contribution.group, order: contribution.order ?? 100, seq: seq++ });
    }
  }
  contributions.sort((a, b) => a.order - b.order || a.seq - b.seq);
  return contributions.map((c) => c.group);
}

// ─── Peek dispatch ────────────────────────────────────────────────────────────

/**
 * Resolves a peek by kind, asking each screen that claims the kind until one
 * answers. More than one screen may own a kind (a tenant peek can come from
 * either the tenant list or an endpoint's tenant scope) — first non-null wins.
 */
export function resolvePeek(kind: PeekKind, id: string): PeekModel | null {
  for (const screen of screens.values()) {
    const resolver: PeekResolver | undefined = screen.peeks?.[kind];
    if (!resolver) continue;
    const model = resolver(id);
    if (model) return model;
  }
  log.warn({ kind, id }, "no screen resolved this peek");
  return null;
}

/**
 * A human name for any kind + id pair.
 *
 * Reuses the peek resolvers rather than keeping a second name table, so a
 * record that renders a peek can never disagree with its own label in the tab
 * strip or in the Back group. Falls back to the raw id, which is ugly on
 * purpose — an ugly label is a visible bug, a pretty guess is a silent one.
 */
export function docLabel(kind: PeekKind | "screen", id: string): string {
  if (kind === "screen") return getScreen(id)?.title ?? id;
  return resolvePeek(kind, id)?.title ?? id;
}

/** Kinds at least one registered screen can resolve. */
export function resolvablePeekKinds(): PeekKind[] {
  const kinds = new Set<PeekKind>();
  for (const screen of screens.values()) {
    for (const kind of Object.keys(screen.peeks ?? {}) as PeekKind[]) kinds.add(kind);
  }
  return [...kinds];
}

// ─── Palette index ────────────────────────────────────────────────────────────

/**
 * Rebuilds the palette index.
 *
 * Called on every open rather than cached, because `?` rows carry live numbers
 * and a cached profit figure is worse than no profit figure. Every screen's
 * destination is contributed automatically so a screen never has to remember to
 * list itself.
 */
export function buildCommandIndex(navigate: (route: string) => void): CommandItem[] {
  const items: CommandItem[] = [];

  for (const screen of screens.values()) {
    items.push({
      id: `dest:${screen.id}`,
      type: "destination",
      kind: "go",
      name: screen.title,
      sub: screen.route,
      area: screen.area,
      run: () => navigate(screen.route),
    });
  }

  for (const screen of screens.values()) {
    if (!screen.commands) continue;
    try {
      items.push(...screen.commands());
    } catch (err) {
      log.error(
        { screen: screen.id, message: err instanceof Error ? err.message : String(err) },
        "screen command source threw; its entries are missing from the palette",
      );
    }
  }

  return items;
}
