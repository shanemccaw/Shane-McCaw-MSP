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
import * as catches from "../core/catches.mjs";
import * as categories from "../core/categories.mjs";
import * as contacts from "../core/contacts.mjs";
import * as dates from "../core/dates.mjs";
import * as entities from "../core/entities.mjs";
import * as federalHolidays from "../core/federal-holidays.mjs";
import * as foodPreferences from "../core/food-preferences.mjs";
import { downscaleImageToFit } from "../core/image-resize.mjs";
import * as incomeRules from "../core/income-rules.mjs";
import * as lists from "../core/lists.mjs";
import * as mealPlan from "../core/meal-plan.mjs";
import * as media from "../core/media.mjs";
import * as medications from "../core/medications.mjs";
import * as money from "../core/money.mjs";
import * as nudges from "../core/nudges.mjs";
import * as nutrition from "../core/nutrition.mjs";
import * as people from "../core/people.mjs";
import * as pets from "../core/pets.mjs";
import * as places from "../core/places.mjs";
import * as prices from "../core/prices.mjs";
import * as recipes from "../core/recipes.mjs";
import * as shares from "../core/shares.mjs";
import * as storeAisles from "../core/store-aisles.mjs";
import * as tesla from "../core/tesla.mjs";
import * as things from "../core/things.mjs";
import * as vehicles from "../core/vehicles.mjs";
import * as wins from "../core/wins.mjs";
import { badRequest, notFound } from "../http.mjs";

// The real image-content limit this tool self-enforces (Git #3261). Anthropic's own vision
// limits top out around 5MB per image. A photo over this line is downscaled server-side via
// `sharp` (src/core/image-resize.mjs, Git #3262) until it actually fits; a photo that still
// won't fit at the size/quality floor gets a real, honest error naming its real size rather
// than a silent truncation or a fabricated "resized" image that was never actually resized.
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

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

/**
 * Git #3311's real "proactive surfacing" half: check the rows push_deals/push_coupons just wrote
 * against Shane's "What I Like" occasional-purchase list (prices.mjs's matchOccasionalListAgainst
 * -- reuses the same real substring match attachWeeklyAdVerdicts already uses for Shopping), and
 * queue a real Today's-tray nudge for any match. Same real push-notification mechanism
 * (core/nudges.mjs) every other proactive surface in this app already uses
 * (appointment/vaccine/tesla/bank) -- not a third, invented mechanism. A nudge failure (e.g. no
 * push subscription registered yet) must never fail the push_deals/push_coupons call it rides in
 * on, same real guard plaid-webhook.mjs's own nudgeItemNeedsAttention uses.
 */
