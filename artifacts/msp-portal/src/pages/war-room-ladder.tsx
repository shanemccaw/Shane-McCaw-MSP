import { useMemo } from "react";
import {
  WAR_ROOM_PILLAR_KEYS,
  type WarRoomPillarKey,
} from "@/components/war-room/warRoomScan";
import {
  warRoomPillarViews,
  warRoomPillarNote,
  warRoomUpgradeNote,
  WAR_ROOM_NO_DATA_COLOR,
  WAR_ROOM_SCANNING_COLOR,
  type WarRoomPillarView,
} from "@/components/war-room/warRoomPillarStats";
import { useWarRoomPillarStats } from "@/components/war-room/useWarRoomPillarStats";
import { useScanStatus } from "@/lib/scan-status-context";

/**
 * /war-room-ladder — the Readiness Ladder: a candidate replacement for the War
 * Room's radial diagram (epic #302).
 *
 * ── Why not the radar ────────────────────────────────────────────────────────
 * Measured on the running app rather than argued: stripping every competing
 * element off the page (persona strip, composer, speech bubble, host card, right
 * dock) grew the radar's disc from 798.8px to 801.3px — 2.5px. The chrome was
 * never the constraint. The real ones are structural to a radial form:
 *
 *   - It is square, so on any landscape screen it is bound by height. At
 *     1680x1050 that leaves 339px of width it can never use.
 *   - Its pillar badges and findings keys hang OUTSIDE the ring at r=931 of the
 *     viewBox's own 950 half-width, holding the disc to 76% of its box.
 *   - Every leaf label is suppressed in the mode the room uses
 *     (`chip = !embed || isFocus || isSel`), so none of the 35 signals is
 *     readable at any size.
 *   - Each spoke is its own axis, so two pillars are only comparable by eye and
 *     the enclosed area is a shape with no meaning.
 *
 * This form answers all four: rows on ONE shared 0-100 baseline, sorted
 * worst-first, growing into the width instead of fighting it, with every real
 * stat on screen carrying its own name.
 *
 * ── Honesty rules it inherits ────────────────────────────────────────────────
 * Same three states the rest of the epic settled on, and for the same reasons:
 * a real score, an honest "no data" (#331/#334) and a distinct "scanning" for a
 * pillar whose checks are still running (#340) — a pillar mid-scan must never
 * wear the "we looked and found nothing" treatment. The two dedicated colours
 * are imported from `warRoomPillarStats`, not re-picked here, so this surface
 * and the radar cannot drift on what those states look like.
 *
 * There is deliberately NO projected/"after remediation" value on this page. In
 * the room that number comes from the lever and staged-change state the briefing
 * owns; standing alone there is nothing real to project from, and a fabricated
 * delta is exactly the kind of number this epic has been removing.
 */

/** Pillar identity hues. Deliberately NOT the radar's set: run against the
 *  War Room's own #02060f surface, its Security violet (#8B5CF6) and Governance
 *  blue (#3B82F6) measure ΔE 1.3 under deuteranopia and 12.0 under normal
 *  vision — below the 15 floor, i.e. two adjacent slices that read as one
 *  colour. These seven clear every gate on that surface (worst adjacent pair
 *  ΔE 8.4 protan, 19.3 normal). They are identity chips only: the bars encode
 *  magnitude in a single hue, because colouring a bar by which pillar it is
 *  would spend the colour channel on what the row label already says. */
const PILLAR_HUE: Record<WarRoomPillarKey, string> = {
  governance: "#d95926",
  licensing: "#199e70",
  adoption: "#c98500",
  compliance: "#008300",
  health: "#9085e9",
  security: "#e66767",
  copilot: "#d55181",
};

const PILLAR_LABEL: Record<WarRoomPillarKey, string> = {
  governance: "Governance",
  licensing: "Licensing",
  adoption: "Adoption",
  compliance: "Compliance",
  health: "Health",
  security: "Security",
  copilot: "Copilot",
};

/** Where each pillar's numbers genuinely come from. Health is the odd one out
 *  and is labelled as such rather than being presented as tenant telemetry. */
const PILLAR_SOURCE: Record<WarRoomPillarKey, string> = {
  governance: "SharePoint Advanced Management · Entra",
  licensing: "Graph /subscribedSkus",
  adoption: "M365 Adoption Score · People",
  compliance: "Microsoft Purview",
  health: "PSA / RMM / backup — not Microsoft",
  security: "Secure Score · Entra · Intune",
  copilot: "Copilot Dashboard · Viva Insights",
};

const STAGE = "#02060f";
const INK = "#e8eef8";
const INK_2 = "#94a5bd";
const INK_3 = "#5d6e86";
const BAR = "#3987e5";
const GRID = "#141d2e";

type RowState = "scored" | "scanning" | "nodata";

