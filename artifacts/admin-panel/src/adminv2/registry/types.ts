/**
 * adminv2 registration contracts.
 *
 * Every screen is a `ScreenModule`. A screen never renders chrome: it declares
 * what it contributes (ribbon groups, a contextual tab, peeks, palette entries,
 * panel content) and the shell assembles all of it. That indirection is the
 * whole point — handoff.md's second principle is "the same thing should always
 * be in the same place", and position only stays stable if screens cannot
 * choose their own placement.
 *
 * See SHELL.md for the narrative version of all of this.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// ─── Ribbon ───────────────────────────────────────────────────────────────────

/**
 * The seven fixed tabs. Home · Inbox · Money · Watch · View | Git · Run.
 *
 * This list is closed. A new screen does not get a new fixed tab — it
 * contributes groups to the tabs that already exist, and puts anything
 * record-specific on its contextual tab. Adding an eighth entry here is a
 * design decision, not an implementation detail.
 */
export const FIXED_TAB_IDS = ["home", "inbox", "money", "watch", "view", "git", "run", "build"] as const;
export type FixedTabId = (typeof FIXED_TAB_IDS)[number];

export const FIXED_TAB_LABELS: Record<FixedTabId, string> = {
  home: "Home",
  inbox: "Inbox",
  money: "Money",
  /** The "what needs me" tab: exceptions, alerts, dead letters, unrun migrations, overdue invoices. */
  watch: "Watch",
  view: "View",
  git: "Git",
  run: "Run",
  /** Build Tracker — Claude chats organised against epics and issues. */
  build: "Build",
};

/** Git, Run and Build render inside the amber capsule that marks them as the developer set. */
export const DEV_TAB_IDS: readonly FixedTabId[] = ["git", "run", "build"];

/** The five ordinary tabs, in ribbon order. */
export const MAIN_TAB_IDS: readonly FixedTabId[] = ["home", "inbox", "money", "watch", "view"];

/**
 * What a ribbon command does. This is the type-level form of the rule in
 * handoff.md section 3, which was arrived at by audit rather than by taste:
 *
 *   A fixed tab may only *open* something, *create* something, or act
 *   *across everything*. Anything requiring a specific record open belongs
 *   in a contextual tab.
 *
 * Endpoints, Money, SQL, Documents, Services and Marketing all violated this
 * and were stripped. `registerScreen` re-runs that audit at registration time,
 * so the violation is a startup error rather than a slow drift back.
 */
export type CommandIntent =
  /** Navigates to or reveals something. Legal on a fixed tab. */
  | "open"
  /** Makes a new thing. Legal on a fixed tab. */
  | "create"
  /** Acts across every record at once (publish all, run all, sync all). Legal on a fixed tab. */
  | "global"
  /** Needs a specific record open. **Contextual tabs only.** */
  | "record";

/** Intents a fixed tab is allowed to carry. */
export const FIXED_TAB_INTENTS: readonly CommandIntent[] = ["open", "create", "global"];

/**
 * One row in a ribbon gallery.
 *
 * Rows carry real data, not labels — a package shows its check count and what
 * the last run found; a script states destructive vs read-only. That is what
 * makes a 24-item list pickable without opening each one. A row whose `detail`
 * just restates its `name` is a row that should not exist.
 */
export interface GalleryRow {
  id: string;
  /**
   * The preview tile: two or three monospace characters carrying the row's most
   * useful number or code — a check count, a weight, a status letter. Not an
   * icon; the design uses text here because a number is more use than a glyph.
   */
  tile?: string;
  name: string;
  /** Short pill beside the name: a state, a type, a count. */
  head?: string;
  /** The real fact, underneath. */
  sub?: string;
  /** Marks the row as the current selection — tints the tile and shows a tick. */
  on?: boolean;
  /** Band this row sorts under. Rows sharing a value render under one header. */
  group?: string;
  /**
   * What clicking does. Almost always `openPeek` — handoff.md section 5: a
   * gallery row opens a peek rather than navigating.
   */
  onSelect: () => void;
}

export interface GallerySpec {
  id: string;
  /** Panel title. */
  title: string;
  rows: GalleryRow[];
  /** Adds the filter box and grows the panel from 428px to 520px. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** The one action at the bottom, e.g. "New package". */
  footer?: { label: string; onSelect: () => void };
}

