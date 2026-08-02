/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 * Source: warroom/project/Canvas-2.dc.html (the topology centre-piece the War Room
 * embeds via <dc-import name="Canvas-2" embed>).
 *
 * NOTE: this is deliberately NOT the same component as
 * components/msp-portal/views/TopologyCenterPiece.tsx. That one uses a different
 * coordinate system (viewBox 0 0 2400 1500) and is consumed by MapView; this one is
 * the design's own 1900-unit "250 -220" canvas with the business-impact ring, the
 * scenario simulator and embed mode. They are kept separate so the Map view cannot
 * regress.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";
import { WAR_ROOM_NO_DATA_COLOR } from "../warRoomPillarStats";

/** Style props the design runtime lets an <dc-import> push onto its host wrapper. */
const HOST_STYLE_PROPS = new Set([
  "position", "left", "right", "top", "bottom", "inset", "width", "height", "zIndex", "transform",
]);

function hostPositionStyle(style) {
  if (!style || typeof style !== "object") return { display: "contents" };
  const out = {};
  for (const [k, val] of Object.entries(style)) {
    if (HOST_STYLE_PROPS.has(k)) out[k] = val;
  }
  return Object.keys(out).length ? out : { display: "contents" };
}

const PILLAR_SECTORS = [
  { group: "Security", colorHex: "#8B5CF6" },
  { group: "Governance", colorHex: "#3B82F6" },
  { group: "Licensing", colorHex: "#14B8A6" },
  { group: "Adoption", colorHex: "#F97316" },
  { group: "Copilot", colorHex: "#67E8F9" },
  { group: "Compliance", colorHex: "#F3F4F6" },
  { group: "Health", colorHex: "#22C55E" }
];

const ZONE_ICON = {
  Security: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  Governance: "M12 2l8 5H4l8-5zM6 11v7M10 11v7M14 11v7M18 11v7M2 22h20M2 11h20",
  Licensing: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  Adoption: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  Copilot: "M12 2l1.9 5.8a2 2 0 0 0 1.3 1.3L21 11l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 20l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 11l5.8-1.9a2 2 0 0 0 1.3-1.3L12 2z",
  Compliance: "M12 3v18M5 7l7-4 7 4M7 21h10M6 7l-3 8a3 3 0 0 0 6 0zM18 7l3 8a3 3 0 0 1-6 0z",
  Health: "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"
};

const HUB_ICON = {
  Security: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  Governance: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6",
  Licensing: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  Adoption: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87",
  Copilot: "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1",
  Compliance: "M12 3v18M5 7l7-4 7 4M4 21h16M6 7l-3 7a3 3 0 0 0 6 0zM18 7l3 7a3 3 0 0 1-6 0z",
  Health: "M22 12h-4l-3 9L9 3l-3 9H2"
};

// Registry — ids, coordinates, scores, statuses and cross-links from MapView.tsx
const REG = [
  ["hub-core", "Tenant Intelligence Core", "Health", 1200, 750, "healthy", 98, 0, [], "core"],

  ["hub-security", "Security Pillar", "Security", 1200, 450, "drift", 41, 3, ["hub-core"], "hub"],
  ["node-sec-mfa", "MFA Coverage", "Security", 1109, 177, "drift", 58, 0, ["hub-security"], "node"],
  ["node-sec-risks", "Risky Sign-ins", "Security", 1200, 290, "alert", 31, 2, ["hub-security"], "node"],
  ["node-sec-privdrift", "Privileged Role Drift", "Security", 1291, 177, "drift", 36, 1, ["hub-security"], "node"],
  ["node-sec-extaccess", "External Access Risk", "Security", 1348, 293, "alert", 28, 1, ["hub-security", "hub-gov"], "node"],
  ["node-sec-endpoint", "Endpoint Compliance", "Security", 1052, 293, "drift", 52, 0, ["hub-security"], "node"],

  ["hub-gov", "Governance Pillar", "Governance", 1435, 563, "drift", 39, 1, ["hub-core"], "hub"],
  ["node-gov-configdrift", "Configuration Drift", "Governance", 1464, 349, "alert", 33, 1, ["hub-gov"], "node"],
  ["node-gov-policy", "Policy Compliance", "Governance", 1591, 322, "drift", 46, 0, ["hub-gov"], "node"],
  ["node-gov-change", "Change Hygiene", "Governance", 1560, 463, "drift", 41, 0, ["hub-gov"], "node"],
  ["node-gov-baseline", "Baseline Integrity", "Governance", 1704, 464, "drift", 49, 0, ["hub-gov", "hub-security"], "node"],
  ["node-gov-sharing", "Sharing Governance", "Governance", 1649, 581, "alert", 24, 1, ["hub-gov"], "node"],

  ["hub-licensing", "Licensing Pillar", "Licensing", 1492, 817, "drift", 35, 0, ["hub-core"], "hub"],
  ["node-lic-util", "License Utilization", "Licensing", 1678, 707, "alert", 29, 0, ["hub-licensing"], "node"],
  ["node-lic-sku", "SKU Alignment", "Licensing", 1779, 789, "alert", 34, 0, ["hub-licensing"], "node"],
  ["node-lic-idle", "Idle Licenses", "Licensing", 1648, 852, "alert", 22, 1, ["hub-licensing"], "node"],
  ["node-lic-entitlement", "Feature Entitlement", "Licensing", 1738, 966, "drift", 48, 0, ["hub-licensing"], "node"],
  ["node-lic-compliance", "Compliance Issues", "Licensing", 1612, 996, "drift", 42, 0, ["hub-licensing"], "node"],

  ["hub-adoption", "Adoption Pillar", "Adoption", 1330, 1020, "drift", 54, 0, ["hub-core"], "hub"],
  ["node-adopt-usage", "Active Usage", "Adoption", 1532, 1097, "drift", 61, 0, ["hub-adoption"], "node"],
  ["node-adopt-workload", "Workload Coverage", "Adoption", 1530, 1227, "drift", 54, 0, ["hub-adoption"], "node"],
  ["node-adopt-collab", "Collaboration Depth", "Adoption", 1400, 1164, "drift", 57, 0, ["hub-adoption"], "node"],
  ["node-adopt-feat", "Feature Utilization", "Adoption", 1367, 1305, "drift", 44, 0, ["hub-adoption", "hub-licensing"], "node"],
  ["node-adopt-trend", "Adoption Trend", "Adoption", 1264, 1226, "drift", 52, 0, ["hub-adoption"], "node"],

  ["hub-copilot", "Copilot Pillar", "Copilot", 1070, 1020, "alert", 28, 0, ["hub-core"], "hub"],
  ["node-copilot-lic", "License Coverage", "Copilot", 1136, 1226, "alert", 18, 0, ["hub-copilot"], "node"],
  ["node-copilot-usage", "Active Usage", "Copilot", 1033, 1305, "drift", 61, 0, ["hub-copilot"], "node"],
  ["node-copilot-mix", "Feature Mix", "Copilot", 1000, 1164, "alert", 33, 0, ["hub-copilot"], "node"],
  ["node-copilot-prod", "Productivity Signals", "Copilot", 870, 1227, "drift", 39, 0, ["hub-copilot"], "node"],
  ["node-copilot-safety", "Safety & Governance", "Copilot", 868, 1097, "alert", 27, 1, ["hub-copilot"], "node"],

  ["hub-compliance", "Compliance Pillar", "Compliance", 908, 817, "drift", 45, 1, ["hub-core"], "hub"],
  ["node-comp-retention", "Retention Coverage", "Compliance", 788, 996, "drift", 51, 0, ["hub-compliance"], "node"],
  ["node-comp-labels", "Sensitivity Labels", "Compliance", 662, 966, "alert", 32, 1, ["hub-compliance", "hub-copilot"], "node"],
  ["node-comp-dlp", "DLP Enforcement", "Compliance", 752, 852, "drift", 38, 0, ["hub-compliance"], "node"],
  ["node-comp-regulatory", "Regulatory Alignment", "Compliance", 621, 789, "drift", 47, 0, ["hub-compliance"], "node"],
  ["node-comp-audit", "Audit Readiness", "Compliance", 722, 707, "drift", 56, 0, ["hub-compliance"], "node"],

  ["hub-health", "Health Pillar", "Health", 965, 563, "drift", 58, 0, ["hub-core"], "hub"],
  ["node-health-ticket", "Ticket Aging", "Health", 751, 581, "drift", 49, 0, ["hub-health"], "node"],
  ["node-health-auto", "Automation Success", "Health", 696, 464, "drift", 58, 0, ["hub-health", "hub-gov"], "node"],
  ["node-health-backup", "Backup/Restore Health", "Health", 840, 463, "healthy", 62, 0, ["hub-health"], "node"],
  ["node-health-sla", "SLA Compliance", "Health", 809, 322, "healthy", 66, 0, ["hub-health"], "node"],
  ["node-health-recurrence", "Incident Recurrence", "Health", 936, 349, "drift", 53, 0, ["hub-health"], "node"]
];

const NODES = REG.map(r => ({
  id: r[0], label: r[1], group: r[2], x: r[3], y: r[4],
  status: r[5], score: r[6], alerts: r[7], connectedTo: r[8],
  kind: r[9], colorHex: r[9] === "core" ? "#FFFFFF" : (PILLAR_SECTORS.find(p => p.group === r[2]) || {}).colorHex
}));

