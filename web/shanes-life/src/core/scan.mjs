// Shopping barcode scan (Git #3109). "Real barcode scan (device camera) resolves to a real
// item + real price, added to the run" -- the camera + decode happens client-side (BarcodeDetector
// / a JS decoder, in public/app.js); this module is the server half: resolve a real scanned
// barcode to a real item and record a real price, per the design's own three-state grammar
// ("Shanes Life 04 - Shopping.dc.html", option 2a):
//
//   Exact  -- barcode already linked (barcode_links) -> straight to the price.
//   Near   -- new barcode, but Open Food Facts' real product name resembles an open item on
//             this run -> 2-3 candidate chips, one tap links the barcode to that item forever.
//   Unknown -- nothing like it -> "Add it to the list" or "It's one of these" (pick an open item).
//
// Never a silent failure: every scan resolves to one of the three states above, never a bare
// error screen -- an unrecognised/network-unreachable lookup still degrades to "unknown" with
// whatever real product name (or none) was actually available, not a fake one.

import { many, one, query, transaction } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";
import { getOwnedList, getListDetail } from "./lists.mjs";
import { getOffProduct } from "./nutrition.mjs";
import { recordPrice } from "./prices.mjs";

const STOPWORDS = new Set(["the", "and", "with", "for", "from", "your", "this", "that"]);

function normaliseBarcode(raw) {
  const barcode = String(raw || "").trim();
  if (!barcode || !/^[0-9]{6,14}$/.test(barcode)) {
    throw badRequest("barcode must be a 6-14 digit UPC/EAN");
  }
  return barcode;
}

function significantTokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/**
 * Score every open (undone) item on the list against a candidate product name by shared
 * significant word tokens, and return the top 2-3 real matches. This is deliberately a plain
 * token-overlap heuristic, not a fuzzy-string library dependency -- "resembles" per the design
 * copy, not an exact match (that's the Exact case, handled separately via barcode_links).
 */
function rankCandidates(openItems, productName) {
  const nameTokens = new Set(significantTokens(productName));
  if (nameTokens.size === 0) return [];
  const scored = openItems
    .map((item) => {
      const itemTokens = significantTokens(item.text);
      const shared = itemTokens.filter((t) => nameTokens.has(t)).length;
      return { item, shared };
    })
    .filter((s) => s.shared > 0)
    .sort((a, b) => b.shared - a.shared || a.item.text.length - b.item.text.length);
  return scored.slice(0, 3).map((s) => s.item);
}

/**
 * Resolve a scanned barcode against a real list into one of the three real match states. Never
 * throws for "didn't recognise the barcode" -- that's the unknown state, not an error.
 *
 * Also attaches real Open Food Facts enrichment (Git #3260) -- product image + per-100g
 * nutrition facts + "genuinely high" flags -- to whichever state is returned. Reads through the
 * shared, barcode-keyed cache (nutrition.getOffProduct), so this is one real network round-trip
 * per never-before-seen barcode, not one per scan. A real, honest fallback: OFF having nothing
 * for this barcode (or being unreachable) degrades to `offProduct.found === false` -- the
 * exact/near/unknown match states above are computed independently of OFF and are unaffected.
 */
export async function lookupBarcode(userId, listId, rawBarcode) {
  const list = await getOwnedList(userId, listId);
  if (!list) throw notFound("List not found");
  const barcode = normaliseBarcode(rawBarcode);

  const openItems = await many(
    `SELECT id, text FROM list_items WHERE list_id = $1 AND done = false ORDER BY position, created_at`,
    [listId],
  );

  const [link, offProduct] = await Promise.all([
    one(
      `SELECT barcode, item_text, last_price_cents, last_seen_at FROM barcode_links
        WHERE user_id = $1 AND barcode = $2`,
      [userId, barcode],
    ),
    getOffProduct(barcode),
  ]);
  const enrichment = { productImage: offProduct.imageUrl, brand: offProduct.brand, nutrition: offProduct.nutrition, nutritionFlags: offProduct.flags };

  if (link) {
    // Exact: a barcode seen before. Try to find the still-open item it maps to on THIS run --
    // if it already scrolled off (already checked off, or never added this trip) there is no
    // itemId to attach to and Save just adds it back, per "Not on the list? Add it".
    const matched = openItems.find((i) => i.text.trim().toLowerCase() === link.item_text.trim().toLowerCase()) || null;
    return {
      match: "exact",
      barcode,
      productName: link.item_text,
      lastPriceCents: link.last_price_cents,
      itemId: matched?.id ?? null,
      ...enrichment,
    };
  }

  const productName = offProduct.productName;
  const candidates = productName ? rankCandidates(openItems, productName) : [];

  if (candidates.length > 0) {
    return {
      match: "near",
      barcode,
      productName,
      candidates: candidates.map((c) => ({ id: c.id, text: c.text })),
      ...enrichment,
    };
  }

  return { match: "unknown", barcode, productName, ...enrichment };
}