interface Row {
  key: WarRoomPillarKey;
  view: WarRoomPillarView;
  state: RowState;
}

export default function WarRoomLadderPage() {
  const { payload } = useWarRoomPillarStats();
  const { data, scanCheckResults } = useScanStatus();

  const views = useMemo(
    () => warRoomPillarViews(WAR_ROOM_PILLAR_KEYS, payload),
    [payload],
  );

  // A run that is genuinely still active is what separates "scanning" from
  // "no data" — the #340 distinction. Without an active run, an absent score is
  // a finished scan that produced nothing, which is the honest NO DATA case.
  const scanActive = data?.active != null || scanCheckResults.length > 0;

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = WAR_ROOM_PILLAR_KEYS.map((key) => {
      const view = views[key] ?? null;
      const scored = view != null && view.score != null;
      return {
        key,
        view: view!,
        state: scored ? "scored" : scanActive ? "scanning" : "nodata",
      };
    });
    // Worst first — the order IS the story. Unscored pillars sort to the end so
    // an absent score never masquerades as the worst result on the board.
    return list.sort((a, b) => {
      const as = a.view?.score, bs = b.view?.score;
      if (as == null && bs == null) return 0;
      if (as == null) return 1;
      if (bs == null) return -1;
      return as - bs;
    });
  }, [views, scanActive]);

  const scored = rows.filter((r) => r.state === "scored");
  const overall =
    scored.length > 0
      ? Math.round(scored.reduce((a, r) => a + (r.view.score ?? 0), 0) / scored.length)
      : null;
  const findings = rows.reduce(
    (a, r) => a + (r.view?.findingCounts?.critical ?? 0) + (r.view?.findingCounts?.warning ?? 0),
    0,
  );

  return (
    <div
      data-ladder-page="true"
      style={{
        position: "fixed",
        inset: 0,
        background: STAGE,
        color: INK,
        fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
        overflow: "auto",
        padding: "26px 30px 34px",
      }}
    >
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>
        {/* ---- hero: the one number, then the counts that qualify it ---- */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 30,
            flexWrap: "wrap",
            paddingBottom: 18,
            borderBottom: "1px solid #172032",
          }}
        >
          <div>
            <Eyebrow>M365 Readiness</Eyebrow>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span style={{ fontSize: 58, fontWeight: 660, letterSpacing: "-.03em", lineHeight: 1 }}>
                {overall ?? "—"}
              </span>
              <span style={{ fontSize: 13, color: INK_2 }}>
                {overall == null
                  ? "no pillar has produced a real score yet"
                  : `mean of ${scored.length} scored pillar${scored.length === 1 ? "" : "s"}`}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 26, marginLeft: "auto" }}>
            <Stat label="Scored" value={`${scored.length} / ${rows.length}`} />
            <Stat label="Findings" value={String(findings)} />
            <Stat
              label={scanActive ? "Scanning" : "Awaiting data"}
              value={String(rows.filter((r) => r.state !== "scored").length)}
            />
          </div>
        </div>

        <Legend scanActive={scanActive} />

        {/* ---- shared axis: the thing a radar cannot have ---- */}
        <div style={{ display: "grid", gridTemplateColumns: "270px 1fr 480px", marginTop: 6 }}>
          <div />
          <div style={{ position: "relative", height: 16 }}>
            {[0, 25, 50, 75, 100].map((t) => (
              <span
                key={t}
                style={{
                  position: "absolute",
                  left: `${t}%`,
                  transform: "translateX(-50%)",
                  fontFamily: "ui-monospace, Menlo, monospace",
                  fontSize: 10,
                  color: INK_3,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {t}
              </span>
            ))}
          </div>
          <div />
        </div>

        {rows.map((r, i) => (
          <LadderRow key={r.key} row={r} first={i === 0} />
        ))}

        <p style={{ fontSize: 11.5, color: INK_3, marginTop: 22, maxWidth: "80ch", lineHeight: 1.6 }}>
          Every value here is the tenant's real engine score or a real stat callout. A pillar with no
          evaluable check shows its state, never a substitute number — and a pillar still being scanned is
          shown as such rather than as an empty result.
        </p>
      </div>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: 10.5,
        letterSpacing: ".15em",
        textTransform: "uppercase",
        color: INK_3,
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: "right" }}>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ fontSize: 21, fontWeight: 620, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function Legend({ scanActive }: { scanActive: boolean }) {
  const items: Array<[string, string]> = [
    [BAR, "Score today"],
    [WAR_ROOM_SCANNING_COLOR, scanActive ? "Scanning" : "Scan in progress"],
    [WAR_ROOM_NO_DATA_COLOR, "No data"],
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 18,
        flexWrap: "wrap",
        margin: "14px 0 2px",
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: 10.5,
        letterSpacing: ".1em",
        textTransform: "uppercase",
        color: INK_3,
      }}
    >
      {items.map(([c, l]) => (
        <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />
          {l}
        </span>
      ))}
    </div>
  );
}

