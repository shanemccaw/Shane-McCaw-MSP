/**
 * document-types.ts
 *
 * Shared lookup for the document_types registry table — the admin-editable
 * replacement for the hardcoded REPORT_DOC_TYPE_LABELS / CONSULTING_TYPE_LABELS /
 * CONSULTING_SECTION_HINTS object literals that used to be duplicated across
 * document-generator.ts and admin-insights.ts.
 *
 * This is the TYPE REGISTRY only (key, label, category, section hints,
 * requiresSowHtml). The AI prompt CONTENT for each type is a separate,
 * already-DB-driven system (see prompt-loader.ts's getPrompt(), keyed
 * "insights-<category>-<key>") and is untouched by this module.
 */

import { db, documentTypesTable, type DocumentType } from "@workspace/db";
import { asc } from "drizzle-orm";
import { logger } from "./logger";
const log = logger.child({ channel: "system.core" });

/** In-process cache — document types change rarely and are read on every document generation. */
let cache: { rows: DocumentType[]; loadedAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

async function loadAll(): Promise<DocumentType[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await db.select().from(documentTypesTable).orderBy(asc(documentTypesTable.sortOrder));
    cache = { rows, loadedAt: Date.now() };
    return rows;
  } catch (err) {
    log.warn({ err }, "document-types: DB lookup failed");
    return cache?.rows ?? [];
  }
}

/** Invalidate the cache — call after any create/update/deactivate through the admin routes. */
export function invalidateDocumentTypeCache(): void {
  cache = null;
}

/** Fetch a single document type by key, active or not. Returns null if unknown. */
export async function getDocumentType(key: string): Promise<DocumentType | null> {
  const rows = await loadAll();
  return rows.find((r) => r.key === key) ?? null;
}

/** All document types, optionally filtered to a category, ordered by sortOrder. */
export async function listDocumentTypes(category?: "report" | "consulting"): Promise<DocumentType[]> {
  const rows = await loadAll();
  return category ? rows.filter((r) => r.category === category) : rows;
}

/** True if `key` is an active document type, optionally scoped to a category. */
export async function isActiveDocumentType(key: string, category?: "report" | "consulting"): Promise<boolean> {
  const row = await getDocumentType(key);
  return !!row && row.isActive && (!category || row.category === category);
}

/**
 * Label for `key`, falling back to the raw key when unknown — matches the
 * previous hardcoded objects' `LABELS[docType] ?? docType` behavior.
 */
export async function getDocumentTypeLabel(key: string): Promise<string> {
  const row = await getDocumentType(key);
  return row?.label ?? key;
}

/**
 * Section hints for `key`, falling back to a generic instruction when
 * unknown/null — matches the previous hardcoded objects'
 * `HINTS[docType] ?? "Include relevant sections..."` behavior.
 */
export async function getDocumentTypeSectionHints(key: string): Promise<string> {
  const row = await getDocumentType(key);
  return row?.sectionHints ?? "Include relevant sections for this type of consulting deliverable";
}

/** True when `key`'s prompt must be built from a real SOW document's HTML (e.g. task_execution_guide). */
export async function documentTypeRequiresSowHtml(key: string): Promise<boolean> {
  const row = await getDocumentType(key);
  return row?.requiresSowHtml ?? false;
}
