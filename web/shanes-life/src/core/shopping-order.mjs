// Flat / Category / Best-path ordering for a real shopping run (Git #3108).
//
// CAT_ORDER/CATS below are extracted verbatim (not authored fresh) from the real, already-wired
// logic in "Shanes Life - First Slice Prototype.dc.html" (`CAT_ORDER`, `CATS`, `catOf`) -- per
// CLAUDE.md's own rule for a Shell export's logic class, that prototype code is the real
// specification for Category grouping, not a fixture to invent from scratch.

export const CAT_ORDER = ["Produce", "Meat", "Snacks", "Bakery", "Pantry", "Frozen", "Dairy", "Other"];

const CATS = [
  ["Dairy", ["egg", "milk", "cheese", "butter", "yogurt", "cream", "parmesan"]],
  ["Meat", ["chicken", "beef", "lunch meat", "turkey", "pork", "fish", "sausage", "bacon", "ham", "pepperoni", "steak"]],
  ["Produce", ["banana", "potato", "apple", "onion", "tomato", "lettuce", "fruit", "orange", "grape", "berr", "spinach", "carrot", "avocado", "lemon", "lime"]],
  ["Frozen", ["frozen", "veg", "pizza", "ice cream"]],
  ["Snacks", ["chip", "snack", "cracker", "cookie", "pretzel", "popcorn"]],
  ["Bakery", ["bread", "tortilla", "bagel", "bun", "roll"]],
  ["Pantry", ["pasta", "sauce", "cereal", "mustard", "ketchup", "rice", "bean", "soup", "salsa", "oat", "granola", "coffee", "tea", "sugar", "flour", "salt", "pepper", "oil", "juice", "soda", "water", "noodle", "peanut", "jelly", "honey", "spice", "rosemary"]],
];

/** Same `catOf` as the prototype: first keyword match wins, "Other" when nothing fits. */
export function categoryOf(text) {
  const l = String(text || "").toLowerCase();
  for (const [cat, words] of CATS) {
    if (words.some((w) => l.includes(w))) return cat;
  }
  return "Other";
}

/**
 * Order a real list's items for one of the three real views the Shopping room offers.
 * `aisleFinder(item)` is injected (matchAisle bound to a store's map) rather than imported, so
 * this module stays a pure function of items + a lookup, easy to test without the database.
 *
 * - flat: unchanged (already position order from the query).
 * - category: grouped by grocery category, CAT_ORDER's fixed sequence, empty groups dropped.
 * - best: grouped by real aisle number ascending -- "the list re-sorts into walking order (by
 *   aisle number, then shelf notes) every trip after." Items with no known spot are returned
 *   separately as `unknown` -- "items without a spot sink to the end and ask once", never mixed
 *   into a numbered group.
 */
export function orderItems(items, mode, aisleFinder = () => null) {
  if (mode === "category") {
    const groups = CAT_ORDER.map((cat) => ({
      category: cat,
      items: items.filter((it) => categoryOf(it.text) === cat),
    })).filter((g) => g.items.length > 0);
    return { mode: "category", groups };
  }

  if (mode === "best") {
    const withSpot = [];
    const unknown = [];
    for (const it of items) {
      const spot = aisleFinder(it);
      if (spot) withSpot.push({ item: it, aisle: spot.aisle, note: spot.note });
      else unknown.push(it);
    }
    withSpot.sort((a, b) => a.aisle - b.aisle || String(a.note || "").localeCompare(String(b.note || "")));
    const byAisle = new Map();
    for (const { item, aisle, note } of withSpot) {
      if (!byAisle.has(aisle)) byAisle.set(aisle, []);
      byAisle.get(aisle).push({ ...item, aisle, aisleNote: note });
    }
    const groups = [...byAisle.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([aisle, groupItems]) => ({ aisle, items: groupItems }));
    return { mode: "best", groups, unknown };
  }

  return { mode: "flat", items };
}