export interface RibbonCommand {
  /** Shown under (large) or beside (small/row) the icon. Keep it short — it wraps at 68px. */
  label: string;
  icon: LucideIcon;
  intent: CommandIntent;
  /** Ignored when `gallery` is set — the button opens the gallery instead. */
  onSelect: () => void;
  /** Turns this button into a gallery dropdown. */
  gallery?: GallerySpec;
  /**
   * Icon stroke colour. Defaults to the neutral text ramp. Use ACCENT.* to mean
   * something — amber for needs-attention, danger for destructive. Never blue:
   * blue is the primary action colour and nothing else.
   */
  color?: string;
  disabled?: boolean;
  /** Tooltip. Defaults to `label`. */
  title?: string;
  /**
   * A live count rendered on the button. Only set this where the number means
   * you must act (handoff.md section 8: no badge counts otherwise). The Watch
   * tab's large button is the canonical user.
   */
  live?: string | number;
  /** Marks the button as currently active/selected. */
  active?: boolean;
  /**
   * Opts this button into `shell/liveRibbon.ts`'s overlay: at render time,
   * `label`/`color`/`active` above are read as defaults, then overridden by
   * whatever the matching key currently holds (if anything). Needed because
   * a screen's `ribbon` array is built once, at `registerScreen()`
   * module-load time, so it cannot show a number that only exists after a
   * real fetch resolves — the Money screen's "$770 in" button is the reason
   * this exists. Leave unset for anything that is genuinely static.
   */
  liveKey?: string;
}

/** A combo picker — a labelled dropdown that sits at the left of a group. */
export interface RibbonCombo {
  label: string;
  value: string;
  onSelect: () => void;
  title?: string;
}

/**
 * Group anatomy, per handoff.md section 3. A group may carry any combination of
 * a combo picker, one large button, a stack of small commands, and a row.
 *
 * When a group has both a combo and a row, the combo sits left and the row
 * stacks vertically beside it — that layout is handled by the shell, not here.
 */
export interface RibbonGroup {
  /** The caption under the group. 17px of vertical budget; one short line. */
  label: string;
  combos?: RibbonCombo[];
  large?: RibbonCommand[];
  small?: RibbonCommand[];
  row?: RibbonCommand[];
}

/** A screen's contribution of one group to one fixed tab. */
export interface RibbonContribution {
  tab: FixedTabId;
  group: RibbonGroup;
  /** Lower sorts left. Defaults to 100. Ties break on registration order. */
  order?: number;
}

/**
 * A contextual tab. Appears to the right of the fixed tabs, separated by a
 * rule, whenever `isActive` says the screen's record is open.
 *
 * Do **not** hand-author a Back group here. `assembleContextualGroups` splices
 * one in at position 2 for every contextual tab in the app, so the trail is in
 * the same place on Endpoint Tools, Script Tools, Pipeline Tools and everything
 * else. handoff.md calls this the single highest-value consistency decision in
 * the design.
 */
export interface ContextualTabSpec {
  id: string;
  /** e.g. "Endpoint Tools". */
  label: string;
  /** Groups excluding Back — the shell injects that. */
  groups: RibbonGroup[];
}

// ─── Peek ─────────────────────────────────────────────────────────────────────

