// The real MCP tool surface.
//
// Contract pack Section 10 draws the architectural line this file sits on: the AI step happens
// in a Claude conversation, and the hosted app stores/displays/shares what Claude produced. So
// every tool here is a real database operation -- there is no tool that asks the server to think.
//
// Nothing in this surface knows what a shopping list is. Claude passes a category slug, display
// metadata for it, and an open `data` object; the server records it. That is what makes "mom is
// coming to visit the 12th-18th" work without a developer shipping a Visits feature first.

import { record } from "../core/audit.mjs";
import * as captures from "../core/captures.mjs";
import * as categories from "../core/categories.mjs";
import * as entities from "../core/entities.mjs";
import * as lists from "../core/lists.mjs";
import * as prices from "../core/prices.mjs";
import * as shares from "../core/shares.mjs";
import * as storeAisles from "../core/store-aisles.mjs";

const CATEGORY_META_PROPS = {
  categoryLabel: { type: "string", description: "Human label for the category, e.g. 'Vet visit'. Only used the first time this category slug is seen." },
  categoryIcon: { type: "string", description: "lucide-react icon name for the category, e.g. 'stethoscope'. First-use only." },
  categoryColor: { type: "string", description: "Colour hint for the category: slate, sky, amber, rose, violet, emerald. First-use only." },
  categoryItemNoun: { type: "string", description: "What one child row is called, e.g. 'item', 'dose', 'question'. First-use only." },
  categoryDescription: { type: "string", description: "One line on what belongs in this category. First-use only." },
};

function categoryMeta(args) {
  return {
    label: args.categoryLabel,
    icon: args.categoryIcon,
    color: args.categoryColor,
    itemNoun: args.categoryItemNoun,
    description: args.categoryDescription,
  };
}

const ITEMS_SCHEMA = {
  type: "array",
  description: "Child rows. Each entry is either a plain string or an object.",
  items: {
    oneOf: [
      { type: "string" },
      {
        type: "object",
        properties: {
          text: { type: "string" },
          note: { type: "string" },
          checked: { type: "boolean" },
          data: { type: "object", description: "Anything else worth keeping, e.g. quantity, store, aisle, price." },
        },
        required: ["text"],
      },
    ],
  },
};

