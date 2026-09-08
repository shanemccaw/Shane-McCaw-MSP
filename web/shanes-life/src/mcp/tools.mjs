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
import * as dates from "../core/dates.mjs";
import * as entities from "../core/entities.mjs";
import * as federalHolidays from "../core/federal-holidays.mjs";
import * as foodPreferences from "../core/food-preferences.mjs";
import * as lists from "../core/lists.mjs";
import * as mealPlan from "../core/meal-plan.mjs";
import * as medications from "../core/medications.mjs";
import * as money from "../core/money.mjs";
import * as pets from "../core/pets.mjs";
import * as prices from "../core/prices.mjs";
import * as recipes from "../core/recipes.mjs";
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
      "Push a real, ready-to-use list straight into the app -- the Shopping room's real capture-grammar entry point ('grocery words' -> the run). Omit name/category (or pass category 'shopping') to push into Shane's one real running Shopping list; pass a different category to start a different room's list once one exists. Call get_list first to see what is already there. Set replace true for a fresh run that swaps out the old contents; leave it false to add onto what is already there. Pass `store` to set which real store this run is being shopped at -- that is what Best-path ordering and aisle memory (get_store_map, record_aisle) key off. Pass `budget` to set the real stated budget for this run in the same call -- e.g. \"a $45 grocery run\" -- or call set_list_budget separately.",
    inputSchema: {
      type: "object",
      properties: {
        items: ITEMS_SCHEMA,
        name: { type: "string", description: "List name. Defaults to 'Shopping'." },
        category: { type: "string", description: "Category slug. Defaults to 'shopping', which always resolves to the one real running Shopping list regardless of name." },
        replace: { type: "boolean", default: false, description: "True clears the list first -- a fresh run, not an addition to the old one." },
        store: { type: "string", description: "Real store this run is being shopped at, e.g. 'Aldi'. Sets/updates the list's store." },
        budget: { type: "number", description: "Dollars, e.g. 45. Sets the real stated budget for this run (#3111). Omit to leave the existing budget unchanged; pass null explicitly to clear it." },
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

      let detail = args.replace
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

      if (args.budget !== undefined) {
        const budgetCents = args.budget === null ? null : Math.round(Number(args.budget) * 100);
        detail = await lists.setListBudget(ctx.user.id, target.id, budgetCents);
        await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "list.budget.set", entityId: target.id, detail: { budgetCents } });
      }

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
    name: "set_list_budget",
    title: "Set a list's real stated budget",
    description:
      "Set (or clear, with null) the real stated budget for a run -- #3111. Informational only: the app never blocks an add, it just shows the real running total against this and offers a put-it-back prompt once over. Omit listId for Shane's one real running Shopping list.",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "string" },
        budget: { type: "number", description: "Dollars, e.g. 45. Pass null to clear the budget." },
      },
      required: ["budget"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const target = args.listId
        ? await lists.getOwnedList(ctx.user.id, args.listId)
        : await lists.getOrCreateShoppingList(ctx.user.id);
      if (!target) throw new Error(`No list ${args.listId}`);
      const budgetCents = args.budget === null ? null : Math.round(Number(args.budget) * 100);
      const detail = await lists.setListBudget(ctx.user.id, target.id, budgetCents);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "list.budget.set", entityId: target.id, detail: { budgetCents } });
      return detail;
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
    name: "push_deals",
    title: "Push weekly-ad prices",
    description:
      "Store real per-store prices you just read off a weekly ad flyer (Git #3110), so Shopping can show a real cross-store verdict on matching list items -- 'Walmart $2.99', cheapest store wins. Lands in the same real price history get_prices reads, tagged as this week's ad rather than a one-off observation. Call get_prices first to check what's already on file for an item before re-pushing the same flyer twice.",
    inputSchema: {
      type: "object",
      properties: {
        store: { type: "string", description: "Store name, e.g. 'Walmart', 'Kroger'." },
        items: {
          type: "array",
          description: "One entry per priced item on the flyer.",
          items: {
            type: "object",
            properties: {
              item: { type: "string", description: "The grocery item, in plain words, e.g. 'whole milk'." },
              priceCents: { type: "integer", description: "Price in cents, e.g. 299 for $2.99." },
              unit: { type: "string", description: "'each', 'lb', '12oz', etc. -- whatever the flyer prints." },
              validOn: { type: "string", description: "ISO date this price is good on, if the flyer states one. Defaults to today." },
            },
            required: ["item", "priceCents"],
          },
        },
      },
      required: ["store", "items"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const rows = await prices.pushDeals(ctx.user.id, args);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "prices.deals.push", detail: { store: args.store, count: rows.length } });
      return { pushed: rows.length, prices: rows };
    },
  },

  {
    name: "push_coupons",
    title: "Push coupons and multi-buy deals",
    description:
      "Store real coupons, multi-buy counts ('2 for $5') and discounts you just read off a weekly ad flyer or a coupon (Git #3110), so Shopping can surface them on matching list items.",
    inputSchema: {
      type: "object",
      properties: {
        store: { type: "string", description: "Store this coupon is good at, if it is store-specific. Omit for a manufacturer coupon." },
        items: {
          type: "array",
          description: "One entry per item the coupon/multi-buy applies to.",
          items: {
            type: "object",
            properties: {
              item: { type: "string", description: "The grocery item, in plain words." },
              description: { type: "string", description: "The coupon in plain words, e.g. 'Buy 2 Get 1 Free', '$1 off any'." },
              multiBuyCount: { type: "integer", description: "The N in '2 for $5', if this is a multi-buy deal." },
              multiBuyPriceCents: { type: "integer", description: "The total price in cents for multiBuyCount of them, e.g. 500 for '2 for $5'." },
              discountCents: { type: "integer", description: "A flat cents-off discount, if this isn't a multi-buy." },
              validFrom: { type: "string", description: "ISO date the coupon starts, if stated." },
              validTo: { type: "string", description: "ISO date the coupon expires, if stated." },
            },
            required: ["item", "description"],
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const rows = await prices.pushCoupons(ctx.user.id, args);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "prices.coupons.push", detail: { store: args.store ?? null, count: rows.length } });
      return { pushed: rows.length, coupons: rows };
    },
  },

  {
    name: "fetch_weekly_ad",
    title: "Read one store's whole weekly ad",
    description:
      "Everything currently on file for one store (Git #3110) -- every weekly-ad price and coupon pushed for it in roughly the last week -- so you can check what's already known before reading a fresh flyer for that store.",
    inputSchema: {
      type: "object",
      properties: {
        store: { type: "string" },
        zip: { type: "string", description: "Optional, for future per-zip ad variance. Not yet a real filter." },
      },
      required: ["store"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      return prices.fetchWeeklyAd(ctx.user.id, args);
    },
  },

  // -- recipes (Git #3124, blocked_by #3088) -------------------------------
  //
  // Section 5's real division of labor: Claude generates recipes in a real conversation and
  // pushes them in; the app stores, matches against the real Shopping run, and lets Shane add
  // what's missing. Read get_health_context before calling push_recipes -- Section 5's real
  // heart-healthy context is stated once and never re-asked (Section 8).

  {
    name: "get_health_context",
    title: "Read Shane's real stated health context",
    description:
      "The real health context Shane has already disclosed (e.g. a cardiac condition), stated once and never re-asked (Section 8). Read this before push_recipes so heart-healthy choices are favored where it applies -- the app does no AI judgement of its own, so factoring it in is your call, not a filter the server applies.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      return { healthContext: await recipes.getHealthContext(ctx.user.id) };
    },
  },

  {
    name: "set_health_context",
    title: "Save Shane's real stated health context",
    description:
      "Save (or replace) the real health context in Shane's own words, e.g. 'stage 2 heart disease, hypertension -- favor heart-healthy meals.' Pass null to clear it. This replaces whatever was there, matching how Shane would actually correct or extend a stated fact rather than accumulate duplicates.",
    inputSchema: {
      type: "object",
      properties: { healthContext: { type: ["string", "null"] } },
      required: ["healthContext"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const value = await recipes.setHealthContext(ctx.user.id, args.healthContext);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "health_context.set" });
      return { healthContext: value };
    },
  },

  {
    name: "get_recipes",
    title: "Read the real recipe list",
    description:
      "Every saved recipe, each with a real can-make status matched against what's currently on Shane's one real Shopping run -- call this before push_recipes to see what's already saved, and to answer 'what can I make tonight' directly.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      return { recipes: await recipes.listRecipesWithMatch(ctx.user.id) };
    },
  },

  {
    name: "push_recipes",
    title: "Push generated recipes",
    description:
      "Push one or more real, ready-to-use recipes into the app -- the Recipes room's real generation entry point (Section 5: recipes are Claude-generated and pushed in via MCP, not authored in-app). Call get_health_context first so heart-healthy choices are favored where it genuinely applies, and set heartHealthy true on the recipes where it does. Set cookMinutes on any recipe genuinely meant to be one dish of a Tonight synchronized multi-dish meal (Git #3126) -- it's the one real number Tonight's start-offset math needs, and a recipe with no cookMinutes cannot be picked as a Tonight dish. Set replace true to swap out every previously saved recipe for this fresh set; leave false to add onto what's already saved.",
    inputSchema: {
      type: "object",
      properties: {
        recipes: {
          type: "array",
          description: "One or more recipes.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              time: { type: "string", description: "e.g. '35 min · serves 4, leftovers for the Rental'." },
              needs: { type: "array", items: { type: "string" }, description: "Real ingredient list, matched against the Shopping run's item text." },
              steps: {
                type: "array",
                description:
                  "Real steps, in order, driving Cook mode (Git #3125): a bare string, or `{text, ings}` where `ings` is that step's own real ingredients (e.g. 'Alfredo sauce, 1 jar') -- Shane checks those off while cooking that step, but an unchecked one never blocks moving to the next step. Prefer the object form when a step genuinely uses specific ingredients.",
                items: {
                  oneOf: [
                    { type: "string" },
                    {
                      type: "object",
                      properties: {
                        text: { type: "string" },
                        ings: { type: "array", items: { type: "string" } },
                      },
                      required: ["text"],
                    },
                  ],
                },
              },
              heartHealthy: { type: "boolean", default: false, description: "True if this recipe genuinely fits Shane's real stated health context (get_health_context)." },
              cookMinutes: {
                type: ["integer", "null"],
                description:
                  "This dish's own real total cook time, in whole minutes (e.g. 40 for the prototype's own sheet-pan chicken thighs) -- ONLY set this for a recipe genuinely meant to be one dish of a Tonight synchronized multi-dish meal (Git #3126). Omit or pass null for an ordinary standalone recipe; a recipe with no cookMinutes just cannot be picked as a Tonight dish.",
              },
            },
            required: ["name"],
          },
        },
        replace: { type: "boolean", default: false, description: "True archives every previously saved recipe first -- a fresh set, not an addition to the old one." },
      },
      required: ["recipes"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const created = await recipes.pushRecipes(ctx.user.id, args.recipes, { replace: Boolean(args.replace) });
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "recipes.push",
        detail: { count: created.length, replace: Boolean(args.replace) },
      });
      return { recipes: created };
    },
  },

  {
    name: "add_missing_ingredients",
    title: "Add a recipe's missing ingredients to Shopping",
    description:
      "The real gap between one recipe's needs and what's currently on the Shopping run, pushed straight onto that run -- the same MCP/UI entry point as get_recipes' own `missing` field, but as a write.",
    inputSchema: {
      type: "object",
      properties: { recipeId: { type: "string" } },
      required: ["recipeId"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const result = await recipes.addMissingIngredients(ctx.user.id, args.recipeId);
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "recipe.add_missing",
        entityId: args.recipeId,
        detail: { added: result.added },
      });
      return result;
    },
  },

  // -- meal plan / Sunday ritual (Git #3127, blocked_by #3124 and #3132) ---
  //
  // Section 5's real Sunday ritual: build the week's plan once, let it surface on Today as
  // simple moment-based nudges -- never a calendar to browse. Read get_health_context and
  // get_food_preferences before push_meal_plan, same as push_recipes -- a meal plan is exactly
  // the kind of real food generation Section 5/#3132 both say those must gate.

  {
    name: "get_meal_plan",
    title: "Read the real meal plan",
    description:
      "The real, currently-planned meals, each with a real display dish name (Claude's own dishText, or the linked saved recipe's name). Pass from/to (YYYY-MM-DD) to window it, e.g. to read back the week just pushed; omit both for everything not yet archived.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "YYYY-MM-DD, inclusive." },
        to: { type: "string", description: "YYYY-MM-DD, inclusive." },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      return { entries: await mealPlan.listMealPlan(ctx.user.id, { from: args.from ?? null, to: args.to ?? null }) };
    },
  },

  {
    name: "push_meal_plan",
    title: "Push the real Sunday meal plan",
    description:
      "Push the week's real meal plan -- the Sunday ritual's real entry point (Section 5: 'Sundays, Shane works with Claude to build the week's real recipe list and meal plan ... surfaces on the Today view as simple, real, moment-based nudges'). Call get_health_context and get_food_preferences first -- allergies are a hard exclusion with no exceptions, dislikes a soft avoid. Each entry names a real date and meal slot, and either a recipeId (from get_recipes/push_recipes) or a plain dishText (or both -- dishText overrides the display name if given). Set replace true to clear out every not-yet-passed entry first, matching a fresh week replacing the old one; leave false to add onto what's already planned.",
    inputSchema: {
      type: "object",
      properties: {
        entries: {
          type: "array",
          description: "One or more real planned meals.",
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "YYYY-MM-DD." },
              mealType: { type: "string", enum: ["breakfast", "lunch", "dinner"], default: "dinner" },
              recipeId: { type: "string", description: "A real saved recipe's id (get_recipes/push_recipes), if this meal is one of them." },
              dishText: { type: "string", description: "The real dish name/description, e.g. 'leftovers' or 'grab a rotisserie chicken' -- required if recipeId is omitted." },
              notes: { type: "string" },
            },
            required: ["date"],
          },
        },
        replace: { type: "boolean", default: false, description: "True archives every not-yet-passed planned meal first -- a fresh week, not an addition to the old one." },
      },
      required: ["entries"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const entries = await mealPlan.pushMealPlan(ctx.user.id, args.entries, { replace: Boolean(args.replace) });
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "meal_plan.push",
        detail: { count: entries.length, replace: Boolean(args.replace) },
      });
      return { entries };
    },
  },

  {
    name: "get_food_preferences",
    title: "Read Shane's real food preferences",
    description:
      "Real stated dislikes (soft avoid) and allergies (hard exclusion, no exceptions) -- Git #3132. Call this BEFORE generating any shopping list or recipe/meal plan, every time, the same way you'd read the heart-health context -- skipping this step is what put a real allergen on a real list on 2026-09-07. Returns empty arrays if nothing has been stated yet, which is a real, valid state, not an error.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      return foodPreferences.getFoodPreferences(ctx.user.id);
    },
  },

  {
    name: "set_food_preferences",
    title: "Save a real dislike or allergy",
    description:
      "Save real food dislikes and/or allergies -- the capture-grammar entry point for 'I'm allergic to shellfish' or 'I don't like cilantro' said in passing, no separate settings form. Additive: passing dislikes adds to the existing list rather than replacing it, and leaving allergies unset leaves it completely untouched (and vice versa) -- same 'unset fields keep their current value' pattern as set_income_source. There is no remove/replace mode here on purpose -- this is a hard-safety list for allergies, not something a single ambiguous turn should be able to shrink. Real, deliberate distinction: allergies is a hard exclusion enforced with no exceptions everywhere food gets generated; dislikes is a soft avoid, fine to slip through occasionally with a real stated reason.",
    inputSchema: {
      type: "object",
      properties: {
        dislikes: { type: "array", items: { type: "string" }, description: "Foods to soft-avoid, e.g. ['cilantro']. Adds to the existing list." },
        allergies: { type: "array", items: { type: "string" }, description: "Foods to hard-exclude, no exceptions, e.g. ['shellfish']. Adds to the existing list." },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const prefs = await foodPreferences.setFoodPreferences(ctx.user.id, {
        dislikes: args.dislikes,
        allergies: args.allergies,
      });
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "food_preferences.set",
        detail: { dislikesAdded: args.dislikes ?? null, allergiesAdded: args.allergies ?? null },
      });
      return prefs;
    },
  },

  // Medications (Git #3135). Section 3's real dichotomy stays enforced here too --
  // refillTier is one of exactly 'auto'/'manual', never an open vocabulary.

  {
    name: "get_medications",
    title: "Read today's real meds state",
    description:
      "Today's real batches (each with its items and whether it's already been swiped complete today) and the refills split into 'needs you' (manual-watch) and 'handled automatically' (auto-refill). Call before mark_med_batch_taken to confirm which batch name to use, and before set_medication to see what already exists.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      return medications.getMedsToday(ctx.user.id);
    },
  },

  {
    name: "set_medication",
    title: "Create or update a real medication",
    description:
      "Create a new real medication record, or update an existing one by passing its id. batch is free text ('morning', 'evening', ...) -- the same batch groups a single swipe completes together, so a new medication in an existing batch just joins that batch's next swipe, no migration needed. refillTier is a real, locked dichotomy: 'auto' (no action ever needed from Shane) or 'manual' (surfaces under Refills > Needs you). supplyDays + nextRefillOn drive the real 'days left' countdown on a manual-watch item.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Omit to create a new medication; pass an existing id to update it." },
        name: { type: "string" },
        doseNote: { type: "string", description: "e.g. '1 tablet', '2 softgels'." },
        batch: { type: "string", description: "e.g. 'morning', 'evening'." },
        refillTier: { type: "string", enum: ["auto", "manual"] },
        supplyDays: { type: "number", description: "How many days one fill covers." },
        nextRefillOn: { type: "string", description: "ISO date -- manual: pharmacy due date; auto: next delivery date." },
        refillNote: { type: "string", description: "e.g. 'Pharmacy needs a call before Thursday.'" },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = args.id
        ? await medications.updateMedication(ctx.user.id, args.id, args)
        : await medications.createMedication(ctx.user.id, args);
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: args.id ? "medication.update" : "medication.create",
        entityId: row.id,
        detail: { name: row.name, batch: row.batch },
      });
      return row;
    },
  },

  {
    name: "mark_med_batch_taken",
    title: "Mark a real meds batch taken",
    description:
      "The real capture-grammar entry point for 'took my morning meds' / 'evening meds done' (README's own capture grammar, item 2). Marks the WHOLE named batch done for today in one real action -- same 'single swipe per batch, not per-pill' rule the web UI's slide-to-take uses. Idempotent: calling this twice for the same batch on the same day is a real no-op, not a duplicate record.",
    inputSchema: {
      type: "object",
      properties: { batch: { type: "string", description: "e.g. 'morning', 'evening' -- must match an existing medication's batch (see get_medications)." } },
      required: ["batch"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = await medications.markBatchTaken(ctx.user.id, args.batch, { source: "mcp" });
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "medication.batch_taken", detail: { batch: row.batch } });
      return row;
    },
  },

  {
    name: "mark_medication_ordered",
    title: "Mark a manual-watch medication as ordered",
    description:
      "The real 'Ordered it' action (design screen 6) said in conversation instead of tapped -- advances that medication's next real refill due date forward by its supplyDays (or 30 if unset), same as the web UI button.",
    inputSchema: {
      type: "object",
      properties: { medicationId: { type: "string" } },
      required: ["medicationId"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = await medications.markMedicationOrdered(ctx.user.id, args.medicationId);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "medication.ordered", entityId: args.medicationId, detail: { nextRefillOn: row.next_refill_on } });
      return row;
    },
  },

  // -- pets (Git #3141) -------------------------------------------------------------------
  // Contract pack Section 6: real per-pet identity + vaccine tracking live here. Vet visits go
  // through push_date/list_dates instead (subjectType: 'pet', subjectId: this pet's id) --
  // that's the real system Section 6 says to reuse, not reinvent. Feeding/meds go through
  // set_medication/get_medications' same batch tools (create a pet_care item with set_pet_care,
  // it then shows up in get_medications' own batch list automatically).

  {
    name: "list_pets",
    title: "Read Shane's real pets",
    description:
      "Every real pet on file, each with its soonest real vaccine due (if any) already computed with dueInDays/surfacesInDays. Call this before set_pet to avoid a duplicate, and before push_date with subjectType 'pet' to get the real subjectId.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      return pets.listPets(ctx.user.id);
    },
  },

  {
    name: "get_pet",
    title: "Read one pet in full",
    description:
      "One real pet's full profile: its vaccines, feeding/meds care items, photo records, and its real vet-visit history (read back from the Dates system).",
    inputSchema: {
      type: "object",
      properties: { petId: { type: "string" } },
      required: ["petId"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = await pets.getPet(ctx.user.id, args.petId);
      if (!row) throw new Error(`No pet ${args.petId}`);
      return row;
    },
  },

  {
    name: "set_pet",
    title: "Create or update a real pet",
    description: "Create a new real pet, or update an existing one by passing its id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Omit to create a new pet; pass an existing id to update it." },
        name: { type: "string" },
        species: { type: "string", description: "e.g. 'dog', 'cat'." },
        breed: { type: "string" },
        born: { type: "string", description: "ISO date, if known." },
        notes: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = args.id ? await pets.updatePet(ctx.user.id, args.id, args) : await pets.createPet(ctx.user.id, args);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: args.id ? "pet.update" : "pet.create", entityId: row.id, detail: { name: row.name } });
      return row;
    },
  },

  {
    name: "set_pet_vaccine",
    title: "Create or update a real pet vaccine",
    description:
      "A real vaccine's own tracked cycle -- 'pepper rabies due february 2027' or 'biscuit's rabies booster is on a 3-year cycle'. intervalDays carries the real cycle length when it's regular (rabies is often 1- or 3-year depending on the vaccine/local requirement); dueOn is the real date the vet gave, which always wins over anything computed from intervalDays. leadDays defaults to 30 (Section 6: enough real notice to book the visit before it lapses, not same-day awareness of something already overdue).",
    inputSchema: {
      type: "object",
      properties: {
        petId: { type: "string" },
        id: { type: "string", description: "Omit to create a new vaccine; pass an existing id to update it." },
        name: { type: "string", description: "e.g. 'Rabies', 'DHPP'." },
        intervalDays: { type: "number", description: "The real cycle length in days, if regular, e.g. 1095 for a 3-year rabies cycle." },
        lastOn: { type: "string", description: "ISO date last given, if known." },
        dueOn: { type: "string", description: "ISO date the vet says it's next due -- always wins over a computed date." },
        fineUntil: { type: "string", description: "ISO date -- the real 'due / fine until' grace date, if the vet gave one." },
        leadDays: { type: "number", description: "Defaults to 30." },
      },
      required: ["petId"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const { petId, id, ...patch } = args;
      const row = id ? await pets.updateVaccine(ctx.user.id, petId, id, patch) : await pets.createVaccine(ctx.user.id, petId, patch);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: id ? "pet.vaccine.update" : "pet.vaccine.create", entityId: row.id, detail: { petId, name: row.name } });
      return row;
    },
  },

  {
    name: "mark_pet_vaccine_given",
    title: "Mark a real vaccine as given",
    description:
      "The real vet-visit outcome -- 'pepper got her rabies shot today'. Sets last_on to when it was given and, when a real cycle interval is on file, projects the next due_on forward from that date (a real vet-given next-due date entered separately with set_pet_vaccine always beats this).",
    inputSchema: {
      type: "object",
      properties: {
        petId: { type: "string" },
        vaccineId: { type: "string" },
        givenOn: { type: "string", description: "ISO date. Defaults to today." },
      },
      required: ["petId", "vaccineId"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = await pets.markVaccineGiven(ctx.user.id, args.petId, args.vaccineId, { givenOn: args.givenOn });
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "pet.vaccine.given", entityId: args.vaccineId, detail: { dueOn: row.due_on } });
      return row;
    },
  },

  {
    name: "set_pet_care",
    title: "Create or update a real pet feeding/med item",
    description:
      "A real feeding or medication item for a pet -- 'give biscuit his joint chew every morning', 'pepper gets half a thyroid pill before bed'. batch must match an existing Meds batch name (see get_medications) to land in the same real swipe, or names a new one. This is the real Section 6 reuse: the item then shows up inside get_medications' own batch list, under that pet's name.",
    inputSchema: {
      type: "object",
      properties: {
        petId: { type: "string" },
        id: { type: "string", description: "Omit to create a new care item; pass an existing id to update it." },
        name: { type: "string", description: "e.g. 'Joint chew', 'Thyroid half-pill'." },
        batch: { type: "string", description: "e.g. 'morning', 'bed' -- must match an existing Meds batch to merge into the same swipe." },
        detail: { type: "string" },
      },
      required: ["petId"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const { petId, id, ...patch } = args;
      const row = id ? await pets.updateCare(ctx.user.id, petId, id, patch) : await pets.createCare(ctx.user.id, petId, patch);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: id ? "pet.care.update" : "pet.care.create", entityId: row.id, detail: { petId, batch: row.batch } });
      return row;
    },
  },

  // -- money (Git #3137) ----------------------------------------------------
  //
  // The design README's own tool list: get_gate_status(), what_if(amount),
  // simulate_transfer(amount, from, to). Every number these return comes from ShanesSurvival's
  // own real tables in the shared Postgres, through the math ported from its DashboardService.cs.
  // None of them can move money -- see simulate_transfer's own description.

  {
    name: "get_gate_status",
    title: "Where the money actually stands",
    description:
      "Shane's real, current money position, straight off the Plaid-synced balances the ShanesSurvival WPF app reads -- the same numbers, from the same rows, through the same math. Returns: available to spend (Income Gate + reserves, minus every bill account's shortfall), whether that is covered, each bill account with its target/balance/shortfall, the modeled habit and the 'really' line after subtracting it, Budget Day (the next real payday), the critical debts, and any pending one-time events (which are deliberately NOT counted in the math until they are real). Call this before answering anything about affordability, and warnings[] is real -- a bill with no target or no Plaid balance is excluded from the total and named there, never silently treated as funded.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      return money.getGateStatus(ctx.user.id);
    },
  },

  {
    name: "what_if",
    title: "What if I spend this",
    description:
      "Answer 'what if I spend 60'. Computes available-to-spend minus the modeled habit minus the amount. If that goes negative it names the real bill account with the biggest shortfall as the first thing that would go unfunded. Read-only arithmetic over real current balances -- it changes nothing and records nothing.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Dollars Shane is thinking about spending, e.g. 60." },
      },
      required: ["amount"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      return money.whatIf(ctx.user.id, args.amount);
    },
  },

  {
    name: "simulate_transfer",
    title: "Simulate moving money between accounts",
    description:
      "Answer 'move 200 from Direct Deposit to Tesla'. THIS NEVER MOVES REAL MONEY AND CANNOT: Plaid is read-only and NFCU has no Transfer product, so this applies the move to copies of the real balances, recomputes the gate math, and reports what would change -- what gets funded, what is still short, and what available-to-spend becomes. If the source is a bill account it flags borrowed-from-bill, because that money was already spoken for. Always tell Shane the move has not happened; the response carries the exact wording ('Never moves money. Do it at NFCU, then it syncs.'). Account names are matched against his real accounts -- an ambiguous name comes back asking which one rather than guessing.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Dollars to move, e.g. 200." },
        from: { type: "string", description: "The account the money would come out of, in Shane's own words, e.g. 'Direct Deposit'." },
        to: { type: "string", description: "The account it would go into, e.g. 'Tesla'." },
      },
      required: ["amount", "from", "to"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const result = await money.simulateTransfer(ctx.user.id, {
        amount: args.amount,
        from: args.from,
        to: args.to,
      });
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "money.transfer.simulated",
        detail: { amount: args.amount, from: args.from, to: args.to, resolvable: result.resolvable },
      });
      return result;
    },
  },

  {
    name: "set_habit",
    title: "State what a recurring habit really costs",
    description:
      "Record the real modeled cost of a recurring personal habit per PAY CYCLE (not per month) -- the number get_gate_status and what_if subtract to produce the 'really' line. The capture-grammar entry point for 'cigarettes run me about $148 a cycle' said in passing. Per cycle because the whole Money screen is denominated in the real pay cycle; a monthly figure would silently mix units with the shortfall it is subtracted against. Additive, like set_food_preferences: an omitted field keeps its current value, so restating the amount does not wipe the unit price stated earlier. Never invent an amount -- if Shane has not said one, ask.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "What the habit is called, e.g. 'Cigarettes'. Matching is case-insensitive, so restating it updates rather than duplicating." },
        amountPerCycle: { type: "number", description: "Real dollars it costs across one pay cycle. Required the first time this habit is named." },
        unitLabel: { type: "string", description: "What one unit is called, e.g. 'pack'. Optional." },
        unitCost: { type: "number", description: "Real dollars for one unit, e.g. 8.40. Optional." },
        logSource: { type: "string", description: "The real table that logs this habit, if one does. 'smoke_log' is the only real value today." },
        isActive: { type: "boolean", description: "false stops subtracting it without deleting the history of what it cost." },
        note: { type: "string", description: "Anything worth keeping about the model, in Shane's own words." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const habit = await money.setHabit(ctx.user.id, args);
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "money.habit.set",
        entityId: habit.id,
        detail: { name: habit.name, amountPerCycle: habit.amount_per_cycle, isActive: habit.is_active },
      });
      return habit;
    },
  },

  {
    name: "push_date",
    title: "Push a real date -- appointment, birthday, event, visit, renewal, vaccine, or anything new",
    description:
      "The capture grammar's real entry point for 'dr appointment oct 3rd 2pm dr fonji every 6 weeks', 'ronnie's birthday dec 14', 'want to go to the air show nov 7', 'mom's coming to visit the 12th-18th', 'pepper rabies due february 2027'. `kind` is one of the known lead-time kinds (appointment, vet, birthday, event, visit, renewal, vaccine -- lead time already set correctly for each) OR a genuinely new one Claude invents on the fly for a novel capture that doesn't fit ('mom's visiting' -> kind 'visit' already exists; something that truly doesn't fit gets its own kind and a real category is minted for it, returned as newCategory:true). intervalDays carries an ARBITRARY real recurrence ('every 6 weeks' = 42), not just weekly/monthly presets. Call list_dates first to avoid a duplicate.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", description: "appointment | vet | birthday | event | visit | renewal | vaccine, or a new kind for a genuinely novel capture." },
        title: { type: "string", description: "What Shane reads at a glance, e.g. 'Dr. Fonji'." },
        atDate: { type: "string", description: "YYYY-MM-DD of the (first) occurrence." },
        atTime: { type: "string", description: "HH:MM 24h, if the capture stated a time. Omit for an all-day date." },
        intervalDays: { type: "integer", description: "Real recurrence in days, e.g. 42 for 'every 6 weeks'. Omit for a one-off." },
        leadDays: { type: "integer", description: "How many days ahead this should surface. Omit to use the real per-kind default (appointment/vet 1, birthday 10, event 14, visit 3, renewal 21, vaccine 30); a novel kind defaults to 7." },
        provider: { type: "string", description: "Who/where, e.g. 'Dr. Fonji'. What attach_ask matches on." },
        subjectType: { type: "string", enum: ["self", "pet", "person"], default: "self" },
        subjectId: { type: "string", description: "pets.id or a person entity id, matching subjectType." },
        category: { type: "string", description: "Only needed for a genuinely on-the-fly kind -- an open slug, invented if nothing fits." },
        notes: { type: "string" },
        ...CATEGORY_META_PROPS,
      },
      required: ["kind", "title", "atDate"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = await dates.createDate({
        userId: ctx.user.id,
        kind: args.kind,
        title: args.title,
        atDate: args.atDate,
        atTime: args.atTime ?? null,
        intervalDays: args.intervalDays ?? null,
        leadDays: args.leadDays ?? undefined,
        provider: args.provider ?? null,
        subjectType: args.subjectType || "self",
        subjectId: args.subjectId ?? null,
        category: args.category ?? null,
        categoryMeta: categoryMeta(args),
        source: "mcp",
        notes: args.notes ?? null,
      });
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "date.create", entityId: row.id, detail: { kind: row.kind, newCategory: row.newCategory } });
      return row;
    },
  },

  {
    name: "list_dates",
    title: "Read Shane's real dates",
    description:
      "Every real upcoming date -- appointments, birthdays, events, visits, renewals, vaccines -- plus real federal holidays merged in, all with a real dueInDays and surfacesInDays already computed from each kind's lead time. Recurring dates show their real NEXT occurrence, not the original one. Call this before push_date to avoid a duplicate.",
    inputSchema: {
      type: "object",
      properties: {
        includeDone: { type: "boolean", default: false },
        horizonDays: { type: "integer", minimum: 1, maximum: 800, default: 400 },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      return dates.listDates(ctx.user.id, { includeDone: Boolean(args.includeDone), horizonDays: args.horizonDays });
    },
  },

  {
    name: "get_date",
    title: "Read one date in full",
    description: "One real date with its full ask list and visit/photo history.",
    inputSchema: {
      type: "object",
      properties: { dateId: { type: "string" } },
      required: ["dateId"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = await dates.getDate(ctx.user.id, args.dateId);
      if (!row) throw new Error(`No date ${args.dateId}`);
      return row;
    },
  },

  {
    name: "attach_ask",
    title: "Attach 'next time, ask about...' to a provider's next appointment",
    description:
      "The capture grammar's 'next time at dr fonji ask about ...' -- attaches to whichever real appointment/vet date is that provider's soonest upcoming one, without needing its id. Matches provider case-insensitively.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "e.g. 'Dr. Fonji'. Must match an existing date's provider." },
        text: { type: "string", description: "What to ask." },
      },
      required: ["provider", "text"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const result = await dates.attachAskToProvider(ctx.user.id, args.provider, args.text);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "date.ask.add", entityId: result.dateId });
      return result;
    },
  },

  {
    name: "attach_visit",
    title: "Log a real visit -- notes and photos",
    description:
      "Record a real completed visit to a recurring appointment: notes, and photos (each either a mediaId already uploaded through the app, or an external url). This is 'Notes and photos, by visit' on the date-detail screen.",
    inputSchema: {
      type: "object",
      properties: {
        dateId: { type: "string" },
        visitedOn: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
        notes: { type: "string" },
        photos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              mediaId: { type: "string" },
              url: { type: "string" },
              label: { type: "string" },
            },
          },
        },
      },
      required: ["dateId"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const visit = await dates.addVisit(ctx.user.id, args.dateId, {
        visitedOn: args.visitedOn ?? null,
        notes: args.notes ?? null,
        photos: args.photos || [],
      });
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "date.visit.add", entityId: args.dateId });
      return visit;
    },
  },

  {
    name: "get_federal_holidays",
    title: "Read the real federal holiday list",
    description: "Real US federal holidays from OPM, refreshed monthly (Git #3136). Not user-scoped -- the same fact for everybody.",
    inputSchema: {
      type: "object",
      properties: { fromYear: { type: "integer", description: "Defaults to the current year." } },
      additionalProperties: false,
    },
    async handler(args) {
      return federalHolidays.listFederalHolidays({ fromYear: args.fromYear });
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