/**
 * The record kinds the peek overlay knows how to open.
 *
 * `msp`, `user`, `group` and `ou` were added for the Active Directory screen
 * (`screens/ad/`) — an MSP, a portal user account, an RBAC group, and an
 * organizational-unit placeholder are each a real, openable record, the same
 * as `customer` (which AD reuses for a tenant) already was. Unlike
 * `FIXED_TAB_IDS`, this list is not closed: a screen introducing a genuinely
 * new record type extends it.
 *
 * `signal` was added for the Tenant Signals screen (`screens/tenant-signals/`).
 * A signal is a `custom_signals` catalog row keyed by string rather than by
 * id, and it is neither a `package` (a set of checks) nor a `script` — it is
 * the thing rules derive, so it needed its own kind rather than borrowing one
 * and lying about it in the eyebrow.
 *
 * `alert`, `exception`, `incident` and `dlq` were added for the Observability
 * screen (`screens/observability/`) — an alert rule, an exception group, a
 * public incident and a parked dead-letter job. Each is a distinct table row
 * with its own id space (`msp_alert_rules.id`, `exception_groups.fingerprint`,
 * `platform_incidents.id`, `msp_dlq_store.dlq_id`), so none of them could
 * reuse an existing kind without two records disagreeing about what an id
 * means.
 *
 * `migration` was added for the SQL Runner screen (`screens/sql/`) — a manual
 * migration file (`lib/db/migrations/manual/`) is a genuinely different
 * record shape from a saved SQL `script` (no name/category to edit, no
 * delete, an unknown destructive risk instead of a stored flag), so it needed
 * its own kind rather than borrowing `script` and lying about what a
 * migration's id/edits mean.
 *
 * `engine` was added for the Engines screen (`screens/engines/`). One of the
 * twelve intelligence engines in `lib/engine-registry.ts` is openable, keyed
 * by a stable string, and needs a name the tab strip and the Back group can
 * resolve — and no existing kind describes it: it is not a `package` of
 * checks, not a `workflow`, and not a `signal` (an engine *sums* signals; it
 * is not one).
 *
 * `run` was added for the Run History screen (`screens/run-history/`) — one
 * completed execution: a Deploy Console command or a SQL Runner query, with
 * the output it printed and what it changed. It is not a `script` (a script
 * is the reusable text; a run is one firing of it, and most runs never came
 * from a saved script at all) and not a `migration` (a migration file is a
 * thing on disk that may have run many times). Note the deliberate near-miss
 * with `CommandKind`'s `"run"`, which is a palette *action* badge — the two
 * unions are separate and neither is keyed by the other.
 *
 * `delivery` and `fulfillmentType` were added for the Fulfillment screen
 * (`screens/fulfillment/`). A `delivery` is one `fulfillment_queue` row — a
 * sold offer/SOW/bundle that has to actually be handed to a client, tracked
 * separately from the sale itself. It is not `service` (the catalog entry
 * sold) and not `customer` (who bought it) — it is the delivery obligation
 * that sits between the two. `fulfillmentType` is a `fulfillment_types`
 * registry row — a lifecycle *kind* a service can declare (`assessment`,
 * `retainer`, …), each wired to a `fulfillment.<key>` workflow trigger. It
 * is not a `delivery` (a delivery is one obligation; a type is the category
 * of obligation) and not a `workflow` (the workflow is what a type's event
 * fires, not the type itself).
 *
 * `campaign` was added for the Marketing screen (`screens/marketing/`). A
 * campaign is a `campaigns` row — openable, with a stable id, a name the tab
 * strip and Back group need to resolve. It is not a `service` (the catalog
 * entry a campaign might promote) and not a `lead` (a person a campaign may
 * have generated) — it is the effort that generated them.
 *
 * `share` was added for the Shared Links screen (`screens/shared-links/`).
 * A `quick_win_result_shares` row is a client-facing, token-based link to a
 * diagnostic scores snapshot or a generated document — openable, with a
 * stable id. It is not a `document` (the thing a share may point at, when
 * `shareKind === "document"`) and not a `customer`/`lead` (who it's shared
 * with) — it is the link itself, with its own view count and expiry.
 *
 * `workflowRun` was added for the Workflow Builder screen (`screens/
 * workflows/`) — one `wf_runs` row: a single firing of a workflow
 * definition's graph, with its status, trigger and per-node trace. The bare
 * `workflow` kind already in this list (a `wf_definitions` row, the graph
 * itself) cannot describe it — a definition is edited, a run is watched —
 * and it cannot reuse the Run History screen's existing `run` kind either:
 * that kind's id space is Deploy Console / SQL Runner executions
 * (`screens/run-history/`'s own store), a completely different table with no
 * relationship to `wf_runs.id`, so a numeric id collision would resolve to
 * the wrong record's peek.
 *
 * `trigger` was added for the Workflow Triggers screen (`screens/
 * workflow-triggers/`) — one `wf_triggers` row: the thing that *fires* a
 * workflow definition (manual, schedule, webhook or event), with its own
 * enable state, config and fire history. It is not `workflow` (the graph a
 * trigger fires, edited on its own screen) and not `workflowRun` (one
 * execution a trigger produced) — a trigger outlives any single run and can
 * exist with zero runs behind it, so neither kind can honestly stand in for
 * what editing or deleting *this* record means.
 * `issue` and `chatLink` were added for the Build Tracker screen (`screens/
 * build-tracker/`). A `bt_issues` row — an individual issue under an epic,
 * with a status, description and optional GitHub link — is openable, has a
 * stable numeric id, and needs a name the tab strip and Back group can
 * resolve. It is not `delivery` (a sold fulfilment obligation) and not
 * `workflow` (the automation that might fire on it) — it is the planning
 * unit itself. `chatLink` is a `bt_chats` row — a Claude conversation link
 * tied to an issue, epic, or free-form category. It is not `document` (a
 * generated artefact) and not `lead` (a sales contact) — it is the
 * conversation reference that keeps build context addressable.
 */