/**
 * Save a scan's real price: link the barcode (so next time is Exact), stamp the price + source
 * onto the run item, and check it off -- "Saving also checks the item off" per the design copy.
 * Exactly one of itemId (link to an existing open item) or text (a brand-new item, "Not on the
 * list? Add it") is required.
 *
 * Also feeds the real per-store price history (Git #3112's `item_prices`/`stores`) -- filed as
 * Git #3122 because this write path (#3109) shipped before #3112's tables existed. The design's
 * own copy for this exact screen ("Shane only types the price") settles the product question the
 * finding raised: scan does NOT ask for a store of its own. It reuses the run's existing "Which
 * store?" field (#3108, `lists.store`) the Shopping screen already asks for above the list --
 * the same real answer Best-path ordering and aisle memory already key off. If that run has no
 * store set yet, the scalar write below still happens (unchanged, honest degrade) but there is
 * no store to attribute a history row to, so none is written -- same as #3112's own "Log price"
 * form, which also requires a store before it will record anything.
 */
export async function saveScan(userId, listId, { barcode: rawBarcode, itemId, text, priceCents }) {
  const list = await getOwnedList(userId, listId);
  if (!list) throw notFound("List not found");
  const barcode = normaliseBarcode(rawBarcode);

  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw badRequest("priceCents must be a non-negative integer (cents)");
  }
  if (!itemId && !String(text || "").trim()) {
    throw badRequest("itemId or text is required");
  }

  const resolvedItem = await transaction(async (client) => {
    let row;
    if (itemId) {
      const { rows } = await client.query(
        `SELECT id, text FROM list_items WHERE id = $1 AND list_id = $2`,
        [itemId, listId],
      );
      row = rows[0];
      if (!row) throw notFound("Item not found");
      const updated = await client.query(
        `UPDATE list_items
            SET price_cents = $3, price_source = 'scan', priced_at = now(),
                done = true, done_at = now()
          WHERE id = $1 AND list_id = $2
          RETURNING id, text, price_cents, done, done_at`,
        [itemId, listId, priceCents],
      );
      row = updated.rows[0];
    } else {
      const cleanText = String(text).trim().slice(0, 500);
      const { rows: posRows } = await client.query(
        "SELECT COALESCE(max(position), -1) AS max FROM list_items WHERE list_id = $1",
        [listId],
      );
      const position = Number(posRows[0].max) + 1;
      const inserted = await client.query(
        `INSERT INTO list_items (list_id, position, text, done, done_at, price_cents, price_source, priced_at)
         VALUES ($1, $2, $3, true, now(), $4, 'scan', now())
         RETURNING id, text, price_cents, done, done_at`,
        [listId, position, cleanText, priceCents],
      );
      row = inserted.rows[0];
    }

    await client.query("UPDATE lists SET updated_at = now() WHERE id = $1", [listId]);

    // "Every link is remembered per barcode, so each product asks at most once."
    await client.query(
      `INSERT INTO barcode_links (user_id, barcode, item_text, last_price_cents, last_seen_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, barcode) DO UPDATE
         SET item_text = EXCLUDED.item_text, last_price_cents = EXCLUDED.last_price_cents,
             last_seen_at = now(), updated_at = now()`,
      [userId, barcode, row.text, priceCents],
    );

    return row;
  });

  // The real per-store history write (Git #3122) -- outside the transaction above, same as
  // #3112's own POST /api/prices route calls recordPrice() standalone: item_prices/stores live
  // behind prices.mjs's own pool-level queries, not the `client` this transaction holds.
  if (list.store) {
    await recordPrice(userId, {
      storeName: list.store,
      itemText: resolvedItem.text,
      priceCents,
      source: "scan",
    });
  }

  return { item: resolvedItem, list: await getListDetail(userId, listId) };
}
