import { Link, useLocation, useSearch } from "wouter";
import {
  PILLAR_KEYS,
  PILLARS,
  PILLAR_ICON_PATHS,
  SEVERITY_ON_DARK,
  severityForScore,
  type PillarKey,
} from "@workspace/copilot-scan-scene/journeyTokens";
import { comingSoonHref } from "./moduleNav";
import type { PillarShellScore } from "./usePillarSummary";

const NEVER_SCANNED_INK = "#475569";

function scoreLabel(entry: PillarShellScore): { text: string; ink: string } {
  if (!entry.scored || entry.score === null) {
    return { text: "—", ink: NEVER_SCANNED_INK };
  }
  return { text: String(entry.score), ink: SEVERITY_ON_DARK[severityForScore(entry.score)] };
}

/**
 * The six-pillar tab strip — the shell-level pillar switcher (#1823; frame
 * scaffolded by #1819, README "Layout" §3). Selecting a pillar routes to its
 * dashboard — none of the six pillar pages exist yet (that surface is #1621's
 * scope, not this issue's — see #1823's "boundary with #1621"), so every tab
 * currently routes through the same honest not-yet-built state the sidebar
 * uses (Git #1827's `/coming-soon`), tagged `group=pillar` so the shell can
 * keep the tab's selected state and the breadcrumb accurate.
 *
 * Design-token compliance confirmed against `docs/design-system.md` +
 * `Design/portal/design_handoff_ui_shell/{README.md,Shell.dc.html}` (#1823):
 * identity colours are fixed per pillar and never derived from score;
 * severity (score band) is the only thing driving `scoreLabel`'s colour;
 * a null/unscored score renders the em dash in `NEVER_SCANNED_INK`, never a
 * red zero; Copilot is excluded as a tab (`usePillarSummary.ts` drops the
 * `"copilot"` card — it's the roll-up, not a seventh pillar). The reference
 * `Shell.dc.html` renders this exact shape (band + icon + label + score, no
 * ambient glow) for its pillar tabs — the hand-tuned per-pillar glow table
 * belongs to the pillar *pages* (#1621), not this switcher.
 */
export function PillarTabStrip({
  scores,
}: {
  scores: Readonly<Record<PillarKey, PillarShellScore>>;
}) {
  const [location] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const activeKey =
    location === "/coming-soon" && params.get("group") === "pillar"
      ? PILLAR_KEYS.find((k) => PILLARS[k].label === params.get("feature"))
      : undefined;

  return (
    <div
      className="flex flex-none overflow-x-auto border-b"
      style={{ height: 64, borderColor: "rgba(255,255,255,.10)" }}
    >
      {PILLAR_KEYS.map((key) => {
        const identity = PILLARS[key];
        const active = activeKey === key;
        const entry = scores[key];
        const { text: scoreText, ink: scoreInk } = scoreLabel(entry);

        return (
          <Link
            key={key}
            href={comingSoonHref(identity.label, "pillar")}
            data-testid={`pillar-tab-${key}`}
            className="group flex min-w-0 flex-col border-r focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0078D4]"
            style={{ flex: "1 0 130px", borderColor: "rgba(255,255,255,.06)" }}
          >
            <div style={{ height: 3, background: `linear-gradient(90deg,${identity.primary},${identity.accent})` }} />
            <div
              className="flex flex-1 items-center gap-[9px] px-4 transition-colors group-hover:bg-white/[.04]"
              style={{ background: active ? "rgba(255,255,255,.05)" : "transparent" }}
            >
              <svg
                width={17}
                height={17}
                viewBox="0 0 24 24"
                fill="none"
                stroke={identity.primary}
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={PILLAR_ICON_PATHS[key]} />
              </svg>
              <span
                className="truncate text-[12.5px] font-semibold"
                style={{ color: active ? "#f8fafc" : "#cbd5e1" }}
              >
                {identity.label}
              </span>
              <span
                className="ml-auto text-[13px] font-bold"
                style={{ color: scoreInk, fontVariantNumeric: "tabular-nums" }}
              >
                {scoreText}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