export const PEEK_KINDS = [
  "endpoint",
  "package",
  "lead",
  "script",
  "document",
  "tenant",
  "workflow",
  "prompt",
  "service",
  "customer",
  "mail",
  "msp",
  "user",
  "group",
  "ou",
  "signal",
  "alert",
  "exception",
  "incident",
  "dlq",
  "migration",
  "engine",
  "run",
  "delivery",
  "fulfillmentType",
  "campaign",
  "share",
  "workflowRun",
  "trigger",
  "issue",
  "chatLink",
  "epic",
] as const;
export type PeekKind = (typeof PEEK_KINDS)[number];

/**
 * One cell of the peek fact row.
 *
 * The row is **size-aware** and that is not cosmetic: short numeric values
 * render large and hug their width, prose values drop smaller and wrap to two
 * lines. Forcing one treatment clips. The shell decides which by measuring
 * `value` (see `isNumericFact`); `prose: true` overrides when a short value is
 * really prose.
 */
export interface PeekFact {
  label: string;
  value: string;
  prose?: boolean;
  /** Tints the value. Use for verdicts (fires / quiet / cannot read). */
  color?: string;
}

/**
 * An editable field. Writes go straight through to the record — no save step.
 *
 * Supplying `options` turns it into a cycle button that steps through them on
 * click, which is how the design handles small enums without a dropdown.
 */
export interface PeekEdit {
  key: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  /** Renders a cycle button instead of an input. */
  options?: string[];
  /** Renders a 74px textarea instead of an input. */
  area?: boolean;
  /** Monospace the value — paths, keys, JSON. */
  mono?: boolean;
}

/** A row in the peek's list section. Can drill to another peek. */
export interface PeekListRow {
  id: string;
  /** Left badge: a short uppercase state, e.g. "FIRES", "QUIET", "NO READ". */
  mark?: string;
  /** Tints the badge. */
  tone?: string;
  name: string;
  sub?: string;
  /** Right-aligned monospace value. */
  right?: string;
  /** Opening another peek from here replaces the current one and extends the trail. */
  onSelect?: () => void;
}

export interface PeekAction {
  label: string;
  onSelect: () => void;
  /** `primary` is the filled blue button; `danger` is the destructive outline. */
  tone?: "primary" | "danger";
  /**
   * Arms in place instead of firing: the first press relabels the button to
   * `${label} — press again` and only the second press calls `onSelect`.
   *
   * This is how Delete works, and there is deliberately no confirm dialog
   * behind it — the user explicitly does not want to be taken away from what
   * they were doing for a one-off. Set it on anything irreversible.
   */
  confirm?: boolean;
}

/**
 * What a peek renders. Every kind produces this same shape, which is what makes
 * ten different record types feel like one control.
 */
export interface PeekModel {
  kind: PeekKind;
  /** Uppercase eyebrow naming the type, e.g. "ENDPOINT". Defaults to `kind`. */
  eyebrow?: string;
  title: string;
  sub?: string;
  icon: LucideIcon;
  /**
   * The record's colour. Drives the hero gradient, the icon tile and the
   * eyebrow together, so one value tints the whole header. Defaults to the
   * informational accent.
   */
  tone?: string;
  /** Pill at the top right. */
  tag?: string;
  tagTone?: string;
  /**
   * A transient confirmation line under the hero ("Saved", "Queued for the next
   * Zoho sync"). Green. Clear it when it stops being true.
   */
  note?: string;
  facts?: PeekFact[];
  /** "Edit it here" — real fields, written through. */
  edits?: PeekEdit[];
  /** Code, prompt text, or mapped JSON. Rendered monospace. */
  body?: { title: string; content: string };
  /** Checks, rules, sections, deliverables. */
  list?: { title: string; rows: PeekListRow[] };
  /** "Open it properly" — the quiet underlined escape hatch, bottom left. */
  open?: () => void;
  openLabel?: string;
  /**
   * Footer buttons, left to right after the spacer. Convention from the design:
   * the primary sits before the destructive one, and Delete is last.
   */
  actions?: PeekAction[];
}

/** Resolves a record id of one kind into a peek. */
export type PeekResolver = (id: string) => PeekModel | null;

// ─── Command palette ──────────────────────────────────────────────────────────

/**
 * Palette row types, which map onto the four prefixes:
 *   `@` destination · `>` action · `#` record · `?` answer
 *
 * The prefixes exist because the user cannot always remember what a thing is
 * called; they let you browse a category without knowing any names.
 */
export type CommandType = "destination" | "action" | "record" | "answer";

export const COMMAND_PREFIX: Record<string, CommandType> = {
  "@": "destination",
  ">": "action",
  "#": "record",
  "?": "answer",
};

/**
 * Badge codes the palette draws in each row's left gutter. Keys of `KIND_BADGE`
 * in theme.ts — `endpoint` renders `API`, `package` renders `PKG`, and so on.
 *
 * The badge is not decoration: it is what lets you scan 143 rows by shape
 * before reading a single name.
 */
