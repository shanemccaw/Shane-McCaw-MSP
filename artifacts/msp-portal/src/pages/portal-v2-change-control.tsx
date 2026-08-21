/**
 * portal-v2-change-control.tsx — the Change Control module.
 *
 * A FULL REBUILD to the current design (`Change Control.dc.html`, 2,795 lines),
 * which is now a standalone module and a materially different page from the
 * round-one inline-shell tab strip (register / schedule / vault) that used to
 * live here. The design's five sub-views — briefing / register / catalogue /
 * calendar / review — live in the shell's nav registry as sub-items under
 * Change Control (`portalV2Nav.ts`), each a real linkable URL. A per-CR record
 * view and a deep-linkable policy view (`ccView === 'settings'`, which the
 * shell's header change-control badge and alerts target) are reached from within
 * and are not nav tabs.
 *
 * ── UI only ────────────────────────────────────────────────────────────────
 * Every value is the design's own fixture (`ccPageData.ts`); every flow is the
 * design's own (`useChangeControl.ts`). Nothing is wired to a data source — a
 * later pass does that. Copy is final and reproduced verbatim.
 *
 * ── Round Two, item 6: the CR Gantt rows are fluid ─────────────────────────
 * The briefing timeline is `grid-template-columns:186px minmax(0,1fr)` with the
 * bar grid `repeat(15,1fr)` inside it — no fixed min-width floor and no
 * overflow-x wrapper, so the rows breathe with the container. The register
 * TABLE keeps its own `overflow-x:auto` + `min-width:970px` because that is a
 * different element the design still scrolls and the changelog names the Gantt,
 * not the table.
 *
 * ── Styling ────────────────────────────────────────────────────────────────
 * This design computes dozens of inline styles as CSS strings from tones and
 * state. They are kept verbatim and parsed by `css()` (see ccPageData.ts) rather
 * than hand-translated to camelCase objects — the lower-defect choice at this
 * scale.
 */

import type { ReactNode } from "react";
import { useRoute } from "wouter";

import { PortalV2Shell, SIDEBAR_WASH } from "@/components/portal-v2/PortalV2Shell";
import {
  aiTone,
  apprState,
  barTextSpan,
  buildCalendar,
  CC_BRIEF_ORDER,
  CC_BRIEFS,
  CC_CARD_ORDER,
  CC_CAT_PROMOTE,
  CC_CATALOGUE,
  CC_CATS,
  CC_CAB,
  CC_CONFLICTS,
  CC_CRS,
  CC_DAYS,
  CC_DECISIONS,
  CC_FREEZE,
  CC_GANTT,
  CC_KIND_CSS,
  CC_LEGEND,
  CC_MONO,
  CC_MSC,
  CC_MSC_TRAY,
  CC_MSG,
  CC_SECS,
  CC_STAT_SETS,
  CC_TODAY,
  CC_BLACKOUT,
  CC_WIN_DAYS,
  compOf,
  css,
  editableBy,
  filterRegister,
  matchSF,
  pill,
  riskTone,
  secDone,
  stateTone,
  type CatalogueItem,
  type ChangeRequest,
  type CrCheck,
  type CrStep,
} from "@/components/portal-v2/ccPageData";
import { briefFor } from "@/components/portal-v2/ccChangeControlWire";
import { stateInFreeze, useChangeControl, type CcController, type CcDraft } from "@/components/portal-v2/useChangeControl";

const MONO = CC_MONO;

/** The set of view slugs a URL may carry; anything else falls back to briefing. */
const URL_VIEWS = new Set(["briefing", "register", "catalogue", "calendar", "review", "settings"]);

/* ── Small shared render helpers ────────────────────────────────────────────── */

function Pill({ text, tone, bg }: { text: string; tone: string; bg?: string }) {
  return <span style={css(pill(text, tone, bg))}>{text}</span>;
}

/** proto val() — a record field value's style. */
function valCss(mono?: boolean): string {
  return (
    "font-size:" +
    (mono ? "11.5px" : "12.5px") +
    ";color:#e2e8f0;line-height:1.6;" +
    (mono ? "font-family:" + MONO + ";word-break:break-all" : "text-wrap:pretty")
  );
}

/** In-freeze against live state — freeze always active in this UI-only build. */
function clashOf(ctrl: CcController, code: string): boolean {
  return stateInFreeze(code, ctrl.s.movedOv) && !ctrl.s.freezeException;
}

/* ── The stats band + stat panel (shown on every sub-view) ──────────────────── */