function LadderRow({ row, first }: { row: Row; first: boolean }) {
  const { key, view, state } = row;
  const score = view?.score ?? null;
  const hue = PILLAR_HUE[key];
  const stateColor =
    state === "scanning" ? WAR_ROOM_SCANNING_COLOR : state === "nodata" ? WAR_ROOM_NO_DATA_COLOR : BAR;
  const upgradeNote = view ? warRoomUpgradeNote(view) : null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "270px 1fr 480px",
        alignItems: "center",
        padding: "10px 0",
        borderTop: first ? "none" : "1px solid #131c2c",
      }}
    >
      {/* name + provenance */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingRight: 16 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: hue, flex: "none" }} />
        <span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{PILLAR_LABEL[key]}</span>
          <br />
          <span
            style={{
              fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: 9.5,
              letterSpacing: ".07em",
              color: INK_3,
              textTransform: "uppercase",
            }}
          >
            {PILLAR_SOURCE[key]}
          </span>
        </span>
      </div>

      {/* the track — one shared 0-100 scale for every row */}
      <div style={{ position: "relative", height: 30 }}>
        {[25, 50, 75].map((g) => (
          <div
            key={g}
            style={{ position: "absolute", left: `${g}%`, top: 0, bottom: 0, width: 1, background: GRID }}
          />
        ))}

        {score != null ? (
          <>
            <div
              style={{
                position: "absolute",
                top: 11,
                left: 0,
                height: 8,
                width: `${score}%`,
                borderRadius: "0 4px 4px 0",
                background: BAR,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 6,
                left: `${score}%`,
                transform: "translateX(-100%)",
                paddingRight: 9,
                fontFamily: "ui-monospace, Menlo, monospace",
                fontSize: 13,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {score}
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                position: "absolute",
                top: 11,
                left: 0,
                right: 0,
                height: 8,
                borderRadius: 4,
                border: `1px dashed ${stateColor}55`,
                background: `repeating-linear-gradient(135deg, transparent, ${stateColor}22 2px, ${stateColor}22 3px, transparent 5px)`,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 5,
                left: 10,
                fontFamily: "ui-monospace, Menlo, monospace",
                fontSize: 10.5,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: stateColor,
              }}
            >
              {state === "scanning" ? "Scanning your tenant…" : "No data — no evaluable check fed this pillar"}
            </div>
          </>
        )}
      </div>

      {/* the pillar's real stat callouts, named */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2, paddingLeft: 18 }}>
        {view?.stats?.length ? (
          view.stats.slice(0, 4).map((s) => (
            <div
              key={s.l}
              title={`${s.l}: ${s.v}`}
              style={{
                background: "#0c1422",
                borderRadius: 4,
                padding: "5px 8px 6px",
                minHeight: 46,
                borderLeft: `3px solid ${hue}`,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              {/* Two lines, then clamp. A stat whose name is cut mid-word is the
                  problem this whole layout exists to fix, so it never ellipsises
                  on the first line the way a single-line label would. */}
              <span
                style={{
                  fontSize: 9.5,
                  lineHeight: 1.3,
                  color: INK_2,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {s.l}
              </span>
              <span
                style={{
                  fontFamily: "ui-monospace, Menlo, monospace",
                  fontSize: 11.5,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {s.v}
              </span>
            </div>
          ))
        ) : (
          <div
            style={{
              gridColumn: "1 / -1",
              minHeight: 40,
              display: "flex",
              alignItems: "center",
              fontSize: 11,
              color: INK_3,
            }}
          >
            {warRoomPillarNote(view, state === "scored")}
          </div>
        )}
      </div>

      {/* #489 — the pillar's licence gaps, and where its own admin would buy
          what would close them. Drawn OUTSIDE the stat grid and below the note,
          because it is neither a measurement nor a finding: it says why some of
          this card's checks have no number at all. Which SKU appears was
          decided tenant-wide (one gapped category → that add-on; all three →
          Microsoft 365 E7), so two cards on the same tenant can never recommend
          two different things. Rendered only when there is a real gap. */}
      {upgradeNote ? (
        <div
          style={{
            // Spans the row's three columns: it belongs to the whole pillar,
            // not to the stat grid it sits under.
            gridColumn: "1 / -1",
            marginLeft: 18,
            marginTop: 6,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            fontSize: 10.5,
            color: INK_2,
          }}
        >
          <span>{upgradeNote}</span>
          {view.upgrades.map((u) => (
            <a
              key={u.skuKey}
              href={u.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`${u.skuName} — opens Microsoft's own page in a new tab`}
              style={{
                color: hue,
                borderBottom: `1px solid ${hue}`,
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              {u.skuName}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