export type CommandKind =
  | "run"
  | "answer"
  | "mail"
  | "go"
  | "tenant"
  | "endpoint"
  | "service"
  | "document"
  | "script"
  | "package"
  | "lead"
  | "workflow"
  | "workflowRun"
  | "prompt"
  | "customer"
  | "msp"
  | "user"
  | "group"
  | "signal"
  | "alert"
  | "exception"
  | "incident"
  | "dlq"
  | "engine"
  | "delivery"
  | "fulfillmentType"
  | "campaign"
  | "share"
  | "trigger"
  | "issue"
  | "chatLink";

export interface CommandItem {
  id: string;
  type: CommandType;
  /** Drives the left badge. Defaults from `type` when omitted. */
  kind?: CommandKind;
  /** What the user types toward. Matched by cmdScore. */
  name: string;
  /** Second line under the name: the parent, the path, what it does. */
  sub?: string;
  /** Small uppercase pill beside the name. */
  tag?: string;
  /**
   * Band this row sorts under. Defaults from `type` — "Go to", "Do",
   * "Answers", or the record's kind.
   */
  group?: string;
  /**
   * Area this belongs to, matched against the area you are currently in for a
   * +60 boost. Use the owning screen's `area`.
   */
  area?: string;
  /**
   * A live number, rendered large and monospace on the right. This is what
   * makes `?` rows answers rather than links — the number is the point, and
   * selecting the row is optional.
   */
  live?: string;
  run: () => void;
}

/** A screen's palette contribution. Rebuilt on every open, so it can be live. */
export type CommandSource = () => CommandItem[];

// ─── Panels ───────────────────────────────────────────────────────────────────

/**
 * Content for one of the three docked panels. A screen supplies the body; the
 * shell owns the header, the collapse rail, the splitter and the persisted size.
 */
export interface PanelSpec {
  /** Overrides the default caption ("Explorer" / "Properties"). */
  title?: string;
  render: () => ReactNode;
}

export interface BottomPanelTab {
  id: string;
  label: string;
  /** Only set where the number means you must act. */
  count?: number;
  render: () => ReactNode;
}

// ─── Screens ──────────────────────────────────────────────────────────────────

export interface ScreenRenderContext {
  /** The record id this screen was opened on, if any. */
  recordId?: string;
  /**
   * The record's peek kind, alongside `recordId`. Undefined for a plain
   * screen doc (no record open) — mirrors `OpenDoc.kind` excluding
   * `"screen"`. Needed by any screen that owns more than one record kind
   * (e.g. Active Directory: msp/customer/user/group/ou all render through
   * the one "ad" screen) — `recordId` alone cannot disambiguate an MSP id 5
   * from a customer id 5.
   */
  kind?: PeekKind;
}

export interface ScreenModule {
  /** Stable id, kebab-case. Used in routes and as the trail key. */
  id: string;
  /** Human name. This is what the Back group's large button says. */
  title: string;
  /**
   * Coarse grouping used for the palette's +60 same-area boost, e.g.
   * "endpoints", "money", "content". Screens that belong together share one.
   */
  area: string;
  icon: LucideIcon;
  /** Path under /adminv2, e.g. "/endpoints". */
  route: string;
  render: (ctx: ScreenRenderContext) => ReactNode;

  /** Groups this screen adds to the fixed tabs. Audited against the intent rule. */
  ribbon?: RibbonContribution[];
  /** The contextual tab, and when it is live. */
  contextualTab?: ContextualTabSpec | ((ctx: ScreenRenderContext) => ContextualTabSpec | null);
  /** Peek resolvers this screen owns, by kind. */
  peeks?: Partial<Record<PeekKind, PeekResolver>>;
  /** Palette entries. Called on every palette open. */
  commands?: CommandSource;

  left?: PanelSpec;
  right?: PanelSpec;
  bottom?: BottomPanelTab[];

  /**
   * True for a screen that only works against a local dev checkout — raw git
   * commands, a filesystem-backed deploy console, GitHub-token-gated sync —
   * and is genuinely broken in the deployed production tenant, not just
   * hidden for tidiness. `registerScreen()` skips registering it entirely
   * outside `import.meta.env.DEV`, so it contributes no route, no ribbon
   * group, no palette entry, no peek — nothing for a production session to
   * ever reach. Do not use this for a screen that still works in production
   * (e.g. one that just runs against real tenant data); it belongs on a
   * normal tab in that case.
   */
  devOnly?: boolean;
}
