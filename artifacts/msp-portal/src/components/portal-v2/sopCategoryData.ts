/**
 * sopCategoryData.ts — the four SOP category pages, as data.
 *
 * Part 6 of PORTAL_V2_PARALLEL_PLAN.md. These are the prototype's `sopCategories`
 * (`Customer Portal Shell.dc.html` 8789): Incident Response, Security Drift,
 * Exchange/Mail Flow & Phishing, and Device Management.
 *
 * ── What the design actually ships for these four ──────────────────────────
 * In the prototype these keys are NOT full pages. They are indexed into the
 * command palette (shell 19117) and named as a page-title fallback (shell 19023),
 * but navigating to any of them lands on the shell's GENERIC placeholder branch
 * (`isGenericPlaceholder`, shell 6500-6507) — a centred frame icon, the category
 * label, and the line "Pillar detail page not yet built — coming next." There is
 * no richer category-page markup in the design to reproduce. `portal-v2-sop-
 * category.tsx` renders that placeholder faithfully per category, so the four are
 * real, linkable routes rather than dead keys. Labels are the design's verbatim.
 */

export interface SopCategory {
  /** The URL segment under /portal-v2/sops. */
  slug: string;
  /** The prototype's own `active` key (shell 8789). */
  key: string;
  /** The verbatim `activeLabel` the design shows as the page title. */
  label: string;
}

export const SOP_CATEGORIES: readonly SopCategory[] = [
  { slug: "incident-response", key: "sop-incident-response", label: "Incident Response" },
  { slug: "security-drift", key: "sop-security-drift", label: "Security Drift" },
  { slug: "mail-flow", key: "sop-mail-flow", label: "Exchange, Mail Flow & Phishing" },
  { slug: "device-mgmt", key: "sop-device-mgmt", label: "Device Management" },
];

export function sopCategoryBySlug(slug: string | undefined): SopCategory | undefined {
  return SOP_CATEGORIES.find((c) => c.slug === slug);
}