function StatsBand({ ctrl }: { ctrl: CcController }) {
  const { s } = ctrl;
  const all = CC_CRS;
  const waiting = all.filter((c) => /Awaiting|retro/.test(c.state)).length;
  const incomplete = all.filter((c) => (c.missing || []).length).length;
  const freezeClash = stateInFreeze("CR-0142", s.movedOv) && !s.freezeException;

  const statDefs = [
    { key: "decisions", label: "Decisions due", value: String(CC_DECISIONS.length), sub: "2 expire this week whether you act or not", tone: "#f87171" },
    { key: "waiting", label: "Waiting on your signature", value: String(waiting), sub: "CR-0151 retro approval · CR-0142 before the freeze", tone: "#fbbf24" },
    { key: "incomplete", label: "Incomplete records", value: String(incomplete), sub: "Cannot be approved or scheduled", tone: "#f87171" },
    { key: "scheduled", label: "Scheduled this week", value: "2", sub: "Thu 20 Aug · Tue 25 Aug", tone: "#60a5fa" },
    { key: "closed", label: "Deployed · last 30 days", value: "7", sub: "6 held · 1 rolled back", tone: "#34d399" },
    { key: "freeze", label: "Change freeze", value: "24–28 Aug", sub: CC_FREEZE.label + (freezeClash ? " · 1 change collides" : " · clear"), tone: "#f87171" },
  ];
  const SF = s.statFilter;

  const STAT_NOTES: Record<string, string> = {
    decisions: "Each one expires whether you act or not. Nobody chases them for you.",
    waiting: "Nothing moves until both signatures are on the record — and they must be two different people.",
    incomplete: "Required sections are empty, so these cannot be approved or given a window.",
    scheduled: "Windows already agreed. Anything that collides with the freeze is marked.",
    closed: "Deployed in the last 30 days, with what held and what did not.",
    freeze: CC_FREEZE.label + ". Nothing may change inside it without a granted exception.",
  };
  const decByCode: Record<string, (typeof CC_DECISIONS)[number]> = {};
  CC_DECISIONS.forEach((d) => (decByCode[d.code] = d));

  const panelDef = SF ? statDefs.find((x) => x.key === SF) : null;
  const panelItems =
    SF && panelDef
      ? (CC_STAT_SETS[SF] || []).map((code) => {
          const cr = all.find((x) => x.code === code);
          const mc = CC_MSC.find((x) => x.id === code) || (CC_MSC_TRAY.id === code ? CC_MSC_TRAY : null);
          const dec = decByCode[code];
          const isMs = !cr;
          const title = cr ? cr.title : mc ? ("title" in mc ? mc.title : (mc as { label: string }).label) : code;
          let meta = cr ? cr.state + " · " + cr.workload : "Microsoft change · not yours to approve";
          if (SF === "decisions" && dec) meta = dec.cons;
          let tag = cr ? cr.risk || "" : "Microsoft";
          if (SF === "decisions" && dec) tag = dec.due;
          if (SF === "incomplete" && cr) tag = (cr.missing || []).length + " missing";
          const tone = SF === "decisions" && dec ? dec.tone : isMs ? "#f87171" : stateTone(cr!.state);
          return { code, title, meta, tag, tone };
        })
      : [];

  return (
    <div style={css("display:flex;flex-direction:column;gap:0")}>
      <div style={css("display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px")}>
        {statDefs.map((sd) => {
          const on = SF === sd.key;
          const cardCss =
            "display:flex;flex-direction:column;gap:3px;padding:9px 11px;border:1px solid " +
            (on ? sd.tone + "80" : "rgba(30,41,59,.9)") +
            ";border-radius:9px;border-bottom-left-radius:" +
            (on ? "0" : "9px") +
            ";border-bottom-right-radius:" +
            (on ? "0" : "9px") +
            ";background:" +
            (on ? sd.tone + "14" : "#0b1524") +
            ";cursor:pointer;text-align:left;font-family:inherit;min-width:0;transition:border-color 160ms,background 160ms";
          const valueCss =
            "font-size:" +
            (sd.value.length > 5 ? "14px" : "21px") +
            ";font-weight:800;letter-spacing:-.02em;line-height:1.25;color:" +
            sd.tone +
            ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
          return (
            <button
              key={sd.key}
              data-testid={`cc-stat-${sd.key}`}
              onClick={() => ctrl.patch({ statFilter: SF === sd.key ? null : sd.key, focusCode: null })}
              title={sd.sub}
              style={css(cardCss)}
            >
              <span style={css("font-size:8.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#64748b;line-height:1.35")}>
                {sd.label}
              </span>
              <span style={css(valueCss)}>{sd.value}</span>
            </button>
          );
        })}
      </div>
      {SF && panelDef && (
        <div
          style={css(
            "display:flex;flex-direction:column;gap:11px;padding:14px 16px;border:1px solid " +
              panelDef.tone +
              "4d;border-top:none;border-radius:0 0 11px 11px;background:" +
              panelDef.tone +
              "0a",
          )}
        >
          <div style={css("display:flex;align-items:baseline;gap:11px;flex-wrap:wrap")}>
            <span
              style={css(
                "font-size:9.5px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:" + panelDef.tone + ";white-space:nowrap",
              )}
            >
              {panelDef.label}
            </span>
            <span style={css("font-size:11.5px;color:#94a3b8;line-height:1.5;flex:1 1 320px;min-width:0;text-wrap:pretty")}>
              {STAT_NOTES[SF] || ""}
            </span>
            <button
              onClick={() => ctrl.patch({ statFilter: null })}
              style={css("padding:4px 10px;border-radius:6px;border:1px solid rgba(148,163,184,.22);background:transparent;color:#94a3b8;font-size:10.5px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap")}
            >
              Close
            </button>
          </div>
          <div style={css("display:flex;flex-direction:column;gap:6px")}>
            {panelItems.map((it) => (
              <button
                key={it.code}
                data-testid={`cc-stat-item-${it.code}`}
                onClick={() => ctrl.patch({ focusCode: it.code, statFilter: null, view: "briefing" })}
                style={css("display:grid;grid-template-columns:92px minmax(0,1fr) auto;gap:12px;align-items:center;padding:9px 11px;border:1px solid rgba(30,41,59,.9);border-radius:8px;background:rgba(2,6,23,.4);cursor:pointer;font-family:inherit;text-align:left;width:100%")}
              >
                <span style={css("font-size:10.5px;font-weight:700;color:" + it.tone + ";font-family:" + MONO + ";white-space:nowrap")}>{it.code}</span>
                <div style={css("display:flex;flex-direction:column;gap:2px;min-width:0")}>
                  <span style={css("font-size:12px;font-weight:600;color:#e2e8f0;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{it.title}</span>
                  <span style={css("font-size:10.5px;color:#64748b;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{it.meta}</span>
                </div>
                <Pill text={it.tag} tone={it.tone} bg={it.tone + "14"} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Briefing: the timeline, the Microsoft rows, collisions, and the cards ──── */

interface FocusCard {
  code: string;
  isMs: boolean;
  group: string;
  groupSub: string;
  time: string;
  timeSub: string;
  dotCss: string;
  cardCss: string;
  statePill: { text: string; tone: string; bg: string };
  riskPill: { text: string; tone: string; bg: string };
  needsPill: string;
  needsCss: string;
  hasClash: boolean;
  movedText: string;
  clashTitle: string;
  clashText: string;
  clashActs: { label: string; go: () => void; css: string }[];
  who: string;
  whoOrg: string;
  init: string;
  initCss: string;
  where: string;
  whereNote: string;
  wherePillCss: string;
  segs: { text: string; css: string }[];
  why: string;
  ifWrong: string;
  rbLabel: string;
  rbPillCss: string;
  how: { call: string; result: string }[];
  acts: { label: string; go: () => void; css: string }[];
}

function BriefingView({ ctrl }: { ctrl: CcController }) {
  const { s, role } = ctrl;
  const isLive = ctrl.dataState === "live";
  const all = isLive ? ctrl.crs() : CC_CRS;
  const SF = s.statFilter;
  const order = isLive ? all.map((c) => c.code) : CC_BRIEF_ORDER;
  const sets = ctrl.statSets();
  const FZ = CC_FREEZE;

  const isFz = (d: number) => d >= FZ.from && d <= FZ.to;
  const fzStripe =
    "repeating-linear-gradient(135deg,rgba(248,113,113,.20),rgba(248,113,113,.20) 5px,rgba(248,113,113,.06) 5px,rgba(248,113,113,.06) 10px)";
  const dayBg = (d: number) =>
    isFz(d)
      ? fzStripe
      : CC_BLACKOUT.indexOf(d) >= 0
        ? "rgba(251,191,36,.05)"
        : CC_WIN_DAYS.indexOf(d) >= 0
          ? "rgba(0,120,212,.06)"
          : "transparent";
  const days = CC_DAYS.map((x) => ({
    w: x.w,
    d: String(x.d),
    css:
      "display:flex;flex-direction:column;align-items:center;gap:1px;padding:5px 0;border-left:1px solid " +
      (x.d === CC_TODAY ? "rgba(34,211,238,.55)" : isFz(x.d) ? "rgba(248,113,113,.45)" : "rgba(30,41,59,.6)") +
      ";background:" +
      dayBg(x.d),
    wCss:
      "font-size:8.5px;font-weight:700;letter-spacing:.08em;color:" +
      (x.d === CC_TODAY ? "#22d3ee" : isFz(x.d) ? "#f87171" : CC_BLACKOUT.indexOf(x.d) >= 0 ? "#fbbf24" : "#475569"),
    dCss: "font-size:11px;font-weight:" + (x.d === CC_TODAY ? "800" : "600") + ";color:" + (x.d === CC_TODAY ? "#22d3ee" : "#94a3b8"),
  }));
  const cells = CC_DAYS.map((x, i) => ({
    css:
      "grid-row:1;grid-column:" +
      (i + 1) +
      " / span 1;height:100%;border-left:1px solid " +
      (x.d === CC_TODAY ? "rgba(34,211,238,.55)" : isFz(x.d) ? "rgba(248,113,113,.45)" : "rgba(30,41,59,.6)") +
      ";background:" +
      dayBg(x.d),
  }));

  type GanttRow = {
    code: string;
    title: string;
    hasBar: boolean;
    unscheduled: boolean;
    rowCss: string;
    labelCss: string;
    caretCss: string;
    codeCss: string;
    titleCss: string;
    barCss: string;
    barTextCss: string;
    barTitle: string;
    barLabel: string;
    barLabelCss: string;
    hasPhase: boolean;
    phaseCss: string;
    phaseLabel: string;
    phaseTitle: string;
    phaseLabelCss: string;
    blockedCss: string;
    blockedLabel: string;
    blockedTextCss: string;
    go: () => void;
  };

  const ganttRows: GanttRow[] = order
    .map((code): GanttRow | null => {
      const c = all.find((x) => x.code === code);
      const g = isLive ? undefined : CC_GANTT[code];
      if (!c) return null;
      const tone = stateTone(c.state);
      const dim = !!s.focusCode && s.focusCode !== code;
      const isOpen = s.focusCode === code;
      const clash = stateInFreeze(code, s.movedOv) && !s.freezeException;
      const bt = g ? barTextSpan(g.start, g.span) : { col: 1, span: 1 };
      return {
        code: c.code,
        title: c.title,
        hasBar: !!g,
        unscheduled: !g,
        rowCss:
          "display:grid;grid-template-columns:186px minmax(0,1fr);gap:0;align-items:stretch;border-top:1px solid rgba(30,41,59,.6);opacity:" +
          (dim ? ".4" : "1"),
        labelCss: "display:flex;flex-direction:column;gap:2px;justify-content:center;padding:9px 12px 9px 2px;border:none;background:transparent;text-align:left;cursor:pointer;font-family:inherit;min-width:0",
        caretCss:
          "font-size:9px;color:" +
          (isOpen ? tone : "#475569") +
          ";display:inline-block;transform:rotate(" +
          (isOpen ? "90deg" : "0deg") +
          ");transition:transform 150ms",
        codeCss: "font-size:10px;font-weight:700;color:" + tone + ";font-family:" + MONO,
        titleCss: "font-size:11px;color:#94a3b8;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
        barCss: g
          ? "grid-row:1;grid-column:" +
            g.start +
            " / span " +
            g.span +
            ";margin:9px 2px;display:flex;align-items:center;padding:0 9px;border-radius:6px;background:" +
            tone +
            ";box-shadow:" +
            (clash ? "0 0 0 2px #f87171, 0 0 18px rgba(248,113,113,.45)" : "0 0 18px " + tone + "4d") +
            ";cursor:pointer;min-width:0;overflow:hidden"
          : "",
        barTextCss: g
          ? "grid-row:1;grid-column:" +
            bt.col +
            " / span " +
            bt.span +
            ";display:flex;align-items:center;padding-left:9px;pointer-events:none;min-width:0;overflow:hidden"
          : "",
        barTitle: g ? (clash ? c.code + " — inside the " + FZ.label + ", cannot be approved as it stands" : c.code + " — " + g.label) : "",
        barLabel: g ? (clash ? "inside the freeze" : g.label) : "",
        barLabelCss:
          "font-size:10px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:" +
          (clash ? "#f87171" : "#cbd5e1"),
        hasPhase: !!(g && g.phase),
        phaseCss:
          g && g.phase
            ? "grid-row:1;grid-column:" +
              g.phase.start +
              " / span " +
              g.phase.span +
              ";margin:12px 2px;display:flex;align-items:center;padding:0 8px;border-radius:5px;border:1px dashed " +
              tone +
              "80;background:" +
              tone +
              "1a;min-width:0;overflow:hidden"
            : "",
        phaseLabel: g && g.phase ? g.phase.label : "",
        phaseTitle: g && g.phase ? g.phase.label : "",
        phaseLabelCss: "font-size:9.5px;font-weight:600;color:" + tone + ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
        blockedCss:
          "grid-row:1;grid-column:1 / span 15;margin:11px 2px;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:6px;border:1px dashed rgba(248,113,113,.4);background:rgba(248,113,113,.05)",
        blockedLabel: isLive ? c.window : "No window — four required sections empty, so it cannot be scheduled",
        blockedTextCss: "font-size:10px;font-weight:600;color:#f87171;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 8px",
        go: () => ctrl.patch({ focusCode: s.focusCode === code ? null : code }),
      };
    })
    .filter((r): r is GanttRow => r !== null)
    .filter((r) => r.code !== "CR-0136")
    .filter((r) => matchSF(r.code, SF, sets))
    .map((r) => {
      const mv = (s.movedOv || {})[r.code];
      return !mv
        ? r
        : {
            ...r,
            hasBar: false,
            hasPhase: false,
            unscheduled: true,
            blockedLabel: "Moved to " + mv + " — outside these two weeks",
            blockedTextCss: "font-size:10px;font-weight:600;color:#fbbf24;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 8px",
            blockedCss:
              "grid-row:1;grid-column:1 / span 15;margin:11px 2px;display:flex;align-items:center;justify-content:center;border-radius:6px;border:1px dashed rgba(251,191,36,.45);background:rgba(251,191,36,.05)",
          };
    });

  const msRows = CC_MSC.map((m) => {
    const g = CC_MSG[m.id];
    const dim = !!s.focusCode && s.focusCode !== m.id;
    const isOpen = s.focusCode === m.id;
    const bt = barTextSpan(g.start, g.span);
    return {
      code: m.id,
      title: m.title,
      rowCss:
        "display:grid;grid-template-columns:186px minmax(0,1fr);gap:0;align-items:stretch;border-top:1px solid rgba(30,41,59,.6);opacity:" +
        (dim ? ".4" : "1"),
      labelCss: "display:flex;flex-direction:column;gap:2px;justify-content:center;padding:9px 12px 9px 2px;border:none;background:transparent;text-align:left;cursor:pointer;font-family:inherit;min-width:0",
      caretCss:
        "font-size:9px;color:" +
        (isOpen ? m.tone : "#475569") +
        ";display:inline-block;transform:rotate(" +
        (isOpen ? "90deg" : "0deg") +
        ");transition:transform 150ms",
      codeCss: "font-size:10px;font-weight:700;white-space:nowrap;color:" + m.tone + ";font-family:" + MONO,
      titleCss: "font-size:11px;color:#94a3b8;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
      barCss:
        "grid-row:1;grid-column:" +
        g.start +
        " / span " +
        g.span +
        ";margin:9px 2px;display:flex;align-items:center;border-radius:3px;background:repeating-linear-gradient(135deg," +
        m.tone +
        "," +
        m.tone +
        " 4px," +
        m.tone +
        "b3 4px," +
        m.tone +
        "b3 8px);cursor:pointer;min-width:0;overflow:hidden",
      barTitle: m.id + " — " + m.title,
      barTextCss:
        "grid-row:1;grid-column:" +
        bt.col +
        " / span " +
        bt.span +
        ";display:flex;align-items:center;padding-left:9px;pointer-events:none;min-width:0;overflow:hidden",
      barLabel: g.label,
      barLabelCss: "font-size:10px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:" + m.tone,
      hasPhase: !!g.phase,
      phaseCss: g.phase
        ? "grid-row:1;grid-column:" +
          g.phase.start +
          " / span " +
          g.phase.span +
          ";margin:12px 2px;display:flex;align-items:center;padding:0 8px;border-radius:5px;border:1px dashed " +
          m.tone +
          "80;background:" +
          m.tone +
          "14;min-width:0;overflow:hidden"
        : "",
      phaseLabel: g.phase ? g.phase.label : "",
      phaseTitle: g.phase ? g.phase.label : "",
      phaseLabelCss: "font-size:9.5px;font-weight:600;color:" + m.tone + ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
      go: () => ctrl.patch({ focusCode: s.focusCode === m.id ? null : m.id }),
    };
  }).filter((r) => matchSF(r.code, SF));

  const trayDefs = [
    { code: "CR-0136", label: "Rolled back 6 August, 11 hours after deployment", tone: "#f87171", go: () => ctrl.patch({ focusCode: s.focusCode === "CR-0136" ? null : "CR-0136" }) },
    { code: CC_MSC_TRAY.id, label: CC_MSC_TRAY.label, tone: CC_MSC_TRAY.tone, go: () => ctrl.t("MC1042318 lands 1 October. CR-0142 is how you get in front of it — that is why the CR exists.") },
  ];
  const tray = trayDefs.filter((tD) => matchSF(tD.code, SF));

  const fzClashes = order.filter((c) => stateInFreeze(c, s.movedOv) && !s.freezeException);
  const freezeStrip = s.freezeOpen ? "" : FZ.label + " · " + FZ.owner.split(" · ")[0] + " owns it";
  const freezeClashLabel = s.freezeException
    ? "Exception granted for CR-0142 by " + FZ.owner.split(" · ")[0]
    : fzClashes.length
      ? fzClashes.join(", ") + " sits inside it"
      : "Nothing is aimed at it";
  const freezeClashPill = s.freezeException
    ? { text: "Exception granted", tone: "#34d399" }
    : fzClashes.length
      ? { text: fzClashes.length + " change collides", tone: "#f87171" }
      : { text: "Clear", tone: "#34d399" };

  // ── Focus expansion cards ──
  const kindStyle = (kind: string) => "font-size:16.5px;line-height:1.7;letter-spacing:-.005em;" + CC_KIND_CSS[kind];
  const briefCards: FocusCard[] = order
    .map((code): FocusCard | null => {
      const c = all.find((x) => x.code === code);
      if (!c) return null;
      const b = isLive ? briefFor(c) : CC_BRIEFS[code];
      if (!b) return null;
      const cmp = compOf(c);
      const needsYou = c.state === "Awaiting approval" && role === "approver";
      const clashHere = stateInFreeze(code, s.movedOv) && !s.freezeException;
      const movedTo = (s.movedOv || {})[code];
      const acts: { label: string; go: () => void; tone: string; border: string; bg: string }[] = [
        { label: "Open the full record", tone: "#93c5fd", border: "rgba(0,120,212,.4)", bg: "rgba(0,120,212,.1)", go: () => ctrl.patch({ view: "record", lastList: "briefing", openCode: c.code, sec: "request" }) },
      ];
      if (needsYou && cmp.done === cmp.total && !clashHere)
        acts.unshift({ label: "Approve and schedule", tone: "#fff", border: "#0078D4", bg: "#0078D4", go: () => ctrl.signForm(c.code, c.window) });
      if ((c.missing || []).length)
        acts.push({ label: "Fill the " + (c.missing || []).length + " missing sections", tone: "#fbbf24", border: "rgba(251,191,36,.35)", bg: "transparent", go: () => ctrl.patch({ view: "record", openCode: c.code, sec: (c.missing || [])[0] }) });
      acts.push({ label: "Ask ShaneBot", tone: "#22d3ee", border: "rgba(34,211,238,.32)", bg: "transparent", go: () => ctrl.t("ShaneBot: walk me through " + c.code + " as if I had ten seconds.") });
      return {
        code: c.code,
        isMs: false,
        group: b.group,
        groupSub: b.groupSub,
        time: b.time,
        timeSub: b.timeSub,
        dotCss: "width:11px;height:11px;border-radius:50%;background:" + stateTone(c.state) + ";box-shadow:0 0 0 4px " + stateTone(c.state) + "22",
        cardCss:
          "display:flex;flex-direction:column;gap:14px;padding:18px 20px;border:1px solid " +
          (s.focusCode === code ? "rgba(34,211,238,.5)" : needsYou ? "rgba(251,191,36,.32)" : "rgba(30,41,59,.95)") +
          ";border-radius:13px;background:" +
          (needsYou ? "linear-gradient(180deg,rgba(251,191,36,.06),rgba(11,21,36,.95))" : "#0b1524") +
          ";min-width:0;transition:border-color 180ms",
        statePill: { text: c.state, tone: stateTone(c.state), bg: stateTone(c.state) + "14" },
        riskPill: { text: c.risk + " risk", tone: riskTone(c.risk), bg: riskTone(c.risk) + "14" },
        needsPill: needsYou ? "Waiting on your signature" : "",
        needsCss: pill("Waiting on your signature", "#fbbf24", "rgba(251,191,36,.12)"),
        hasClash: clashHere,
        movedText: movedTo ? "Moved out of the freeze — now " + movedTo + ". The original window and the reason stay on the record." : "",
        clashTitle: "This lands inside the " + FZ.label + ", " + FZ.range,
        clashText: FZ.reason + " " + FZ.policy,
        clashActs: [
          { label: "Move the window", go: () => ctrl.moveForm(c.code), css: "padding:7px 12px;border-radius:6px;font-size:11px;font-weight:700;font-family:inherit;white-space:nowrap;cursor:pointer;border:1px solid rgba(248,113,113,.45);background:transparent;color:#f87171" },
          { label: "Grant a freeze exception", go: () => ctrl.exceptionForm(c.code), css: "padding:7px 12px;border-radius:6px;font-size:11px;font-weight:700;font-family:inherit;white-space:nowrap;cursor:pointer;border:1px solid rgba(251,191,36,.4);background:transparent;color:#fbbf24" },
        ],
        who: b.who,
        whoOrg: b.whoOrg,
        init: b.init,
        initCss: "flex:0 0 auto;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.25);color:#93c5fd;font-size:11px;font-weight:700;letter-spacing:.02em",
        where: b.where,
        whereNote: b.whereNote,
        wherePillCss: pill(b.where, "#2dd4bf", "rgba(45,212,191,.1)"),
        segs: b.sentence.map((seg) => ({ text: seg[0], css: kindStyle(seg[1]) })),
        why: b.why,
        ifWrong: b.ifWrong,
        rbLabel: c.rollbackReady ? "Rollback tested" : "No rollback plan",
        rbPillCss: pill(c.rollbackReady ? "Rollback tested" : "No rollback plan", c.rollbackReady ? "#34d399" : "#f87171", (c.rollbackReady ? "#34d399" : "#f87171") + "14"),
        how: b.how.map((h) => ({ call: h.call, result: h.result })),
        acts: acts.map((a) => ({ label: a.label, go: a.go, css: "padding:8px 13px;border-radius:7px;font-size:11.5px;font-weight:700;font-family:inherit;white-space:nowrap;cursor:pointer;border:1px solid " + a.border + ";background:" + a.bg + ";color:" + a.tone })),
      };
    })
    .filter((c): c is FocusCard => c !== null);

  const msCards: FocusCard[] = CC_MSC.map((m) => ({
    code: m.id,
    isMs: true,
    group: m.group,
    groupSub: m.groupSub,
    time: m.time,
    timeSub: m.timeSub,
    dotCss: "width:11px;height:11px;border-radius:2px;background:" + m.tone + ";box-shadow:0 0 0 4px " + m.tone + "22",
    cardCss:
      "display:flex;flex-direction:column;gap:14px;padding:18px 20px;border:1px solid " +
      m.tone +
      "4d;border-left:3px solid " +
      m.tone +
      ";border-radius:13px;background:linear-gradient(180deg," +
      m.tone +
      "0f,rgba(11,21,36,.95));min-width:0",
    statePill: { text: m.state, tone: m.tone, bg: m.tone + "14" },
    riskPill: { text: m.impact, tone: "#94a3b8", bg: "rgba(148,163,184,.08)" },
    needsPill: "Not yours to approve",
    needsCss: pill("Not yours to approve", "#a78bfa", "rgba(139,92,246,.12)"),
    hasClash: false,
    movedText: "",
    clashTitle: "",
    clashText: "",
    clashActs: [],
    who: "Microsoft",
    whoOrg: "Message Center " + m.id + " · no approval path, no signature",
    init: "MS",
    initCss: "flex:0 0 auto;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:" + m.tone + "1f;border:1px solid " + m.tone + "40;color:" + m.tone + ";font-size:11px;font-weight:700",
    where: "Your production tenant",
    whereNote: m.whereNote,
    wherePillCss: pill("Production · Microsoft-driven", m.tone, m.tone + "14"),
    segs: m.sentence.map((seg) => ({ text: seg[0], css: kindStyle(seg[1]) })),
    why: m.why,
    ifWrong: m.ifWrong,
    rbLabel: m.optOut ? "Opt-out until 21 Aug" : "No opt-out",
    rbPillCss: pill(m.optOut ? "Opt-out until 21 Aug" : "No opt-out", m.optOut ? "#fbbf24" : "#f87171", (m.optOut ? "#fbbf24" : "#f87171") + "14"),
    how: m.how.map((h) => ({ call: h.call, result: h.result })),
    acts: [
      { label: m.linkedCr, tone: "#fff", border: "#0078D4", bg: "#0078D4", go: () => ctrl.patch({ intakeOpen: true, draft: { ...s.draft, title: m.title, desc: m.how[0].call, just: "Getting ahead of " + m.id + " before Microsoft applies it for us.", scope: "Halden Materials tenant", deps: m.id, risk: "Medium" } }) },
      {
        label: "Acknowledge · no action",
        tone: "#94a3b8",
        border: "rgba(148,163,184,.25)",
        bg: "transparent",
        go: () =>
          ctrl.openForm({
            kicker: "Microsoft change",
            title: "Acknowledge " + m.id,
            intro: "Acknowledging is a decision, not a dismissal. It records that you saw it, chose to let it land, and why.",
            submitLabel: "Acknowledge it",
            values: { stance: "Let it land as Microsoft intends", note: "" },
            fields: [
              { k: "stance", label: "Your position", kind: "pick", options: ["Let it land as Microsoft intends", "Let it land, review after", "Not acceptable — raise a change instead"], req: true },
              { k: "note", label: "Why", kind: "area", req: true, ph: "The sentence you would want in front of you if this caused a problem in October." },
            ],
            done: (v) => (v.stance === "Not acceptable — raise a change instead" ? m.id + " marked as needing a change. Raise the CR from this card and it will be linked." : m.id + " acknowledged and logged with your reasoning. It stays on the timeline."),
          }),
      },
      { label: "Ask ShaneBot", tone: "#22d3ee", border: "rgba(34,211,238,.32)", bg: "transparent", go: () => ctrl.t("ShaneBot: what does " + m.id + " actually do to my tenant, and what should I change before it lands?") },
    ].map((a) => ({ label: a.label, go: a.go, css: "padding:8px 13px;border-radius:7px;font-size:11.5px;font-weight:700;font-family:inherit;white-space:nowrap;cursor:pointer;border:1px solid " + a.border + ";background:" + a.bg + ";color:" + a.tone })),
  }));

  const merged = briefCards.concat(msCards).sort((a, b) => CC_CARD_ORDER.indexOf(a.code) - CC_CARD_ORDER.indexOf(b.code));
  const briefGroups: { label: string; sub: string; cards: FocusCard[] }[] = [];
  merged
    .filter((c) => s.focusCode && c.code === s.focusCode)
    .forEach((c) => {
      const g = briefGroups.find((x) => x.label === c.group);
      if (g) g.cards.push(c);
      else briefGroups.push({ label: c.group, sub: c.groupSub, cards: [c] });
    });

  return (
    <div style={css("display:flex;flex-direction:column;gap:26px")} data-testid="cc-view-briefing">
      <div style={css("display:flex;flex-direction:column;gap:12px;padding:16px 18px;border:1px solid rgba(30,41,59,.9);border-radius:13px;background:#0b1524")}>
        <div style={css("display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap")}>
          <div style={css("display:flex;flex-direction:column;gap:3px")}>
            <span style={css("font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#60a5fa")}>When it lands</span>
            <span style={css("font-size:13.5px;font-weight:700;color:#f1f5f9;letter-spacing:-.01em")}>
              17 – 31 August · your change windows, your blackout, and what is aimed at them
            </span>
          </div>
          <div style={css("display:flex;align-items:center;gap:11px;flex-wrap:wrap")}>
            {CC_LEGEND.map((l) => (
              <div key={l.label} style={css("display:flex;align-items:center;gap:5px")}>
                <span style={css("width:8px;height:8px;border-radius:2px;background:" + l.tone)} />
                <span style={css("font-size:10px;color:#64748b;white-space:nowrap")}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Change freeze — collapsible */}
        <div style={css("display:flex;flex-direction:column;gap:0;border:1px solid rgba(30,41,59,.9);border-left:3px solid #f87171;border-radius:10px;background:rgba(2,6,23,.45);overflow:hidden")}>
          <button onClick={() => ctrl.patch({ freezeOpen: !s.freezeOpen })} style={css("display:flex;align-items:center;gap:10px;padding:9px 13px;border:none;background:transparent;cursor:pointer;font-family:inherit;text-align:left;width:100%;min-width:0")} data-testid="cc-freeze-toggle">
            <span style={css("flex:0 0 auto;display:flex;gap:2px")}>
              <span style={css("width:4px;height:13px;border-radius:1px;background:rgba(248,113,113,.85)")} />
              <span style={css("width:4px;height:13px;border-radius:1px;background:rgba(248,113,113,.55)")} />
              <span style={css("width:4px;height:13px;border-radius:1px;background:rgba(248,113,113,.3)")} />
            </span>
            <span style={css("flex:0 0 auto;font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#f87171;white-space:nowrap")}>Change freeze</span>
            <span style={css("flex:0 0 auto;font-size:11.5px;font-weight:600;color:#e2e8f0;white-space:nowrap")}>{FZ.range}</span>
            <span style={css("flex:1;min-width:0;font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{freezeStrip}</span>
            <span style={css(pill(freezeClashPill.text, freezeClashPill.tone, "rgba(148,163,184,.08)"))}>{freezeClashPill.text}</span>
            <span style={css("flex:0 0 auto;font-size:9px;color:#64748b;transition:transform .15s;transform:rotate(" + (s.freezeOpen ? "90deg" : "0deg") + ")")}>▸</span>
          </button>
          {s.freezeOpen && (
            <div style={css("display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:0 13px 13px 13px")}>
              <div style={css("display:flex;flex-direction:column;gap:4px;min-width:0")}>
                <span style={css("font-size:13px;font-weight:700;color:#f1f5f9;letter-spacing:-.01em")}>{FZ.label} · {FZ.range} · {freezeClashLabel}</span>
                <span style={css("font-size:11.5px;color:#94a3b8;line-height:1.6;max-width:88ch;text-wrap:pretty")}>{FZ.reason} {FZ.policy}</span>
                <span style={css("font-size:10.5px;color:#64748b")}>Freeze owner · {FZ.owner}</span>
                <span style={css("font-size:11px;font-weight:600;color:#fbbf24;line-height:1.5")}>
                  Microsoft does not observe it. MC1051144 lands on 26 August, four days in, and there is no approval path to stop it.
                </span>
              </div>
              <div style={css("display:flex;gap:8px;flex-wrap:wrap;flex:0 0 auto")}>
                {fzClashes.length > 0 && (
                  <button onClick={() => ctrl.exceptionForm("CR-0142")} style={css("padding:7px 12px;border-radius:6px;border:1px solid rgba(251,191,36,.4);background:transparent;color:#fbbf24;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap")}>
                    Grant a freeze exception
                  </button>
                )}
                {s.freezeException && (
                  <button onClick={() => ctrl.patch({ freezeException: false, toast: "Exception revoked. CR-0142 is blocked inside the freeze again." })} style={css("padding:7px 12px;border-radius:6px;border:1px solid rgba(148,163,184,.28);background:transparent;color:#94a3b8;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap")}>
                    Revoke the exception
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* The timeline */}
        <div style={css("display:flex;flex-direction:column;gap:0")}>
          <div style={css("display:grid;grid-template-columns:186px minmax(0,1fr);gap:0")}>
            <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569;align-self:end;padding-bottom:6px")}>Change request</span>
            <div style={css("display:grid;grid-template-columns:repeat(15,1fr)")}>
              <div
                style={css(
                  "grid-row:1;grid-column:" +
                    (FZ.from - 16) +
                    " / span " +
                    (FZ.to - FZ.from + 1) +
                    ";display:flex;align-items:center;justify-content:center;margin:0 1px 3px;padding:3px 6px;border-radius:4px;border:1px solid rgba(248,113,113,.55);background:repeating-linear-gradient(135deg,rgba(248,113,113,.28),rgba(248,113,113,.28) 5px,rgba(248,113,113,.12) 5px,rgba(248,113,113,.12) 10px);overflow:hidden",
                )}
              >
                <span style={css("font-size:9px;font-weight:700;letter-spacing:.06em;color:#a78bfa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>FROZEN · {FZ.label}</span>
              </div>
            </div>
            <span />
            <div style={css("display:grid;grid-template-columns:repeat(15,1fr)")}>
              {days.map((d, i) => (
                <div key={i} style={css(d.css)}>
                  <span style={css(d.wCss)}>{d.w}</span>
                  <span style={css(d.dCss)}>{d.d}</span>
                </div>
              ))}
            </div>
          </div>

          {ganttRows.length === 0 && (
            <div style={css("padding:14px 2px;font-size:11.5px;color:#64748b")} data-testid="cc-briefing-empty">
              {isLive && all.length === 0
                ? "No change requests exist for this tenant yet."
                : "Nothing of yours is aimed at these two weeks under this filter — check the off-timeline items below."}
            </div>
          )}
          {ganttRows.map((r) => (
            <div key={r.code} style={css(r.rowCss)} data-testid={`cc-gantt-row-${r.code}`}>
              <button onClick={r.go} style={css(r.labelCss)}>
                <span style={css("display:flex;align-items:center;gap:5px;min-width:0")}>
                  <span style={css(r.caretCss)}>▸</span>
                  <span style={css(r.codeCss)}>{r.code}</span>
                </span>
                <span style={css(r.titleCss)}>{r.title}</span>
              </button>
              <div style={css("display:grid;grid-template-columns:repeat(15,1fr);position:relative")}>
                {cells.map((c, i) => (
                  <div key={i} style={css(c.css)} />
                ))}
                {r.hasPhase && (
                  <div onClick={r.go} title={r.phaseTitle} style={css(r.phaseCss)}>
                    <span style={css(r.phaseLabelCss)}>{r.phaseLabel}</span>
                  </div>
                )}
                {r.hasBar && <div onClick={r.go} title={r.barTitle} style={css(r.barCss)} />}
                {r.hasBar && (
                  <div style={css(r.barTextCss)}>
                    <span style={css(r.barLabelCss)}>{r.barLabel}</span>
                  </div>
                )}
                {r.unscheduled && (
                  <div onClick={r.go} style={css(r.blockedCss)}>
                    <span style={css(r.blockedTextCss)}>{r.blockedLabel}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Microsoft rows */}
        <div style={css("display:flex;flex-direction:column;gap:0")}>
          <div style={css("display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:12px 0 7px;border-top:1px solid rgba(30,41,59,.9)")}>
            <span style={css("font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#f87171")}>Microsoft · not yours to approve</span>
            <span style={css("font-size:11px;color:#64748b")}>Message Center items landing in this window. Microsoft does not observe your freeze, your change policy or your blackout.</span>
          </div>
          {msRows.length === 0 && <div style={css("padding:14px 2px;font-size:11.5px;color:#64748b")}>No Microsoft change matches this filter.</div>}
          {msRows.map((r) => (
            <div key={r.code} style={css(r.rowCss)} data-testid={`cc-ms-row-${r.code}`}>
              <button onClick={r.go} style={css(r.labelCss)}>
                <span style={css("display:flex;align-items:center;gap:5px;min-width:0")}>
                  <span style={css(r.caretCss)}>▸</span>
                  <span style={css(r.codeCss)}>{r.code}</span>
                </span>
                <span style={css(r.titleCss)}>{r.title}</span>
              </button>
              <div style={css("display:grid;grid-template-columns:repeat(15,1fr);position:relative")}>
                {cells.map((c, i) => (
                  <div key={i} style={css(c.css)} />
                ))}
                {r.hasPhase && (
                  <div onClick={r.go} title={r.phaseTitle} style={css(r.phaseCss)}>
                    <span style={css(r.phaseLabelCss)}>{r.phaseLabel}</span>
                  </div>
                )}
                <div onClick={r.go} title={r.barTitle} style={css(r.barCss)} />
                <div style={css(r.barTextCss)}>
                  <span style={css(r.barLabelCss)}>{r.barLabel}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Collisions */}
        <div style={css("display:flex;flex-direction:column;gap:9px;padding-top:12px;border-top:1px solid rgba(30,41,59,.7)")}>
          <div style={css("display:flex;align-items:baseline;gap:10px;flex-wrap:wrap")}>
            <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#fbbf24")}>Collisions detected</span>
            <span style={css("font-size:11px;color:#64748b")}>Two changes aimed at the same surface inside a fortnight. Order matters, and neither record knows about the other.</span>
          </div>
          <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px")}>
            {CC_CONFLICTS.map((c) => (
              <div key={c.a + c.b} style={css("display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:1px solid " + c.tone + "3d;border-radius:10px;background:" + c.tone + "0a;min-width:0")}>
                <span style={css("font-size:12px;font-weight:700;color:" + c.tone + ";line-height:1.4")}>{c.a} ⇄ {c.b}</span>
                <span style={css("font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748b")}>{c.surface}</span>
                <span style={css("font-size:11.5px;color:#cbd5e1;line-height:1.6;text-wrap:pretty")}>{c.note}</span>
                <button onClick={() => ctrl.t("ShaneBot: " + c.a + " and " + c.b + " both touch " + c.surface.toLowerCase() + ". What order should they run in?")} style={css("align-self:flex-start;padding:5px 11px;border-radius:6px;border:1px solid rgba(34,211,238,.32);background:transparent;color:#22d3ee;font-size:10.5px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap")}>
                  Ask which order
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Off the timeline */}
        <div style={css("display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:10px;border-top:1px solid rgba(30,41,59,.7)")}>
          <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569")}>Off the timeline</span>
          {tray.map((tD) => (
            <button key={tD.code} onClick={tD.go} style={css("display:flex;align-items:center;gap:9px;padding:7px 11px;border-radius:7px;border:1px solid " + tD.tone + "3d;background:" + tD.tone + "0f;cursor:pointer;font-family:inherit;text-align:left")}>
              <span style={css("font-size:10px;font-weight:700;white-space:nowrap;color:" + tD.tone + ";font-family:" + MONO)}>{tD.code}</span>
              <span style={css("font-size:11px;color:#94a3b8;white-space:nowrap")}>{tD.label}</span>
            </button>
          ))}
        </div>
      </div>

      {!s.focusCode && (
        <div style={css("padding:13px 16px;border:1px dashed rgba(148,163,184,.22);border-radius:11px;background:rgba(2,6,23,.3);font-size:11.5px;color:#64748b;line-height:1.55")}>
          Click any row above for the full record — who, what, when, where, why, how, and what happens if it goes wrong.
        </div>
      )}

      {briefGroups.map((g) => (
        <div key={g.label} style={css("display:flex;flex-direction:column;gap:12px")}>
          <div style={css("display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding-bottom:8px;border-bottom:1px solid rgba(30,41,59,.8)")}>
            <span style={css("font-size:14px;font-weight:800;color:#f8fafc;letter-spacing:-.01em")}>{g.label}</span>
            <span style={css("font-size:11.5px;color:#64748b")}>{g.sub}</span>
          </div>
          {g.cards.map((c) => (
            <FocusCardView key={c.code} c={c} />
          ))}
        </div>
      ))}
    </div>
  );
}

function FocusCardView({ c }: { c: FocusCard }) {
  return (
    <div style={css("display:grid;grid-template-columns:86px minmax(0,1fr);gap:14px;align-items:start")}>
      <div style={css("display:flex;flex-direction:column;gap:4px;align-items:flex-end;padding-top:16px")}>
        <span style={css("font-size:15px;font-weight:800;color:#e2e8f0;letter-spacing:-.02em;font-family:" + MONO)}>{c.time}</span>
        <span style={css("font-size:10px;color:#64748b;text-align:right;line-height:1.4")}>{c.timeSub}</span>
        <span style={css(c.dotCss)} />
      </div>
      <div style={css(c.cardCss)} data-testid={`cc-focus-card-${c.code}`}>
        <div style={css("display:flex;align-items:center;gap:10px;flex-wrap:wrap")}>
          <span style={css("font-size:11px;font-weight:700;color:#60a5fa;font-family:" + MONO)}>{c.code}</span>
          <Pill text={c.statePill.text} tone={c.statePill.tone} bg={c.statePill.bg} />
          <Pill text={c.riskPill.text} tone={c.riskPill.tone} bg={c.riskPill.bg} />
          {c.needsPill && <span style={css(c.needsCss)}>{c.needsPill}</span>}
        </div>

        {c.movedText && (
          <div style={css("display:flex;align-items:flex-start;gap:9px;padding:11px 13px;border:1px solid rgba(251,191,36,.35);border-radius:10px;background:rgba(251,191,36,.05)")}>
            <span style={css("font-size:11.5px;color:#fbbf24;line-height:1.55;text-wrap:pretty")}>{c.movedText}</span>
          </div>
        )}

        {c.hasClash && (
          <div style={css("display:flex;flex-direction:column;gap:9px;padding:12px 14px;border:1px solid rgba(248,113,113,.4);border-radius:10px;background:repeating-linear-gradient(135deg,rgba(248,113,113,.10),rgba(248,113,113,.10) 6px,rgba(248,113,113,.04) 6px,rgba(248,113,113,.04) 12px)")}>
            <span style={css("font-size:11.5px;font-weight:700;color:#f87171;line-height:1.45")}>{c.clashTitle}</span>
            <span style={css("font-size:11.5px;color:#cbd5e1;line-height:1.6;max-width:80ch;text-wrap:pretty")}>{c.clashText}</span>
            <div style={css("display:flex;gap:8px;flex-wrap:wrap")}>
              {c.clashActs.map((a) => (
                <button key={a.label} onClick={a.go} style={css(a.css)}>{a.label}</button>
              ))}
            </div>
          </div>
        )}

        <div style={css("display:block;max-width:78ch")}>
          {c.segs.map((seg, i) => (
            <span key={i} style={css(seg.css)}>{seg.text}</span>
          ))}
        </div>

        <div style={css("display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:11px 0;border-top:1px solid rgba(30,41,59,.7);border-bottom:1px solid rgba(30,41,59,.7)")}>
          <div style={css("display:flex;align-items:center;gap:9px;min-width:0")}>
            <span style={css(c.initCss)}>{c.init}</span>
            <div style={css("display:flex;flex-direction:column;gap:1px;min-width:0")}>
              <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569")}>Who</span>
              <span style={css("font-size:12px;font-weight:700;color:#f1f5f9;line-height:1.4")}>{c.who}</span>
              <span style={css("font-size:10.5px;color:#64748b;line-height:1.4")}>{c.whoOrg}</span>
            </div>
          </div>
          <div style={css("display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 240px")}>
            <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569")}>Where</span>
            <span style={css(c.wherePillCss)}>{c.where}</span>
            <span style={css("font-size:10.5px;color:#64748b;line-height:1.45")}>{c.whereNote}</span>
          </div>
        </div>

        <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px")}>
          <div style={css("display:flex;flex-direction:column;gap:5px;min-width:0")}>
            <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569")}>Why</span>
            <span style={css("font-size:12.5px;color:#cbd5e1;line-height:1.6;text-wrap:pretty")}>{c.why}</span>
          </div>
          <div style={css("display:flex;flex-direction:column;gap:6px;min-width:0")}>
            <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569")}>How</span>
            {c.how.map((h, i) => (
              <div key={i} style={css("display:flex;flex-direction:column;gap:3px;padding:8px 10px;border:1px solid rgba(30,41,59,.9);border-radius:7px;background:rgba(2,6,23,.5);min-width:0")}>
                <span style={css("font-size:11px;color:#93c5fd;font-family:" + MONO + ";line-height:1.5;word-break:break-all")}>{h.call}</span>
                <span style={css("font-size:10.5px;color:#34d399;line-height:1.45")}>→ {h.result}</span>
              </div>
            ))}
          </div>
          <div style={css("display:flex;flex-direction:column;gap:5px;min-width:0")}>
            <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569")}>If it goes wrong</span>
            <span style={css(c.rbPillCss)}>{c.rbLabel}</span>
            <span style={css("font-size:12.5px;color:#cbd5e1;line-height:1.6;text-wrap:pretty")}>{c.ifWrong}</span>
          </div>
        </div>

        <div style={css("display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:2px")}>
          {c.acts.map((a) => (
            <button key={a.label} onClick={a.go} style={css(a.css)}>{a.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Register: the filterable table of every change request ─────────────────── */

const REG_GRID = "minmax(220px,2.6fr) 80px 56px 112px minmax(136px,1.3fr) 118px 92px 68px";

function RegisterView({ ctrl }: { ctrl: CcController }) {
  const { s } = ctrl;
  const all = ctrl.crs();
  const rows = filterRegister(all, { query: s.query, fRisk: s.fRisk, fState: s.fState, fWork: s.fWork, statFilter: s.statFilter, statSets: ctrl.statSets() });
  const rowCount = rows.length + " of " + all.length + " change requests" + (s.statFilter ? " · filtered" : "");
  const filters: { label: string; value: string; options: string[]; onChange: (v: string) => void }[] = [
    { label: "Risk", value: s.fRisk, options: ["All risk", "High", "Medium", "Low"], onChange: (v) => ctrl.patch({ fRisk: v }) },
    { label: "State", value: s.fState, options: ["All states", "Draft", "Awaiting approval", "In test", "Rolled back", "Emergency · retro approval due"], onChange: (v) => ctrl.patch({ fState: v }) },
    { label: "Workload", value: s.fWork, options: ["All workloads", "Exchange Online", "Microsoft Teams", "SharePoint", "Entra ID"], onChange: (v) => ctrl.patch({ fWork: v }) },
  ];
  const columns = [
    { label: "Change request", title: "Code, title, workload, linked Message Center post and ITIL class" },
    { label: "Risk", title: "Risk category from the impact assessment" },
    { label: "AI", title: "Automated risk score out of 100" },
    { label: "Pipeline", title: "Dev · Test · Stage · Prod — dimmed means not provisioned in this tenant" },
    { label: "Approval", title: "Approval state and who it is waiting on" },
    { label: "Window", title: "Deployment window and countdown" },
    { label: "Record", title: "Required sections complete" },
    { label: "Rollback", title: "Whether a tested rollback plan is on the record" },
  ];

  return (
    <div style={css("display:flex;flex-direction:column;gap:12px")} data-testid="cc-view-register">
      <div style={css("display:flex;align-items:center;gap:10px;flex-wrap:wrap")}>
        <div style={css("flex:1 1 200px;max-width:300px;display:flex;align-items:center;gap:8px;background:#0b1a2e;border:1px solid rgba(148,163,184,.16);border-radius:7px;padding:8px 11px")}>
          <span style={css("font-size:12px;color:#64748b")}>⌕</span>
          <input
            data-testid="cc-register-search"
            value={s.query}
            onChange={(e) => ctrl.patch({ query: e.target.value })}
            placeholder="Search CR, title, workload or MC ID…"
            style={css("flex:1;background:transparent;border:none;outline:none;color:#e2e8f0;font-size:12px;font-family:inherit")}
          />
        </div>
        {filters.map((f) => (
          <div key={f.label} style={css("display:flex;flex-direction:column;gap:4px;min-width:0")}>
            <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569")}>{f.label}</span>
            <select value={f.value} onChange={(e) => f.onChange(e.target.value)} style={css("min-width:150px;padding:7px 10px;border-radius:7px;border:1px solid rgba(30,41,59,.9);background:#0b1a2e;color:#e2e8f0;font-size:11.5px;font-family:inherit;cursor:pointer")}>
              {f.options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
        ))}
        <span style={css("margin-left:auto;font-size:10.5px;color:#475569")}>{rowCount}</span>
      </div>

      <div style={css("border:1px solid rgba(30,41,59,.9);border-radius:11px;background:#0b1524;overflow-x:auto;overflow-y:hidden")}>
        <div style={css("display:grid;grid-template-columns:" + REG_GRID + ";gap:12px;padding:10px 16px;border-bottom:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5);min-width:970px")}>
          {columns.map((c) => (
            <span key={c.label} title={c.title} style={css("font-size:9px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:#475569")}>
              {c.label}
            </span>
          ))}
        </div>
        {rows.map((c) => {
          const comp = compOf(c);
          const aiT = aiTone(c.aiScore);
          const appr = apprState(c.state);
          return (
            <div
              key={c.code}
              data-testid={`cc-register-row-${c.code}`}
              onClick={() => ctrl.patch({ view: "record", lastList: "register", openCode: c.code, sec: "request" })}
              style={css("display:grid;grid-template-columns:" + REG_GRID + ";gap:12px;min-width:970px;padding:13px 16px;border-bottom:1px solid rgba(30,41,59,.55);cursor:pointer;align-items:center")}
            >
              <div style={css("display:flex;flex-direction:column;gap:3px;min-width:0")}>
                <div style={css("display:flex;align-items:baseline;gap:8px;min-width:0")}>
                  <span style={css("font-size:11px;font-weight:700;color:#60a5fa;font-family:" + MONO + ";flex:0 0 auto")}>{c.code}</span>
                  <span style={css("font-size:12.5px;font-weight:600;color:#f1f5f9;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{c.title}</span>
                </div>
                <div style={css("display:flex;align-items:center;gap:8px;flex-wrap:wrap")}>
                  <span style={css("font-size:10.5px;color:#64748b")}>{c.workload}</span>
                  {c.mc && (
                    <span style={css("font-size:10px;color:#93c5fd;font-family:" + MONO + ";padding:1px 5px;border-radius:4px;background:rgba(96,165,250,.1);border:1px solid rgba(96,165,250,.2)")}>{c.mc}</span>
                  )}
                  <span style={css("font-size:10.5px;color:#475569")}>{c.cls + " change"}</span>
                </div>
              </div>
              <Pill text={c.risk} tone={riskTone(c.risk)} bg={riskTone(c.risk) + "14"} />
              <div style={css("display:flex;flex-direction:column;gap:3px")}>
                <span style={css("font-size:14px;font-weight:800;letter-spacing:-.02em;color:" + aiT)}>{c.aiScore}</span>
                <div style={css("height:3px;border-radius:2px;background:rgba(148,163,184,.14);overflow:hidden")}>
                  <div style={css("height:100%;width:" + c.aiScore + "%;background:" + aiT)} />
                </div>
              </div>
              <div style={css("display:flex;align-items:center;gap:3px")}>
                {c.pipe.map((p) => (
                  <span
                    key={p.name}
                    title={p.name + " — " + p.status}
                    style={css(
                      "width:24px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:4px;font-size:9.5px;font-weight:700;color:" +
                        (p.prov ? p.tone || "#94a3b8" : "#334155") +
                        ";background:" +
                        (p.prov ? "rgba(148,163,184,.08)" : "transparent") +
                        ";border:1px " +
                        (p.prov ? "solid" : "dashed") +
                        " " +
                        (p.prov ? (p.tone || "#94a3b8") + "40" : "rgba(51,65,85,.7)"),
                    )}
                  >
                    {p.name.charAt(0)}
                  </span>
                ))}
              </div>
              <div style={css("display:flex;flex-direction:column;gap:2px;min-width:0")}>
                <span style={css("font-size:11.5px;font-weight:600;color:" + appr.tone)}>{appr.label}</span>
                <span style={css("font-size:10.5px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                  {c.approvals.approver.name === "Not assigned" ? "No approver assigned" : c.approvals.approver.name}
                </span>
              </div>
              <div style={css("display:flex;flex-direction:column;gap:2px;min-width:0")}>
                <span style={css("font-size:11.5px;color:#cbd5e1;line-height:1.35")}>{c.window}</span>
                <span style={css("font-size:10.5px;color:" + (c.countdown === "tomorrow" ? "#fbbf24" : "#64748b"))}>{c.countdown}</span>
              </div>
              <div style={css("display:flex;flex-direction:column;gap:3px")}>
                <span style={css("font-size:11.5px;font-weight:700;color:" + (comp.done === comp.total ? "#34d399" : "#fbbf24"))}>{comp.done} of {comp.total}</span>
                <div style={css("height:3px;border-radius:2px;background:rgba(148,163,184,.14);overflow:hidden")}>
                  <div style={css("height:100%;width:" + comp.pct + "%;background:" + (comp.done === comp.total ? "#34d399" : "#fbbf24"))} />
                </div>
              </div>
              <Pill text={c.rollbackReady ? "Tested" : "None"} tone={c.rollbackReady ? "#34d399" : "#f87171"} bg={(c.rollbackReady ? "#34d399" : "#f87171") + "14"} />
            </div>
          );
        })}
        {rows.length === 0 && <div style={css("padding:34px 16px;text-align:center;font-size:12px;color:#64748b")}>No change requests match those filters.</div>}
      </div>

      <div style={css("display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:10.5px;color:#475569")}>
        <span>Pipeline stages read Dev · Test · Stage · Prod. A dimmed stage is not provisioned in this tenant.</span>
        <span style={css("margin-left:auto")}>
          <a href="#" onClick={(e) => { e.preventDefault(); openExportForm(ctrl); }} style={css("color:#60a5fa")}>Export the CR register</a>
        </span>
      </div>
    </div>
  );
}

/** proto exportGo — the export-the-register form. */
function openExportForm(ctrl: CcController) {
  ctrl.openForm({
    kicker: "Export",
    title: "Export the change register",
    intro: "Pick what you need. The evidence bundle is the one an auditor asks for; the CSV is the one you paste into a board pack.",
    submitLabel: "Build the export",
    values: { format: "Sealed evidence bundle · PDF + attachments", range: "Last 90 days", include: true },
    fields: [
      { k: "format", label: "Format", kind: "pick", options: ["Sealed evidence bundle · PDF + attachments", "CSV · one row per change", "JSON · full records and audit log"], req: true },
      { k: "range", label: "Period", kind: "pick", options: ["Last 30 days", "Last 90 days", "This financial year", "Everything"], req: true },
      { k: "include", label: "Contents", kind: "toggle", toggleLabel: "Include Microsoft Message Center items and freeze history", req: false },
    ],
    done: (v) => String(v.format).split(" · ")[0] + " built for " + String(v.range).toLowerCase() + (v.include ? ", including Microsoft changes and freeze history" : "") + ". Sealed and timestamped.",
  });
}

/* ── Catalogue: pre-approved standard changes ──────────────────────────────── */

function CatalogueView({ ctrl }: { ctrl: CcController }) {
  const { s } = ctrl;
  const catQ = (s.catQ || "").trim().toLowerCase();
  const catCat = s.catCat || "All";
  const cats = ["All", ...CC_CATS].map((k) => {
    const n = k === "All" ? CC_CATALOGUE.length : CC_CATALOGUE.filter((x) => x.cat === k).length;
    const on = catCat === k;
    return { label: k, count: String(n), on };
  });
  const catMatch = CC_CATALOGUE.filter(
    (x) => (catCat === "All" || x.cat === catCat) && (!catQ || (x.name + " " + x.what + " " + x.cat + " " + x.guard).toLowerCase().indexOf(catQ) >= 0),
  );
  const catTop = CC_CATALOGUE.slice()
    .sort((a, b) => (b.n || 0) - (a.n || 0))
    .slice(0, 5);
  const catRun = (c: CatalogueItem) => () =>
    ctrl.patch({ intakeOpen: true, intakeMode: "standard", draft: { ...s.draft, title: c.name, desc: c.what, just: "Standard change from the pre-approved catalogue.", scope: c.cat } });
  const catGroups = (catCat === "All" ? [...CC_CATS] : [catCat])
    .map((g) => ({ label: g, items: catMatch.filter((x) => x.cat === g) }))
    .filter((g) => g.items.length > 0);

  return (
    <div style={css("display:flex;flex-direction:column;gap:14px")} data-testid="cc-view-catalogue">
      <div style={css("display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap")}>
        <div style={css("display:flex;flex-direction:column;gap:5px;max-width:80ch")}>
          <span style={css("font-size:15px;font-weight:800;color:#f8fafc;letter-spacing:-.01em")}>Standard changes · {CC_CATALOGUE.length} pre-approved</span>
          <span style={css("font-size:12px;color:#94a3b8;line-height:1.6;text-wrap:pretty")}>
            Agreed once, then run without ceremony. No peer review, no window, no approval — each one still lands on the register with who ran it and what it changed.
          </span>
        </div>
        <input
          value={s.catQ || ""}
          onChange={(e) => ctrl.patch({ catQ: e.target.value })}
          placeholder="Search by what you are trying to do"
          style={css("flex:0 1 300px;min-width:220px;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid rgba(148,163,184,.22);background:#0b1a2e;color:#e2e8f0;font-size:12px;font-family:inherit;outline:none")}
        />
      </div>

      <div style={css("display:flex;flex-direction:column;gap:7px")}>
        <span style={css("font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#475569")}>Most used this month</span>
        <div style={css("display:flex;flex-wrap:wrap;gap:8px")}>
          {catTop.map((c) => (
            <button key={c.name} onClick={catRun(c)} style={css("display:flex;flex-direction:column;gap:3px;padding:10px 13px;border-radius:10px;cursor:pointer;font-family:inherit;text-align:left;flex:1 1 170px;min-width:160px;border:1px solid rgba(52,211,153,.28);background:linear-gradient(160deg,rgba(52,211,153,.08),rgba(11,21,36,.6))")}>
              <span style={css("font-size:12px;font-weight:700;color:#e2e8f0;line-height:1.35")}>{c.name}</span>
              <span style={css("font-size:10px;color:#5eead4;font-family:" + MONO)}>{c.n} this month</span>
            </button>
          ))}
        </div>
      </div>

      <div style={css("display:flex;align-items:center;gap:7px;flex-wrap:wrap")}>
        {cats.map((c) => (
          <button
            key={c.label}
            onClick={() => ctrl.patch({ catCat: c.label })}
            style={css("display:flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;cursor:pointer;font-family:inherit;border:1px solid " + (c.on ? "rgba(0,120,212,.7)" : "rgba(148,163,184,.18)") + ";background:" + (c.on ? "rgba(0,120,212,.16)" : "transparent"))}
          >
            <span style={css("font-size:11.5px;font-weight:" + (c.on ? "800" : "600") + ";color:" + (c.on ? "#dbeafe" : "#94a3b8") + ";white-space:nowrap")}>{c.label}</span>
            <span style={css("font-size:10px;font-weight:700;color:" + (c.on ? "#93c5fd" : "#475569"))}>{c.count}</span>
          </button>
        ))}
        <span style={css("margin-left:auto;font-size:10.5px;color:#475569")}>{catMatch.length} shown</span>
      </div>

      {catGroups.map((g) => (
        <div key={g.label} style={css("display:flex;flex-direction:column;gap:7px")}>
          <span style={css("font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#475569")}>{g.label}</span>
          <div style={css("display:flex;flex-direction:column;gap:0;border:1px solid rgba(30,41,59,.9);border-radius:11px;background:rgba(15,23,42,.35);overflow:hidden")}>
            {g.items.map((x) => {
              const open = s.catOpen === x.name;
              return (
                <div key={x.name} style={css("display:flex;flex-direction:column;gap:0;border-top:1px solid rgba(30,41,59,.8);background:" + (open ? "rgba(148,163,184,.04)" : "transparent"))}>
                  <div style={css("display:flex;align-items:center;gap:11px;padding:11px 14px")}>
                    <button onClick={() => ctrl.patch({ catOpen: open ? null : x.name })} style={css("flex:1;min-width:0;display:flex;align-items:center;gap:11px;border:none;background:none;cursor:pointer;font-family:inherit;text-align:left;padding:0")}>
                      <span style={css("flex:0 0 10px;font-size:11px;color:#64748b")}>{open ? "⌄" : "›"}</span>
                      <span style={css("flex:0 0 auto;font-size:12.5px;font-weight:700;color:#e2e8f0;line-height:1.4")}>{x.name}</span>
                      <span style={css("flex:1;min-width:0;font-size:11px;color:#64748b;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{x.what}</span>
                      <span style={css("flex:0 0 auto;font-size:10px;color:#475569;font-family:" + MONO)}>{x.n}×</span>
                    </button>
                    <button onClick={catRun(x)} style={css("flex:0 0 auto;padding:6px 12px;border-radius:7px;border:1px solid rgba(52,211,153,.4);background:rgba(52,211,153,.1);color:#34d399;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap")}>Run it</button>
                  </div>
                  {open && (
                    <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:11px;padding:2px 14px 14px 35px")}>
                      {[
                        { h: "What it does", v: x.what, tone: "#cbd5e1" },
                        { h: "Who can run it", v: x.who, tone: "#cbd5e1" },
                        { h: "Approval", v: x.approval, tone: "#cbd5e1" },
                        { h: "Where it refuses", v: x.guard, tone: "#fca5a5" },
                      ].map((f) => (
                        <div key={f.h} style={css("display:flex;flex-direction:column;gap:2px")}>
                          <span style={css("font-size:9px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#64748b")}>{f.h}</span>
                          <span style={css("font-size:11.5px;color:" + f.tone + ";line-height:1.55;text-wrap:pretty")}>{f.v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {catMatch.length === 0 && (
        <span style={css("font-size:12px;color:#64748b;line-height:1.6")}>Nothing matches that. If you do it often and it always gets approved, it belongs in here — propose it below.</span>
      )}

      <div style={css("display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:14px 16px;border:1px dashed rgba(34,211,238,.32);border-radius:11px;background:rgba(34,211,238,.04)")}>
        <div style={css("display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 320px")}>
          <span style={css("font-size:9.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#22d3ee")}>Candidate for the catalogue</span>
          <span style={css("font-size:13px;font-weight:700;color:#f1f5f9")}>{CC_CAT_PROMOTE.name}</span>
          <span style={css("font-size:11.5px;color:#cbd5e1;line-height:1.6;text-wrap:pretty")}>{CC_CAT_PROMOTE.note} {CC_CAT_PROMOTE.gain}</span>
        </div>
        <button onClick={() => openPromoteForm(ctrl)} style={css("padding:8px 13px;border-radius:7px;border:1px solid rgba(34,211,238,.4);background:transparent;color:#22d3ee;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap")}>
          Propose it at the next review
        </button>
      </div>
    </div>
  );
}

/** proto promote.go — the promote-to-catalogue form. */
function openPromoteForm(ctrl: CcController) {
  ctrl.openForm({
    kicker: "Standard change catalogue",
    title: 'Promote "' + CC_CAT_PROMOTE.name + '"',
    intro: "A standard change is agreed once and then runs without ceremony. Write the guardrail carefully — it is the only thing standing between pre-approved and unsupervised.",
    submitLabel: "Propose it at the next review",
    values: { who: "Your IT team, or ours", guard: "", window: "Any time · no window needed" },
    fields: [
      { k: "who", label: "Who may run it", kind: "pick", options: ["Your IT team, or ours", "Our engineers only", "Your IT team only"], req: true },
      { k: "guard", label: "Guardrail", kind: "area", req: true, ph: "What makes it stop being routine and go back to the full path? e.g. more than 5 guests at once, or a domain outside the approved list." },
      { k: "window", label: "Window", kind: "pick", options: ["Any time · no window needed", "Business hours only", "Inside the standard change window"], req: true },
    ],
    onSubmit: (v) => ({ agendaOv: ctrl.agenda().concat([{ code: "CAT", item: 'Approve "' + CC_CAT_PROMOTE.name + '" as a standard change · guardrail: ' + String(v.guard), mins: "5 min" }]) }),
    done: "Proposed, and added to Thursday's agenda. Once the review agrees it, the request drops the peer review and the window.",
  });
}

/* ── Calendar: the freeze calendar and declared freezes ────────────────────── */

function CalendarView({ ctrl }: { ctrl: CcController }) {
  const { s } = ctrl;
  const freezeRows = ctrl.freezes();
  const cal = buildCalendar(s.calMonth, freezeRows, s.calDay, ctrl.calEvents());

  return (
    <div style={css("display:flex;flex-direction:column;gap:20px")} data-testid="cc-view-calendar">
      <div style={css("display:flex;flex-direction:column;gap:12px")}>
        <div style={css("display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap")}>
          <div style={css("display:flex;flex-direction:column;gap:5px;max-width:88ch")}>
            <span style={css("font-size:14px;font-weight:800;color:#f8fafc;letter-spacing:-.01em")}>Your freeze calendar</span>
            <span style={css("font-size:12px;color:#94a3b8;line-height:1.6;text-wrap:pretty")}>
              Declare a freeze the way you book time off: name it, set the dates, name the owner. It blocks every window on every timeline from that moment. Microsoft is not bound by it, so anything Microsoft is doing in the same dates is shown against it.
            </span>
          </div>
          <button onClick={() => openFreezeAddForm(ctrl)} style={css("padding:9px 15px;border-radius:7px;border:1px solid #0078D4;background:#0078D4;color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap")}>
            Declare a freeze
          </button>
        </div>

        <div style={css("display:flex;flex-direction:column;gap:10px;padding:15px 16px;border:1px solid rgba(30,41,59,.9);border-radius:12px;background:#0b1524")}>
          <div style={css("display:flex;align-items:center;gap:10px;flex-wrap:wrap")}>
            <button onClick={() => ctrl.patch({ calMonth: s.calMonth - 1 })} style={css("flex:0 0 auto;width:26px;height:26px;border-radius:6px;border:1px solid rgba(148,163,184,.22);background:transparent;color:#94a3b8;font-size:12px;cursor:pointer;font-family:inherit")}>‹</button>
            <span style={css("font-size:13.5px;font-weight:800;color:#f8fafc;letter-spacing:-.01em;min-width:150px")}>{cal.title}</span>
            <button onClick={() => ctrl.patch({ calMonth: s.calMonth + 1 })} style={css("flex:0 0 auto;width:26px;height:26px;border-radius:6px;border:1px solid rgba(148,163,184,.22);background:transparent;color:#94a3b8;font-size:12px;cursor:pointer;font-family:inherit")}>›</button>
            <button onClick={() => ctrl.patch({ calMonth: 0 })} style={css("flex:0 0 auto;padding:5px 10px;border-radius:6px;border:1px solid rgba(34,211,238,.35);background:transparent;color:#22d3ee;font-size:10.5px;font-weight:700;cursor:pointer;font-family:inherit")}>Today</button>
            <span style={css("margin-left:auto;font-size:10.5px;color:#64748b;text-align:right")}>{cal.note}</span>
          </div>
          <div style={css("display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px")}>
            {cal.dows.map((w) => (
              <span key={w} style={css("font-size:9px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:#475569;padding-bottom:2px")}>{w}</span>
            ))}
            {cal.cells.map((c, i) => {
              if (c.blank) return <div key={i} style={css("min-height:66px;border-radius:8px;background:transparent")} />;
              const cellCss =
                "display:flex;flex-direction:column;gap:3px;min-height:66px;padding:5px 6px;border-radius:8px;text-align:left;font-family:inherit;cursor:" +
                (c.hasSomething ? "pointer" : "default") +
                ";border:1px solid " +
                (c.sel ? "#22d3ee" : c.today ? "rgba(34,211,238,.6)" : c.fzTone ? c.fzTone + "4d" : "rgba(30,41,59,.7)") +
                ";background:" +
                (c.sel ? "rgba(34,211,238,.12)" : c.fzTone ? c.fzTone + "1a" : c.weekend ? "rgba(2,6,23,.5)" : "rgba(2,6,23,.28)");
              const numCss =
                "font-size:10.5px;font-weight:" +
                (c.today ? "800" : "600") +
                ";color:" +
                (c.today ? "#22d3ee" : c.fzTone ? "#f1f5f9" : c.weekend ? "#475569" : "#94a3b8") +
                ";font-family:" +
                MONO;
              return (
                <button key={i} onClick={c.hasSomething ? () => ctrl.patch({ calDay: s.calDay === c.key ? null : c.key || null }) : undefined} style={css(cellCss)}>
                  <span style={css(numCss)}>{c.d}</span>
                  {c.isFzStart && (
                    <span style={css("font-size:8.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;line-height:1.3;color:" + c.fzTone + ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{c.fzName}</span>
                  )}
                  {c.events.map((e, j) => (
                    <span key={j} title={e.label} style={css("display:flex;align-items:center;gap:4px;font-size:8.5px;line-height:1.3;color:#cbd5e1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                      <span style={css("flex:0 0 auto;width:5px;height:5px;border-radius:50%;background:" + e.tone)} />
                      {e.label}
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
          {cal.day && (
            <div style={css("display:flex;flex-direction:column;gap:11px;padding:14px 16px;border-radius:11px;border:1px solid rgba(34,211,238,.35);background:rgba(2,6,23,.55)")}>
              <div style={css("display:flex;align-items:baseline;justify-content:space-between;gap:12px")}>
                <span style={css("font-size:13px;font-weight:800;color:#f8fafc;letter-spacing:-.01em")}>{cal.day.title}</span>
                <button onClick={() => ctrl.patch({ calDay: null })} style={css("flex:0 0 auto;padding:3px 9px;border-radius:6px;border:1px solid rgba(148,163,184,.22);background:transparent;color:#94a3b8;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit")}>Close</button>
              </div>
              {cal.day.hasFz && (
                <div style={css("display:flex;flex-direction:column;gap:5px;padding:12px 14px;border-radius:10px;border:1px solid " + cal.day.fzTone + "4d;background:" + cal.day.fzTone + "12")}>
                  <span style={css("font-size:9.5px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:" + cal.day.fzTone)}>Freeze · {cal.day.fzName}</span>
                  <span style={css("font-size:12px;font-weight:700;color:#e2e8f0")}>{cal.day.fzRange}</span>
                  <span style={css("font-size:11.5px;color:#94a3b8;line-height:1.55")}>Owner · {cal.day.fzOwner}</span>
                  <span style={css("font-size:11.5px;color:#94a3b8;line-height:1.55")}>Scope · {cal.day.fzScope}</span>
                  <span style={css("font-size:11.5px;color:#94a3b8;line-height:1.55")}>Emergencies · {cal.day.fzEmerg}</span>
                </div>
              )}
              {cal.day.hasEvents && (
                <div style={css("display:flex;flex-direction:column;gap:7px")}>
                  <span style={css("font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#475569")}>Booked against this date</span>
                  {cal.day.events.map((e, j) => (
                    <div key={j} style={css("display:flex;align-items:flex-start;gap:9px")}>
                      <span style={css("flex:0 0 auto;width:7px;height:7px;border-radius:50%;margin-top:5px;background:" + e.tone)} />
                      <span style={css("font-size:12px;color:#cbd5e1;line-height:1.55;text-wrap:pretty")}>{e.label}</span>
                    </div>
                  ))}
                </div>
              )}
              <span style={css("font-size:11.5px;color:#94a3b8;line-height:1.6;text-wrap:pretty")}>{cal.day.verdict}</span>
            </div>
          )}
        </div>

        <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px")}>
          {freezeRows.map((f, fi) => (
            <div key={f.name + fi} style={css("display:flex;flex-direction:column;gap:8px;padding:14px 16px;border:1px solid " + f.tone + "38;border-left:3px solid " + f.tone + ";border-radius:11px;background:rgba(2,6,23,.45);min-width:0")}>
              <div style={css("display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap")}>
                <span style={css("font-size:13.5px;font-weight:700;color:#f1f5f9;letter-spacing:-.01em")}>{f.name}</span>
                <Pill text={f.state} tone={f.tone} bg={f.tone + "14"} />
              </div>
              <span style={css("font-size:12.5px;font-weight:700;color:#cbd5e1")}>{f.range}</span>
              <div style={css("display:flex;flex-direction:column;gap:4px;padding-top:7px;border-top:1px solid rgba(30,41,59,.7)")}>
                <span style={css("font-size:11.5px;color:#94a3b8;line-height:1.5")}>Owner · {f.owner}</span>
                <span style={css("font-size:11.5px;color:#94a3b8;line-height:1.5")}>Scope · {f.scope}</span>
                <span style={css("font-size:11.5px;color:#94a3b8;line-height:1.5")}>Emergencies · {f.emergencies}</span>
              </div>
              <div style={css("display:flex;gap:8px;flex-wrap:wrap")}>
                <button onClick={() => openFreezeEditForm(ctrl, fi)} style={css("padding:6px 11px;border-radius:6px;border:1px solid rgba(148,163,184,.24);background:transparent;color:#94a3b8;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit")}>Edit</button>
                <button onClick={() => openFreezeCancelForm(ctrl, fi)} style={css("padding:6px 11px;border-radius:6px;border:1px solid rgba(148,163,184,.18);background:transparent;color:#64748b;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit")}>Cancel</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function openFreezeAddForm(ctrl: CcController) {
  ctrl.openForm({
    kicker: "Declare a freeze",
    title: "New change freeze",
    intro: "Book it like time off. From the moment you save it, no change can be scheduled inside those dates without an exception from the owner.",
    submitLabel: "Declare the freeze",
    foot: "Microsoft is not bound by it. Anything Microsoft is doing in the same dates shows up against the freeze on the timeline.",
    values: { name: "", range: "", owner: "Priya Raman", scope: "Whole tenant", emergencies: "Exempt, with the freeze owner's written approval", why: "" },
    fields: [
      { k: "name", label: "Name", kind: "text", req: true, ph: "e.g. Warehouse cutover, Black Friday, board audit week" },
      { k: "range", label: "Dates", kind: "text", req: true, ph: "e.g. 12 – 16 October" },
      { k: "owner", label: "Freeze owner", kind: "text", req: true, hint: "The only person who can grant an exception once it is live." },
      { k: "scope", label: "Scope", kind: "pick", options: ["Whole tenant", "Exchange Online, SharePoint, licensing", "Identity and access only"], req: true },
      { k: "emergencies", label: "Emergency changes", kind: "pick", options: ["Exempt", "Exempt, with the freeze owner's written approval", "Exempt, with a written approval and a PIR inside 48 hours", "Not exempt"], req: true },
      { k: "why", label: "What is happening", kind: "area", req: true, ph: "The reason people read when their change gets blocked." },
    ],
    onSubmit: (v) => ({ freezesOv: ctrl.freezes().concat([{ name: String(v.name), range: String(v.range), state: "Scheduled", owner: String(v.owner), scope: String(v.scope), emergencies: String(v.emergencies), tone: "#fbbf24" }]) }),
    done: (v) => '"' + String(v.name) + '" declared for ' + String(v.range) + ". It is on every timeline now, and anything already scheduled inside it is flagged as a collision.",
  });
}

function openFreezeEditForm(ctrl: CcController, fi: number) {
  const f = ctrl.freezes()[fi];
  ctrl.openForm({
    kicker: "Edit a freeze",
    title: f.name,
    intro: "Changing a freeze changes every timeline in the portal. The edit is logged with your name, the old values and the new ones.",
    submitLabel: "Save the freeze",
    foot: "Anything already scheduled inside the new dates is flagged as a collision immediately.",
    values: { name: f.name, range: f.range, owner: f.owner, scope: f.scope, emergencies: f.emergencies, reason: "" },
    fields: [
      { k: "name", label: "Name", kind: "text", req: true },
      { k: "range", label: "Dates", kind: "text", req: true, hint: "Free text for now — the picker lands with the calendar integration." },
      { k: "owner", label: "Freeze owner", kind: "text", req: true, hint: "The only person who can grant an exception." },
      { k: "scope", label: "Scope", kind: "pick", options: ["Whole tenant", "Exchange Online, SharePoint, licensing", "Identity and access only"], req: true },
      { k: "emergencies", label: "Emergency changes", kind: "pick", options: ["Exempt", "Exempt, with the freeze owner's written approval", "Exempt, with a written approval and a PIR inside 48 hours", "Not exempt"], req: true },
      { k: "reason", label: "Why it is changing", kind: "area", req: true, ph: "Goes in the audit log next to the old values." },
    ],
    onSubmit: (v) => ({ freezesOv: ctrl.freezes().map((x, i) => (i === fi ? { ...x, name: String(v.name), range: String(v.range), owner: String(v.owner), scope: String(v.scope), emergencies: String(v.emergencies) } : x)) }),
    done: (v) => '"' + String(v.name) + '" updated — ' + String(v.range) + ", owned by " + String(v.owner) + ". The old values stay in the log.",
  });
}

function openFreezeCancelForm(ctrl: CcController, fi: number) {
  const f = ctrl.freezes()[fi];
  ctrl.openForm({
    kicker: "Cancel a freeze",
    title: 'Cancel "' + f.name + '"',
    intro: "Cancelling a freeze releases every window inside it. It needs the owner's authority and a reason, and both are logged.",
    submitLabel: "Cancel the freeze",
    foot: "Changes already moved out of the freeze do not move back on their own.",
    values: { reason: "", owner: false },
    fields: [
      { k: "reason", label: "Reason", kind: "area", req: true, ph: "e.g. ERP go-live moved to September, freeze no longer needed." },
      { k: "owner", label: "Authority", kind: "toggle", toggleLabel: "I am the freeze owner, or acting with their written authority", req: true },
    ],
    onSubmit: () => ({ freezesOv: ctrl.freezes().filter((_x, i) => i !== fi) }),
    done: '"' + f.name + '" cancelled. Every window inside those dates is open again, and the cancellation is in the log with your reason.',
  });
}

/* ── Review: the change review (CAB) ───────────────────────────────────────── */

function ReviewView({ ctrl }: { ctrl: CcController }) {
  const agenda = ctrl.agenda();
  return (
    <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;align-items:start")} data-testid="cc-view-review">
      <div style={css("display:flex;flex-direction:column;gap:12px;padding:16px 18px;border:1px solid rgba(0,120,212,.28);border-radius:12px;background:#0b1524;min-width:0")}>
        <div style={css("display:flex;flex-direction:column;gap:4px")}>
          <span style={css("font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#60a5fa")}>Next change review</span>
          <span style={css("font-size:14.5px;font-weight:800;color:#f8fafc;letter-spacing:-.01em")}>{CC_CAB.next.when}</span>
          <span style={css("font-size:11.5px;color:#64748b;line-height:1.5")}>{CC_CAB.next.where} · chaired by {CC_CAB.next.chair}</span>
          <span style={css("font-size:11.5px;color:#94a3b8;line-height:1.55")}>{CC_CAB.next.attendees}</span>
        </div>
        <div style={css("display:flex;flex-direction:column;gap:7px;padding-top:11px;border-top:1px solid rgba(30,41,59,.8)")}>
          <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569")}>Agenda · built from the register</span>
          {agenda.map((a, i) => (
            <button key={a.code + i} onClick={() => ctrl.patch({ view: "briefing", focusCode: a.code === "—" ? null : a.code, statFilter: null })} style={css("display:grid;grid-template-columns:74px minmax(0,1fr) 52px;gap:10px;align-items:center;text-align:left;padding:9px 10px;border:1px solid rgba(30,41,59,.8);border-radius:8px;background:rgba(2,6,23,.4);cursor:pointer;font-family:inherit")}>
              <span style={css("font-size:10px;font-weight:700;color:#60a5fa;font-family:" + MONO)}>{a.code}</span>
              <span style={css("font-size:11.5px;color:#e2e8f0;line-height:1.5;min-width:0")}>{a.item}</span>
              <span style={css("font-size:10px;color:#64748b;text-align:right")}>{a.mins}</span>
            </button>
          ))}
          <button onClick={() => openAgendaAddForm(ctrl)} style={css("align-self:flex-start;margin-top:3px;padding:7px 12px;border-radius:6px;border:1px solid rgba(0,120,212,.4);background:rgba(0,120,212,.1);color:#93c5fd;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit")}>
            Add something to the agenda
          </button>
        </div>
      </div>

      <div style={css("display:flex;flex-direction:column;gap:12px;padding:16px 18px;border:1px solid rgba(30,41,59,.9);border-radius:12px;background:#0b1524;min-width:0")}>
        <div style={css("display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap")}>
          <div style={css("display:flex;flex-direction:column;gap:3px")}>
            <span style={css("font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#34d399")}>Last review · decisions</span>
            <span style={css("font-size:13px;font-weight:700;color:#f1f5f9")}>{CC_CAB.last.when}</span>
          </div>
          <button onClick={() => ctrl.t("Minutes for 14 August exported — decisions, attendees, and the CRs each decision moved.")} style={css("padding:6px 11px;border-radius:6px;border:1px solid rgba(148,163,184,.24);background:transparent;color:#94a3b8;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap")}>
            Export the minutes
          </button>
        </div>
        <div style={css("display:flex;flex-direction:column;gap:0")}>
          {CC_CAB.last.decisions.map((d, i) => (
            <div key={i} style={css("display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid rgba(30,41,59,.55)")}>
              <span style={css("flex:0 0 auto;margin-top:5px;width:6px;height:6px;border-radius:50%;background:#34d399")} />
              <span style={css("flex:1;font-size:12px;color:#cbd5e1;line-height:1.6;min-width:0;text-wrap:pretty")}>{d}</span>
            </div>
          ))}
        </div>
        <span style={css("font-size:11px;color:#64748b;line-height:1.55;text-wrap:pretty")}>
          A decision that is not written down did not happen. Every line here is tied to the change it moved, which is what makes the register defensible six months later.
        </span>
      </div>
    </div>
  );
}

function openAgendaAddForm(ctrl: CcController) {
  ctrl.openForm({
    kicker: "Change review",
    title: "Add an item to Thursday's agenda",
    intro: "The chair sees it straight away. It appears in the minutes whether it is discussed, deferred or dropped.",
    submitLabel: "Add to the agenda",
    foot: "Items tied to a change request open that record from the agenda.",
    values: { code: "CR-0142", item: "", mins: "5 min" },
    fields: [
      { k: "code", label: "Related record", kind: "select", options: ["CR-0151", "CR-0144", "CR-0142", "CR-0147", "CR-0136", "MC1049877", "MC1051144", "No specific record"], req: true },
      { k: "item", label: "What needs deciding", kind: "area", req: true, ph: 'Write it as a decision, not a topic — "approve or move CR-0142", not "discuss CR-0142".' },
      { k: "mins", label: "Time", kind: "pick", options: ["5 min", "8 min", "10 min", "15 min"], req: true },
    ],
    onSubmit: (v) => ({ agendaOv: ctrl.agenda().concat([{ code: v.code === "No specific record" ? "—" : String(v.code), item: String(v.item), mins: String(v.mins) }]) }),
    done: (v) => "Added to Thursday 21 August · " + String(v.mins) + ". " + (v.code === "No specific record" ? "" : String(v.code) + " opens from the agenda."),
  });
}

/* ── Record: the full change request, section by section ───────────────────── */

const BLOCK_WRAP = "display:flex;flex-direction:column;gap:12px;padding:15px 17px;border:1px solid rgba(30,41,59,.9);border-radius:11px;background:#0b1524;min-width:0";

function Block({ head, hint, children }: { head?: string; hint?: string; children: ReactNode }) {
  return (
    <div style={css(BLOCK_WRAP)}>
      {head && (
        <div style={css("display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap")}>
          <span style={css("font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748b")}>{head}</span>
          {hint && <span style={css("font-size:10.5px;color:#475569")}>{hint}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

function Fields({ items }: { items: { label: string; value: string; mono?: boolean }[] }) {
  return (
    <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:13px")}>
      {items.map((f) => (
        <div key={f.label} style={css("display:flex;flex-direction:column;gap:3px;min-width:0")}>
          <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569")}>{f.label}</span>
          <span style={css(valCss(f.mono))}>{f.value}</span>
        </div>
      ))}
    </div>
  );
}

function Prose({ text }: { text: string }) {
  return <span style={css("font-size:12.5px;color:#cbd5e1;line-height:1.65;text-wrap:pretty")}>{text}</span>;
}

function Checks({ checks }: { checks: readonly CrCheck[] }) {
  return (
    <div style={css("display:flex;flex-direction:column;gap:1px")}>
      {checks.map((c, i) => (
        <div key={i} style={css("display:flex;align-items:flex-start;gap:10px;padding:9px 2px;border-bottom:1px solid rgba(30,41,59,.55)")}>
          <span style={css("flex:0 0 auto;width:17px;height:17px;display:flex;align-items:center;justify-content:center;border-radius:4px;font-size:10px;font-weight:700;color:" + (c.ok ? "#34d399" : "#fbbf24") + ";background:" + (c.ok ? "rgba(52,211,153,.12)" : "rgba(251,191,36,.1)") + ";border:1px solid " + (c.ok ? "rgba(52,211,153,.3)" : "rgba(251,191,36,.3)"))}>
            {c.ok ? "✓" : "○"}
          </span>
          <span style={css("flex:1;font-size:12px;color:#cbd5e1;line-height:1.5;min-width:0")}>{c.label}</span>
          <span style={css("flex:0 0 auto;font-size:10px;font-weight:600;color:" + (c.ok ? "#64748b" : "#fbbf24"))}>{c.meta}</span>
        </div>
      ))}
    </div>
  );
}

function Steps({ steps }: { steps: readonly CrStep[] }) {
  return (
    <div style={css("display:flex;flex-direction:column;gap:8px")}>
      {steps.map((st, i) => (
        <div key={i} style={css("display:flex;align-items:flex-start;gap:11px;padding:10px 12px;border:1px solid rgba(30,41,59,.85);border-radius:8px;background:rgba(2,6,23,.45)")}>
          <span style={css("flex:0 0 auto;width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:5px;background:rgba(96,165,250,.12);color:#93c5fd;font-size:10.5px;font-weight:700;font-family:" + MONO)}>{i + 1}</span>
          <div style={css("display:flex;flex-direction:column;gap:3px;min-width:0;flex:1")}>
            <span style={css("font-size:12px;color:#e2e8f0;line-height:1.55;text-wrap:pretty")}>{st.text}</span>
            {st.mono && <span style={css("font-size:11px;color:#93c5fd;font-family:" + MONO + ";word-break:break-all;line-height:1.55")}>{st.mono}</span>}
          </div>
          <span style={css("flex:0 0 auto;font-size:10.5px;color:#64748b")}>{st.owner}</span>
        </div>
      ))}
    </div>
  );
}

function RecordSection({ cr, secKey, ctrl }: { cr: ChangeRequest; secKey: string; ctrl: CcController }) {
  const done = secDone(cr, secKey);

  // Empty / outstanding state for a required section that has not been filled,
  // and for the PIR before a change has run. The prototype dereferences cr.pir
  // whenever pir is not in `missing`, but three CRs carry no pir object and no
  // pir marker — so a missing-but-marked-done pir is treated as outstanding here
  // rather than crashing, which is a defect fixed, not a copy change.
  const pirEmpty = secKey === "pir" && !cr.pir;
  if (!done || pirEmpty) {
    const names: Record<string, string> = {
      impact: "No impact assessment on this record",
      rollback: "No rollback plan on this record",
      test: "No test plan or evidence on this record",
      deploy: "No deployment plan on this record",
      pir: cr.state === "Draft" || cr.state === "Awaiting approval" ? "The review opens once the change has run" : "Post-implementation review outstanding",
    };
    const notes: Record<string, string> = {
      pir:
        cr.state === "Draft" || cr.state === "Awaiting approval"
          ? "Nothing to review yet. After deployment this section asks four questions: did it do what it was for, was it inside the window, did it cause an incident, and is the finding actually closed."
          : "This change ran under emergency authority. Your change policy gives you 48 hours to record what it cost and what the next change learns from it — and the retrospective approval is due before that.",
      impact: "Until this is filled in, nobody can tell what a failed run costs. The record cannot go for approval and the change cannot be scheduled.",
      rollback: "A change with no written way back is not approvable. Name the steps, the engineer who owns them, and how you prove the tenant is where it started.",
      test: "The tenant has no dev or test environment, so the test plan has to name the compensating control — a report-only ring, a pilot group, or a single-object overlap.",
      deploy: "Steps, window, who is on it, and what gets watched after. The window has to sit inside your change policy and outside the month-end blackout.",
    };
    const can = editableBy(secKey);
    return (
      <Block>
        <div style={css("display:flex;flex-direction:column;gap:10px;align-items:flex-start;padding:22px 18px;border:1px dashed rgba(251,191,36,.32);border-radius:10px;background:rgba(251,191,36,.04)")}>
          <span style={css("font-size:12.5px;font-weight:700;color:#fbbf24")}>{names[secKey] || "This section is empty"}</span>
          <span style={css("font-size:12px;color:#cbd5e1;line-height:1.6;max-width:74ch;text-wrap:pretty")}>{notes[secKey] || ""}</span>
          <div style={css("display:flex;gap:8px;flex-wrap:wrap")}>
            <button
              disabled={!can}
              onClick={() => ctrl.t(can ? "Section form opens in the drawer — " + cr.code + " · " + secKey : "Your role cannot edit this section.")}
              style={css("padding:8px 13px;border-radius:7px;font-size:11.5px;font-weight:700;font-family:inherit;border:1px solid " + (can ? "#0078D4" : "rgba(148,163,184,.2)") + ";background:" + (can ? "#0078D4" : "transparent") + ";color:" + (can ? "#fff" : "#475569") + ";cursor:" + (can ? "pointer" : "not-allowed"))}
            >
              {can ? "Fill in this section" : "Waiting on Shane McCaw Consulting"}
            </button>
            <button onClick={() => ctrl.t("Drafting " + secKey + " from the change payload. Section 10 shows what it inferred; an engineer signs it off before it counts.")} style={css("padding:8px 13px;border-radius:7px;border:1px solid rgba(34,211,238,.35);background:transparent;color:#22d3ee;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit")}>
              Draft it from the change payload
            </button>
          </div>
        </div>
      </Block>
    );
  }

  if (secKey === "request") {
    return (
      <>
        {cr.incidents && (
          <Block head="Incident linkage" hint="Changes and incidents point at each other">
            <Linked links={cr.incidents} />
          </Block>
        )}
        <Block head="The change">
          <Fields items={[{ label: "Title", value: cr.title }, { label: "Workload", value: cr.workload }, { label: "ITIL class", value: cr.cls }, { label: "Priority", value: cr.priority }, { label: "Risk category", value: cr.risk }, { label: "Scope", value: cr.scope }]} />
        </Block>
        <Block head="Description"><Prose text={cr.desc} /></Block>
        <Block head="Business justification"><Prose text={cr.just} /></Block>
        <Block head="Dependencies"><Prose text={cr.deps} /></Block>
        <Block head="Security impact"><Prose text={cr.secImpact} /></Block>
        <Block head="Compliance impact"><Prose text={cr.compImpact} /></Block>
        <Block head="Change payload" hint="Approvers see the diff, not a description of it"><Diff pre={cr.pre} post={cr.post} capturedAt={cr.capturedAt} /></Block>
      </>
    );
  }

  if (secKey === "impact" && cr.impact) {
    return (
      <>
        <Block head="Impact"><Fields items={[{ label: "Functional impact", value: cr.impact.func }, { label: "User impact", value: cr.impact.user }, { label: "Operational impact", value: cr.impact.ops }, { label: "Outage risk", value: cr.impact.outage }]} /></Block>
        <Block head="Requirements"><Fields items={[{ label: "Communications required", value: cr.impact.comms }, { label: "Downtime required", value: cr.impact.downtime }, { label: "Accounts a failure would touch", value: cr.accounts }]} /></Block>
      </>
    );
  }

  if (secKey === "rollback" && cr.rollback) {
    return (
      <>
        <Block head="Rollback steps" hint={cr.rollback.eng}><Steps steps={cr.rollback.steps} /></Block>
        <Block head="Expected post-rollback state"><Prose text={cr.rollback.post} /></Block>
        <Block head="Rollback validation checklist"><Checks checks={cr.rollback.checks} /></Block>
      </>
    );
  }

  if (secKey === "approvals") {
    const a = cr.approvals;
    const sod =
      a.submitter.org.indexOf("Halden") >= 0
        ? "This request came from your side, so the signature has to come from someone else — the record refuses an approval from the submitting account and logs the attempt."
        : "The approver must be a different person from the submitter. Shane McCaw submitted this change, so he cannot sign it off; the record enforces that, not the policy document.";
    const people = [
      { role: "Submitter", p: a.submitter },
      { role: "Peer reviewer", p: a.peer },
      { role: "Approver", p: a.approver },
    ];
    return (
      <>
        <Block head="Signatures">
          <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px")}>
            {people.map((pp) => (
              <div key={pp.role} style={css("display:flex;flex-direction:column;gap:4px;padding:13px 14px;border:1px solid " + pp.p.tone + "33;border-radius:10px;background:rgba(2,6,23,.45)")}>
                <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569")}>{pp.role}</span>
                <span style={css("font-size:13px;font-weight:700;color:#f1f5f9;line-height:1.35")}>{pp.p.name}</span>
                <span style={css("font-size:11px;color:#64748b;line-height:1.45")}>{pp.p.org}</span>
                <Pill text={pp.p.state} tone={pp.p.tone} bg={pp.p.tone + "14"} />
                <span style={css("font-size:10.5px;color:#64748b;font-family:" + MONO + ";line-height:1.5")}>{pp.p.sig}</span>
              </div>
            ))}
          </div>
        </Block>
        <Block head="Separation of duties"><Prose text={sod} /></Block>
        <Block head="Approval log"><Timeline events={cr.audit.filter((e) => /review|Approv|duties|approval|Rollback authorised/i.test(e.event))} /></Block>
      </>
    );
  }

  if (secKey === "test" && cr.test) {
    return (
      <>
        <Block head="Test plan"><Prose text={cr.test.plan} /></Block>
        <Block head="Verdict"><Fields items={[{ label: "Test environment", value: cr.test.env }, { label: "Status", value: cr.test.status }, { label: "Validation notes", value: cr.test.notes }]} /></Block>
        <Block head="Test evidence" hint="Attached to the record, exported with it"><Checks checks={cr.test.evidence} /></Block>
      </>
    );
  }

  if (secKey === "env") {
    return (
      <>
        <Block head="Pipeline" hint="Dev → Test → Stage → Prod"><Pipe stages={cr.pipe} /></Block>
        <Block head="Access control">
          <Fields
            items={[
              { label: "Who can execute in production", value: "Shane McCaw Consulting engineers with a signed CR only. No standing production access; access is elevated for the window and dropped after." },
              { label: "Sensitive data isolation", value: "No production mailbox or file content is copied to a lower stage. Pilot rings run against real accounts inside production, which is why the ring is named in the record." },
              { label: "Compensating control", value: "This tenant has no dev or test environment. Report-only policy runs and pilot rings stand in, and each one is recorded as evidence in section 5." },
            ]}
          />
        </Block>
      </>
    );
  }

  if (secKey === "deploy" && cr.deploy) {
    return (
      <>
        <Block head="Deployment steps" hint={cr.deploy.window}><Steps steps={cr.deploy.steps} /></Block>
        <Block head="Window and people"><Fields items={[{ label: "Deployment window", value: cr.deploy.window }, { label: "Responsible personnel", value: cr.deploy.people }, { label: "Monitoring plan", value: cr.deploy.monitor }]} /></Block>
        <Block head="Post-deployment validation"><Checks checks={cr.deploy.postval} /></Block>
      </>
    );
  }

  if (secKey === "audit") {
    return (
      <>
        <Block head="Lifecycle log" hint={"Append-only · " + cr.audit.length + " events"}><Timeline events={cr.audit} /></Block>
        <Block head="Evidence pack" hint="What an auditor is actually asking for">
          <div style={css("display:flex;flex-direction:column;gap:10px")}>
            <div style={css("display:flex;flex-direction:column;gap:5px")}>
              {[
                "The request as submitted, with the submitter and the timestamp",
                "Both signatures, the accounts they came from, and the separation-of-duties check",
                "The pre-change snapshot and the payload that was sent, as captured — not retyped",
                "Test evidence and the compensating control where no test tenant exists",
                "The deployment log, the window it ran in, and the post-deployment validation results",
                "The rollback plan, and the rollback log if one was executed",
                "The post-implementation review and who signed it",
              ].map((i) => (
                <div key={i} style={css("display:flex;align-items:flex-start;gap:9px")}>
                  <span style={css("flex:0 0 auto;margin-top:6px;width:5px;height:5px;border-radius:50%;background:#60a5fa")} />
                  <span style={css("flex:1;font-size:11.5px;color:#cbd5e1;line-height:1.6;min-width:0")}>{i}</span>
                </div>
              ))}
            </div>
            <span style={css("font-size:10.5px;color:#64748b;line-height:1.6;text-wrap:pretty")}>
              Sealed on export · SHA-256 over the record and its attachments, countersigned with the tenant ID. Any later edit produces a new pack, and the old hash stays in the log.
            </span>
            <button onClick={() => ctrl.t("Evidence pack for " + cr.code + " built — 7 artefacts, sealed and timestamped. This is the file you hand an auditor instead of a screenshot.")} style={css("align-self:flex-start;padding:8px 13px;border-radius:7px;border:1px solid rgba(0,120,212,.4);background:rgba(0,120,212,.1);color:#93c5fd;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap")}>
              Download the evidence pack for {cr.code}
            </button>
          </div>
        </Block>
      </>
    );
  }

  if (secKey === "release") {
    return (
      <>
        <Block head="Release channel">
          <Fields
            items={[
              { label: "Channel", value: cr.chan || "Not set" },
              { label: "Release ring", value: cr.chan === "Targeted release" ? "Targeted — this tenant sees the change before general availability" : "Standard — general availability timing" },
              { label: "Message Center sync", value: cr.linked.length ? "Synced · " + cr.linked.length + " posts linked to this change" : "Synced · no posts matched this change payload" },
            ]}
          />
        </Block>
        {cr.linked.length > 0 && (
          <Block head="Linked Microsoft changes" hint="From the Message Center"><Linked links={cr.linked} /></Block>
        )}
      </>
    );
  }

  if (secKey === "ai") {
    return <Ai cr={cr} ctrl={ctrl} />;
  }

  if (secKey === "pir" && cr.pir) {
    const p = cr.pir;
    return (
      <>
        <Block head="Outcome"><Fields items={[{ label: "Did it do what it was for", value: p.outcome }, { label: "Inside the approved window", value: p.window }, { label: "Is the finding closed", value: p.finding }, { label: "What it cost", value: p.cost }]} /></Block>
        <Block head="What we keep and what we change"><Checks checks={p.lessons} /></Block>
        <Block head="What the next change does differently"><Prose text={p.next} /></Block>
        <Block head="Review signed off"><Prose text={p.signed} /></Block>
      </>
    );
  }

  return null;
}

function Diff({ pre, post, capturedAt }: { pre: string; post: string; capturedAt: string }) {
  return (
    <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px")}>
      <div style={css("display:flex;flex-direction:column;gap:5px;min-width:0")}>
        <span style={css("font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748b")}>Current state · captured {capturedAt}</span>
        <pre style={css("margin:0;padding:12px;border-radius:8px;border:1px solid rgba(30,41,59,.9);background:#0b1524;color:#cbd5e1;font-size:11.5px;line-height:1.65;font-family:" + MONO + ";overflow-x:auto")}>{pre}</pre>
      </div>
      <div style={css("display:flex;flex-direction:column;gap:5px;min-width:0")}>
        <span style={css("font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#34d399")}>Proposed state · what gets sent</span>
        <pre style={css("margin:0;padding:12px;border-radius:8px;border:1px solid rgba(52,211,153,.28);background:#0b1524;color:#e2e8f0;font-size:11.5px;line-height:1.65;font-family:" + MONO + ";overflow-x:auto")}>{post}</pre>
      </div>
    </div>
  );
}

function Pipe({ stages }: { stages: ChangeRequest["pipe"] }) {
  return (
    <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px")}>
      {stages.map((p) => (
        <div key={p.name} style={css("display:flex;flex-direction:column;gap:7px;padding:13px 14px;border:1px " + (p.prov ? "solid" : "dashed") + " " + (p.prov ? "rgba(30,41,59,.95)" : "rgba(71,85,105,.5)") + ";border-radius:10px;background:" + (p.prov ? "rgba(2,6,23,.45)" : "rgba(2,6,23,.2)") + ";opacity:" + (p.prov ? "1" : ".55"))}>
          <div style={css("display:flex;align-items:center;justify-content:space-between;gap:8px")}>
            <span style={css("font-size:13px;font-weight:700;letter-spacing:-.01em;color:" + (p.prov ? "#f1f5f9" : "#64748b"))}>{p.name}</span>
            <Pill text={p.status} tone={p.prov ? p.tone || "#94a3b8" : "#64748b"} bg="rgba(148,163,184,.08)" />
          </div>
          <span style={css("font-size:11px;color:#64748b;line-height:1.5;text-wrap:pretty")}>{p.note}</span>
        </div>
      ))}
    </div>
  );
}

function Timeline({ events }: { events: readonly ChangeRequest["audit"][number][] }) {
  return (
    <div style={css("display:flex;flex-direction:column;gap:0")}>
      {events.map((e, i) => (
        <div key={i} style={css("display:grid;grid-template-columns:152px 14px minmax(0,1fr);gap:12px;align-items:start;padding:10px 0;border-bottom:1px solid rgba(30,41,59,.5)")}>
          <span style={css("font-size:10.5px;color:#64748b;font-family:" + MONO + ";line-height:1.5")}>{e.at}</span>
          <span style={css("margin-top:5px;width:7px;height:7px;border-radius:50%;background:" + e.tone)} />
          <div style={css("display:flex;flex-direction:column;gap:3px;min-width:0")}>
            <span style={css("font-size:12px;font-weight:600;color:#e2e8f0;line-height:1.45")}>{e.event}</span>
            <span style={css("font-size:11px;color:#94a3b8;line-height:1.55;text-wrap:pretty")}>{e.detail}</span>
            {e.diff && <span style={css("font-size:10.5px;color:#93c5fd;font-family:" + MONO + ";line-height:1.6;word-break:break-all")}>{e.diff}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Linked({ links }: { links: readonly { id: string; title: string; note: string; tag: string; tone: string }[] }) {
  return (
    <div style={css("display:flex;flex-direction:column;gap:8px")}>
      {links.map((l) => (
        <div key={l.id} style={css("display:flex;align-items:flex-start;gap:11px;padding:11px 12px;border:1px solid rgba(30,41,59,.85);border-radius:9px;background:rgba(2,6,23,.45)")}>
          <span style={css("flex:0 0 auto;font-size:10.5px;font-weight:700;color:#93c5fd;font-family:" + MONO + ";padding:2px 6px;border-radius:4px;background:rgba(96,165,250,.1);border:1px solid rgba(96,165,250,.2)")}>{l.id}</span>
          <div style={css("display:flex;flex-direction:column;gap:3px;min-width:0;flex:1")}>
            <span style={css("font-size:12px;font-weight:600;color:#e2e8f0;line-height:1.45")}>{l.title}</span>
            <span style={css("font-size:11px;color:#94a3b8;line-height:1.55;text-wrap:pretty")}>{l.note}</span>
          </div>
          <Pill text={l.tag} tone={l.tone} bg={l.tone + "14"} />
        </div>
      ))}
    </div>
  );
}

function Ai({ cr, ctrl }: { cr: ChangeRequest; ctrl: CcController }) {
  const n = cr.aiScore;
  const tone = aiTone(n);
  return (
    <Block head="Automated change planning" hint="Model-generated · an engineer signs off before it counts">
      <div style={css("display:flex;flex-direction:column;gap:14px")}>
        <div style={css("display:grid;grid-template-columns:minmax(200px,260px) minmax(0,1fr);gap:16px;align-items:center")}>
          <div style={css("display:flex;flex-direction:column;gap:6px")}>
            <span style={css("font-size:38px;font-weight:800;letter-spacing:-.03em;line-height:1;color:" + tone)}>{n}</span>
            <span style={css("font-size:10.5px;color:#64748b;line-height:1.45")}>Risk score out of 100 · {cr.ai.band}</span>
            <div style={css("height:6px;border-radius:3px;background:rgba(148,163,184,.14);overflow:hidden")}>
              <div style={css("height:100%;width:" + n + "%;border-radius:3px;background:" + tone)} />
            </div>
          </div>
          <div style={css("display:flex;flex-direction:column;gap:6px")}>
            {cr.ai.factors.map((f, i) => (
              <div key={i} style={css("display:flex;align-items:center;gap:10px")}>
                <span style={css("flex:0 0 auto;width:38px;text-align:right;font-size:11px;font-weight:700;font-family:" + MONO + ";color:" + (f.weight.startsWith("+") ? "#f87171" : "#34d399"))}>{f.weight}</span>
                <span style={css("flex:1;font-size:11.5px;color:#cbd5e1;line-height:1.5;min-width:0")}>{f.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={css("display:flex;flex-direction:column;gap:7px")}>
          <span style={css("font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748b")}>Dependency graph</span>
          <div style={css("display:flex;flex-direction:column;gap:7px")}>
            {cr.ai.deps.map((d, i) => (
              <div key={i} style={css("display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:9px 11px;border:1px solid rgba(30,41,59,.85);border-radius:8px;background:rgba(2,6,23,.4)")}>
                <span style={css("font-size:11.5px;font-weight:600;color:#e2e8f0")}>{d.from}</span>
                <span style={css("font-size:11px;color:#475569")}>→</span>
                <span style={css("font-size:11.5px;color:#93c5fd")}>{d.to}</span>
                <Pill text={d.tag} tone={d.tone} bg={d.tone + "14"} />
                <span style={css("flex:1 1 200px;font-size:11px;color:#64748b;line-height:1.5;min-width:0")}>{d.note}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={css("display:flex;flex-direction:column;gap:7px")}>
          <span style={css("font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748b")}>Suggested rollback steps</span>
          <div style={css("display:flex;flex-direction:column;gap:6px")}>
            {cr.ai.suggested.map((sg, i) => (
              <div key={i} style={css("display:flex;align-items:flex-start;gap:10px;padding:9px 11px;border:1px dashed rgba(34,211,238,.3);border-radius:8px;background:rgba(34,211,238,.04)")}>
                <span style={css("flex:1;font-size:11.5px;color:#cbd5e1;line-height:1.55;min-width:0;text-wrap:pretty")}>{sg.text}</span>
                <button onClick={() => ctrl.t(sg.action === "In the plan" ? "Already in the rollback plan — section 3, step 1." : sg.action + ": " + sg.text)} style={css("flex:0 0 auto;white-space:nowrap;padding:4px 10px;border-radius:5px;border:1px solid rgba(34,211,238,.35);background:transparent;color:#22d3ee;font-size:10.5px;font-weight:600;cursor:pointer;font-family:inherit")}>{sg.action}</button>
              </div>
            ))}
          </div>
        </div>
        <div style={css("display:flex;flex-direction:column;gap:5px;padding:12px 13px;border:1px solid rgba(139,92,246,.28);border-radius:9px;background:rgba(139,92,246,.05)")}>
          <span style={css("font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#a78bfa")}>Impact analysis · tenant-wide</span>
          <span style={css("font-size:12px;color:#cbd5e1;line-height:1.65;text-wrap:pretty")}>{cr.ai.impact}</span>
          <span style={css("font-size:10.5px;color:#64748b;line-height:1.5")}>{cr.ai.impactMeta}</span>
        </div>
      </div>
    </Block>
  );
}

interface RecordAction {
  label: string;
  disabled: boolean;
  title: string;
  css: string;
  go: () => void;
}

function buildRecordActions(ctrl: CcController, cur: ChangeRequest, comp: { done: number; total: number }, canApprove: boolean, isSubmitter: boolean, curClash: boolean, canEdit: boolean): RecordAction[] {
  const actions: RecordAction[] = [];
  if (cur.state === "Awaiting approval" || cur.state === "Draft") {
    const label = cur.state === "Draft" ? "Submit for peer review" : "Approve and schedule";
    const enabled = cur.state === "Draft" ? comp.done === comp.total && canEdit : canApprove;
    actions.push({
      label,
      disabled: !enabled,
      title: enabled ? "" : cur.state === "Draft" ? "Required sections are incomplete" : curClash ? "The window sits inside the " + CC_FREEZE.label : isSubmitter ? "You submitted this change" : comp.done !== comp.total ? "Required sections are incomplete" : "Only the named approver can sign",
      css: "padding:9px 15px;border-radius:7px;font-size:12px;font-weight:700;font-family:inherit;white-space:nowrap;border:1px solid " + (enabled ? "#0078D4" : "rgba(148,163,184,.18)") + ";background:" + (enabled ? "#0078D4" : "transparent") + ";color:" + (enabled ? "#fff" : "#475569") + ";cursor:" + (enabled ? "pointer" : "not-allowed"),
      go: () => {
        if (enabled) ctrl.signForm(cur.code, cur.window);
      },
    });
  }
  if (cur.state === "Awaiting approval") {
    actions.push({
      label: "Request changes",
      disabled: false,
      title: "Send it back to the engineer with a note",
      css: "padding:9px 15px;border-radius:7px;font-size:12px;font-weight:600;font-family:inherit;white-space:nowrap;border:1px solid rgba(251,191,36,.35);background:transparent;color:#fbbf24;cursor:pointer",
      go: () =>
        ctrl.openForm({
          kicker: "Send it back",
          title: "Request changes to " + cur.code,
          intro: "The record stays on the register with its history intact. Your note goes to the submitter and into the audit log.",
          submitLabel: "Send it back",
          values: { what: "The plan", note: "" },
          fields: [
            { k: "what", label: "What needs work", kind: "pick", options: ["The plan", "The window", "The rollback", "The test evidence", "The scope"], req: true },
            { k: "note", label: "What you want changed", kind: "area", req: true, ph: 'Be specific. "Not comfortable" costs a week; "the Finance export dry run has to pass first" costs an hour.' },
          ],
          done: (v) => "Sent back to " + cur.approvals.submitter.name + " — " + String(v.what).toLowerCase() + ". The approval clock stops until it comes back.",
        }),
    });
  }
  if (/retro/.test(cur.state)) {
    actions.push({
      label: "Approve retrospectively",
      disabled: false,
      title: "The 24-hour clock started at 02:14",
      css: "padding:9px 15px;border-radius:7px;font-size:12px;font-weight:700;font-family:inherit;white-space:nowrap;border:1px solid #f87171;background:rgba(248,113,113,.14);color:#f87171;cursor:pointer",
      go: () =>
        ctrl.openForm({
          kicker: "Retrospective approval",
          title: "Approve " + cur.code + " after the fact",
          intro: "It already ran. What you are signing is that the emergency path was the right call and the record is now complete enough to stand up to an audit.",
          submitLabel: "Sign the retrospective approval",
          foot: "The 24-hour clock started at 02:14 on 18 August.",
          values: { justified: false, note: "", pir: "Within 48 hours of deployment" },
          fields: [
            { k: "justified", label: "Signature", kind: "toggle", toggleLabel: "The emergency path was justified, and I approve the change as it ran", req: true },
            { k: "note", label: "Note for the record", kind: "area", req: true, ph: "e.g. Mail flow was down for 40 minutes. Verbal authority at 02:13 was appropriate. Rule rebuild must land this week." },
            { k: "pir", label: "Review due", kind: "pick", options: ["Within 48 hours of deployment", "At Thursday's change review", "Both"], req: true },
          ],
          done: (v) => cur.code + " approved retrospectively and signed. Post-implementation review due " + String(v.pir).toLowerCase() + ".",
        }),
    });
  }
  if (cur.state === "In test" || cur.state === "Rolled back") {
    actions.push({
      label: cur.state === "Rolled back" ? "Raise the retry CR" : "Open the runbook",
      disabled: false,
      title: "",
      css: "padding:9px 15px;border-radius:7px;font-size:12px;font-weight:600;font-family:inherit;white-space:nowrap;border:1px solid rgba(0,120,212,.4);background:rgba(0,120,212,.1);color:#93c5fd;cursor:pointer",
      go: () => ctrl.t(cur.state === "Rolled back" ? "New CR opened, pre-filled from " + cur.code + " with the rollback findings attached." : "Runbook for " + cur.code + " opens in Active Runbooks."),
    });
  }
  actions.push({
    label: "Ask ShaneBot",
    disabled: false,
    title: "Ask about this change with the tenant context attached",
    css: "padding:9px 15px;border-radius:7px;font-size:12px;font-weight:600;font-family:inherit;white-space:nowrap;border:1px solid rgba(34,211,238,.32);background:transparent;color:#22d3ee;cursor:pointer",
    go: () => ctrl.t("ShaneBot: what is the residual risk on " + cur.code + " and what would you change about the plan?"),
  });
  return actions;
}

/** A section is complete for rendering iff its data is present; guards the PIR. */
function sectionDone(cr: ChangeRequest, key: string): boolean {
  return secDone(cr, key) && (key !== "pir" || !!cr.pir);
}

function RecordView({ ctrl }: { ctrl: CcController }) {
  const { s, role } = ctrl;
  // The record is reachable from BOTH lists and has to resolve against both:
  // the register lists the tenant's real change requests, while the briefing's
  // Gantt rows and focus cards are the design's own worked example and keep
  // their fixture codes. Searching live first, then the fixtures, means a click
  // in either place opens the record it named — rather than silently falling
  // through to whatever happens to be first.
  const all = ctrl.crs();
  const cur = all.find((c) => c.code === s.openCode) || CC_CRS.find((c) => c.code === s.openCode) || all[0];
  const comp = compOf(cur);
  const secDef = CC_SECS.find((x) => x.key === s.sec) || CC_SECS[0];
  const canEdit = editableBy(secDef.key);
  const isSubmitter = role === "approver" && cur.approvals.submitter.org.indexOf("Halden") >= 0;
  const curClash = clashOf(ctrl, cur.code);
  const canApprove = role === "approver" && !isSubmitter && cur.state === "Awaiting approval" && comp.done === comp.total && !curClash;
  const actions = buildRecordActions(ctrl, cur, comp, canApprove, isSubmitter, curClash, canEdit);

  const actionNote =
    cur.state === "Draft"
      ? "Four required sections are empty. Peer review cannot start until they are filled."
      : cur.state === "Awaiting approval"
        ? "You are the named approver. Shane McCaw submitted it, so he cannot sign it."
        : cur.state === "Rolled back"
          ? "Closed 6 Aug after a 9-minute rollback. The retry route is in section 10."
          : "Approved as a standard change. Cutover runs in the 20 Aug window.";

  const headFacts = [
    { label: "Submitted by", value: cur.approvals.submitter.name },
    { label: "Approver", value: cur.approvals.approver.name },
    { label: "Window", value: cur.window + (cur.countdown === "—" ? "" : " · " + cur.countdown) },
    { label: "Scope", value: cur.accounts },
    { label: "Linked MS change", value: cur.mc || "None" },
    { label: "AI risk score", value: cur.aiScore + " / 100" },
  ];

  const blockers = CC_SECS.filter((x) => x.req && !secDone(cur, x.key));

  return (
    <div style={css("display:flex;flex-direction:column;gap:14px")} data-testid="cc-view-record">
      {/* Header */}
      <div style={css("display:flex;flex-direction:column;gap:12px;padding:16px 18px;border:1px solid rgba(0,120,212,.28);border-radius:12px;background:linear-gradient(180deg,rgba(0,120,212,.07),rgba(11,21,36,.9))")}>
        <div style={css("display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap")}>
          <div style={css("display:flex;flex-direction:column;gap:6px;min-width:0")}>
            <button onClick={() => ctrl.patch({ view: s.lastList || "briefing" })} style={css("align-self:flex-start;padding:0;border:none;background:transparent;color:#60a5fa;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit")}>
              {s.lastList === "register" ? "← All change requests" : "← Back to the briefing"}
            </button>
            <div style={css("display:flex;align-items:baseline;gap:10px;flex-wrap:wrap")}>
              <span style={css("font-size:13px;font-weight:700;color:#60a5fa;font-family:" + MONO)}>{cur.code}</span>
              <span style={css("font-size:17px;font-weight:800;color:#f8fafc;letter-spacing:-.01em;line-height:1.3")}>{cur.title}</span>
            </div>
            <div style={css("display:flex;align-items:center;gap:8px;flex-wrap:wrap")}>
              <Pill text={cur.state} tone={stateTone(cur.state)} bg={stateTone(cur.state) + "14"} />
              <Pill text={cur.risk + " risk"} tone={riskTone(cur.risk)} bg={riskTone(cur.risk) + "14"} />
              <span style={css("font-size:11px;color:#94a3b8")}>{cur.cls} change · {cur.workload} · priority {cur.priority}</span>
            </div>
          </div>
          <div style={css("display:flex;flex-direction:column;gap:8px;align-items:flex-end")}>
            <div style={css("display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end")}>
              {actions.map((a) => (
                <button key={a.label} onClick={a.go} disabled={a.disabled} title={a.title} style={css(a.css)}>{a.label}</button>
              ))}
            </div>
            <span style={css("font-size:10.5px;color:#64748b;text-align:right;max-width:38ch;line-height:1.45")}>{actionNote}</span>
          </div>
        </div>
        <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;padding-top:11px;border-top:1px solid rgba(30,41,59,.8)")}>
          {headFacts.map((f) => (
            <div key={f.label} style={css("display:flex;flex-direction:column;gap:2px;min-width:0")}>
              <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569")}>{f.label}</span>
              <span style={css("font-size:12px;font-weight:600;color:#e2e8f0;line-height:1.45")}>{f.value}</span>
            </div>
          ))}
        </div>
      </div>

      {curClash && (
        <div style={css("display:flex;flex-direction:column;gap:9px;padding:14px 16px;border:1px solid rgba(248,113,113,.4);border-radius:11px;background:repeating-linear-gradient(135deg,rgba(248,113,113,.10),rgba(248,113,113,.10) 6px,rgba(248,113,113,.04) 6px,rgba(248,113,113,.04) 12px)")}>
          <span style={css("font-size:11.5px;font-weight:700;color:#f87171;line-height:1.45")}>The 25 August window sits inside the {CC_FREEZE.label} — {CC_FREEZE.range}</span>
          <span style={css("font-size:12px;color:#cbd5e1;line-height:1.6;max-width:88ch;text-wrap:pretty")}>{CC_FREEZE.reason} {CC_FREEZE.policy}</span>
          <div style={css("display:flex;gap:8px;flex-wrap:wrap")}>
            <button onClick={() => ctrl.moveForm(cur.code)} style={css("padding:7px 12px;border-radius:6px;font-size:11px;font-weight:700;font-family:inherit;white-space:nowrap;cursor:pointer;border:1px solid rgba(248,113,113,.45);background:transparent;color:#f87171")}>Move the window</button>
            <button onClick={() => ctrl.exceptionForm(cur.code)} style={css("padding:7px 12px;border-radius:6px;font-size:11px;font-weight:700;font-family:inherit;white-space:nowrap;cursor:pointer;border:1px solid rgba(251,191,36,.4);background:transparent;color:#fbbf24")}>Grant a freeze exception</button>
          </div>
        </div>
      )}

      {blockers.length > 0 && (
        <div style={css("display:flex;flex-direction:column;gap:9px;padding:14px 16px;border:1px solid rgba(251,191,36,.3);border-radius:11px;background:rgba(251,191,36,.05)")}>
          <span style={css("font-size:11.5px;font-weight:700;color:#fbbf24")}>Approval is blocked — {blockers.length} required sections are not complete</span>
          <div style={css("display:flex;gap:8px;flex-wrap:wrap")}>
            {blockers.map((b) => (
              <button key={b.key} onClick={() => ctrl.patch({ sec: b.key })} style={css("padding:5px 11px;border-radius:6px;border:1px solid rgba(251,191,36,.32);background:rgba(251,191,36,.08);color:#fbbf24;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit")}>{b.num} {b.label} →</button>
            ))}
          </div>
        </div>
      )}

      <div style={css("display:grid;grid-template-columns:248px minmax(0,1fr);gap:16px;align-items:start")}>
        <div style={css("display:flex;flex-direction:column;gap:8px;position:sticky;top:16px")}>
          <div style={css("display:flex;flex-direction:column;gap:2px;padding:11px 12px;border:1px solid rgba(30,41,59,.9);border-radius:10px;background:#0b1524")}>
            <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569")}>Record completeness</span>
            <span style={css("font-size:13px;font-weight:700;color:" + (comp.done === comp.total ? "#34d399" : "#fbbf24"))}>{comp.done} of {comp.total} required sections</span>
            <div style={css("height:4px;border-radius:2px;background:rgba(148,163,184,.14);overflow:hidden;margin-top:5px")}>
              <div style={css("height:100%;width:" + comp.pct + "%;background:" + (comp.done === comp.total ? "#34d399" : "#fbbf24"))} />
            </div>
          </div>
          <div style={css("display:flex;flex-direction:column;gap:2px;border:1px solid rgba(30,41,59,.9);border-radius:10px;background:#0b1524;padding:6px;overflow:hidden")}>
            {CC_SECS.map((sc) => {
              const on = sc.key === s.sec;
              const scDone = sectionDone(cur, sc.key);
              const dot = scDone ? "✓" : sc.req ? "!" : "·";
              return (
                <button key={sc.key} data-testid={`cc-rail-${sc.key}`} onClick={() => ctrl.patch({ sec: sc.key })} style={css("display:flex;align-items:center;gap:9px;width:100%;text-align:left;padding:9px 10px;border:none;border-radius:7px;cursor:pointer;font-family:inherit;background:" + (on ? "rgba(0,120,212,.16)" : "transparent"))}>
                  <span style={css("flex:0 0 auto;font-size:9.5px;font-weight:700;font-family:" + MONO + ";color:" + (on ? "#93c5fd" : "#475569"))}>{sc.num}</span>
                  <span style={css("flex:1;min-width:0;font-size:12px;font-weight:" + (on ? "700" : "500") + ";color:" + (on ? "#f1f5f9" : "#94a3b8") + ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{sc.label}</span>
                  <span style={css("flex:0 0 auto;width:15px;height:15px;display:flex;align-items:center;justify-content:center;border-radius:4px;font-size:9px;font-weight:700;color:" + (scDone ? "#34d399" : "#fbbf24") + ";background:" + (scDone ? "rgba(52,211,153,.1)" : "rgba(251,191,36,.1)"))}>{dot}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={css("display:flex;flex-direction:column;gap:12px;min-width:0")}>
          <div style={css("display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;padding-bottom:10px;border-bottom:1px solid rgba(30,41,59,.9)")}>
            <div style={css("display:flex;flex-direction:column;gap:4px;min-width:0")}>
              <span style={css("font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#60a5fa")}>Section {secDef.num} of 11</span>
              <span style={css("font-size:15.5px;font-weight:700;color:#f8fafc;letter-spacing:-.01em")}>{secDef.label}</span>
              <span style={css("font-size:11.5px;color:#94a3b8;line-height:1.55;max-width:80ch;text-wrap:pretty")}>{secDef.intro}</span>
            </div>
            <div style={css("display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex:0 0 auto")}>
              <span style={css(pill(canEdit ? "You can edit this" : "Filled in by Shane McCaw Consulting", canEdit ? "#34d399" : "#64748b", "rgba(148,163,184,.08)"))}>
                {canEdit ? "You can edit this section" : "Read-only — your architect owns this section"}
              </span>
              {canEdit && (
                <button onClick={() => openSectionEditForm(ctrl, cur, secDef)} style={css("padding:6px 12px;border-radius:6px;border:1px solid rgba(0,120,212,.4);background:rgba(0,120,212,.1);color:#93c5fd;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap")}>Edit this section</button>
              )}
            </div>
          </div>
          <RecordSection cr={cur} secKey={secDef.key} ctrl={ctrl} />
        </div>
      </div>
    </div>
  );
}

function openSectionEditForm(ctrl: CcController, cur: ChangeRequest, secDef: (typeof CC_SECS)[number]) {
  ctrl.openForm({
    kicker: cur.code + " · section " + secDef.num,
    title: "Edit " + secDef.label.toLowerCase(),
    intro: "Every field change lands in the audit log with your name and a diff. Nothing is edited quietly.",
    submitLabel: "Save the section",
    foot: "Editing an approved record resets the approval — the signature was for the old version.",
    values: { title: cur.title, scope: cur.scope, just: cur.just, priority: cur.priority, risk: cur.risk },
    fields: [
      { k: "title", label: "Title", kind: "text", req: true },
      { k: "scope", label: "Scope", kind: "text", req: true, hint: "Name the group a failure would touch, not the group the change is aimed at." },
      { k: "just", label: "Business justification", kind: "area", req: true },
      { k: "priority", label: "Priority", kind: "pick", options: ["Low", "Normal", "High", "Emergency"], req: true },
      { k: "risk", label: "Risk category", kind: "pick", options: ["Low", "Medium", "High"], req: true },
    ],
    done: "Section saved on " + cur.code + ". The change is in the audit log with the previous values beside it.",
  });
}

/* ── Policy (settings): the deep-linkable ccView === 'settings' view ─────────
 * Round Two moved the change-control policy UI out of this module's sub-nav into
 * the Settings page, but the module keeps a deep-linkable policy view that the
 * shell's header change-control badge and its alerts still target. The design
 * left no markup for it — but the policy statement, the freeze policy and the
 * NOTIF notification rules (with their edit forms) all live in the logic class
 * with no rendered home, so this view is their home. Every prose string here is
 * verbatim design copy; only the structural section labels are added, which a
 * view the design removed unavoidably needs. */
const NOTIF_GRID = "minmax(200px,1.6fr) minmax(130px,1fr) minmax(150px,1fr) minmax(150px,1fr) 54px auto";

function SettingsView({ ctrl }: { ctrl: CcController }) {
  const notif = ctrl.notif();
  const FZ = CC_FREEZE;
  return (
    <div style={css("display:flex;flex-direction:column;gap:20px")} data-testid="cc-view-settings">
      <div style={css("display:flex;flex-direction:column;gap:12px;padding:16px 18px;border:1px solid rgba(0,120,212,.28);border-radius:12px;background:#0b1524")}>
        <div style={css("display:flex;flex-direction:column;gap:5px")}>
          <span style={css("font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#60a5fa")}>Change control policy</span>
          <span style={css("font-size:14.5px;font-weight:800;color:#f8fafc;letter-spacing:-.01em")}>Every change runs through a request and 2 signatures.</span>
          <span style={css("font-size:11.5px;color:#94a3b8;line-height:1.6;text-wrap:pretty")}>
            A draft is on the register and visible to both sides immediately. Nothing runs against the tenant until it is approved and the window opens.
          </span>
        </div>
        <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:13px;padding-top:11px;border-top:1px solid rgba(30,41,59,.8)")}>
          <div style={css("display:flex;flex-direction:column;gap:3px;min-width:0")}>
            <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569")}>Change window</span>
            <span style={css(valCss())}>Change window Tue–Thu · Month-end blackout</span>
          </div>
          <div style={css("display:flex;flex-direction:column;gap:3px;min-width:0")}>
            <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569")}>Separation of duties</span>
            <span style={css(valCss())}>The approver must be a different person from the submitter — the record enforces that, not the policy document.</span>
          </div>
          <div style={css("display:flex;flex-direction:column;gap:3px;min-width:0")}>
            <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569")}>Active freeze</span>
            <span style={css(valCss())}>{FZ.label} · {FZ.range}</span>
          </div>
          <div style={css("display:flex;flex-direction:column;gap:3px;min-width:0")}>
            <span style={css("font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569")}>Emergency changes</span>
            <span style={css(valCss())}>{FZ.policy}</span>
          </div>
        </div>
      </div>

      <div style={css("display:flex;flex-direction:column;gap:10px")}>
        <div style={css("display:flex;flex-direction:column;gap:3px")}>
          <span style={css("font-size:14px;font-weight:800;color:#f8fafc;letter-spacing:-.01em")}>Notifications</span>
          <span style={css("font-size:11.5px;color:#64748b;line-height:1.55")}>Who hears about this, on what channel, and how long before it matters.</span>
        </div>
        <div style={css("border:1px solid rgba(30,41,59,.9);border-radius:11px;background:#0b1524;overflow-x:auto")}>
          {notif.map((n, ni) => (
            <div key={n.event} style={css("display:grid;grid-template-columns:" + NOTIF_GRID + ";gap:12px;align-items:center;padding:11px 14px;border-bottom:1px solid rgba(30,41,59,.55);min-width:840px;opacity:" + (n.on ? "1" : ".6"))}>
              <span style={css("font-size:12px;font-weight:700;color:#e2e8f0;line-height:1.4")}>{n.event}</span>
              <span style={css("font-size:11px;color:#94a3b8")}>{n.channel}</span>
              <span style={css("font-size:11px;color:#94a3b8")}>{n.to}</span>
              <span style={css("font-size:11px;color:#94a3b8")}>{n.lead}</span>
              <Pill text={n.on ? "On" : "Off"} tone={n.on ? "#34d399" : "#f87171"} bg={(n.on ? "#34d399" : "#f87171") + "14"} />
              <div style={css("display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end")}>
                <button onClick={() => openNotifEditForm(ctrl, ni)} style={css("padding:5px 10px;border-radius:6px;border:1px solid rgba(0,120,212,.4);background:rgba(0,120,212,.1);color:#93c5fd;font-size:10.5px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap")}>{n.on ? "Edit" : "Turn on"}</button>
                <button onClick={() => ctrl.t('Test notification sent for "' + n.event + '" to ' + n.to + ".")} style={css("padding:5px 10px;border-radius:6px;border:1px solid rgba(148,163,184,.24);background:transparent;color:#94a3b8;font-size:10.5px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap")}>Test</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function openNotifEditForm(ctrl: CcController, ni: number) {
  const n = ctrl.notif()[ni];
  ctrl.openForm({
    kicker: "Notification rule",
    title: n.event,
    intro: "Who hears about this, on what channel, and how long before it matters.",
    submitLabel: "Save the rule",
    foot: "Lead time is the whole game. Thirty days is a change; one day is an incident.",
    values: { channel: n.channel, to: n.to, lead: n.lead, on: n.on },
    fields: [
      { k: "channel", label: "Channel", kind: "pick", options: ["Email", "Teams", "Email · Teams", "SMS · Teams"], req: true },
      { k: "to", label: "Who gets it", kind: "text", req: true, ph: "e.g. Priya Raman, IT team" },
      { k: "lead", label: "Lead time", kind: "pick", options: ["Immediately", "Within 4 hours of publication", "Daily until actioned", "3 days ahead", "7 days ahead", "30 days ahead, then 7, then 1"], req: true },
      { k: "on", label: "State", kind: "toggle", toggleLabel: "This rule is on", req: false },
    ],
    onSubmit: (v) => ({ notifOv: ctrl.notif().map((x, i) => (i === ni ? { ...x, channel: String(v.channel), to: String(v.to), lead: String(v.lead), on: !!v.on } : x)) }),
    done: (v) => (v.on ? n.event + " → " + String(v.channel) + ", " + String(v.to) + ", " + String(v.lead).toLowerCase() + "." : n.event + " turned off. Nobody will be told."),
  });
}

/* ── The intake drawer (raise a change request) ────────────────────────────── */

const INTAKE_FIELDS: { k: keyof CcDraft; label: string; kind: "text" | "area" | "pick"; ph?: string; hint?: string; req: boolean; opts?: string[] }[] = [
  { k: "title", label: "Title", kind: "text", ph: "e.g. Block legacy authentication for all mailboxes", req: true },
  { k: "desc", label: "Description of the change", kind: "area", ph: "What actually changes in the tenant, in plain terms.", req: true },
  { k: "just", label: "Business justification", kind: "area", ph: "Why this is worth doing, and what it costs to leave alone.", req: true },
  { k: "scope", label: "Scope", kind: "text", ph: "Tenant, workload, user group", req: true, hint: "Name the group a failure would touch, not the group the change is aimed at." },
  { k: "deps", label: "Dependencies", kind: "text", ph: "Other CRs, firmware, third-party systems — or None", req: false },
  { k: "priority", label: "Priority", kind: "pick", opts: ["Low", "Normal", "High", "Emergency"], req: true },
  { k: "risk", label: "Risk category", kind: "pick", opts: ["Low", "Medium", "High"], req: true, hint: "The AI score in section 10 checks this against the payload and flags a mismatch." },
  { k: "sec", label: "Security impact summary", kind: "area", ph: "What this opens, closes or leaves unchanged.", req: true },
  { k: "comp", label: "Compliance impact summary", kind: "area", ph: "Which control or standard this satisfies or contradicts.", req: true },
];

function IntakeDrawer({ ctrl }: { ctrl: CcController }) {
  const { s } = ctrl;
  if (!s.intakeOpen) return null;
  const mode = s.intakeMode;
  const useDefs = mode === "emergency" ? INTAKE_FIELDS.filter((f) => ["title", "desc", "just", "scope"].indexOf(f.k) >= 0) : INTAKE_FIELDS;
  const missingReq = useDefs.filter((f) => f.req && !String(s.draft[f.k]).trim()).length;
  const kicker = mode === "emergency" ? "Emergency change" : mode === "standard" ? "Standard change · pre-approved" : "Raise a change request";
  const intro =
    mode === "emergency"
      ? "For something already broken. Four fields now, the full record inside 24 hours, and a retrospective approval before the clock runs out. Using this path when nothing is broken is the fastest way to lose it."
      : mode === "standard"
        ? "A pre-approved change from the catalogue. No peer review, no window, no approval — but it still lands on the register and in the audit log."
        : "Nine fields to get it on the register. Impact, rollback, test and deployment can be filled in after — but the CR cannot be approved until they are.";
  const owes =
    mode === "emergency"
      ? ["Retrospective approval from the freeze and change owner, inside 24 hours", "The full record — impact, rollback, what actually ran — inside 24 hours", "A post-implementation review inside 48 hours", "A follow-up change to restore whatever control you had to remove"]
      : mode === "standard"
        ? ["Nothing. The catalogue entry carries the impact, the rollback and the approval — that is what pre-approved means."]
        : ["Impact assessment — functional, user and operational", "Rollback plan with a named engineer", "Test plan and evidence, or the compensating control if there is no test tenant", "Deployment plan with a window inside your change policy"];
  const submitLabel = missingReq ? "Fill " + missingReq + " required field" + (missingReq === 1 ? "" : "s") : mode === "emergency" ? "Raise it now · start the 24-hour clock" : mode === "standard" ? "Run it · pre-approved" : "Add to the register as a draft";
  const foot = mode === "emergency" ? "The pre-change state is captured the moment you raise it, so the rollback is exact rather than remembered." : "A draft is on the register and visible to both sides immediately. Nothing runs against the tenant until it is approved and the window opens.";

  const submit = () => {
    if (missingReq) return;
    const m = mode;
    ctrl.patch({ intakeOpen: false, intakeMode: "normal" });
    ctrl.t(
      m === "emergency"
        ? "Emergency change raised. Priya Raman notified by SMS, the 24-hour documentation clock started, and the pre-change state was captured before anything ran."
        : m === "standard"
          ? "Standard change queued. No approval needed, and it is on the register and in the audit log before it runs."
          : "Draft added to the register. It cannot go for approval until the four outstanding sections are complete.",
    );
  };

  return (
    <>
      <div onClick={() => ctrl.patch({ intakeOpen: false, intakeMode: "normal" })} style={css("position:fixed;inset:0;z-index:118;background:rgba(2,6,23,.6);backdrop-filter:blur(2px)")} />
      <div style={css("position:fixed;top:0;right:0;bottom:0;z-index:119;width:min(660px,95vw);display:flex;flex-direction:column;border-left:1px solid rgba(0,120,212,.4);background:#0b1524;box-shadow:-24px 0 60px rgba(2,6,23,.65);overflow:hidden")} data-testid="cc-intake-drawer">
        <div style={css("flex:0 0 auto;padding:16px 20px;border-bottom:1px solid rgba(0,120,212,.2);display:flex;align-items:flex-start;justify-content:space-between;gap:12px")}>
          <div style={css("display:flex;flex-direction:column;gap:4px;min-width:0")}>
            <span style={css("font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#60a5fa")}>{kicker}</span>
            <span style={css("font-size:11.5px;color:#64748b;line-height:1.5;max-width:60ch")}>{intro}</span>
          </div>
          <button onClick={() => ctrl.patch({ intakeOpen: false, intakeMode: "normal" })} style={css("flex:0 0 auto;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:6px;border:1px solid rgba(148,163,184,.22);background:transparent;color:#94a3b8;font-size:14px;line-height:1;cursor:pointer;font-family:inherit")}>×</button>
        </div>
        <div style={css("flex:1;min-height:0;overflow-y:auto;padding:16px 20px 24px;display:flex;flex-direction:column;gap:14px")}>
          {useDefs.map((f) => {
            const value = String(s.draft[f.k] ?? "");
            const done = value.trim().length > 0;
            return (
              <div key={f.k} style={css("display:flex;flex-direction:column;gap:5px")}>
                <div style={css("display:flex;align-items:baseline;justify-content:space-between;gap:10px")}>
                  <span style={css("font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748b")}>{f.label}</span>
                  <span style={css("font-size:9.5px;font-weight:700;color:" + (f.req ? (done ? "#34d399" : "#fbbf24") : "#475569"))}>{f.req ? "Required" : "Optional"}</span>
                </div>
                {f.kind === "text" && <input value={value} onChange={(e) => ctrl.setDraft(f.k, e.target.value)} placeholder={f.ph} style={css("padding:10px 12px;border-radius:7px;border:1px solid rgba(30,41,59,.9);background:#0b1a2e;color:#e2e8f0;font-size:12.5px;font-family:inherit")} />}
                {f.kind === "area" && <textarea value={value} onChange={(e) => ctrl.setDraft(f.k, e.target.value)} placeholder={f.ph} style={css("min-height:76px;padding:10px 12px;border-radius:7px;border:1px solid rgba(30,41,59,.9);background:#0b1a2e;color:#e2e8f0;font-size:12.5px;line-height:1.6;font-family:inherit;resize:vertical")} />}
                {f.kind === "pick" && (
                  <div style={css("display:flex;gap:7px;flex-wrap:wrap")}>
                    {(f.opts || []).map((o) => (
                      <button key={o} onClick={() => ctrl.setDraft(f.k, o)} style={css("padding:7px 13px;border-radius:6px;font-size:11.5px;font-weight:" + (value === o ? "700" : "600") + ";font-family:inherit;cursor:pointer;border:1px solid " + (value === o ? "rgba(0,120,212,.5)" : "rgba(148,163,184,.2)") + ";background:" + (value === o ? "rgba(0,120,212,.14)" : "transparent") + ";color:" + (value === o ? "#93c5fd" : "#94a3b8"))}>{o}</button>
                    ))}
                  </div>
                )}
                {f.hint && <span style={css("font-size:10.5px;color:#64748b;line-height:1.5")}>{f.hint}</span>}
              </div>
            );
          })}
          <div style={css("display:flex;flex-direction:column;gap:8px;padding:13px 14px;border:1px solid rgba(0,120,212,.28);border-radius:10px;background:rgba(0,120,212,.05)")}>
            <span style={css("font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#93c5fd")}>What this CR will still owe</span>
            <div style={css("display:flex;flex-direction:column;gap:5px")}>
              {owes.map((o) => (
                <div key={o} style={css("display:flex;align-items:center;gap:9px")}>
                  <span style={css("width:5px;height:5px;border-radius:50%;background:#fbbf24;flex:0 0 auto")} />
                  <span style={css("font-size:11.5px;color:#cbd5e1;line-height:1.5")}>{o}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={css("flex:0 0 auto;padding:14px 20px;border-top:1px solid rgba(30,41,59,.9);display:flex;align-items:center;gap:10px;flex-wrap:wrap")}>
          <button onClick={submit} disabled={missingReq > 0} style={css("padding:9px 15px;border-radius:7px;font-size:12px;font-weight:700;font-family:inherit;border:1px solid " + (missingReq ? "rgba(148,163,184,.18)" : "#0078D4") + ";background:" + (missingReq ? "transparent" : "#0078D4") + ";color:" + (missingReq ? "#475569" : "#fff") + ";cursor:" + (missingReq ? "not-allowed" : "pointer"))}>{submitLabel}</button>
          <button onClick={() => ctrl.patch({ intakeOpen: false, intakeMode: "normal" })} style={css("padding:9px 15px;border-radius:7px;border:none;background:transparent;color:#64748b;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit")}>Cancel</button>
          <span style={css("font-size:10.5px;color:#475569;line-height:1.45;flex:1 1 200px;min-width:0")}>{foot}</span>
        </div>
      </div>
    </>
  );
}

/* ── The generic form drawer ───────────────────────────────────────────────── */

function FormDrawer({ ctrl }: { ctrl: CcController }) {
  const { s } = ctrl;
  const form = s.form;
  if (!form) return null;
  const cfg = form.cfg;
  const vals = form.vals;
  const missing = cfg.fields.filter((f) => f.req && (f.kind === "toggle" ? !vals[f.k] : !String(vals[f.k] ?? "").trim())).length;
  const submitLabel = missing ? "Fill " + missing + " required field" + (missing === 1 ? "" : "s") : cfg.submitLabel;

  return (
    <>
      <div onClick={ctrl.closeForm} style={css("position:fixed;inset:0;z-index:120;background:rgba(2,6,23,.6);backdrop-filter:blur(2px)")} />
      <div style={css("position:fixed;top:0;right:0;bottom:0;z-index:121;width:min(600px,95vw);display:flex;flex-direction:column;border-left:1px solid rgba(0,120,212,.4);background:#0b1524;box-shadow:-24px 0 60px rgba(2,6,23,.65);overflow:hidden")} data-testid="cc-form-drawer">
        <div style={css("flex:0 0 auto;padding:16px 20px;border-bottom:1px solid rgba(0,120,212,.2);display:flex;align-items:flex-start;justify-content:space-between;gap:12px")}>
          <div style={css("display:flex;flex-direction:column;gap:4px;min-width:0")}>
            <span style={css("font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#60a5fa")}>{cfg.kicker}</span>
            <span style={css("font-size:14.5px;font-weight:800;color:#f8fafc;letter-spacing:-.01em;line-height:1.35")}>{cfg.title}</span>
            <span style={css("font-size:11.5px;color:#64748b;line-height:1.55;max-width:60ch")}>{cfg.intro}</span>
          </div>
          <button onClick={ctrl.closeForm} style={css("flex:0 0 auto;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:6px;border:1px solid rgba(148,163,184,.22);background:transparent;color:#94a3b8;font-size:14px;line-height:1;cursor:pointer;font-family:inherit")}>×</button>
        </div>
        <div style={css("flex:1;min-height:0;overflow-y:auto;padding:16px 20px 24px;display:flex;flex-direction:column;gap:14px")}>
          {cfg.fields.map((f) => {
            const value = vals[f.k] === undefined ? "" : vals[f.k];
            const filled = f.kind === "toggle" ? !!value : String(value ?? "").trim().length > 0;
            return (
              <div key={f.k} style={css("display:flex;flex-direction:column;gap:5px")}>
                <div style={css("display:flex;align-items:baseline;justify-content:space-between;gap:10px")}>
                  <span style={css("font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748b")}>{f.label}</span>
                  <span style={css("font-size:9.5px;font-weight:700;color:" + (f.req ? (filled ? "#34d399" : "#fbbf24") : "#475569"))}>{f.req ? "Required" : "Optional"}</span>
                </div>
                {f.kind === "text" && <input value={String(value ?? "")} onChange={(e) => ctrl.setFV(f.k, e.target.value)} placeholder={f.ph} style={css("padding:10px 12px;border-radius:7px;border:1px solid rgba(30,41,59,.9);background:#0b1a2e;color:#e2e8f0;font-size:12.5px;font-family:inherit")} />}
                {f.kind === "area" && <textarea value={String(value ?? "")} onChange={(e) => ctrl.setFV(f.k, e.target.value)} placeholder={f.ph} style={css("min-height:84px;padding:10px 12px;border-radius:7px;border:1px solid rgba(30,41,59,.9);background:#0b1a2e;color:#e2e8f0;font-size:12.5px;line-height:1.6;font-family:inherit;resize:vertical")} />}
                {f.kind === "select" && (
                  <select value={String(value ?? "")} onChange={(e) => ctrl.setFV(f.k, e.target.value)} style={css("padding:10px 12px;border-radius:7px;border:1px solid rgba(30,41,59,.9);background:#0b1a2e;color:#e2e8f0;font-size:12.5px;font-family:inherit;cursor:pointer")}>
                    {(f.options || []).map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                )}
                {f.kind === "pick" && (
                  <div style={css("display:flex;gap:7px;flex-wrap:wrap")}>
                    {(f.options || []).map((o) => (
                      <button key={o} onClick={() => ctrl.setFV(f.k, o)} style={css("padding:7px 12px;border-radius:6px;font-size:11.5px;font-weight:" + (value === o ? "700" : "600") + ";font-family:inherit;cursor:pointer;text-align:left;border:1px solid " + (value === o ? "rgba(0,120,212,.5)" : "rgba(148,163,184,.2)") + ";background:" + (value === o ? "rgba(0,120,212,.14)" : "transparent") + ";color:" + (value === o ? "#93c5fd" : "#94a3b8"))}>{o}</button>
                    ))}
                  </div>
                )}
                {f.kind === "toggle" && (
                  <button onClick={() => ctrl.setFV(f.k, !value)} style={css("display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:8px;border:1px solid " + (value ? "rgba(52,211,153,.4)" : "rgba(148,163,184,.2)") + ";background:" + (value ? "rgba(52,211,153,.07)" : "transparent") + ";cursor:pointer;font-family:inherit;text-align:left;width:100%")}>
                    <span style={css("flex:0 0 auto;width:16px;height:16px;display:flex;align-items:center;justify-content:center;border-radius:4px;font-size:10px;font-weight:700;color:" + (value ? "#04121f" : "transparent") + ";background:" + (value ? "#34d399" : "transparent") + ";border:1px solid " + (value ? "#34d399" : "rgba(148,163,184,.35)"))}>✓</span>
                    <span style={css("flex:1;font-size:12px;color:#e2e8f0;line-height:1.5;min-width:0")}>{f.toggleLabel || f.label}</span>
                  </button>
                )}
                {f.hint && <span style={css("font-size:10.5px;color:#64748b;line-height:1.55")}>{f.hint}</span>}
              </div>
            );
          })}
        </div>
        <div style={css("flex:0 0 auto;padding:14px 20px;border-top:1px solid rgba(30,41,59,.9);display:flex;align-items:center;gap:10px;flex-wrap:wrap")}>
          <button onClick={() => { if (!missing) ctrl.submitForm(); }} disabled={missing > 0} style={css("padding:9px 15px;border-radius:7px;font-size:12px;font-weight:700;font-family:inherit;white-space:nowrap;border:1px solid " + (missing ? "rgba(148,163,184,.18)" : "#0078D4") + ";background:" + (missing ? "transparent" : "#0078D4") + ";color:" + (missing ? "#475569" : "#fff") + ";cursor:" + (missing ? "not-allowed" : "pointer"))}>{submitLabel}</button>
          <button onClick={ctrl.closeForm} style={css("padding:9px 15px;border-radius:7px;border:none;background:transparent;color:#64748b;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit")}>Cancel</button>
          <span style={css("font-size:10.5px;color:#475569;line-height:1.45;flex:1 1 200px;min-width:0")}>{cfg.foot || ""}</span>
        </div>
      </div>
    </>
  );
}

function Toast({ ctrl }: { ctrl: CcController }) {
  if (!ctrl.s.toast) return null;
  return (
    <div style={css("position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:130;display:flex;align-items:center;gap:11px;padding:12px 17px;border:1px solid rgba(0,120,212,.4);border-radius:9px;background:#0b1a2e;box-shadow:0 18px 40px rgba(2,6,23,.6);max-width:min(620px,92vw)")} data-testid="cc-toast">
      <span style={css("width:6px;height:6px;border-radius:50%;background:#34d399;flex:0 0 auto")} />
      <span style={css("font-size:12px;color:#e2e8f0;line-height:1.5")}>{ctrl.s.toast}</span>
      <button onClick={ctrl.clearToast} style={css("flex:0 0 auto;border:none;background:transparent;color:#64748b;font-size:13px;cursor:pointer;font-family:inherit")}>×</button>
    </div>
  );
}

/* ── The page ──────────────────────────────────────────────────────────────── */

export default function PortalV2ChangeControlPage() {
  const [, params] = useRoute("/portal-v2/change-control/:view");
  const raw = params?.view;
  const viewParam = raw && URL_VIEWS.has(raw) ? raw : "briefing";
  const ctrl = useChangeControl({ viewParam });
  const { s } = ctrl;

  return (
    <PortalV2Shell eyebrow="Operate" title="Change Control">
      <div style={{ minHeight: "100%", background: SIDEBAR_WASH }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 28px 110px", display: "flex", flexDirection: "column", gap: 16, boxSizing: "border-box" }}>
          <div style={css("display:flex;flex-direction:column;gap:16px;align-items:stretch")}>
            {s.focusCode && (
              <button onClick={() => ctrl.patch({ focusCode: null, statFilter: null })} style={css("align-self:flex-start;padding:7px 12px;border-radius:7px;border:1px solid rgba(34,211,238,.4);background:rgba(34,211,238,.08);color:#22d3ee;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;line-height:1.4;text-align:left")}>
                Showing {s.focusCode} only · show everything
              </button>
            )}
            <div style={css("display:flex;flex-direction:column;gap:16px;min-width:0")}>
              <StatsBand ctrl={ctrl} />
              {s.view === "briefing" && <BriefingView ctrl={ctrl} />}
              {s.view === "register" && <RegisterView ctrl={ctrl} />}
              {s.view === "catalogue" && <CatalogueView ctrl={ctrl} />}
              {s.view === "calendar" && <CalendarView ctrl={ctrl} />}
              {s.view === "review" && <ReviewView ctrl={ctrl} />}
              {s.view === "record" && <RecordView ctrl={ctrl} />}
              {s.view === "settings" && <SettingsView ctrl={ctrl} />}
            </div>
          </div>
        </div>
      </div>
      <IntakeDrawer ctrl={ctrl} />
      <FormDrawer ctrl={ctrl} />
      <Toast ctrl={ctrl} />
    </PortalV2Shell>
  );
}