/** @type {Array<{name:string,title:string,description:string,inputSchema:object,handler:Function}>} */
export const TOOLS = [
  {
    name: "whoami",
    title: "Who am I connected as",
    description:
      "Confirm which Shane's Life account this MCP connection is writing to, and how much is in it. Call this first if anything looks wrong.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      const pending = await captures.pendingCount(ctx.user.id);
      const cats = await categories.listCategories();
      return {
        account: { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name },
        connectionLabel: ctx.label,
        pendingCaptures: pending,
        categories: cats.length,
      };
    },
  },

  {
    name: "capture",
    title: "Capture something",
    description:
      "Drop a raw thought into the universal capture inbox exactly as it was said, without classifying it. Use this when Shane says something in passing and you are not being asked to file it yet. To file something properly, use create_entity instead.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "The raw text, in Shane's own words." } },
      required: ["text"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = await captures.createCapture({
        userId: ctx.user.id,
        kind: "text",
        bodyText: args.text,
        source: "mcp",
      });
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "capture.create", detail: { captureId: row.id } });
      return row;
    },
  },

  {
    name: "list_captures",
    title: "Read the capture inbox",
    description:
      "List captures. Default is everything still pending classification -- read these, then call create_entity with the matching captureId to file one.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "classified", "dismissed", "all"], default: "pending" },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      return captures.listCaptures(ctx.user.id, { status: args.status || "pending", limit: args.limit || 50 });
    },
  },

  {
    name: "dismiss_capture",
    title: "Dismiss a capture",
    description: "Mark a pending capture as handled without turning it into anything. Nothing is deleted.",
    inputSchema: {
      type: "object",
      properties: { captureId: { type: "string", description: "uuid of the capture" } },
      required: ["captureId"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = await captures.dismissCapture(ctx.user.id, args.captureId);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "capture.dismiss", detail: { captureId: args.captureId } });
      return row;
    },
  },

  {
    name: "create_entity",
    title: "File something into Shane's Life",
    description:
      "Create a real record of any kind. `category` is an OPEN slug -- invent a sensible new one (with categoryLabel/categoryIcon) whenever nothing existing fits, rather than forcing a bad match. A shopping list, an appointment, a birthday, a house guest visiting for a week, a movie to watch: all the same call, differing only in category, the optional items array, and whatever you put in `data`.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "snake_case slug, e.g. shopping_list, appointment, birthday, visit, movie. Invent one if nothing fits -- call list_categories first to check." },
        title: { type: "string", description: "What Shane will read at a glance." },
        body: { type: "string", description: "Longer detail, if there is any." },
        status: { type: "string", description: "open (default) or done." },
        occursAt: { type: "string", description: "ISO 8601 timestamp of when the thing actually happens." },
        remindAt: { type: "string", description: "ISO 8601 timestamp of when it should surface. This is where lead time lives: a birthday wants days of it, an appointment wants the day before." },
        data: { type: "object", description: "Anything structured that has nowhere else to go: provider, store, person, amount, recurrence. Kept verbatim." },
        items: ITEMS_SCHEMA,
        captureId: { type: "string", description: "uuid of the capture this came from, if it came from the inbox. Marks that capture classified." },
        share: {
          type: "object",
          description: "Create a no-login share link for this in the same call. Handy for a shopping list meant to go straight to someone's phone.",
          properties: {
            label: { type: "string" },
            canCheck: { type: "boolean", default: true },
            expiresInDays: { type: "number" },
          },
          additionalProperties: false,
        },
        ...CATEGORY_META_PROPS,
      },
      required: ["category", "title"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const entity = await entities.createEntity({
        userId: ctx.user.id,
        category: args.category,
        categoryMeta: categoryMeta(args),
        title: args.title,
        body: args.body ?? null,
        status: args.status || "open",
        occursAt: args.occursAt ?? null,
        remindAt: args.remindAt ?? null,
        data: args.data || {},
        items: args.items || [],
        captureId: args.captureId ?? null,
        source: "mcp",
        createdBy: "claude",
      });
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "entity.create",
        entityId: entity.id,
        detail: { category: entity.category, itemCount: entity.items.length },
      });

      let share = null;
      if (args.share) {
        share = await shares.createShareLink({
          userId: ctx.user.id,
          entityId: entity.id,
          label: args.share.label ?? null,
          canCheck: args.share.canCheck !== false,
          expiresInDays: args.share.expiresInDays ?? null,
        });
        await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "share.create", entityId: entity.id, detail: { shareId: share.id } });
      }
      return { entity, share };
    },
  },

  {
    name: "list_entities",
    title: "List what is already filed",
    description: "Search or browse existing records. Call this before creating something, so a second grocery list does not appear next to the first.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        status: { type: "string" },
        search: { type: "string", description: "Case-insensitive substring of the title or body." },
        includeArchived: { type: "boolean", default: false },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      return entities.listEntities(ctx.user.id, {
        category: args.category ?? null,
        status: args.status ?? null,
        search: args.search ?? null,
        includeArchived: Boolean(args.includeArchived),
        limit: args.limit || 50,
      });
    },
  },

  {
    name: "get_entity",
    title: "Read one record in full",
    description: "Everything about one record: its open data payload, every child item, and every share link on it.",
    inputSchema: {
      type: "object",
      properties: { entityId: { type: "string" } },
      required: ["entityId"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const entity = await entities.getEntity(ctx.user.id, args.entityId);
      if (!entity) throw new Error(`No entity ${args.entityId}`);
      return entity;
    },
  },

  {
    name: "update_entity",
    title: "Change a record",
    description: "Patch a record. Only the fields you pass change. `data` merges at the top level rather than replacing, so adding one key never wipes the rest.",
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        status: { type: "string" },
        category: { type: "string" },
        occursAt: { type: "string" },
        remindAt: { type: "string" },
        data: { type: "object" },
        archived: { type: "boolean" },
        ...CATEGORY_META_PROPS,
      },
      required: ["entityId"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const { entityId, ...patch } = args;
      patch.categoryMeta = categoryMeta(args);
      const entity = await entities.updateEntity(ctx.user.id, entityId, patch, { createdBy: "claude" });
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "entity.update", entityId, detail: { fields: Object.keys(patch) } });
      return entity;
    },
  },

  {
    name: "add_items",
    title: "Add rows to a record",
    description: "Append child rows to an existing record -- more groceries onto the open list, more questions onto an appointment.",
    inputSchema: {
      type: "object",
      properties: { entityId: { type: "string" }, items: ITEMS_SCHEMA },
      required: ["entityId", "items"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const entity = await entities.addItems(ctx.user.id, args.entityId, args.items);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "entity.items.add", entityId: args.entityId, detail: { added: args.items.length } });
      return entity;
    },
  },

  {
    name: "check_item",
    title: "Tick or untick a row",
    description: "Mark one child row done or not done.",
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string" },
        itemId: { type: "string" },
        checked: { type: "boolean", default: true },
      },
      required: ["entityId", "itemId"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const owned = await entities.getEntity(ctx.user.id, args.entityId);
      if (!owned) throw new Error(`No entity ${args.entityId}`);
      const item = await entities.setItemChecked(
        args.entityId,
        args.itemId,
        args.checked !== false,
        "owner",
      );
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "entity.item.check", entityId: args.entityId, detail: { itemId: args.itemId, checked: args.checked !== false } });
      return item;
    },
  },

  {
    name: "push_list",
    title: "Push a generated list",
    description:
      "Push a real, ready-to-use list straight into the app -- the Shopping room's real capture-grammar entry point ('grocery words' -> the run). Omit name/category (or pass category 'shopping') to push into Shane's one real running Shopping list; pass a different category to start a different room's list once one exists. Call get_list first to see what is already there. Set replace true for a fresh run that swaps out the old contents; leave it false to add onto what is already there. Pass `store` to set which real store this run is being shopped at -- that is what Best-path ordering and aisle memory (get_store_map, record_aisle) key off.",
    inputSchema: {
      type: "object",
      properties: {
        items: ITEMS_SCHEMA,
        name: { type: "string", description: "List name. Defaults to 'Shopping'." },
        category: { type: "string", description: "Category slug. Defaults to 'shopping', which always resolves to the one real running Shopping list regardless of name." },
        replace: { type: "boolean", default: false, description: "True clears the list first -- a fresh run, not an addition to the old one." },
        store: { type: "string", description: "Real store this run is being shopped at, e.g. 'Aldi'. Sets/updates the list's store." },
        share: {
          type: "object",
          description: "Create a no-login share link for this list in the same call. Handy for handing the run straight to someone's phone.",
          properties: {
            label: { type: "string" },
            canCheck: { type: "boolean", default: true },
            expiresInDays: { type: "number" },
          },
          additionalProperties: false,
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      let target =
        args.category && args.category !== "shopping"
          ? await lists.getOrCreateListByName(ctx.user.id, { name: args.name || "List", category: args.category })
          : await lists.getOrCreateShoppingList(ctx.user.id);

      if (args.store) target = await lists.setListStore(ctx.user.id, target.id, args.store);

      const detail = args.replace
        ? await lists.replaceListItems(ctx.user.id, target.id, args.items)
        : await lists.addListItems(ctx.user.id, target.id, args.items);

      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "list.items.push",
        entityId: target.id,
        detail: { count: args.items.length, replace: Boolean(args.replace) },
      });

      let share = null;
      if (args.share) {
        share = await shares.createShareLink({
          userId: ctx.user.id,
          listId: target.id,
          label: args.share.label ?? null,
          canCheck: args.share.canCheck !== false,
          expiresInDays: args.share.expiresInDays ?? null,
        });
        await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "share.create", entityId: target.id, detail: { shareId: share.id, kind: "list" } });
      }
      return { list: detail, share };
    },
  },

  {
    name: "get_list",
    title: "Read a list",
    description:
      "Read a real list and its items -- call this before push_list to see what is already on the run, so a duplicate list never appears next to it. Omit listId for Shane's one real running Shopping list.",
    inputSchema: {
      type: "object",
      properties: { listId: { type: "string" } },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const target = args.listId
        ? await lists.getOwnedList(ctx.user.id, args.listId)
        : await lists.getOrCreateShoppingList(ctx.user.id);
      if (!target) throw new Error(`No list ${args.listId}`);
      return lists.getListDetail(ctx.user.id, target.id);
    },
  },

  {
    name: "check_list_item",
    title: "Tick or untick a list row",
    description: "Mark one row on a list done or not done.",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "string" },
        itemId: { type: "string" },
        checked: { type: "boolean", default: true },
      },
      required: ["listId", "itemId"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const owned = await lists.getOwnedList(ctx.user.id, args.listId);
      if (!owned) throw new Error(`No list ${args.listId}`);
      const item = await lists.setListItemChecked(args.listId, args.itemId, args.checked !== false);
      if (!item) throw new Error(`No item ${args.itemId}`);
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "list.item.check",
        entityId: args.listId,
        detail: { itemId: args.itemId, checked: args.checked !== false },
      });
      return item;
    },
  },

  {
    name: "record_aisle",
    title: "Save a real aisle spot",
    description:
      "Save where something really is at a real store -- the capture grammar's aisle-memory chunk ('pasta aisle 12 end cap'). Builds a real, growing per-store map: a later report of the same item at the same store corrects the spot rather than duplicating it. Pass listId and itemId to also stamp the run's own row with the spot immediately; omit them to just grow the store map (e.g. recording several spots from an old receipt with nothing currently on the list).",
    inputSchema: {
      type: "object",
      properties: {
        store: { type: "string", description: "Real store name, e.g. 'Aldi'." },
        item: { type: "string", description: "The item, as said -- e.g. 'pasta'." },
        aisle: { type: "integer", minimum: 0, description: "Aisle number." },
        note: { type: "string", description: "Shelf detail, e.g. 'end cap', 'halfway down, left side, second row'." },
        listId: { type: "string", description: "If given with itemId, also writes 'Aisle N · note' onto that row's own note." },
        itemId: { type: "string" },
      },
      required: ["store", "item", "aisle"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const spot = await storeAisles.recordAisle(ctx.user.id, args.store, args.item, args.aisle, args.note ?? null);
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "store_aisle.record",
        detail: { store: spot.store, item: spot.item_text, aisle: spot.aisle, hits: spot.hits },
      });
      let item = null;
      if (args.listId && args.itemId) {
        const owned = await lists.getOwnedList(ctx.user.id, args.listId);
        if (!owned) throw new Error(`No list ${args.listId}`);
        const noteLine = `Aisle ${spot.aisle}${spot.note ? ` · ${spot.note}` : ""}`;
        item = await lists.setListItemNote(args.listId, args.itemId, noteLine);
      }
      return { spot, item };
    },
  },

  {
    name: "get_store_map",
    title: "Read the real aisle map for a store",
    description:
      "Read the real, accumulated aisle memory for one store -- check this before asking Shane where something is, and use it to order a generated list into real walking order before pushing it.",
    inputSchema: {
      type: "object",
      properties: { store: { type: "string" } },
      required: ["store"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      return { store: args.store, items: await storeAisles.getStoreMap(ctx.user.id, args.store) };
    },
  },

  {
    name: "create_share_link",
    title: "Make a no-login link",
    description:
      "Mint a link that opens one real record with no login at all -- the thing to hand to someone at the store. Pass entityId for a generic captured record, or listId for a room's own typed list -- Shopping's real running list, for one. Exactly one of the two is required. Set canCheck false for read-only. The URL is shown once and cannot be recovered afterwards; mint a new one instead.",
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string" },
        listId: { type: "string" },
        label: { type: "string", description: "Who or what this link is for, e.g. 'Ronnie'. Shows up next to whatever gets ticked off." },
        canCheck: { type: "boolean", default: true },
        expiresInDays: { type: "number", description: "Omit for a link that does not expire." },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const share = await shares.createShareLink({
        userId: ctx.user.id,
        entityId: args.entityId ?? null,
        listId: args.listId ?? null,
        label: args.label ?? null,
        canCheck: args.canCheck !== false,
        expiresInDays: args.expiresInDays ?? null,
      });
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "share.create",
        entityId: args.entityId ?? args.listId ?? null,
        detail: { shareId: share.id, kind: args.listId ? "list" : "entity" },
      });
      return share;
    },
  },

  {
    name: "get_prices",
    title: "Read an item's real price history",
    description:
      "The real per-store price history for one item -- every store, every date it was ever priced (Git #3112). Call this while generating a shopping list so it carries real numbers instead of estimates, e.g. 'spaghetti sauce, last seen $1.79 at Aldi Sep 6'. Matches on the same normalised (lower/trim) item text `push_list` items use, so it works even when items were never scanned or barcode-linked.",
    inputSchema: {
      type: "object",
      properties: {
        item: { type: "string", description: "The item's text, e.g. 'spaghetti sauce'." },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
      },
      required: ["item"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      return { item: args.item, history: await prices.getPriceHistory(ctx.user.id, args.item, { limit: args.limit || 100 }) };
    },
  },

  {
    name: "list_categories",
    title: "List known categories",
    description:
      "Every category slug that exists so far, with how often each is used. Check here before inventing a new one -- but do invent one when nothing genuinely fits.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler() {
      return categories.listCategories();
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function toolManifest() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}