const BUSINESS_IMPACT_SEGMENTS = [
  { id: "risk", label: "Risk", start: -90 + 0.8, end: -18 - 0.8, w: [["Security", 0.5], ["Governance", 0.5]] },
  { id: "cost", label: "Cost", start: -18 + 0.8, end: 54 - 0.8, w: [["Licensing", 0.5], ["Adoption", 0.5]] },
  { id: "productivity", label: "Productivity", start: 54 + 0.8, end: 126 - 0.8, w: [["Adoption", 0.5], ["Copilot", 0.5]] },
  { id: "compliance", label: "Compliance", start: 126 + 0.8, end: 198 - 0.8, w: [["Compliance", 0.5], ["Security", 0.5]] },
  { id: "experience", label: "Experience", start: 198 + 0.8, end: 270 - 0.8, w: [["Health", 0.5], ["Adoption", 0.5]] }
];

(function alignSegmentsToPillars() {
  const SEG = 360 / PILLAR_SECTORS.length;
  const mid = (g) => -90 + PILLAR_SECTORS.findIndex(p => p.group === g) * SEG;
  const withMean = BUSINESS_IMPACT_SEGMENTS.map(s => {
    let sx = 0, sy = 0;
    s.w.forEach(p => { const a = mid(p[0]) * Math.PI / 180; sx += Math.cos(a) * p[1]; sy += Math.sin(a) * p[1]; });
    let m = Math.atan2(sy, sx) * 180 / Math.PI;
    if (m < -90) m += 360;
    return { s, mean: m, span: s.w.length };
  }).sort((a, b) => a.mean - b.mean);
  const totalSpan = withMean.reduce((a, x) => a + x.span, 0);
  let cursor = -90;
  withMean.forEach(x => {
    const width = (x.span / totalSpan) * 360;
    x.s.start = cursor + 0.8;
    x.s.end = cursor + width - 0.8;
    cursor += width;
  });
})();

const CX = 1200, CY = 750, VB_X = 250, VB_Y = -220, VB = 1900;

/* ── Business-impact ring geometry (#312) ───────────────────────────────────
 * The two thin rings encode severity as SIZE: a segment's inner radius is
 * fixed and its outer radius grows with impact, so a worse segment is a
 * visibly heavier band. That language was already in the ported design; the
 * numbers made it unreadable. `rOuter = rOut + (impact/100) * 12` against a
 * 34-unit band on a 700+ radius moved a segment by at most 12 units — under
 * 2% of the radius, and about a third of one band's own thickness — so five
 * segments with genuinely different severities all looked identical.
 *
 * Sizing it from what the eye can actually resolve rather than from the old
 * constant: a length difference reads reliably at roughly 20% relative
 * difference and comfortably at ~50%. Real per-pillar engine scores put the
 * five segments' impacts in a ~30-70 band, i.e. a spread of ~40 points, so
 * for that spread to clear 50% we need IMPACT_RADIUS_UNITS >= 1.25 x the
 * base thickness. The full 0-100 range then spans 16 -> 44 units, a 2.75x
 * thickness ratio between a healthy segment and a critical one.
 *
 * The envelope is fixed at both ends and is what caps these: the pillar
 * wedges end at r=670 and the outermost ring must stay near 770, because
 * the pillar badges (#313) hang off `seg.rOuter + 46` and the findings keys
 * off `+ 46 + 64`, and pushing those further out clips them. 672 + 2*(16+28)
 * + a 10-unit minimum separation lands the outer edge at 770 — the two rings
 * therefore cannot collide however bad the scan is, and the gap between them
 * closing as severity rises is a second, free reading of the same signal. */
const RING_BASE_THICKNESS = 16;
const IMPACT_RADIUS_UNITS = 28;
const SCAN_RING_INNER = 672;
const PROJ_RING_INNER = 726;

/**
 * Colour for a segment no real pillar score feeds — never a severity colour.
 * #334: shares `WAR_ROOM_NO_DATA_COLOR` with the Welcome screen's pillar
 * cards so both surfaces use the same "no data" language; previously this
 * was a plain neutral grey, faint enough (0.12 fill opacity) to read as
 * broken/unloaded rather than an honest, intentional absence.
 */
const NO_DATA_COLOR = WAR_ROOM_NO_DATA_COLOR;

/** Dash pattern that gives a no-data segment's outline a visibly distinct
 * texture (not just a colour) from the solid strokes real severity segments
 * draw — so it reads clearly even without relying on colour perception. */
const NO_DATA_DASH = "10 6";

/** Radius a pillar's spoke anchor sits at (see hubPos) — inside the r=670 pillar wedges. */
const HUB_ORBIT = 620;

class TopologyCanvasLogic extends React.Component<Record<string, unknown>, any> {
  state = { scores: null, scenario: "baseline", selectedNode: null, selectedSegment: null, fit: 0.55, zoom: 1, panX: 0, panY: 0, dragging: false };

  setZoom = (z) => {
    const nz = Math.max(1, Math.min(3.2, Number(z.toFixed(2))));
    this.setState(s => ({ zoom: nz, panX: nz === 1 ? 0 : s.panX, panY: nz === 1 ? 0 : s.panY }));
  };

