// The open category registry.
//
// Contract pack Section 3: "The underlying real data model needs to support Claude assigning a
// sensible new category on the fly, not just slotting things into a fixed enum." That is
// literally what ensureCategory does -- an unknown slug is not an error, it is a new row.
// Nothing in this file enumerates known categories, and nothing anywhere else may either.

import { many, one } from "../db.mjs";

export function slugify(input) {
  const slug = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug || "note";
}

function titleCase(slug) {
  return slug
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Look the category up, creating it if this is the first time anyone has used it.
 * Display metadata (label/icon/color/item noun) is only applied at creation time or to fill in
 * fields a caller previously left blank -- so a later call cannot silently rewrite what Shane
 * already sees for an established category.
 */
export async function ensureCategory(rawSlug, meta = {}, { createdBy = "claude" } = {}) {
  const slug = slugify(rawSlug);
  const existing = await one("SELECT * FROM categories WHERE slug = $1", [slug]);
  if (existing) {
    if (meta.description && !existing.description) {
      return one("UPDATE categories SET description = $2 WHERE slug = $1 RETURNING *", [
        slug,
        String(meta.description).slice(0, 500),
      ]);
    }
    return existing;
  }
  return one(
    `INSERT INTO categories (slug, label, item_noun, icon, color, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
     RETURNING *`,
    [
      slug,
      String(meta.label || titleCase(slug)).slice(0, 80),
      String(meta.itemNoun || "item").slice(0, 40),
      String(meta.icon || "sparkles").slice(0, 60),
      String(meta.color || "slate").slice(0, 24),
      meta.description ? String(meta.description).slice(0, 500) : null,
      createdBy,
    ],
  );
}

export async function bumpUse(slug) {
  await one("UPDATE categories SET use_count = use_count + 1 WHERE slug = $1 RETURNING slug", [
    slug,
  ]);
}

export async function listCategories() {
  return many(
    `SELECT c.slug, c.label, c.item_noun, c.icon, c.color, c.description, c.created_by,
            c.created_at, c.use_count,
            (SELECT count(*)::int FROM entities e
              WHERE e.category = c.slug AND e.archived_at IS NULL) AS entity_count
       FROM categories c
      ORDER BY c.use_count DESC, c.label ASC`,
  );
}