async function notifyOccasionalMatches(userId, pushedRows) {
  const matches = await prices.matchOccasionalListAgainst(userId, pushedRows);
  if (matches.length === 0) return matches;
  try {
    const title = matches.length === 1
      ? `${matches[0].listItemText} is on sale`
      : `${matches.length} things on your "What I Like" list are on sale`;
    const body = matches
      .map((m) => {
        const price = m.priceCents != null ? ` $${(m.priceCents / 100).toFixed(2)}` : "";
        const where = m.store ? ` at ${m.store}` : "";
        const deal = m.description ? ` -- ${m.description}` : "";
        return `${m.listItemText}${price}${where}${deal}`;
      })
      .join(" · ");
    await nudges.queueNudge({ userId, kind: "deal_match", title, body, payload: { matches } });
  } catch (err) {
    console.error(`[occasional-list] could not queue deal-match nudge: ${err.message}`);
  }
  return matches;
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
          requestedBy: {
            type: "string",
            description: "Who actually asked for this, e.g. 'Ronnie' -- only meaningful on a list item. Feeds the Catches duplicate-request detector (#3153): two different real names on the same item text across the same list gets flagged.",
          },
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
    name: "get_capture_photo",
    title: "Actually see a captured photo",
    description:
      "Read a photo capture's real image bytes and return them as genuine, viewable MCP image content -- list_captures only ever returns metadata (mime type, byte size, GPS), never what's actually in the picture. Call this on a pending photo capture before filing it, so the description that goes into set_thing/log_person_note/attach_visit/create_entity is a real one, not 'a photo'. Pass either captureId (from list_captures) or mediaId directly.",
    inputSchema: {
      type: "object",
      properties: {
        captureId: { type: "string", description: "uuid of the capture, from list_captures. Preferred -- also confirms the photo belongs to this account." },
        mediaId: { type: "string", description: "uuid of the underlying media row, if you already have it and not a captureId." },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      if (!args.captureId && !args.mediaId) throw badRequest("Provide either captureId or mediaId");

      let mediaId = args.mediaId ?? null;
      let captureRow = null;
      if (args.captureId) {
        captureRow = await captures.getCapture(ctx.user.id, args.captureId);
        if (!captureRow) throw notFound("Capture not found");
        if (!captureRow.media_id) throw badRequest("That capture has no attached photo");
        mediaId = captureRow.media_id;
      }

      const row = await media.readMedia(ctx.user.id, mediaId);
      if (!row) throw notFound("Attachment not found");
      if (!row.mime_type.startsWith("image/")) {
        throw badRequest(`That attachment is ${row.mime_type}, not a photo -- this tool only returns image content`);
      }

      let sendBytes = row.bytes;
      let sendMimeType = row.mime_type;
      let downscaled = null;

      if (row.byte_size > MAX_INLINE_IMAGE_BYTES) {
        const resized = await downscaleImageToFit(row.bytes, MAX_INLINE_IMAGE_BYTES);
        if (!resized) {
          throw badRequest(
            `Photo is ${(row.byte_size / (1024 * 1024)).toFixed(1)}MB, over the ${MAX_INLINE_IMAGE_BYTES / (1024 * 1024)}MB limit this tool can send inline, and server-side downscaling couldn't get it under that limit (see Git #3262).`,
          );
        }
        sendBytes = resized.bytes;
        sendMimeType = resized.mimeType;
        downscaled = { originalByteSize: row.byte_size, sentByteSize: sendBytes.length, width: resized.width, height: resized.height, quality: resized.quality };
      }

      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "capture.view_photo",
        detail: { captureId: args.captureId ?? null, mediaId: row.id, downscaled: downscaled !== null },
      });

      return {
        __mcpContent: [{ type: "image", data: sendBytes.toString("base64"), mimeType: sendMimeType }],
        captureId: args.captureId ?? null,
        mediaId: row.id,
        mimeType: sendMimeType,
        byteSize: sendBytes.length,
        originalName: row.original_name,
        ...(downscaled ? { downscaled } : {}),
      };
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
    name: "get_nutrition",
    title: "Read a scanned item's real Open Food Facts nutrition",
    description:
      "Real per-100g nutrition facts (sodium, saturated fat, sugars, fiber) for an item Shane has actually barcode-scanned (Git #3260), pulled from Open Food Facts and cached by barcode. Call this before push_recipes alongside get_health_context, so a heart-healthy call is grounded in a real, concrete number for items Shane actually buys ('the pasta sauce he scanned is high-sodium') instead of your own general judgment alone. Matches the same normalised (lower/trim) item text get_prices/push_list use. Returns found:false honestly when the item was never scanned, or OFF has no data for its barcode -- not every real product is in OFF's database, which is expected and not an error.",
    inputSchema: {
      type: "object",
      properties: {
        item: { type: "string", description: "The item's text, e.g. 'pasta sauce'." },
      },
      required: ["item"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      return nutrition.getNutritionForItem(ctx.user.id, args.item);
    },
  },

  {
    name: "log_price",
    title: "Log a real price you just paid",
    description:
      "The capture-grammar entry point for a real price Shane just states in passing -- 'chicken breasts are $3.49 now', 'paid $12 for the detergent at Aldi' -- Git #3203 replaces the Shopping room's own dedicated \"Log price\" form with this. Records the real observation in the same per-store price history get_prices reads (item_prices), AND -- if that item is currently open on Shopping's real running list -- stamps the price straight onto that item's own row, so the run's running total actually reflects it instead of only ever moving via a barcode scan. Matches list items the same normalised (lower/trim) way as everywhere else in this app.",
    inputSchema: {
      type: "object",
      properties: {
        item: { type: "string", description: "The item's text, e.g. 'chicken breasts'." },
        store: { type: "string", description: "Store name, e.g. 'Aldi'. Required -- a price with no store isn't a real per-store observation." },
        priceCents: { type: "integer", description: "Price in cents, e.g. 349 for $3.49." },
        observedOn: { type: "string", description: "ISO date this was actually paid/seen. Defaults to today." },
        note: { type: "string", description: "Anything else worth keeping, e.g. 'on sale', 'family size'." },
      },
      required: ["item", "store", "priceCents"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = await prices.recordPrice(ctx.user.id, {
        storeName: args.store,
        itemText: args.item,
        priceCents: args.priceCents,
        observedOn: args.observedOn ?? null,
        note: args.note ?? null,
        source: "shane",
      });
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "price.record",
        detail: { itemText: row.item_text, storeName: row.store_name, priceCents: row.price_cents },
      });
      return row;
    },
  },

  {
    name: "push_deals",
    title: "Push weekly-ad prices",
    description:
      "Store real per-store prices you just read off a weekly ad flyer (Git #3110), so Shopping can show a real cross-store verdict on matching list items -- 'Walmart $2.99', cheapest store wins. Lands in the same real price history get_prices reads, tagged as this week's ad rather than a one-off observation. Call get_prices first to check what's already on file for an item before re-pushing the same flyer twice. Also checked against Shane's 'What I Like' occasional-purchase list (Git #3311) -- a real match queues a real Today's-tray nudge automatically, no separate call needed.",
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
              validTo: { type: "string", description: "ISO date this sale price ends, if the flyer states one." },
              category: { type: "string", description: "Product category, e.g. 'Snacks', 'Dairy', 'Produce', if the flyer groups by one." },
              imageUrl: { type: "string", description: "Product thumbnail image URL, if one is available." },
              dealType: { type: "string", description: "Free-form deal type, e.g. 'sale', 'bogo', 'digital_coupon', 'multi_buy' -- whatever best describes it." },
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
      const occasionalMatches = await notifyOccasionalMatches(ctx.user.id, rows);
      return { pushed: rows.length, prices: rows, occasionalMatches };
    },
  },

  {
    name: "push_coupons",
    title: "Push coupons and multi-buy deals",
    description:
      "Store real coupons, multi-buy counts ('2 for $5') and discounts you just read off a weekly ad flyer or a coupon (Git #3110), so Shopping can surface them on matching list items. Also checked against Shane's 'What I Like' occasional-purchase list (Git #3311) -- a real match queues a real Today's-tray nudge automatically, no separate call needed.",
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
              category: { type: "string", description: "Product category, e.g. 'Snacks', 'Dairy', 'Produce', if the flyer groups by one." },
              imageUrl: { type: "string", description: "Product thumbnail image URL, if one is available." },
              dealType: { type: "string", description: "Free-form deal type, e.g. 'sale', 'bogo', 'digital_coupon', 'multi_buy' -- whatever best describes it." },
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
      const occasionalMatches = await notifyOccasionalMatches(ctx.user.id, rows);
      return { pushed: rows.length, coupons: rows, occasionalMatches };
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
      "Push one or more real, ready-to-use recipes into the app -- the Recipes room's real generation entry point (Section 5: recipes are Claude-generated and pushed in via MCP, not authored in-app). Call get_health_context first so heart-healthy choices are favored where it genuinely applies, and set heartHealthy true on the recipes where it does -- where a recipe calls for an item Shane has actually barcode-scanned, call get_nutrition (Git #3260) too, so that call is grounded in a real per-100g sodium/saturated-fat/sugar number for that real product instead of general judgment alone. Set cookMinutes on any recipe genuinely meant to be one dish of a Tonight synchronized multi-dish meal (Git #3126) -- it's the one real number Tonight's start-offset math needs, and a recipe with no cookMinutes cannot be picked as a Tonight dish. Set replace true to swap out every previously saved recipe for this fresh set; leave false to add onto what's already saved.",
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
      "Create a new real medication record, or update an existing one by passing its id. batch is free text ('morning', 'evening', ...) -- the same batch groups a single swipe completes together, so a new medication in an existing batch just joins that batch's next swipe, no migration needed. refillTier is a real, locked dichotomy: 'auto' (no action ever needed from Shane) or 'manual' (surfaces under Refills > Needs you). supplyDays + nextRefillOn drive the real 'days left' countdown on a manual-watch item. pharmacyPhone drives the real 'Call pharmacy' button on a manual-watch item -- the button only shows once this is set. courseStartDate/courseActiveDays/courseCycleDays are for a real cyclical course medication (e.g. Terbinafine, 15 days on then dormant for a repeating cycle) -- set all three together to make it a course (it then only appears in its batch during the real active window, and disappears the rest of the cycle), or pass all three as null to clear it back to an ordinary always-in-batch medication. A capture like 'starting my 15-day Terbinafine course today' only needs to pass courseStartDate on an id that already has courseActiveDays/courseCycleDays set -- it resets just the start date and keeps the rest.",
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
        pharmacyPhone: { type: "string", description: "e.g. '555-123-4567' -- the manual-watch tier's real 'Call pharmacy' number." },
        courseStartDate: { type: "string", description: "ISO date the current/most recent course actually began. Real cyclical course medications only -- set together with courseActiveDays + courseCycleDays." },
        courseActiveDays: { type: "number", description: "How many days into the cycle it's actually taken, e.g. 15 for a 15-days-on Terbinafine course." },
        courseCycleDays: { type: "number", description: "The full real cycle length (active + dormant) before it repeats, e.g. 75 for a 15-on/60-off pattern." },
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
      "Shane's real, current money position, straight off the Plaid-synced balances the ShanesSurvival WPF app reads -- the same numbers, from the same rows, through the same math. Returns: available to spend (Income Gate + reserves, minus every bill account's shortfall), whether that is covered, each bill account with its target/balance/shortfall, the modeled habit and the 'really' line after subtracting it, `smoking` (real this-cycle/last-cycle smoke_log totals plus the financial-confrontation line, shown only while a real shortfall exists -- see log_smoke), Budget Day (the next real payday), the critical debts, and any pending one-time events (which are deliberately NOT counted in the math until they are real). Call this before answering anything about affordability, and warnings[] is real -- a bill with no target or no Plaid balance is excluded from the total and named there, never silently treated as funded.",
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
    name: "preview_paycheck_distribution",
    title: "Preview splitting a paycheck across short bills, with conversational adjustments",
    description:
      "Distribute Paycheck's real preview (Git #3208): splits a real dollar amount across every real short bill account, ordered due-soonest-first, and reports the real running totals -- what's left in the Income Gate account and what available-to-spend becomes -- plus a plain statement of whatever real bill still stays short after the split. NEVER MOVES OR PERSISTS ANYTHING -- pure preview, same discipline as simulate_transfer and what_if. This is the real target for 'skip Netflix' and 'give Rent 2000': pass `skip` for a bill to leave out of this round entirely, and `give` to send a bill an exact amount off the top before the remainder splits proportionally across everything else that's still short. Bill names are matched the same way simulate_transfer matches account names -- an unresolved or ambiguous one comes back in `unresolved` rather than being silently dropped, so say that back to Shane and ask. Omit `amount` to use the real current Income Gate balance (the landed paycheck) rather than asking Shane to state it.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Dollars to distribute, e.g. 4343.63. Omit to use the real current Income Gate balance." },
        skip: { type: "array", items: { type: "string" }, description: "Bill names to leave out of this round entirely, e.g. ['Netflix']." },
        give: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, amount: { type: "number" } },
            required: ["name", "amount"],
            additionalProperties: false,
          },
          description: "Explicit overrides, e.g. [{\"name\":\"Rent\",\"amount\":2000}] for 'give Rent 2000'.",
        },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      let amount = args.amount;
      if (amount === undefined || amount === null) {
        const status = await money.getGateStatus(ctx.user.id);
        if (status.gate.balance === null) {
          return { answerable: false, text: "No real Income Gate balance to distribute yet -- run a sync, or state a real amount." };
        }
        amount = status.gate.balance;
      }
      return money.previewDistribution(ctx.user.id, amount, { skip: args.skip ?? [], give: args.give ?? [] });
    },
  },

  {
    name: "list_debts",
    title: "Read every real debt, bankruptcy-filing ones first",
    description:
      "Every real row in ShanesSurvival's own `debts` table -- the same table get_gate_status's protectedDebts reads, but the full list (not just is_critical ones), with the bankruptcy-tracker overlay fields: debtType (free text, e.g. 'mortgage', 'tax', 'credit_card', 'bnpl'), originalBalance vs the existing currentBalance (for payoff progress), lastPaymentDate, and includedInBankruptcy (whether this debt is actually part of the filing). Ported from Finance-Tracker's BankruptcyItem tracker, which was fully built but never surfaced on any screen there.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      return { debts: await money.listDebts() };
    },
  },

  {
    name: "set_debt",
    title: "Create or update a real debt/bankruptcy-tracker row",
    description:
      "Create a new real debt, or update an existing one by passing its id. Same table get_gate_status reads for protectedDebts -- creditor/balance/notes on an existing critical debt update in place here, not a second row. Pass includedInBankruptcy true for a debt that's actually part of the filing.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Omit to create a new debt; pass an existing id to update it." },
        creditor: { type: "string", description: "Required on create." },
        balance: { type: "number", description: "Current real balance, in dollars. Required on create." },
        minimumPayment: { type: "number" },
        isDelinquent: { type: "boolean" },
        daysPastDue: { type: "number" },
        isCritical: { type: "boolean", description: "Drives get_gate_status's protectedDebts / the Money 'Protected' bucket." },
        dueDay: { type: "number", description: "1-31, if this debt has a recurring monthly due date." },
        debtType: { type: "string", description: "Free text, e.g. 'mortgage', 'tax', 'credit_card', 'bnpl', 'medical'. Deliberately not a fixed enum." },
        originalBalance: { type: "number", description: "Balance when first recorded, for payoff-progress tracking against the current balance." },
        lastPaymentDate: { type: "string", description: "ISO date of the last real payment." },
        includedInBankruptcy: { type: "boolean", description: "Whether this debt is actually part of the bankruptcy filing." },
        notes: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const { id, ...fields } = args;
      const row = id ? await money.updateDebt(id, fields) : await money.createDebt(fields);
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: id ? "money.debt.update" : "money.debt.create",
        entityId: row.id,
        detail: { creditor: row.creditor, balance: row.balance, includedInBankruptcy: row.includedInBankruptcy },
      });
      return row;
    },
  },

  {
    name: "delete_debt",
    title: "Delete a real debt/bankruptcy-tracker row",
    description: "Removes a real row from ShanesSurvival's own `debts` table entirely. Use sparingly -- this is the same table Money's shortfall math and protectedDebts read.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const result = await money.deleteDebt(args.id);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "money.debt.delete", entityId: result.id });
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
    name: "log_smoke",
    title: "Log a real cigarette / pack",
    description:
      "The capture-grammar entry point for 'smoked' / 'cigarette(s)' / 'a pack' / 'bought a pack' / 'pack of' (both phrasings log the same +1 pack -- Section 3's capture grammar does not distinguish a single cigarette from a pack purchase). Appends a real row to smoke_log (017), priced from whichever active habit has logSource 'smoke_log' set via set_habit -- never a hardcoded dollar figure. No streak, nothing resets: a slip is just another real data point, per Shane's own real behavioral note that he starts and stops cyclically. get_gate_status's own `smoking` field is where the real running totals and the financial-confrontation line ('Still $X to fund this cycle...') come from -- call that after this to see the updated numbers.",
    inputSchema: {
      type: "object",
      properties: {
        packs: { type: "number", description: "How many packs this entry represents. Defaults to 1 -- both 'smoked' and 'bought a pack' log a single entry unless Shane states a real count." },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = await money.logSmoke(ctx.user.id, { packs: args.packs });
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "money.smoke.logged",
        entityId: row.id,
        detail: { packs: row.packs, amount: row.amount },
      });
      return row;
    },
  },

  // -- Money -> Income Rules + transaction auto-scan (Git #3169) ---------------
  //
  // Real port of Finance-Tracker's IncomeRule + scanTransactions() -- see
  // src/core/income-rules.mjs's own header. Rule CRUD lives here, not as a web form: Section 8
  // ("no forms, anywhere, ever") is scoped to what the capture-parsing layer can act on, and a
  // rule (name, account, income source, match type/text, optional amount range) is exactly the
  // kind of several-typed-fields record that belongs in a real conversation with Claude, the
  // same as set_habit/set_food_preferences.

  {
    name: "list_income_rules",
    title: "Real income-matching rules",
    description:
      "Every real income rule (active and inactive), plus every real income source with which one is currently marked primary. Call this before add/update/delete so Claude has the real account/source names and current rule ids to work with.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler() {
      return { rules: await incomeRules.listRules({ includeInactive: true }), sources: await incomeRules.listIncomeSources() };
    },
  },

  {
    name: "add_income_rule",
    title: "Add a real income-matching rule",
    description:
      "Creates a real rule: when a real credit (deposit) transaction on `account` matches `matchText` (and, if given, falls within minAmount/maxAmount), a real income entry gets credited to `incomeSource` the next time scan_income_transactions runs. Same real, transparent, debuggable model as Finance-Tracker's IncomeRule -- contains/starts-with/exact text match, never an opaque classifier. `account`/`incomeSource` are matched against Shane's real accounts/income sources by name (case-insensitive, prefix or substring, same resolution simulate_transfer already uses) -- call list_income_rules first if unsure of the exact real name, and an ambiguous or unknown name comes back asking which one rather than guessing.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "What this rule is called, e.g. 'NASA Salary direct deposit'." },
        account: { type: "string", description: "The real linked account to watch, in Shane's own words, e.g. 'DirectDeposit'." },
        incomeSource: { type: "string", description: "The real income source a match gets credited to, e.g. 'NASA Salary'." },
        matchType: { type: "string", enum: ["contains", "starts_with", "exact"], description: "How matchText is compared against the transaction's real description. Defaults to 'contains'." },
        matchText: { type: "string", description: "Text to look for in the transaction's real merchant/description, e.g. 'COM2 TREAS 310'. Case-insensitive." },
        minAmount: { type: "number", description: "Optional real dollar floor -- a matching deposit smaller than this is ignored." },
        maxAmount: { type: "number", description: "Optional real dollar ceiling -- a matching deposit larger than this is ignored." },
      },
      required: ["name", "account", "incomeSource", "matchText"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const rule = await incomeRules.createRule(args);
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "money.income_rule.created",
        entityId: rule.id,
        detail: { name: rule.name, accountName: rule.accountName, sourceName: rule.sourceName },
      });
      return rule;
    },
  },

  {
    name: "update_income_rule",
    title: "Edit a real income-matching rule",
    description:
      "Updates one or more fields of a real rule (from list_income_rules). Additive, like set_habit: an omitted field keeps its current value. `isActive: false` pauses a rule without deleting its history.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The real rule's id, from list_income_rules." },
        name: { type: "string" },
        account: { type: "string", description: "A new real account to watch, by name." },
        incomeSource: { type: "string", description: "A new real income source to credit, by name." },
        matchType: { type: "string", enum: ["contains", "starts_with", "exact"] },
        matchText: { type: "string" },
        minAmount: { type: "number" },
        maxAmount: { type: "number" },
        isActive: { type: "boolean" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const { id, ...patch } = args;
      const rule = await incomeRules.updateRule(id, patch);
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "money.income_rule.updated",
        entityId: rule.id,
        detail: { name: rule.name, isActive: rule.isActive },
      });
      return rule;
    },
  },

  {
    name: "delete_income_rule",
    title: "Delete a real income-matching rule",
    description: "Deletes one real rule (from list_income_rules) permanently. Real income entries it already created are never touched or removed.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The real rule's id, from list_income_rules." } },
      required: ["id"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const result = await incomeRules.deleteRule(args.id);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "money.income_rule.deleted", entityId: args.id, detail: {} });
      return result;
    },
  },

  {
    name: "set_primary_income_source",
    title: "Mark a real income source as primary",
    description:
      "Sets exactly one real income source as primary, clearing any previous one -- the real, editable setting Finance-Tracker never had ('no way to change which income source is primary once set, despite it driving all cycle math'). This app's own Budget Day already treats every active source equally by real next-pay-date, so this is a real label Shane can set and see, not a control that changes get_gate_status's own math.",
    inputSchema: {
      type: "object",
      properties: { incomeSource: { type: "string", description: "The real income source to mark primary, by name, e.g. 'NASA Salary'." } },
      required: ["incomeSource"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = await incomeRules.setPrimarySource(args.incomeSource);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "money.income_source.primary_set", entityId: row.id, detail: { name: row.name } });
      return row;
    },
  },

  {
    name: "scan_income_transactions",
    title: "Scan for real income matching active rules",
    description:
      "For every real account referenced by an active income rule, reads real already-synced transactions (no live Plaid call -- #3107's unified database means they're already there), matches real credit (deposit) transactions against each active rule, and bulk-creates real income entries for new matches. De-dupes by the real transaction id, so running this again after a fresh Plaid sync only ever adds genuinely new real deposits -- never a duplicate. Call list_income_rules first if nothing seems to be matching; a rule with no matches usually means its matchText or account is wrong, not that scanning failed.",
    inputSchema: {
      type: "object",
      properties: {
        lookbackDays: { type: "number", description: "How many real days back to scan. Defaults to 90, same as Finance-Tracker's own scan window." },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const result = await incomeRules.scanTransactions({ lookbackDays: args.lookbackDays });
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "money.income_rules.scanned",
        detail: {
          scannedAccounts: result.scannedAccounts,
          transactionsScanned: result.transactionsScanned,
          created: result.created,
          linked: result.linked,
          alreadyLogged: result.alreadyLogged,
        },
      });
      return result;
    },
  },

  // -- Money -> Catches (Git #3153) -------------------------------------------
  //
  // Section 4's real expense-cutting mechanisms: renewal watch, forgotten-money sweep,
  // duplicate-request catch, borrowed-from-bill detection, bulk-buy suggestion. See
  // src/core/catches.mjs for what each of the five real detectors actually looks for.

  {
    name: "get_catches",
    title: "Real money-leak catches",
    description:
      "Runs the five real Catches detectors (renewal watch, forgotten-money sweep, duplicate-request, borrowed-from-bill, bulk-buy) against real current data, then returns every real, undismissed catch found -- what the Money screen's Catches card shows. Safe to call any time; upserts make repeated calls idempotent rather than piling up duplicates.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      await catches.runDetectors(ctx.user.id);
      return { catches: await catches.listCatches(ctx.user.id) };
    },
  },

  {
    name: "dismiss_catch",
    title: "Got it -- dismiss a catch",
    description: "Dismisses one real catch, same as tapping 'Got it' on the Money screen's Catches card. Idempotent.",
    inputSchema: {
      type: "object",
      properties: { catchId: { type: "string" } },
      required: ["catchId"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = await catches.dismissCatch(ctx.user.id, args.catchId);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "catch.dismiss", entityId: row.id, detail: { kind: row.kind } });
      return row;
    },
  },

  // -- Money -> Cars (Git #3149) ---------------------------------------------

  {
    name: "get_cars",
    title: "Real per-vehicle money cards",
    description:
      "Every real vehicle (Tesla Model 3, Kia Forte) with its all-in $/mo and $/yr: the linked real loan bill account (payment due, what's saved toward it), insurance, registration (amortised from the real annual amount) and real maintenance spend from the last 12 months (also amortised) -- so 'is this car actually worth keeping' has one real aggregated number instead of scattered bills. Registration and next-maintenance reminders carry the same dueSoon/overdue shape Dates uses, with a matching real lead time. Whichever vehicle is linked to the connected Tesla (Git #3217) also carries `maintenance.byMileage` -- a real, live odometer-based figure (miles since last service, miles left in the real interval, overdue-by-mileage) -- and `tesla.mileageSyncedAt`; both are null for a non-Tesla vehicle or before the first real sync.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      return { vehicles: await vehicles.listVehicles(ctx.user.id) };
    },
  },

  {
    name: "get_car_climate_status",
    title: "Real, on-demand Tesla climate read",
    description:
      "The real, current climate state of Shane's connected Tesla (Git #3158) -- is it on, is it actively preconditioning, real inside/outside temps. On-demand only, never auto-polled (waking the vehicle to answer costs real 12V battery and Tesla's own Fleet API rate-limits reads) -- ask when it is genuinely useful to know right now (e.g. \"is the car warming up\"), not on a schedule. Throws a real, descriptive error if Tesla isn't connected or no vehicle is selected yet -- point Shane at Settings -> Tesla rather than guessing.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      return tesla.getVehicleClimateState(ctx.user.id);
    },
  },

  {
    name: "get_car_charge_status",
    title: "Real, on-demand Tesla charge read",
    description:
      "The real, current battery level/range/charging state of Shane's connected Tesla (Git #3292 -- 'what's my car's charge at', 'how's the battery') -- distinct from get_car_climate_status, which only ever answers climate. On-demand only, never auto-polled, same real discipline as climate (waking the vehicle to answer costs real 12V battery and Tesla's own Fleet API rate-limits reads). Honest about the one real case that isn't an error: a sleeping vehicle answers HTTP 408, so this returns `{waking:true, message}` instead of a bare timeout/error -- ask again in a moment rather than treating that as a failure. Throws a real, descriptive error for every other real problem (Tesla not connected, no vehicle selected yet) -- point Shane at Settings -> Tesla rather than guessing.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      return tesla.getChargeStateOrWaking(ctx.user.id);
    },
  },

  {
    name: "log_car_maintenance",
    title: "Log real maintenance actually done on a vehicle",
    description:
      "The capture-grammar entry point for 'did an oil change on the Kia, $45' or 'Tesla tire rotation today, $60, at 32000 miles'. Records real spend (this is what get_cars' maintenance total is built from) and, in the same call, can restate when the NEXT maintenance is expected (nextMaintenanceOn/nextMaintenanceNote) -- omit those to leave the existing next-due date alone. `vehicle` matches by name (case-insensitive, prefix or substring, same resolution as simulate_transfer's account matching) -- call get_cars first if unsure of the exact name.",
    inputSchema: {
      type: "object",
      properties: {
        vehicle: { type: "string", description: "The vehicle's name, e.g. 'Kia' or 'Tesla Model 3'." },
        description: { type: "string", description: "What was actually done, e.g. 'Oil change'." },
        amount: { type: "number", description: "Real dollars it actually cost." },
        performedOn: { type: "string", description: "YYYY-MM-DD it was actually done. Defaults to today." },
        mileage: { type: "integer", description: "Real odometer reading at the time, if known." },
        nextMaintenanceOn: { type: "string", description: "YYYY-MM-DD the next maintenance is expected, if stated. Omit to leave unchanged." },
        nextMaintenanceNote: { type: "string", description: "What the next maintenance is, e.g. 'Tire rotation'. Omit to leave unchanged." },
      },
      required: ["vehicle", "description", "amount"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const all = await vehicles.listVehicles(ctx.user.id);
      const needle = String(args.vehicle ?? "").trim().toLowerCase();
      const tiers = [
        all.filter((v) => v.name.toLowerCase() === needle),
        all.filter((v) => v.name.toLowerCase().startsWith(needle)),
        all.filter((v) => v.name.toLowerCase().includes(needle)),
      ];
      let match = null;
      for (const tier of tiers) {
        if (tier.length === 1) {
          match = tier[0];
          break;
        }
        if (tier.length > 1) {
          throw new Error(`"${args.vehicle}" matches ${tier.map((v) => v.name).join(", ")} -- say which one.`);
        }
      }
      if (!match) throw new Error(`There is no vehicle called "${args.vehicle}". Call get_cars to see real vehicle names.`);

      const { vehicle: _vehicle, ...patch } = args;
      const row = await vehicles.logMaintenance(ctx.user.id, match.id, patch);
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "vehicle.maintenance.log",
        entityId: match.id,
        detail: { description: args.description, amount: args.amount },
      });
      return row;
    },
  },

  {
    name: "set_vehicle",
    title: "Create or update a real vehicle",
    description:
      "The capture-grammar entry point for 'add my Kia Forte' (create) or 'the Tesla's insurance is $180 a month now' (update) -- Git #3182 replaces the Cars tab's own dedicated add-vehicle form with this. Create a new real vehicle, or update an existing one by passing its id (call get_cars first to find it -- same pattern as set_pet/set_debt). loanBillId links a real bill account so its own payment/due-day math feeds the all-in total get_cars returns; pass null to unlink.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Omit to create a new vehicle; pass an existing id to update it." },
        name: { type: "string", description: "e.g. 'Tesla Model 3'. Required on create." },
        loanBillId: { type: "string", description: "A real account id from the linked loan bill, if this vehicle is financed. Pass null to unlink." },
        insuranceAmount: { type: "number", description: "Real dollars per month." },
        registrationDue: { type: "string", description: "ISO date registration is next due." },
        registrationAmount: { type: "number", description: "Real dollars per year." },
        maintenanceIntervalMiles: { type: "integer", description: "Real recurring maintenance interval, in miles, if there is one." },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const { id, ...fields } = args;
      const row = id ? await vehicles.updateVehicle(ctx.user.id, id, fields) : await vehicles.createVehicle(ctx.user.id, fields);
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: id ? "vehicle.update" : "vehicle.create",
        entityId: row.id,
        detail: { name: row.name },
      });
      return row;
    },
  },

  {
    name: "delete_vehicle",
    title: "Delete a real vehicle",
    description:
      "The capture-grammar entry point for 'remove the Tesla' / 'sold the Kia, take it off' -- Git #3182 replaces the Cars tab's own dedicated delete button with this. Removes the real vehicle row and its maintenance history entirely. `vehicle` matches by name (case-insensitive, prefix or substring -- same resolution as log_car_maintenance's own matching); call get_cars first if unsure of the exact name.",
    inputSchema: {
      type: "object",
      properties: { vehicle: { type: "string", description: "The vehicle's name, e.g. 'Kia' or 'Tesla Model 3'." } },
      required: ["vehicle"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const all = await vehicles.listVehicles(ctx.user.id);
      const needle = String(args.vehicle ?? "").trim().toLowerCase();
      const tiers = [
        all.filter((v) => v.name.toLowerCase() === needle),
        all.filter((v) => v.name.toLowerCase().startsWith(needle)),
        all.filter((v) => v.name.toLowerCase().includes(needle)),
      ];
      let match = null;
      for (const tier of tiers) {
        if (tier.length === 1) {
          match = tier[0];
          break;
        }
        if (tier.length > 1) {
          throw new Error(`"${args.vehicle}" matches ${tier.map((v) => v.name).join(", ")} -- say which one.`);
        }
      }
      if (!match) throw new Error(`There is no vehicle called "${args.vehicle}". Call get_cars to see real vehicle names.`);

      await vehicles.deleteVehicle(ctx.user.id, match.id);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "vehicle.delete", entityId: match.id, detail: { name: match.name } });
      return { id: match.id, name: match.name, deleted: true };
    },
  },

  // -- Wins (Git #3151) -------------------------------------------------------
  //
  // The design README's own tool list names this `log_win(text)`. It is the Claude-conversation
  // side of the Wins log: Shane says "I did it, ..." or "paid off ..." into the universal capture
  // box (Section 3's own capture grammar), Claude classifies it, and calls this rather than
  // create_entity because Wins is a fixed real category (its own table, migration 017), not an
  // open one. Automatic wins (a debt hitting $0, a critical debt resolved, a deferred bill caught
  // up) are detected server-side and never go through this tool.

  {
    name: "log_win",
    title: "Log a real win",
    description:
      "Record a real, hard-won milestone in the Wins log -- 'I did it, the mortgage is caught up', 'paid off the Chrysler Capital collection'. Deliberately NOT gamification: no streak, no badge, no percentage, just a real, dated line. Use this for anything Shane states as already having happened; do not invent or infer one.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The win, in Shane's own words, e.g. 'Tesla payment caught up after being 2 months behind.'" },
        happenedOn: { type: "string", description: "ISO date (YYYY-MM-DD) if Shane says this happened earlier, e.g. 'last Tuesday'. Defaults to today." },
      },
      required: ["text"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const win = await wins.createWin(ctx.user.id, { text: args.text, happenedOn: args.happenedOn ?? null, source: "claude" });
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "win.create",
        entityId: win.id,
        detail: { text: win.text },
      });
      return win;
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

  // -- things & contacts (Git #3156) -----------------------------------------
  //
  // README's own capture grammar: "X is in the garage" (item 9, requires a place word) -> Things;
  // "plumber is Ray 321-555-0142" (item 7) -> Who fixed what. Both are real database operations,
  // no live AI call, per contract Section 10.

  {
    name: "set_thing",
    title: "Save where something really is (hub/spoke item memory)",
    description:
      "The capture grammar's real entry point for 'the drill is in the garage' / 'X is in the garage' -- requires a real place word. Saying the same thing's location again CORRECTS it in place (upsert on name) rather than creating a duplicate -- no confirmation needed, per contract Section 8's 'trust stated facts immediately.' Pass house to place it at a specific hub/spoke (H1 / H2 / the rental / ...); omit it for a thing with just one place it lives.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "e.g. 'Drill', 'Passport'." },
        place: { type: "string", description: "e.g. 'under the sink', 'desk drawer'. Required -- a thing with no place answers nothing." },
        house: { type: "string", description: "The hub/spoke label, e.g. 'Home', 'Rental'. Optional." },
        note: { type: "string" },
      },
      required: ["name", "place"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = await things.recordThing(ctx.user.id, args);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "thing.record", entityId: row.id, detail: { name: row.name, place: row.place, house: row.house } });
      return row;
    },
  },

  {
    name: "find_thing",
    title: "Where's the...?",
    description:
      "The capture grammar's 'where's the drill?' answer -- a real, deterministic lookup (no AI guessing) over everything saved with set_thing. Returns the single best real match, or thing:null when genuinely nothing is on file, which is a real answer, not an error.",
    inputSchema: {
      type: "object",
      properties: { q: { type: "string", description: "What Shane asked for, e.g. 'drill', 'the passport'." } },
      required: ["q"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      return { thing: await things.findThing(ctx.user.id, args.q) };
    },
  },

  {
    name: "list_things",
    title: "Read everything on file (hub/spoke item memory)",
    description: "Every real thing Shane has ever said the location of, newest-said first. Pass house to see just what lives at one hub/spoke.",
    inputSchema: {
      type: "object",
      properties: { house: { type: "string" } },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      return { items: await things.listThings(ctx.user.id, { house: args.house }), houses: await things.listHouses(ctx.user.id) };
    },
  },

  {
    name: "set_contact",
    title: "Save a real 'who fixed what' entry",
    description:
      "The capture grammar's real entry point for 'plumber is Ray 321-555-0142' -- always files a NEW real history row (this is a growing log, not a single latest-state record per person), so the same plumber can show up twice for two different real jobs. did is the real 'what they actually fixed'; fixedOn is the real 'when' (the design's own field name -- stored as fixed_on because `when` is a reserved SQL word).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "e.g. 'Ray'." },
        phone: { type: "string", description: "e.g. '321-555-0142'." },
        did: { type: "string", description: "What they actually fixed, e.g. 'water heater'." },
        house: { type: "string", description: "Which hub/spoke this was at, if relevant." },
        fixedOn: { type: "string", description: "ISO date, if known." },
        trade: { type: "string", description: "e.g. 'plumber', 'electrician'." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = await contacts.recordContact(ctx.user.id, args);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "contact.record", entityId: row.id, detail: { name: row.name, trade: row.trade, did: row.did } });
      return row;
    },
  },

  {
    name: "list_contacts",
    title: "Read the real 'who fixed what' log",
    description: "Every real service-provider entry on file, newest first. Pass trade to filter (e.g. 'plumber') -- useful before asking Shane who the plumber was last time.",
    inputSchema: {
      type: "object",
      properties: { trade: { type: "string" } },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      return { items: await contacts.listContacts(ctx.user.id, { trade: args.trade }) };
    },
  },

  // Real physical places (Git #3159). No add-place form exists anywhere in this app (Section 3,
  // "no forms, anywhere, ever") -- this tool IS the only way a place gets created. The real
  // coordinates come from a geo-tagged capture (list_captures/get_capture return latitude/
  // longitude when the browser had permission and attached them) -- Shane says "remember this
  // as Home" while actually standing there, and this files it with those exact real numbers.
  // Do not invent or estimate coordinates -- if a capture has none, ask Shane to say it again
  // from his phone rather than guessing at where "Home" might be.
  {
    name: "push_place",
    title: "Save a real physical place",
    description:
      "File (or re-center) a real named place Shane can be physically at -- 'remember this as Home', 'this is the NASA badge office'. latitude/longitude MUST come from a real geo-tagged capture (list_captures/get_capture) -- never estimate or geocode an address yourself. Saying the same label again re-centers that place at the new real position rather than creating a duplicate. Call list_places first to avoid re-asking for one already on file.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Shane's own word for the place, e.g. 'Home', 'Walmart', 'NASA'." },
        latitude: { type: "number", description: "Real latitude from the geo-tagged capture this came from." },
        longitude: { type: "number", description: "Real longitude from the geo-tagged capture this came from." },
        radiusMeters: { type: "integer", description: "How close counts as 'there'. Default 150 -- widen for a large real site (e.g. a NASA campus), narrow for a single small building." },
        note: { type: "string", description: "What to surface when Shane is here, in his own words, e.g. 'grab the shopping list'." },
        house: { type: "string", description: "Only if this place IS one of Shane's own real houses (Git #3216), his own word for which one -- e.g. 'h1' for the owned house, 'h2' for the rental, matching how he already labels house bills/things. Omit for a place that isn't a house (Walmart, NASA) or to leave an existing tag alone." },
      },
      required: ["label", "latitude", "longitude"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = await places.upsertPlace(ctx.user.id, { ...args, createdBy: "claude" });
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "place.record", entityId: row.id, detail: { label: row.label } });
      return row;
    },
  },

  {
    name: "list_places",
    title: "Read every real saved place",
    description: "Every real place on file with its real coordinates and radius -- check here before push_place so 'remember this as Home' updates the existing Home rather than asking Shane to name it something else.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(args, ctx) {
      return { items: await places.listPlaces(ctx.user.id) };
    },
  },

  {
    name: "forget_place",
    title: "Forget a real saved place",
    description: "Delete a real place Shane no longer wants tracked, e.g. after moving out of the rental. Call list_places first to get the real id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "places.id, from list_places." } },
      required: ["id"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const row = await places.deletePlace(ctx.user.id, args.id);
      await record({ userId: ctx.user.id, actor: "mcp", actorLabel: ctx.label, action: "place.delete", entityId: row.id });
      return { ok: true };
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

  // -- People & Patterns (Git #3157, design contract Section 7) ---------------
  //
  // NOT a companion or chatbot persona -- a private journal capturing Shane's own words about
  // people in his life. "Threaded under the relevant person automatically based on who's
  // mentioned" is this pair of tools: read the inbox with list_captures, recognise who a pending
  // capture is genuinely about, then call log_person_note with that person's real name. The app
  // itself does no inference of its own (Section 10) -- the recognition happens here, in this
  // conversation; the tool only ever persists what you already decided.

  {
    name: "list_people",
    title: "List people on file",
    description:
      "Everyone Shane has a real journal thread for, with how many notes and when the last one landed. Check here before log_person_note so 'Mom' and 'Mother' don't become two different people -- names match case-insensitively, but only if they're spelled the same.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      return { items: await people.listPeople(ctx.user.id) };
    },
  },

  {
    name: "log_person_note",
    title: "File a real note about a person",
    description:
      "The real threading step for People & Patterns: after recognising a pending capture is a vent, a recap, or an observation about a specific person, file it here in Shane's own words -- never rewritten, never summarized. Creates the person on first mention (matches an existing one case-insensitively by name first). Tone boundary that matters here more than anywhere else in this app: this is a private mirror, not a companion -- do not add commentary, advice, or an opinion about the person; pass Shane's words through as written.",
    inputSchema: {
      type: "object",
      properties: {
        personName: { type: "string", description: "Who this is about, e.g. 'Dana'. Call list_people first to reuse an existing name exactly." },
        relationship: { type: "string", description: "Only on first mention of a genuinely new person, if stated, e.g. 'property manager'. Omit otherwise -- it never overwrites what's already on file." },
        text: { type: "string", description: "The note, in Shane's own words, unedited." },
        kind: { type: "string", description: "text (default) | voice | photo -- how the original capture arrived." },
        happenedAt: { type: "string", description: "ISO date/time if Shane says this happened earlier than now, e.g. 'after the call Tuesday'. Defaults to now." },
        captureId: { type: "string", description: "uuid of the capture this came from, if it came from the inbox. Marks that capture classified." },
      },
      required: ["personName", "text"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const { person, entry } = await people.addPersonEntry(ctx.user.id, {
        personName: args.personName,
        relationship: args.relationship ?? null,
        bodyText: args.text,
        kind: args.kind ?? "text",
        happenedAt: args.happenedAt ?? null,
        captureId: args.captureId ?? null,
        source: "claude",
      });
      await record({
        userId: ctx.user.id,
        actor: "mcp",
        actorLabel: ctx.label,
        action: "person.entry.create",
        entityId: entry.id,
        detail: { personId: person.id, personName: person.name },
      });
      return { person, entry };
    },
  },

  {
    name: "get_person_notes",
    title: "Read one person's real thread",
    description:
      "Every real note on file for one person, oldest fact first in the returned patterns (word/timing counts, quoted verbatim, no invented interpretation -- see the app's own patterns panel), notes newest-first. Use this when Shane asks something like 'how have things with Dana been' in conversation -- read the real notes and answer from them directly; do not add a diagnosis or advice framed as certainty (Section 7's own explicit boundary).",
    inputSchema: {
      type: "object",
      properties: { personName: { type: "string", description: "Exact name, e.g. 'Dana'. Case-insensitive." } },
      required: ["personName"],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const person = await people.findPersonByName(ctx.user.id, args.personName);
      if (!person) return { person: null, entries: [], patterns: [] };
      const entries = await people.listPersonEntries(ctx.user.id, person.id);
      return { person, entries, patterns: people.computePatterns(entries, person.name) };
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