  onDragStart = (e) => {
    if (this.state.zoom <= 1) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, px = this.state.panX, py = this.state.panY;
    this.setState({ dragging: true });
    const move = (ev) => this.setState({ panX: px + (ev.clientX - sx), panY: py + (ev.clientY - sy) });
    const up = () => {
      this.setState({ dragging: false });
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  baseScores() {
    const o = {};
    PILLAR_SECTORS.forEach(p => {
      const kids = NODES.filter(n => n.group === p.group && n.kind !== "core");
      o[p.group] = Math.round(kids.reduce((a, n) => a + n.score, 0) / kids.length);
    });
    return o;
  }

  componentDidMount() {
    this.setState({ scores: this.baseScores() }, () => {
      const p = this.props.scenario;
      if (p && p !== "baseline") this.applyScenario(p);
    });
  }

  componentDidUpdate(prev) {
    if (prev.scenario !== this.props.scenario && this.props.scenario) this.applyScenario(this.props.scenario);
  }

  componentWillUnmount() { if (this.ro) this.ro.disconnect(); }

  applyScenario = (name) => {
    const over = {
      breach: { Security: 20, Governance: 35, Compliance: 40 },
      waste: { Licensing: 25, Governance: 50 },
      stagnation: { Adoption: 30, Copilot: 25 },
      degraded: { Health: 35, Security: 45, Licensing: 40 },
      optimal: { Security: 98, Governance: 98, Licensing: 98, Adoption: 98, Copilot: 98, Compliance: 98, Health: 98 },
      baseline: {}
    }[name] || {};
    this.setState({ scores: Object.assign({}, this.baseScores(), over), scenario: name });
  };

  setBox = (el) => {
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    if (!el || !el.parentElement) return;
    const host = el.parentElement;
    const measure = () => {
      const w = host.offsetWidth;
      if (!w) return;
      const fit = Number((w / VB).toFixed(4));
      if (Math.abs(fit - this.state.fit) > 0.0005) this.setState({ fit });
    };
    if (typeof ResizeObserver !== "undefined") { this.ro = new ResizeObserver(measure); this.ro.observe(host); }
    measure();
  };

  px(v, axis) {
    const d = v - (axis === "x" ? VB_X : VB_Y);
    return d.toFixed(1) + "px";
  }

  // getPieSectorPath, verbatim maths from the source
  sector(cx, cy, rInner, rOuter, a0, a1) {
    const s = a0 * Math.PI / 180, e = a1 * Math.PI / 180;
    const x1 = cx + rOuter * Math.cos(s), y1 = cy + rOuter * Math.sin(s);
    const x2 = cx + rOuter * Math.cos(e), y2 = cy + rOuter * Math.sin(e);
    const x3 = cx + rInner * Math.cos(e), y3 = cy + rInner * Math.sin(e);
    const x4 = cx + rInner * Math.cos(s), y4 = cy + rInner * Math.sin(s);
    const large = Math.abs(a1 - a0) <= 180 ? 0 : 1;
    return "M " + x1 + " " + y1 + " A " + rOuter + " " + rOuter + " 0 " + large + " 1 " + x2 + " " + y2 +
      " L " + x3 + " " + y3 + " A " + rInner + " " + rInner + " 0 " + large + " 0 " + x4 + " " + y4 + " Z";
  }

  // scale a node's stored health by the pillar score set by the simulator
  nodeScore(n, scores) {
    const base = this.baseScores()[n.group] || 90;
    const target = scores[n.group];
    return Math.max(0, Math.min(100, Math.round(n.score * (target / base))));
  }

  /* A pillar's anchor point on its own spoke — the direction everything that hangs off a
   * pillar (the finding dots, the cross-pillar interference arcs) is laid out along.
   *
   * #324. The ported design's embed branch rotated that direction by 25.7 degrees and
   * pushed it out to r=1420, and both halves of that were wrong:
   *
   *   - 25.7 deg is 360/7/2, i.e. exactly HALF a pillar sector, so every pillar's spoke
   *     landed on the boundary it shares with its neighbour. Measured live: each anchor
   *     came out 22.6-24.4 deg off its own wedge's mid-angle, and half the finding dots
   *     read as belonging to the pillar next door.
   *   - r=1420 is more than double the r=686 disc and outside the 1900-unit viewBox's own
   *     950-unit half-extent, so three of every four finding dots rendered off the diagram
   *     and the interference arcs ran in from off-canvas — the dotted lines shooting
   *     diagonally across the whole diagram at angles matching no wedge.
   *
   * The direction is taken from the hub's own registry coordinates, whose angles already
   * agree exactly with PILLAR_SECTORS (Security -90, Governance -38.6, ... Health 218.6);
   * only the rotation and the radius were ever wrong. HUB_ORBIT is the design's own
   * non-embed target, which sits inside the r=670 pillar wedges, so an anchor and
   * everything laid out along it stay within the pillar they belong to. */
  hubPos(h) {
    const rx = h.x - CX, ry = h.y - CY;
    const r = Math.sqrt(rx * rx + ry * ry) || 1;
    return { x: CX + (rx / r) * HUB_ORBIT, y: CY + (ry / r) * HUB_ORBIT };
  }

  renderVals() {
    const st = this.state;
    const demoScores = st.scores || this.baseScores();
    // `baseline` carries the real engine's per-pillar scores (#312) and holds
    // `null` for a pillar it genuinely measured nothing for. Two views of it:
    //
    //   numeric  — nulls dropped back to the canvas's own demo score, so the
    //              wedges/hubs/nodes/core keep rendering something. Same
    //              behaviour these had before this change.
    //   measured — null-preserving, and the ONLY thing the impact rings read,
    //              because a ring is the one element whose colour and size are
    //              a claim about what the scan found.
    const numericOverlay = (src) => {
      if (!src) return null;
      const o = {};
      PILLAR_SECTORS.forEach(p => {
        const v = src[p.group];
        if (typeof v === "number" && isFinite(v)) o[p.group] = v;
      });
      return o;
    };
    const baseScores = Object.assign({}, demoScores, numericOverlay(this.props.baseline) || {});
    const proj = this.props.projected || null;
    const scores = proj ? Object.assign({}, baseScores, numericOverlay(proj) || {}) : baseScores;
    const ghosting = !!proj && PILLAR_SECTORS.some(p => proj[p.group] !== undefined && proj[p.group] !== baseScores[p.group]);
    const sel = st.selectedNode;

    const measuredBase = this.props.baseline || demoScores;
    const measuredProj = proj ? Object.assign({}, measuredBase, proj) : measuredBase;

    const band = (src, rIn, rOut) => BUSINESS_IMPACT_SEGMENTS.map(seg => {
      let sum = 0, total = 0;
      seg.w.forEach(p => {
        const v = src[p[0]];
        // A pillar with no real score is dropped from the weighting rather than
        // filled in — the segment reads on what was actually measured, and a
        // segment with nothing behind it says so instead of inventing severity.
        if (typeof v !== "number" || !isFinite(v)) return;
        sum += v * p[1]; total += p[1];
      });
      const measured = total > 0;
      const weighted = measured ? Math.round(sum / total) : 0;
      const impact = measured ? Math.max(0, Math.min(100, 100 - weighted)) : 0;
      const severity = !measured ? "nodata" : impact > 30 ? "critical" : impact > 15 ? "elevated" : "stable";
      const colorHex = severity === "nodata" ? NO_DATA_COLOR
        : severity === "critical" ? "#D13438" : severity === "elevated" ? "#D97706" : "#10B981";
      return {
        id: seg.id, label: seg.label, start: seg.start, end: seg.end,
        impact, measured, severity, colorHex,
        rInner: rIn, rOuter: rOut + Math.round((impact / 100) * IMPACT_RADIUS_UNITS),
        // #334: nodata's old 0.12/0.3 opacities were faint enough to read as
        // "nothing rendered" (broken) rather than an honest, intentional
        // absence — raised so the segment is clearly, deliberately present.
        fillOpacity: severity === "nodata" ? 0.22 : severity === "critical" ? 0.78 : severity === "elevated" ? 0.48 : 0.35,
        strokeOpacity: severity === "nodata" ? 0.55 : severity === "critical" ? 0.95 : severity === "elevated" ? 0.75 : 0.65,
        strokeDasharray: severity === "nodata" ? NO_DATA_DASH : "none"
      };
    });

    // inner thin ring = what the scan found; outer thin ring = where their answers take it
    const scanSegs = band(measuredBase, SCAN_RING_INNER, SCAN_RING_INNER + RING_BASE_THICKNESS);
    const projSegs = band(measuredProj, PROJ_RING_INNER, PROJ_RING_INNER + RING_BASE_THICKNESS);
    const segs = projSegs;
    const ghostSegs = [];

    const K = this.props.embed ? 1.15 : 1;

    const nodeById = {};
    NODES.forEach(n => { nodeById[n.id] = n; });

    const fnRaw = this.props.focusNode;
    const focusNodeObj = fnRaw ? NODES.find(n => n.id === fnRaw || n.label === fnRaw) : null;
    const activeGroup = this.props.focusPillar || (focusNodeObj ? focusNodeObj.group : null);
    const focus = { node: focusNodeObj, group: activeGroup };
    const dim = (group) => (activeGroup && group !== activeGroup ? "0.14" : "1");

    const links = [];
    const quiet = !!this.props.embed;
    if (!quiet) NODES.forEach(src => {
      src.connectedTo.forEach(tid => {
        const tgt = nodeById[tid];
        if (!tgt) return;
        const highlighted = sel === src.id || sel === tgt.id;
        const isCore = tgt.id === "hub-core" || src.id === "hub-core";
        const isCross = !isCore && src.kind !== "hub" && tgt.kind !== "hub";
        const heat = Math.max(0, Math.min(1, (100 - scores[src.group]) / 60));
        const base = highlighted ? "#38bdf8" : isCross ? "#a855f7" : isCore ? "#3b82f6" : src.colorHex;
        const stroke = heat > 0.15 && !highlighted ? "#D13438" : base;
        links.push({
          x1: String(src.x), y1: String(src.y), x2: String(tgt.x), y2: String(tgt.y),
          stroke,
          width: String((highlighted ? 3 : isCore ? 2.5 : isCross ? 1.8 : 1.4) + heat * 3),
          opacity: String(highlighted ? 0.9 : Math.min(0.95, (isCross ? 0.6 : 0.45) + heat * 0.5)),
          dash: isCross ? "4,6" : "none",
          particle: heat > 0.15 ? "#f87171" : isCross ? "#c084fc" : isCore ? "#60a5fa" : "#38bdf8",
          flowWidth: String(isCore ? 2.2 : 1.5),
          flowDash: isCore ? "8,12" : "6,10",
          flowDur: (isCore ? 1.8 - heat * 0.9 : 2.4 - heat * 1.2).toFixed(2) + "s",
          pulseDur: (isCore ? 1.8 : 2.2).toFixed(1) + "s",
          dim: isCore ? (activeGroup ? "0.35" : "1") : dim(src.group),
          dot: String(isCore ? 5 : 3.2),
          path: "M " + src.x + " " + src.y + " L " + tgt.x + " " + tgt.y
        });
      });
    });

    const sectorAngle = 360 / 7;

    return {
      chrome: this.props.embed
        ? { show: false, minH: "0", pad: "0", bg: "transparent", maxW: "100%", radius: "0", border: "none", cardBg: "transparent" }
        : { show: true, minH: "100vh", pad: "18px 22px", bg: "#020617", maxW: "1280px", radius: "20px", border: "1px solid rgba(30,41,59,.9)", cardBg: "#070D1C" },
      focusLink: focus.node ? {
        x1: String(CX), y1: String(CY), x2: String(focus.node.x), y2: String(focus.node.y),
        color: focus.node.colorHex,
        path: "M " + CX + " " + CY + " L " + focus.node.x + " " + focus.node.y
      } : null,
      blastRings: (this.props.blast && focusNodeObj) ? [0, 1, 2].map(i => {
        const tone = this.props.outcome === "good" ? "#10B981" : "#D13438";
        return {
          x: this.px(focusNodeObj.x, "x"), y: this.px(focusNodeObj.y, "y"),
          size: (2 * (230 + i * 250)) + "px", color: tone, glow: tone + "66",
          opacity: String(0.8 - i * 0.2), delay: (i * 160) + "ms"
        };
      }) : [],

      blastTags: (() => {
        const data = this.props.blastData;
        if (!this.props.blast || !focusNodeObj || !data || !data.length) return [];
        const tone = this.props.outcome === "good" ? "#10B981" : "#D13438";
        const base = Math.atan2(focusNodeObj.y - CY, focusNodeObj.x - CX);
        return data.slice(0, 3).map((d, i) => {
          const r = 230 + i * 250, a = base + [0, -0.44, 0.44][i];
          return {
            value: d[0], label: d[1], color: tone, glow: tone + "55",
            gap: 7 * K + "px", pad: (5 * K) + "px " + (11 * K) + "px", radius: 10 * K + "px",
            valueSize: 15 * K + "px", labelSize: 10.5 * K + "px", delay: (220 + i * 160) + "ms",
            x: this.px(focusNodeObj.x + r * Math.cos(a), "x"),
            y: this.px(focusNodeObj.y + r * Math.sin(a), "y")
          };
        });
      })(),
      hubShowName: !(this.props.embed && st.fit * 1900 < 360),
      setBox: this.setBox,
      fit: String(st.fit),
      overlayScale: String(st.fit),
      hubGap: 6 * K + "px", hubPad: (5 * K) + "px " + (9 * K) + "px",
      hubIcon: 22 * K + "px", hubGlyph: 13 * K + "px",
      hubType: 12 * K + "px", hubSub: 9 * K + "px",
      coreSize: 160 * K + "px", coreValue: 40 * K + "px",
      coreWasValue: Math.round(parseFloat(String(this.state.fit ? 1 : 1)) * 0 + Math.max(18, Math.min(64, 26 / (this.state.fit || 0.45)) * 0.62)) + "px",
      coreLabel: 9 * K + "px", coreTag: 8 * K + "px", showSignals: K < 1.6,
      zoneType: 10 * K + "px",
      ringW: 170 * K + "px", ringH: 32 * K + "px",
      ringType: 11 * K + "px", ringSub: 9 * K + "px",
      zoom: String(st.zoom),
      pan: { x: st.panX + "px", y: st.panY + "px" },
      zoomTransition: st.dragging ? "none" : "transform 260ms cubic-bezier(.22,1,.36,1)",
      dragCursor: st.zoom > 1 ? (st.dragging ? "grabbing" : "grab") : "default",
      onDragStart: this.onDragStart,
      zoomBtns: [
        { label: "+", onClick: () => this.setZoom(this.state.zoom + 0.4) },
        { label: "\u2212", onClick: () => this.setZoom(this.state.zoom - 0.4) },
        { label: "\u2302", onClick: () => this.setState({ zoom: 1, panX: 0, panY: 0 }) }
      ],

      scenarios: [["baseline", "Baseline"], ["breach", "Breach"], ["waste", "License waste"], ["stagnation", "Stagnation"], ["degraded", "Degraded"], ["optimal", "Optimal"]].map(p => ({
        label: p[1],
        color: st.scenario === p[0] ? "#e0f2fe" : "#94a3b8",
        border: st.scenario === p[0] ? "rgba(103,232,249,.6)" : "rgba(51,65,85,.85)",
        bg: st.scenario === p[0] ? "rgba(139,92,246,.18)" : "rgba(8,15,30,.6)",
        onClick: () => this.applyScenario(p[0])
      })),

      core: (() => {
        const overall = Math.round(PILLAR_SECTORS.reduce((a, p) => a + scores[p.group], 0) / PILLAR_SECTORS.length);
        const wasVal = Math.round(PILLAR_SECTORS.reduce((a, p) => a + baseScores[p.group], 0) / PILLAR_SECTORS.length);
        const c = overall >= 85 ? "#10B981" : overall >= 60 ? "#D97706" : "#D13438";
        return {
          was: String(wasVal), showWas: ghosting && wasVal !== overall,
          plain: !(ghosting && wasVal !== overall),
          anim: ghosting && wasVal !== overall ? "tcCorePulse 2.4s ease-in-out infinite" : "none",
          x: this.px(CX, "x"), y: this.px(CY, "y"),
          score: String(overall), color: c, ring: c + "99", bg: c + "1f", glow: c + "40",
          band: overall >= 85 ? "HEALTHY" : overall >= 60 ? "AT RISK" : "CRITICAL",
          onClick: () => this.setState({ selectedNode: "hub-core" })
        };
      })(),

      zones: PILLAR_SECTORS.map((s, i) => {
        const mid = -90 + i * sectorAngle;
        const rad = mid * Math.PI / 180;
        const bx = CX + 410 * Math.cos(rad), by = CY + 410 * Math.sin(rad);
        const scale = 6.8, off = -12 * scale;
        return {
          color: s.colorHex,
          opacity: dim(s.group),
          path: this.sector(CX, CY, 160, 670, mid - sectorAngle / 2 + 0.6, mid + sectorAngle / 2 - 0.6),
          icon: ZONE_ICON[s.group],
          iconTransform: "translate(" + (bx + off).toFixed(1) + ", " + (by + off).toFixed(1) + ") scale(" + scale + ")"
        };
      }),

      zoneTags: ([]).map((s, i) => {
        const rad = (-90 + i * sectorAngle) * Math.PI / 180;
        return {
          label: s.group.toUpperCase() + " ZONE",
          color: s.colorHex, border: s.colorHex + "cc", opacity: dim(s.group),
          x: this.px(CX + 640 * Math.cos(rad), "x"), y: this.px(CY + 640 * Math.sin(rad), "y")
        };
      }),

      ghosting: ghosting,
      ghostSegments: ghostSegs,
      ghostZones: ghosting ? PILLAR_SECTORS.map((s, i) => {
        const mid = -90 + i * (360 / 7);
        const base = baseScores[s.group], now = scores[s.group];
        const r = 160 + (670 - 160) * Math.max(0.12, Math.min(1, base / 100));
        return {
          color: base < 35 ? "#D13438" : base < 62 ? "#D97706" : "#10B981",
          path: this.sector(CX, CY, 160, r, mid - (360 / 7) / 2 + 0.6, mid + (360 / 7) / 2 - 0.6),
          show: now !== base
        };
      }).filter(z => z.show) : [],
      projZones: ghosting ? PILLAR_SECTORS.map((s, i) => {
        const mid = -90 + i * (360 / 7);
        const now = scores[s.group];
        const r = 160 + (670 - 160) * Math.max(0.12, Math.min(1, now / 100));
        return {
          color: now >= 85 ? "#10B981" : now >= 60 ? "#D97706" : "#D13438",
          path: this.sector(CX, CY, 160, r, mid - (360 / 7) / 2 + 0.6, mid + (360 / 7) / 2 - 0.6),
          show: now !== baseScores[s.group]
        };
      }).filter(z => z.show) : [],

      scanSegments: scanSegs.map(seg => ({
        path: this.sector(CX, CY, seg.rInner, seg.rOuter, seg.start, seg.end),
        color: seg.colorHex,
        fillOpacity: String(seg.fillOpacity * 0.85),
        strokeOpacity: String(seg.strokeOpacity),
        strokeDasharray: seg.strokeDasharray
      })),

      segments: projSegs.map((seg, i) => {
        const moved = ghosting && scanSegs[i].impact !== seg.impact;
        return {
          id: seg.id,
          path: this.sector(CX, CY, seg.rInner, seg.rOuter, seg.start, seg.end),
          edgePath: seg.severity === "stable" || seg.severity === "nodata" || !moved ? "" : this.sector(CX, CY, seg.rOuter - 4, seg.rOuter, seg.start, seg.end),
          edgeAnim: seg.severity === "stable" || seg.severity === "nodata" || !moved ? "none" : "tcPulse 2s ease-in-out infinite",
          color: seg.colorHex,
          stroke: st.selectedSegment === seg.id ? "#FFFFFF" : seg.colorHex,
          strokeWidth: st.selectedSegment === seg.id ? "4" : moved ? "3" : "2",
          fillOpacity: String(st.selectedSegment === seg.id ? 0.9 : seg.fillOpacity),
          strokeOpacity: String(st.selectedSegment === seg.id ? 1 : seg.strokeOpacity),
          strokeDasharray: seg.strokeDasharray,
          filter: this.props.embed ? "none" : (moved && seg.severity === "critical" ? "url(#fluent-glow-red)" : moved && seg.severity === "elevated" ? "url(#fluent-glow-amber)" : "none"),
          onClick: () => this.setState({ selectedSegment: seg.id })
        };
      }),

      ringLabels: (this.props.embed ? [] : segs).map(seg => {
        const mid = (seg.start + seg.end) / 2, rad = mid * Math.PI / 180, r = seg.rOuter + 46;
        return {
          // "—" rather than "0" when nothing real feeds this segment: a 0% impact
          // reading is a claim of perfect health, not an absence of measurement.
          label: seg.label.toUpperCase(), impact: seg.measured ? String(seg.impact) : "—", color: seg.colorHex,
          border: st.selectedSegment === seg.id ? "#FFFFFF" : seg.colorHex,
          borderWidth: st.selectedSegment === seg.id ? "3px" : "2px",
          x: this.px(CX + r * Math.cos(rad), "x"), y: this.px(CY + r * Math.sin(rad), "y"),
          onClick: () => this.setState({ selectedSegment: seg.id })
        };
      }),

      hubs: NODES.filter(n => n.kind === "hub").map(h => {
        const score = this.nodeScore(h, scores);
        const wasScore = this.nodeScore(h, baseScores);
        const status = score < 35 ? "alert" : score < 62 ? "drift" : "healthy";
        // outer-edge label position, reusing ringLabels' formula against the business-impact
        // segment that spans this pillar's own angle (see #313). This is the chip's own
        // position and is independent of hubPos(), which anchors what hangs off the pillar
        // (findings, cross-pillar arcs) on the same angle but inside the wedges (#324).
        const hubIdx = PILLAR_SECTORS.findIndex(p => p.group === h.group);
        const hubMid = -90 + hubIdx * sectorAngle;
        const hubRad = hubMid * Math.PI / 180;
        const hubSeg = segs.find(s => hubMid >= s.start - 1 && hubMid < s.end + 1) || segs[0];
        const hubR = hubSeg.rOuter + 46;
        const hubOuterPos = { x: CX + hubR * Math.cos(hubRad), y: CY + hubR * Math.sin(hubRad) };
        return {
          was: String(wasScore), showWas: ghosting && wasScore !== score,
          label: this.props.embed ? h.group : h.label,
          showName: this.props.embed ? activeGroup === h.group : true,
          sub: this.props.embed ? "" : (h.alerts > 0 ? h.group + " Pillar · " + h.alerts + " Alerts" : h.group + " Pillar"),
          subColor: h.alerts > 0 ? "#f87171" : "#64748b",
          icon: HUB_ICON[h.group], color: h.colorHex, chipBg: h.colorHex + "33", chipInk: h.colorHex, chipBorder: h.colorHex + "88",
          score: (() => {
            const b = (this.props.pillarBadges || {})[h.group];
            return b ? String(b.v) : String(score);
          })(),
          x: this.px(hubOuterPos.x, "x"), y: this.px(hubOuterPos.y, "y"),
          opacity: dim(h.group),
          border: activeGroup === h.group ? "#ffffff" : h.colorHex,
          bg: status === "alert" ? "rgba(69,10,10,.85)" : status === "drift" ? "rgba(69,42,4,.85)" : "rgba(15,23,42,.92)",
          glow: status === "alert" ? "0 0 30px rgba(239,68,68,.45)" : status === "drift" ? "0 0 24px rgba(245,158,11,.35)" : "0 0 20px " + h.colorHex + "33",
          anim: status === "alert" ? "tcPulse 2.2s ease-in-out infinite" : "none",
          onClick: () => {
            const cb = this.props.onPillar;
            if (typeof cb === "function") { cb(h.group); return; }
            this.setState({ selectedNode: h.id });
          }
        };
      }),

      nodes: (this.props.embed ? [] : NODES.filter(n => n.kind === "node")).map(n => {
        const score = this.nodeScore(n, scores);
        const status = score < 50 ? "alert" : score < 80 ? "drift" : "healthy";
        const isSel = sel === n.id;
        const isFocus = focusNodeObj && focusNodeObj.id === n.id;
        const embed = !!this.props.embed;
        return {
          label: n.label,
          opacity: dim(n.group),
          showLabel: embed ? !!isFocus : true,
          labelSize: (embed ? Math.round(12 * K) : 11) + "px",
          dotSize: (isFocus ? 10 : embed ? 5 : 7) + "px",
          x: this.px(n.x, "x"), y: this.px(n.y, "y"),
          dot: n.colorHex,
          scale: isFocus ? "1.35" : isSel ? "1.1" : "1",
          border: isFocus ? "#ffffff" : isSel ? "#60a5fa" : status === "alert" ? "rgba(239,68,68,.8)" : status === "drift" ? "rgba(245,158,11,.8)" : "rgba(30,41,59,.9)",
          bg: isSel ? "rgba(30,58,138,.8)" : status === "alert" ? "rgba(69,10,10,.7)" : status === "drift" ? "rgba(69,42,4,.7)" : "rgba(15,23,42,.8)",
          text: isSel ? "#ffffff" : status === "alert" ? "#fecaca" : status === "drift" ? "#fde68a" : "#e2e8f0",
          glow: isFocus ? "0 0 22px " + n.colorHex : isSel ? "0 0 0 3px rgba(96,165,250,.5)" : "none",
          anim: this.props.sweep === "fast"
            ? "tcPop 500ms cubic-bezier(.22,1,.36,1) both " + (((Math.atan2(n.y - CY, n.x - CX) * 180 / Math.PI + 450) % 360) / 360 * 2.2).toFixed(2) + "s"
            : "none",
          onClick: () => this.setState({ selectedNode: n.id })
        };
      }),

      pillarKeys: (() => {
        if (!(this.props.findings || []).length) return [];
        return NODES.filter(n => n.kind === "hub").map(h => {
          // outer-edge position, same pillar-angle + segment lookup as hubs above (#313
          // follow-up) -- pushed a bit further out so it doesn't sit directly on top of
          // the hub chip it's paired with.
          const pkIdx = PILLAR_SECTORS.findIndex(p => p.group === h.group);
          const pkMid = -90 + pkIdx * sectorAngle;
          const pkRad = pkMid * Math.PI / 180;
          const pkSeg = segs.find(s => pkMid >= s.start - 1 && pkMid < s.end + 1) || segs[0];
          const pkR = pkSeg.rOuter + 46 + 64;
          const sc = Math.round(scores[h.group] || 0);
          return {
            label: h.group, color: h.colorHex,
            score: String(sc),
            scoreColor: sc >= 82 ? "#34d399" : sc >= 51 ? "#fbbf24" : "#f87171",
            opacity: activeGroup && activeGroup !== h.group ? "0.2" : "1",
            size: Math.round(10 / Math.max(this.state.fit, 0.28)) + "px",
            sub: Math.round(10.5 / Math.max(this.state.fit, 0.28)) + "px",
            x: this.px(CX + pkR * Math.cos(pkRad), "x"), y: this.px(CY + pkR * Math.sin(pkRad), "y")
          };
        });
      })(),

      findings: (() => {
        const list = this.props.findings || [];
        if (!list.length) return [];
        const hubDir = {};
        NODES.filter(n => n.kind === "hub").forEach(h => {
          const p = this.hubPos(h);
          const dx = p.x - CX, dy = p.y - CY, r = Math.sqrt(dx * dx + dy * dy) || 1;
          hubDir[h.group] = { ux: dx / r, uy: dy / r, r: r, color: h.colorHex };
        });
        const byGroup = {};
        list.forEach(x => { (byGroup[x.group] = byGroup[x.group] || []).push(x); });
        const out = [];
        Object.keys(byGroup).forEach(g => {
          const d = hubDir[g];
          if (!d) return;
          // the wedge only has room for two at rest; opening a pillar reveals the rest
          const open = activeGroup === g;
          const items = byGroup[g];
          items.forEach((x, i) => {
            const span = Math.max(1, items.length - 1);
            const t = 0.40 + (i / span) * 0.5;
            const rad = d.r * t;
            const perp = (i % 2 === 0 ? -1 : 1) * (open ? 46 : 30);
            const px = CX + d.ux * rad - d.uy * perp;
            const py = CY + d.uy * rad + d.ux * perp;
            const sev = x.sev || "alert";
            const tone = sev === "alert" ? "#f87171" : sev === "drift" ? "#fbbf24" : "#34d399";
            const on = this.state.selectedNode === x.id;
            const active = activeGroup && activeGroup !== g;
            out.push({
              id: x.id, label: x.short || x.t, metric: x.m || "",
              x: this.px(px, "x"), y: this.px(py, "y"),
              tone: tone, color: d.color, open: open, n: String(i + 1),
              title: x.short || x.t,
              gap: open ? "7px" : "0px",
              pad: open ? "5px 11px 5px 5px" : "3px",
              bw: open ? "1.5px" : "1px",
              dot: Math.round(Math.min(19, Math.max(15, 17 / Math.max(this.state.fit, 0.05)))) + "px",
              num: Math.round(Math.min(11, Math.max(9, 10 / Math.max(this.state.fit, 0.05)))) + "px",
              w: Math.round(Math.min(112, Math.max(78, 96 / Math.max(this.state.fit, 0.05)))) + "px",
              opacity: active ? "0.15" : "1",
              scale: on ? "1.08" : "1",
              border: on ? "#ffffff" : tone + "99",
              bg: on ? "rgba(15,23,42,.98)" : "rgba(7,13,28,.92)",
              glow: on ? "0 0 26px " + tone : "0 0 14px rgba(2,6,23,.8)",
              size: Math.round(Math.min(10, Math.max(8, 9 / Math.max(this.state.fit, 0.05)))) + "px",
              sub: Math.round(Math.min(9, Math.max(7, 7.5 / Math.max(this.state.fit, 0.05)))) + "px",
              onClick: () => {
                this.setState({ selectedNode: x.id });
                if (this.props.onFinding) this.props.onFinding(x.id);
              }
            });
          });
        });
        return out;
      })(),

      sweep: (() => {
        const sw = this.props.sweep;
        if (!sw) return null;
        const R = 690, span = 46 * Math.PI / 180;
        const x1 = CX + R, y1 = CY;
        const x2 = CX + R * Math.cos(-span), y2 = CY + R * Math.sin(-span);
        return {
          dur: (sw === "fast" ? 2.4 : 7) + "s",
          path: "M " + CX + " " + CY + " L " + x2.toFixed(1) + " " + y2.toFixed(1) + " A " + R + " " + R + " 0 0 1 " + x1.toFixed(1) + " " + y1.toFixed(1) + " Z",
          tipX: String(x1), tipY: String(y1)
        };
      })(),

      pins: (this.props.pins || []).map(p => {
        const n = NODES.find(x => x.id === p.node || x.label === p.node);
        if (!n) return null;
        const ang = Math.atan2(n.y - CY, n.x - CX);
        const off = 34;
        return {
          n: String(p.n), color: p.tone || "#D13438",
          size: Math.round(30 * K) + "px", font: Math.round(14 * K) + "px",
          x: this.px(n.x + Math.cos(ang - 0.6) * off, "x"),
          y: this.px(n.y + Math.sin(ang - 0.6) * off, "y")
        };
      }).filter(Boolean),

      crossLinks: (() => {
        const pos = {};
        NODES.filter(n => n.kind === "hub").forEach(h => { pos[h.group] = this.hubPos(h); });
        const PAIRS = [
          ["Governance", "Compliance", "Oversharing meets unlabelled content"],
          ["Governance", "Copilot", "Open sharing widens the grounding surface"],
          ["Compliance", "Copilot", "Unclassified content becomes citable"],
          ["Security", "Copilot", "No session policy over Copilot"],
          ["Compliance", "Security", "DLP gaps leave labels unenforced"],
          ["Health", "Security", "Drifted devices weaken conditional access"],
          ["Licensing", "Copilot", "Seats without a safe boundary"]
        ];
        return PAIRS.map((p, i) => {
          const a = pos[p[0]], b = pos[p[1]];
          if (!a || !b) return null;
          const sa = scores[p[0]] === undefined ? 60 : scores[p[0]];
          const sb = scores[p[1]] === undefined ? 60 : scores[p[1]];
          const heat = Math.max(0, Math.min(1, (100 - Math.min(sa, sb)) / 60));
          if (heat < 0.18) return null;
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          // bow the arc toward the core so it reads as interference, not structure
          const cx = mx + (CX - mx) * 0.55, cy = my + (CY - my) * 0.55;
          const d = "M " + a.x.toFixed(1) + " " + a.y.toFixed(1) + " Q " + cx.toFixed(1) + " " + cy.toFixed(1) + " " + b.x.toFixed(1) + " " + b.y.toFixed(1);
          const col = heat > 0.62 ? "#f87171" : heat > 0.35 ? "#fbbf24" : "#7dd3fc";
          const on = !activeGroup || activeGroup === p[0] || activeGroup === p[1];
          return {
            id: "x" + i, d: d, color: col,
            width: (1.2 + heat * 2.2).toFixed(2),
            opacity: (on ? 0.28 + heat * 0.42 : 0.06).toFixed(2),
            dot: (3 + heat * 3).toFixed(1),
            dur: (3.4 - heat * 1.9).toFixed(2) + "s",
            glow: on && heat > 0.5 ? "drop-shadow(0 0 6px " + col + ")" : "none"
          };
        }).filter(Boolean);
      })(),

      links: links
    };
  }

  render() {
    // The design runtime renders an imported component inside an injected host div and
    // applies the <dc-import> element's own style to it (support.js:725-731), filtered to
    // HOST_STYLE_PROPS. The War Room passes width:100%;height:100% that way. Without this
    // wrapper the canvas root is a shrink-to-fit flex item and the SVG's width:100%
    // collapses, rendering the radar far smaller than its container.
    return (
      <div className="sc-host-x" style={hostPositionStyle(this.props.style)}>
        <TopologyCanvasView v={{ ...this.props, ...this.renderVals() }} />
      </div>
    );
  }
}

function TopologyCanvasView({ v }: { v: any }) {
  return (
    <>
    <div style={css(`min-height:${v.chrome?.minH};display:flex;flex-direction:column;gap:12px;padding:${v.chrome?.pad};background:${v.chrome?.bg};color:#e2e8f0;font-family:Inter,system-ui,sans-serif`)}>
      {v.chrome?.show && (
        <>
          {" "}
          <div style={css(`display:flex;align-items:center;gap:14px;flex-wrap:wrap;max-width:1280px;width:100%;margin:0 auto`)}>
            <div style={css(`line-height:1.25`)}>
              {" "}
              <div style={css(`font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
                {"Topology centre-piece"}
              </div>
              {" "}
              <div style={css(`font-size:18px;font-weight:800;letter-spacing:-.02em;color:#f1f5f9`)}>
                {"Business Impact Ring · 7 Pillar Zones · 35 Nodes"}
              </div>
              {" "}
            </div>
            <div style={css(`display:flex;align-items:center;gap:6px;margin-left:auto;flex-wrap:wrap`)}>
              {(v.scenarios || []).map((s, sIdx) => (
                <React.Fragment key={sIdx}>
                  {" "}
                  <button onClick={s?.onClick} style={css(`height:28px;padding:0 12px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;color:${s?.color};border:1px solid ${s?.border};background:${s?.bg}`)}>
                    <Txt v={s?.label} />
                  </button>
                  {" "}
                </React.Fragment>
              ))}
            </div>
          </div>
          {" "}
        </>
      )}
      <div style={css(`position:relative;width:100%;max-width:${v.chrome?.maxW};margin:0 auto;border-radius:${v.chrome?.radius};border:${v.chrome?.border};background:${v.chrome?.cardBg};overflow:hidden`)}>
        {" "}
        {v.chrome?.show && (
          <>
            {" "}
            <div style={css(`position:absolute;z-index:5;right:14px;top:14px;display:flex;gap:6px`)}>
              {(v.zoomBtns || []).map((b, bIdx) => (
                <React.Fragment key={bIdx}>
                  {" "}
                  <Hov as="button" onClick={b?.onClick} style={css(`width:32px;height:32px;border-radius:10px;cursor:pointer;font-family:ui-monospace,Menlo,monospace;font-size:13px;font-weight:800;color:#cbd5e1;border:1px solid rgba(51,65,85,.9);background:rgba(8,15,30,.85)`)} hoverStyle={css(`border-color:rgba(103,232,249,.6);color:#e0f2fe`)}>
                    <Txt v={b?.label} />
                  </Hov>
                  {" "}
                </React.Fragment>
              ))}
            </div>
            {" "}
          </>
        )}
        {" "}
        <div onMouseDown={v.onDragStart} style={css(`position:relative;width:100%;overflow:hidden;cursor:${v.dragCursor}`)}>
          {" "}
          <div style={css(`position:relative;width:100%;transform:translate(${v.pan?.x},${v.pan?.y}) scale(${v.zoom});transform-origin:center center;transition:${v.zoomTransition}`)}>
            {" "}
            <svg viewBox={"250 -220 1900 1900"} style={css(`display:block;width:100%;height:auto`)}>
              {" "}
              <defs>
                {" "}
                <lineargradient id={"tc-sweep"} x1={"0"} y1={"0"} x2={"1"} y2={"0"}>
                  {" "}
                  <stop offset={"0%"} stopColor={"#38bdf8"} stopOpacity={"0"} />
                  {" "}
                  <stop offset={"100%"} stopColor={"#38bdf8"} stopOpacity={".35"} />
                  {" "}
                </lineargradient>
                {" "}
                <filter id={"fluent-glow-amber"} x={"-30%"} y={"-30%"} width={"160%"} height={"160%"}>
                  {" "}
                  <fegaussianblur stdDeviation={"8"} result={"blur"} />
                  {" "}
                  <fecomposite in={"SourceGraphic"} in2={"blur"} operator={"over"} />
                  {" "}
                </filter>
                {" "}
                <filter id={"fluent-glow-red"} x={"-40%"} y={"-40%"} width={"180%"} height={"180%"}>
                  {" "}
                  <fegaussianblur stdDeviation={"16"} result={"blur"} />
                  {" "}
                  <fecomposite in={"SourceGraphic"} in2={"blur"} operator={"over"} />
                  {" "}
                </filter>
                {" "}
              </defs>
              {" "}
              <circle cx={"1200"} cy={"750"} r={"686"} fill={"#050C1A"} fillOpacity={".96"} />
              {" "}
              <circle cx={"1200"} cy={"750"} r={"680"} fill={"none"} stroke={"rgba(16,185,129,.3)"} strokeWidth={"2"} strokeDasharray={"14 12"} />
              {" "}
              <circle cx={"1200"} cy={"750"} r={"725"} fill={"none"} stroke={"#C8C8C8"} strokeWidth={"80"} strokeOpacity={".06"} />
              {" "}
              {(v.ghostZones || []).map((g, gIdx) => (
                <React.Fragment key={gIdx}>
                  {" "}
                  <path d={g?.path} fill={"none"} stroke={g?.color} strokeWidth={"3"} strokeOpacity={".38"} strokeDasharray={"14 12"} />
                  {" "}
                </React.Fragment>
              ))}
              {" "}
              {(v.projZones || []).map((g, gIdx) => (
                <React.Fragment key={gIdx}>
                  {" "}
                  <path d={g?.path} fill={g?.color} fillOpacity={".16"} stroke={g?.color} strokeWidth={"4"} strokeOpacity={".8"} style={css(`transition:all 700ms cubic-bezier(.22,1,.36,1)`)} />
                  {" "}
                </React.Fragment>
              ))}
              {" "}
              {(v.ghostSegments || []).map((g, gIdx) => (
                <React.Fragment key={gIdx}>
                  {" "}
                  <path d={g?.path} fill={g?.color} fillOpacity={".1"} stroke={g?.color} strokeWidth={"2"} strokeOpacity={".35"} strokeDasharray={"16 14"} />
                  {" "}
                </React.Fragment>
              ))}
              {" "}
              {(v.scanSegments || []).map((c, cIdx) => (
                <React.Fragment key={cIdx}>
                  {" "}
                  <path d={c?.path} fill={c?.color} fillOpacity={c?.fillOpacity} stroke={c?.color} strokeWidth={"2"} strokeOpacity={c?.strokeOpacity} strokeDasharray={c?.strokeDasharray} style={css(`transition:all 700ms cubic-bezier(.22,1,.36,1)`)} />
                  {" "}
                </React.Fragment>
              ))}
              {" "}
              {(v.segments || []).map((s, sIdx) => (
                <React.Fragment key={sIdx}>
                  {" "}
                  <g onClick={s?.onClick} style={css(`cursor:pointer`)}>
                    {" "}
                    <path d={s?.path} fill={s?.color} fillOpacity={s?.fillOpacity} stroke={s?.stroke} strokeWidth={s?.strokeWidth} strokeOpacity={s?.strokeOpacity} strokeDasharray={s?.strokeDasharray} filter={s?.filter} style={css(`transition:all 300ms cubic-bezier(.22,1,.36,1)`)} />
                    {" "}
                    <path d={s?.edgePath} fill={s?.color} fillOpacity={".9"} style={css(`animation:${s?.edgeAnim}`)} />
                    {" "}
                  </g>
                  {" "}
                </React.Fragment>
              ))}
              {" "}
              {(v.zones || []).map((z, zIdx) => (
                <React.Fragment key={zIdx}>
                  {" "}
                  <g opacity={z?.opacity} style={css(`transition:opacity 500ms ease`)}>
                    {" "}
                    <path d={z?.path} fill={z?.color} fillOpacity={".3"} stroke={z?.color} strokeWidth={"2"} strokeOpacity={".65"} />
                    {" "}
                    <path d={z?.path} fill={"none"} stroke={z?.color} strokeWidth={"4"} strokeOpacity={".25"} />
                    {" "}
                    <g transform={z?.iconTransform} opacity={".55"}>
                      {" "}
                      <path d={z?.icon} fill={z?.color} fillOpacity={".22"} stroke={z?.color} strokeWidth={"2.2"} strokeOpacity={".95"} strokeLinecap={"round"} strokeLinejoin={"round"} />
                      {" "}
                    </g>
                    {" "}
                  </g>
                  {" "}
                </React.Fragment>
              ))}
              {" "}
              {(v.crossLinks || []).map((xl, xlIdx) => (
                <React.Fragment key={xlIdx}>
                  {" "}
                  <g style={css(`transition:opacity 500ms ease`)}>
                    {" "}
                    <path d={xl?.d} fill={"none"} stroke={xl?.color} strokeWidth={xl?.width} strokeOpacity={xl?.opacity} strokeDasharray={"3 13"} strokeLinecap={"round"} filter={xl?.glow} />
                    {" "}
                    <circle r={xl?.dot} fill={xl?.color} opacity={xl?.opacity}>
                      {" "}
                      <animatemotion dur={xl?.dur} repeatCount={"indefinite"} path={xl?.d} />
                      {" "}
                    </circle>
                    {" "}
                    <circle r={xl?.dot} fill={xl?.color} opacity={xl?.opacity}>
                      {" "}
                      <animatemotion dur={xl?.dur} begin={xl?.dur} repeatCount={"indefinite"} keyPoints={"1;0"} keyTimes={"0;1"} calcMode={"linear"} path={xl?.d} />
                      {" "}
                    </circle>
                    {" "}
                  </g>
                  {" "}
                </React.Fragment>
              ))}
              {" "}
              {(v.links || []).map((l, lIdx) => (
                <React.Fragment key={lIdx}>
                  {" "}
                  <g opacity={l?.dim} style={css(`transition:opacity 500ms ease`)}>
                    {" "}
                    <line x1={l?.x1} y1={l?.y1} x2={l?.x2} y2={l?.y2} stroke={l?.stroke} strokeWidth={l?.width} strokeOpacity={l?.opacity} strokeDasharray={l?.dash} />
                    {" "}
                    <line x1={l?.x1} y1={l?.y1} x2={l?.x2} y2={l?.y2} stroke={l?.particle} strokeWidth={l?.flowWidth} strokeDasharray={l?.flowDash} strokeOpacity={".7"} style={css(`animation:flowDash ${l?.flowDur} linear infinite`)} />
                    {" "}
                    <circle r={l?.dot} fill={l?.particle}>
                      {" "}
                      <animatemotion dur={l?.pulseDur} repeatCount={"indefinite"} path={l?.path} />
                      {" "}
                    </circle>
                    {" "}
                  </g>
                  {" "}
                </React.Fragment>
              ))}
              {" "}
              {v.sweep && (
                <>
                  {" "}
                  <g style={css(`transform-origin:1200px 750px;animation:tcSpin ${v.sweep?.dur} linear infinite`)}>
                    {" "}
                    <path d={v.sweep?.path} fill={"url(#tc-sweep)"} opacity={".85"} />
                    {" "}
                    <line x1={"1200"} y1={"750"} x2={v.sweep?.tipX} y2={v.sweep?.tipY} stroke={"#7dd3fc"} strokeWidth={"4"} strokeOpacity={".9"} />
                    {" "}
                  </g>
                  {" "}
                </>
              )}
              {" "}
              {v.focusLink && (
                <>
                  {" "}
                  <g>
                    {" "}
                    <line x1={v.focusLink?.x1} y1={v.focusLink?.y1} x2={v.focusLink?.x2} y2={v.focusLink?.y2} stroke={v.focusLink?.color} strokeWidth={"6"} strokeOpacity={".95"} strokeLinecap={"round"} filter={`drop-shadow(0 0 12px ${v.focusLink?.color})`} />
                    {" "}
                    <circle r={"9"} fill={v.focusLink?.color}>
                      {" "}
                      <animatemotion dur={"1.5s"} repeatCount={"indefinite"} path={v.focusLink?.path} />
                      {" "}
                    </circle>
                    {" "}
                  </g>
                  {" "}
                </>
              )}
              {" "}
            </svg>
            {" "}
            <div ref={v.setBox} style={css(`position:absolute;left:0;top:0;width:1630px;height:1630px;transform:scale(${v.overlayScale});transform-origin:top left;pointer-events:none`)}>
              {" "}
              {(v.zoneTags || []).map((z, zIdx) => (
                <React.Fragment key={zIdx}>
                  {" "}
                  <div style={css(`position:absolute;left:${z?.x};top:${z?.y};transform:translate(-50%,-50%);opacity:${z?.opacity};transition:opacity 500ms ease;padding:2px 10px;border-radius:12px;white-space:nowrap;border:2px solid ${z?.border};background:rgba(9,13,22,.95)`)}>
                    {" "}
                    <span style={css(`font-size:${v.zoneType};font-weight:800;letter-spacing:.1em;font-family:ui-monospace,Menlo,monospace;color:${z?.color}`)}>
                      <Txt v={z?.label} />
                    </span>
                    {" "}
                  </div>
                  {" "}
                </React.Fragment>
              ))}
              {" "}
              {(v.ringLabels || []).map((r, rIdx) => (
                <React.Fragment key={rIdx}>
                  {" "}
                  <div onClick={r?.onClick} style={css(`position:absolute;left:${r?.x};top:${r?.y};transform:translate(-50%,-50%);width:${v.ringW};height:${v.ringH};display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:16px;cursor:pointer;pointer-events:auto;border:${r?.borderWidth} solid ${r?.border};background:rgba(9,13,22,.96)`)}>
                    <span style={css(`font-size:${v.ringType};font-weight:900;letter-spacing:1px;color:#fff;line-height:1.15`)}>
                      <Txt v={r?.label} />
                    </span>
                    <span style={css(`font-size:${v.ringSub};font-weight:800;font-family:ui-monospace,Menlo,monospace;color:${r?.color};line-height:1.15`)}>
                      <Txt v={r?.impact} />{"% IMPACT"}
                    </span>
                  </div>
                  {" "}
                </React.Fragment>
              ))}
              {" "}
              <div onClick={v.core?.onClick} style={css(`position:absolute;left:${v.core?.x};top:${v.core?.y};transform:translate(-50%,-50%);width:${v.coreSize};height:${v.coreSize};border-radius:999px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;text-align:center;cursor:pointer;pointer-events:auto;background:rgba(255,255,255,.06);border:2px solid ${v.core?.ring};box-shadow:0 0 60px ${v.core?.glow};backdrop-filter:blur(6px);animation:${v.core?.anim};transition:border-color 900ms ease,box-shadow 900ms ease`)}>
                {v.core?.showWas && (
                  <>
                    {" "}
                    <div style={css(`display:flex;align-items:baseline;gap:8px`)}>
                      <span style={css(`font-size:${v.coreWasValue};font-weight:800;letter-spacing:-.03em;line-height:1;color:#64748b;font-variant-numeric:tabular-nums`)}>
                        <Txt v={v.core?.was} />
                      </span>
                      <span style={css(`font-size:${v.coreWasValue};font-weight:700;line-height:1;color:#94a3b8`)}>
                        {"&#8594;"}
                      </span>
                      <span style={css(`font-size:${v.coreValue};font-weight:800;letter-spacing:-.03em;line-height:1;color:${v.core?.color};font-variant-numeric:tabular-nums;transition:color 900ms ease`)}>
                        <Txt v={v.core?.score} />
                      </span>
                    </div>
                    {" "}
                  </>
                )}
                {v.core?.plain && (
                  <>
                    {" "}
                    <span style={css(`font-size:${v.coreValue};font-weight:800;letter-spacing:-.03em;line-height:1;color:${v.core?.color};font-variant-numeric:tabular-nums;transition:color 900ms ease`)}>
                      <Txt v={v.core?.score} />
                    </span>
                    {" "}
                  </>
                )}
                <span style={css(`font-size:${v.coreLabel};font-weight:800;letter-spacing:.1em;color:#e2e8f0;font-family:ui-monospace,Menlo,monospace`)}>
                  {"M365 HEALTH SCORE"}
                </span>
                <span style={css(`font-size:${v.coreLabel};font-weight:800;letter-spacing:.1em;padding:2px 9px;border-radius:999px;color:${v.core?.color};border:1px solid ${v.core?.ring};background:${v.core?.bg};font-family:ui-monospace,Menlo,monospace`)}>
                  <Txt v={v.core?.band} />
                </span>
                {v.showSignals && (
                  <>
                    <span style={css(`font-size:${v.coreTag};font-weight:700;color:#94a3b8;font-family:ui-monospace,Menlo,monospace`)}>
                      {"122 SIGNALS POLLED"}
                    </span>
                  </>
                )}
              </div>
              {" "}
              {(v.hubs || []).map((h, hIdx) => (
                <React.Fragment key={hIdx}>
                  {" "}
                  <div onClick={h?.onClick} style={css(`position:absolute;left:${h?.x};top:${h?.y};transform:translate(-50%,-50%);display:flex;align-items:center;gap:${v.hubGap};padding:${v.hubPad};border-radius:14px;cursor:pointer;pointer-events:auto;white-space:nowrap;opacity:${h?.opacity};border:2px solid ${h?.border};background:${h?.bg};box-shadow:${h?.glow};animation:${h?.anim};transition:all 300ms cubic-bezier(.22,1,.36,1)`)}>
                    <span style={css(`flex:none;width:${v.hubIcon};height:${v.hubIcon};border-radius:8px;display:flex;align-items:center;justify-content:center;background:${h?.color}`)}>
                      <svg width={v.hubGlyph} height={v.hubGlyph} viewBox={"0 0 24 24"} fill={"none"} stroke={"#fff"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                        <path d={h?.icon} />
                      </svg>
                    </span>
                    <span style={css(`display:flex;flex-direction:column;line-height:1.3`)}>
                      <span style={css(`display:flex;align-items:center;gap:8px`)}>
                        {h?.showName && (
                          <>
                            {" "}
                            <span style={css(`font-size:${v.hubType};font-weight:900;letter-spacing:-.01em;color:#f1f5f9`)}>
                              <Txt v={h?.label} />
                            </span>
                            {" "}
                          </>
                        )}
                        {h?.showWas && (
                          <>
                            {" "}
                            <span style={css(`font-size:${v.hubSub};font-weight:700;font-family:ui-monospace,Menlo,monospace;color:#64748b;text-decoration:line-through`)}>
                              <Txt v={h?.was} />
                            </span>
                            {" "}
                          </>
                        )}
                        <span style={css(`font-size:${v.hubSub};font-weight:800;padding:1px 6px;border-radius:6px;font-family:ui-monospace,Menlo,monospace;color:${h?.chipInk};border:1px solid ${h?.chipBorder};background:${h?.chipBg};text-shadow:0 0 12px ${h?.chipInk}`)}>
                          <Txt v={h?.score} />
                        </span>
                      </span>
                      <span style={css(`font-size:${v.hubSub};font-family:ui-monospace,Menlo,monospace;color:${h?.subColor}`)}>
                        <Txt v={h?.sub} />
                      </span>
                    </span>
                  </div>
                  {" "}
                </React.Fragment>
              ))}
              {" "}
              {(v.blastRings || []).map((b, bIdx) => (
                <React.Fragment key={bIdx}>
                  {" "}
                  <div style={css(`position:absolute;left:${b?.x};top:${b?.y};width:${b?.size};height:${b?.size};transform:translate(-50%,-50%);border-radius:50%;border:2px solid ${b?.color};box-shadow:0 0 26px ${b?.glow};opacity:${b?.opacity};animation:tcBlast 900ms cubic-bezier(.22,1,.36,1) ${b?.delay} both,tcPulse 2.6s ease-in-out ${b?.delay} infinite`)} />
                  {" "}
                </React.Fragment>
              ))}
              {" "}
              {(v.blastTags || []).map((t, tIdx) => (
                <React.Fragment key={tIdx}>
                  {" "}
                  <div style={css(`position:absolute;left:${t?.x};top:${t?.y};transform:translate(-50%,-50%);display:flex;align-items:baseline;gap:${t?.gap};padding:${t?.pad};border-radius:${t?.radius};white-space:nowrap;border:2px solid ${t?.color};background:rgba(6,10,22,.96);box-shadow:0 0 22px ${t?.glow};animation:tcBlast 700ms cubic-bezier(.22,1,.36,1) ${t?.delay} both`)}>
                    <span style={css(`font-size:${t?.valueSize};font-weight:800;letter-spacing:-.02em;color:${t?.color};font-variant-numeric:tabular-nums`)}>
                      <Txt v={t?.value} />
                    </span>
                    <span style={css(`font-size:${t?.labelSize};font-weight:600;color:#cbd5e1`)}>
                      <Txt v={t?.label} />
                    </span>
                  </div>
                  {" "}
                </React.Fragment>
              ))}
              {" "}
              {(v.pillarKeys || []).map((pk, pkIdx) => (
                <React.Fragment key={pkIdx}>
                  {" "}
                  <div style={css(`position:absolute;left:${pk?.x};top:${pk?.y};transform:translate(-50%,-50%);display:flex;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;pointer-events:none;white-space:nowrap;opacity:${pk?.opacity};border:1px solid ${pk?.color}66;background:rgba(4,10,22,.9);transition:opacity 400ms ease`)}>
                    <span style={css(`flex:none;width:6px;height:6px;border-radius:99px;background:${pk?.color};box-shadow:0 0 8px ${pk?.color}`)} />
                    <span style={css(`font-size:${pk?.size};font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#e2e8f0;font-family:ui-monospace,Menlo,monospace`)}>
                      <Txt v={pk?.label} />
                    </span>
                    <span style={css(`font-size:${pk?.sub};font-weight:800;color:${pk?.scoreColor};font-variant-numeric:tabular-nums`)}>
                      <Txt v={pk?.score} />
                    </span>
                  </div>
                  {" "}
                </React.Fragment>
              ))}
              {" "}
              {(v.findings || []).map((fd, fdIdx) => (
                <React.Fragment key={fdIdx}>
                  {" "}
                  <Hov as="div" onClick={fd?.onClick} title={fd?.title} style={css(`position:absolute;left:${fd?.x};top:${fd?.y};width:${fd?.dot};height:${fd?.dot};transform:translate(-50%,-50%) scale(${fd?.scale});display:flex;align-items:center;justify-content:center;border-radius:999px;cursor:pointer;pointer-events:auto;opacity:${fd?.opacity};font-family:ui-monospace,Menlo,monospace;font-size:${fd?.num};font-weight:800;color:#04121f;background:${fd?.tone};border:${fd?.bw} solid ${fd?.border};box-shadow:${fd?.glow};transition:all 320ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:#ffffff`)}>
                    <Txt v={fd?.n} />
                  </Hov>
                  {" "}
                </React.Fragment>
              ))}
              {" "}
              {(v.nodes || []).map((n, nIdx) => (
                <React.Fragment key={nIdx}>
                  {" "}
                  <div onClick={n?.onClick} style={css(`position:absolute;left:${n?.x};top:${n?.y};transform:translate(-50%,-50%) scale(${n?.scale});display:flex;align-items:center;gap:5px;padding:3px 7px;border-radius:9px;cursor:pointer;pointer-events:auto;white-space:nowrap;opacity:${n?.opacity};border:2px solid ${n?.border};background:${n?.bg};box-shadow:${n?.glow};animation:${n?.anim};transition:all 250ms cubic-bezier(.22,1,.36,1)`)}>
                    <span style={css(`flex:none;width:${n?.dotSize};height:${n?.dotSize};border-radius:99px;background:${n?.dot}`)} />
                    {n?.showLabel && (
                      <>
                        {" "}
                        <span style={css(`font-size:${n?.labelSize};font-weight:600;color:${n?.text}`)}>
                          <Txt v={n?.label} />
                        </span>
                        {" "}
                      </>
                    )}
                  </div>
                  {" "}
                </React.Fragment>
              ))}
              {" "}
              {(v.pins || []).map((p, pIdx) => (
                <React.Fragment key={pIdx}>
                  {" "}
                  <div style={css(`position:absolute;left:${p?.x};top:${p?.y};width:${p?.size};height:${p?.size};transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;border-radius:999px;pointer-events:none;font-family:ui-monospace,Menlo,monospace;font-weight:800;font-size:${p?.font};color:#fff;background:${p?.color};border:2px solid rgba(255,255,255,.85);box-shadow:0 0 18px ${p?.color};animation:tcPinIn 420ms cubic-bezier(.22,1,.36,1)`)}>
                    <Txt v={p?.n} />
                  </div>
                  {" "}
                </React.Fragment>
              ))}
              {" "}
            </div>
            {" "}
          </div>
          {" "}
        </div>
        {" "}
      </div>
    </div>
    </>
  );
}

export { TopologyCanvasLogic as TopologyCanvas };
