/**
 * portal-v2-sop-category.tsx — the four SOP category pages.
 *
 * Part 6 of PORTAL_V2_PARALLEL_PLAN.md. One component, mounted at four routes
 * under /portal-v2/sops (incident-response / security-drift / mail-flow /
 * device-mgmt), exactly as the prototype resolves all four `sopCategories` keys
 * through ONE branch.
 *
 * ── This is the design's own rendering, reproduced faithfully ──────────────
 * The prototype's `sopCategories` (shell 8789) have no dedicated markup: every
 * one of them falls through to the shell's generic placeholder
 * (`isGenericPlaceholder`, shell 6500-6507) — a centred frame icon, the category
 * label as the title, and the verbatim line "Pillar detail page not yet built —
 * coming next." That is all the design draws for these four, so that is what this
 * renders, per category. Copy is final and reproduced verbatim; nothing is
 * invented to fill the page out beyond what the design ships.
 */

import { Frame } from "lucide-react";
import { useRoute } from "wouter";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { sopCategoryBySlug } from "@/components/portal-v2/sopCategoryData";

export default function PortalV2SopCategoryPage() {
  const [, params] = useRoute("/portal-v2/sops/:category");
  const category = sopCategoryBySlug(params?.category);
  const label = category?.label ?? "SOPs & Runbooks";

  return (
    <PortalV2Shell eyebrow="Reference" title={label}>
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: 32,
        }}
        data-testid="pv2-sop-category"
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 6,
            background: "rgba(148,163,184,.06)",
            border: "1px solid rgba(148,163,184,.14)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#475569",
          }}
        >
          <Frame size={22} color="#475569" />
        </div>
        <div
          style={{ fontSize: "15px", fontWeight: 700, color: "#e2e8f0" }}
          data-testid="pv2-sop-category-label"
        >
          {label}
        </div>
        <div
          style={{
            fontSize: "13px",
            color: "#64748b",
            lineHeight: 1.4,
            maxWidth: 380,
            textAlign: "center",
          }}
        >
          Pillar detail page not yet built — coming next.
        </div>
      </div>
    </PortalV2Shell>
  );
}
