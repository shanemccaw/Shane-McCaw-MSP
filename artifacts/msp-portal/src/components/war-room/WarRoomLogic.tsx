/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (script lines 7938-13461 - stateful briefing controller)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { WarRoomView } from "./WarRoomView";
import {
  PILLARS,
  NODES,
  CONTEXT,
  INTRO,
  PERSONAS,
  PERSONA_BRIEF,
  ICONS,
  CARDS,
  BLAST,
  SCAN_STEPS,
  FINDINGS,
  PILLAR_META,
  USE_CASES,
  GOV_WALK,
  walkSet,
  walkAt,
  QUICK_WINS,
  PILLAR_GLYPH,
  fixProfileFor,
  smartIcon,
  HERO_PHASE,
  HERO_SCAN,
  HERO_Q,
  DOCS,
  DIVE_INV,
  DIVES,
  LIC_PEOPLE,
  LIC_SKUS,
  COPILOT_RETURN,
  COPILOT_BASE,
  ONEDRIVE,
  GOV_EXPOSURE_PATH,
  CHANGES,
  bandFor,
  changesForSection,
  LIC_WALK,
  DIVE_CFG,
  ADO_WALK,
  CMP_WALK,
  HLT_WALK,
  SEC_WALK,
  CPL_WALK,
  SOW_PHASES,
  SOW_WALK,
  DOC_LIBRARY,
  DOCS_WALK,
  TIMELINE,
  PERSONA_CATALOG,
  WIZ_PERSONAS,
  WIZ_QUESTIONS,
  SCAN_PHASES,
  GOV_BASE,
  GOV_LEVERS,
  SCRIPT,
  TOPICS,
  TOPIC_NODE,
  TOPIC_FOR,
  MAP_NODE,
  MAP_PILLAR,
  SITES,
  STATUS,
  AMBIENCE,
  walkPillarRef,
} from "./data/warRoomData";
import {
  WAR_ROOM_SECTIONS,
  deriveWarRoomSection,
  isWarRoomSectionLive,
  resolveWarRoomSection,
} from "./warRoomSections";

/**
 * Drives the whole War Room: the scripted briefing beat machine, the topology focus
 * state, every dive panel's interaction state, and renderVals(), which computes the
 * fully-resolved style/colour/handler bundle the view renders.
 */
export class WarRoomLogic extends React.Component<Record<string, unknown>, any> {
  state = {
    beat: -1,
    intro: null,
    introStage: "arriving",
    introArrived: [],
    introHeard: [],
    introSel: null,
    dive: null,
    levers: {},
    changes: {},
    prelude: "hero",
    heroTick: 0,
    onb: [],
    onbPicked: [],
    wizStep: 0,
    wizPersonas: WIZ_PERSONAS.filter(p => p.default).map(p => p.id),
    wizAnswers: {},
    scanStep: 0,
    govAt: "c0",
    govTab: "sharepoint",
    licTab: "mismatch",
    licNorm: false,
    licFix: false,
    adoTab: "personas",
    adoTrained: {},
    adoFlows: {},

    govSel: null,
    govPreview: null,
    govPath: false,
    lic: {},
    pinned: [],
    pinnedPillars: [],
    covered: {},
    playing: false,
    statuses: NODES.reduce((a, n) => { a[n.id] = n.status; return a; }, {}),
    joined: [],
    mood: "neutral",
    focus: null,
    chain: false,
    readiness: 61,
    selected: null,
    logs: [],
    paused: false,
    consoleOpen: true,
    query: "",
    filter: "all",
    userLine: null,
    said: [],
    chatLog: false,
    remediated: 6,
    fit: 0.82,
    par: { x: 0, y: 0 },
    chatOpen: false,
    draft: "",
    injected: null,
    exiting: false,
    topic: null,
    persona: null,
    card: null,
    cardDone: false,
    addressee: null,
    qa: null,
    act: 0,
    demo: null,
    demoSite: null,
    demoQA: [],
    demoDraft: "",
    hidden: false,
    quantified: false,
    payoff: false,
    closing: false,
    board: [],
    closeChoice: null,
    blast: null,
    applied: {},
    metrics: { dlpCoverage: 84, caComplete: 88, oversharing: 41, extExposure: 612, drift: 312, compliance: 94.2, seatDrift: -12, chainSeverity: 3 }
  };

  // The radar's real painted box — parallax, rotateX and focus zoom all move it,
  // so seat geometry is measured from the element, never recomputed from the stage.
  // A captured use case flies from the speaker's bubble to the board.
  flightFrom(ucId) {
    if (typeof document === "undefined") return null;
    const b = document.querySelector("[data-bubble]");
    const bd = document.querySelector("[data-board]");
    if (!b || !bd) return null;
    const r = b.getBoundingClientRect(), t = bd.getBoundingClientRect();
    if (!r.width || !t.width) return null;
    clearTimeout(this.flightT1); clearTimeout(this.flightT2);
    this.flightT1 = setTimeout(() => this.setState(st => (st.flight ? { flight: Object.assign({}, st.flight, { phase: 1 }) } : null)), 60);
    this.flightT2 = setTimeout(() => this.setState({ flight: null }), 1250);
    return {
      uc: ucId, phase: 0,
      x: Math.round(r.left), y: Math.round(r.top + 8), w: Math.round(Math.min(300, r.width)),
      tx: Math.round(t.left + 8), ty: Math.round(t.top + 34)
    };
  }

  setMapBox = (el) => {
    this.mapEl = el;
    if (this.mapRo) { this.mapRo.disconnect(); this.mapRo = null; }
    if (!el) return;
    const measure = () => {
      const st = this.stageEl;
      if (!st) return;
      const m = el.getBoundingClientRect(), s = st.getBoundingClientRect();
      if (!m.width || !s.width) return;
      const box = {
        cx: ((m.x + m.width / 2 - s.x) / s.width) * 100,
        cy: ((m.y + m.height / 2 - s.y) / s.height) * 100,
        rPx: Math.min(m.width, m.height) / 2,
        w: s.width, h: s.height
      };
      const prev = this.mapBox;
      if (!prev || Math.abs(prev.cx - box.cx) > 0.4 || Math.abs(prev.cy - box.cy) > 0.4 || Math.abs(prev.rPx - box.rPx) > 3) {
        this.mapBox = box;
        this.forceUpdate();
      }
    };
    if (typeof ResizeObserver !== "undefined") { this.mapRo = new ResizeObserver(measure); this.mapRo.observe(el); }
    // the radar settles over ~2s (fit, parallax, focus zoom); keep re-measuring
    this.mapMeasure = measure;
    let n = 0;
    const tick = () => { measure(); if (++n < 14) this.mapTimer = setTimeout(tick, 220); };
    requestAnimationFrame(tick);
  };

  setStage = (el) => {
    this.stageEl = el;
    if (!el) { if (this.ro) this.ro.disconnect(); return; }
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      this.stageW = r.width; this.stageH = r.height;
      const room = el.closest("[data-room]");
      const rr = room ? room.getBoundingClientRect() : r;
      const w = Math.max(r.width, Math.min(rr.width * 0.88, r.width * 1.9));
      const fit = Math.max(0.26, Math.min(1.05, Math.min(w / (1060 * 1.17), r.height / (1060 * 1.02))));
      if (Math.abs(fit - this.state.fit) > 0.005) this.setState({ fit });
    };
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(measure);
      this.ro.observe(el);
    }
    el.onmousemove = (e) => {
      const b = el.getBoundingClientRect();
      const px = (e.clientX - b.left) / b.width - 0.5;
      const py = (e.clientY - b.top) / b.height - 0.5;
      const qx = Math.round(px * 12) / 12, qy = Math.round(py * 12) / 12;
      if (this.parRaf || (qx === this.state.par.x && qy === this.state.par.y)) return;
      this.parRaf = requestAnimationFrame(() => { this.parRaf = null; this.setState({ par: { x: qx, y: qy } }); });
    };
    el.onmouseleave = () => this.setState({ par: { x: 0, y: 0 } });
    measure();
  };

  componentDidMount() {
    // A deep link or a refresh arrives with a section already in the URL (#303).
    // Restore straight to it rather than seeding the opening prelude and its
    // timers, which the restore would only have to tear down again. `restored`
    // has to carry that decision because the setState behind it has not landed
    // in this.state yet.
    const restored = this.restoreSection(this.props.section);
    if (!restored && this.state.prelude === "hero") this.heroSeed();
    this.mountTips();
    if (!restored && this.state.prelude === "chat") this.startOnb();
    if (!!DIVE_CFG[this.state.dive] && !this.govSeeded) { this.govSeeded = true; walkPillarRef.current = this.state.dive; this.seededFor = this.state.dive; this.startGovThread(); }
    if (!restored && this.state.intro === null && !this.state.prelude && !this.state.introStage) this.tick();

  }
  componentWillUnmount() { clearTimeout(this.timer); clearInterval(this.noise); if (this.ro) this.ro.disconnect(); }

  get speed() { return (this.props.dialogSpeed ?? 5.4) * 1000; }

  tick = () => {
    clearTimeout(this.timer);
    const s = this.state;
    if (!s.playing) return;
    if (s.prelude) return;                       // welcome / quiz / scan still up
    if (s.introStage) return;                    // arrivals or "who first" picker up
    if (s.intro !== null && s.intro !== undefined) return;
    if (s.dive || s.qa) return;                  // a dialog owns the room
    this.timer = setTimeout(() => this.advance(), this.state.beat < 0 ? 900 : this.speed);
  };

  advance = () => {
    if (!this.exitPending) {
      this.exitPending = true;
      this.setState({ exiting: true });
      this.timer = setTimeout(this.advance, 280);
      return;
    }
    this.exitPending = false;
    const next = this._target != null ? this._target : (this.state.beat + 1) % SCRIPT.length;
    this._target = null;
    const b = SCRIPT[next];
    this.setState(s => {
      const statuses = Object.assign({}, s.statuses, b.set || {});
      const joined = b.join && s.joined.indexOf(b.join) < 0 ? s.joined.concat(b.join) : s.joined;
      return {
        beat: next,
        exiting: false,
        hidden: false,
        act: b.act || 0,
        demo: b.demo ? { stage: 0 } : (next === 0 ? null : s.demo),
        demoSite: b.demo ? null : (next === 0 ? null : s.demoSite),
        demoQA: b.demo ? [] : (next === 0 ? [] : s.demoQA),
        quantified: b.quantified || (next === 0 ? false : s.quantified),
        payoff: b.payoff || (next === 0 ? false : s.payoff),
        closing: !!b.closing,
        board: b.board ? s.board.concat(b.board) : (next === 0 ? [] : s.board),
        card: b.hand || null,
        cardDone: b.hand ? false : s.cardDone && false,
        statuses,
        joined: next === 0 ? [] : joined,
        mood: b.mood || (next === 0 ? "neutral" : s.mood),
        focus: b.focus,
        dive: b.dive || null,
        pinned: b.uc ? (s.pinned.indexOf(b.uc) < 0 ? s.pinned.concat(b.uc) : s.pinned) : (next === 0 ? [] : s.pinned),
        flight: b.uc && s.pinned.indexOf(b.uc) < 0 ? this.flightFrom(b.uc) : (next === 0 ? null : s.flight),
        pinnedPillars: b.dive && FINDINGS[b.dive]
          ? ((s.pinnedPillars || []).indexOf(b.dive) < 0 ? (s.pinnedPillars || []).concat(b.dive) : s.pinnedPillars)
          : (next === 0 ? [] : (s.pinnedPillars || [])),
        covered: b.covers ? Object.assign({}, s.covered, b.covers.reduce((a, k) => { a[k] = true; return a; }, {})) : (next === 0 ? {} : s.covered),
        chain: !!b.chain,
        readiness: b.readiness || (next === 0 ? 61 : s.readiness),
        userLine: null,
        remediated: b.set && Object.values(b.set).indexOf("healthy") >= 0 ? Math.min(10, s.remediated + 1) : (next === 0 ? 6 : s.remediated)
      };
    }, this.tick);
    if (b.text) this.logSaid(b.who, b.text, next === 0);
    if (b.hand || b.demo || b.quantified || b.payoff || b.closing || b.dive) { clearTimeout(this.timer); this.setState({ playing: false }); }
    if (b.log) this.pushLog({ method: b.log[0], url: "https://graph.microsoft.com" + b.log[1], status: b.log[2], latency: b.log[3], text: b.log[4] });
  };

  jumpTo = (idx) => {
    if (idx == null || idx < 0 || idx >= SCRIPT.length) return;
    clearTimeout(this.timer);
    this._target = idx;
    this.exitPending = true;
    this.advance();
  };

  nextScene = () => {
    const cur = this.state.beat >= 0 ? (SCRIPT[this.state.beat].act || 0) : -1;
    let i = Math.max(0, this.state.beat) + 1;
    while (i < SCRIPT.length && (SCRIPT[i].act || 0) <= cur) i++;
    this.jumpTo(i < SCRIPT.length ? i : 0);
  };

  jumpAct = (act) => {
    const i = SCRIPT.findIndex(b => (b.act || 0) === act);
    if (i >= 0) this.jumpTo(i);
  };

  // ── /war-room/:section — URL <-> beat-machine sync (#303) ───────────────────
  // The section a URL names is applied through applySection(), which is the
  // transport jump-menu's own branch logic; nothing here is a second way to
  // navigate. `sectionAt` is the section the URL and this component agree on,
  // and is what stops an emit -> prop-change -> re-apply feedback loop.
  sectionAt = null;
  // A move is asked for before the state reflects it — jumpTo() lands a beat one
  // exit-animation later, and restoreSection() clears the prelude first. Until
  // it settles the state still describes the OLD position, so mirroring it back
  // out would overwrite the URL with where we just came from.
  sectionPending = null;

  /** Move to a named section exactly the way the transport jump-menu does. */
  applySection = (key) => {
    const target = resolveWarRoomSection(key);
    if (target.kind === "unreachable") return false;
    this.sectionAt = key;
    this.sectionPending = key;
    if (target.kind === "intro") { this.setState({ intro: 0, playing: false }); return true; }
    if (target.kind === "panel") { this.setState({ dive: target.dive, playing: false }); return true; }
    this.jumpTo(target.index);
    return true;
  };

  /** Tell the page where we are, so it can mirror it into the URL. */
  emitSection = (key, explicit) => {
    this.sectionAt = key;
    if (typeof this.props.onSectionChange === "function") this.props.onSectionChange(key, explicit);
  };

  /**
   * Land on a section that came from the URL (first load, refresh, or a
   * back/forward step) rather than from a click inside the room.
   *
   * The jump-menu only exists once the room is up, so a URL restore has to make
   * the same transition first: leave the opening prelude and the arrivals gate
   * behind, the way enterRoom() and onPickSkip() already do, and only then hand
   * off to applySection().
   */
  restoreSection = (key) => {
    if (!isWarRoomSectionLive(key)) return false;
    this.sectionAt = key;
    this.sectionPending = key;
    clearTimeout(this.timer);
    clearTimeout(this.scanT);
    clearInterval(this.scanClock);
    // "Introductions" IS the arrivals sequence, so it restores as a real entry
    // into the room rather than by skipping past it.
    if (key === "intro") { this.enterRoom(); return true; }
    this.setState({
      prelude: null, beginning: false, roomEnter: true,
      introStage: null, intro: null, introSel: null, introSpeaking: null, focus: null,
      playing: false
    }, () => this.applySection(key));
    return true;
  };

  /** Mirror wherever the briefing has actually got to back out into the URL. */
  syncSectionToUrl = () => {
    const derived = deriveWarRoomSection(this.state);
    if (this.sectionPending) {
      // Still settling — say nothing until the state agrees with what we asked for.
      if (derived === this.sectionPending) this.sectionPending = null;
      return;
    }
    if (derived && derived !== this.sectionAt) this.emitSection(derived, false);
  };

  scrollChat = () => {
    if (this.chatEl) requestAnimationFrame(() => { this.chatEl.scrollTop = this.chatEl.scrollHeight; });
  };

  logSaid = (who, text, reset) => {
    const d = new Date();
    const time = d.getHours() % 12 || 12;
    const stamp = time + ":" + String(d.getMinutes()).padStart(2, "0") + " " + (d.getHours() >= 12 ? "PM" : "AM");
    this.setState(s => {
      const prior = reset ? [] : s.said;
      if (prior.length && prior[prior.length - 1].text === text) return null;
      return { said: prior.concat([{ who, text, stamp }]) };
    }, this.scrollChat);
  };

  randomLog = () => {
    const n = NODES[Math.floor(Math.random() * NODES.length)];
    const jitter = Math.round(n.latency * (0.8 + Math.random() * 0.5));
    return { method: "GET", url: "https://graph.microsoft.com" + n.endpoint, status: 200, latency: jitter, text: n.label + " sync" };
  };

  pushLog = (entry) => {
    if (this.state.paused) return;
    const d = new Date();
    const time = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0");
    this.setState(s => ({ logs: [Object.assign({ time }, entry)].concat(s.logs).slice(0, 60) }));
  };

  applyCard = (id, sliderValue) => {
    const c = CARDS[id];
    this.setState(s => {
      const m = Object.assign({}, s.metrics);
      let pts = c.pts;
      if (c.control === "slider") {
        const span = c.max - c.min || 1;
        const done = c.invert ? (c.max - sliderValue) / span : (sliderValue - c.min) / span;
        pts = c.pts * done;
        if (id === "sharepoint") m.oversharing = Math.round(sliderValue);
        if (id === "licensing") m.seatDrift = Math.round(sliderValue);
      } else {
        if (id === "dlp") { m.dlpCoverage = 100; m.chainSeverity = Math.max(0, m.chainSeverity - 1); }
        if (id === "ca") m.caComplete = 100;
        if (id === "onedrive") m.extExposure = 96;
        if (id === "intune") { m.drift = 0; m.compliance = 99.4; }
        if (id === "riskchain") { m.chainSeverity = 0; m.dlpCoverage = 100; }
      }
      const applied = Object.assign({}, s.applied, { [id]: pts });
      const total = Object.keys(applied).reduce((a, k) => a + applied[k], 0);
      return { metrics: m, applied, readiness: Math.min(100, Math.round(61 + total)) };
    });
    if (c.control !== "slider") {
      this.setState({ cardDone: true });
      clearTimeout(this.cardTimer);
      this.cardTimer = setTimeout(() => this.setState({ card: null, cardDone: false }), 1700);
    }
  };

  route = (q) => {
    const t = q.toLowerCase();
    if (/dlp|egress|mailbox/.test(t)) return ["dlp", "marcus"];
    if (/onedrive|personal store|external shar/.test(t)) return ["guests", "jane"];
    if (/sharepoint|oversharing|org-wide|link/.test(t)) return ["sharepoint", "jane"];
    if (/intune|device|baseline|drift/.test(t)) return ["intune", "priya"];
    if (/licen|seat|roi|cost|spend/.test(t)) return ["meter", "priya"];
    if (/conditional|ca policy|mfa|sign-in|identity/.test(t)) return ["ca", "kirk"];
    if (/risk|msa|legal|exposure|contract/.test(t)) return ["dlp", "beth"];
    return ["copilotready", "shane"];
  };

  followUps = (topicId, t) => {
    const m = t.metrics || [];
    const n = (i) => (m[i] ? m[i][1] : "—");
    return [
      { key: "fix", label: "What's the fix?", who: "shane",
        text: "The fix is sequenced, not simultaneous. First: " + (t.bad[0] || t.ugly[0]) + ". Then " + (t.bad[1] || "the dependent work item") + ". " + (t.actions && t.actions[0] ? "I'd put " + t.actions[0][0].toLowerCase() + " on the plan this week." : "") },
      { key: "cost", label: "What does it cost me?", who: "priya",
        text: "In numbers: " + (m[0] ? m[0][0] + " sits at " + m[0][1] : "the exposure is measurable") + ", " + (m[1] ? m[1][0].toLowerCase() + " " + m[1][1] : "") + ". Against a $317K annual license position, this is the difference between paying for governed value and paying for exposure." },
      { key: "who", label: "Who owns it and by when?", who: "marcus",
        text: "My team owns the change. Ten working days on the current window, evidence pack attached to the finding. " + (m[3] ? m[3][0] + " lands at " + m[3][1] + " on close." : "") },
      { key: "risk", label: "What's the legal exposure?", who: "beth",
        text: "If this surfaces regulated content through a grounded answer, it is reportable under MSA §7.4 — not an internal issue. " + (t.ugly[0] || "") + " That is the line I care about." },
      { key: "proof", label: "Prove it from my tenant", who: "kirk",
        text: "Pulled live this morning: " + m.map(x => x[0] + " " + x[1]).join(", ") + ". Read-only against your own Graph, no sampling." }
    ];
  };

  ask = (raw) => {
    const q = (raw || "").trim();
    if (!q) return;
    clearTimeout(this.timer); clearTimeout(this.injTimer); clearTimeout(this.answerTimer);
    const routed = this.route(q);
    const focus = routed[0];
    const who = this.state.addressee || routed[1];
    const topicId = TOPIC_FOR[focus] || "copilotready";
    const t = TOPICS[topicId];
    this.logSaid("user", q);
    this.setState({ draft: "", playing: false, injected: null, focus, qa: { q, who, topicId, thinking: true, answer: null } });
    this.answerTimer = setTimeout(() => {
      const answer = t.ugly[0] + ". " + t.copilot;
      this.logSaid(who, answer);
      this.setState(s => (s.qa ? { qa: Object.assign({}, s.qa, { thinking: false, answer }) } : null));
    }, 1400);
  };

  askFollow = (key) => {
    const s = this.state;
    if (!s.qa) return;
    const t = TOPICS[s.qa.topicId];
    const f = this.followUps(s.qa.topicId, t).find(x => x.key === key);
    if (!f) return;
    clearTimeout(this.answerTimer);
    this.logSaid("user", f.label);
    this.setState(st => ({ qa: Object.assign({}, st.qa, { q: f.label, who: f.who, thinking: true, answer: null, asked: (st.qa.asked || []).concat([key]) }) }));
    this.answerTimer = setTimeout(() => {
      this.logSaid(f.who, f.text);
      this.setState(st => (st.qa ? { qa: Object.assign({}, st.qa, { thinking: false, answer: f.text }) } : null));
    }, 1200);
  };

  closeQA = (resume) => {
    clearTimeout(this.answerTimer);
    this.setState({ qa: null, playing: !!resume }, () => { if (resume) this.tick(); });
  };

  userAsk = (said, who, reply, focus) => {
    clearTimeout(this.timer); clearTimeout(this.injTimer); clearTimeout(this.answerTimer);
    this.logSaid("user", said);
    this.setState({ userLine: said, playing: false, focus });
    this.answerTimer = setTimeout(() => this.setState({ userLine: null }, () => this.speakAs(who, reply, focus)), 1800);
  };

  speakAs = (who, text, focus) => {
    clearTimeout(this.timer);
    this.logSaid(who, text);
    this.setState({ injected: { who, text, focus }, focus, playing: false, chatOpen: false }, () => {
      clearTimeout(this.injTimer);
      this.injTimer = setTimeout(() => {
        if (this.state.card) { this.setState({ injected: null }); return; }
        this.setState({ injected: null, playing: true }, this.tick);
      }, 6400);
    });
  };

  speak = (text) => {
    clearTimeout(this.timer);
    this.logSaid("user", text);
    this.setState({ userLine: text, playing: false }, () => {
      this.pushLog({ method: "POST", url: "https://warroom.shanemccaw.io/session/interjection", status: 201, latency: 84, text: "user interjection" });
      setTimeout(() => this.setState({ playing: true, userLine: null }, this.tick), 4200);
    });
  };

  polar(cx, cy, r, deg) {
    const a = deg * Math.PI / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  wedge(cx, cy, r0, r1, a0, a1) {
    const p = (r, a) => { const q = this.polar(cx, cy, r, a); return q.x.toFixed(1) + " " + q.y.toFixed(1); };
    return "M " + p(r0, a0) + " L " + p(r1, a0) + " A " + r1 + " " + r1 + " 0 0 1 " + p(r1, a1) +
      " L " + p(r0, a1) + " A " + r0 + " " + r0 + " 0 0 0 " + p(r0, a0) + " Z";
  }

  geom() {
    const cx = 530, cy = 530, R0 = 112, R1 = 400, RING0 = 410, RING1 = 436, LBL = 474, PR = 186;
    const seg = 360 / PILLARS.length;
    const byPillar = {};
    NODES.forEach(n => { (byPillar[n.pillar] = byPillar[n.pillar] || []).push(n); });
    const pts = {}, pillarPts = {}, links = [], sectors = [];
    const LAYOUT = {
      1: [{ r: 320, a: 0 }],
      2: [{ r: 290, a: -15 }, { r: 362, a: 12 }],
      3: [{ r: 288, a: -17 }, { r: 358, a: 0 }, { r: 302, a: 17 }]
    };
    PILLARS.forEach((p, i) => {
      const mid = -90 + i * seg;
      const a0 = mid - seg / 2 + 0.7, a1 = mid + seg / 2 - 0.7;
      const lp = this.polar(cx, cy, LBL, mid);
      sectors.push({
        id: p.id, color: p.color, label: p.label, impact: p.impact, mid,
        path: this.wedge(cx, cy, R0, R1, a0, a1),
        ring: this.wedge(cx, cy, RING0, RING1, a0, a1),
        lx: lp.x, ly: lp.y
      });
      const pp = this.polar(cx, cy, PR, mid);
      pillarPts[p.id] = { x: pp.x, y: pp.y, angle: mid };
      const kids = byPillar[p.id] || [];
      const layout = LAYOUT[kids.length] || LAYOUT[3];
      kids.forEach((n, k) => {
        const l = layout[k % layout.length];
        pts[n.id] = this.polar(cx, cy, l.r, mid + l.a);
      });
      links.push({ id: "core-" + p.id, from: { x: cx, y: cy }, to: pp, pillar: p.id, node: null });
      kids.forEach(n => links.push({ id: p.id + "-" + n.id, from: pp, to: pts[n.id], pillar: p.id, node: n.id }));
    });
    return { pts, pillarPts, links, sectors, cx, cy };
  }

  curve(a, b) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const cxp = mx - dy * 0.12, cyp = my + dx * 0.12;
    return "M " + a.x.toFixed(1) + " " + a.y.toFixed(1) + " Q " + cxp.toFixed(1) + " " + cyp.toFixed(1) + " " + b.x.toFixed(1) + " " + b.y.toFixed(1);
  }

  matches(n) {
    const q = this.state.query.trim().toLowerCase();
    const f = this.state.filter;
    const st = this.state.statuses[n.id];
    if (f !== "all" && st !== f) return false;
    if (q && (n.label + " " + n.pillar + " " + n.endpoint).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }

  inspectorFor(id) {
    const n = NODES.find(x => x.id === id);
    if (!n) return null;
    const st = this.state.statuses[n.id];
    const s = STATUS[st];
    const pillar = PILLARS.find(p => p.id === n.pillar);
    const seed = n.id.length * 7;
    const spark = Array.from({ length: 24 }, (_, i) => {
      const v = 32 + Math.sin(i * 0.7 + seed) * 12 + Math.cos(i * 1.9 + seed) * 7 + (st === "alert" ? Math.sin(i * 2.6) * 9 : 0);
      return (i * 13).toFixed(0) + "," + Math.max(6, Math.min(58, 64 - v)).toFixed(1);
    }).join(" ");
    const base = st === "alert" ? 46 : st === "drift" ? 72 : 96;
    const health = [
      { label: "Policy conformance", v: base },
      { label: "Signal freshness", v: Math.min(99, base + 12) },
      { label: "Coverage", v: Math.max(30, base - 8) },
      { label: "Change stability", v: Math.max(28, base - 16) }
    ].map(h => ({ label: h.label, value: h.v + "%", width: h.v + "%", color: h.v > 85 ? "#34d399" : h.v > 60 ? "#fbbf24" : "#f87171" }));
    const diagnostics = [
      { message: st === "healthy" ? "All Graph probes returning 200 within SLA." : st === "drift" ? "Configuration delta detected against approved baseline." : "Policy violation active — escalated to security pillar.", endpoint: "GET " + n.endpoint, color: s.color },
      { message: "Delta scan completed 4 minutes ago across 3 regions.", endpoint: "GET /v1.0/reports/getTenantSignals", color: "#60a5fa" },
      { message: "Change ticket CHG-" + (4100 + seed) + " linked to this node.", endpoint: "GET /beta/changeManagement/records", color: "#818cf8" }
    ];
    const actions = [
      { label: st === "healthy" ? "Re-run assessment probe" : "Model remediation impact", eta: "~2 min", color: "#fff", bg: "#0078D4", border: "#0078D4", onClick: () => this.remediate(n.id) },
      { label: "Export node telemetry (JSON)", eta: "instant", color: "#94a3b8", bg: "rgba(15,23,42,.6)", border: "rgba(51,65,85,.85)", onClick: () => this.pushLog({ method: "POST", url: "https://warroom.shanemccaw.io/export/" + n.id + ".json", status: 200, latency: 61, text: "export ready" }) }
    ];
    const json = JSON.stringify({ nodeId: n.id, pillar: n.pillar, status: st, metric: n.metric, graph: { endpoint: n.endpoint, p95Ms: n.latency, region: "eastus2" }, lastEvaluated: "2026-08-01T18:42:11Z", owner: "contoso.onmicrosoft.com" }, null, 2);
    return { id: n.id, label: n.label, pillar: pillar.label, statusLabel: s.label, color: s.color, latency: n.latency, spark, health, diagnostics, actions, json };
  }

  remediate = (id) => {
    this.setState(s => ({ statuses: Object.assign({}, s.statuses, { [id]: "healthy" }), remediated: Math.min(10, s.remediated + 1), readiness: Math.min(100, s.readiness + 4) }));
    this.pushLog({ method: "PATCH", url: "https://graph.microsoft.com/beta/remediation/" + id, status: 204, latency: 297, text: "remediation applied" });
  };

  computeSeats(rosterKeys) {
    const W = this.stageW || 460, H = this.stageH || 400;
    const box = this.mapBox || { cx: 50, cy: 50, rPx: Math.max(280, Math.min(W * 1.06, H)) / 2 };
    const clearPx = 78;
    const rxC = ((box.rPx + clearPx) / W) * 100;
    const ryC = ((box.rPx + clearPx) / H) * 100;
    const CXP = box.cx, CYP = box.cy;
    const halfSeatPct = ((126 / 2) / H) * 100;
    const halfSeatWPct = ((124 / 2) / W) * 100;
    const headerPct = (78 / H) * 100;
    const clampX = (x) => Math.max(halfSeatWPct + 0.5, Math.min(100 - halfSeatWPct - 0.5, x));
    const clampY = (y) => Math.max(headerPct + halfSeatPct, Math.min(100 - halfSeatPct - 2, y));

    // Every seat, host included, is laid out in ONE pass so slots cannot collide
    // by construction: each flank arc divides by the number of seats it carries.
    const cols = { left: [], right: [] };
    rosterKeys.forEach(k => {
      const pref = (PERSONAS[k] || {}).side === "right" ? "right" : "left";
      const other = pref === "left" ? "right" : "left";
      cols[cols[pref].length >= 5 && cols[other].length < 5 ? other : pref].push(k);
    });
    // the host takes the topmost slot on the emptier flank; the user the bottom of the other
    const hostSide = cols.left.length > cols.right.length ? "right" : "left";
    const userSide = hostSide === "left" ? "right" : "left";
    cols[hostSide].unshift("shane");
    cols[userSide].push("user");

    const out = {};
    ["left", "right"].forEach(side => {
      const arr = cols[side], n = arr.length || 1;
      const dirX = side === "left" ? -1 : 1;
      // Space seats evenly down the usable band so vertical gap >= one seat where
      // the stage allows, then solve x FROM the ellipse (with a floor) so nothing
      // can drift toward the disc.
      const yMin = clampY(-999), yMax = clampY(999);
      const span = Math.max(0, yMax - yMin);
      // spread across the FULL band (endpoints included) so short stages still fit
      const step = n > 1 ? span / (n - 1) : span;
      arr.forEach((k, i) => {
        const y = n === 1 ? (yMin + yMax) / 2 : yMin + step * i;
        const dy = Math.abs(CYP - y);
        const kk = ryC > 0 ? Math.min(1, dy / ryC) : 1;
        let dx = Math.max(rxC * 0.46, rxC * Math.sqrt(Math.max(0, 1 - kk * kk)));
        // if the band cannot give a full seat of vertical clearance, stagger
        // alternate seats outward so their boxes still cannot intersect
        const seatHPct = halfSeatPct * 2;
        if (step < seatHPct * 1.02 && i % 2 === 1) dx += halfSeatWPct * 1.15;
        out[k] = { x: clampX(CXP + dirX * dx), y, side: k === "shane" ? "host" : k === "user" ? "user" : side };
      });
    });
    return out;
  }

  focusPoint(s) {
    const pillar = this.mapPillar(s);
    if (!pillar) return null;
    const order = ["Security", "Governance", "Licensing", "Adoption", "Copilot", "Compliance", "Health"];
    const idx = order.indexOf(pillar);
    if (idx < 0) return null;
    const a = (-90 + idx * (360 / 7) + 25.7) * Math.PI / 180;
    const W = this.stageW || 460, H = this.stageH || 400;
    const mapPx = Math.max(280, Math.min(W * 0.98, H * 0.94));
    return { x: 50 + (0.34 * mapPx / W) * 100 * Math.cos(a), y: 50 + (0.34 * mapPx / H) * 100 * Math.sin(a) };
  }

  bubblePos(seat, focusPt) {
    const W = this.stageW || 460, H = this.stageH || 400;
    const bwPx = Math.min(340, Math.max(230, W * 0.46));
    const bw = (bwPx / W) * 100, bh = Math.min(54, (200 / H) * 100);
    const xs = [bw / 2 + 1.5, 98.5 - bw / 2];
    const ys = [bh / 2 + 2, 96 - bh / 2];
    const focus = focusPt || { x: 50, y: 50 };
    let best = null;
    xs.forEach(cx => ys.forEach(cy => {
      const away = Math.hypot(cx - focus.x, (cy - focus.y) * 0.85);
      const near = Math.hypot(cx - seat.x, (cy - seat.y) * 0.85);
      const dx = Math.max(0, 12 + bw / 2 - Math.abs(cx - 50));
      const dy = Math.max(0, 15 + bh / 2 - Math.abs(cy - 50));
      const coreHit = dx > 0 && dy > 0 ? 1000 : 0;
      const score = away - near * 0.5 - coreHit;
      if (!best || score > best.score) best = { cx, cy, score };
    }));
    return { bx: (best.cx - bw / 2).toFixed(1) + "%", by: (best.cy - bh / 2).toFixed(1) + "%", bw: Math.round(bwPx) + "px" };
  }

  mapPillar(s) {
    const site = SITES.find(x => x.id === s.demoSite);
    const id = site ? site.node : (s.blast || s.focus);
    const n = NODES.find(x => x.id === id);
    return n ? MAP_PILLAR[n.pillar] || null : null;
  }

  componentDidUpdate(prevProps, prevState) {
    // /war-room/:section (#303). A changed `section` prop that we did not
    // ourselves emit is the browser navigating us — Back/Forward, or a pasted
    // link on an already-mounted room; anything else means the briefing moved
    // under its own steam and the URL should follow it.
    if (prevProps.section !== this.props.section) {
      if (this.props.section !== this.sectionAt && !this.restoreSection(this.props.section)) {
        // Nothing restorable — Back to bare /war-room, or a stale link. The room
        // is already mid-briefing and the opening prelude cannot be un-played, so
        // re-assert where it really is rather than let the address bar lie.
        if (this.sectionAt) this.emitSection(this.sectionAt, false);
      }
    } else {
      this.syncSectionToUrl();
    }

    // seed whenever the dive is open and unseeded — the beat that opens it can
    // arrive in the same setState as other changes, so a transition test is fragile
    const dk = this.state.dive;
    if (DIVE_CFG[dk]) {
      if (this.seededFor !== dk) {
        this.seededFor = dk;
        this.govStarted = false;
        this.setState(st => ({
          govThread: [], govView: 0, govAt: "c0",
          workedPillars: (st.workedPillars || []).indexOf(dk) >= 0 ? st.workedPillars : (st.workedPillars || []).concat([dk])
        }));
      }
      walkPillarRef.current = dk;
      this.startGovThread();
    } else { this.govStarted = false; this.seededFor = null; }
    const d = this.state.demo;
    if (d && d.stage === 1 && (!prevState.demo || prevState.demo.stage !== 1)) {
      clearInterval(this.scanTimer);
      let step = 0;
      this.scanTimer = setInterval(() => {
        step += 1;
        if (step >= SCAN_STEPS.length) {
          clearInterval(this.scanTimer);
          this.setState(s => (s.demo ? { demo: { stage: 2, step: SCAN_STEPS.length - 1 } } : null));
        } else {
          this.setState(s => (s.demo ? { demo: { stage: 1, step } } : null));
        }
      }, 900);
    }
  }

  askDemo = (q) => {
    const text = (q || "").trim();
    if (!text) return;
    const site = SITES.find(x => x.id === this.state.demoSite) || SITES[0];
    const A = {
      cite: "Copilot can cite " + site.files + " files in " + site.name + " right now — anything a user could theoretically open, the model can summarise, including the " + site.sens.toLowerCase() + " material.",
      who: "EEEU was applied at site creation from the legacy team template — " + site.name + " inherited it, and nobody has reviewed it since. It predates your current governance baseline.",
      break: "Removing it breaks nothing for the " + site.ext + " named collaborators; it only removes the implicit tenant-wide read that Copilot is grounding on. We stage it site by site with a rollback window."
    };
    const l = text.toLowerCase();
    const a = /cite|ground/.test(l) ? A.cite : /who|when|added/.test(l) ? A.who : /break|remove|impact/.test(l) ? A.break
      : "Across the eight sites, " + site.name + " is the sharpest edge: " + site.note;
    this.setState(s => ({ demoQA: s.demoQA.concat([{ q: text, a }]), demoDraft: "" }));
  };

  govList(tab) {
    if (tab === "onedrive") return ONEDRIVE;
    if (tab === "teams") return SITES.filter(x => x.type === "Teams");
    return SITES.filter(x => x.type === "SharePoint");
  }

  govPick = (id) => this.setState({ govSel: id, govPreview: null, govPath: false });

  // The governance dive is a conversation, not a dashboard: Maya opens, Shane
  // lays the telemetry on the table as an active card, then the customer takes over.

  docsViews = [
    { id: "customer", label: "Customer", kicker: "Eight deliverables, produced this morning",
      sections: [
        { h: "The Deliverable Set", rows: [["Documents produced", "8"], ["Pages generated", "213"], ["Self-resolution playbooks", "29"]] },
        { h: "How They Were Produced", rows: [["Agents installed", "0"], ["Queries", "Read-only"], ["Raw output retained", "Yes"]] }
      ] }
  ];

  docsOpening = [
    { who: "shane", text: "Everything the assessment produced is here — seven pillar reports and the statement of work. Read-only queries, no agent, and every figure re-derivable by your own team." },
    { who: "shane", text: "", walk: "c0", lead: "Open any of them from the library below. " + DOCS_WALK[0].lead,
      actions: [["Next — How They Were Produced", "walk:c1"], ["Ask about this", "ask"]] }
  ];

  sowViews = [
    { id: "customer", label: "Customer", kicker: "The deliverable, section by section",
      sections: [
        { h: "Scope & Objective", rows: [["Findings in scope", "24"], ["Objective", "Gate at 75%"], ["Elapsed", "12 weeks"]] },
        { h: "Approach & Sequence", rows: [["Critical path", "12 weeks"], ["Phases in parallel", "4"], ["Change windows", "Booked in one pass"]] },
        { h: "Phase Breakdown & Scope", rows: [["Phases in scope", "6 of 7"], ["Professional services", "$252,800"], ["Readiness delivered", "+73"]] },
        { h: "Commercial Terms", rows: [["New budget required", "$0"], ["Net year one", "+$613,200"], ["Payment", "On completion"]] },
        { h: "Acceptance & Signature", rows: [["Readiness on completion", "78%"], ["Open findings at close", "0"], ["Evidence pack", "Maintained"]] }
      ] }
  ];

  sowOpening = [
    { who: "shane", text: "This is the document the assessment produced. Nothing in it was written before this morning — every line traces to a finding you have already seen on the board." },
    { who: "shane", text: "", walk: "c0", lead: "Five sections, and you can change the scope as we go. " + SOW_WALK[0].lead,
      actions: [["Next — Approach & Sequence", "walk:c1"], ["Ask about this", "ask"]] }
  ];

  togglePhase = (id) => {
    this.setState(st => {
      const out = Object.assign({}, st.sowOut);
      if (out[id]) delete out[id]; else out[id] = true;
      return { sowOut: out };
    });
  };

  sowTotals = () => {
    const out = this.state.sowOut || {};
    let price = 0, readiness = 0, monthly = 0, removed = 0;
    SOW_PHASES.forEach(p => {
      if (out[p.id]) { removed++; return; }
      if (p.recurring) monthly += p.price; else price += p.price;
      readiness += p.readiness;
    });
    return { price: price, monthly: monthly, readiness: Math.min(78, 34 + readiness), removed: removed };
  };

  cplViews = [
    { id: "customer", label: "Customer", kicker: "Every pillar, one decision",
      sections: [
        { h: "The Verdict", rows: [["Copilot readiness", "34%"], ["Deployment gate", "75%"], ["Blocking pillars", "3"]] },
        { h: "Blast Radius, Priced", rows: [["Priced exposure", "$4.1M"], ["Regulated files in reach", "40,480"], ["Accounts with reach", "1,876"]] },
        { h: "Prove It With Copilot", rows: [["Prompts returning regulated content", "3 of 3"], ["Elevated rights needed", "None"], ["Acceptance test defined", "No"]] },
        { h: "The Value On The Other Side", rows: [["Annual value at full adoption", "$4.1M"], ["Hours returned weekly", "1,140"], ["Return on the pilot", "7×"]] },
        { h: "Go / No-Go", rows: [["Tenant-wide verdict", "NO-GO"], ["Scoped pilot verdict", "GO"], ["Time to gate", "12 weeks"]] }
      ] },
    { id: "analyst", label: "Analyst", kicker: "The programme, sequenced",
      sections: [
        { h: "Remediation Sequence", rows: [["Elapsed to gate", "12 weeks"], ["New budget required", "$0"], ["Critical path", "Sharing → DLP → Labels"]] },
        { h: "What If We Do Nothing", rows: [["Monthly cost of delay", "$412K"], ["Exposure trend", "Flat"], ["Evidence at renewal", "None"]] }
      ] }
  ];

  cplOpening = [
    { who: "shane", text: "That is every pillar. Governance, licensing, adoption, compliance, health and security — all of it measured in your own tenant this morning, none of it estimated." },
    { who: "shane", text: "", walk: "c0", lead: "So here is the only question left, and I am going to answer it plainly. " + CPL_WALK[0].lead,
      actions: [["Next — Blast Radius, Priced", "walk:c1"], ["Ask about this", "ask"]] }
  ];

  secViews = [
    { id: "customer", label: "Customer", kicker: "What this means for you",
      sections: [
        { h: "Identity Perimeter", rows: [["MFA coverage", "96%"], ["Standing global admins", "18"], ["Risky sign-ins unchallenged", "41"]] },
        { h: "Reachability, Not Posture", rows: [["Files one account can reach", "214,806"], ["Regulated files in reach", "40,480"], ["Accounts with full reach", "1,876"]] },
        { h: "Egress & Data Loss", rows: [["Mailboxes uncovered", "1,412"], ["Copilot prompt coverage", "0%"], ["Endpoint DLP", "0%"]] },
        { h: "The Risk Chain", rows: [["Open chain links", "4"], ["Reportable exposure", "Yes"], ["Chain owner", "None"]] },
        { h: "Security & the Copilot Gate", rows: [["Copilot session policy", "None"], ["Defender coverage", "98.4%"], ["Open high alerts", "0"]] }
      ] },
    { id: "analyst", label: "Analyst", kicker: "Grouped by entry point",
      sections: [
        { h: "Attack Surface", rows: [["Guest identities", "612"], ["Anonymous links", "23"], ["OAuth app grants", "94"]] },
        { h: "Detection & Response", rows: [["AI-specific detections", "0"], ["Audit retention", "180 days"], ["Incident drill", "Never"]] }
      ] }
  ];

  secOpening = [
    { who: "kirk", text: "I assess security for a living, which makes me the least popular person in most of these meetings. I do not deal in posture scores — I deal in what is reachable today." },
    { who: "kirk", text: "", walk: "c0", lead: "Five topics, and the second one is the only one that matters. " + SEC_WALK[0].lead,
      actions: [["Next — Reachability, Not Posture", "walk:c1"], ["Ask about this", "ask"]] }
  ];

  hltViews = [
    { id: "customer", label: "Customer", kicker: "What this means for you",
      sections: [
        { h: "Device Baseline", rows: [["Endpoints outside baseline", "312"], ["Baseline age", "11 days"], ["Devices in no policy group", "94"]] },
        { h: "Service Health & Incidents", rows: [["Tickets per week", "340"], ["Self-answerable tickets", "40%"], ["Automated runbooks", "0"]] },
        { h: "Change & Configuration", rows: [["Changes outside control", "47"], ["Standing global admins", "18"], ["Changes with a rollback plan", "31%"]] },
        { h: "Backup & Resilience", rows: [["Backup success rate", "97%"], ["Restore tested", "Never"], ["Recovery time objective", "Undefined"]] },
        { h: "Health & the Copilot Gate", rows: [["Devices blocked at enforcement", "312"], ["Support capacity", "At limit"], ["Service health", "Nominal"]] }
      ] },
    { id: "analyst", label: "Analyst", kicker: "Grouped by remediation action",
      sections: [
        { h: "Endpoint Estate", rows: [["Devices needing action", "312"], ["Ungrouped devices", "94"], ["Out-of-support devices", "12"]] },
        { h: "Operational Readiness", rows: [["Automated runbooks", "0"], ["After-hours alerts", "62/wk"], ["Copilot escalation path", "None"]] }
      ] }
  ];

  hltOpening = [
    { who: "marcus", text: "Health is the pillar nobody presents and everybody feels. All of this came from Intune, the service dashboard and the ticket queue this morning." },
    { who: "marcus", text: "", walk: "c0", lead: "Let me walk it the way I'd present it to the people who get paged — five topics. " + HLT_WALK[0].lead,
      actions: [["Next — Service Health & Incidents", "walk:c1"], ["Ask about this", "ask"]] }
  ];

  cmpViews = [
    { id: "customer", label: "Customer", kicker: "What this means for you",
      sections: [
        { h: "Classification Coverage", rows: [["Regulated files unlabelled", "40,480"], ["PHI containers labelled", "78%"], ["Classifiers enforcing", "0 of 3"]] },
        { h: "Data Loss Prevention", rows: [["Policy sets that never evaluate", "2"], ["Mailboxes uncovered", "1,412"], ["Copilot prompt coverage", "0%"]] },
        { h: "Retention & Audit", rows: [["Audit log retention", "180 days"], ["Copilot history retained", "No"], ["Legal hold coverage", "41%"]] },
        { h: "Regulatory Exposure", rows: [["Regimes in scope", "4"], ["Regimes fully met", "1 of 4"], ["Breach drill", "Never run"]] },
        { h: "Compliance & the Copilot Gate", rows: [["Provable containment", "No"], ["Change record", "Drafted"], ["Reportable exposure", "Open"]] }
      ] },
    { id: "analyst", label: "Analyst", kicker: "Grouped by control object",
      sections: [
        { h: "Policy Estate", rows: [["DLP rules enforcing", "15 of 18"], ["Uncovered locations", "4"], ["Rules with no owner", "7"]] },
        { h: "Evidence & Defensibility", rows: [["AI-specific controls", "0"], ["Evidence pack readiness", "Weeks"], ["Control testing", "Annual"]] }
      ] }
  ];

  cmpOpening = [
    { who: "beth", text: "Compliance is the pillar that decides whether an incident is something you handle internally or something you report. Everything here came from Purview and the policy estate this morning." },
    { who: "beth", text: "", walk: "c0", lead: "Let me walk it the way I'd present it to counsel — five topics. " + CMP_WALK[0].lead,
      actions: [["Next — Data Loss Prevention", "walk:c1"], ["Ask about this", "ask"]] }
  ];

  adoViews = [
    { id: "customer", label: "Customer", kicker: "What this means for you",
      sections: [
        { h: "Usage Reality", rows: [["Daily active users", "1,631"], ["Files shared in chat", "64%"], ["Copilot active of licensed", "31%"]] },
        { h: "Meeting Intelligence", rows: [["Meetings transcribed", "22%"], ["Meetings recorded", "18%"], ["Meetings with an agenda", "31%"]] },
        { h: "Champions & Enablement", rows: [["Named champions", "0"], ["Role-based tracks", "0 of 4"], ["Managers briefed", "12%"]] },
        { h: "Workflows Worth Automating", rows: [["Hours lost weekly, per person", "6.4"], ["Tickets deflectable weekly", "136"], ["Workflows instrumented", "0"]] },
        { h: "Adoption & the Copilot Gate", rows: [["Copilot active users", "31%"], ["Pilot benchmark", "70%"], ["Week-3 retention tracked", "No"]] }
      ] },
    { id: "analyst", label: "Analyst", kicker: "Grouped by enablement action",
      sections: [
        { h: "Cohort Readiness", rows: [["Cohorts scored", "0 of 4"], ["Pilot-ready seats", "40"], ["Largest cohort readiness", "38%"]] },
        { h: "Content Readiness", rows: [["Files in owned libraries", "29%"], ["Duplicate versions per doc", "3.4"], ["Documents with an owner", "31%"]] },
        { h: "Measurement & Retention", rows: [["Adoption metrics reported", "0"], ["Baseline captured", "No"], ["Adoption owner", "None"]] }
      ] }
  ];

  adoOpening = [
    { who: "marcus", text: "Adoption is the pillar nobody budgets for and the one that decides whether the licences turn into hours. All of this came from your own usage reports this morning." },
    { who: "marcus", text: "", walk: "c0", lead: "Let me walk it the way I'd present it to the people who have to live with it — five topics. " + ADO_WALK[0].lead,
      actions: [["Next — Meeting Intelligence", "walk:c1"], ["Ask about this", "ask"]] }
  ];

  licViews = [
    { id: "customer", label: "Customer", kicker: "What this means for you",
      sections: [
        { h: "Licence Position", rows: [["Seats provisioned", "6,180"], ["Paid but unassigned", "1,308"], ["Annual waste", "$847,608"]] },
        { h: "Licence Fit", rows: [["Over-licensed users", "612"], ["Under-licensed users", "148"], ["Departed, still licensed", "47"]] },
        { h: "Copilot Seat Readiness", rows: [["Copilot owned / assigned", "25 / 2"], ["Eligible under governance", "0"], ["Required for pilot", "400"]] },
        { h: "Cost Recovery", rows: [["Recoverable in year one", "$1,010,000"], ["Duplicate tooling", "$142,000"], ["Cost of the pilot", "$144,000"]] },
        { h: "Licensing & the Copilot Gate", rows: [["New budget required", "$0"], ["Licensing meter", "38%"], ["Monthly cost of delay", "$70,000"]] }
      ] },
    { id: "analyst", label: "Analyst", kicker: "Grouped by procurement action",
      sections: [
        { h: "SKU Distribution", rows: [["E5 assignment rate", "41%"], ["E3 assignment rate", "95%"], ["Copilot assignment rate", "8%"]] },
        { h: "Licence Lifecycle", rows: [["Departed, still licensed", "47"], ["Group-based assignment", "62%"], ["Reclaim SLA", "none"]] },
        { h: "Tooling Overlap", rows: [["Seats on duplicate tools", "1,180"], ["Duplicate annual spend", "$142,000"], ["Contracts unmapped", "4"]] },
        { h: "Forecast & Renewal", rows: [["Next-year spend, current path", "$3.4M"], ["Corrected forecast", "$2.2M"], ["Evidence at renewal", "none"]] }
      ] }
  ];

  govViews = [
    { id: "customer", label: "Customer", kicker: "What this means for you",
      sections: [
        { h: "Org-wide sharing", rows: [["Everyone Except External Users (EEEU) enabled", "Yes"], ["“Everyone in the organization” links", "41"], ["“Anyone with the link” anonymous links", "23"], ["Services affected", "SharePoint · Teams · OneDrive"]] },
        { h: "Overshared locations", rows: [["Overshared SharePoint sites", "41"], ["Public Teams channels", "17"], ["Unmanaged or orphaned channels", "94"]] },
        { h: "Sensitive data exposure", rows: [["Files with no sensitivity label", "22%"], ["High-risk data exposed", "PII · PHI · financial"], ["Mission-critical libraries unlabelled", "6"]] },
        { h: "External access", rows: [["External guest accounts", "612"], ["Unmanaged guest identities", "312"], ["External domains with access", "48"]] },
        { h: "Copilot exposure", rows: [["Documents Copilot can see with no owner", "11,400"], ["Unlabelled content visible to Copilot", "40,480"], ["Readiness blocked by governance", "−17 pts"]] }
      ] },
    { id: "analyst", label: "Analyst", kicker: "Grouped by remediation priority",
      sections: [
        { h: "Sharing & link exposure", rows: [["EEEU enabled at tenant level", "Yes"], ["Org-wide links", "41 · SP 28 / TM 9 / OD 4"], ["Anonymous Anyone links", "23"], ["EEEU risk level", "Critical"]] },
        { h: "Site & channel oversharing", rows: [["Overshared SharePoint sites", "41"], ["Public Teams channels", "17"], ["Channel sprawl, unmanaged", "94"]] },
        { h: "Sensitivity & labeling gaps", rows: [["Unlabelled file percentage", "22%"], ["High-risk categories exposed", "3"], ["Libraries drifting from policy", "19"]] },
        { h: "Identity & access risks", rows: [["External guest accounts", "612"], ["Unmanaged guest identities", "312"], ["Federated external domains", "48"]] },
        { h: "Permission hygiene", rows: [["Permission sprawl groups", "37"], ["Broken inheritance", "128"], ["Nested / legacy depth", "6 levels"]] },
        { h: "Governance drift", rows: [["Library configuration drift", "47 settings"], ["Policy compliance drift", "19 libraries"], ["Conditional Access gaps", "CA01 disabled"]] },
        { h: "Copilot blast radius", rows: [["Groundable docs with no owner", "11,400"], ["Overshared or unlabelled visible", "40,480"], ["Readiness score impact", "−17 pts"]] }
      ] },
    { id: "engine", label: "Engine", kicker: "Signals mapped to the engines that produce them",
      sections: [
        { h: "Oversharing engine", rows: [["EEEU grant present", "Yes"], ["Overshared SharePoint sites", "41"], ["Public Teams channels", "17"], ["Org-wide links", "41"], ["Anonymous Anyone links", "23"]] },
        { h: "Sensitivity label engine", rows: [["Unlabelled file percentage", "22%"], ["Labelled vs unlabelled", "143,520 / 40,480"], ["High-risk categories exposed", "PII · PHI · financial"]] },
        { h: "Data exposure engine", rows: [["PII / PHI / financial counts", "18,204 / 9,860 / 12,416"], ["External domain exposure", "48"], ["Guest access exposure", "612"]] },
        { h: "Permission sprawl engine", rows: [["Sprawl groups", "37"], ["Inheritance breaks", "128"], ["Nested permission depth", "6"]] },
        { h: "Drift engine", rows: [["Library configuration drift", "47"], ["Labeling drift", "19"], ["Policy compliance drift", "12"]] },
        { h: "Identity & access engine", rows: [["External guest identities", "612"], ["Unmanaged guest identities", "312"], ["Conditional Access gaps", "1"]] },
        { h: "Copilot readiness engine", rows: [["Groundable docs, no owner", "11,400"], ["Overshared / unlabelled visible", "40,480"], ["Readiness score impact", "−17 pts"]] }
      ] }
  ];

  // each view ends with a persona asking whether to go deeper
  govPrompts = [
    { who: "jane", text: "That's the plain-language picture. Any questions on it before I show you how our analysts group the same signals?",
      actions: [["Show me the analyst view", "next"], ["I have a question first", "ask"]] },
    { who: "shane", text: "That's how a remediation team would sequence it. Want to see the raw engine surfaces underneath — the signals our automation actually acts on?",
      actions: [["Show the engine view", "next"], ["No, that's enough detail", "done"]] },
    { who: "shane", text: "That's the whole governance picture, from your language down to the telemetry. Ready to move on to what it's costing you?",
      actions: [["Move on to licensing", "close"], ["Let me ask something first", "ask"]] }
  ];

  runPreviewChat = () => {
    const list = this.govList(this.state.govTab);
    const site = list.find(x => x.id === this.state.govSel) || list[0];
    this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: "Run a Copilot preview against " + site.name + " — show me what it would actually return." }]) }));
    clearTimeout(this.prevT);
    this.prevT = setTimeout(() => this.govSay(({
        who: "jane",
        text: "Running it now against " + site.name + ", grounded exactly the way Copilot would.",
        copilot: {
          prompt: "Summarise what this site contains and who can reach it.",
          body: [
            site.name + " holds " + site.files + " files across its default document library. The content centres on " + (site.sens === "Confidential" ? "executed agreements, commercial terms and counterparty detail" : site.sens === "PHI" ? "clinical working notes, discharge summaries and member identifiers" : "operational documentation, working drafts and project records") + ".",
            "Access resolves to every internal account through the " + site.exposure + " grant, so any of your 1,876 licensed users can retrieve this content — and so can I.",
            site.note
          ],
          cites: [site.name + " › Shared Documents", site.name + " › " + (site.sens === "Confidential" ? "Executed" : "Working"), site.name + " › Archive"],
          warn: site.sens === "Unlabelled"
            ? "No sensitivity label on the source, so this answer carries no classification."
            : "Source is marked " + site.sens + " — but with no label enforcement the answer does not inherit it."
        }
      })), 900);
  };

  explainPath = () => {
    this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: "Explain the exposure path — how does a file actually become visible to Copilot?" }]) }));
    clearTimeout(this.pathT);
    this.pathT = setTimeout(() => this.govSay(({
        who: "shane",
        text: "Your tenant has 2,356 overshared sites. These ten came back at random from the same Graph query Copilot runs when it builds its index — so this is literally what it would see.",
        sites: true
      })), 700);
  };

  // named documents Copilot could ground on right now, per signal
  govDocSets = {
    docs: { who: "jane", lead: "These came back from the same permission-scoped query Copilot uses. 11,400 documents with no owner — here are the ten it would reach first.", rows: [
      ["Mission_Ops_Runbook_v7.docx", "Flight Ops – Mission Docs", "Unlabelled", "EEEU · Edit"],
      ["Payroll_FY26_Draft.xlsx", "HR – People Ops", "Confidential", "Org-wide link"],
      ["Executed_MSA_Aerostruct.pdf", "Contracts & Legal", "Confidential", "EEEU · Read"],
      ["Remittance_Advice_Q2.pdf", "OneDrive · j.alvarez", "PHI", "Anyone link"],
      ["Discharge_Summaries_Working.docx", "OneDrive · d.okafor", "PHI", "Guest · 6"],
      ["Launch_Readiness_Gate3.pptx", "Launch Readiness 2026", "Partial", "EEEU · Edit"],
      ["Denials_Root_Cause_Q2.xlsx", "Revenue Cycle – Denials", "Unlabelled", "Org-wide link"],
      ["Clinical_Protocol_Amendments.docx", "Clinical Protocols Archive", "PHI", "EEEU · Read"],
      ["Board_Comp_Bands_2026.xlsx", "HR – People Ops", "Confidential", "Org-wide link"],
      ["Incident_Review_2025.docx", "Quality – Incident Review", "Sensitive", "Anyone link"]
    ], warn: "Every one of these is retrievable today by any of your 1,876 licensed accounts. Copilot does not widen that — it just makes it findable in plain English." },
    labels: { who: "jane", lead: "40,480 regulated files carry no label. These ten are the highest-confidence classifier matches sitting unlabelled right now.", rows: [
      ["Remittance_Advice_Q2.pdf", "OneDrive · j.alvarez", "PHI 0.96", "No label"],
      ["Member_Eligibility_Export.csv", "Revenue Cycle – Denials", "PHI 0.94", "No label"],
      ["Discharge_Summaries_Working.docx", "OneDrive · d.okafor", "PHI 0.93", "No label"],
      ["Payroll_FY26_Draft.xlsx", "HR – People Ops", "Financial 0.91", "No label"],
      ["Board_Comp_Bands_2026.xlsx", "HR – People Ops", "Financial 0.90", "No label"],
      ["Executed_MSA_Aerostruct.pdf", "Contracts & Legal", "Contractual 0.89", "No label"],
      ["Substance_Use_Case_Notes.docx", "Clinical Protocols Archive", "42 CFR 0.88", "No label"],
      ["Vendor_Bank_Details.xlsx", "Finance – FY26 Planning", "Financial 0.87", "No label"],
      ["Patient_Complaints_Log.xlsx", "Quality – Incident Review", "PHI 0.85", "No label"],
      ["Staff_Disciplinary_2025.docx", "HR – People Ops", "PII 0.84", "No label"]
    ], warn: "A grounded answer inherits its source's classification. Unlabelled source, unclassified answer — that is the whole exposure in one sentence." },
    guests: { who: "jane", lead: "612 guests hold standing access. These are the ten with the widest reach into governed content.", rows: [
      ["m.reyes@aerostruct.com", "Vendor – Aerostruct", "Unlabelled", "Standing · 19mo"],
      ["counsel@brightwell-law.com", "Contracts & Legal", "Confidential", "Standing · 26mo"],
      ["case.mgr@northstar-care.org", "OneDrive · d.okafor", "PHI", "Standing · 11mo"],
      ["j.patel@aerostruct.com", "Launch Readiness 2026", "Partial", "Standing · 14mo"],
      ["audit@grantwell.co", "Finance – FY26 Planning", "Confidential", "Standing · 8mo"],
      ["billing@medclaim-partners.com", "Revenue Cycle – Denials", "PHI", "Standing · 22mo"],
      ["temp.staff@locum-health.net", "Clinical Protocols Archive", "PHI", "Standing · 31mo"],
      ["design@fieldmark.io", "Quality – Incident Review", "Sensitive", "Standing · 17mo"],
      ["p.hughes@aerostruct.com", "Flight Ops – Mission Docs", "Unlabelled", "Standing · 9mo"],
      ["recruit@talentbridge.co", "HR – People Ops", "Confidential", "Standing · 28mo"]
    ], warn: "None of these has been re-attested. Twelve belong to engagements that ended more than a year ago." }
  };

  govControlHelp = {
    ext: { who: "jane", q: "What is “Restrict external sharing” and what happens if we turn it on?",
      title: "Restrict external sharing",
      what: "Drops the tenant sharing ceiling to authenticated guests only, disables Anyone links, and puts a 90-day expiry with owner attestation on every guest.",
      why: "External sharing is the only exposure path that reaches outside your MSA boundary. It is also the cheapest to close — one week, no user retraining, and nothing internal breaks.",
      before: [["External guest accounts", "612"], ["Anonymous Anyone links", "23"], ["External domains with access", "48"], ["Exposure risk", "92%"]],
      after: [["External guest accounts", "344"], ["Anonymous Anyone links", "0"], ["External domains with access", "19"], ["Exposure risk", "51%"]],
      note: "268 guests clear on the first attestation cycle without anyone having to make a decision — they simply do not get renewed." },
    inh: { who: "jane", q: "What is “Fix broken inheritance” and what happens if we turn it on?",
      title: "Fix broken inheritance",
      what: "Enumerates every library with unique permissions, restores inheritance where no documented reason exists, and replaces direct user grants with groups.",
      why: "128 broken inheritance points are why nobody can answer “who can see this”. Copilot resolves those ACLs literally, so a break made for one file in 2023 is still granting access today.",
      before: [["Broken inheritance points", "128"], ["Permission sprawl groups", "37"], ["Nested permission depth", "6 levels"], ["Docs with no owner", "11,400"]],
      after: [["Broken inheritance points", "12"], ["Permission sprawl groups", "9"], ["Nested permission depth", "2 levels"], ["Docs with no owner", "3,100"]],
      note: "Twelve breaks stay — those are legitimate and documented. The other 116 exist because somebody clicked Stop Inheriting once." },
    links: { who: "shane", q: "What does the org-wide links slider actually change?",
      title: "Org-wide links",
      what: "Models replacing each “Everyone except external users” link with a security group scoped to the real audience, then setting link expiry so it cannot re-accumulate.",
      why: "This is the single biggest lever on the board. Every org-wide link is a standing tenant-wide read grant, and Copilot honours it exactly — 214,806 files become citable because of these 41 links.",
      before: [["Sites with org-wide links", "41"], ["Files reachable tenant-wide", "214,806"], ["Copilot readiness", "34%"], ["Governance pillar", "34"]],
      after: [["Sites with org-wide links", "0"], ["Files reachable tenant-wide", "18,240"], ["Copilot readiness", "64%"], ["Governance pillar", "71"]],
      note: "Two weeks, low risk, staged site by site with recipients notified first. Nothing a named collaborator can reach today is taken away." }
  };

  // every clickable signal answers like a consultant: what it is, why it matters,
  // what the tenant looks like once it is closed
  govSignalHelp = {
    orgwide: { who: "jane", q: "Sites with org-wide links — walk me through that.",
      title: "Sites with org-wide links",
      what: "41 of your 1,204 sites carry an “Everyone except external users” or org-wide sharing link. That is a standing read grant to every licensed account in the tenant, applied at the site level and inherited by every library beneath it.",
      why: "Copilot resolves permissions literally. It does not ask whether a grant was intentional — it indexes whatever the account running the prompt is allowed to open. These 41 sites are why 214,806 files are citable by anyone on day one.",
      before: [["Sites with org-wide links", "41"], ["Files reachable tenant-wide", "214,806"], ["Accounts that can reach them", "1,876"], ["Regulated files in scope", "40,480"]],
      after: [["Sites with org-wide links", "0"], ["Files reachable tenant-wide", "18,240"], ["Accounts that can reach them", "scoped groups"], ["Regulated files in scope", "1,120"]],
      note: "Risk today: any employee can retrieve payroll, contracts and mission documentation through a normal Copilot prompt, with a citation. Two weeks of work, staged site by site, closes it." },
    teams: { who: "jane", q: "Teams with public channels — walk me through that.",
      title: "Teams with public channels",
      what: "17 teams have at least one public channel. A public channel exposes its connected SharePoint site to the whole tenant, and 23 of the links created inside them are anonymous with no expiry.",
      why: "Teams sprawl is the quiet exposure. Nobody creates a public channel intending it to be permanent, but nothing closes it either — and Copilot grounds on the connected site, not the channel.",
      before: [["Teams with public channels", "17"], ["Anonymous links, no expiry", "23"], ["Connected sites exposed", "17"], ["Files behind them", "38,600"]],
      after: [["Teams with public channels", "2"], ["Anonymous links, no expiry", "0"], ["Connected sites exposed", "2"], ["Files behind them", "3,400"]],
      note: "Risk today: a channel opened for a 2023 project still publishes its whole document library. Converting to private is low effort and moves readiness immediately." },
    onedrive: { who: "jane", q: "OneDrive external shares — walk me through that.",
      title: "OneDrive external shares",
      what: "Personal stores holding active external shares — some to managed guests, some to anonymous links with no identity behind them.",
      why: "OneDrive is rarely inventoried and never labelled by inheritance, so it is the largest unlabelled pool in the tenant. Anonymous links have no audit trail and no revocation path when someone leaves.",
      before: [["Accounts sharing externally", "48"], ["Anonymous links", "23"], ["Unlabelled files exposed", "61,000"], ["Oldest active link", "3 years"]],
      after: [["Accounts sharing externally", "12"], ["Anonymous links", "0"], ["Unlabelled files exposed", "4,200"], ["Oldest active link", "90 days"]],
      note: "Risk today: content leaves the MSA boundary with no way to prove who read it. Time-bounding every link is a one-week change." },
    docs: { who: "jane", q: "Documents Copilot can ground on with no owner — walk me through that.",
      title: "Groundable documents with no owner",
      what: "11,400 documents sit inside Copilot's reach with no owner, no label and no review date. They came back from the same permission-scoped Graph query Copilot runs when it builds its semantic index.",
      why: "An unowned document is one nobody will ever remove. It stays citable forever, and because it is unlabelled, any answer built from it inherits no protection and no classification warning.",
      before: [["Documents with no owner", "11,400"], ["Unlabelled among them", "100%"], ["Regulated content", "40,480 files"], ["Review cycle", "none"]],
      after: [["Documents with no owner", "3,100"], ["Unlabelled among them", "12%"], ["Regulated content", "1,120 files"], ["Review cycle", "quarterly"]],
      note: "Risk today: PHI and compensation data are retrievable in a normal prompt. Auto-labelling plus owner attestation clears three quarters of it without anyone reading a file." },
    guests: { who: "kirk", q: "Unmanaged guest identities — walk me through that.",
      title: "Unmanaged guest identities",
      what: "612 guest accounts hold standing access to this tenant. There is no expiry policy, no re-attestation cycle, and 31 of them were invited by someone who has since left.",
      why: "A guest identity is a real identity — it can be phished, it survives the project it was created for, and it counts as a person who can reach whatever the site grants. Copilot does not treat guests differently.",
      before: [["Guest identities", "612"], ["With no expiry", "612"], ["External domains", "48"], ["Last access review", "never"]],
      after: [["Guest identities", "344"], ["With no expiry", "0"], ["External domains", "19"], ["Last access review", "90 days"]],
      note: "Risk today: 268 of these clear on the first attestation cycle purely because nobody renews them — the exposure exists only because nothing expires." },
    labels: { who: "beth", q: "Sensitivity label coverage — walk me through that.",
      title: "Sensitivity label coverage",
      what: "78% of PHI containers carry a label. The remaining 22% — around 40,480 regulated files — carry none, and three PHI classifiers are still in simulation mode, which means they report matches and block nothing.",
      why: "Labels are what make containment provable. Without them a grounded answer inherits no classification, so there is no way to demonstrate to a regulator that PHI could not surface — and under MSA §7.4 that makes it reportable rather than internal.",
      before: [["PHI containers labelled", "78%"], ["Regulated files unlabelled", "40,480"], ["Classifiers enforcing", "0 of 3"], ["Provable containment", "no"]],
      after: [["PHI containers labelled", "99%"], ["Regulated files unlabelled", "1,120"], ["Classifiers enforcing", "3 of 3"], ["Provable containment", "yes"]],
      note: "Risk today: this is the single finding that turns an internal incident into a reportable one. Four weeks of auto-labelling changes the legal position, not just the score." }
  };

  govExplainSignal = (key, label, value) => {
    const h = this.govSignalHelp[key];
    if (!h) { this.govAsk("Explain " + label + " at " + value); return; }
    this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: h.q }]), govDetail: key }));
    clearTimeout(this.helpT);
    this.helpT = setTimeout(() => this.govSay({ who: h.who, text: h.what, help: "sig:" + key }), 300);
  };

  govExplainControl = (key) => {
    const h = this.govControlHelp[key];
    if (!h) return;
    this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: h.q }]) }));
    clearTimeout(this.helpT);
    this.helpT = setTimeout(() => this.govSay({ who: h.who, text: h.what, help: key }), 300);
  };

  govShowDocs = (key) => {
    const set = this.govDocSets[key];
    if (!set) return false;
    this.govSay({ who: set.who, text: set.lead, docs: key });
    return true;
  };

  // every persona line arrives the way a text does: typing indicator, then the message
  govSay = (msg, delay) => {
    clearTimeout(this.typeT);
    this.setState({ govTyping: msg.who });
    const dur = delay || Math.min(2200, 600 + ((msg.text || msg.lead || "")).length * 9);
    this.typeT = setTimeout(() => {
      this.setState(st => ({ govTyping: null, govThread: (st.govThread || []).concat([msg]) }));
    }, dur);
  };

  govSayAll = (all) => {
    const msgs = (all || []).slice(0, 2);
    let i = 0;
    const next = () => {
      if (i >= msgs.length) return;
      const m = msgs[i++];
      this.setState({ govTyping: m.who });
      const dur = Math.min(2200, 600 + ((m.text || m.lead || "")).length * 9);
      this.typeT = setTimeout(() => {
        this.setState(st => ({ govTyping: null, govThread: (st.govThread || []).concat([m]) }), () => {
          this.typeT = setTimeout(next, 340);
        });
      }, dur);
    };
    clearTimeout(this.typeT);
    next();
  };

  diveViews = (s) => (s.dive === "licensing" ? this.licViews : s.dive === "adoption" ? this.adoViews : s.dive === "compliance" ? this.cmpViews : s.dive === "health" ? this.hltViews : s.dive === "security" ? this.secViews : s.dive === "copilot" ? this.cplViews : s.dive === "sow" ? this.sowViews : s.dive === "docs" ? this.docsViews : this.govViews);

  govAdvance = (kind) => {
    const st = this.state;
    if (st.govDoc && kind !== "ask") this.setState({ govDoc: false });
    if (kind && kind.indexOf("win:") === 0) {
      const w = QUICK_WINS[kind.slice(4)];
      if (w) this.govSay({ who: "shane", text: w.kind === "ps"
        ? "Here it is. Read it before you run it — it is read-only, but you should never run a script from a vendor without reading it."
        : "Here it is, step by step. Everything below is a link or something you can copy straight across.", win: w.id, back: w.id });
      return;
    }
    if (kind && kind.indexOf("walk:") === 0) {
      const rest = kind.slice(5);
      this.govWalkTo(rest.indexOf("done") > 0 ? rest[0] + "999" : rest);
      return;
    }
    if (kind === "tolicensing") {
      const nextTxt = {
        licensing: "Good. The licence position is documented, the recovery is quantified, and none of it needs new budget. Adoption next — whether your people would actually use what you are about to buy.",
        adoption: "Good. Adoption is measurable now rather than hoped for. Compliance next — the pillar that decides whether an incident is internal or reportable.",
        compliance: "Good. The compliance position is documented and, more importantly, provable. Tenant health next — whether any of this survives contact with a Tuesday.",
        health: "Good. The platform can carry this now. Security last — reachability rather than posture scores, and the one pillar that can stop the whole thing.",
        security: "Understood. The chain is documented and the sequence is agreed. That is every pillar — which means we can finally answer the only question that matters: can you turn Copilot on.",
        governance: "Good. Governance is documented and every change you staged carries into the statement of work. Licensing next — that is where this pays for itself before it delivers anything."
      };
      this.govSay({ who: st.dive === "adoption" ? "marcus" : "shane", text: nextTxt[st.dive] || nextTxt.governance });
      clearTimeout(this.toLicT);
      this.toLicT = setTimeout(this.closeDive, 1900);
      return;
    }
    if (kind === "ask") { this.govSay({ who: "jane", text: "Go ahead — type it below, or pick anything on the board and I'll take it from there." }); return; }
    if (kind === "close") { this.setState({ dive: null, playing: true }, this.tick); return; }
    if (kind === "done") { this.govSayAll([{ who: "shane", text: "Understood. The detail is there when your team wants it — it all lands in the governance report either way." }, this.govPrompts[2]]); return; }
    const nv = Math.min(2, (st.govView || 0) + 1);
    this.setState({ govView: nv });
    this.govWalkTo(nv === 1 ? "a0" : "e0");
    if (nv) return;
    const nextView = Math.min(2, (st.govView || 0) + 1);
    const said = nextView === 1
      ? { who: "jane", text: "Here's the analyst cut — same tenant, grouped the way a remediation team would actually work it. Permission hygiene and drift are the two nobody looks at until Copilot surfaces them." }
      : { who: "shane", text: "And this is the engine layer. Every number you've seen comes out of one of these seven surfaces, on a schedule — which is how you'd know if it drifts back." };
    this.setState({ govView: nextView });
    this.govSayAll([said, this.govPrompts[nextView]]);
  };

  govOpening = [
    { who: "jane", text: "Everything you're about to see came out of your tenant this morning — read-only, straight from Graph and the SharePoint admin API. Nothing is modelled." },
    { who: "shane", text: "", walk: "c0", lead: "Let me walk it the way I'd present it in the room, five topics in the order they compound. " + GOV_WALK[0].lead,
      actions: [["Show me how", "win:c0"], ["Next — Overshared Locations", "walk:c1"]] }
  ];

  // anything on a walkthrough card is a question the customer can ask out loud
  walkAsk = (i, kind, label, value) => {
    const w = walkAt(i);
    if (!w) return;
    const who = w.who || (i === "c2" ? "beth" : i === "c3" ? "kirk" : i === "c1" ? "jane" : "shane");
    const has = value !== undefined && value !== null && String(value).length > 0;
    const q = "Explain " + label + (has ? " at " + value : "");
    const d0 = (w.delta && w.delta[0]) || ["Signal", "—", "—"];
    const d1 = (w.delta && w.delta[1]) || d0;
    const d2 = (w.delta && w.delta[2]) || d1;

    const cards = {
      head: {
        title: w.title + " — " + label,
        what: "This is the headline for " + w.title.toLowerCase() + ": " + value + " " + label + ". It is measured directly from the tenant scan, not sampled and not benchmarked against other customers.",
        why: w.head.note.charAt(0).toUpperCase() + w.head.note.slice(1) + ". A Copilot go-live is a gate, not a target — the number either clears it or it does not.",
        before: [[label, value], [d0[0], d0[1]], [d1[0], d1[1]], ["Gate cleared", "no"]],
        after: [[label, "within threshold"], [d0[0], d0[2]], [d1[0], d1[2]], ["Gate cleared", "yes"]],
        note: "Every other figure on this card feeds this one. Fix the inputs and this moves on its own.",
        sim: { id: i + ":head", label: "Model this topic fully remediated",
          off: "Currently showing what the scan found this morning. Toggle to see the same tenant with this topic closed.",
          on: d0[0] + " " + d0[1] + " → " + d0[2] + ", " + d1[0].toLowerCase() + " " + d1[1] + " → " + d1[2] + ", " + d2[0].toLowerCase() + " " + d2[1] + " → " + d2[2] + "." },
        asks: ["What does it take to close this topic?", "Which of these can we do ourselves?", "How long before the score moves?"]
      },
      topic: {
        title: w.title,
        what: w.lead,
        why: "It is one of five topics that compound. Read alone it looks like housekeeping; read in sequence it is the reason readiness sits where it does — which is why we present them in this order rather than as a findings list.",
        before: w.delta.map(x => [x[0], x[1]]).concat([["Topic status", "open"]]),
        after: w.delta.map(x => [x[0], x[2]]).concat([["Topic status", "closed"]]),
        note: "Nothing in this topic requires new tooling or new licences — it is configuration you already own.",
        asks: ["What is the first thing we should do here?", "Who owns this work?", "What happens if we skip it?"]
      },
      bar: {
        title: label,
        what: label + " reads " + value + ". It is one of the inputs behind the " + w.head.v + " headline on this card, measured directly from the tenant.",
        why: "The reason it reads the way it does is configuration, not user behaviour. Nobody chose this state — it accumulated from defaults that were never revisited.",
        before: [[label, value], [d0[0], d0[1]], ["Reviewed", "never"], ["Owner", "unassigned"]],
        after: [[label, "within baseline"], [d0[0], d0[2]], ["Reviewed", "quarterly"], ["Owner", "named"]],
        note: "This is the sort of line item your own admins can verify in an afternoon with a read-only query.",
        sim: { id: i + ":" + label, label: "Simulate closing " + label.toLowerCase(),
          off: "Showing current state. Toggle to see the effect on the topic headline.",
          on: w.head.l + " moves from " + w.head.v + " toward the threshold, and " + d0[0].toLowerCase() + " goes " + d0[1] + " → " + d0[2] + "." },
        asks: ["Show me the objects behind " + label.toLowerCase(), "Can we fix this ourselves?", "What breaks if we change it?"]
      },
      heat: {
        title: label,
        what: label + " is " + value + ". This is a reachability call rather than a volume call — what matters is not how much of it there is, but that a normal prompt from a first-line account resolves to it today.",
        why: "Copilot returns it with a citation, so the content arrives with your own tenant's authority attached. That is what changes the risk profile relative to someone simply browsing.",
        before: [[label, value], ["Reachable by", "1,876 accounts"], ["Classification inherited", "no"], [d0[0], d0[1]]],
        after: [[label, "scoped"], ["Reachable by", "named groups"], ["Classification inherited", "yes"], [d0[0], d0[2]]],
        note: "Reachability is fixed by the grant, not by the content. You do not need to move or delete anything.",
        sim: { id: i + ":" + label, label: "Simulate scoping " + label.toLowerCase(),
          off: "Showing what a first-line account can reach today.",
          on: "Scoped: " + label.toLowerCase() + " no longer resolves for a general account, and " + d0[0].toLowerCase() + " goes " + d0[1] + " → " + d0[2] + "." },
        asks: ["Who can reach " + label.toLowerCase() + " today?", "What would Copilot say about it?", "Is this reportable?"]
      },
      wrong: {
        title: "Finding — " + w.title,
        what: label,
        why: "On its own this is a housekeeping item. In sequence with the other findings on this card it is what turns an internal issue into a reportable one, which is why we present them together.",
        before: w.delta.map(x => [x[0], x[1]]),
        after: w.delta.map(x => [x[0], x[2]]),
        note: "This finding carries into the statement of work with an owner and a date, whether or not you engage us to run it.",
        asks: ["How urgent is this one?", "What is the fix?", "Has this caused an incident yet?"]
      },
      fix: {
        title: "Remediation — " + w.title,
        what: label,
        why: "It is a configuration change rather than a project. Your own admins can run it; what a statement of work buys is sequencing, evidence and someone accountable for the outcome.",
        before: [["Status", "not started"], [d0[0], d0[1]], [d1[0], d1[1]], ["Evidence", "none"]],
        after: [["Status", "complete"], [d0[0], d0[2]], [d1[0], d1[2]], ["Evidence", "change record"]],
        note: "Sequence matters more than effort here — doing this out of order costs weeks, not risk.",
        sim: { id: i + ":fix:" + label.slice(0, 24), label: "Apply this step in the model",
          off: "Not applied. Toggle to see the projected movement.",
          on: "Applied: " + d0[0].toLowerCase() + " " + d0[1] + " → " + d0[2] + " and " + d1[0].toLowerCase() + " " + d1[1] + " → " + d1[2] + "." },
        asks: ["Can we do this without you?", "What are the prerequisites?", "How long does it take?"]
      },
      delta: {
        title: label + " — projected movement",
        what: label + " sits at " + value + " today and lands at " + (w.delta.find(x => x[0] === label) || d0)[2] + " once this topic is closed.",
        why: "The movement is modelled from the remediation on this card applied in order. It assumes no new licences and no new tooling — everything is inside what you already own.",
        before: w.delta.map(x => [x[0], x[1]]),
        after: w.delta.map(x => [x[0], x[2]]),
        note: "We re-run the scan after each wave, so this stops being a projection and becomes a measurement.",
        sim: { id: i + ":delta", label: "Show the modelled end state",
          off: "Showing today's measured position.",
          on: "Modelled: " + w.delta.map(x => x[0].toLowerCase() + " " + x[1] + " → " + x[2]).join(", ") + "." },
        asks: ["What assumptions is this based on?", "When would we see it?", "What could stop it?"]
      }
    };
    const card = Object.assign({ section: w.title }, cards[kind] || cards.bar);
    const norm = (rows) => rows.slice(0, 4).map(r => [r[0], String(r[1])]);
    const hobj = Object.assign({}, card, { before: norm(card.before), after: norm(card.after) });

    this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: q }]) }));
    clearTimeout(this.walkT);
    this.walkT = setTimeout(() => this.govSay({ who: who, text: hobj.what, hobj: hobj, back: i }), 280);
  };

  // a finding on the whiteboard opens a targeted conversation about that finding
  askFinding = (pillar, fx) => {
    if (this.state.dive !== "governance") {
      this.setState(st => ({ qa: { who: "shane", text: fx.t + " — " + fx.m + ". That one carries into " + fx.sow + "." } }));
      return;
    }
    const who = /label|retention|MSA|regulated/i.test(fx.t + fx.m) ? "beth"
      : /DLP|conditional access|admin|risk/i.test(fx.t) ? "kirk"
      : /device|endpoint|ticket|drift/i.test(fx.t) ? "marcus" : "jane";
    this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: "Explain " + fx.t }]) }));
    clearTimeout(this.findT);
    this.findT = setTimeout(() => this.govSay({ who: who, text: "That is a measured finding, not an opinion: " + fx.m + ".", hobj: {
      title: fx.t,
      what: "Measured this morning: " + fx.m + ". We can put the objects behind it in this conversation whenever you want them.",
      why: "It carries into the statement of work under " + fx.sow + ". Nothing about it needs new tooling — it is configuration you already own, sequenced so it lands safely.",
      before: [["Status", "open"], ["Measured", fx.m], ["SOW phase", fx.sow], ["Owner", "unassigned"]],
      after: [["Status", "closed"], ["Measured", "within baseline"], ["SOW phase", fx.sow], ["Owner", "named"]],
      section: fx.sow,
      note: "Every finding on the whiteboard is reproducible with a read-only query — you never have to take our word for a number.",
      asks: ["Show me the objects behind this", "Can we fix this ourselves?", "What does it block?"]
    } }), 280);
  };

  // every telemetry line answers with a card built for that signal
  signalCards = {
    "“Everyone in the organization” links": { who: "jane", what: "41 links grant “Everyone in the organization”. That resolves to every licensed account — 1,876 people — and it was applied at site level, so every library beneath inherits it.", why: "It is the single largest contributor to what Copilot can ground on. 214,806 files are citable because of these 41 links.", rows: [["Links live", "41", "0"], ["Files behind them", "214,806", "18,240"], ["Accounts with reach", "1,876", "scoped groups"], ["Expiry policy", "none", "30 / 90 days"]], note: "Replacing each link with a scoped group takes two weeks and nobody who legitimately needs access loses it.", sim: "Closed: Copilot's general grounding surface drops by 196,566 files and governance moves 34 → 71.", asks: ["Which sites do these 41 links sit on?", "Can we close them ourselves?", "Who created them?"] },
    "“Anyone with the link” anonymous links": { who: "kirk", what: "23 anonymous links are live. An Anyone link has no identity behind it — anyone holding the URL opens the content, and nothing records who they were.", why: "There is no audit trail and no revocation path. When the recipient leaves their employer the link keeps working, and you cannot prove who read what.", rows: [["Anonymous links", "23", "0"], ["Identity recorded", "none", "named guest"], ["Audit trail", "none", "per access"], ["Oldest link", "3 years", "90 days"]], note: "Disabling Anyone links tenant-wide is one setting. Existing links can be converted to authenticated guests without re-sharing.", sim: "Disabled: every share now carries a named identity and a 90-day expiry, and access is logged.", asks: ["Where are these 23 links?", "Can we see who used them?", "Is this reportable?"] },
    "Services affected": { who: "jane", what: "The exposure is not confined to SharePoint. It spans SharePoint, Teams and OneDrive — three surfaces with three different sharing models and one shared consequence.", why: "Teams exposes its connected SharePoint site, and OneDrive is never inventoried. Fixing SharePoint alone leaves two-thirds of the surface open.", rows: [["SharePoint sites", "41 overshared", "0"], ["Teams with public channels", "17", "2"], ["OneDrive external shares", "48 accounts", "12"], ["Remediation streams", "3", "1 sequenced"]], note: "One policy change covers all three — the tenant sharing ceiling applies across every workload.", asks: ["Which service is worst?", "Do they need separate work?", "What is the shared fix?"] },
    "Conditional Access gaps": { who: "kirk", what: "CA01 — the policy that would govern Copilot app sessions — is disabled. You have 42 conditional access policies and none of them evaluate the Copilot session itself.", why: "Every other access path in this tenant is governed. The one path that reads all your content and returns it in natural language is not.", rows: [["Copilot session policy", "disabled", "enforced"], ["CA policies live", "42", "43"], ["Sessions evaluated", "0%", "100%"], ["Unmanaged browser access", "allowed", "blocked"]], note: "Enabling CA01 is a change-window item, not a project. It is report-only first so you can see the impact before enforcing.", sim: "CA01 enforced: every Copilot session is evaluated for device compliance and location, and unmanaged browsers are blocked.", asks: ["What would CA01 actually block?", "Can we run it report-only first?", "Who would notice?"] }
  };

  askSignalRow = (section, label, value) => {
    const c = this.signalCards[label];
    const q = "Explain " + label + " at " + value;
    const rows = c ? c.rows : [[label, value, "within baseline"], ["Source", "this morning's scan", "continuous"], ["Reviewed", "never", "quarterly"], ["Owner", "unassigned", "named"]];
    const hobj = {
      title: label,
      what: c ? c.what : label + " reads " + value + " under " + section + ". It is measured directly from the tenant, not sampled.",
      why: c ? c.why : "It is one of the inputs behind the governance pillar score, and it is reproducible with a read-only Graph query whenever your team wants to check it.",
      before: rows.map(r => [r[0], r[1]]),
      after: rows.map(r => [r[0], r[2]]),
      fixKey: label,
      section: section,
      note: c ? c.note : "Ask me for the objects behind it and I will put the list in this conversation.",
      sim: c && c.sim ? { id: "sig:" + label, label: "Simulate this closed", off: "Showing what the scan found this morning.", on: c.sim } : null,
      asks: c ? c.asks : ["Show me the objects behind this", "Can we fix it ourselves?", "What does it block?"]
    };
    this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: q }]) }));
    clearTimeout(this.sigT);
    this.sigT = setTimeout(() => this.govSay({ who: (c && c.who) || "jane", text: hobj.what, hobj: hobj }), 260);
  };

  // a follow-up prompt always answers with a card, and always offers the way back
  followUp = (q, h, back) => {
    const subject = h.title || "this signal";
    const objects = /object|show me|behind|which|where|who/i.test(q);
    const timing = /when|how long|timeline/i.test(q);
    const blocks = /block|stop|prevent|impact/i.test(q);
    const measured = /measur|how was|source|assumption/i.test(q);
    const rows = (h.before || []).map((r, i) => [r[0], r[1], (h.after && h.after[i] && h.after[i][1]) || "—"]);
    const card = {
      title: objects ? subject + " — the objects behind it"
        : timing ? subject + " — timing"
        : blocks ? subject + " — what it blocks"
        : measured ? subject + " — how it was measured"
        : subject,
      what: objects
        ? "These are the actual objects behind " + subject.toLowerCase() + ", returned by the same permission-scoped Graph query Copilot uses when it builds its index. Nothing here is sampled — it is the list."
        : timing
        ? "Sequenced properly this lands inside the current quarter. The work itself is days; the elapsed time is change windows, notification periods and the attestation cycle you cannot compress."
        : blocks
        ? subject + " is one of the gates between where readiness sits today and the 75 a tenant-wide Copilot go-live needs. It blocks the rollout, not the pilot."
        : measured
        ? "Read-only, this morning, against your own tenant. Graph for identity and sites, the SharePoint admin API for sharing and inheritance, Purview for labels and DLP. Every figure is reproducible with a single query and we hand over the raw JSON."
        : "Here is the detail behind " + subject.toLowerCase() + ", drawn from the same scan data as the card you asked from.",
      why: objects
        ? "Seeing the named objects is what turns this from a statistic into a work list — each row has an owner, a grant and a file count, so it can be assigned rather than debated."
        : timing
        ? "The order matters more than the effort. Doing the cheap items first feels productive and moves readiness barely at all."
        : blocks
        ? "Nothing here stops a scoped pilot inside a labelled boundary. What it stops is turning Copilot on for everyone."
        : measured
        ? "That matters because you should never accept a readiness number you cannot re-derive. Your own admins can run every one of these queries."
        : "It is the same measured data, read a different way.",
      before: rows.map(r => [r[0], r[1]]),
      after: rows.map(r => [r[0], r[2]]),
      note: objects
        ? "Ask me to put any single object on the board and I will bring up what Copilot would return from it."
        : "Everything on this card carries into the statement of work with an owner and a date.",
      fixKey: h.fixKey || subject,
      asks: ["Can we fix this ourselves?", "What does it block?", "How was it measured?"]
    };
    this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: q }]) }));
    clearTimeout(this.fuT);
    this.fuT = setTimeout(() => this.govSay({ who: "shane", text: card.what, hobj: card, back: back != null ? back : (this.state.govAt || "c0") }), 260);
  };

  selfFix = (key, q) => {
    const p = fixProfileFor(key);
    this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: q || "Can we fix this ourselves?" }]) }));
    clearTimeout(this.fixT);
    this.fixT = setTimeout(() => this.govSay({
      who: "shane",
      text: "Yes — with a caveat about who does it. Here is the honest split, and what goes wrong if the wrong person takes it on.",
      hobj: {
        title: "Self-service assessment — " + p.subject,
        what: p.what + " Effort is " + p.effort.toLowerCase() + ", risk is " + p.risk.toLowerCase() + ", and no professional services are required.",
        why: "Blast radius if this is done incorrectly: " + p.blast[0],
        before: (p.rows || []).map(r => [r[0], r[1]]),
        after: (p.rows || []).map(r => [r[0], r[2]]),
        note: "How to keep it safe: " + p.guard,
        blast: p.blast,
        tiers: p.tiers,
        fixKey: key,
        asks: []
      },
      back: (this.state.govAt || "c0"),
      fixActions: key
    }), 300);
  };

  emitRunbook = (key, mode) => {
    const p = fixProfileFor(key);
    const r = mode === "ps" ? p.ps : p.ui;
    if (!r) return;
    this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: mode === "ps" ? "Give me the PowerShell" : "Walk me through the admin centre" }]) }));
    clearTimeout(this.rbT);
    this.rbT = setTimeout(() => this.govSay({
      who: "shane",
      text: mode === "ps"
        ? "Read it before you run it. Stage one is read-only — run that, look at the CSV, and only then decide about stage two."
        : "Step by step. Every link opens the right blade, and anything you need to type exactly is a copy button.",
      wobj: {
        id: key + ":" + mode, kind: mode, title: r.title,
        why: p.what, minutes: p.effort, risk: p.risk, owner: mode === "ps" ? "Administrator running the script" : "Administrator with the named role",
        tier: mode === "ps" ? (p.psTier || "intermediate") : (p.uiTier || "beginner"),
        steps: r.steps || [], perms: r.perms || [], prereq: r.prereq || "", script: r.script || "",
        verify: r.verify, undo: r.undo, sideEffects: p.blast
      },
      back: "c0"
    }), 300);
  };

  cplPrompts = [
    { m: /site|sharepoint|flight|mission/i, title: "Site retrieval", who: "shane",
      answer: "Flight Ops – Mission Docs is a mission documentation library with 41,208 files covering launch readiness, anomaly reports and shift handovers for the 2026 programme.",
      cites: ["Flight Ops – Mission Docs / Launch_Readiness_2026.docx", "Flight Ops – Mission Docs / Anomaly_Log_Q2.xlsx", "Flight Ops – Mission Docs / Shift_Handover_Template.docx"],
      warn: "Returned from an EEEU · Edit grant. 41,208 files reachable, none labelled.",
      rows: [["Files retrievable", "41,208"], ["Grant", "EEEU · Edit"], ["Labelled", "0%"], ["Rights required", "none"]] },
    { m: /contract|termination|msa|legal|vendor/i, title: "Contract retrieval", who: "beth",
      answer: "The Aerostruct MSA permits termination for convenience on 90 days' written notice, with a 30-day cure period for material breach and survival of confidentiality for 5 years.",
      cites: ["Contracts & Legal / Aerostruct_MSA_Executed.pdf", "Contracts & Legal / Amendment_3_Signed.pdf"],
      warn: "Verbatim from an executed contract. The library is EEEU · Read, so every employee gets this answer.",
      rows: [["Contracts reachable", "8,412"], ["Grant", "EEEU · Read"], ["Classification", "Confidential"], ["Rights required", "none"]] },
    { m: /salary|comp|payroll|band|hr|people/i, title: "Compensation retrieval", who: "beth",
      answer: "The FY26 draft band structure has five levels with midpoints from $68,400 to $214,000, plus a 12% variable target for director grade and above.",
      cites: ["HR – People Ops / Payroll_FY26_Draft.xlsx", "HR – People Ops / Band_Structure_v4.docx"],
      warn: "Draft compensation data from an unlabelled folder shared with an org-wide link.",
      rows: [["Files reachable", "6,730"], ["Grant", "Org-wide link"], ["Labelled", "no"], ["Rights required", "none"]] },
    { m: /phi|patient|clinical|protocol|health record/i, title: "Clinical retrieval", who: "kirk",
      answer: "Clinical protocol CP-114 covers post-operative monitoring intervals, escalation thresholds and the named on-call rota for the cardiac unit.",
      cites: ["Clinical Protocols Archive / CP-114_PostOp_Monitoring.docx", "Clinical Protocols Archive / OnCall_Rota_Aug.xlsx"],
      warn: "PHI-adjacent content returned to an ordinary account. Under MSA §7.4 this class of disclosure is reportable.",
      rows: [["Files reachable", "17,940"], ["Grant", "EEEU · Read"], ["Class", "PHI"], ["Reportable", "yes"]] },
    { m: /cost|spend|licen|budget|save|money/i, title: "Cost retrieval", who: "shane",
      answer: "The tenant holds 6,180 seats against 4,872 assigned. Unassigned capacity costs $847,608 a year, and 1,180 seats carry third-party tools that E5 already covers.",
      cites: ["subscribedSkus · 01 Aug 2026", "getOffice365ActiveUserDetail · D90"],
      warn: "Retrieved from licensing telemetry, not from content — no exposure in this answer.",
      rows: [["Seats provisioned", "6,180"], ["Unassigned", "1,308"], ["Annual waste", "$847,608"], ["Recoverable", "$1,010,000"]] }
  ];

  runCplPrompt = (text) => {
    const q = (text || "").trim();
    if (!q) return;
    const hit = this.cplPrompts.find(p => p.m.test(q)) || this.cplPrompts[0];
    this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: q }]), cplDraft: "", cplRunning: true }));
    clearTimeout(this.cplT);
    this.cplT = setTimeout(() => {
      this.setState({ cplRunning: false });
      this.govSay({
        who: hit.who,
        text: "Ran it against your tenant with an unprivileged test identity. Here is exactly what came back.",
        cpl: { prompt: q, title: hit.title, answer: hit.answer, cites: hit.cites, warn: hit.warn, rows: hit.rows },
        back: (this.state.govAt || "c0")
      });
    }, 1500);
  };

  openSizer = () => {
    this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: "Show me the right-sizing model" }]) }));
    clearTimeout(this.sizerT);
    this.sizerT = setTimeout(() => this.govSay({
      who: "shane",
      text: "Here it is — every SKU, what you bought against what ninety days of use says you need. Move the numbers and the bill moves with them.",
      sizer: true, back: (this.state.govAt || "c0")
    }), 260);
  };

  setSku = (id, v) => {
    this.setState(st => ({ sizer: Object.assign({}, st.sizer, { [id]: Math.max(0, v) }) }));
  };

  askRow = (kind, cells) => {
    const c = cells.map(x => x.v);
    const name = c[0] || "that row";
    const K = String(kind || "");
    let q, hobj, who = "shane";
    if (K === "SP") {
      who = "jane";
      q = "Explain " + name + " at " + c[1];
      hobj = { title: name, what: "That site carries a " + c[1] + " grant, and " + c[2] + " sit behind it classified " + c[3] + ". The grant was applied at the site level, so every library beneath it inherits the same reach.",
        why: "Any licensed account in your tenant can already open those files, and Copilot will cite them by name the moment grounding is on. The grant is what makes it citable — not Copilot.",
        before: [["Reach", "every internal account"], ["Files behind the grant", c[2]], ["Classification", c[3]], ["Owner assigned", "no"]],
        after: [["Reach", "scoped security group"], ["Files behind the grant", c[2]], ["Classification", "labelled"], ["Owner assigned", "yes"]],
        note: "Fixing this one site is a single sharing change plus an owner assignment. Recipients who genuinely need it keep access through the group.",
        sim: { id: "row:" + name, label: "Simulate scoping this site",
          off: "Showing the grant as it resolves today.",
          on: "Scoped: " + c[2] + " no longer resolve for a general account, and this site drops off the overshared list." },
        asks: ["What would Copilot return from " + name + "?", "Who actually needs access to it?", "Can we fix this one ourselves?"] };
    } else if (K === "TEAMS") {
      who = "jane";
      q = "Explain " + name + " at " + c[1];
      hobj = { title: name, what: "That team has at least one public channel with a " + c[1] + " grant. A public channel exposes the connected SharePoint site, which holds " + c[2] + " classified " + c[3] + ".",
        why: "Nobody creates a public channel intending it to be permanent, but nothing closes it — and Copilot grounds on the connected site rather than the channel, so the exposure outlives the project.",
        before: [["Channel visibility", "public"], ["Site exposed", "yes"], ["Files reachable", c[2]], ["Link expiry", "none"]],
        after: [["Channel visibility", "private"], ["Site exposed", "no"], ["Files reachable", "members only"], ["Link expiry", "30 days"]],
        note: "Converting to private takes a minute per team and members keep access. It is the cheapest fix in the report.",
        sim: { id: "row:" + name, label: "Simulate converting to private",
          off: "Public channel — connected site is tenant-visible.",
          on: "Private: " + c[2] + " become members-only and the connected site leaves Copilot's general grounding surface." },
        asks: ["Who is in this team today?", "Does converting break anything?", "How many other teams look like this?"] };
    } else if (K === "OD") {
      who = "kirk";
      q = "Explain " + name + " at " + c[1];
      hobj = { title: name, what: "That personal store holds an active " + c[1] + " covering " + c[2] + ", classified " + c[3] + ". Personal stores are not inventoried and do not inherit labels.",
        why: "If the grant is an anonymous link there is no identity behind it — no audit trail, and nothing to revoke when the recipient leaves their employer, let alone yours.",
        before: [["Grant type", c[1]], ["Files exposed", c[2]], ["Identity behind it", "none"], ["Expiry", "never"]],
        after: [["Grant type", "authenticated guest"], ["Files exposed", "scoped"], ["Identity behind it", "named"], ["Expiry", "90 days"]],
        note: "Time-bounding these is a tenant-level setting. It does not need a per-user conversation.",
        sim: { id: "row:" + name, label: "Simulate authenticated-only sharing",
          off: "Anonymous link active — no identity, no audit trail.",
          on: "Authenticated: the recipient is named, the share expires in 90 days, and every access is logged." },
        asks: ["Who has opened this recently?", "Is this reportable?", "Can we revoke it safely?"] };
    } else if (K === "MISMATCH" || K === "OVER" || K === "NEED") {
      who = "shane";
      q = "Explain " + name + " at " + c[1];
      hobj = { title: name, what: "They hold " + c[1] + " and ninety days of telemetry says they should hold " + c[2] + ". The delta is " + c[3] + " a month for that one person.",
        why: "Licence fit is measured against real workload use, not job title. Over-licensing is money; under-licensing is a person who cannot do the thing you are about to buy Copilot for.",
        before: [["Currently holds", c[1]], ["Monthly position", c[3]], ["Based on", "job title"], ["Reviewed", "never"]],
        after: [["Should hold", c[2]], ["Monthly position", "corrected"], ["Based on", "90-day telemetry"], ["Reviewed", "quarterly"]],
        note: "Move the unambiguous ones first — they prove the method before you apply it at scale.",
        sim: { id: "row:" + name, label: "Apply the corrected SKU",
          off: "Current assignment stands.",
          on: "Corrected to " + c[2] + ": monthly position moves " + c[3] + " and the account joins the group-based assignment." },
        asks: ["How was this measured?", "What does this person actually use?", "How many others look like this?"] };
    } else {
      q = "Explain " + name + (c[1] ? " at " + c[1] : "");
      hobj = { title: name, what: name + " reads " + (c[1] || "as listed") + ". " + (c[2] || ""),
        why: "It is a measured value from this morning's scan, not a benchmark or an estimate — you can re-derive it with the same read-only query we used.",
        before: [["Current state", c[1] || "as listed"], ["Source", "this morning's scan"], ["Reproducible", "yes"], ["Owner", "unassigned"]],
        after: [["Target state", "within baseline"], ["Source", "continuous"], ["Reproducible", "yes"], ["Owner", "named"]],
        note: "Ask me for the objects behind it and I will put the list in the conversation.",
        asks: ["Show me the objects behind this", "How was it measured?", "What does it block?"] };
    }
    this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: q }]) }));
    clearTimeout(this.rowT);
    this.rowT = setTimeout(() => this.govSay({ who: who, text: hobj.what, hobj: hobj }), 260);
  };

  askWinStep = (id, n, text) => {
    const w = QUICK_WINS[id];
    if (!w) return;
    this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: "Explain step " + n + " of " + w.title }]) }));
    clearTimeout(this.stepT);
    const body = "Step " + n + ": " + text + " Nothing in that step removes existing access — " + w.risk.toLowerCase() + ".";
    this.stepT = setTimeout(() => this.govSay({ who: "shane", text: body, back: id, hobj: {
      title: w.title + " — step " + n,
      what: body,
      why: "If the screen looks different in your tenant it is because the admin centre moved the setting, not because your configuration is unusual. The setting name is what to search for, not the path.",
      before: [["Step", n + " of " + (w.steps ? w.steps.length : "—")], ["Reversible", "yes"], ["Removes access", "no"], ["Owner", w.owner]],
      after: [["Step", "complete"], ["Reversible", "yes"], ["Removes access", "no"], ["Owner", w.owner]],
      fixKey: id,
      note: "Log the change with the date and who made it — that log is what turns a fix into evidence.",
      asks: ["What actually changes?", "Any side effects I should know about?", "Who needs to run it?"]
    } }), 260);
  };

  askWin = (id, q) => {
    const p = fixProfileFor(id);
    const d = p.detail || {};
    const w = QUICK_WINS[id];
    const subject = (w && w.title) || p.subject;
    const kind = /side effect|break|impact|notice|risk/i.test(q) ? "side"
      : /undo|revert|back out/i.test(q) ? "undo"
      : /who|permission|rights|role|run it/i.test(q) ? "who" : "effect";

    const cards = {
      effect: {
        title: subject + " — what actually changes",
        what: p.what,
        why: "Below is the tenant configuration before and after, as the API returns it. Nothing else in the tenant is touched by this change.",
        before: (p.rows || []).map(r => [r[0], r[1]]),
        after: (p.rows || []).map(r => [r[0], r[2]]),
        json: d.json, score: d.score, score2: d.score2,
        note: "The score movement assumes this change alone, applied cleanly, with nothing else remediated.",
        asks: ["Any side effects I should know about?", "Can I undo it?", "Who needs to run it?"]
      },
      side: {
        title: subject + " — side effects, both directions",
        what: "Here is the honest ledger. I am not going to pretend a permissions change is invisible to your users.",
        why: "The negatives below are the ones that generate tickets or, in the worst case, an incident. Read them before you schedule the change window.",
        before: (p.rows || []).map(r => [r[0], r[1]]),
        after: (p.rows || []).map(r => [r[0], r[2]]),
        pos: d.pos, neg: d.neg, blast: p.blast,
        note: "How to keep it safe: " + p.guard,
        asks: ["What actually changes?", "Can I undo it?", "Who needs to run it?"]
      },
      undo: {
        title: subject + " — can this be undone?",
        what: (d.undo ? d.undo.can + ". " + d.undo.text : "Partly — the settings revert, but any object you removed must be re-created by hand."),
        why: "I would rather tell you now than after you have run it. Anything that deletes an object rather than changing a setting is one-way, and I have marked those clearly.",
        before: [["Settings revert", "yes"], ["Removed objects return", (d.undo && /^Yes$/i.test(d.undo.can)) ? "yes" : "no"], ["Content lost", "never"], ["Change log needed", "yes"]],
        after: [["Settings revert", "immediately"], ["Removed objects return", (d.undo && /^Yes$/i.test(d.undo.can)) ? "yes" : "manual re-create"], ["Content lost", "never"], ["Change log needed", "kept"]],
        note: "Nothing in this runbook deletes content. The worst case is an access grant you have to re-create.",
        asks: ["What actually changes?", "Any side effects I should know about?", "Who needs to run it?"]
      },
      who: {
        title: subject + " — permissions required",
        what: "These are the exact roles. Anything marked not required should not be used — running this as Global Administrator is a finding of its own in most audits.",
        why: "Least privilege matters here for a practical reason as well as a principled one: the narrower role cannot make the mistake that causes the blast radius.",
        before: (d.roles || []).map(r => [r[0], /required/i.test(r[1]) && !/not required/i.test(r[1]) ? "required" : /sufficient/i.test(r[1]) ? "sufficient" : "not required"]),
        after: (d.roles || []).map(r => [r[0], /not required/i.test(r[1]) ? "avoid" : "assign"]),
        roles: d.roles,
        note: "Assign these for the duration of the change and remove them afterwards — PIM eligible rather than permanent.",
        asks: ["What actually changes?", "Any side effects I should know about?", "Can I undo it?"]
      }
    };
    const card = cards[kind];
    this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: q }]) }));
    clearTimeout(this.winT);
    this.winT = setTimeout(() => this.govSay({ who: "shane", text: card.what, hobj: card, back: (this.state.govAt || "c0") }), 260);
  };

  // a designed hover surface rather than a browser tooltip
  // a designed, interactive hover surface — title, sparkline, stats and a live toggle
  mountTips = () => {
    if (this.tipEl) return;
    const el = document.createElement("div");
    el.setAttribute("data-wr-tip", "");
    el.style.cssText = [
      "position:fixed", "z-index:9999", "pointer-events:none", "width:330px",
      "border-radius:15px", "opacity:0", "visibility:hidden",
      "transform:translateY(8px) scale(.96)",
      "transition:opacity 170ms cubic-bezier(.22,1,.36,1),transform 240ms cubic-bezier(.22,1,.36,1)",
      "font-family:Inter,system-ui,sans-serif",
      "border:1px solid {{ dcfg.color }}8c",
      "background:linear-gradient(158deg,rgba(23,20,54,.98),rgba(2,6,23,.98))",
      "backdrop-filter:blur(18px)",
      "box-shadow:0 24px 66px rgba(2,6,23,.88),0 0 48px {{ dcfg.color }}4d,inset 0 1px 0 rgba(255,255,255,.07)",
      "overflow:hidden"
    ].join(";");
    el.innerHTML =
      '<div style="height:2px;background:linear-gradient(90deg,#3B82F6,#67E8F9,#3B82F6);background-size:200% 100%;animation:wr-tipsheen 2.6s linear infinite"></div>' +
      '<div style="padding:11px 13px 11px;display:flex;flex-direction:column;gap:9px">' +
        '<div data-t-head style="display:none;align-items:baseline;gap:8px">' +
          '<span data-t-title style="flex:1;min-width:0;font-size:11.5px;font-weight:800;letter-spacing:-.01em;color:#f1f5f9"></span>' +
          '<span data-t-val style="font-size:15px;font-weight:800;font-variant-numeric:tabular-nums"></span>' +
        '</div>' +
        '<div data-t-spark style="display:none"></div>' +
        '<div data-t-stats style="display:none;grid-template-columns:1fr 1fr;gap:6px"></div>' +
        '<div data-t-body style="font-size:11px;line-height:1.55;color:#cbd5e1;text-wrap:pretty"></div>' +
        '<div data-t-toggle style="display:none;align-items:center;gap:9px;padding:8px 10px;border-radius:10px;border:1px solid rgba(52,211,153,.5);background:rgba(16,185,129,.12)">' +
          '<span style="flex:none;width:18px;height:18px;border-radius:99px;display:flex;align-items:center;justify-content:center;background:rgba(16,185,129,.22);border:1px solid rgba(52,211,153,.6)">' +
            '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#6ee7b7" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"></path></svg>' +
          '</span>' +
          '<span data-t-tlabel style="flex:1;min-width:0;font-size:10px;font-weight:700;color:#6ee7b7"></span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;padding-top:7px;border-top:1px solid {{ dcfg.color }}47">' +
          '<span style="width:16px;height:16px;border-radius:99px;display:flex;align-items:center;justify-content:center;background:{{ dcfg.color }}38;border:1px solid {{ dcfg.color }}99">' +
            '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>' +
          '</span>' +
          '<span data-t-cta style="font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:{{ dcfg.ink }}">Click to ask about this</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    this.tipEl = el;
    const q = (k) => el.querySelector("[data-t-" + k + "]");
    const parts = { head: q("head"), title: q("title"), val: q("val"), spark: q("spark"), stats: q("stats"), body: q("body"), toggle: q("toggle"), tlabel: q("tlabel"), tbtn: q("tbtn"), knob: q("knob") };

    const sparkSvg = (nums, color) => {
      const v = nums.map(Number).filter(n => !isNaN(n));
      if (v.length < 2) return "";
      const w = 300, h = 40, min = Math.min.apply(null, v), max = Math.max.apply(null, v), span = (max - min) || 1;
      const pts = v.map((n, i) => [(i / (v.length - 1)) * w, h - ((n - min) / span) * (h - 8) - 4]);
      const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
      const area = d + " L " + w + " " + h + " L 0 " + h + " Z";
      const last = pts[pts.length - 1];
      return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="display:block;width:100%;height:40px">' +
        '<defs><linearGradient id="wrTipG" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + color + '" stop-opacity=".38"/><stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
        '<path d="' + area + '" fill="url(#wrTipG)"></path>' +
        '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
        '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3.4" fill="' + color + '"></circle>' +
        '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="6.5" fill="' + color + '" opacity=".25"></circle></svg>';
    };

    const render = (t) => {
      const tip = t.getAttribute("data-tip") || "";
      const title = t.getAttribute("data-tip-title") || "";
      const val = t.getAttribute("data-tip-value") || "";
      const tone = t.getAttribute("data-tip-tone") || "#a78bfa";
      const spark = t.getAttribute("data-tip-spark") || "";
      const stats = t.getAttribute("data-tip-stats") || "";
      const change = t.getAttribute("data-tip-change") || "";

      parts.body.textContent = tip;
      const ctaEl = el.querySelector("[data-t-cta]");
      const cx = change && CHANGES[change];
      if (ctaEl) ctaEl.textContent = cx ? "Click — ask Shane, then apply in one tap" : "Click to ask about this";
      parts.head.style.display = title ? "flex" : "none";
      parts.title.textContent = title;
      parts.val.textContent = val;
      parts.val.style.color = tone;

      parts.spark.style.display = spark ? "block" : "none";
      if (spark) parts.spark.innerHTML = sparkSvg(spark.split(","), tone);

      const rows = stats ? stats.split(";").filter(Boolean) : [];
      parts.stats.style.display = rows.length ? "grid" : "none";
      if (rows.length) parts.stats.innerHTML = rows.map(r => {
        const p = r.split("|");
        return '<div style="padding:7px 9px;border-radius:9px;border:1px solid rgba(51,65,85,.85);background:rgba(2,6,23,.6)">' +
          '<div style="font-size:12.5px;font-weight:800;color:' + (p[2] || "#e2e8f0") + ';font-variant-numeric:tabular-nums">' + (p[1] || "") + '</div>' +
          '<div style="font-size:8.5px;line-height:1.3;color:#94a3b8">' + (p[0] || "") + '</div></div>';
      }).join("");

      const c = change && CHANGES[change];
      parts.toggle.style.display = c ? "flex" : "none";
      if (c) {
        const on = !!(this.state.changes || {})[change];
        parts.tlabel.textContent = on
          ? "Staged — click the row and say “revert” to undo"
          : "Ask to apply: “" + c.verb + "”";
      }
    };

    const place = (target) => {
      const r = target.getBoundingClientRect();
      const w = el.offsetWidth || 330, h = el.offsetHeight || 120;
      let left = r.left + r.width / 2 - w / 2;
      left = Math.max(10, Math.min(left, window.innerWidth - w - 10));
      let top = r.top - h - 12;
      if (top < 10) top = Math.min(window.innerHeight - h - 10, r.bottom + 12);
      el.style.left = Math.round(left) + "px";
      el.style.top = Math.round(top) + "px";
    };

    const show = (t) => {
      render(t);
      el.style.visibility = "visible";
      place(t);
      requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateY(0) scale(1)"; place(t); });
    };
    const hide = () => {
      el.style.opacity = "0";
      el.style.transform = "translateY(8px) scale(.96)";
      clearTimeout(this.tipHideT);
      this.tipHideT = setTimeout(() => { el.style.visibility = "hidden"; }, 200);
    };
    this.hideTip = hide;

    this.tipOver = (e) => {
      const path = e.target;
      if (path && path.closest && path.closest("[data-wr-tip]")) { clearTimeout(this.tipT); return; }
      const t = path && path.closest && path.closest("[data-tip]");
      if (!t) { if (this.tipTarget) { this.tipTarget = null; clearTimeout(this.tipT); hide(); } return; }
      if (t === this.tipTarget) return;
      this.tipTarget = t;
      clearTimeout(this.tipT);
      this.tipT = setTimeout(() => { if (this.tipTarget === t) show(t); }, 120);
    };
    this.tipOut = () => { clearTimeout(this.tipT); this.tipTarget = null; hide(); };
    document.addEventListener("mouseover", this.tipOver, true);
    document.addEventListener("click", (e) => { if (!(e.target.closest && e.target.closest("[data-wr-tip]"))) this.tipOut(); }, true);
    window.addEventListener("scroll", this.tipOut, true);
  };

  closeDive = () => {
    if (this.state.diveClosing) return;
    this.setState({ diveClosing: true });
    clearTimeout(this.closeT);
    this.closeT = setTimeout(() => {
      this.setState({ dive: null, diveClosing: false, playing: true }, this.tick);
    }, 460);
  };

  onbSay = (msg, delay) => {
    clearTimeout(this.onbT);
    this.setState({ onbTyping: msg.who || "shane" });
    const dur = delay || Math.min(2000, 600 + (msg.text || "").length * 8);
    this.onbT = setTimeout(() => {
      this.setState(st => ({ onbTyping: null, onb: (st.onb || []).concat([msg]) }), () => {
        if (this.onbEl) requestAnimationFrame(() => { this.onbEl.scrollTop = this.onbEl.scrollHeight; });
      });
    }, dur);
  };
  onbAll = (msgs) => {
    let i = 0;
    const next = () => {
      if (i >= msgs.length) return;
      const m = msgs[i++];
      this.setState({ onbTyping: m.who || "shane" });
      const dur = Math.min(2000, 600 + (m.text || "").length * 8);
      this.onbT = setTimeout(() => {
        this.setState(st => ({ onbTyping: null, onb: (st.onb || []).concat([m]) }), () => {
          if (this.onbEl) requestAnimationFrame(() => { this.onbEl.scrollTop = this.onbEl.scrollHeight; });
          this.onbT = setTimeout(next, 320);
        });
      }, dur);
    };
    clearTimeout(this.onbT);
    next();
  };
  beginBriefing = () => {
    clearTimeout(this.timer);
    this.setState({ prelude: null, playing: false, beat: -1, intro: null,
      introStage: "arriving", introArrived: [], introHeard: [], introSpeaking: null, focus: null },
      this.startArrivals);
  };
  // the prelude dissolves rather than cutting to the room

  startOnb = () => {
    if (this.onbStarted) return;
    this.onbStarted = true;
    setTimeout(() => this.onbAll([
      { who: "shane", text: "Morning. I'm Shane McCaw — I run Microsoft 365 architecture at NASA, and I wrote the governance framework the agency distributed. Today I'm doing something simpler: showing you your own tenant." },
      { who: "shane", card: "intro" },
      { who: "shane", text: "Before I scan anything, I need to know who actually works in here. Not job titles on an org chart — the people whose day would change. Which group do you want to start with?", pick: "cluster" }
    ]), 400);
  };
  pickCluster = (name) => {
    const c = PERSONA_CATALOG.find(x => x.cluster === name);
    this.setState(st => ({ onb: (st.onb || []).concat([{ who: "you", text: name }]), onbCluster: name }));
    setTimeout(() => this.onbAll([
      { who: "shane", text: c.desc + ". That is where most of the exposure tends to sit in an organisation like yours. Which of these roles are real in your tenant?" },
      { who: "shane", card: "personas" }
    ]), 300);
  };
  pickPersona = (p) => {
    this.setState(st => {
      const cur = st.onbPicked || [];
      return { onbPicked: cur.indexOf(p) >= 0 ? cur.filter(x => x !== p) : cur.concat([p]) };
    });
  };
  confirmPersonas = () => {
    const picked = this.state.onbPicked || [];
    if (!picked.length) return;
    const c = PERSONA_CATALOG.find(x => x.cluster === this.state.onbCluster);
    const first = c.personas.find(x => picked.indexOf(x.p) >= 0);
    this.setState(st => ({ onb: (st.onb || []).concat([{ who: "you", text: picked.join(", ") }]) }));
    setTimeout(() => this.onbAll([
      { who: "shane", text: "Good. " + first.p + " is the one I'd watch. " + first.d + " — and every one of those tasks depends on finding the right document, which is exactly where this usually falls apart." },
      { who: "shane", card: "outcomes" },
      { who: "shane", text: "Now twelve questions. They shape which findings I lead with — they do not change what the scan measures.", q: 0 }
    ]), 300);
  };
  answerQ = (i, opt) => {
    const q = WIZ_QUESTIONS[i];
    this.setState(st => ({
      wizAnswers: Object.assign({}, st.wizAnswers, { [q.id]: opt }),
      onb: (st.onb || []).concat([{ who: "you", text: opt }])
    }));
    const last = i >= WIZ_QUESTIONS.length - 1;
    setTimeout(() => {
      if (last) {
        this.onbAll([
          { who: "shane", text: "That is everything I need. I'm going to run the scan now — read-only, no agent, nothing written to your tenant." },
          { who: "shane", card: "scan" }
        ]);
        setTimeout(() => this.runScan(), 2600);
      } else {
        this.onbSay({ who: "shane", q: i + 1 });
      }
    }, 300);
  };

  wizNext = () => {
    const s = this.state;
    if (s.prelude === "welcome") { this.setState({ prelude: "personas" }); return; }
    if (s.prelude === "personas") { this.setState({ prelude: "questions", wizStep: 0 }); return; }
    if (s.prelude === "questions") {
      if (s.wizStep < WIZ_QUESTIONS.length - 1) { this.setState({ wizStep: s.wizStep + 1 }); return; }
      this.setState({ prelude: "scan", scanStep: 0 }, this.runScan);
      return;
    }
  };
  wizBack = () => {
    const s = this.state;
    if (s.prelude === "questions" && s.wizStep > 0) { this.setState({ wizStep: s.wizStep - 1 }); return; }
    if (s.prelude === "questions") { this.setState({ prelude: "personas" }); return; }
    if (s.prelude === "personas") { this.setState({ prelude: "welcome" }); return; }
  };
  wizSkip = () => { clearTimeout(this.scanT); this.setState({ prelude: null, scanStep: SCAN_PHASES.length, playing: false, intro: null, introStage: "arriving", introArrived: [], introHeard: [], focus: null }, this.startArrivals); };
  simulateScan = () => {
    clearTimeout(this.scanT);
    // run the pillar scan in place, on the page the customer is already on
    clearInterval(this.simT);
    this.setState({ heroDone: 0, heroRunning: true }, this.heroFeedTick);
    this.simT = setInterval(() => {
      this.setState(st => {
        const n = (st.heroDone || 0) + 1;
        if (n >= 7) { clearInterval(this.simT); return { heroDone: 7, heroRunning: false }; }
        return { heroDone: n };
      });
    }, 2600);
  };
  togglePersona = (id) => this.setState(st => ({
    wizPersonas: st.wizPersonas.indexOf(id) >= 0 ? st.wizPersonas.filter(x => x !== id) : st.wizPersonas.concat([id])
  }));
  answer = (qid, opt) => this.setState(st => ({ wizAnswers: Object.assign({}, st.wizAnswers, { [qid]: opt }) }));
  runScan = () => {
    clearTimeout(this.scanT);
    this.setState({ scanStart: Date.now() });
    clearInterval(this.scanClock);
    this.scanClock = setInterval(() => { if (this.state.prelude === "scan") this.forceUpdate(); }, 1000);
    const step = () => {
      const n = (this.state.scanStep || 0) + 1;
      if (n > SCAN_PHASES.length) {
        clearInterval(this.scanClock);
        this.setState({ scanStep: SCAN_PHASES.length });
        this.onbSay({ who: "shane", text: "Scan complete. Nine documents generated, twenty-four findings on the register, and the room is ready when you are.", done: true });
        return;
      }
      this.setState({ scanStep: n });
      // longer on the heavy passes so the pacing reads like a real tenant crawl
      const heavy = n >= 3 && n <= 8;
      this.scanT = setTimeout(step, heavy ? 2200 : 1200);
    };
    this.scanT = setTimeout(step, 700);
  };
  enterRoom = () => { clearTimeout(this.scanT); clearInterval(this.scanClock); this.setState({ prelude: null, playing: false, intro: null, introStage: "arriving", introArrived: [], introHeard: [], focus: null }, this.startArrivals); };

  applyChange = (id, on) => {
    const c = CHANGES[id];
    if (!c) return;
    this.setState(st => ({ changes: Object.assign({}, st.changes, { [id]: on === undefined ? !st.changes[id] : !!on }) }));
  };

  changeState = () => {
    const on = this.state.changes || {};
    const acc = { gov: 0, ready: 0, sec: 0, sites: 0, docs: 0, guests: 0, labelled: 0, list: [] };
    Object.keys(CHANGES).forEach(k => {
      if (!on[k]) return;
      const c = CHANGES[k];
      acc.gov += c.gov || 0; acc.ready += c.ready || 0; acc.sec += c.sec || 0;
      acc.sites += c.sites || 0; acc.docs += c.docs || 0; acc.guests += c.guests || 0; acc.labelled += c.labelled || 0;
      acc.list.push(c);
    });
    return acc;
  };

  // "turn on CA01" typed in the chat toggles the change and reports the movement
  parseChange = (q) => {
    const wantsOff = /turn off|disable|switch off|remove/i.test(q);
    const wantsOn = /turn on|enable|switch on|apply|activate|let'?s do|do it/i.test(q);
    if (!wantsOn && !wantsOff) return null;
    const hit = Object.keys(CHANGES).find(k => CHANGES[k].match.test(q));
    if (!hit) return null;
    // "turn off EEEU" is the remediation, not the reversal
    const on = hit === "eeeu" || hit === "anonoff" ? true : !wantsOff;
    return { id: hit, on: on };
  };

  changeCard = (id, on) => {
    const c = CHANGES[id];
    const before = this.changeState();
    this.applyChange(id, on);
    const after = { gov: before.gov + (on ? (c.gov || 0) : -(c.gov || 0)), ready: before.ready + (on ? (c.ready || 0) : -(c.ready || 0)) };
    const govNow = Math.min(89, GOV_BASE.score + before.gov);
    const govThen = Math.min(89, GOV_BASE.score + after.gov);
    const readyNow = Math.min(64, 34 + before.ready);
    const readyThen = Math.min(64, 34 + after.ready);
    return {
      title: (on ? "Applied — " : "Reverted — ") + c.label,
      what: (on ? "Done. " : "Rolled back. ") + c.note + " The telemetry board on the right is now showing the projected position, not the measured one.",
      why: "This is a model, not a change to your tenant. Nothing has been written — but every number here is what the scan says would happen if you made it.",
      before: [["Governance pillar", String(govNow)], ["Copilot readiness", readyNow + "%"], ["Changes staged", String(before.list.length)], ["Written to tenant", "no"]],
      after: [["Governance pillar", String(govThen)], ["Copilot readiness", readyThen + "%"], ["Changes staged", String(before.list.length + (on ? 1 : -1))], ["Written to tenant", "no"]],
      score: ["Governance pillar", String(govNow), String(govThen)],
      score2: ["Copilot readiness", readyNow + "%", readyThen + "%"],
      fixKey: id,
      note: "Governance work alone caps that pillar at 89 and Copilot readiness at 64% — licensing, adoption, compliance, health and security still gate a tenant-wide go-live at 75%.",
      asks: ["Can we fix this ourselves?", "What does it block?", "Show me the objects behind this"]
    };
  };

  heroSeed = () => {
    if (this.heroSeeded) return;
    this.heroSeeded = true;
    this.setState({ heroThread: [
      { who: "shane", text: "Hey — how's it going? I'm Shane. Glad you're here." },
      { who: "shane", text: "First, let me tell you a bit about me and how I work." },
      { who: "shane", profile: true }
    ], heroPhase: 0 });
    clearTimeout(this.heroPhaseT);
    this.heroPhaseT = setTimeout(() => this.heroPushPhase(0), 1400);
  };

  heroSmartSet = [
    { k: "go", l: "Nice to meet you — let's get started" },
    { k: "nasa", l: "What did you actually do at NASA?" },
    { k: "read", l: "What exactly will you read in my tenant?" },
    { k: "why", l: "Why does Copilot need an assessment at all?" },
    { k: "long", l: "How long does this take?" }
  ];

  heroSmartAnswer = {
    nasa: ["I was the lead M365 architect for the agency's Copilot programme — the largest federal deployment to date.", "The part that mattered wasn't the rollout. It was proving, before a single licence was assigned, that Copilot couldn't surface something it shouldn't. That framework is what we're going to run against your tenant."],
    read: ["Permissions, sharing links, labels, licence assignment, device compliance and service health — about 150 endpoints, all read-only.", "I never read the contents of your documents. I read who can reach them. That distinction is the whole assessment."],
    why: ["Because Copilot doesn't create exposure — it surfaces what already exists, instantly, with a citation.", "Anything overshared today becomes findable the moment you turn it on. So the question isn't whether Copilot works. It's whether your tenant is ready for it to work."],
    long: ["The scan itself takes a few minutes. This conversation takes about four.", "By the end you'll have seven pillar scores, a findings register and a statement of work — all built from your own data."]
  };

  heroSmart = (k) => {
    const chip = this.heroSmartSet.find(c => c.k === k);
    this.setState(st => ({
      heroThread: (st.heroThread || []).filter(m => !m.chips).concat([{ who: "you", text: chip ? chip.l : "" }])
    }), () => {
      if (k === "go") {
        clearTimeout(this.heroSmartT);
        this.heroSmartT = setTimeout(() => this.setState(st => ({
          heroThread: (st.heroThread || []).concat([{ who: "shane", text: "Likewise. And I promise this is the least painful meeting anyone will book you into this quarter — I do the reading, you do the talking." }])
        })), 420);
        this.heroSmartT2 = setTimeout(() => this.setState(st => ({
          heroThread: (st.heroThread || []).concat([{ who: "shane", text: "So — tell me, what industry are you in?", q: true }])
        })), 1900);
        return;
      }
      const lines = this.heroSmartAnswer[k] || [];
      let i = 0;
      const push = () => {
        if (i >= lines.length) {
          this.heroSmartT = setTimeout(() => this.setState(st => ({
            heroThread: (st.heroThread || []).concat([{ who: "shane", chips: true, asked: true }])
          })), 460);
          return;
        }
        const line = lines[i++];
        this.setState(st => ({ heroThread: (st.heroThread || []).concat([{ who: "shane", text: line }]) }));
        this.heroSmartT = setTimeout(push, 900 + line.length * 8);
      };
      clearTimeout(this.heroSmartT);
      this.heroSmartT = setTimeout(push, 420);
    });
  };

  heroPushPhase = (i) => {
    const p = HERO_PHASE[i];
    if (!p) return;
    this.setState(st => ({ heroThread: (st.heroThread || []).concat([{ who: "scan", phase: i }]), heroPhase: i }));
  };

  heroRunScan = () => {
    this.setState({ heroScan: { i: 0 } });
    const step = () => {
      const sc = this.state.heroScan;
      if (!sc || sc.i >= HERO_SCAN.length) return;
      this.heroScanT = setTimeout(() => {
        this.setState(st => ({ heroScan: { i: (st.heroScan ? st.heroScan.i : 0) + 1 } }), step);
      }, 1500 + Math.random() * 900);
    };
    step();
  };

  ARRIVE = ["shane", "jane", "priya", "marcus"];

  startArrivals = () => {
    clearTimeout(this.arrT);
    const step = (i) => {
      if (i >= this.ARRIVE.length) {
        this.setState({ introStage: "pick" });
        return;
      }
      const k = this.ARRIVE[i];
      const it = INTRO.find(x => x.who === k);
      this.setState(st => ({
        introArrived: (st.introArrived || []).concat([k]),
        introSpeaking: k,
        focus: it ? it.focus : null
      }));
      this.arrT = setTimeout(() => step(i + 1), 3400);
    };
    step(0);
  };

  heroAnswer = (preset) => {
    const s = this.state;
    const i = s.heroQ || 0;
    const q = HERO_Q[i];
    const typed = typeof preset === "string" && preset
      ? preset
      : ((this.heroInput && this.heroInput.value) || s.heroDraft || "").trim();
    const picked = q && q.opts ? (s.heroPick || []) : [];
    const v = picked.length ? picked.concat(typed ? [typed] : []).join(" · ") : typed;
    if (!q || !v) return;
    const ans = Object.assign({}, s.heroAns || {});
    ans[q.id] = v;
    if (this.heroInput) this.heroInput.value = "";
    const last = i + 1 >= HERO_Q.length;
    const nq = HERO_Q[i + 1];
    this.setState(st => ({
      heroAns: ans, heroDraft: "", heroPick: [], heroQ: i + 1,
      heroDone: Math.max(st.heroDone || 0, i + 1),
      heroWrap: i + 1 >= HERO_Q.length ? true : (st.heroWrap || false),
      heroThread: (st.heroThread || []).concat([{ who: "you", text: v }])
    }), () => {
      clearTimeout(this.heroReplyT);
      this.heroReplyT = setTimeout(() => {
        this.setState(st => {
          const add = [{ who: "shane", text: q.r }];
          if (nq) {
            if (nq.lead) add.push({ who: "shane", text: nq.lead });
            add.push({ who: "shane", text: nq.q, q: true });
          } else {
            add.push({ who: "shane", wrap: true });
          }
          return { heroThread: (st.heroThread || []).concat(add) };
        }, () => {
          const nxt = i + 1;
          if (nxt < HERO_PHASE.length) { clearTimeout(this.heroPhaseT); this.heroPhaseT = setTimeout(() => this.heroPushPhase(nxt), 900); }
          if (last) this.setState({ heroFinished: true });
        });
      }, 620);
    });
  };

  govWalkTo = (key) => {
    const s = String(key);
    const band = s[0], i = Number(s.slice(1));
    const set = walkSet(s);
    const w = set[i];
    if (!w) {
      if (band === "c") this.govSayAll([
        { who: "shane", text: "That's the governance picture end to end. Nothing there is unusual for a tenant this size — what's unusual is being shown it before somebody sells you licences." },
        this.govPrompts[0]
      ]);
      else if (band === "a") this.govSay({
        who: "shane",
        text: "That's how our remediation team reads the same estate. Governance is covered — findings documented, owners named, and everything you staged is in the statement of work. Are you ready to move on to licensing?",
        back: "a0",
        actions: [["Yes — move on to licensing", "tolicensing"], ["I have questions first", "ask"]]
      });
      else this.govSayAll([
        { who: "shane", text: "That's the machinery. Every figure in this dialog is reproducible by your own team with the same read-only queries." },
        this.govPrompts[2]
      ]);
      return;
    }
    const nxt = set[i + 1];
    const nextActions = nxt ? [["Next — " + nxt.title, "walk:" + band + (i + 1)], ["Ask about this", "ask"]]
                            : band === "c"
                              ? [["Ready for the analyst review?", "next"], ["Ask about this", "ask"]]
                              : [["Yes — move on to " + ((DIVE_CFG[this.state.dive] || DIVE_CFG.governance).nextLabel), "tolicensing"], ["I have questions first", "ask"]];
    const card = { who: w.who || (i === 2 ? "beth" : i === 3 ? "kirk" : "shane"), text: "", walk: s, lead: w.lead };
    this.setState({ govAt: s });
    this.govSay(Object.assign(card, { actions: nextActions }));
  };

  helpFor = (key) => {
    const k = String(key || "");
    if (this.govControlHelp[k]) return this.govControlHelp[k];
    if (k.indexOf("sig:") === 0) return this.govSignalHelp[k.slice(4)];
    if (k.indexOf("doc:") === 0) {
      const d = this.govDocHelp[k.slice(4)];
      if (!d) return null;
      const e = (this.docExplainByPillar[this.state.dive] || {})[k.slice(4)] || this.docExplain[k.slice(4)] || {};
      return { title: d.title, what: e.what || "", why: e.why || "", before: d.before, after: d.after, note: d.note };
    }
    return null;
  };

  govDocHelp = {
    sum: { title: "Executive summary", before: [["Copilot readiness", "34%"], ["Deployment gate", "75%"], ["Blocking pillars", "3"], ["Licences required today", "0"]], after: [["Copilot readiness", "64%"], ["Deployment gate", "75%"], ["Blocking pillars", "0"], ["Licences required", "400 pilot"]], note: "The gap is permissions, not purchasing. Nothing in this summary is solved by buying seats." },
    sp: { title: "Overshared SharePoint sites", before: [["Sites over threshold", "41"], ["Files reachable", "214,806"], ["Top-3 share of exposure", "78%"], ["Sites with an owner", "40"]], after: [["Sites over threshold", "0"], ["Files reachable", "18,240"], ["Top-3 share of exposure", "0%"], ["Sites with an owner", "1,204"]], note: "Three sites carry most of it, so the work is far smaller than the headline number suggests." },
    teams: { title: "Teams with public channels", before: [["Teams with public channels", "17"], ["Anonymous links", "23"], ["Files behind them", "38,600"], ["Link expiry", "none"]], after: [["Teams with public channels", "2"], ["Anonymous links", "0"], ["Files behind them", "3,400"], ["Link expiry", "30 days"]], note: "Converting to private is the lowest-effort, highest-signal fix in the report." },
    od: { title: "OneDrive external shares", before: [["Accounts sharing externally", "48"], ["Unlabelled files exposed", "61,000"], ["Oldest active link", "3 years"], ["Audit trail", "none"]], after: [["Accounts sharing externally", "12"], ["Unlabelled files exposed", "4,200"], ["Oldest active link", "90 days"], ["Audit trail", "per share"]], note: "Anonymous links have no identity behind them, so there is nothing to revoke when someone leaves." },
    links: { title: "Org-wide link ledger", before: [["Org-wide links", "41"], ["Links older than 12 months", "68%"], ["Owner has left", "31"], ["Expiry policy", "none"]], after: [["Org-wide links", "0"], ["Links older than 12 months", "0"], ["Owner has left", "0"], ["Expiry policy", "30 / 90 days"]], note: "This is the single biggest lever in the engagement — two weeks, run by your own admins." },
    ai: { title: "AI analysis — what Copilot returned", before: [["Prompts run", "3"], ["Returned regulated content", "3 of 3"], ["Elevated rights needed", "none"], ["Citations attached", "yes"]], after: [["Prompts run", "3"], ["Returned regulated content", "0 of 3"], ["Elevated rights needed", "none"], ["Citations attached", "yes"]], note: "These were run this morning with a test identity holding no special privileges. It is evidence, not a risk model." },
    path: { title: "Exposure path", before: [["Steps in the chain", "5"], ["Controls applied today", "0 of 5"], ["Break points available", "5"], ["Time to citation", "seconds"]], after: [["Steps in the chain", "5"], ["Controls applied", "4 of 5"], ["Break points closed", "first two"], ["Time to citation", "n/a"]], note: "You can break this at step one or step three. You cannot break it at step five." },
    fix: { title: "Self-resolution actions", before: [["Playbooks", "5"], ["Requires professional services", "no"], ["Total elapsed", "6 weeks"], ["Governance pillar", "34"]], after: [["Playbooks complete", "5"], ["Requires professional services", "no"], ["Total elapsed", "6 weeks"], ["Governance pillar", "89"]], note: "Written so your team can run it without us. What we sell is sequencing and evidence, not access to the steps." },
    why: { title: "Why this matters", before: [["Governance pillar", "34"], ["Sites in ungoverned reach", "41"], ["Regulated files citable", "40,480"], ["Gate cleared", "no"]], after: [["Governance pillar", "89"], ["Sites in ungoverned reach", "0"], ["Regulated files citable", "1,120"], ["Gate cleared", "yes"]], note: "Governance is not a blocker to Copilot — it decides whether Copilot is an asset or a liability." }
  };

  docExplainByPillar = {
    adoption: {
      sum: { who: "marcus", what: "The one-paragraph version: you have the usage base for Copilot to work and none of the scaffolding that makes it stick.", why: "87% of seats touch Teams every day. That is a strong foundation — but foundations do not create habits, and nothing in this tenant currently does." },
      personas: { who: "jane", what: "These are your real role cohorts and how ready each one is to be handed a seat.", why: "The largest cohort is the least ready, because clinicians work inside the PHI boundary that is not yet labelled. Pilot selection by volunteer would pick exactly the wrong people." },
      teams: { who: "marcus", what: "Your Teams and meeting signal — the raw material Copilot recaps against.", why: "Only 22% of meetings are transcribed, and transcription is off by default at tenant level. Without a transcript there is nothing to recap, so the highest-frequency use case simply does not fire." },
      flows: { who: "marcus", what: "The workflows where Copilot returns measurable time, ranked by hours rather than by enthusiasm.", why: "Routine documentation is 3.5 hours a week per person. That is where the money is — and it depends on labelled content, so adoption is gated by governance rather than by training." },
      noflows: { who: "beth", what: "What Copilot will not fix, named plainly.", why: "Naming the limits is what keeps the programme credible. Every one of these came from your own people during the briefing, not from us." },
      gaps: { who: "jane", what: "The enablement gaps between owning a licence and using it.", why: "Zero champions and one generic deck for four very different roles. A pilot launched like this typically decays under 20% active by week six." },
      fix: { who: "marcus", what: "The enablement playbooks — role tracks, champions, prompt libraries and the measurement that proves it worked.", why: "None of this needs professional services. What it needs is an owner, which is the one thing adoption does not currently have." },
      why: { who: "shane", what: "Why adoption decides the return.", why: "Licences are a cost the day you buy them. Adoption is the only thing that turns them into hours, and it is the pillar most often left to chance." }
    },
    licensing: {
      sum: { who: "shane", what: "The one-paragraph version: you are paying for capability nobody holds, and withholding it from the people who would return the most.", why: "Both halves are measurable and both are fixable inside a single billing cycle without new spend." },
      sku: { who: "marcus", what: "Users whose SKU does not match ninety days of measured workload use.", why: "Fit is assigned on job title rather than on use. Over-licensing is money; under-licensing is a person who cannot do the thing you are about to buy Copilot for." },
      over: { who: "shane", what: "Copilot seats that are not earning.", why: "Three of twenty-five sit with users who have logged zero sessions in ninety days. One should be held back deliberately — that person works in unlabelled compensation files." },
      need: { who: "shane", what: "The cohorts carrying the highest modelled return that hold no Copilot licence.", why: "Each of these is already inside a labelled content boundary or one step from it, which is what makes them the right pilot population." },
      drift: { who: "marcus", what: "How the licence position drifts between renewals.", why: "38% of seats are assigned directly rather than by group, so every joiner, mover and leaver is a manual step somebody can miss." },
      waste: { who: "shane", what: "The cost position, stated as money rather than as seats.", why: "Right-sizing alone funds the Copilot pilot four times over. This is a reallocation conversation, not a budget request." },
      fix: { who: "shane", what: "The correction playbooks, in the order they should run.", why: "The saving only lands if the purchased count is reduced at renewal — removing an assignment on its own changes nothing on the invoice." },
      why: { who: "shane", what: "Why licensing comes before everything else.", why: "It is where the programme pays for itself before it delivers anything, which is what makes the rest of the conversation possible." }
    }
  };

  // Shane reads a section of the report back in plain language
  docExplain = {
      sum: { who: "shane", what: "This is the one-paragraph version your board will read. It says Copilot cannot be turned on tenant-wide yet, and it names the reason: permissions, not licensing.", why: "It matters because the licensing conversation and the readiness conversation get conflated constantly. You can buy every seat tomorrow and still be blocked by this.", so: "If you only read one section, read this one — everything below is the evidence for it." },
      sp: { who: "jane", what: "These are your actual SharePoint sites with an org-wide or EEEU grant on them, ranked by how many files sit behind that grant.", why: "Every file in these libraries is already retrievable by any licensed account. Copilot doesn't widen access — it just makes what's already open trivially findable.", so: "The top three sites account for the bulk of the exposure, so remediation is far smaller than the headline number suggests." },
      teams: { who: "jane", what: "Teams with public channels, and the files those channels carry. A public channel means every member of the tenant, not just the team.", why: "Teams sprawl is the quiet one — nobody creates a public channel intending it to be public forever, but nobody closes it either.", so: "Converting these to private is a low-effort, high-signal fix, and it moves your readiness number immediately." },
      od: { who: "jane", what: "OneDrive accounts with active external shares, and whether the recipient is a managed guest or an anonymous link.", why: "Anonymous links have no identity behind them, which means no audit trail and no revocation path when someone leaves.", so: "These should be time-bound at minimum. Most of them are years old." },
      links: { who: "shane", what: "The org-wide link ledger — every 'anyone in the organisation' link, when it was created, and by whom.", why: "This is the single biggest lever on the board. Closing these moves Copilot readiness further than anything else in the report.", so: "It's also the one your own admins can run this week without professional services." },
      ai: { who: "shane", what: "These are real Copilot responses, run against your tenant this morning with a test identity that has no special privileges.", why: "This is the proof. It isn't a hypothetical risk model — it's what a first-line employee would get back on day one.", so: "Show this section to anyone who says the exposure is theoretical." },
      path: { who: "kirk", what: "The five steps between a file sitting in a library and that file appearing as a cited answer in someone's chat window.", why: "Understanding the chain is what tells you where to intervene. You can break it at step one or step three — you cannot break it at step five.", so: "Everything in the remediation plan targets one of these five steps." },
      why: { who: "shane", what: "The closing argument — what changes when the work above is done.", why: "It converts the report from a list of problems into a decision: this is what the governance pillar looks like at 89 instead of 34.", so: "That number is the gate. Everything else in the engagement is sequencing to reach it." },
      fix: { who: "shane", what: "The remediation playbooks — each one with the actual admin-center or PowerShell steps, an effort estimate and an owner.", why: "These are written so your team can run them without us. Nothing here is proprietary.", so: "If you want to do this yourselves, this section is the whole engagement in written form." }
  };

  explainSection = (id, heading) => {
    const byP = this.docExplainByPillar[this.state.dive] || {};
    const map = Object.assign({}, this.docExplain, byP);
    const e = map[id] || { who: "shane", what: "This section documents what the scan found for " + heading.toLowerCase() + ", with the underlying objects listed so your team can verify every number independently.", why: "Every figure in the report traces back to a Graph query you can re-run yourselves.", so: "Ask me about any row in it and I'll pull the objects behind it." };
    this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: "Explain " + heading }]) }));
    clearTimeout(this.explT);
    const card = this.govDocHelp[id];
    this.explT = setTimeout(() => this.govSayAll([
      { who: e.who, text: e.what + " " + e.why, help: card ? "doc:" + id : null },
      { who: "shane", text: e.so }
    ]), 280);
  };

  licOpening = [
    { who: "shane", text: "Licensing is the shortest conversation in this assessment and the one that funds everything else. All of it came from your own subscription and usage data this morning." },
    { who: "shane", text: "", walk: "c0", lead: "Let me walk it the way I'd present it to a CFO — five topics, in the order they matter. " + LIC_WALK[0].lead,
      actions: [["Next — Licence Fit", "walk:c1"], ["Ask about this", "ask"]] }
  ];

  heroFeedTick = () => {
    if (this.heroTickT) return;
    this.heroTickT = setInterval(() => {
      if (this.state.prelude == null) { clearInterval(this.heroTickT); this.heroTickT = null; return; }
      this.setState(st => ({ heroTick: (st.heroTick || 0) + 1 }));
    }, 1100);
  };

  startGovThread = () => {
    if (this.govStarted) return;                       // a re-render must never restart the chain
    if ((this.state.govThread || []).length) return;   // never restart a live conversation
    this.govStarted = true;
    clearTimeout(this.govT1);
    const script = this.state.dive === "licensing" ? this.licOpening
      : this.state.dive === "adoption" ? this.adoOpening
      : this.state.dive === "compliance" ? this.cmpOpening
      : this.state.dive === "health" ? this.hltOpening
      : this.state.dive === "security" ? this.secOpening
      : this.state.dive === "copilot" ? this.cplOpening
      : this.state.dive === "sow" ? this.sowOpening
      : this.state.dive === "docs" ? this.docsOpening : this.govOpening;
    this.govT1 = setTimeout(() => this.govSayAll(script), 220);
  };

  // Jane answers governance questions; Shane answers strategy. Both cite the rollup.
  govAsk = (raw) => {
    const q = (raw || "").trim();
    if (!q) return;
    const l = q.toLowerCase();
    // signals that deserve a real document list rather than a paragraph
    const docKey = /ground on|no owner|documents copilot|copilot can see|groundable/.test(l) ? "docs"
      : /label|classif|unlabelled|unlabeled|sensitivity/.test(l) ? "labels"
      : /guest|external account|external identit/.test(l) ? "guests" : null;
    if (docKey) {
      this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: q }]), govDraft: "" }));
      clearTimeout(this.govChatT);
      this.govChatT = setTimeout(() => this.govShowDocs(docKey), 260);
      return;
    }
    const strategic = /shane|cost|budget|roi|timeline|when|sequence|plan|phase|worth|decide|recommend|sow|contract/.test(l);
    const who = strategic ? "shane" : "jane";
    let a;
    if (/biggest|worst|sharpest|priority/.test(l))
      a = "Flight Ops – Mission Docs. 41,208 files, EEEU edit, no label. It is the single largest reachable surface in your tenant and the first thing Copilot would ground on.";
    else if (/index|first|ground/.test(l))
      a = "Copilot indexes by reachability, not importance. The eight sites on the exposure list come first because every internal account already resolves against them — 214,806 files before it touches anything governed.";
    else if (/org-wide|link|dangerous/.test(l))
      a = "41 sites publish them, 23 of those links are anonymous with no expiry, and 68% are over a year old. An org-wide link is not a share; it is a standing grant that outlives the project that created it.";
    else if (/sensitive|regulated|phi|confidential|exposed/.test(l))
      a = "Executed MSAs in Contracts & Legal, payroll drafts in HR – People Ops, and remittance PDFs with member IDs in a personal OneDrive. All three are reachable today, and none carries a sensitivity label.";
    else if (/readiness|improve|fix|how much|score/.test(l))
      a = strategic
        ? "Closing governance moves the pillar from 34 to 89 and lifts overall readiness by roughly 11 points. It is six weeks of work, and it is the gate every other pillar waits behind."
        : "Removing the org-wide links alone takes governance from 34 to about 71. Add label enforcement and guest expiry and it clears 89 — which is the level where restricted grounding is safe.";
    else if (/guest|external/.test(l))
      a = "612 guest identities hold standing access with no re-attestation. A 90-day expiry with owner approval clears 268 of them on the first cycle without a single conversation.";
    else if (/label|classif/.test(l))
      a = "22% of reachable content carries no label, and inheritance is off at provisioning — so the estate degrades every week this stays open. A grounded answer inherits its source's classification; an unlabelled source produces an unclassified answer.";
    else if (strategic)
      a = "Governance is first in the sequence because it is the only pillar that changes what Copilot can reach. Licences and adoption change what it costs and who uses it — this one changes whether it is safe.";
    else
      a = "Everything on this board came out of your tenant this morning, read-only. Pick any rollup number and I will show you the objects behind it, or ask me what Copilot would infer from a specific site.";
    this.setState(st => ({
      govThread: (st.govThread || []).concat([{ who: "you", text: q }]),
      govDraft: ""
    }));
    const ch = this.parseChange(q);
    if (ch) {
      const card = this.changeCard(ch.id, ch.on);
      this.setState(st => ({ govThread: (st.govThread || []).concat([{ who: "you", text: q }]), govDraft: "" }));
      clearTimeout(this.govChatT);
      this.govChatT = setTimeout(() => this.govSay({ who: "shane", text: card.what, hobj: card, back: (this.state.govAt || "c0") }), 260);
      return;
    }
    const hobj = {
      title: "Answer — " + q.replace(/^explain\s+/i, "").slice(0, 60),
      what: a,
      why: "Every number I have used here came out of this morning's read-only scan. If you want the objects behind any of them, ask and I will put the list in this conversation.",
      before: [["Org-wide sites", "41"], ["Files reachable", "214,806"], ["Unlabelled regulated", "40,480"], ["Governance pillar", "34"]],
      after: [["Org-wide sites", "0"], ["Files reachable", "18,240"], ["Unlabelled regulated", "1,120"], ["Governance pillar", "89"]],
      fixKey: q,
      note: "Ask a harder question — the numbers hold up, and where they do not I will say so.",
      asks: ["Can we fix this ourselves?", "What does it block?", "Show me the objects behind this"]
    };
    clearTimeout(this.govChatT);
    this.govChatT = setTimeout(() => this.govSay({ who, text: a, hobj: hobj, back: (this.state.govAt || "c0") }), 260);
  };

  runGovPreview = () => {
    const list = this.govList(this.state.govTab);
    const site = list.find(x => x.id === this.state.govSel) || list[0];
    if (this.govT) clearTimeout(this.govT);
    this.setState({ govSel: site.id, govPreview: { stage: 0, site: site.id } });
    this.govT = setTimeout(() => {
      this.setState(st => (st.govPreview ? { govPreview: { stage: 1, site: site.id } } : null));
      this.govT = setTimeout(() => {
        this.setState(st => (st.govPreview ? { govPreview: { stage: 2, site: site.id } } : null));
      }, 1500);
    }, 1400);
  };

  // pull tenant facts out of a spoken line so they can be shouted, not muttered
  callouts(text) {
    if (!text) return [];
    const WORDNUM = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)(?:-(?:one|two|three|four|five|six|seven|eight|nine))?";
    // countable things this tenant actually has — a spelled number only shouts when one follows
    const NOUN = "(?:channels?|sites?|seats?|licen[cs]es?|devices?|endpoints?|admins?|accounts?|links?|mailboxes|messages|files?|documents?|folders?|libraries|records?|sessions?|tickets?|alerts?|guests?|users?|policies|polic(?:y|ies)|classifiers?|champions?|runbooks?|teams|hours?|weeks?|points?|pts)";
    // things whose ABSENCE is a finding
    const TERM = "(?:DLP|labels?|sensitivity labels?|session polic(?:y|ies)|conditional access|champions?|runbooks?|transcripts?|owners?|expiry|retention|baseline|inheritance|governance|evidence|egress|encryption)";
    const RE = new RegExp(
      "(\\$?\\d[\\d,.]*\\s?(?:%|percent|pts?|points|hrs?\\/wk|hours|\\/mo|\\/yr|K|M)?(?:\\s+(?:of\\s+)?[A-Za-z][\\w-]*){0,3}" +
      "|\\b" + WORDNUM + "(?:-" + WORDNUM + ")?(?:\\s+" + WORDNUM + ")?\\s+" + NOUN +
      "|\\b(?:No|no|Zero|zero|None|none|nobody|never)\\s+(?:\\w+\\s+){0,1}" + TERM +
      "|\\bEEEU\\b|\\bDLP\\b|\\bsensitivity labels?\\b|\\borg-wide\\b|\\bconditional access\\b|\\banonymous links?\\b)", "gi");
    const out = [];
    let last = 0, m;
    while ((m = RE.exec(text)) !== null) {
      const raw = m[0].replace(/[\s,.;:]+$/, "");
      if (!raw) continue;
      // ignore bare small ordinals and stopword tails that add no weight
      if (/^\d{1,2}$/.test(raw) && !/^\d+%$/.test(raw)) continue;
      const start = m.index, end = start + raw.length;
      if (start > last) out.push({ big: false, v: text.slice(last, start) });
      out.push({ big: true, v: raw });
      last = end;
    }
    if (last < text.length) out.push({ big: false, v: text.slice(last) });
    return out.length ? out : [{ big: false, v: text }];
  }

  renderVals() {
    const s = this.state;
    const g = this.geom();
    const beat = s.beat >= 0 ? SCRIPT[s.beat] : null;
    const inj = s.injected;
    const speaker = inj ? inj.who : (beat && !s.userLine ? beat.who : null);
    const currentLine = inj ? inj.text : (beat ? beat.text : "");
    const focusNode = inj ? inj.focus : s.focus;
    const activeTopic = (beat && beat.chain && !inj) ? "riskchain" : (TOPIC_FOR[focusNode] || "copilotready");
    const focusPillar = focusNode ? (NODES.find(n => n.id === focusNode) || {}).pillar : null;

    const nodes = NODES.map(n => {
      const st = s.statuses[n.id], c = STATUS[st].color;
      const isFocus = focusNode === n.id;
      const dim = !this.matches(n);
      return {
        id: n.id, label: n.label, metric: n.metric, statusLabel: STATUS[st].label, color: c,
        left: g.pts[n.id].x + "px", top: g.pts[n.id].y + "px",
        scale: isFocus ? 1.12 : 1,
        opacity: dim ? 0.2 : isFocus ? 1 : 0.94,
        border: isFocus ? c + "cc" : st === "healthy" ? "rgba(51,65,85,.55)" : c + "55",
        bg: isFocus ? "rgba(2,6,23,.92)" : "rgba(2,6,23,.55)",
        glow: isFocus ? "0 0 0 1px " + c + "44, 0 0 26px " + c + "40" : "none",
        pulse: st === "healthy" ? "none" : "wr-pulse 2.4s ease-in-out infinite",
        onClick: () => this.setState({ selected: n.id })
      };
    });

    const isActive = (id) => focusPillar === id || (s.mood === "security" && id === "security") || (s.mood === "legal" && id === "compliance");

    const sectors = g.sectors.map(sec => {
      const active = isActive(sec.id);
      const worst = NODES.filter(n => n.pillar === sec.id).reduce((a, n) => {
        const st = s.statuses[n.id];
        return st === "alert" ? "alert" : st === "drift" && a !== "alert" ? "drift" : a;
      }, "healthy");
      return {
        path: sec.path, ring: sec.ring, label: sec.label, impact: sec.impact,
        fill: active ? sec.color + "33" : "rgba(23,42,72,.6)",
        stroke: active ? sec.color + "aa" : "rgba(71,105,150,.75)",
        ringFill: STATUS[worst].color + (active ? "ff" : "cc"),
        left: sec.lx + "px", top: sec.ly + "px",
        border: active ? sec.color + "88" : "rgba(51,65,85,.75)",
        bg: active ? sec.color + "1f" : "rgba(2,6,23,.85)",
        text: active ? sec.color : "#94a3b8",
        impactColor: STATUS[worst].color
      };
    });

    const pillars = PILLARS.map(p => {
      const active = isActive(p.id);
      return {
        label: p.label, color: p.color,
        left: g.pillarPts[p.id].x + "px", top: g.pillarPts[p.id].y + "px",
        border: active ? p.color + "99" : "rgba(51,65,85,.8)",
        bg: active ? p.color + "1f" : "rgba(2,6,23,.75)",
        text: active ? p.color : "#94a3b8",
        glow: active ? "0 0 26px " + p.color + "3d" : "none"
      };
    });

    const links = g.links.map(l => {
      const hot = (l.node && l.node === focusNode) || (!l.node && l.pillar === focusPillar);
      const chained = s.chain && ["dlp", "sharepoint", "purview"].indexOf(l.node) >= 0;
      const col = chained ? "#f87171" : hot ? "#38bdf8" : "#1e3a5f";
      return {
        d: this.curve(l.from, l.to),
        stroke: col,
        dot: chained ? "#fca5a5" : hot ? "#7dd3fc" : "#2563eb",
        width: hot || chained ? 1.8 : 1,
        opacity: hot || chained ? 0.95 : 0.5,
        dur: (2.4 + (l.id.length % 5) * 0.4).toFixed(1) + "s"
      };
    });

    const gate = (s.introStage === "arriving" || s.introStage === "pick" || s.introStage === "card") ? (s.introArrived || []) : null;
    const roster = ["jane", "priya", "marcus"].concat(s.joined).filter(k => !gate || gate.indexOf(k) >= 0);
    const seatPlan = this.computeSeats(roster);
    const focusPt = this.focusPoint(s);

    const persona = (key) => {
      const p = PERSONAS[key];
      const seat = seatPlan[key] || { x: parseFloat(p.seatX), y: parseFloat(p.seatY) };
      const place = this.bubblePos(seat, focusPt);
      const speaking = speaker === key;
      return {
        key, name: p.name, role: p.role, initials: p.initials, tile: p.tile, roleColor: p.color,
        seatX: seat.x.toFixed(1) + "%", seatY: seat.y.toFixed(1) + "%",
        bx: place.bx, by: place.by, bw: place.bw, btf: "none",
        bubL: "auto",
        bubR: p.side === "right" ? "calc(100% + 14px)" : "auto",
        bubT: p.side === "user" ? "auto" : "50%",
        bubB: p.side === "user" ? "calc(100% + 12px)" : "auto",
        bubTf: p.side === "user" ? "translateX(-50%)" : "translateY(-50%)",
        bubLeftAnchor: p.side === "user" ? "50%" : (p.side === "right" ? "auto" : "calc(100% + 14px)"),
        seatOpacity: speaking ? 1 : 0.88,
        avatarSize: speaking ? "74px" : "62px",
        slotId: "seat-" + key,
        photo: "avatars/" + key + ".png",
        roleShort: ({ shane: "Lead M365 Architect", jane: "Flight Controller", priya: "Research Scientist", marcus: "Support Team Lead", kirk: "Security Expert", beth: "Legal & Risk Advisor", user: "Participant" })[key] || p.role,
        badgeIcon: ({ shane: "M12 2 4 6v6c0 5 8 10 8 10s8-5 8-10V6z", jane: "M3 21h18M6 21V9l6-5 6 5v12", priya: "M9 3h6M10 3v6l-5 9a3 3 0 0 0 3 4h8a3 3 0 0 0 3-4l-5-9V3", marcus: "M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8", kirk: "M12 2 4 6v6c0 5 8 10 8 10s8-5 8-10V6z", beth: "M12 3v18M5 7l7-4 7 4M4 21h16M6 7l-3 7a3 3 0 0 0 6 0zM18 7l3 7a3 3 0 0 1-6 0z", user: "M12 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 22a8 8 0 0 1 16 0" })[key] || "M12 2 4 6v6c0 5 8 10 8 10s8-5 8-10V6z",
        roleCaption: speaking ? p.color : "rgba(148,163,184,.85)",
        first: p.name.split(" ").slice(-1)[0] === "You" ? "You" : p.name.replace("Dr. ", "").split(" ")[0],
        nameColor: speaking ? "#f8fafc" : "#e2e8f0",
        plateGlow: speaking ? "0 0 18px " + p.color + "66" : "none",
        seatGlow: speaking ? "0 0 0 4px " + p.color + "33, 0 0 42px " + p.color + "dd, 0 10px 26px rgba(0,0,0,.6)" : "0 0 20px " + p.color + "55, 0 6px 18px rgba(0,0,0,.55)",
        seatBorder: speaking ? p.color : p.color + "7a",
        seatFill: speaking ? p.color + "33" : "rgba(15,23,42,.75)",
        speaking, line: speaking ? currentLine : "",
        lineParts: (speaking ? this.callouts(currentLine) : []).map(x => ({
          v: x.v, display: "inline",
          size: x.big ? "16.5px" : "12.5px",
          weight: x.big ? "800" : "400",
          tracking: x.big ? "-.02em" : "0",
          color: x.big ? "#f8fafc" : "#cbd5e1",
          shadow: x.big ? "0 0 18px " + p.color + "88" : "none"
        })),
        bubbleAnim: s.exiting && !inj ? "wr-fall 280ms cubic-bezier(.22,1,.36,1) forwards" : "wr-rise 420ms cubic-bezier(.22,1,.36,1)",
        tailL: p.side === "left" ? "-5px" : p.side === "host" || p.side === "user" ? "50%" : "auto",
        tailR: p.side === "right" ? "-5px" : "auto",
        tailT: p.side === "host" ? "-5px" : p.side === "user" ? "auto" : "50%",
        tailB: p.side === "user" ? "-5px" : "auto",
        detailsLabel: (TOPICS[activeTopic] || TOPICS.copilotready).cta,
        progressAnim: (inj || s.beat % 2) ? "wr-progress-a" : "wr-progress-b",
        progressDur: (inj ? 6400 : this.speed) + "ms",
        progressState: s.playing ? "running" : "paused",
        onDetails: () => {
          clearTimeout(this.timer); clearTimeout(this.injTimer);
          this.setState({ topic: activeTopic, playing: false });
        },
        idle: speaking ? "wr-idle 3s ease-in-out infinite" : "none",
        border: speaking ? p.color + "88" : "rgba(30,41,59,.9)",
        bg: speaking ? "rgba(15,23,42,.9)" : "rgba(15,23,42,.55)",
        glow: speaking ? "0 0 0 1px " + p.color + "40, 0 0 30px " + p.color + "33" : "none",
        bubbleBorder: p.color + "4d",
        onClick: () => { clearTimeout(this.timer); clearTimeout(this.injTimer); this.setState({ persona: key === "user" ? "shane" : key, playing: false }); }
      };
    };

    const readinessTone = s.readiness >= 75 ? "#34d399" : s.readiness >= 60 ? "#fbbf24" : "#f87171";
    const chainStates = [
      { label: "DLP Gap", detail: "2 policies unscoped", active: s.chain },
      { label: "Data Exposure", detail: "41 org-wide links", active: s.chain },
      { label: "Financial Risk", detail: "Reportable under MSA", active: s.chain }
    ];

    const avg = s.logs.length ? Math.round(s.logs.reduce((a, l) => a + l.latency, 0) / s.logs.length) : 0;

    return {
      ambience: (() => {
        const key = s.dive && PILLAR_META[s.dive] ? s.dive : (focusPillar ? Object.keys(PILLAR_META).find(k => PILLAR_META[k].label === MAP_PILLAR[focusPillar]) : null);
        if (!key) return AMBIENCE[s.mood];
        const c = PILLAR_META[key].color;
        return "radial-gradient(ellipse 90% 70% at 50% 12%," + c + "3d, transparent 62%), radial-gradient(ellipse 120% 80% at 50% 108%," + c + "2b, transparent 66%), linear-gradient(180deg," + c + "14, rgba(2,6,23,0) 46%)";
      })(),
      pillarPulse: (() => {
        const key = s.dive && PILLAR_META[s.dive] ? s.dive : (focusPillar ? Object.keys(PILLAR_META).find(k => PILLAR_META[k].label === MAP_PILLAR[focusPillar]) : null);
        if (!key) return { bg: "transparent", base: "0", anim: "none", rim: "none", wash: "#020617" };
        // Security reads as the crimson signal in the room even though its node colour is Microsoft blue
        const c = key === "security" ? "#8B5CF6" : PILLAR_META[key].color;
        return {
          bg: "linear-gradient(180deg," + c + "3d," + c + "1f 46%," + c + "33), radial-gradient(ellipse 130% 90% at 50% 50%," + c + "40, transparent 72%)",
          base: "1", anim: "wr-roompulse 4.6s cubic-bezier(.22,1,.36,1) infinite",
          rim: "inset 0 0 260px " + c + "5c, inset 0 0 80px " + c + "3d",
          wash: c + "1f"
        };
      })(),
      pillarGhost: (() => {
        const key = s.dive && PILLAR_META[s.dive] ? s.dive : (focusPillar ? Object.keys(PILLAR_META).find(k => PILLAR_META[k].label === MAP_PILLAR[focusPillar]) : null);
        if (!key) return { show: false, label: "", color: "transparent" };
        return { show: true, label: PILLAR_META[key].label.toUpperCase(), color: key === "security" ? "#8B5CF6" : PILLAR_META[key].color };
      })(),
      tenantName: "Contoso Global",
      tenantId: "· 8f21-a4c9",
      query: s.query,
      onQuery: (e) => this.setState({ query: e.target.value }),
      statusFilters: [
        { id: "all", label: "All", dot: "#64748b" },
        { id: "drift", label: "Drift", dot: "#fbbf24" },
        { id: "alert", label: "Alert", dot: "#f87171" }
      ].map(f => ({
        label: f.label, dot: f.dot,
        border: s.filter === f.id ? "rgba(59,130,246,.55)" : "rgba(51,65,85,.8)",
        bg: s.filter === f.id ? "rgba(37,99,235,.16)" : "rgba(15,23,42,.6)",
        color: s.filter === f.id ? "#93c5fd" : "#94a3b8",
        onClick: () => this.setState({ filter: f.id })
      })),
      exports: ["SVG", "PNG", "JSON"].map(x => ({
        label: x,
        onClick: () => this.pushLog({ method: "POST", url: "https://warroom.shanemccaw.io/export/topology." + x.toLowerCase(), status: 200, latency: 120 + x.length * 9, text: x + " export ready" })
      })),

      readiness: s.readiness,
      readinessWidth: s.readiness + "%",
      readinessColor: readinessTone,
      readinessBg: readinessTone + "1f",
      readinessBorder: readinessTone + "44",
      readinessLabel: s.readiness >= 75 ? "PILOT READY" : "BLOCKED",
      readinessDelta: s.readiness > 61 ? "+" + (s.readiness - 61) + " pts" : "baseline",
      readinessDeltaColor: s.readiness > 61 ? "#34d399" : "#64748b",
      blockers: [
        { label: "Exchange DLP coverage", value: s.metrics.dlpCoverage + "%", color: s.metrics.dlpCoverage >= 100 ? "#34d399" : "#f87171" },
        { label: "SharePoint oversharing", value: s.metrics.oversharing === 0 ? "OK" : String(s.metrics.oversharing), color: s.metrics.oversharing === 0 ? "#34d399" : "#f87171" },
        { label: "Intune device drift", value: s.metrics.drift === 0 ? "OK" : String(s.metrics.drift), color: s.metrics.drift === 0 ? "#34d399" : "#fbbf24" }
      ],
      findingsLabel: s.remediated + "/10 remediated",
      findingTicks: Array.from({ length: 10 }, (_, i) => ({ color: i < s.remediated ? "#0078D4" : "rgba(51,65,85,.7)" })),

      seats: ["shane"].concat(roster).concat(["user"]).map(persona),
      bubble: (speaker && !s.hidden && !s.qa) ? persona(speaker) : null,
      onCloseBubble: () => { clearTimeout(this.timer); clearTimeout(this.injTimer); this.exitPending = false; this.setState({ hidden: true, playing: false }); },
      sowBoard: (() => {
        if (s.dive !== "sow") return { show: false, phases: [] };
        const out = s.sowOut || {};
        const t = this.sowTotals();
        const money = (n) => "$" + n.toLocaleString("en-US");
        const COL = { p1: "#7dd3fc", p2: "#3B82F6", p3: "#8B5CF6", p4: "#F3F4F6", p5: "#22C55E", p6: "#F97316", p7: "#0E7490" };
        // week 1 to week 12 across the bar
        const span = (weeks) => {
          const m = String(weeks).match(/(\d+)\D+(\d+)/);
          if (!m) return { left: "0%", width: "100%" };
          const a = Number(m[1]), b = Number(m[2]);
          return { left: ((a - 1) / 12 * 100).toFixed(1) + "%", width: (((b - a + 1) / 12) * 100).toFixed(1) + "%" };
        };
        return {
          show: true,
          count: (7 - t.removed) + " of 7 phases",
          price: money(t.price),
          monthly: t.monthly ? money(t.monthly) + " / mo" : "monitoring not taken",
          readiness: t.readiness + "%",
          readinessColor: t.readiness >= 75 ? "#34d399" : t.readiness >= 60 ? "#fbbf24" : "#f87171",
          gate: t.readiness >= 75 ? "GATE CLEARED" : "BELOW GATE",
          barW: Math.min(100, t.readiness) + "%",
          phases: SOW_PHASES.map(p => {
            const dropped = !!out[p.id];
            const sp = p.recurring ? { left: "0%", width: "100%" } : span(p.weeks);
            return {
              n: p.n, title: p.title, weeks: p.weeks,
              price: p.price === 0 ? "included" : money(p.price) + (p.recurring ? "/mo" : ""),
              color: dropped ? "rgba(71,85,105,.55)" : COL[p.id],
              ink: dropped ? "#64748b" : "#e2e8f0",
              opacity: dropped ? "0.45" : "1",
              left: sp.left, width: sp.width,
              dropped: dropped,
              onClick: () => { if (!p.fixed) this.togglePhase(p.id); }
            };
          })
        };
      })(),
      pillarBoard: (() => {
        const key = s.dive === "sow" ? null : (s.dive || null);
        const meta = key && PILLAR_META[key];
        const items = key && FINDINGS[key];
        if (!meta || !items) return { show: false, items: [] };
        return {
          show: true, color: meta.color,
          title: meta.label + " whiteboard",
          count: items.length + " FOUND",
          items: items.map(x => ({ t: x.t, m: x.m, sow: x.sow, short: x.t.slice(0, 42), badge: x.sow, change: (Object.keys(CHANGES).find(id => CHANGES[id].match.test(x.t)) || ""), tip: x.t + " — " + x.m + ". Carries into " + x.sow + ". Click to ask about this finding.", onClick: () => this.askFinding(key, x) })),
          note: "Everything on this list came out of the scan this morning. Each one carries into the statement of work under the phase named beside it."
        };
      })(),
      boardOpen: !s.dive && ((s.pinned || []).length > 0 || (s.pinnedPillars || []).length > 0),
      findingsOpen: (s.pinnedPillars || []).length > 0,
      findingsCount: (() => {
        const n = (s.pinnedPillars || []).reduce((a, k) => a + (FINDINGS[k] || []).length, 0);
        return String(n);
      })(),
      lanes: (() => {
        const pinnedP = s.pinnedPillars || [];
        const rows = (keys) => {
          const out = [];
          keys.forEach(k => { if (pinnedP.indexOf(k) >= 0) (FINDINGS[k] || []).forEach(x => out.push({ t: x.t, m: x.m, pillar: PILLAR_META[k].label, color: PILLAR_META[k].color })); });
          return out;
        };
        const issues = rows(["governance", "licensing", "adoption", "health"]);
        const sec = rows(["security", "compliance"]);
        return [
          { id: "issues", label: "Issues found", accent: "#fbbf24", count: String(issues.length), rows: issues,
            isEmpty: issues.length === 0, empty: "Nothing pinned yet — issues land here as each pillar is worked." },
          { id: "security", label: "Security issues", accent: "#f87171", count: String(sec.length), rows: sec,
            isEmpty: sec.length === 0, empty: "Security and compliance findings land here." }
        ];
      })(),
      sowTotal: (() => {
        const pinnedP = s.pinnedPillars || [];
        return String(pinnedP.reduce((a, k) => a + (FINDINGS[k] || []).length, 0));
      })(),
      sowReady: (s.pinnedPillars || []).length >= 3,
      findingsGroups: (s.pinnedPillars || []).map(k => ({
        label: PILLAR_META[k].label.toUpperCase(),
        color: PILLAR_META[k].color,
        chipBg: PILLAR_META[k].color + "22",
        count: String((FINDINGS[k] || []).length),
        rows: (FINDINGS[k] || []).map(x => ({ t: x.t, m: x.m, sow: x.sow, color: PILLAR_META[k].color }))
      })),
      sowPhases: (() => {
        const map = {};
        (s.pinnedPillars || []).forEach(k => (FINDINGS[k] || []).forEach(x => {
          (map[x.sow] = map[x.sow] || []).push(x);
        }));
        return Object.keys(map).map(name => ({ name, count: String(map[name].length) }));
      })(),
      flight: (() => {
        const fl = s.flight;
        if (!fl) return { show: false, title: "", x: "0px", y: "0px", w: "0px", opacity: "0", transform: "none", transition: "none", setEl: null };
        const u = USE_CASES.find(x => x.id === fl.uc) || { title: "" };
        const dx = fl.tx - fl.x, dy = fl.ty - fl.y;
        return {
          show: true, title: u.title, setEl: null,
          x: fl.x + "px", y: fl.y + "px", w: fl.w + "px",
          opacity: fl.phase ? "0" : "1",
          transform: fl.phase ? "translate(" + dx + "px," + dy + "px) scale(.72)" : "translate(0,0) scale(1)",
          transition: "transform 1000ms cubic-bezier(.22,1,.36,1), opacity 1000ms cubic-bezier(.55,0,1,.45)"
        };
      })(),
      useCasesEmpty: (s.pinned || []).length === 0,
      boardCount: (s.pinned || []).filter(id => s.covered[id]).length + " / " + (s.pinned || []).length,
      boardItems: (s.pinned || []).map(id => {
        const u = USE_CASES.find(x => x.id === id);
        const p = PERSONAS[u.who];
        const done = !!s.covered[id];
        return {
          title: u.title, value: u.value, who: p.name.split(" ")[0], color: p.color,
          border: done ? "rgba(52,211,153,.5)" : "rgba(30,41,59,.9)",
          bg: done ? "rgba(16,185,129,.1)" : "rgba(2,6,23,.5)",
          titleColor: done ? "#a7f3d0" : "#e2e8f0",
          boxBg: done ? "#10B981" : "transparent",
          boxBorder: done ? "#10B981" : "rgba(71,85,105,.9)",
          tick: done ? "1" : "0"
        };
      }),

      diveOpen: !!DIVES[s.dive],
      dive: (() => {
        const spec = DIVES[s.dive];
        if (!spec) return null;
        const on = (s.levers || {});
        const vals = {};
        spec.metrics.forEach(m => { vals[m.key] = m.base; });
        let score = spec.score;
        spec.levers.forEach(l => {
          if (!on[s.dive + ":" + l.id]) return;
          score += l.score;
          Object.keys(l.d).forEach(k => { if (vals[k] !== undefined) vals[k] += l.d[k]; });
        });
        const invCfg = DIVE_INV[s.dive];
        if (invCfg && on[s.dive + ":" + invCfg.toggle.id]) score += 9;
        if (invCfg && s.invRun && s.invRun[s.dive] === "done") score += 4;
        score = Math.min(99, score);
        const num = (n) => Math.round(n).toLocaleString("en-US");
        const picked = spec.levers.filter(l => on[s.dive + ":" + l.id]).length;
        return {
          kicker: spec.kicker, title: spec.title, color: spec.color, accent: spec.accent, icon: spec.icon,
          score: String(score), scoreBase: String(spec.score),
          scoreColor: score >= 85 ? "#34d399" : score >= 60 ? "#fbbf24" : "#f87171",
          delta: (score - spec.score > 0 ? "+" : "") + (score - spec.score) + " from " + spec.score,
          deltaShow: score !== spec.score,
          gate: score >= 85 ? "PILLAR CLEAR" : score >= 60 ? "PILLAR PARTIAL" : "PILLAR BLOCKED",
          gateColor: score >= 85 ? "#34d399" : score >= 60 ? "#fbbf24" : "#f87171",
          effort: picked === 0 ? "no work selected" : picked + " workstream" + (picked > 1 ? "s" : "") + " selected",
          metrics: spec.metrics.map(m => {
            const now = Math.max(0, vals[m.key]);
            const better = m.dir === "up" ? now > m.base : now < m.base;
            return {
              label: m.label, base: num(m.base) + m.unit, now: num(now) + m.unit,
              color: now === m.base ? "#e2e8f0" : better ? "#34d399" : "#f87171"
            };
          }),
          levers: spec.levers.map(l => {
            const key = s.dive + ":" + l.id;
            const active = !!on[key];
            return {
              title: l.title, detail: l.detail, owner: l.owner, effort: l.effort, risk: l.risk,
              gain: "+" + l.score,
              border: active ? "rgba(52,211,153,.55)" : "rgba(30,41,59,.9)",
              bg: active ? "rgba(16,185,129,.09)" : "rgba(2,6,23,.5)",
              knobBg: active ? "#10B981" : "rgba(51,65,85,.9)",
              knobX: active ? "18px" : "2px",
              titleColor: active ? "#d1fae5" : "#e2e8f0",
              onToggle: () => this.setState(st => ({ levers: Object.assign({}, st.levers, { [key]: !st.levers[key] }) }))
            };
          }),

          hasDoc: !!DOCS[s.dive],
          onOpenDoc: () => this.setState({ doc: s.dive, playing: false }),
          hasInv: !!DIVE_INV[s.dive],
          inv: (() => {
            const cfg = DIVE_INV[s.dive];
            if (!cfg) return { tabs: [], rows: [], title: "" };
            const tab = (s.invTab && s.invTab[s.dive]) || cfg.tabs[0][0];
            const tone = { good: "#34d399", warn: "#fbbf24", bad: "#f87171", mute: "#94a3b8" };
            const tOn = !!on[s.dive + ":" + cfg.toggle.id];
            const run = (s.invRun && s.invRun[s.dive]) || null;
            return {
              title: cfg.title,
              tabs: cfg.tabs.map(t => ({
                label: t[1],
                color: tab === t[0] ? "#f1f5f9" : "#94a3b8",
                border: tab === t[0] ? spec.color + "aa" : "rgba(51,65,85,.85)",
                bg: tab === t[0] ? spec.color + "26" : "rgba(2,6,23,.5)",
                onClick: () => this.setState(st => ({ invTab: Object.assign({}, st.invTab, { [s.dive]: t[0] }) }))
              })),
              rows: cfg.rows[tab].map(r => ({
                name: r.name, note: r.note, tag: r.tag, tagColor: tone[r.tone], chipBg: tone[r.tone] + "1f",
                border: tOn && r.tone !== "good" ? "rgba(52,211,153,.4)" : "rgba(30,41,59,.9)",
                bg: tOn && r.tone !== "good" ? "rgba(16,185,129,.06)" : "rgba(2,6,23,.5)"
              })),
              toggleLabel: cfg.toggle.label, toggleNote: cfg.toggle.note,
              knobBg: tOn ? "#10B981" : "rgba(51,65,85,.9)",
              knobX: tOn ? "18px" : "2px",
              onToggle: () => this.setState(st => ({ levers: Object.assign({}, st.levers, { [s.dive + ":" + cfg.toggle.id]: !st.levers[s.dive + ":" + cfg.toggle.id] }) })),
              btnLabel: run === "busy" ? cfg.button.busy : run === "done" ? cfg.button.done : cfg.button.idle,
              btnBg: run === "done" ? "rgba(16,185,129,.16)" : spec.color,
              btnColor: run === "done" ? "#6ee7b7" : "#fff",
              onRun: () => {
                const d = s.dive;
                this.setState(st => ({ invRun: Object.assign({}, st.invRun, { [d]: "busy" }) }));
                setTimeout(() => this.setState(st => ({ invRun: Object.assign({}, st.invRun, { [d]: "done" }) })), 1500);
              },
              outOpen: run === "done",
              out: run === "done" ? cfg.button.out.map(t => ({ t })) : []
            };
          })(),
          onReset: () => this.setState(st => {
            const next = Object.assign({}, st.levers);
            Object.keys(next).forEach(k => { if (k.indexOf(s.dive + ":") === 0) delete next[k]; });
            return { levers: next };
          }),
          onClose: this.closeDive
        };
      })(),

      decisionsOpen: s.dive === "board",
      decisions: (() => {
        const on = s.levers || {};
        const staged = s.changes || {};
        const rows = [];
        const PILL = { gov: ["Governance", "#3B82F6"], sec: ["Security", "#8B5CF6"], cmp: ["Compliance", "#F3F4F6"],
          lic: ["Licensing", "#14B8A6"], ado: ["Adoption", "#F97316"], hlt: ["Health", "#22C55E"], cpl: ["Copilot", "#67E8F9"] };
        Object.keys(CHANGES).forEach(id => {
          if (!staged[id]) return;
          const c = CHANGES[id];
          const key = c.gov ? "gov" : c.sec ? "sec" : c.ready ? "cpl" : "gov";
          const meta = PILL[key] || PILL.gov;
          const bits = [];
          if (c.gov) bits.push("+" + c.gov + " governance");
          if (c.sec) bits.push("+" + c.sec + " security");
          if (c.ready) bits.push("+" + c.ready + " readiness");
          rows.push({ pillar: meta[0], color: meta[1], title: c.label || c.verb, effect: (bits.join(" · ") || "staged") + (c.note ? " · " + c.note : "") });
        });
        GOV_LEVERS.forEach(l => { if (on[l.id]) rows.push({ pillar: "Governance", color: "#3B82F6", title: l.title, effect: "+" + l.d.score + " governance · " + l.owner }); });
        Object.keys(DIVES).forEach(k => {
          DIVES[k].levers.forEach(l => {
            if (!on[k + ":" + l.id]) return;
            rows.push({ pillar: k.charAt(0).toUpperCase() + k.slice(1), color: DIVES[k].color, title: l.title, effect: "+" + l.score + " " + k + " · " + l.owner });
          });
        });
        const adj = s.lic || {};
        LIC_SKUS.forEach(sk => {
          const q = adj[sk.id];
          if (q === undefined || q === sk.purchased) return;
          const d = (q - sk.purchased) * sk.cost * 12;
          rows.push({
            pillar: "Licensing", color: "#14B8A6",
            title: sk.name + " · " + sk.purchased.toLocaleString("en-US") + " → " + q.toLocaleString("en-US") + " seats",
            effect: (d <= 0 ? "recovers $" : "adds $") + Math.abs(Math.round(d)).toLocaleString("en-US") + "/yr"
          });
        });
        return {
          rows,
          empty: rows.length === 0,
          count: rows.length + (rows.length === 1 ? " decision" : " decisions"),
          onClose: this.closeDive
        };
      })(),
      onOpenBoard: () => this.setState({ dive: "board", playing: false }),

      bangOpen: false,
      bang: (() => {
        const on = s.levers || {};
        const govPicked = GOV_LEVERS.filter(l => on[l.id]);
        const govGain = govPicked.reduce((a, l) => a + l.d.score, 0);
        const pillars = [
          { name: "Governance", base: GOV_BASE.score, gain: govGain, color: "#3B82F6" },
          { name: "Adoption", base: DIVES.adoption.score, gain: DIVES.adoption.levers.filter(l => on["adoption:" + l.id]).reduce((a, l) => a + l.score, 0), color: "#F97316" },
          { name: "Compliance", base: DIVES.compliance.score, gain: DIVES.compliance.levers.filter(l => on["compliance:" + l.id]).reduce((a, l) => a + l.score, 0), color: "#F3F4F6" },
          { name: "Health", base: DIVES.health.score, gain: DIVES.health.levers.filter(l => on["health:" + l.id]).reduce((a, l) => a + l.score, 0), color: "#22C55E" },
          { name: "Security", base: DIVES.security.score, gain: DIVES.security.levers.filter(l => on["security:" + l.id]).reduce((a, l) => a + l.score, 0), color: "#0078D4" }
        ];
        const licAdj = s.lic || {};
        const licQty = (sk) => licAdj[sk.id] === undefined ? sk.purchased : licAdj[sk.id];
        let baseMo = 0, nowMo = 0, wasteMo = 0;
        LIC_SKUS.forEach(sk => { baseMo += sk.purchased * sk.cost; const q = licQty(sk); nowMo += q * sk.cost; wasteMo += Math.max(0, q - sk.assigned) * sk.cost; });
        const licScore = Math.max(18, Math.min(99, Math.round(100 - (nowMo > 0 ? wasteMo / nowMo : 0) * 250)));
        const licBase = Math.max(18, Math.round(100 - (LIC_SKUS.reduce((a, sk) => a + Math.max(0, sk.purchased - sk.assigned) * sk.cost, 0) / baseMo) * 250));
        pillars.splice(1, 0, { name: "Licensing", base: licBase, gain: licScore - licBase, color: "#14B8A6" });
        const seats = licQty(LIC_SKUS.find(x => x.id === "copilot"));
        const cpSeats = licQty(LIC_SKUS.find(x => x.id === "copilot"));
        pillars.push({ name: "Copilot", base: COPILOT_BASE, gain: Math.round(Math.min(62, (cpSeats / 1876) * 120)), color: "#67E8F9" });
        const before = Math.round(pillars.reduce((a, p) => a + p.base, 0) / pillars.length);
        const after = Math.round(pillars.reduce((a, p) => a + Math.min(99, p.base + p.gain), 0) / pillars.length);
        const recovered = Math.max(0, (baseMo - nowMo) * 12);
        const ret = seats * COPILOT_RETURN;
        const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
        const ready = after >= 85 && seats >= 200;
        return {
          before: String(before), after: String(after),
          barBefore: Math.max(0, Math.min(100, before)) + "%",
          barAfter: Math.max(0, Math.min(100, after)) + "%",
          barDelta: Math.max(0, Math.min(100, after - before)) + "%",
          afterColor: after >= 85 ? "#34d399" : after >= 60 ? "#fbbf24" : "#f87171",
          verdict: ready ? "CLEARED FOR ROLLOUT" : after >= 70 ? "PILOT ONLY — SCOPED" : "NOT READY",
          verdictColor: ready ? "#34d399" : after >= 70 ? "#fbbf24" : "#f87171",
          seats: seats.toLocaleString("en-US"),
          value: money(ret + recovered),
          recovered: money(recovered),
          ret: money(ret),
          covered: USE_CASES.filter(u => s.covered[u.id]).length + " of " + USE_CASES.length,

          blockers: (() => {
            const b = [];
            const dlpOn = on["security:dlpscope"] || on["compliance:dlpscope"];
            if (!dlpOn) b.push({ t: "DLP scope — two policy sets never evaluate; 1,412 mailboxes uncovered", tone: "#f87171", tag: "OPEN" });
            if (!govGain) b.push({ t: "SharePoint oversharing — 41 sites publish org-wide links", tone: "#f87171", tag: "OPEN" });
            if (!on["health:baseenforce"]) b.push({ t: "Device baseline — 312 endpoints outside compliance", tone: "#f87171", tag: "OPEN" });
            if (!on["security:caenforce"]) b.push({ t: "No Copilot session policy in conditional access", tone: "#fbbf24", tag: "OPEN" });
            if (!on["compliance:labelenforce"]) b.push({ t: "Labeling — 22% of reachable content is unclassified", tone: "#fbbf24", tag: "OPEN" });
            if (seats < 200) b.push({ t: "Seats — " + seats + " Copilot licences against a 400-seat pilot", tone: "#fbbf24", tag: "SHORT" });
            if (!b.length) b.push({ t: "No blockers open — every gate the scan raised has been answered in this room", tone: "#34d399", tag: "CLEAR" });
            return b;
          })(),

          personaReady: [
            { name: "Maya Torres · Flight controller", ready: !!on["adoption:paths"] || s.invRun && s.invRun.adoption === "done" },
            { name: "Ellis Wren · Support lead", ready: !!(s.invRun && s.invRun.adoption === "done") },
            { name: "Revenue-cycle team · 31 seats", ready: !!on["adoption:champs"] },
            { name: "Clinical educators · 18 seats", ready: true }
          ].map(p => ({
            name: p.name, tag: p.ready ? "READY" : "NOT READY",
            color: p.ready ? "#34d399" : "#fbbf24",
            chipBg: (p.ready ? "#34d399" : "#fbbf24") + "1f"
          })),

          confidence: (() => {
            const openB = [!(on["security:dlpscope"] || on["compliance:dlpscope"]), !govGain, !on["health:baseenforce"], !on["security:caenforce"], !on["compliance:labelenforce"]].filter(Boolean).length;
            const c = Math.max(8, Math.min(97, Math.round(after * 0.7 + (5 - openB) * 6)));
            return {
              pct: String(c) + "%", width: c + "%",
              color: c >= 80 ? "#34d399" : c >= 55 ? "#fbbf24" : "#f87171",
              note: c >= 80 ? "Deployable at pilot scope with evidence a regulator would accept."
                : c >= 55 ? "Scoped pilot only — the open gates decide how far it can travel."
                : "Not deployable. The open gates turn a grounded answer into a reportable event."
            };
          })(),

          previewOn: !!on["copilot:preview"],
          previewKnobBg: on["copilot:preview"] ? "#10B981" : "rgba(51,65,85,.9)",
          previewKnobX: on["copilot:preview"] ? "18px" : "2px",
          onPreview: () => this.setState(st => ({ levers: Object.assign({}, st.levers, { "copilot:preview": !st.levers["copilot:preview"] }) })),

          rolloutLabel: s.rollout === "busy" ? "Modelling rollout…" : s.rollout === "done" ? "Rollout modelled" : "Simulate Copilot rollout",
          rolloutBg: s.rollout === "done" ? "rgba(16,185,129,.16)" : "#67E8F9",
          rolloutColor: s.rollout === "done" ? "#6ee7b7" : "#04283a",
          onRollout: () => {
            this.setState({ rollout: "busy" });
            setTimeout(() => this.setState({ rollout: "done" }), 1600);
          },
          rolloutOpen: s.rollout === "done",
          rolloutOut: (() => {
            if (s.rollout !== "done") return [];
            const openB = [!(on["security:dlpscope"] || on["compliance:dlpscope"]), !govGain, !on["health:baseenforce"]].filter(Boolean).length;
            return [
              { t: "Wave 1 — " + Math.min(seats, 400) + " seats across the four highest-return cohorts, inside the labelled finance and clinical boundary. Modelled return " + money(Math.min(seats, 400) * COPILOT_RETURN) + " in year one." },
              { t: openB === 0
                  ? "Every gate is closed, so wave 2 opens the remaining " + Math.max(0, 1876 - Math.min(seats, 400)) + " seats on a 30-day cadence with no further remediation dependency."
                  : openB + " gate" + (openB > 1 ? "s" : "") + " still open, so wave 2 does not start. Tenant-wide grounding would reach content the scan already flagged as regulated and unlabelled." },
              { t: on["copilot:preview"]
                  ? "Preview mode on: responses render with their citations and sensitivity label before delivery, and every grounded retrieval is logged for legal. This is what makes the pilot defensible."
                  : "Preview mode off: users receive grounded answers with no citation surface, so legal cannot reconstruct which source produced which claim." }
            ];
          })(),
          pillars: pillars.map(p => {
            const nowV = Math.min(99, p.base + p.gain);
            return {
              name: p.name, color: p.color, base: String(p.base), now: String(nowV),
              barBase: (p.base) + "%", barNow: nowV + "%",
              gain: p.gain > 0 ? "+" + p.gain : "—",
              gainColor: p.gain > 0 ? "#34d399" : "#64748b"
            };
          }),
          onClose: this.closeDive
        };
      })(),

      licOpen: false,
      lic: (() => {
        const adj = s.lic || {};
        const qty = (sk) => Math.max(sk.assigned === 0 ? 0 : 0, adj[sk.id] === undefined ? sk.purchased : adj[sk.id]);
        const money = (n) => (n < 0 ? "−$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
        let baseMo = 0, nowMo = 0, wasteMo = 0;
        LIC_SKUS.forEach(sk => {
          baseMo += sk.purchased * sk.cost;
          const q = qty(sk);
          nowMo += q * sk.cost;
          wasteMo += Math.max(0, q - sk.assigned) * sk.cost;
        });
        const copilotSku = LIC_SKUS.find(x => x.id === "copilot");
        const copilotSeats = qty(copilotSku);
        const deltaYr = (nowMo - baseMo) * 12;
        const returnYr = copilotSeats * COPILOT_RETURN;
        const netYr = returnYr - Math.max(0, deltaYr);
        const wastePct = nowMo > 0 ? wasteMo / nowMo : 0;
        const score = Math.max(18, Math.min(99, Math.round(100 - wastePct * 250)));
        return {
          score: String(score),
          scoreColor: score >= 85 ? "#34d399" : score >= 60 ? "#fbbf24" : "#f87171",
          deltaShow: score !== Math.round(100 - (LIC_SKUS.reduce((a, sk) => a + Math.max(0, sk.purchased - sk.assigned) * sk.cost, 0) / baseMo) * 250),
          scoreDelta: (() => { const b = Math.round(100 - (LIC_SKUS.reduce((a, sk) => a + Math.max(0, sk.purchased - sk.assigned) * sk.cost, 0) / baseMo) * 250); const d = score - b; return (d > 0 ? "+" : "") + d + " from " + b; })(),
          spend: money(nowMo * 12) + " / yr",
          waste: money(wasteMo * 12) + " / yr",
          wasteColor: wasteMo * 12 > 200000 ? "#f87171" : wasteMo * 12 > 50000 ? "#fbbf24" : "#34d399",
          deltaLabel: deltaYr <= 0 ? "Annual recovery" : "Annual added spend",
          delta: money(Math.abs(deltaYr)),
          deltaColor: deltaYr <= 0 ? "#34d399" : "#fbbf24",
          copilotSeats: copilotSeats.toLocaleString("en-US"),
          copilotCoverage: Math.round((copilotSeats / 1876) * 100) + "% of active users · 2 actually assigned today",
          returnYr: money(returnYr),
          net: (netYr >= 0 ? "+" : "−") + "$" + Math.abs(Math.round(netYr)).toLocaleString("en-US"),
          netColor: netYr >= 0 ? "#34d399" : "#f87171",
          rows: LIC_SKUS.map(sk => {
            const q = qty(sk);
            const idle = Math.max(0, q - sk.assigned);
            const changed = q !== sk.purchased;
            return {
              name: sk.name, note: sk.note,
              assigned: sk.assigned.toLocaleString("en-US"),
              qty: q.toLocaleString("en-US"),
              unit: "$" + sk.cost + "/seat/mo",
              idle: idle > 0 ? idle.toLocaleString("en-US") + " idle · " + money(idle * sk.cost * 12) + "/yr wasted" : "fully assigned",
              idleColor: idle === 0 ? "#34d399" : idle * sk.cost * 12 > 100000 ? "#f87171" : "#fbbf24",
              border: changed ? (sk.invest ? "rgba(103,232,249,.55)" : "rgba(52,211,153,.5)") : "rgba(30,41,59,.9)",
              bg: changed ? (sk.invest ? "rgba(103,232,249,.09)" : "rgba(16,185,129,.08)") : "rgba(2,6,23,.5)",
              qtyColor: changed ? (q < sk.purchased ? "#34d399" : "#7dd3fc") : "#e2e8f0",
              onMinus: () => this.setState(st => ({ lic: Object.assign({}, st.lic, { [sk.id]: Math.max(0, (st.lic[sk.id] === undefined ? sk.purchased : st.lic[sk.id]) - sk.step) }) })),
              onPlus: () => this.setState(st => ({ lic: Object.assign({}, st.lic, { [sk.id]: (st.lic[sk.id] === undefined ? sk.purchased : st.lic[sk.id]) + sk.step }) })),
              onFit: () => this.setState(st => ({ lic: Object.assign({}, st.lic, { [sk.id]: sk.assigned }) })),
              fitLabel: sk.invest ? "Licence the pilot (400)" : "Right-size to assigned",
              onFitInvest: sk.invest ? () => this.setState(st => ({ lic: Object.assign({}, st.lic, { copilot: 400 }) })) : null,
              invest: !!sk.invest
            };
          }),
          drift: String(s.licDrift === undefined ? -12 : s.licDrift),
          driftVal: String(s.licDrift === undefined ? -12 : s.licDrift),
          onDrift: (e) => this.setState({ licDrift: Number(e.target.value) }),
          normOn2: !!s.licNorm,
          wasteBreak: (() => {
            const norm = s.licNorm ? 0.35 : 1;
            const drift = Math.abs(s.licDrift === undefined ? -12 : s.licDrift) / 12;
            const dup = Math.round(11833 * drift);
            const unused = Math.round(70634 * drift);
            const mis = Math.round(2700 * norm);
            const money = (n) => "$" + n.toLocaleString("en-US");
            return {
              rows: [
                { l: "Duplicate licences", v: money(dup) + " / mo" },
                { l: "Unused licences", v: money(unused) + " / mo" },
                { l: "Misassigned Copilot licences", v: money(mis) + " / mo" }
              ],
              total: money(dup + unused + mis) + " / mo",
              totalColor: dup + unused + mis > 50000 ? "#f87171" : dup + unused + mis > 18000 ? "#fbbf24" : "#34d399"
            };
          })(),
          licGauges: (() => {
            const drift = Math.abs(s.licDrift === undefined ? -12 : s.licDrift);
            const norm = !!s.licNorm;
            const meter = Math.round(Math.max(20, Math.min(98, 100 - drift * 4.2 - (norm ? 0 : 12))));
            const eligible = 1631 - Math.round(drift * 24) - (norm ? 0 : 96);
            const efficiency = Math.round(Math.max(15, Math.min(97, 100 - drift * 3.6 - (norm ? 0 : 16))));
            const col = (v) => v >= 75 ? "#34d399" : v >= 45 ? "#fbbf24" : "#f87171";
            return [
              { label: "Licensing meter", value: String(meter) + "%", w: meter + "%", color: col(meter) },
              { label: "Copilot eligibility", value: eligible.toLocaleString("en-US"), w: Math.round((eligible / 1876) * 100) + "%", color: col(Math.round((eligible / 1876) * 100)) },
              { label: "Cost efficiency", value: String(efficiency) + "/100", w: efficiency + "%", color: col(efficiency) }
            ];
          })(),
          simLabel: s.licSim === "busy" ? "Correcting…" : s.licSim === "done" ? "Correction modelled" : "Simulate license correction",
          simBg: s.licSim === "done" ? "rgba(16,185,129,.16)" : "#14B8A6",
          simColor: s.licSim === "done" ? "#6ee7b7" : "#04262a",
          onSim: () => { this.setState({ licSim: "busy" }); setTimeout(() => this.setState({ licSim: "done" }), 1400); },
          simOpen: s.licSim === "done",
          simRows: s.licSim === "done" ? [
            { l: "Eligible for Copilot", v: "1,631 → 1,876", c: "#34d399" },
            { l: "Copilot readiness impact", v: "+14 points", c: "#34d399" },
            { l: "Annual cost saving", v: "$847,608", c: "#34d399" },
            { l: "Seats freed for the pilot", v: "1,308", c: "#7dd3fc" }
          ] : [],
          simNote: "Correcting SKUs does two things at once: it stops paying for capability nobody holds, and it makes the people with the highest modelled return actually eligible. Copilot rollout is gated on eligibility, not on budget — and the budget is already inside the bill.",
          marcusName: PERSONAS.marcus.name,
          marcusColor: PERSONAS.marcus.color,
          marcusTile: PERSONAS.marcus.tile,
          marcusInitials: PERSONAS.marcus.initials,
          marcusSays: "Fixing seat drift ensures Copilot is assigned correctly and reduces waste. Licensing determines who can use Copilot and how much it costs.",
          licFixOpen: !!s.licHow,
          licFixChevron: s.licHow ? "180deg" : "0deg",
          onLicHow: () => this.setState(st => ({ licHow: !st.licHow })),
          licFixSteps: [
            ["Normalize SKUs", "Classify every account against ninety days of real workload telemetry, then move mismatched users onto the SKU their work needs."],
            ["Remove unused licences", "Separate departed accounts from idle ones; reclaim immediately, and reduce the purchased count at renewal."],
            ["Correct Copilot assignments", "Reclaim seats with zero sessions, assign to the highest-return cohorts inside a labelled content boundary."],
            ["Prevent drift with monthly audits", "Move to group-based licensing, wire the leaver process to HR, and alert when purchased-minus-assigned exceeds 5%."]
          ].map(x => ({ t: x[0], d: x[1] })),
          onReset: () => this.setState({ lic: {}, licNorm: false, licFix: false, licDrift: undefined, licSim: null }),
          onClose: this.closeDive,

          tabs: [["mismatch", "Mismatched SKUs"], ["over", "Copilot, shouldn't"], ["need", "Needs Copilot"]].map(t => {
            const n = LIC_PEOPLE.filter(p => p.cat === t[0]).length;
            const on = s.licTab === t[0];
            return {
              label: t[1], count: String(n),
              color: on ? "#f1f5f9" : "#94a3b8",
              border: on ? "rgba(20,184,166,.65)" : "rgba(51,65,85,.85)",
              bg: on ? "rgba(20,184,166,.16)" : "rgba(2,6,23,.5)",
              onClick: () => this.setState({ licTab: t[0] })
            };
          }),
          people: LIC_PEOPLE.filter(p => p.cat === s.licTab).map(p => {
            const applied = s.licNorm && p.cat === "mismatch" || s.licFix;
            const good = p.save >= 0;
            return {
              name: p.name, role: p.role, why: p.why,
              held: p.held, should: p.should,
              delta: (p.save >= 0 ? "+$" : "−$") + Math.abs(p.save) + "/mo",
              deltaColor: good ? "#34d399" : "#7dd3fc",
              border: applied ? "rgba(52,211,153,.5)" : "rgba(30,41,59,.9)",
              bg: applied ? "rgba(16,185,129,.08)" : "rgba(2,6,23,.5)",
              state: applied ? "corrected" : "as scanned",
              stateColor: applied ? "#6ee7b7" : "#64748b"
            };
          }),
          driftSummary: (() => {
            const mm = LIC_PEOPLE.filter(p => p.cat === "mismatch");
            const over = LIC_PEOPLE.filter(p => p.cat === "over");
            const need = LIC_PEOPLE.filter(p => p.cat === "need");
            const recovers = mm.concat(over).reduce((a, p) => a + Math.max(0, p.save), 0) * 12;
            return [
              { l: "Seats on the wrong SKU", v: String(mm.length * 47), c: "#fbbf24" },
              { l: "Copilot assigned, never used", v: String(over.length * 4), c: "#f87171" },
              { l: "High-return users with no Copilot", v: String(need.length * 31), c: "#7dd3fc" },
              { l: "Recoverable from drift alone", v: "$" + Math.round(recovers * 47 / 1000) + "K/yr", c: "#34d399" }
            ];
          })(),
          normOn: !!s.licNorm,
          normKnobBg: s.licNorm ? "#10B981" : "rgba(51,65,85,.9)",
          normKnobX: s.licNorm ? "18px" : "2px",
          onNormalize: () => this.setState(st => {
            const nowOn = !st.licNorm;
            const next = Object.assign({}, st.lic);
            if (nowOn) { next.e5 = 700; next.e3 = 4020; next.f3 = (next.f3 || 0) + 0; }
            else { delete next.e5; delete next.e3; }
            return { licNorm: nowOn, lic: next };
          }),
          fixLabel: s.licFix ? "Correction applied" : "Simulate license correction",
          fixColor: s.licFix ? "#6ee7b7" : "#fff",
          fixBg: s.licFix ? "rgba(16,185,129,.16)" : "#14B8A6",
          onFixAll: () => this.setState(st => {
            const on = !st.licFix;
            const next = Object.assign({}, st.lic);
            if (on) { next.e5 = 640; next.e3 = 3980; next.copilot = 400; }
            else { delete next.e5; delete next.e3; delete next.copilot; }
            return { licFix: on, licNorm: on ? true : st.licNorm, lic: next };
          })
        };
      })(),

      preludeOpen: !!s.prelude,
      preludeAnim: s.beginning ? "wr-preludeout 1150ms cubic-bezier(.4,0,.2,1) forwards" : "wr-rise 340ms cubic-bezier(.22,1,.36,1)",
      heroOpen: s.prelude === "hero",
      chatOpen: s.prelude && s.prelude !== "hero",
      floorAnim: s.beginning ? "wr-floorburst 620ms cubic-bezier(.22,1,.36,1) forwards" : "none",
      heroQ: (() => {
        const i = s.heroQ || 0;
        const q = HERO_Q[i];
        return q ? q.q : "That's everything I need. Let's look at your tenant.";
      })(),
      heroReply: (() => {
        const i = s.heroQ || 0;
        if (!i) return "Welcome. I'm Shane. I'm really glad you're here.";
        const prev = HERO_Q[i - 1].r;
        const lead = (HERO_Q[i] || {}).lead;
        return lead ? prev + " " + lead : prev;
      })(),
      heroDock: (() => {
        const th = s.heroThread || [];
        const last = th[th.length - 1];
        if (!last || !last.chips) return { show: false, chips: [] };
        return {
          show: true,
          lead: last.asked ? "Anything else — or shall we begin?" : "Ask me anything, or let's begin.",
          chips: this.heroSmartSet.map(c => ({
            l: c.l,
            bg: c.k === "go" ? "linear-gradient(135deg,#0078D4,#00B4D8)" : "rgba(2,6,23,.55)",
            border: c.k === "go" ? "transparent" : "rgba(103,232,249,.32)",
            color: c.k === "go" ? "#e8f4fb" : "#9aa8c2",
            onClick: () => this.heroSmart(c.k)
          }))
        };
      })(),
      heroPh: (HERO_Q[s.heroQ || 0] || {}).ph || "",
      heroHintsShow: (() => {
        const q = HERO_Q[s.heroQ || 0];
        const live = (s.heroThread || []).some(m => m.q);
        return !!(q && q.hints && live && !s.heroScanning && !s.heroFinished);
      })(),
      heroHints: (((HERO_Q[s.heroQ || 0] || {}).hints) || []).map(h => ({
        l: h, onClick: () => this.heroAnswer(h)
      })),
      heroDraft: s.heroDraft || "",
      heroDone: (s.heroQ || 0) >= HERO_Q.length,
      heroStep: Math.min((s.heroQ || 0) + 1, HERO_Q.length) + " of " + HERO_Q.length,
      setHeroInput: (el) => { this.heroInput = el; },
      setHeroThread: (el) => { this.heroThreadEl = el; if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; }); },
      onHeroDraft: (e) => this.setState({ heroDraft: e.target.value }),
      onHeroKey: (e) => { if (e.key === "Enter") this.heroAnswer(); },
      onHeroSend: () => this.heroAnswer(),
      heroFindings: (() => {
        const done = s.heroDone || 0;
        const out = [];
        HERO_PHASE.forEach((p, i) => {
          if (i < done) p.find.forEach(v => out.push({ v: v, c: p.c, n: p.t.replace(" Scan", "").replace(" Readiness Model", "") }));
        });
        return out.slice(-6);
      })(),
      heroHasFindings: (s.heroDone || 0) > 0,
      heroRails: (() => {
        const done = Math.min(s.heroDone || 0, HERO_PHASE.length);
        const ans = Object.keys(s.heroAns || {}).length;
        return [
          { l: "Pillars scanned", base: "4%", w: Math.max(4, Math.round((done / HERO_PHASE.length) * 100)) + "%", span: Math.max(0, Math.round((done / HERO_PHASE.length) * 100) - 4) + "%", sub: "0", v: done + " / " + HERO_PHASE.length },
          { l: "Profile captured", base: "4%", w: Math.max(4, Math.round((ans / HERO_Q.length) * 100)) + "%", span: Math.max(0, Math.round((ans / HERO_Q.length) * 100) - 4) + "%", sub: "0", v: ans + " / " + HERO_Q.length }
        ];
      })(),
      heroScan: (() => {
        const n = HERO_PHASE.length;
        const done = Math.min(s.heroDone || 0, n);
        const live = done < n ? HERO_PHASE[done] : null;
        const pct = Math.round((done / n) * 100);
        const secs = done * 26 + (live ? 11 : 0);
        const mm = String(Math.floor(secs / 60)).padStart(2, "0"), ss = String(secs % 60).padStart(2, "0");
        return {
          tone: live ? live.c : "#34d399",
          title: !s.heroRunning && !s.heroDone ? "Waiting to start" : live ? "Running…" : "Scan complete",
          caption: !s.heroRunning && !s.heroDone ? "press simulate or answer to begin" : live ? "reading " + live.t.toLowerCase() : "complete",
          step: done + " / " + n,
          pct: pct + "%",
          w: Math.max(2, pct) + "%",
          elapsed: mm + ":" + ss + " elapsed · read-only",
          phase: live ? live.t + " — " + live.checks[0] + "…" : "Seven pillars scored · nine documents generated",
          scored: done + " of " + n + " scored",
          ticks: HERO_PHASE.slice(1).map((p, i) => ({ x: Math.round(((i + 1) / n) * 100) + "%" })),
          feed: (() => {
            const ep = {
              governance: ["GET /v1.0/sites?search=*", "GET /v1.0/sites/{id}/permissions", "GET /beta/sites/getAllSites", "GET /v1.0/drives/{id}/root/permissions"],
              licensing: ["GET /v1.0/subscribedSkus", "GET /beta/reports/getOffice365ActiveUserDetail", "GET /v1.0/users?$select=assignedLicenses", "GET /beta/reports/getM365AppUserDetail"],
              adoption: ["GET /v1.0/reports/getTeamsUserActivityCounts", "GET /beta/reports/getCopilotUsageUserDetail", "GET /v1.0/reports/getEmailActivityCounts", "GET /beta/teams/getAllMessages"],
              compliance: ["GET /beta/security/dataLossPrevention/policies", "GET /beta/security/labels/retentionLabels", "GET /beta/security/auditLog/queries", "GET /beta/informationProtection/policy/labels"],
              health: ["GET /v1.0/deviceManagement/managedDevices", "GET /v1.0/admin/serviceAnnouncement/healthOverviews", "GET /beta/directoryRoles", "GET /beta/deviceManagement/deviceCompliancePolicies"],
              security: ["GET /beta/identity/conditionalAccessPolicies", "GET /v1.0/security/alerts_v2", "GET /v1.0/identityProtection/riskyUsers", "GET /beta/oauth2PermissionGrants"],
              copilot: ["GET /beta/copilot/readiness", "GET /beta/search/semanticIndex", "POST /beta/copilot/testPrompt", "GET /beta/reports/getCopilotUserCountDetail"]
            };
            const lines = [];
            const tick = s.heroTick || 0;
            HERO_PHASE.forEach((p, i) => {
              const paths = ep[p.k] || [];
              if (done > i) {
                paths.forEach((u, j) => lines.push({ u: u, s: "200", ms: (90 + ((i * 37 + j * 53) % 260)) + "ms", c: "#34d399" }));
                (p.find || []).forEach(fd => lines.push({ u: fd, s: "HIT", ms: "", c: "#fbbf24" }));
              } else if (done === i) {
                const shown = Math.min(paths.length, 1 + (tick % (paths.length + 1)));
                paths.slice(0, shown).forEach((u, j) => lines.push({ u: u, s: j === shown - 1 ? "···" : "200", ms: j === shown - 1 ? "" : (90 + ((i * 37 + j * 53) % 260)) + "ms", c: j === shown - 1 ? "#7dd3fc" : "#34d399" }));
              }
            });
            return lines.slice(-7);
          })(),
          feedLive: (s.heroDone || 0) > 0
        };
      })(),
      heroDocs: (() => {
        const DOCLIST = [
          { t: "Governance Exposure Report", c: "#6B4EFF", meta: "34 pp" },
          { t: "Licensing Alignment Report", c: "#009CA6", meta: "26 pp" },
          { t: "Adoption & Enablement Report", c: "#43A047", meta: "22 pp" },
          { t: "Compliance & Regulatory Report", c: "#5A2D91", meta: "31 pp" },
          { t: "Tenant Health & Operations", c: "#F7630C", meta: "24 pp" },
          { t: "Security & Blast Radius", c: "#D13438", meta: "29 pp" },
          { t: "Copilot Readiness Decision", c: "#00B7C3", meta: "18 pp" },
          { t: "Statement of Work", c: "#38BDF8", meta: "19 pp" },
          { t: "Remediation Plan", c: "#A78BFA", meta: "10 pp" }
        ];
        const total = HERO_PHASE.length;
        const done = s.heroDone || 0;
        const firstDoc = HERO_PHASE.findIndex(p => p.doc);
        if (firstDoc < 0 || done < firstDoc) return { show: false, items: [] };
        const span = total - firstDoc;
        const prog = Math.max(0, Math.min(1, (done - firstDoc + (s.heroRunning ? 0.45 : 1)) / span));
        const made = Math.round(prog * DOCLIST.length);
        return {
          show: true,
          count: Math.min(made, DOCLIST.length) + " / " + DOCLIST.length,
          w: Math.round(Math.min(1, made / DOCLIST.length) * 100) + "%",
          items: DOCLIST.map((d, i) => {
            const ok = i < made;
            const live = i === made && made < DOCLIST.length;
            return {
              t: d.t, meta: ok ? d.meta : live ? "writing…" : "queued",
              tick: ok ? "1" : "0",
              box: ok ? d.c : live ? "rgba(167,139,250,.7)" : "rgba(71,85,105,.7)",
              boxBg: ok ? d.c : "transparent",
              border: ok ? d.c + "66" : live ? "rgba(167,139,250,.4)" : "rgba(30,41,59,.9)",
              bg: ok ? d.c + "1c" : live ? "rgba(167,139,250,.08)" : "rgba(2,6,23,.4)",
              ink: ok ? "#f1f5f9" : live ? "#e2e8f0" : "#64748b",
              metaInk: ok ? d.c : live ? "#c4b5fd" : "#475569",
              weight: ok ? "700" : "500"
            };
          })
        };
      })(),
      heroPillarStack: HERO_PHASE.filter(p => !p.doc).map((p, i) => {
        const done = s.heroDone || 0;
        const complete = done > i, live = done === i;
        const glyphs = {
          governance: "M12 2l8 5H4l8-5zM6 11v7M10 11v7M14 11v7M18 11v7M3 21h18",
          security: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
          compliance: "M12 3v18M5 7l7-4 7 4M4 21h16M6 7l-3 7a3 3 0 0 0 6 0zM18 7l3 7a3 3 0 0 1-6 0z",
          licensing: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
          adoption: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87",
          health: "M22 12h-4l-3 9L9 3l-3 9H2",
          copilot: "M12 2.5c.55 4.2 2.8 6.45 7 7-4.2.55-6.45 2.8-7 7-.55-4.2-2.8-6.45-7-7 4.2-.55 6.45-2.8 7-7zM18.5 14.5c.28 1.7 1.32 2.72 3 3-1.68.28-2.72 1.3-3 3-.28-1.7-1.32-2.72-3-3 1.68-.28 2.72-1.3 3-3z"
        };
        return {
          label: p.t.replace(" Scan", "").replace(" Readiness Model", "").replace("Tenant ", ""),
          glyph: glyphs[p.k] || glyphs.governance,
          done: complete,
          live: live,
          score: String(p.score),
          bg: p.k === "copilot"
            ? (live ? "linear-gradient(100deg,#0078D47a,#00B4D866 42%,#8B5CF659)"
              : complete ? "linear-gradient(100deg,#0078D44d,#00B4D842 42%,#8B5CF63b)"
              : "linear-gradient(100deg,#0078D41a,#00B4D814 42%,#8B5CF611)")
            : live ? "linear-gradient(180deg," + p.c + "70," + p.c + "3d)"
            : complete ? "linear-gradient(180deg," + p.c + "26," + p.c + "12)"
            : "linear-gradient(180deg," + p.c + "0f," + p.c + "08)",
          state: complete ? "COMPLETE" : live ? "RUNNING" : "QUEUED",
          stateColor: complete ? "#6ee7b7" : live ? "#f8fafc" : "#64748b",
          stateBorder: complete ? "rgba(52,211,153,.5)" : live ? "rgba(255,255,255,.45)" : "rgba(100,116,139,.4)",
          checks: (p.checks || []).slice(0, 2).map((cv, ci) => ({ v: cv, c: "#fff", op: ci === 0 ? ".95" : ".6" })),
          dash: (complete ? (p.score / 100) * 113 : live ? 22 : 0).toFixed(1) + " 113",
          dialColor: complete ? (p.score >= 82 ? "#34d399" : p.score >= 51 ? "#fbbf24" : "#f87171") : live ? "rgba(255,255,255,.85)" : "rgba(148,163,184,.4)",
          dialText: complete ? (p.score >= 82 ? "#6ee7b7" : p.score >= 51 ? "#fcd34d" : "#fca5a5") : "rgba(226,232,240,.55)",
          dialLabel: complete ? String(p.score) : live ? "··" : "—",
          n: String(i + 1).padStart(2, "0"),
          numOp: live ? ".85" : complete ? ".5" : ".26",
          textureOp: live ? ".5" : complete ? ".26" : ".14",
          bloom: live ? "rgba(255,255,255,.14)" : complete ? p.c + "2e" : p.c + "14",
          edgeGlow: live ? "0 0 22px " + p.c + "cc" : complete ? "0 0 14px " + p.c + "aa" : "none",
          edge: live ? p.c : complete ? p.c : p.c + "44",
          icon: live || complete ? "#fff" : p.c,
          statV: live ? "rgba(219,227,238,.82)" : "rgba(190,201,216,.76)",
          statGlow: "rgba(2,6,23,.85)",
          statL: live ? "rgba(226,232,240,.58)" : "rgba(148,163,184,.62)",
          iconOp: live ? ".2" : complete ? ".13" : ".09",
          labelOp: live ? ".17" : complete ? ".12" : ".09",
          labelAnim: live ? "wr-labeldrift 9s ease-in-out infinite" : "none",
          stats: (complete ? (p.stats || []) : live ? (p.stats || []).slice(0, 2) : [])
            .map((sv, si) => ({ v: sv[0], l: sv[1], delay: (si * 260) + "ms" })),
          text: live || complete ? "#fff" : "#cbd5e1"
        };
      }),
      heroPillarRows: HERO_PHASE.map((p, i) => {
        const done = s.heroDone || 0;
        const complete = done > i, live = done === i;
        return {
          t: p.t, c: p.c, active: live,
          short: p.t.replace(" Scan", "").replace(" Readiness Model", ""),
          bar: complete ? p.score + "%" : live ? "8%" : "0%",
          dotAnim: live ? "wr-blink 1.1s ease-in-out infinite" : "none",
          ink: complete || live ? "#e2e8f0" : "#64748b",
          state: complete ? "SCORED" : live ? "READING" : "QUEUED",
          stateInk: complete ? p.c : live ? "#a5f3fc" : "#475569",
          border: live ? p.c + "99" : complete ? p.c + "4d" : "rgba(30,41,59,.9)",
          bg: live ? "linear-gradient(150deg," + p.c + "24,rgba(2,6,23,.5))" : complete ? "rgba(2,6,23,.55)" : "rgba(2,6,23,.4)",
          glow: live ? "0 0 26px " + p.c + "33" : "none",
          note: complete ? p.find[0] : live ? p.checks[0] + "…" : "waiting",
          score: complete ? String(p.score) : "—",
          deg: (complete ? Math.round(p.score * 3.6) : live ? 26 : 0) + "deg",
          icon: PILLAR_GLYPH[p.t.replace(" Scan", "").replace(" Readiness Model", "")] || "M22 12h-4l-3 9L9 3l-3 9H2",
          sub: complete ? (p.find && p.find[0] ? p.find[0] : "scored") : live ? "reading…" : "queued",
          scoreInk: complete ? p.c : "#475569"
        };
      }),
      heroScanPct: Math.round((Math.min(s.heroDone || 0, HERO_PHASE.length) / HERO_PHASE.length) * 100) + "%",
      heroBoard: (() => {
        const sc = s.heroScan;
        if (sc) {
          return HERO_SCAN.map((x, k) => {
            const on = k < sc.i;
            return {
              l: x.n, icon: smartIcon(x.n, "M12 2l8 5H4l8-5zM6 11v7M10 11v7M14 11v7M18 11v7M3 21h18"),
              iconBg: on ? x.c + "22" : "rgba(103,232,249,.05)",
              iconBd: on ? x.c + "66" : "rgba(103,232,249,.14)",
              hasNext: k < HERO_SCAN.length - 1,
              delay: (k * 0.1).toFixed(2) + "s",
              state: on ? String(x.s) : k === sc.i ? "READING" : "QUEUED",
              stateColor: on ? x.c : k === sc.i ? "#a5f3fc" : "#475569",
              border: on ? x.c + "88" : k === sc.i ? "rgba(103,232,249,.5)" : "rgba(103,232,249,.14)",
              bg: on ? "linear-gradient(100deg," + x.c + "26,rgba(5,7,13,.4))" : "rgba(5,7,13,.35)",
              glow: on ? "0 0 26px " + x.c + "44" : "none",
              anim: on ? "wr-tilelock 620ms cubic-bezier(.22,1,.36,1)" : "none",
              textColor: on ? "#e0e7ff" : "#94a3b8",
              valColor: on ? "#e0e7ff" : "#64748b",
              val: on ? x.note : k === sc.i ? "reading telemetry…" : "—",
              tag: x.n, tagColor: on ? x.c : "#475569",
              weight: on ? "700" : "500",
              v: on ? String(x.s) + " · " + x.note : k === sc.i ? "reading telemetry…" : "queued",
              ink: on ? "#e2e8f0" : "#64748b"
            };
          });
        }
        const ans = s.heroAns || {};
        return HERO_Q.map((q, i) => ({
          l: q.l, icon: smartIcon(ans[q.id], q.icon),
          d: ans[q.id] || "",
          hasNext: i < HERO_Q.length - 1,
          delay: (i * 0.12).toFixed(2) + "s",
          filled: !!ans[q.id],
          state: ans[q.id] ? "LOCKED" : "PENDING",
          hint: ans[q.id] ? "locked in from your answer" : "waiting on your answer",
          stateColor: ans[q.id] ? "#67e8f9" : "#818cf8",
          border: ans[q.id] ? "rgba(103,232,249,.55)" : "rgba(103,232,249,.16)",
          bg: ans[q.id] ? "linear-gradient(100deg,rgba(103,232,249,.16),rgba(124,58,237,.09))" : "linear-gradient(100deg,rgba(103,232,249,.04),rgba(124,58,237,.03))",
          glow: ans[q.id] ? "0 0 26px rgba(103,232,249,.28)" : "none",
          anim: ans[q.id] ? "wr-tilelock 620ms cubic-bezier(.22,1,.36,1)" : "none",
          sub: ans[q.id] ? q.l : "waiting",
          textColor: ans[q.id] ? "#e0e7ff" : "#94a3b8",
          valColor: ans[q.id] ? "#a5f3fc" : "#64748b",
          val: ans[q.id] || "—",
          tag: q.l, tagColor: ans[q.id] ? "#67e8f9" : "#475569",
          iconBg: ans[q.id] ? "rgba(103,232,249,.14)" : "rgba(103,232,249,.04)",
          iconBd: ans[q.id] ? "rgba(103,232,249,.45)" : "rgba(103,232,249,.12)",
          weight: ans[q.id] ? "700" : "500",
          v: ans[q.id] || "waiting on your answer",
          ink: ans[q.id] ? "#e2e8f0" : "#64748b"
        }));
      })(),
      heroAsking: (s.heroQ || 0) < HERO_Q.length,
      heroThread: (s.heroThread || []).map((m, idx) => {
        const done = (s.heroDone || 0);
        const p = m.who === "scan" ? HERO_PHASE[m.phase] : null;
        const complete = p ? done > m.phase : false;
        const live = p ? done === m.phase : false;
        return {
          isShane: m.who === "shane" && !m.profile && !m.chips && !m.wrap, isYou: m.who === "you", isScan: m.who === "scan", neverScan: false,
          isProfile: !!m.profile,
          isWrap: !!m.wrap,
          wrapRows: !m.wrap ? [] : HERO_Q.map((qq, qi) => ({
            l: qq.l,
            v: (s.heroAns || {})[qi] || "—"
          })),
          onAsk: () => this.setState(st => ({ heroThread: (st.heroThread || []).concat([{ who: "shane", chips: true, asked: true }]) })),
          onGo: () => this.heroSmart("go"),
          isChips: !!m.chips,
          showName: true,
          avatarOp: "1",
          radius: "4px 16px 16px 16px",
          chipLead: m.asked ? "Anything else — or shall we begin?" : "Ask me anything, or let's begin.",
          chips: this.heroSmartSet.map(c => ({
            l: c.l, go: c.k === "go",
            bg: c.k === "go" ? "linear-gradient(135deg,#0078D4,#00B4D8)" : "rgba(2,6,23,.55)",
            border: c.k === "go" ? "transparent" : "rgba(103,232,249,.32)",
            color: c.k === "go" ? "#f8fafc" : "#9aa8c2",
            onClick: () => this.heroSmart(c.k)
          })),
          text: m.text || "",
          big: !!m.q,
          size: "clamp(12.5px,1.2vw,15px)",
          weight: m.q ? "600" : "400",
          tone: m.q ? "#7dd3fc" : "#9aa8c2",
          textGlow: m.q ? "0 0 18px rgba(0,180,216,.55)" : "none",
          border: m.q ? "rgba(103,232,249,.42)" : "rgba(103,232,249,.2)",
          bg: m.q ? "linear-gradient(150deg,rgba(0,120,212,.16),rgba(139,92,246,.12))" : "linear-gradient(150deg,rgba(30,41,59,.62),rgba(2,6,23,.66))",
          shadow: m.q ? "0 0 26px rgba(0,180,216,.24), inset 0 0 22px rgba(103,232,249,.08)" : "none",
          scan: p ? {
            t: p.t,
            sub: complete ? "Complete" : live ? p.sub : "Queued",
            c: complete ? "#34d399" : p.c,
            state: complete ? "COMPLETE" : live ? "RUNNING" : "QUEUED",
            pulse: complete ? "none" : "wr-scanbeat 1.9s ease-in-out infinite",
            checks: p.checks.map((cv, ci) => ({
              v: cv,
              c: complete ? "#34d399" : live && ci <= 1 ? p.c : "#475569",
              op: complete ? "1" : live ? (ci <= 1 ? "1" : ".45") : ".3",
              tick: complete ? "1" : "0"
            })),
            findShow: complete,
            find: p.find.map(v => ({ v })),
            score: complete ? String(p.score) : "—",
            scoreColor: complete ? p.c : "#475569"
          } : null
        };
      }),
      heroCta: !!s.heroFinished,
      onHeroEnter: () => {
        this.setState({ beginning: true });
        clearTimeout(this.enterT);
        this.enterT = setTimeout(() => this.setState({ prelude: null, beginning: false, roomEnter: true, playing: false, intro: null, introStage: "arriving", introArrived: [], introHeard: [], focus: null }, () => {
          this.startArrivals();
          clearTimeout(this.roomT);
          this.roomT = setTimeout(() => this.setState({ roomEnter: false }), 1400);
        }), 1050);
      },
      roomAnim: s.roomEnter ? "wr-roomin 1200ms cubic-bezier(.22,1,.36,1) both" : "none",
      heroBeamLive: (() => {
        const p = HERO_PHASE[Math.min(s.heroDone || 0, HERO_PHASE.length - 1)];
        return p ? p.beam : "rgba(139,92,246,.16)";
      })(),
      heroGlowLive: (() => {
        const p = HERO_PHASE[Math.min(s.heroDone || 0, HERO_PHASE.length - 1)];
        return p ? p.glow : "rgba(59,130,246,.16)";
      })(),
      heroHasOpts: !!(HERO_Q[s.heroQ || 0] || {}).opts,
      heroOpts: (() => {
        const q = HERO_Q[s.heroQ || 0];
        if (!q || !q.opts) return { count: "", items: [], ready: false, onConfirm: () => {} };
        const sel = s.heroPick || [];
        return {
          count: sel.length ? sel.length + " selected" : "pick any that apply",
          ready: sel.length > 0,
          notReady: sel.length === 0,
          cursor: sel.length ? "pointer" : "default",
          ctaLabel: sel.length ? "That's them" : "Pick at least one",
          ctaText: sel.length ? "#04202a" : "#64748b",
          ctaBg: sel.length ? "linear-gradient(135deg,#67e8f9,#3B82F6)" : "rgba(30,41,59,.5)",
          ctaGlow: sel.length ? "0 0 30px rgba(59,130,246,.45)" : "none",
          ctaOp: sel.length ? "1" : ".5",
          onConfirm: this.heroAnswer,
          items: q.opts.map(o => {
            const on = sel.indexOf(o.v) >= 0;
            return {
              v: o.v, d: o.d, icon: o.icon,
              glow: on ? "0 0 22px rgba(0,180,216,.28)" : "none",
              border: on ? "rgba(103,232,249,.75)" : "rgba(51,65,85,.85)",
              bg: on ? "rgba(0,180,216,.16)" : "rgba(2,6,23,.5)",
              tone: on ? "#e0f2fe" : "#cbd5e1",
              tick: on ? "1" : "0",
              boxBg: on ? "rgba(0,180,216,.35)" : "transparent",
              onClick: () => this.setState(st => {
                const cur = st.heroPick || [];
                const next = cur.indexOf(o.v) >= 0 ? cur.filter(x => x !== o.v) : cur.concat([o.v]);
                return { heroPick: q.multi ? next : [o.v] };
              })
            };
          })
        };
      })(),
      heroFilled: Object.keys(s.heroAns || {}).length,
      heroCount: s.heroScan ? Math.min(s.heroScan.i, HERO_SCAN.length) + " / " + HERO_SCAN.length + " PILLARS" : Object.keys(s.heroAns || {}).length + " / " + HERO_Q.length,
      onBegin: () => {
        this.setState({ beginning: true });
        clearTimeout(this.beginT);
        this.beginT = setTimeout(() => this.setState({ beginning: false }, this.beginBriefing), 1150);
      },
      chamberDim: s.prelude === "scan" ? "1" : "0.55",
      heroSlots: [
        ["Industry & role clusters", "who works in this tenant", "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87"],
        ["Personas & workflows", "what their day looks like", "M12 2.5 14.2 8.9 20.6 11 14.2 13.1 12 19.5 9.8 13.1 3.4 11 9.8 8.9z"],
        ["Seven pillar scores", "governance to Copilot", "M22 12h-4l-3 9L9 3l-3 9H2"],
        ["Findings register", "everything the scan surfaces", "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"],
        ["Documents & statement of work", "generated for you", "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6"]
      ].map((r, i, a) => ({ l: r[0], d: r[1], icon: r[2], hasNext: i < a.length - 1, delay: (0.25 + i * 0.12).toFixed(2) + "s" })),
      scanBeam: (function () {
        const P = ["rgba(59,130,246,.26)", "rgba(139,92,246,.26)", "rgba(255,255,255,.16)", "rgba(20,184,166,.24)", "rgba(34,197,94,.22)", "rgba(52,211,153,.22)", "rgba(103,232,249,.28)"];
        const n = s.scanStep || 0;
        return s.prelude === "scan" ? P[Math.min(P.length - 1, Math.floor(n / 2))] : "rgba(139,92,246,.18)";
      })(),
      scanGlow: (function () {
        const P = ["rgba(59,130,246,.2)", "rgba(139,92,246,.2)", "rgba(255,255,255,.12)", "rgba(20,184,166,.18)", "rgba(34,197,94,.16)", "rgba(52,211,153,.16)", "rgba(103,232,249,.22)"];
        const n = s.scanStep || 0;
        return s.prelude === "scan" ? P[Math.min(P.length - 1, Math.floor(n / 2))] : "rgba(59,130,246,.14)";
      })(),
      dust: (function () {
        const cols = ["rgba(103,232,249,.8)", "rgba(139,92,246,.75)", "rgba(59,130,246,.8)"];
        const out = [];
        for (let i = 0; i < 34; i++) {
          // half start low and rise the full height, half seeded up the page already
          const high = i >= 18;
          out.push({
            x: (3 + (i * 8.7) % 94).toFixed(1) + "%",
            b: high ? (18 + (i * 11) % 72).toFixed(1) + "%" : (-10 + (i * 3.1) % 14).toFixed(1) + "%",
            s: (high ? 7 + (i % 3) * 3 : 9 + (i % 4) * 4).toFixed(0) + "px",
            c: cols[i % 3],
            dur: (high ? 9 + (i % 6) * 2.2 : 11 + (i % 5) * 3.1).toFixed(1) + "s",
            delay: ((i % 11) * 1.1).toFixed(1) + "s"
          });
        }
        return out;
      })(),
      onbSetEl: (el) => { this.onbEl = el; if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; }); },
      onbStart: this.startOnb,
      onbSetup: (function () {
        const picked = s.onbPicked || [];
        const ans = Object.keys(s.wizAnswers || {}).length;
        const rows = [
          { l: "Tenant", v: "Northline Health", done: true },
          { l: "Role group", v: s.onbCluster || "not chosen", done: !!s.onbCluster },
          { l: "Personas named", v: picked.length ? String(picked.length) : "—", done: picked.length > 0 },
          { l: "Questions answered", v: ans + " of 12", done: ans >= 12 },
          { l: "Tenant scan", v: s.prelude === "scan" ? (Math.round(Math.min(1, (s.scanStep || 0) / 8) * 100) + "%") : "queued", done: (s.scanStep || 0) >= 8 }
        ];
        return rows.map(r => Object.assign(r, {
          ink: r.done ? "#6ee7b7" : "#64748b",
          vInk: r.done ? "#a5f3fc" : "#475569"
        }));
      })(),
      onbRoster: (function () {
        const picked = s.onbPicked || [];
        const cl = PERSONA_CATALOG.find(x => x.cluster === s.onbCluster);
        if (!cl || !picked.length) return { show: false, rows: [] };
        return { show: true, rows: cl.personas.filter(x => picked.indexOf(x.p) >= 0).map(x => ({ p: x.p, n: x.n + " seats" })) };
      })(),
      onbAnswers: (function () {
        const a = s.wizAnswers || {};
        const rows = WIZ_QUESTIONS.filter(q => a[q.id]).slice(-4).map(q => ({ q: q.q, a: a[q.id] }));
        return { show: rows.length > 0, rows: rows };
      })(),
      onbTyping: (function () {
        const w = s.onbTyping;
        if (!w) return { show: false, name: "", color: "#60a5fa" };
        const p = PERSONAS[w] || {};
        return { show: true, name: (p.name || "Shane") + " is typing", color: p.color || "#60a5fa" };
      })(),
      onbThread: (s.onb || []).map(m => {
        const you = m.who === "you";
        const p = PERSONAS[m.who] || {};
        const cl = PERSONA_CATALOG.find(x => x.cluster === s.onbCluster);
        const picked = s.onbPicked || [];
        const first = cl ? cl.personas.find(x => picked.indexOf(x.p) >= 0) : null;
        const q = m.q != null ? WIZ_QUESTIONS[m.q] : null;
        return {
          you: you, isText: !!m.text && m.q == null,
          name: you ? "You" : (p.name || "Shane McCaw"),
          color: you ? "#22d3ee" : (p.color || "#60a5fa"),
          tile: you ? "linear-gradient(135deg,#1e293b,#334155)" : (p.tile || "linear-gradient(135deg,#0078D4,#67E8F9)"),
          photo: you ? "avatars/user.png" : "avatars/" + (m.who || "shane") + ".png",
          slot: "onb-" + (m.who || "shane") + "-" + Math.random().toString(36).slice(2, 7),
          align: you ? "row-reverse" : "row",
          bg: you ? "rgba(0,120,212,.18)" : "rgba(2,6,23,.62)",
          border: you ? "rgba(103,232,249,.4)" : "rgba(30,41,59,.9)",
          text: m.text || "",

          isIntro: m.card === "intro",
          isClusters: m.pick === "cluster",
          clusters: PERSONA_CATALOG.map(c => ({ l: c.cluster, d: c.desc, n: c.personas.length + " roles", onClick: () => this.pickCluster(c.cluster) })),

          isPersonas: m.card === "personas",
          people: cl ? cl.personas.map(x => {
            const on = picked.indexOf(x.p) >= 0;
            return {
              p: x.p, d: x.d, n: x.n + " seats",
              border: on ? "rgba(103,232,249,.75)" : "rgba(51,65,85,.9)",
              bg: on ? "rgba(103,232,249,.12)" : "rgba(2,6,23,.5)",
              ink: on ? "#67e8f9" : "#e2e8f0",
              tick: on ? "1" : "0",
              onClick: () => this.pickPersona(x.p)
            };
          }) : [],
          pickedLabel: picked.length ? "Continue with " + picked.length + " role" + (picked.length > 1 ? "s" : "") : "Pick at least one",
          onConfirm: this.confirmPersonas,

          isOutcomes: m.card === "outcomes",
          outTitle: first ? first.p : "",
          outcomes: first ? first.outcomes.map(v => ({ v: v })) : [],
          uses: first ? first.uses.map(v => ({ v: v })) : [],

          isQ: m.q != null,
          qText: q ? q.q : "",
          qNum: m.q != null ? "Question " + (m.q + 1) + " of " + WIZ_QUESTIONS.length : "",
          qOpts: q ? q.opts.map(o => {
            const on = (s.wizAnswers || {})[q.id] === o;
            return {
              l: o,
              border: on ? "rgba(103,232,249,.75)" : "rgba(51,65,85,.9)",
              bg: on ? "rgba(103,232,249,.14)" : "rgba(2,6,23,.5)",
              ink: on ? "#a5f3fc" : "#cbd5e1",
              onClick: () => this.answerQ(m.q, o)
            };
          }) : [],

          isScanCard: m.card === "scan"
        };
      }),
      wizCanNext: s.prelude !== "scan",
      wiz: s.prelude ? (function () {
        const step = s.wizStep || 0;
        const q = WIZ_QUESTIONS[step];
        const picked = s.wizPersonas || [];
        const scanN = s.scanStep || 0;
        return {
          isWelcome: s.prelude === "welcome",
          isPersonas: s.prelude === "personas",
          isQuestions: s.prelude === "questions",
          isScan: s.prelude === "scan",
          stepLabel: s.prelude === "questions" ? "Question " + (step + 1) + " of " + WIZ_QUESTIONS.length : s.prelude === "personas" ? "Step 2 of 3" : s.prelude === "scan" ? "Scanning" : "Step 1 of 3",
          progress: s.prelude === "welcome" ? "8%" : s.prelude === "personas" ? "22%"
            : s.prelude === "questions" ? (22 + Math.round((step + 1) / WIZ_QUESTIONS.length * 58)) + "%"
            : (80 + Math.round(scanN / SCAN_PHASES.length * 20)) + "%",
          personas: WIZ_PERSONAS.map(p => {
            const on = picked.indexOf(p.id) >= 0;
            return {
              label: p.label, n: p.n + " seats", tools: p.tools,
              border: on ? "rgba(103,232,249,.75)" : "rgba(51,65,85,.9)",
              bg: on ? "rgba(103,232,249,.12)" : "rgba(2,6,23,.5)",
              ink: on ? "#67e8f9" : "#94a3b8",
              tick: on ? "1" : "0",
              onClick: () => this.togglePersona(p.id)
            };
          }),
          pickedCount: picked.length + " of " + WIZ_PERSONAS.length + " personas selected",
          q: q ? q.q : "",
          opts: q ? q.opts.map(o => {
            const on = (s.wizAnswers || {})[q.id] === o;
            return {
              l: o,
              border: on ? "rgba(103,232,249,.75)" : "rgba(51,65,85,.9)",
              bg: on ? "rgba(103,232,249,.14)" : "rgba(2,6,23,.5)",
              ink: on ? "#a5f3fc" : "#cbd5e1",
              onClick: () => this.answer(q.id, o)
            };
          }) : [],
          nextLabel: s.prelude === "welcome" ? "Define the personas"
            : s.prelude === "personas" ? "Start the questions"
            : step < WIZ_QUESTIONS.length - 1 ? "Next question" : "Scan the tenant",
          canBack: s.prelude === "personas" || s.prelude === "questions",
          onNext: this.wizNext, onBack: this.wizBack, onSkip: this.wizSkip, onSimulate: this.simulateScan,
          elapsed: (function () {
            const t0 = s.scanStart;
            if (!t0) return "0:00";
            const sec = Math.floor((Date.now() - t0) / 1000);
            return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
          })(),
          scanLabel: (s.scanStep || 0) >= SCAN_PHASES.length ? "Scan and generation complete" : "Scanning and generating",
          scan: SCAN_PHASES.map((p, i) => ({
            l: p.l, d: p.d, n: p.n, grp: p.grp || "",
            showGrp: i === 0 || (SCAN_PHASES[i - 1].grp || "") !== (p.grp || ""),
            state: i < scanN ? "done" : i === scanN ? "live" : "wait",
            ink: i < scanN ? "#6ee7b7" : i === scanN ? "#67e8f9" : "#475569",
            border: i <= scanN ? "rgba(103,232,249,.4)" : "rgba(30,41,59,.9)",
            opacity: i <= scanN ? "1" : "0.4",
            isLive: i === scanN, isDone: i < scanN
          })),
          scanDone: scanN >= SCAN_PHASES.length,
          onEnter: this.enterRoom,
          scanPct: Math.round(Math.min(1, scanN / SCAN_PHASES.length) * 100) + "%"
        };
      }).call(this) : null,
      dcfg: (function () {
        walkPillarRef.current = DIVE_CFG[s.dive] ? s.dive : "governance";
        const c = DIVE_CFG[s.dive] || DIVE_CFG.governance;
        // deep reds and purples need more presence than the lighter pillar hues
        const dark = ["security", "compliance", "governance"].indexOf(s.dive) >= 0;
        return Object.assign({}, c, {
          wmStroke: c.ink + (dark ? "6b" : "45"),
          wmFill: c.soft + (dark ? "b3" : "8c"),
          btnInk: ["security", "compliance", "governance"].indexOf(s.dive) >= 0 ? "#ffffff" : "#04202a",
          shellBg: c.grad
            ? "linear-gradient(155deg,rgba(8,30,42,.99) 0%,rgba(6,22,36,.99) 34%,rgba(3,12,24,.99) 68%,rgba(2,6,23,.99) 100%)"
            : "linear-gradient(160deg,rgba(15,23,42,.98),rgba(2,6,23,.97))",
          wmBlend: dark ? "screen" : "soft-light",
          wmOpacity: dark ? "0.32" : "0.55"
        });
      })(),
      diveAnim: s.diveClosing
        ? "wr-divefall 460ms cubic-bezier(.4,0,.9,.4) forwards"
        : "wr-rise 340ms cubic-bezier(.22,1,.36,1)",
      govOpen: DIVE_CFG[s.dive] ? true : false,
      gov: (() => {
        const isLic = s.dive === "licensing";
        const on = s.levers || {};
        const p = Object.assign({}, GOV_BASE);
        GOV_LEVERS.forEach(l => { if (on[l.id]) { p.score += l.d.score; p.sites += l.d.sites; p.docs += l.d.docs; p.guests += l.d.guests; p.labelled += l.d.labelled; } });
        p.score = Math.min(99, p.score); p.docs = Math.max(0, p.docs); p.labelled = Math.min(100, p.labelled);
        const anyOn = GOV_LEVERS.some(l => on[l.id]);
        const cleared = p.sites === 0 && p.docs <= 4000 && p.labelled >= 95;
        const num = (n) => n.toLocaleString("en-US");
        const metric = (label, base, now, unit, better) => ({
          label, base: num(base) + (unit || ""), now: num(now) + (unit || ""),
          changed: now !== base,
          color: now === base ? "#e2e8f0" : (better === "down" ? (now < base ? "#34d399" : "#f87171") : (now > base ? "#34d399" : "#f87171"))
        });
        const PC = (DIVE_CFG[s.dive] || DIVE_CFG.governance).color;
        const PI = (DIVE_CFG[s.dive] || DIVE_CFG.governance).ink;
        const licOverride = () => {
          const c = s.changes || {};
          const seats = s.licSeats === undefined ? 1308 : s.licSeats;      // unassigned seats still being paid for
          const copilot = s.licCopilot === undefined ? 2 : s.licCopilot;    // Copilot seats assigned
          const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
          const waste = Math.round(seats * 648);                            // annual cost of an unassigned seat
          const spend = Math.round(copilot * 360);                          // annual cost of a Copilot seat
          const recovered = 847608 - waste + (c.toolconsol ? 142000 : 0) + (c.rightsize ? 607392 : 0);
          const meter = Math.max(12, Math.min(99, 38 + Math.round((1308 - seats) / 1308 * 34) + (c.rightsize ? 12 : 0) + (c.groupassign ? 6 : 0)));
          const eligible = c.copilotseats ? 1535 : 0;
          const gauge = (label, v, unit, invert) => ({
            label, value: String(v) + (unit || ""), w: Math.max(2, Math.min(100, v)) + "%",
            color: (invert ? 100 - v : v) >= 75 ? "#34d399" : (invert ? 100 - v : v) >= 45 ? "#fbbf24" : "#f87171"
          });
          return {
            gate: "LICENSING: COPILOT GATE · " + (meter >= 85 ? "FUNDED" : meter >= 60 ? "PARTIAL" : "UNFUNDED"),
            gateColor: meter >= 85 ? "#34d399" : meter >= 60 ? "#fbbf24" : "#f87171",

            rollup: [
              { id: "unassigned", l: "Paid seats nobody holds", v: num(seats), c: seats > 400 ? "#f87171" : seats > 0 ? "#fbbf24" : "#34d399" },
              { id: "waste", l: "Annual cost of that waste", v: money(waste), c: waste > 200000 ? "#f87171" : waste > 0 ? "#fbbf24" : "#34d399" },
              { id: "copilotheld", l: "Copilot seats owned / assigned", v: "25 / " + copilot, c: copilot < 20 ? "#f87171" : "#34d399" },
              { id: "eligible", l: "Users eligible for Copilot", v: num(eligible), c: eligible === 0 ? "#f87171" : "#34d399" },
              { id: "mismatch", l: "Users on the wrong SKU", v: c.rightsize ? "0" : "760", c: c.rightsize ? "#34d399" : "#f87171" },
              { id: "recover", l: "Recoverable this year", v: money(recovered), c: "#34d399" }
            ].map(x => Object.assign({}, x, {
              tip: "From this morning's subscription and usage export. Click to ask what it means and what correcting it returns.",
              title: x.l, tone: x.c, change: "", stats: "Source|subscribedSkus|#7dd3fc;Reproducible|yes|#6ee7b7",
              spark: "", hasThen: false, then: "",
              border: s.govDetail === x.id ? DIVE_CFG.licensing.color + "b3" : "rgba(30,41,59,.9)",
              bg: s.govDetail === x.id ? DIVE_CFG.licensing.color + "1f" : "rgba(2,6,23,.5)",
              onClick: () => this.askSignalRow("Licence Position", x.l, x.v)
            })),

            gauges: [
              gauge("Licensing meter", meter, "%"),
              gauge("Cost efficiency", Math.max(8, Math.min(99, 41 + Math.round((1308 - seats) / 1308 * 30) + (c.toolconsol ? 13 : 0))), "/100"),
              gauge("Copilot seat coverage", Math.round(copilot / 400 * 100), "%")
            ],

            // the money controls, in place of the sharing controls
            orgLinks: num(seats) + " seats",
            orgLinksVal: String(seats),
            onLinks: (e) => this.setState({ licSeats: Number(e.target.value) }),
            sliderLabel: "Unassigned seats reclaimed",
            sliderMax: "1308",
            extLabel: "Right-size E5 to real use",
            extOn: !!c.rightsize,
            extKnobBg: c.rightsize ? "#10B981" : "rgba(51,65,85,.9)",
            extKnobX: c.rightsize ? "18px" : "2px",
            onExt: () => this.applyChange("rightsize"),
            inhLabel: "Assign the 400-seat Copilot pilot",
            inhOn: !!c.copilotseats,
            inhKnobBg: c.copilotseats ? "#10B981" : "rgba(51,65,85,.9)",
            inhKnobX: c.copilotseats ? "18px" : "2px",
            onInh: () => { this.applyChange("copilotseats"); this.setState({ licCopilot: (s.licCopilot === undefined ? 2 : s.licCopilot) === 400 ? 2 : 400 }); },

            questions: [
              "What are we paying for that nobody uses?",
              "Who is on the wrong licence?",
              "Can the recovery fund the Copilot pilot?",
              "What happens at renewal if we do nothing?",
              "How many Copilot seats do we actually need?"
            ].map(q => ({ q: q, l: q, onClick: () => this.govAsk(q) })),

            previewLabel: "Model the renewal",
            pathLabel: "Show the seat ledger",
            onSizer: this.openSizer,
            hasSizer: true
          };
        };

        const base = {
          hasSizer: false, onSizer: () => {},
          sliderLabel: "Org-wide links", sliderMax: "41",
          extLabel: "Restrict external sharing", inhLabel: "Fix broken inheritance",
          previewLabel: "Run Copilot Preview", pathLabel: "Explain Exposure Path",
          score: String(p.score), scoreBase: String(GOV_BASE.score),
          scoreColor: p.score >= 85 ? "#34d399" : p.score >= 60 ? "#fbbf24" : "#f87171",
          delta: (p.score - GOV_BASE.score > 0 ? "+" : "") + (p.score - GOV_BASE.score),
          deltaShow: p.score !== GOV_BASE.score,
          gate: "GOVERNANCE: COPILOT GATE · " + (cleared ? "CLEAR" : anyOn ? "PARTIAL" : "BLOCKED"),
          gateColor: cleared ? "#34d399" : anyOn ? "#fbbf24" : "#f87171",
          effort: (() => { const w = GOV_LEVERS.filter(l => on[l.id]).length; return w === 0 ? "no work selected" : w + " workstream" + (w > 1 ? "s" : "") + " selected"; })(),
          metrics: [
            metric("Sites with org-wide links", GOV_BASE.sites, p.sites, "", "down"),
            metric("Documents Copilot can ground on that nobody owns", GOV_BASE.docs, p.docs, "", "down"),
            metric("Unmanaged guest identities", GOV_BASE.guests, p.guests, "", "down"),
            metric("Content carrying a sensitivity label", GOV_BASE.labelled, p.labelled, "%", "up")
          ],
          levers: GOV_LEVERS.map(l => {
            const active = !!on[l.id];
            return {
              title: l.title, detail: l.detail, owner: l.owner, effort: l.effort, risk: l.risk,
              gain: "+" + l.d.score + " governance",
              border: active ? "rgba(52,211,153,.55)" : "rgba(30,41,59,.9)",
              bg: active ? "rgba(16,185,129,.09)" : "rgba(2,6,23,.5)",
              knobBg: active ? "#10B981" : "rgba(51,65,85,.9)",
              knobX: active ? "18px" : "2px",
              titleColor: active ? "#d1fae5" : "#e2e8f0",
              onToggle: () => this.setState(st => ({ levers: Object.assign({}, st.levers, { [l.id]: !st.levers[l.id] }) }))
            };
          }),
          onReset: () => this.setState({ levers: {} }),
          onClose: this.closeDive,

          tabs: [["sharepoint", "SharePoint", SITES.filter(x => x.type === "SharePoint").length],
                 ["teams", "Teams", SITES.filter(x => x.type === "Teams").length],
                 ["onedrive", "OneDrive", ONEDRIVE.length]].map(t => ({
            label: t[1], count: String(t[2]),
            color: s.govTab === t[0] ? "#f1f5f9" : "#94a3b8",
            border: s.govTab === t[0] ? "{{ dcfg.color }}99" : "rgba(51,65,85,.85)",
            bg: s.govTab === t[0] ? "{{ dcfg.color }}29" : "rgba(2,6,23,.5)",
            onClick: () => this.setState({ govTab: t[0], govSel: null, govPreview: null, govPath: false })
          })),
          orgWide: num(p.sites),
          orgWideNote: p.sites === GOV_BASE.sites ? "org-wide or EEEU links live right now" : "remaining after the selected levers",
          rows: (() => {
            const list = this.govList(s.govTab);
            const sel = s.govSel || (list[0] || {}).id;
            return list.map(x => {
              const c = x.risk === "critical" ? "#f87171" : x.risk === "high" ? "#fbbf24" : "#94a3b8";
              const on = sel === x.id;
              return {
                name: x.name, exposure: x.exposure, files: x.files, sens: x.sens,
                ext: x.ext > 0 ? x.ext + " ext" : "internal",
                riskColor: c, chipBg: c + "1f",
                border: on ? "{{ dcfg.color }}a6" : "rgba(30,41,59,.9)",
                bg: on ? "{{ dcfg.color }}1a" : "rgba(2,6,23,.5)",
                onClick: () => this.govPick(x.id)
              };
            });
          })(),
          sel: (() => {
            const list = this.govList(s.govTab);
            const site = list.find(x => x.id === s.govSel) || list[0];
            return { name: site.name, note: site.note };
          })(),
          orgLinks: String(s.govLinks === undefined ? 41 : s.govLinks),
          orgLinksVal: String(s.govLinks === undefined ? 41 : s.govLinks),
          onLinks: (e) => { const v = Number(e.target.value); this.setState(st => ({ govLinks: v, changes: Object.assign({}, st.changes, { eeeu: v <= 20, anonoff: v === 0 }) })); },
          extOn: !!s.govExt, extKnobBg: s.govExt ? "#10B981" : "rgba(51,65,85,.9)", extKnobX: s.govExt ? "18px" : "2px",
          onExt: () => this.setState(st => { const v = !st.govExt; return { govExt: v, changes: Object.assign({}, st.changes, { guestexp: v, anonoff: v }) }; }),
          inhOn: !!s.govInh, inhKnobBg: s.govInh ? "#10B981" : "rgba(51,65,85,.9)", inhKnobX: s.govInh ? "18px" : "2px",
          onInh: () => this.setState(st => { const v = !st.govInh; return { govInh: v, changes: Object.assign({}, st.changes, { inherit: v }) }; }),
          staged: (() => {
            const ch = this.changeState();
            const cfg = DIVE_CFG[s.dive] || DIVE_CFG.governance;
            const govNow = cfg.base, govThen = Math.min(cfg.cap, cfg.base + ch.gov);
            const rdNow = 34, rdThen = Math.min(cfg.readyCap, 34 + ch.ready);
            return {
              show: ch.list.length > 0,
              count: ch.list.length + (ch.list.length === 1 ? " change staged" : " changes staged"),
              short: ch.list.length + " STAGED",
              heading: s.dive === "licensing" ? "Projected position" : "Projected outcome",
              money: (s.dive === "licensing" || (s.workedPillars || []).indexOf("licensing") >= 0) ? (() => {
                const fmt = (n) => (n < 0 ? "−$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
                const c = s.changes || {};
                const seats = s.licSeats === undefined ? 1308 : s.licSeats;
                const recovered = (1308 - seats) * 648
                  + (c.reclaim ? 847608 - (1308 - seats) * 648 : 0)
                  + (c.rightsize ? 607392 : 0)
                  + (c.toolconsol ? 142000 : 0);
                const spend = c.copilotseats ? 144000 : 0;
                const net = recovered - spend;
                const span = Math.max(recovered, spend, 1);
                return {
                  show: true,
                  net: fmt(net),
                  netColor: net >= 0 ? "#34d399" : "#f87171",
                  netLabel: net >= 0 ? "returned to the business" : "net new spend",
                  inW: Math.round(recovered / span * 100) + "%",
                  outW: Math.round(spend / span * 100) + "%",
                  inV: fmt(recovered),
                  outV: spend ? fmt(-spend) : "$0"
                };
              })() : { show: false, net: "", inW: "0%", outW: "0%", inV: "", outV: "", netColor: "#34d399", netLabel: "" },
              rows: (s.dive === "licensing" ? (() => {
                const money = (n) => (n < 0 ? "−$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
                const c = s.changes || {};
                const seats = s.licSeats === undefined ? 1308 : s.licSeats;
                const recovered = (1308 - seats) * 648
                  + (c.reclaim ? 847608 - (1308 - seats) * 648 : 0)
                  + (c.rightsize ? 607392 : 0)
                  + (c.toolconsol ? 142000 : 0);
                const spend = (c.copilotseats ? 144000 : 0);
                const net = recovered - spend;
                const pct = (v) => Math.max(2, Math.min(100, Math.round(Math.abs(v) / 1200000 * 100)));
                return [
                  { l: "Licensing pillar", now: String(govNow), then: String(govThen), nowW: govNow + "%", thenW: govThen + "%", gapW: Math.max(0, govThen - govNow) + "%", c: govThen >= 75 ? "#34d399" : govThen > govNow ? "#fbbf24" : "#f87171" },
                  { l: "Copilot readiness", now: rdNow + "%", then: rdThen + "%", nowW: rdNow + "%", thenW: rdThen + "%", gapW: Math.max(0, rdThen - rdNow) + "%", c: rdThen >= 75 ? "#34d399" : rdThen > rdNow ? "#fbbf24" : "#f87171" }
                ];
              })() : [
                { l: (DIVE_CFG[s.dive] ? DIVE_CFG[s.dive].word.charAt(0) + DIVE_CFG[s.dive].word.slice(1).toLowerCase() : "Governance") + " pillar", now: String(govNow), then: String(govThen), nowW: govNow + "%", thenW: govThen + "%", gapW: Math.max(0, govThen - govNow) + "%", c: govThen >= 75 ? "#34d399" : govThen > govNow ? "#fbbf24" : "#f87171" },
                { l: "Copilot readiness", now: rdNow + "%", then: rdThen + "%", nowW: rdNow + "%", thenW: rdThen + "%", gapW: Math.max(0, rdThen - rdNow) + "%", c: rdThen >= 75 ? "#34d399" : rdThen > rdNow ? "#fbbf24" : "#f87171" }
              ]),
              items: ch.list.map(c => ({ l: c.label, short: c.label.length > 26 ? c.label.slice(0, 24) + "…" : c.label })),
              onClear: () => this.setState({ changes: {} })
            };
          })(),
          gauges: (() => {
            const links = s.govLinks === undefined ? 41 : s.govLinks;
            const ext = s.govExt ? 0.45 : 1;
            const inh = s.govInh ? 0.7 : 1;
            const exposure = Math.round(Math.min(100, (links / 41) * 70 * ext * inh + 22 * ext));
            const overshare = Math.round(Math.max(4, 100 - (links / 41) * 58 - (s.govExt ? 0 : 0) - (s.govInh ? 0 : 0) - (s.govExt ? 0 : 14) - (s.govInh ? 0 : 10)));
            const ready = Math.round(Math.max(18, Math.min(96, 34 + (41 - links) * 0.72 + (s.govExt ? 12 : 0) + (s.govInh ? 9 : 0))));
            const col = (v, invert) => { const x = invert ? 100 - v : v; return x >= 75 ? "#34d399" : x >= 45 ? "#fbbf24" : "#f87171"; };
            return [
              { label: "Exposure risk", value: String(exposure) + "%", w: exposure + "%", color: col(exposure, true) },
              { label: "Oversharing score", value: String(overshare) + "/100", w: overshare + "%", color: col(overshare) },
              { label: "Copilot readiness", value: String(ready) + "%", w: ready + "%", color: col(ready) }
            ];
          })(),
          rollup: [
            { id: "orgwide", l: "Sites with org-wide links", v: String(p.sites), c: p.sites > 20 ? "#f87171" : p.sites > 0 ? "#fbbf24" : "#34d399" },
            { id: "teams", l: "Teams with public channels", v: "17", c: "#f87171" },
            { id: "onedrive", l: "OneDrive external shares", v: String(ONEDRIVE.length * 3), c: "#fbbf24" },
            { id: "docs", l: "Documents Copilot can ground on", v: num(p.docs), c: p.docs > 6000 ? "#f87171" : "#fbbf24" },
            { id: "guests", l: "Unmanaged guest identities", v: num(p.guests), c: p.guests > 100 ? "#f87171" : "#34d399" },
            { id: "labels", l: "Sensitivity label coverage", v: p.labelled + "%", c: p.labelled >= 95 ? "#34d399" : "#fbbf24" }
          ].map(x => {
            const ch = this.changeState();
            const num = (str) => Number(String(str).replace(/[^0-9.-]/g, ""));
            const suffix = /%$/.test(x.v) ? "%" : "";
            const on = this.state.changes || {};
            const delta = x.id === "orgwide" ? (on.eeeu ? -41 : 0)
              : x.id === "teams" ? (on.eeeu ? -15 : 0)
              : x.id === "onedrive" ? (on.anonoff ? -36 : 0)
              : x.id === "docs" ? ((on.eeeu ? -8300 : 0) + (on.inherit ? -3100 : 0))
              : x.id === "guests" ? (on.guestexp ? -268 : 0)
              : x.id === "labels" ? (on.labels ? 21 : 0) : 0;
            const thenNum = Math.max(0, num(x.v) + delta);
            const better = x.id === "labels" ? thenNum > num(x.v) : thenNum < num(x.v);
            return Object.assign({}, x, {
              hasThen: !!delta,
              then: (thenNum >= 1000 ? thenNum.toLocaleString("en-US") : String(thenNum)) + suffix,
              thenColor: better ? "#34d399" : "#f87171"
            });
          }).map(x => Object.assign({}, x, {
            border: s.govDetail === x.id ? "{{ dcfg.color }}b3" : "rgba(30,41,59,.9)",
            bg: s.govDetail === x.id ? "{{ dcfg.color }}1f" : "rgba(2,6,23,.5)",
            tip: "From this morning's read-only scan. Click to ask what it means, what it risks, and what closing it changes.",
            spark: [Math.round(Number(String(x.v).replace(/[^0-9]/g, "") || 40) * .55), Math.round(Number(String(x.v).replace(/[^0-9]/g, "") || 40) * .7), Math.round(Number(String(x.v).replace(/[^0-9]/g, "") || 40) * .82), Math.round(Number(String(x.v).replace(/[^0-9]/g, "") || 40) * .93), Number(String(x.v).replace(/[^0-9]/g, "") || 40)].join(","),
            stats: "Trend 90 days|rising|" + x.c + ";In SOW|yes|#6ee7b7",
            change: (Object.keys(CHANGES).find(id => CHANGES[id].match.test(x.l)) || ""),
            onClick: () => this.govExplainSignal(x.id, x.l, x.v)
          })),
          detailOpen: !!s.govDetail,
          detail: (() => {
            const D = {
              orgwide: { t: "Sites with org-wide links", rows: SITES.filter(x => x.type === "SharePoint").map(x => ({ n: x.name, e: x.exposure, r: x.sens, c: x.risk === "critical" ? "#f87171" : "#fbbf24" })) },
              teams: { t: "Teams with public channels", rows: SITES.filter(x => x.type === "Teams").map(x => ({ n: x.name, e: x.exposure, r: x.sens, c: x.risk === "critical" ? "#f87171" : "#fbbf24" })) },
              onedrive: { t: "OneDrive external shares", rows: ONEDRIVE.map(x => ({ n: x.name, e: x.exposure, r: x.sens, c: x.risk === "critical" ? "#f87171" : "#fbbf24" })) },
              docs: { t: "Documents Copilot can ground on", rows: [
                { n: "Flight Ops – Mission Docs", e: "EEEU", r: "Unlabelled", c: "#f87171" },
                { n: "Contracts & Legal", e: "EEEU", r: "Confidential", c: "#f87171" },
                { n: "HR – People Ops", e: "Org-wide link", r: "Confidential", c: "#f87171" },
                { n: "Launch Readiness 2026", e: "EEEU", r: "Partial", c: "#fbbf24" }] },
              guests: { t: "Unmanaged guest identities", rows: [
                { n: "Aerostruct (vendor)", e: "61 guests", r: "Unlabelled", c: "#f87171" },
                { n: "Outside counsel", e: "3 guests", r: "Confidential", c: "#fbbf24" },
                { n: "External case managers", e: "6 guests", r: "PHI", c: "#f87171" },
                { n: "Legacy project guests", e: "242 guests", r: "Mixed", c: "#fbbf24" }] },
              labels: { t: "Sensitivity label coverage", rows: [
                { n: "Clinical libraries", e: "64% labelled", r: "PHI", c: "#fbbf24" },
                { n: "Finance libraries", e: "71% labelled", r: "Confidential", c: "#fbbf24" },
                { n: "Legal libraries", e: "88% labelled", r: "Confidential", c: "#34d399" },
                { n: "Everything else", e: "0% labelled", r: "Unknown", c: "#f87171" }] }
            };
            const d = D[s.govDetail];
            if (!d) return { title: "", rows: [] };
            return { title: d.t, rows: d.rows, onAsk: () => this.govExplainSignal(s.govDetail, d.t, "") };
          })(),
          thread: (s.govThread || []).map(m => {
            const p2 = PERSONAS[m.who] || {};
            const you = m.who === "you";
            return {
              isText: !m.card && !m.sites && !m.copilot && !m.docs && !m.help && !m.win && !m.wobj && !m.hobj && !m.sizer && !m.cpl && m.walk == null, isCard: m.card === "telemetry", isSites: !!m.sites,
              hasFix: !!m.fixActions,
              hasJson: !!(m.hobj && m.hobj.json),
              jsonBefore: (m.hobj && m.hobj.json && m.hobj.json.before) || "",
              jsonAfter: (m.hobj && m.hobj.json && m.hobj.json.after) || "",
              scores: (m.hobj ? [m.hobj.score, m.hobj.score2].filter(Boolean) : []).map(x => ({ l: x[0], a: x[1], b: x[2] })),
              hasLedger: !!(m.hobj && m.hobj.pos && m.hobj.neg),
              pos: ((m.hobj && m.hobj.pos) || []).map(v => ({ v })),
              neg: ((m.hobj && m.hobj.neg) || []).map(v => ({ v })),
              hasRoles: !!(m.hobj && m.hobj.roles && m.hobj.roles.length),
              roles: ((m.hobj && m.hobj.roles) || []).map(r => {
                const avoid = /not required/i.test(r[1]);
                const soft = /sufficient/i.test(r[1]);
                const c = avoid ? "#64748b" : soft ? "#7dd3fc" : "#fbbf24";
                return { n: r[0], d: r[1], c: c, border: c + "55", bg: c + "12" };
              }),
              hasTiers: !!(m.hobj && m.hobj.tiers && m.hobj.tiers.length),
              tiers: ((m.hobj && m.hobj.tiers) || []).map(t => ({ l: t.l, t: t.t, who: t.who, c: t.c, border: t.c + "55", bg: t.c + "12" })),
              blast: ((m.hobj && m.hobj.blast) || []).map(v => ({ v })),
              onFixUi: () => this.emitRunbook(m.fixActions, "ui"),
              onFixPs: () => this.emitRunbook(m.fixActions, "ps"),
              backShow: m.back != null && !!walkAt(m.back),
              backLabel: m.back != null && walkAt(m.back) ? "Back to " + walkAt(m.back).title : "",
              onBack: () => { if (m.back != null) this.govWalkTo(m.back); },
              isCpl: !!m.cpl,
              cpl: m.cpl ? {
                prompt: m.cpl.prompt, title: m.cpl.title, answer: m.cpl.answer, warn: m.cpl.warn,
                cites: m.cpl.cites.map((c, i) => ({ n: String(i + 1), c: c })),
                rows: m.cpl.rows.map(r => ({ l: r[0], v: r[1] }))
              } : null,
              isSizer: !!m.sizer,
              sizer: m.sizer ? (() => {
                const sz = s.sizer || {};
                const money = (n) => (n < 0 ? "−$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
                let nowTotal = 0, thenTotal = 0;
                const rows = LIC_SKUS.map(k => {
                  const need = k.invest ? 400 : Math.max(k.assigned, 0);
                  const val = sz[k.id] === undefined ? k.purchased : sz[k.id];
                  nowTotal += k.purchased * k.cost * 12;
                  thenTotal += val * k.cost * 12;
                  const gap = val - need;
                  return {
                    id: k.id, label: k.name,
                    need: need.toLocaleString("en-US"),
                    val: val.toLocaleString("en-US"),
                    valRaw: String(val),
                    max: String(Math.max(k.purchased, need) + 200),
                    cost: money(val * k.cost * 12),
                    unit: "$" + k.cost + "/seat/mo",
                    gapLabel: gap === 0 ? "matched" : gap > 0 ? gap.toLocaleString("en-US") + " over" : Math.abs(gap).toLocaleString("en-US") + " short",
                    gapColor: gap === 0 ? "#34d399" : gap > 0 ? "#fbbf24" : "#f87171",
                    barW: Math.max(2, Math.min(100, Math.round(val / (Math.max(k.purchased, need) + 200) * 100))) + "%",
                    needW: Math.max(2, Math.min(100, Math.round(need / (Math.max(k.purchased, need) + 200) * 100))) + "%",
                    onChange: (e) => this.setSku(k.id, Number(e.target.value)),
                    onMatch: () => this.setSku(k.id, need)
                  };
                });
                const delta = thenTotal - nowTotal;
                return {
                  rows: rows,
                  nowTotal: money(nowTotal), thenTotal: money(thenTotal),
                  delta: (delta > 0 ? "+" : "") + money(delta).replace("−", "−"),
                  deltaColor: delta < 0 ? "#34d399" : delta > 0 ? "#fbbf24" : "#94a3b8",
                  deltaLabel: delta < 0 ? "saved a year" : delta > 0 ? "extra a year" : "no change",
                  onMatchAll: () => this.setState({ sizer: LIC_SKUS.reduce((a, k) => { a[k.id] = k.invest ? 400 : k.assigned; return a; }, {}) }),
                  onReset: () => this.setState({ sizer: {} })
                };
              })() : null,
              isWin: !!(m.win || m.wobj),
              win: (m.wobj || (m.win && QUICK_WINS[m.win])) ? (() => {
                const w = m.wobj || QUICK_WINS[m.win];
                return {
                  title: w.title, isUi: (w.kind || "ui") === "ui", isPs: w.kind === "ps",
                  tone: w.tier === "expert" ? "#f87171" : w.tier === "intermediate" ? "#fbbf24" : "#34d399",
                  toneInk: w.tier === "expert" ? "#450a0a" : w.tier === "intermediate" ? "#422006" : "#052e16",
                  tierLabel: (w.tier === "expert" ? "EXPERT" : w.tier === "intermediate" ? "INTERMEDIATE" : "BEGINNER") + " · DO IT YOURSELF",
                  why: w.why, minutes: w.minutes, risk: w.risk, owner: w.owner,
                  steps: (w.steps || []).map((st2, k) => ({
                    n: String(k + 1), t: st2.t,
                    hasLink: !!st2.link, linkLabel: st2.link ? st2.link.l : "", linkUrl: st2.link ? st2.link.u : "",
                    hasCopy: !!st2.copy, copy: st2.copy || "",
                    onAsk: () => this.askWinStep(w.id, k + 1, st2.t),
                    onCopy: () => { if (st2.copy && navigator.clipboard) navigator.clipboard.writeText(st2.copy); }
                  })),
                  hasPrereq: !!w.prereq, prereq: w.prereq || "",
                  perms: (w.perms || []).map(v => ({ v, onAsk: () => this.askWin(w.id, "Why do I need " + v + "?") })),
                  script: w.script || "",
                  onCopyScript: () => { if (w.script && navigator.clipboard) navigator.clipboard.writeText(w.script); },
                  onCopyPrereq: () => { if (w.prereq && navigator.clipboard) navigator.clipboard.writeText(w.prereq); },
                  verify: w.verify, undo: w.undo,
                  qs: [
                    ["What does this actually change?", "effect"],
                    ["Any side effects I should know about?", "side"],
                    ["Can I undo it?", "undo"],
                    ["Who needs to run it?", "who"]
                  ].map(pair => ({ l: pair[0], onClick: () => this.askWin(w.id, pair[0]) }))
                };
              })() : null,
              isWalk: m.walk != null,
              walk: m.walk != null && walkAt(m.walk) ? (() => {
                const w = walkAt(m.walk);
                return {
                  n: w.n, title: w.title, hasLead: !!m.lead, lead: m.lead || "",
                  isGate: !!w.gate,
                  ...(function () {
                    if (!w.gate) return {};
                    const ch = this.changeState();
                    const now = 34, then = Math.min(64, 34 + ch.ready);
                    const cleared = then >= 75;
                    const col = cleared ? "#34d399" : then > now ? "#fbbf24" : "#f87171";
                    const blockers = [
                      { id: "eeeu", t: "Org-wide sharing closed — 41 sites publishing tenant-wide" },
                      { id: "labels", t: "Regulated content labelled — 40,480 files unclassified" },
                      { id: "anonoff", t: "Anonymous links removed — 23 with no identity behind them" },
                      { id: "guestexp", t: "Guest access reviewed — 612 standing identities" },
                      { id: "inherit", t: "Permission inheritance restored — 128 break points" }
                    ];
                    const on = this.state.changes || {};
                    const open = blockers.filter(b => !on[b.id]).length;
                    return {
                      gateColor: col,
                      gateEdge: col + "66",
                      gateWash: col + "1f",
                      gateIcon: cleared ? "m5 12 5 5L20 7" : "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z",
                      gateVerdict: cleared ? "CLEARED — governance no longer blocks" : open === blockers.length ? "BLOCKED RIGHT NOW" : "STILL BLOCKED — " + open + " to go",
                      gateNow: String(now) + "%",
                      gateThen: String(then) + "%",
                      gateNowW: now + "%", gateThenW: then + "%", gateGapW: Math.max(0, then - now) + "%",
                      gateBlockLabel: open ? open + " of " + blockers.length + " governance blockers still open" : "All governance blockers answered",
                      gateBlockers: blockers.map(b => ({
                        t: b.t,
                        c: on[b.id] ? "#34d399" : "#f87171",
                        ink: on[b.id] ? "#6ee7b7" : "#fecaca",
                        icon: on[b.id] ? "m5 12 5 5L20 7" : "M18 6 6 18M6 6l12 12"
                      })),
                      gateNote: cleared
                        ? "Governance is clear. The remaining pillars — licensing, adoption, compliance, health, security — still have to answer before a tenant-wide rollout."
                        : "Every switch you flip on these cards moves the needle. Governance alone can carry you to 64% — the other five pillars close the last eleven points to the 75% gate."
                    };
                  }).call(this),
                  hasTimeline: !!w.timeline,
                  gantt: w.timeline ? (function () {
                    const bars = [
                      { l: "Baseline correction", p: "Governance", c: "#3B82F6", s: 1, e: 2, own: "Platform" },
                      { l: "Close org-wide sharing", p: "Governance", c: "#3B82F6", s: 1, e: 3, own: "Collaboration" },
                      { l: "DLP scope + CA01", p: "Security", c: "#8B5CF6", s: 3, e: 5, own: "Security" },
                      { l: "Label the backlog", p: "Compliance", c: "#F3F4F6", s: 4, e: 7, own: "Compliance" },
                      { l: "Licence right-size", p: "Licensing", c: "#14B8A6", s: 4, e: 5, own: "Licensing" },
                      { l: "Device baseline", p: "Health", c: "#22C55E", s: 5, e: 8, own: "Operations" },
                      { l: "Persona enablement", p: "Adoption", c: "#F97316", s: 6, e: 9, own: "Change" },
                      { l: "Pilot cohort live", p: "Copilot", c: "#67E8F9", s: 8, e: 11, own: "Shane" },
                      { l: "Re-measure + certify", p: "Copilot", c: "#67E8F9", s: 11, e: 12, own: "Shane" }
                    ];
                    return bars.map(b => ({
                      l: b.l, p: b.p, c: b.c, own: b.own,
                      span: "W" + b.s + "–" + b.e,
                      left: (((b.s - 1) / 12) * 100).toFixed(2) + "%",
                      width: (((b.e - b.s + 1) / 12) * 100).toFixed(2) + "%"
                    }));
                  })() : [],
                  ganttScale: w.timeline ? Array.from({ length: 12 }, (_, i) => ({ n: "W" + (i + 1) })) : [],
                  milestones: w.timeline ? [
                    { w: "W2", l: "Org-wide sharing closed", c: "#3B82F6", r: "34 → 52" },
                    { w: "W5", l: "DLP + CA01 enforcing", c: "#8B5CF6", r: "52 → 61" },
                    { w: "W7", l: "Regulated content labelled", c: "#F3F4F6", r: "61 → 68" },
                    { w: "W8", l: "Pilot cohort licensed", c: "#67E8F9", r: "68 → 71" },
                    { w: "W12", l: "Gate certified", c: "#34d399", r: "71 → 78" }
                  ] : [],
                  burnup: w.timeline ? [34, 44, 52, 56, 61, 64, 68, 71, 73, 75, 77, 78].map((v, i) => ({
                    n: "W" + (i + 1), v: String(v),
                    h: Math.round(((v - 30) / 50) * 100) + "%",
                    c: v >= 75 ? "#34d399" : v >= 60 ? "#fbbf24" : "#f87171"
                  })) : [],
                  weeks: w.timeline ? TIMELINE.map((t, i) => ({
                    w: t.w, title: t.title, color: t.color,
                    n: String(i + 1),
                    items: t.items.map(v => ({ v: v }))
                  })) : [],
                  hasLibrary: w.id === "library",
                  dlAllTitle: "The complete assessment pack",
                  dlAllMeta: DOC_LIBRARY.length + " documents · " + DOC_LIBRARY.reduce((a, d) => a + d.pages, 0) + " pages · " + (Math.round(DOC_LIBRARY.reduce((a, d) => a + d.pages, 0) * 0.09 * 10) / 10) + " MB zip",
                  onDownloadAll: () => this.grabAll(),
                  library: w.id === "library" ? DOC_LIBRARY.map(d => ({
                    n: d.n, title: d.title, pillar: d.pillar, color: d.color,
                    summary: d.summary, ai: d.ai,
                    meta: d.pages + " pp · " + d.tables + " tables · " + d.playbooks + " playbooks",
                    findings: d.findings ? d.findings + " findings" : "decision record",
                    state: (s.dlDone || {})[d.key] ? "Downloaded · " + (s.dlDone || {})[d.key] : "Ready · " + Math.round(d.pages * 0.09 * 10) / 10 + " MB",
                    stateInk: (s.dlDone || {})[d.key] ? "#34d399" : "#64748b",
                    onPdf: () => this.grabDoc(d, "PDF"),
                    onDocx: () => this.grabDoc(d, "DOCX"),
                    onOpen: () => this.setState({ dive: d.key === "sow" ? "sow" : d.key, govDoc: d.key !== "sow", playing: false })
                  })) : [],
                  hasScoping: !!w.scoping,
                  phases: (function () {
                    if (!w.scoping) return [];
                    const out = s.sowOut || {};
                    const money = (n) => "$" + n.toLocaleString("en-US");
                    return SOW_PHASES.map(p => {
                      const dropped = !!out[p.id];
                      return {
                        n: p.n, title: p.title, weeks: p.weeks, detail: p.detail, owner: p.owner,
                        price: p.price === 0 ? "included" : money(p.price) + (p.recurring ? " / mo" : ""),
                        readiness: "+" + p.readiness,
                        items: p.items.map(v => ({ v: v })),
                        fixed: !!p.fixed, scopable: !p.fixed,
                        state: dropped ? "REMOVED" : p.fixed ? "REQUIRED" : "IN SCOPE",
                        ink: dropped ? "#64748b" : p.fixed ? "#7dd3fc" : "#6ee7b7",
                        border: dropped ? "rgba(51,65,85,.9)" : p.fixed ? "rgba(0,120,212,.5)" : "rgba(52,211,153,.45)",
                        bg: dropped ? "rgba(2,6,23,.4)" : p.fixed ? "rgba(0,120,212,.08)" : "rgba(16,185,129,.07)",
                        opacity: dropped ? "0.5" : "1",
                        btnLabel: dropped ? "Put back in scope" : "Remove from scope",
                        btnColor: dropped ? "#6ee7b7" : "#94a3b8",
                        onToggle: () => this.togglePhase(p.id)
                      };
                    });
                  })(),
                  totals: (function () {
                    if (!w.scoping) return null;
                    const t = this.sowTotals();
                    const money = (n) => "$" + n.toLocaleString("en-US");
                    return {
                      price: money(t.price), monthly: t.monthly ? money(t.monthly) + " / mo" : "not taken",
                      readiness: t.readiness + "%",
                      readinessColor: t.readiness >= 75 ? "#34d399" : t.readiness >= 60 ? "#fbbf24" : "#f87171",
                      gate: t.readiness >= 75 ? "Gate cleared" : "Below the 75% gate",
                      gateColor: t.readiness >= 75 ? "#34d399" : "#f87171",
                      removed: t.removed ? t.removed + (t.removed === 1 ? " phase removed" : " phases removed") : "full scope",
                      barW: Math.min(100, t.readiness) + "%"
                    };
                  }).call(this),
                  hasConsole: w.id === "prove",
                  draft: s.cplDraft === undefined ? "Summarise what Flight Ops – Mission Docs contains" : s.cplDraft,
                  runLabel: s.cplRunning ? "Running…" : "Run",
                  onDraft: (e) => this.setState({ cplDraft: e.target.value }),
                  onKey: (e) => { if (e.key === "Enter") this.runCplPrompt(s.cplDraft === undefined ? "Summarise what Flight Ops – Mission Docs contains" : s.cplDraft); },
                  onRun: () => this.runCplPrompt(s.cplDraft === undefined ? "Summarise what Flight Ops – Mission Docs contains" : s.cplDraft),
                  presets: [
                    ["What are our termination terms with Aerostruct?", "Contracts"],
                    ["What is the current salary band structure?", "Compensation"],
                    ["Show me clinical protocol CP-114", "Clinical"],
                    ["What are we spending on licences we do not use?", "Cost"]
                  ].map(p => ({ l: p[1], onClick: () => this.runCplPrompt(p[0]) })),
                  hasSwitches: changesForSection(w.title).length > 0,
                  switches: changesForSection(w.title).filter(id => {
                    const SETS = {
                      licensing: ["reclaim", "rightsize", "copilotseats", "groupassign", "toolconsol"],
                      adoption: ["transcribe", "champions", "roletracks", "libraries", "measure"],
                      compliance: ["labels", "dlpscope", "dlpcopilot", "part2", "retention", "aicontrol"],
                      health: ["baseline", "runbooks", "pimadmins", "restore"],
                      security: ["ca01", "ca02", "dlpscope", "dlpcopilot", "riskpol", "oauth", "session", "aidetect", "pimadmins"],
                      copilot: ["eeeu", "labels", "dlpscope", "dlpcopilot", "ca01", "baseline", "copilotseats", "transcribe", "champions", "reclaim"]
                    };
                    const mine = SETS[s.dive];
                    if (mine) return mine.indexOf(id) >= 0;
                    const others = Object.keys(SETS).reduce((a, x) => a.concat(SETS[x]), []);
                    return others.indexOf(id) < 0;
                  }).map(id => {
                    const c = CHANGES[id];
                    const on = !!(s.changes || {})[id];
                    return {
                      label: c.verb, note: on ? c.note : "Not applied — flip to model it.",
                      ink: on ? "#6ee7b7" : "#e2e8f0",
                      justify: on ? "flex-end" : "flex-start",
                      track: on ? "#34d399" : "#334155",
                      onToggle: () => this.applyChange(id)
                    };
                  }),
                  headV: w.head.v, headL: w.head.l, headTone: w.head.tone, headNote: w.head.note,
                  onHead: () => this.walkAsk(m.walk, "head", w.head.l, w.head.v),
                  onTitle: () => this.walkAsk(m.walk, "topic", w.title, w.head.v),
                  headTip: w.head.note + ". Click to ask what this number means and what moves it.",
                  spark: [12, 19, 24, 31, 36, 41].join(","),
                  stats: (w.delta || []).slice(0, 2).map(d => d[0] + "|" + d[1] + " → " + d[2] + "|#6ee7b7").join(";"),
                  change: (Object.keys(CHANGES).find(id => CHANGES[id].match.test(w.title)) || ""),
                  titleTip: w.title + " — one of five governance topics. Click to ask why it matters and what closing it involves.",
                  chartTitle: w.chartTitle,
                  isBars: w.chartKind === "bars", isHeat: w.chartKind === "heat",
                  bars: (w.bars || []).map(b => Object.assign({}, b, {
                    w: b.pct + "%",
                    tip: b.flag + " — measured this morning across 1,204 sites. " + (w.head.note || ""),
                    spark: [Math.round(b.pct * .42), Math.round(b.pct * .55), Math.round(b.pct * .61), Math.round(b.pct * .78), Math.round(b.pct * .9), b.pct].join(","),
                    stats: "90-day trend|" + (b.pct > 60 ? "rising" : "flat") + "|" + b.c + ";Threshold|" + (b.pct > 60 ? "breached" : "within") + "|" + b.c,
                    change: (Object.keys(CHANGES).find(id => CHANGES[id].match.test(b.l)) || ""),
                    onClick: () => this.walkAsk(m.walk, "bar", b.l, b.v)
                  })),
                  heat: (w.heat || []).map(h => Object.assign({}, h, {
                    bg: h.c + "1f", bd: h.c + "66",
                    tip: h.sub + ". A first-line account resolves to this today, and Copilot returns it with a citation.",
                    stats: "Reachable by|1,876 accounts|" + h.c + ";Classification|" + (/label/i.test(h.sub) ? h.sub.replace(/.*?(\d+% labelled).*/, "$1") : "inherited") + "|#94a3b8",
                    change: (Object.keys(CHANGES).find(id => CHANGES[id].match.test(h.l)) || ""),
                    onClick: () => this.walkAsk(m.walk, "heat", h.l, h.v)
                  })),
                  wrong: (w.wrong || []).map(v => ({ v, tip: "Finding. Click to ask how serious this is and what the fix is.", onClick: () => this.walkAsk(m.walk, "wrong", v, "") })),
                  fix: (w.fix || []).map((v, i) => ({ v, n: String(i + 1),
                    tip: walkPillarRef.current === "remediation"
                      ? "Remediation action. Click and I'll give you the admin-centre steps or the PowerShell."
                      : "Remediation step. Click to ask what it involves and whether you can run it yourselves.",
                    onClick: () => walkPillarRef.current === "remediation"
                      ? this.selfFix(v, "Walk me through this one — " + v)
                      : this.walkAsk(m.walk, "fix", v, "") })),
                  delta: (w.delta || []).map(d => ({ l: d[0], before: d[1], after: d[2], tip: d[0] + ": " + d[1] + " today, " + d[2] + " once this topic closes. Click to ask what the projection assumes.", onClick: () => this.walkAsk(m.walk, "delta", d[0], d[1]) }))
                };
              })() : null,
              isHelp: !!(m.hobj || (m.help && this.helpFor(m.help))),
              help: (m.hobj || (m.help && this.helpFor(m.help))) ? (() => {
                const h = m.hobj || this.helpFor(m.help);
                const simOn = h.sim ? !!(s.sims || {})[h.sim.id] : false;
                return {
                  title: h.title, what: h.what, why: h.why, note: h.note,
                  whyWarn: /blast radius|exposes|locks? (you|the tenant)|loses access|reportable/i.test(h.why || ""),
                  whyPlain: !/blast radius|exposes|locks? (you|the tenant)|loses access|reportable/i.test(h.why || ""),
                  hasSim: !!h.sim,
                  simBorder: simOn ? "rgba(52,211,153,.5)" : "rgba(51,65,85,.9)",
                  simBg: simOn ? "rgba(16,185,129,.1)" : "rgba(2,6,23,.6)",
                  sim: h.sim ? {
                    label: h.sim.label,
                    justify: simOn ? "flex-end" : "flex-start",
                    track: simOn ? "#34d399" : "#334155",
                    tone: simOn ? "#6ee7b7" : "#94a3b8",
                    effect: simOn ? h.sim.on : h.sim.off,
                    onToggle: () => this.setState(st => ({ sims: Object.assign({}, st.sims, { [h.sim.id]: !(st.sims || {})[h.sim.id] }) }))
                  } : null,
                  hasChanges: !!(h.fixKey),
                  changes: (() => {
                    const k = String(h.fixKey || h.title || "").toLowerCase();
                    let pick = Object.keys(CHANGES).filter(id => CHANGES[id].match.test(k));
                    const sect = changesForSection(h.section || h.title);
                    if (sect.length) pick = pick.concat(sect.filter(x => pick.indexOf(x) < 0));
                    const SETS = {
                      licensing: ["reclaim", "rightsize", "copilotseats", "groupassign", "toolconsol"],
                      adoption: ["transcribe", "champions", "roletracks", "libraries", "measure"],
                      compliance: ["labels", "dlpscope", "dlpcopilot", "part2", "retention", "aicontrol"],
                      health: ["baseline", "runbooks", "pimadmins", "restore"],
                      security: ["ca01", "ca02", "dlpscope", "dlpcopilot", "riskpol", "oauth", "session", "aidetect", "pimadmins"],
                      copilot: ["eeeu", "labels", "dlpscope", "dlpcopilot", "ca01", "baseline", "copilotseats", "transcribe", "champions", "reclaim"]
                    };
                    const mine = SETS[s.dive] || null;
                    const others = Object.keys(SETS).filter(x => x !== s.dive).reduce((a, x) => a.concat(SETS[x]), []);
                    pick = mine ? pick.filter(x => mine.indexOf(x) >= 0) : pick.filter(x => others.indexOf(x) < 0);
                    if (!pick.length && !mine && /eeeu|everyone except/.test(k)) pick.push("eeeu");
                    const fallback = s.dive === "licensing" ? ["reclaim", "rightsize", "copilotseats"]
                      : s.dive === "adoption" ? ["transcribe", "champions", "roletracks"]
                      : s.dive === "compliance" ? ["labels", "dlpcopilot", "retention"]
                      : s.dive === "health" ? ["baseline", "runbooks", "pimadmins"]
                      : s.dive === "security" ? ["ca01", "dlpcopilot", "riskpol"]
                      : s.dive === "copilot" ? ["eeeu", "labels", "dlpscope"]
                      : ["eeeu", "dlpscope", "ca01"];
                    const ids = (pick.length ? pick : fallback).slice(0, 3);
                    const on = s.changes || {};
                    return ids.map(id => ({
                      l: on[id] ? "✓ " + CHANGES[id].verb : CHANGES[id].verb,
                      c: on[id] ? "#052e16" : "#6ee7b7",
                      bg: on[id] ? "#34d399" : "rgba(16,185,129,.12)",
                      bd: on[id] ? "#34d399" : "rgba(52,211,153,.5)",
                      onClick: () => this.applyChange(id)
                    }));
                  })(),
                  hasAsks: !!(h.asks && h.asks.length),
                  asks: (h.asks || []).map(a => ({ l: a, onClick: () => {
                    if (/ourselves|self[- ]?serve|do it ourselves|on our own/i.test(a)) this.selfFix(h.fixKey || h.title, a);
                    else this.followUp(a, h, m.back);
                  } })),
                  pairs: h.before.map((b, i) => ({ l: b[0], before: b[1], after: h.after[i][1] }))
                };
              })() : { title: "", what: "", why: "", note: "", pairs: [] },
              isDocs: !!m.docs,
              docSet: m.docs && this.govDocSets[m.docs] ? {
                rows: this.govDocSets[m.docs].rows.map(x => ({
                  name: x[0], where: x[1], cls: x[2], grant: x[3],
                  clsColor: /PHI|Confidential|42 CFR|Financial|PII|Contractual/.test(x[2]) ? "#f87171" : x[2] === "No label" ? "#fbbf24" : "#94a3b8"
                })),
                warn: this.govDocSets[m.docs].warn
              } : { rows: [], warn: "" },
              isCopilot: !!m.copilot,
              cp: m.copilot ? {
                prompt: m.copilot.prompt,
                body: m.copilot.body.map(t => ({ t })),
                cites: m.copilot.cites.map((c, i) => ({ n: String(i + 1), c })),
                warn: m.copilot.warn
              } : { prompt: "", body: [], cites: [], warn: "" },
              siteRows: m.sites ? [
                ["/sites/flight-ops-mission-docs", "EEEU · Edit", "41,208 files"],
                ["/sites/contracts-legal", "EEEU · Read", "8,412 files"],
                ["/sites/hr-people-ops", "Org-wide link", "6,730 files"],
                ["/sites/launch-readiness-2026", "EEEU · Edit", "22,116 files"],
                ["/sites/finance-fy26-planning", "Anyone link", "2,884 files"],
                ["/sites/vendor-aerostruct", "Guest · 61", "3,204 files"],
                ["/sites/clinical-protocols-archive", "EEEU · Read", "17,940 files"],
                ["/sites/revenue-cycle-denials", "Org-wide link", "5,118 files"],
                ["/sites/eng-all-hands", "EEEU · Read", "18,502 files"],
                ["/sites/quality-incident-review", "Anyone link", "1,406 files"]
              ].map(r => ({ url: "contoso.sharepoint.com" + r[0], grant: r[1], files: r[2] })) : [],
              hasActions: !!(m.actions && m.actions.length),
              actions: (function (list) {
                const acts = list || [];
                const isAdv = (x) => {
                  const hasAdvance = acts.some(y => /^(walk:|next|tolicensing)/.test(String(y[1])));
                  return hasAdvance ? /^(walk:|next|tolicensing)/.test(String(x[1])) : /^(win:|next)/.test(String(x[1]));
                };
                return acts.slice().sort((p, q) => (isAdv(p) ? 1 : 0) - (isAdv(q) ? 1 : 0));
              })(m.actions).map((a, ai) => {
                const acts = m.actions || [];
                const hasAdvance = acts.some(x => /^(walk:|next|tolicensing)/.test(String(x[1])));
                const adv = hasAdvance ? /^(walk:|next|tolicensing)/.test(String(a[1])) : /^(win:|next)/.test(String(a[1]));
                return {
                  label: a[0],
                  isPrimary: adv,
                  order: adv ? 2 : 1,
                  pad: adv ? "15px" : "12px",
                  weight: adv ? "800" : "600",
                  color: adv ? "#052e16" : "#94a3b8",
                  borderCss: adv ? "none" : "1px solid rgba(51,65,85,.9)",
                  bg: adv ? "#34d399" : "rgba(2,6,23,.5)",
                  glow: adv ? "0 0 22px rgba(16,185,129,.4)" : "none",
                  onClick: () => this.govAdvance(a[1])
                };
              }),
              _unused: (m.actions || []).map((a, ai) => ({
                label: a[0],
                color: ai === 0 ? "#fff" : "#c4b5fd",
                bg: ai === 0 ? "#3B82F6" : "{{ dcfg.color }}1a",
                border: ai === 0 ? "#3B82F6" : "{{ dcfg.color }}73",
                onClick: () => this.govAdvance(a[1])
              })),
              name: you ? "You" : p2.name, color: you ? "#22d3ee" : p2.color,
              tile: you ? "linear-gradient(135deg,#1e293b,#334155)" : p2.tile,
              initials: you ? "YOU" : p2.initials,
              photo: you ? "" : "avatars/" + m.who + ".png",
              slot: "gov-th-" + m.who,
              showPhoto: !you,
              text: m.text || "",
              align: you ? "row-reverse" : "row",
              bg: you ? "rgba(34,211,238,.1)" : "rgba(2,6,23,.62)",
              border: you ? "rgba(34,211,238,.3)" : "rgba(30,41,59,.9)"
            };
          }),
          threadEmpty: (s.govThread || []).length === 0,
          typing: (() => {
            const w = s.govTyping;
            if (!w) return { show: false, name: "", color: "transparent", tile: "transparent", photo: "", slot: "" };
            const p3 = PERSONAS[w] || {};
            return { show: true, name: p3.name + " is typing", color: p3.color, tile: p3.tile, photo: "avatars/" + w + ".png", slot: "gov-typing-" + w };
          })(),
          showDoc: !!s.govDoc,
          cols: s.govDoc ? "minmax(0,.78fr) minmax(360px,1.45fr)" : "minmax(300px,1fr) minmax(300px,.92fr)",
          tight: !!s.govDoc,
          gridStats: s.govDoc ? "minmax(0,1fr)" : "repeat(2,minmax(0,1fr))",
          gridDelta: s.govDoc
            ? "minmax(0,1fr) minmax(0,1fr) 10px minmax(0,1fr)"
            : "minmax(0,1.4fr) minmax(0,.85fr) 12px minmax(0,.85fr)",
          deltaLabel: s.govDoc ? "9.5px" : "10.5px",
          deltaNow: s.govDoc ? "10px" : "11.5px",
          deltaAfter: s.govDoc ? "10.5px" : "12px",
          cardPad: s.govDoc ? "10px 11px" : "13px 14px",
          headSize: s.govDoc ? "20px" : "26px",
          // the pin only appears once the persona has finished presenting this view
          pinShow: (() => {
            const th = s.govThread || [];
            if (!th.length || s.govTyping) return false;
            return !!(th[th.length - 1] && th[th.length - 1].actions) || th.some(m => m.who === "you");
          })(),
          pin: (() => {
            const v = s.govView || 0;
            const p = this.govPrompts[v];
            return {
              text: v === 2
                ? "Take your time on the engine surfaces. Let us know when you're ready to move on."
                : "Ask us anything about what's on the board. Let us know when you're ready to move on.",
              cta: p.actions[0][0],
              onCta: () => this.govAdvance(p.actions[0][1]),
              ctaShow: (() => {
                const key = String(s.govAt || "c0");
                if (key[0] !== "c") return false;          // only the customer arc hands off to the next view
                const set = walkSet(key);
                return Number(key.slice(1)) >= set.length - 1;
              })(),
              hasBack: true,
              backLabel: (() => { const w = walkAt(s.govAt || "c0"); return "Back to " + (w ? w.title : "the topic"); })(),
              onBack: () => this.govWalkTo(s.govAt || "c0")
            };
          })(),
          viewTabs: this.diveViews(s).map((v, i) => ({
            label: v.label,
            color: (s.govView || 0) === i ? "#f1f5f9" : "#94a3b8",
            border: (s.govView || 0) === i ? "{{ dcfg.color }}b3" : "rgba(51,65,85,.85)",
            bg: (s.govView || 0) === i ? "{{ dcfg.color }}2e" : "rgba(2,6,23,.5)",
            onClick: () => this.setState({ govView: i })
          })),
          viewKicker: (this.diveViews(s)[Math.min(s.govView || 0, this.diveViews(s).length - 1)]).kicker,
          viewSections: (this.diveViews(s)[Math.min(s.govView || 0, this.diveViews(s).length - 1)]).sections.map(sec => ({
            h: sec.h,
            active: (() => {
              walkPillarRef.current = DIVE_CFG[s.dive] ? s.dive : "governance";
              const w = walkAt(s.govAt || "c0");
              if (!w) return false;
              const norm = (x) => String(x).toLowerCase().replace(/[^a-z]/g, "");
              return norm(sec.h) === norm(w.title);
            })(),
            rows: sec.rows.map(r => ({
              l: r[0], v: r[1],
              after: (() => {
                const on = s.changes || {};
                const L = r[0].toLowerCase();
                if (/eeeu/.test(L) && /enabled|present/.test(L)) return on.eeeu ? "No" : null;
                if (/eeeu risk/.test(L)) return on.eeeu ? "None" : null;
                if (/organization.? links|org-?wide links/.test(L)) return on.eeeu ? (/·/.test(r[1]) ? "0 · SP 0 / TM 0 / OD 0" : "0") : null;
                if (/anonymous/.test(L)) return on.anonoff ? "0" : null;
                if (/overshared sharepoint sites/.test(L)) return on.eeeu ? "0" : null;
                if (/public teams channels/.test(L)) return on.eeeu ? "2" : null;
                if (/unmanaged or orphaned channels|channel sprawl/.test(L)) return on.eeeu ? "12" : null;
                if (/no sensitivity label|unlabelled file percentage/.test(L)) return on.labels ? "1%" : null;
                if (/mission-critical libraries unlabelled|libraries drifting/.test(L)) return on.labels ? "0" : null;
                if (/high-risk data exposed|high-risk categories/.test(L)) return on.labels ? "labelled" : null;
                if (/external guest accounts|external guest identities/.test(L)) return on.guestexp ? "344" : null;
                if (/unmanaged guest identities/.test(L)) return on.guestexp ? "44" : null;
                if (/external domains|federated external domains|external domain exposure/.test(L)) return on.guestexp ? "19" : null;
                if (/documents copilot can see with no owner|groundable docs|no owner/.test(L)) return (on.eeeu || on.inherit) ? "3,100" : null;
                if (/unlabelled content visible to copilot|overshared or unlabelled visible|overshared \/ unlabelled visible/.test(L)) return on.labels ? "1,120" : null;
                if (/readiness blocked by governance|readiness score impact/.test(L)) {
                  const ch = this.changeState();
                  return ch.gov ? "−" + Math.max(0, 17 - Math.round(ch.gov * 0.5)) + " pts" : null;
                }
                if (/permission sprawl groups|sprawl groups/.test(L)) return on.inherit ? "9" : null;
                if (/broken inheritance|inheritance breaks/.test(L)) return on.inherit ? "12" : null;
                if (/nested|legacy depth|permission depth/.test(L)) return on.inherit ? "2 levels" : null;
                if (/conditional access gaps/.test(L)) return on.ca01 ? (/^\d/.test(String(r[1])) ? "0" : "CA01 enabled") : null;
                if (/library configuration drift|policy compliance drift|labeling drift/.test(L)) return on.inherit ? "0" : null;
                if (/services affected/.test(L)) return on.eeeu ? "none" : null;
                if (/paid but unassigned/.test(L)) return on.reclaim ? "0" : null;
                if (/annual waste/.test(L)) return on.reclaim ? "$0" : null;
                if (/seats provisioned/.test(L)) return on.reclaim ? "4,872" : null;
                if (/over-licensed/.test(L)) return on.rightsize ? "0" : null;
                if (/under-licensed/.test(L)) return on.rightsize ? "0" : null;
                if (/departed, still licensed/.test(L)) return on.reclaim ? "0" : null;
                if (/copilot owned \/ assigned/.test(L)) return on.copilotseats ? "400 / 400" : null;
                if (/eligible under governance/.test(L)) return on.copilotseats ? "1,535" : null;
                if (/required for pilot/.test(L)) return on.copilotseats ? "assigned" : null;
                if (/recoverable in year one/.test(L)) return (on.reclaim || on.toolconsol) ? "claimed" : null;
                if (/duplicate tooling|duplicate annual spend/.test(L)) return on.toolconsol ? "$0" : null;
                if (/licensing meter/.test(L)) return (on.reclaim || on.rightsize) ? "88%" : null;
                if (/monthly cost of delay/.test(L)) return on.reclaim ? "$0" : null;
                if (/e5 assignment rate/.test(L)) return on.rightsize ? "97%" : null;
                if (/copilot assignment rate/.test(L)) return on.copilotseats ? "100%" : null;
                if (/group-based assignment/.test(L)) return on.groupassign ? "100%" : null;
                if (/reclaim sla/.test(L)) return on.groupassign ? "5 days" : null;
                if (/seats on duplicate tools/.test(L)) return on.toolconsol ? "0" : null;
                if (/contracts unmapped/.test(L)) return on.toolconsol ? "0" : null;
                if (/next-year spend, current path/.test(L)) return (on.reclaim || on.rightsize) ? "$2.2M" : null;
                if (/evidence at renewal/.test(L)) return on.reclaim ? "90 days" : null;
                if (/meetings transcribed|recap-eligible/.test(L)) return on.transcribe ? "85%" : null;
                if (/meetings recorded/.test(L)) return on.transcribe ? "62%" : null;
                if (/meetings with an agenda/.test(L)) return on.roletracks ? "68%" : null;
                if (/named champions|champions/.test(L) && !/needed/.test(L)) return on.champions ? "38" : null;
                if (/role-?based tracks|role tracks/.test(L)) return on.roletracks ? "4 of 4" : null;
                if (/managers briefed/.test(L)) return on.champions ? "94%" : null;
                if (/files shared in chat/.test(L)) return on.libraries ? "25%" : null;
                if (/files in owned libraries/.test(L)) return on.libraries ? "75%" : null;
                if (/duplicate versions per doc/.test(L)) return on.libraries ? "1.2" : null;
                if (/documents with an owner/.test(L)) return on.libraries ? "100%" : null;
                if (/copilot active/.test(L)) return (on.champions && on.roletracks) ? "78%" : null;
                if (/adoption metrics reported/.test(L)) return on.measure ? "4" : null;
                if (/baseline captured/.test(L)) return on.measure ? "Yes" : null;
                if (/adoption owner/.test(L)) return on.measure ? "Named" : null;
                if (/week-3 retention tracked/.test(L)) return on.measure ? "Yes" : null;
                if (/workflows instrumented/.test(L)) return on.measure ? "4" : null;
                if (/cohorts scored/.test(L)) return on.roletracks ? "4 of 4" : null;
                if (/regulated files unlabelled/.test(L)) return on.labels ? "1,120" : null;
                if (/phi containers labelled/.test(L)) return on.labels ? "99%" : null;
                if (/classifiers enforcing/.test(L)) return on.labels ? "3 of 3" : null;
                if (/policy sets that never evaluate/.test(L)) return on.dlpscope ? "0" : null;
                if (/mailboxes uncovered/.test(L)) return on.dlpscope ? "0" : null;
                if (/copilot prompt coverage/.test(L)) return on.dlpcopilot ? "100%" : null;
                if (/audit log retention/.test(L)) return on.retention ? "7 years" : null;
                if (/copilot history retained/.test(L)) return on.retention ? "Yes" : null;
                if (/legal hold coverage/.test(L)) return on.retention ? "100%" : null;
                if (/regimes fully met/.test(L)) return (on.part2 && on.labels) ? "4 of 4" : null;
                if (/breach drill/.test(L)) return on.aicontrol ? "Quarterly" : null;
                if (/provable containment/.test(L)) return (on.labels && on.dlpcopilot) ? "Yes" : null;
                if (/change record/.test(L)) return on.dlpscope ? "Signed" : null;
                if (/reportable exposure/.test(L)) return (on.labels && on.dlpcopilot) ? "Closed" : null;
                if (/dlp rules enforcing/.test(L)) return on.dlpscope ? "18 of 18" : null;
                if (/uncovered locations/.test(L)) return on.dlpcopilot ? "0" : null;
                if (/rules with no owner/.test(L)) return on.aicontrol ? "0" : null;
                if (/ai-specific controls/.test(L)) return on.aicontrol ? "3" : null;
                if (/evidence pack readiness/.test(L)) return on.aicontrol ? "On demand" : null;
                if (/control testing/.test(L)) return on.aicontrol ? "Continuous" : null;
                if (/endpoints outside baseline|devices needing action|devices blocked at enforcement/.test(L)) return on.baseline ? "41" : null;
                if (/baseline age/.test(L)) return on.baseline ? "Continuous" : null;
                if (/devices in no policy group|ungrouped devices/.test(L)) return on.baseline ? "0" : null;
                if (/tickets per week/.test(L)) return on.runbooks ? "204" : null;
                if (/self-answerable tickets/.test(L)) return on.runbooks ? "12%" : null;
                if (/automated runbooks/.test(L)) return on.runbooks ? "5" : null;
                if (/after-hours alerts/.test(L)) return on.runbooks ? "22/wk" : null;
                if (/copilot escalation path/.test(L)) return on.runbooks ? "Published" : null;
                if (/changes outside control/.test(L)) return on.pimadmins ? "0" : null;
                if (/standing global admins/.test(L)) return on.pimadmins ? "5" : null;
                if (/changes with a rollback plan/.test(L)) return on.pimadmins ? "100%" : null;
                if (/restore tested/.test(L)) return on.restore ? "Quarterly" : null;
                if (/recovery time objective/.test(L)) return on.restore ? "4 hours" : null;
                if (/support capacity/.test(L)) return on.runbooks ? "Headroom" : null;
                if (/out-of-support devices/.test(L)) return on.baseline ? "0 in pilot" : null;
                if (/mfa coverage/.test(L)) return on.riskpol ? "99%" : null;
                if (/risky sign-?ins unchallenged/.test(L)) return on.riskpol ? "0" : null;
                if (/files one account can reach/.test(L)) return on.eeeu ? "18,240" : null;
                if (/regulated files in reach/.test(L)) return on.labels ? "1,120" : null;
                if (/accounts with full reach/.test(L)) return on.eeeu ? "0" : null;
                if (/endpoint dlp/.test(L)) return on.dlpcopilot ? "100%" : null;
                if (/open chain links/.test(L)) return (on.dlpscope && on.eeeu && on.ca01) ? "0" : null;
                if (/chain owner/.test(L)) return on.dlpscope ? "Named" : null;
                if (/copilot session policy/.test(L)) return on.ca01 ? "CA01 enforced" : null;
                if (/guest identities/.test(L)) return on.guestexp ? "344" : null;
                if (/oauth app grants/.test(L)) return on.oauth ? "94 · continuous" : null;
                if (/ai-specific detections/.test(L)) return on.aidetect ? "3" : null;
                if (/incident drill/.test(L)) return on.aidetect ? "Quarterly" : null;
                if (/copilot readiness/.test(L)) { const ch = this.changeState(); return ch.ready ? Math.min(78, 34 + ch.ready) + "%" : null; }
                if (/blocking pillars/.test(L)) { const n = ["eeeu", "labels", "dlpscope"].filter(x => !on[x]).length; return n < 3 ? String(n) : null; }
                if (/priced exposure/.test(L)) return (on.eeeu && on.labels) ? "$164K" : on.eeeu ? "$980K" : null;
                if (/accounts with reach/.test(L)) return on.eeeu ? "0" : null;
                if (/prompts returning regulated content/.test(L)) return (on.eeeu && on.labels) ? "0 of 3" : null;
                if (/acceptance test defined/.test(L)) return on.aidetect ? "Yes · 5 prompts" : null;
                if (/tenant-wide verdict/.test(L)) { const ch = this.changeState(); return (34 + ch.ready) >= 75 ? "GO" : null; }
                if (/monthly cost of delay/.test(L)) return on.reclaim ? "$342K" : null;
                if (/exposure trend/.test(L)) return (on.eeeu || on.labels) ? "Falling" : null;
                if (/annual value at full adoption/.test(L)) return (on.champions && on.transcribe) ? "$4.1M tracked" : null;
                if (/pilot-ready seats/.test(L)) return on.roletracks ? "350" : null;
                if (/tickets deflectable weekly/.test(L)) return on.transcribe ? "136 captured" : null;
                return null;
              })(),
              tip: r[0] + ": " + r[1] + " — measured in this morning's scan. Click to ask what it means and what closing it changes.",
              title: r[0], tone: (bandFor(r[0], r[1]) || {}).ink || "#94a3b8",
              change: (Object.keys(CHANGES).find(id => CHANGES[id].match.test(r[0])) || ""),
              band: bandFor(r[0], r[1]),
              stats: (() => {
                const bd = bandFor(r[0], r[1]);
                return (bd ? "Status|" + bd.word + "|" + bd.ink + ";" : "") + "Source|Graph scan|#7dd3fc";
              })(),
              tip: (() => {
                const bd = bandFor(r[0], r[1]);
                return (bd ? bd.why + " " : "") + "Click to ask what it means and what closing it changes.";
              })(),
              hasAfter: false, nowInk: "#e2e8f0",
              onClick: () => this.askSignalRow(sec.h, r[0], r[1])
            })).map(row => Object.assign(row, {
              hasAfter: row.after != null,
              dot: (row.band && row.band.ink) || "transparent",
              nowInk: row.after != null ? "#64748b" : ((row.band && row.band.ink) || "#e2e8f0")
            }))
          })).map(sec => Object.assign(sec, {
            tip: "Open the walkthrough card for " + sec.h + " — the findings, what's wrong, and what closing it changes.",
            onOpen: () => {
              const norm = (x) => String(x).toLowerCase().replace(/[^a-z]/g, "");
              const bands = ["c", "a", "e"];
              for (let bi = 0; bi < bands.length; bi++) {
                const band = bands[bi];
                const set = walkSet(band + "0");
                const idx = set.findIndex(w => norm(w.title) === norm(sec.h));
                if (idx >= 0) {
                  if (band !== ["c", "a", "e"][s.govView || 0]) this.setState({ govView: bi });
                  this.govWalkTo(band + idx);
                  return;
                }
              }
              this.askSignalRow(sec.h, sec.h, "");
            },
            border: sec.active ? PC + "bf" : "rgba(30,41,59,.9)",
            bg: sec.active ? "linear-gradient(160deg," + PC + "2e,rgba(2,6,23,.7))" : "rgba(2,6,23,.5)",
            glow: sec.active ? "0 0 28px " + PC + "52" : "none",
            anim: sec.active ? "wr-sectionpulse 2.6s cubic-bezier(.22,1,.36,1) infinite" : "none",
            ink: sec.active ? "#e9d5ff" : "#a78bfa"
          })),
          setThread: (el) => {
            this.govThreadEl = el;
            if (!el) return;
            // only reposition when a NEW message arrives — a toggle re-render must not move the reader
            const len = (s.govThread || []).length;
            if (this.lastThreadLen === len) return;
            this.lastThreadLen = len;
            requestAnimationFrame(() => {
              // land on the TOP of the newest message when it carries a card,
              // otherwise follow the conversation to the bottom
              const kids = el.children;
              const last = kids[kids.length - 1];
              const th = s.govThread || [];
              const lastMsg = th[th.length - 1];
              const isCardMsg = !!(lastMsg && (lastMsg.walk != null || lastMsg.hobj || lastMsg.help || lastMsg.win || lastMsg.docs || lastMsg.copilot || lastMsg.sites || lastMsg.card));
              if (isCardMsg && last) el.scrollTop = Math.max(0, last.offsetTop - 12);
              else el.scrollTop = el.scrollHeight;
            });
          },
          chat: (s.govChat || []).map(m => {
            const p2 = PERSONAS[m.who] || { name: "You", color: "#22d3ee", tile: "linear-gradient(135deg,#1e293b,#334155)", initials: "YOU" };
            return {
              name: m.who === "you" ? "You" : p2.name, color: m.who === "you" ? "#22d3ee" : p2.color,
              tile: m.who === "you" ? "linear-gradient(135deg,#1e293b,#334155)" : p2.tile,
              initials: m.who === "you" ? "YOU" : p2.initials,
              text: m.text,
              bg: m.who === "you" ? "rgba(34,211,238,.08)" : "rgba(2,6,23,.6)",
              border: m.who === "you" ? "rgba(34,211,238,.28)" : "rgba(30,41,59,.9)"
            };
          }),
          hasChat: (s.govChat || []).length > 0,
          draft: s.govDraft || "",
          onDraft: (e) => this.setState({ govDraft: e.target.value }),
          onSend: () => this.govAsk(this.state.govDraft),
          onKey: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.govAsk(this.state.govDraft); } },
          qOpen: !!s.govQ,
          qChevron: s.govQ ? "180deg" : "0deg",
          onQToggle: () => this.setState(st => ({ govQ: !st.govQ })),
          questions: [
            "What is the biggest oversharing risk today?",
            "Which sites would Copilot index first?",
            "How dangerous are our org-wide links?",
            "What sensitive content is exposed right now?",
            "If we fix oversharing, how much does readiness improve?"
          ].map(q => ({ q, onClick: () => this.govAsk(q) })),
          janeName: PERSONAS.jane.name,
          janeColor: PERSONAS.jane.color,
          janeTile: PERSONAS.jane.tile,
          janeInitials: PERSONAS.jane.initials,
          janeSays: "Reducing oversharing directly increases Copilot safety. Copilot indexes what it can see — fixing governance prevents unsafe grounding.",
          fixOpen: !!s.govFix,
          fixChevron: s.govFix ? "180deg" : "0deg",
          onFixToggle: () => this.setState(st => ({ govFix: !st.govFix })),
          fixSteps: [
            ["Remove org-wide links", "Replace every “Everyone except external users” link with a scoped group; set link expiry so it cannot re-accumulate."],
            ["Restrict external sharing", "Drop the tenant ceiling to new and existing guests, disable Anyone links, and expire guests at 90 days."],
            ["Fix broken inheritance", "Enumerate sites with unique permissions, restore inheritance where no reason exists, replace direct grants with groups."],
            ["Apply sensitivity labels", "Promote the PHI classifiers, default-label at provisioning, back-label the unlabelled 22%."],
            ["Audit oversharing monthly", "Schedule the sharing and data-access reports, alert on any new org-wide or anonymous link."]
          ].map(x => ({ t: x[0], d: x[1] })),
          help: {
            ext: (e) => { if (e && e.stopPropagation) e.stopPropagation(); this.govExplainControl("ext"); },
            inh: (e) => { if (e && e.stopPropagation) e.stopPropagation(); this.govExplainControl("inh"); },
            links: (e) => { if (e && e.stopPropagation) e.stopPropagation(); this.govExplainControl("links"); }
          },
          onPreview: this.runPreviewChat,
          previewLabel: s.govPreview && s.govPreview.stage < 2
            ? (isLic ? "Modelling…" : "Copilot is reading…")
            : (isLic ? "Model the renewal" : "Run Copilot Preview"),
          onPath: () => this.explainPath(),
          pathLabel: isLic ? "Show the seat ledger" : "Explain Exposure Path",
          pathOpen: !!s.govPath,
          path: GOV_EXPOSURE_PATH.map((r, i) => ({ n: String(i + 1), head: r[0], sub: r[1], last: i === GOV_EXPOSURE_PATH.length - 1 })),
          previewOpen: !!s.govPreview,
          preview: (() => {
            const pv = s.govPreview;
            if (!pv) return { status: "", lines: [], done: false, working: false };
            const list = this.govList(s.govTab);
            const site = list.find(x => x.id === pv.site) || list[0];
            const stages = ["Enumerating what this site grants…", "Grounding a sample prompt on it…", "Prompt: “Summarise what this site contains.”"];
            return {
              status: stages[pv.stage], working: pv.stage < 2, done: pv.stage === 2,
              lines: pv.stage < 2 ? [] : [
                { t: "Copilot returned " + site.files + " citable files from " + site.name + " — it is not guessing, it is honouring the ACL your tenant published." },
                { t: site.sens === "Confidential" ? "Three of the top citations carry confidential material with no sensitivity label, so the answer inherits no protection." : "The top citations are unlabelled, so any answer built from them is unclassified by default." },
                { t: site.note }
              ]
            };
          })()
        };
        return isLic ? Object.assign(base, licOverride()) : base;
      })(),

      arrivalShow: s.introStage === "arriving" && !!s.introSpeaking,
      arrival: (() => {
        const k = s.introSpeaking;
        const it = k && INTRO.find(x => x.who === k);
        const p = k && PERSONAS[k];
        if (!it || !p) return null;
        const first = (it.line || "").split(/(?<=\.)\s/).slice(0, 2).join(" ");
        return { name: p.name, role: p.role, color: p.color, tile: p.tile, photo: "avatars/" + k + ".png",
          slot: "arrive-" + k, line: first, pillar: it.pillar };
      })(),

      pickShow: s.introStage === "pick",
      pickCards: (s.introArrived || []).map(k => {
        const it = INTRO.find(x => x.who === k) || {};
        const p = PERSONAS[k] || {};
        const heard = (s.introHeard || []).indexOf(k) >= 0;
        return {
          name: p.name, role: p.role, color: p.color, photo: "avatars/" + k + ".png", slot: "pick-" + k,
          hook: (it.pains && it.pains[0]) ? it.pains[0][0] : it.pillar,
          border: heard ? "rgba(52,211,153,.5)" : p.color + "66",
          bg: heard ? "rgba(16,185,129,.08)" : "rgba(2,6,23,.55)",
          tag: heard ? "MET" : "",
          onClick: () => this.setState({ introStage: "card", introSel: k, intro: INTRO.findIndex(x => x.who === k), focus: it.focus })
        };
      }),
      pickHeard: (s.introHeard || []).length,
      pickTotal: (s.introArrived || []).length,
      onPickSkip: () => { clearTimeout(this.arrT); this.setState({ introStage: null, intro: null, introSpeaking: null, focus: null, playing: true }, this.tick); },

      introOpen: s.introStage === "card" && s.intro !== null && s.intro !== undefined,
      intro: (s.intro !== null && s.intro !== undefined && INTRO[s.intro]) ? (() => {
        const it = INTRO[s.intro], p = PERSONAS[it.who];
        return {
          name: p.name, role: p.role, tile: p.tile, initials: p.initials, color: p.color, photo: "avatars/" + it.who + ".png", slot: "intro-" + it.who,
          line: it.line, tenure: it.tenure, lives: it.lives, day: it.day, wants: it.wants, pillar: it.pillar,
          step: String(s.intro + 1), total: String(INTRO.length),
          isLast: s.intro === INTRO.length - 1,
          nextLabel: s.intro === INTRO.length - 1 ? "Start the briefing" : "Next — " + PERSONAS[INTRO[s.intro + 1].who].name.split(" ")[0],
          pains: it.pains.map(x => ({ head: x[0], sub: x[1] })),
          stat: it.stat.map(x => ({ v: x[0], l: x[1] })),
          dots: INTRO.map((x, i) => ({
            bg: i === s.intro ? PERSONAS[x.who].color : i < s.intro ? "rgba(148,163,184,.55)" : "rgba(51,65,85,.9)",
            w: i === s.intro ? "22px" : "7px",
            onClick: () => this.setState({ intro: i, focus: INTRO[i].focus })
          }))
        };
      })() : null,
      onIntroBackToRoom: () => {
        const k = s.introSel;
        this.setState(st => ({
          introStage: "pick", introSel: null, intro: null, focus: null,
          introHeard: (st.introHeard || []).indexOf(k) >= 0 ? st.introHeard : (st.introHeard || []).concat([k])
        }));
      },
      onIntroBegin: () => {
        const k = s.introSel;
        this.setState(st => ({
          introStage: null, introSel: null, intro: null, introSpeaking: null, focus: null, playing: true,
          introHeard: (st.introHeard || []).indexOf(k) >= 0 ? st.introHeard : (st.introHeard || []).concat([k])
        }), this.tick);
      },
      onIntroNext: () => {
        const i = s.intro;
        if (i >= INTRO.length - 1) this.setState({ intro: null, playing: true, focus: null }, this.tick);
        else this.setState({ intro: i + 1, focus: INTRO[i + 1].focus });
      },
      onIntroBack: () => { if (s.intro > 0) this.setState({ intro: s.intro - 1, focus: INTRO[s.intro - 1].focus }); },
      onIntroSkip: () => this.setState({ intro: null, playing: true, focus: null }, this.tick),
      introBackDisabled: !s.intro,

      ctxOpen: !!s.ctxOpen,
      ctx: CONTEXT,
      onCtx: () => this.setState(st => {
        const open = !st.ctxOpen;
        if (open) clearTimeout(this.timer);
        return { ctxOpen: open, playing: open ? false : st.playing };
      }),
      transportLabel: s.playing ? "Pause briefing" : s.hidden ? "Resume briefing" : "Play briefing",
      transportIcon: s.playing ? "M10 4H6v16h4zM18 4h-4v16h4z" : "M6 4l14 8-14 8z",
      transportColor: s.playing ? "#7dd3fc" : "#34d399",
      onOpenGovDoc: () => this.setState({ govDoc: true, playing: false }),
      gdoc: (() => {
        const d = DOCS[s.dive] || DOCS.governance;
        if (!d || !s.govDoc) return null;
        const tone = { good: ["#34d399", "rgba(16,185,129,.09)", "rgba(52,211,153,.4)"], warn: ["#fbbf24", "rgba(251,191,36,.09)", "rgba(251,191,36,.4)"], bad: ["#f87171", "rgba(248,113,113,.09)", "rgba(248,113,113,.4)"] };
        const rowsFor = (key) => {
          if (key === "SOWPHASES") {
            return SOW_PHASES.map(p => ({
              cells: [p.n + " · " + p.title, p.weeks, p.price === 0 ? "included" : "$" + p.price.toLocaleString("en-US") + (p.recurring ? " / mo" : "")].map(v => ({ v: v }))
            }));
          }
          if (key === "SOWFINDINGS") {
            const PH = { governance: "Phase 2", security: "Phase 3 & 5", compliance: "Phase 4", health: "Phase 5", adoption: "Phase 6", licensing: "self-funding" };
            const out = [];
            Object.keys(FINDINGS).forEach(k => {
              (FINDINGS[k] || []).forEach(x => out.push({ cells: [x.t, PILLAR_META[k].label, PH[k] || "—"].map(v => ({ v: v })) }));
            });
            return out;
          }
          if (key && key.indexOf("INV:") === 0) {
            const parts = key.slice(4).split(".");
            const cfg = DIVE_INV[parts[0]];
            const rows = cfg ? (cfg.rows[parts[1]] || []) : [];
            const tn = { good: "#34d399", warn: "#fbbf24", bad: "#f87171", mute: "#94a3b8" };
            return rows.map(r => ({ cells: [r.name, r.tag, r.note].map(v => ({ v })), color: tn[r.tone] }));
          }
          const src = key === "SP" ? SITES.filter(x => x.type === "SharePoint")
            : key === "TEAMS" ? SITES.filter(x => x.type === "Teams") : ONEDRIVE;
          return src.map(x => ({ cells: [x.name, x.exposure, x.files, x.sens].map(v => ({ v })) }));
        };
        return {
          title: d.title, sub: d.sub,
          meta: d.meta.map(m => ({ l: m[0], v: m[1] })),
          setScroll: (el) => {
            this.gdocScroll = el;
            if (!el || el.__w) return;
            el.__w = true;
            el.addEventListener("scroll", () => {
              let cur = d.sections[0].id;
              d.sections.forEach(x => { const n = el.querySelector("#" + x.id); if (n && n.offsetTop - el.scrollTop <= 90) cur = x.id; });
              if (cur !== this.state.gdocSec) this.setState({ gdocSec: cur });
            }, { passive: true });
          },
          toc: d.sections.map(sec => ({
            label: sec.h,
            color: s.gdocSec === sec.id ? "#f1f5f9" : "#94a3b8",
            border: s.gdocSec === sec.id ? "{{ dcfg.color }}a6" : "rgba(51,65,85,.9)",
            bg: s.gdocSec === sec.id ? "{{ dcfg.color }}33" : "rgba(2,6,23,.5)",
            onClick: () => {
              const el = this.gdocScroll;
              this.setState({ gdocSec: sec.id });
              if (!el) return;
              const n = el.querySelector("#" + sec.id);
              if (n) el.scrollTo({ top: Math.max(0, n.offsetTop - 14), behavior: "smooth" });
            }
          })),
          sections: d.sections.map(sec => ({
            id: sec.id, h: sec.h,
            onExplain: () => this.explainSection(sec.id, sec.h),
            blocks: sec.blocks.map(b => ({
              isP: b.t === "p", isCallout: b.t === "callout", isTable: b.t === "table",
              isKv: b.t === "kv", isAi: b.t === "ai", isSteps: b.t === "steps", isHowto: b.t === "howto",
              onExplain: () => this.explainBlock(sec.id, sec.h, b),
              v: b.v || "",
              cTone: b.tone ? tone[b.tone][0] : "#94a3b8",
              cBg: b.tone ? tone[b.tone][1] : "rgba(2,6,23,.5)",
              cBorder: b.tone ? tone[b.tone][2] : "rgba(30,41,59,.9)",
              head: (b.head || []).map(h => ({ h })),
              grid: (b.head || []).length === 3
                ? "minmax(120px,1.5fr) minmax(64px,.55fr) minmax(140px,2.2fr)"
                : "minmax(130px,2.2fr) minmax(78px,1fr) minmax(46px,.55fr) minmax(70px,.9fr)",
              gridAsk: ((b.head || []).length === 3
                ? "minmax(0,1.4fr) minmax(0,.5fr) minmax(0,1.9fr)"
                : "minmax(0,2fr) minmax(0,.9fr) minmax(0,.55fr) minmax(0,.85fr)") + " 26px",
              rows: b.t === "table" ? rowsFor(b.rows).map(r => Object.assign({}, r, { onAsk: () => this.askRow(b.rows, r.cells) }))
                : b.t === "kv" ? (b.rows || []).map(r => ({ l: r[0], v: r[1] }))
                : b.t === "steps" ? GOV_EXPOSURE_PATH.map((r, i) => ({ n: String(i + 1), head: r[0], sub: r[1] }))
                : [],
              title: b.title || "", effort: b.effort || "",
              steps: (b.steps || []).map((x, i) => ({ n: String(i + 1), v: x }))
            }))
          })),
          onClose: () => this.setState({ govDoc: false })
        };
      })(),
      onOpenLicDoc: () => this.setState({ doc: "licensing", playing: false }),
      onOpenCopilotDoc: () => this.setState({ doc: "copilot", playing: false }),
      docOpen: !!DOCS[s.doc],
      onOpenDoc: (k) => this.setState({ doc: k, playing: false }),
      doc: (() => {
        const d = DOCS[s.doc];
        if (!d) return null;
        const tone = { good: ["#34d399", "rgba(16,185,129,.09)", "rgba(52,211,153,.4)"], warn: ["#fbbf24", "rgba(251,191,36,.09)", "rgba(251,191,36,.4)"], bad: ["#f87171", "rgba(248,113,113,.09)", "rgba(248,113,113,.4)"] };
        const tableRows = (key) => {
          if (key === "MISMATCH" || key === "OVER" || key === "NEED") {
            const cat = key === "MISMATCH" ? "mismatch" : key === "OVER" ? "over" : "need";
            return LIC_PEOPLE.filter(p => p.cat === cat).map(p => ({
              cells: [p.name + " · " + p.role, p.held, p.should, (p.save >= 0 ? "+$" : "−$") + Math.abs(p.save) + "/mo"].map(v => ({ v })),
              color: p.save >= 0 ? "#34d399" : "#7dd3fc"
            }));
          }
          if (DIVE_INV[key]) return [];
          if (key === "SOWPHASES") {
            return SOW_PHASES.map(p => ({
              cells: [p.n + " · " + p.title, p.weeks, p.price === 0 ? "included" : "$" + p.price.toLocaleString("en-US") + (p.recurring ? " / mo" : "")].map(v => ({ v: v }))
            }));
          }
          if (key === "SOWFINDINGS") {
            const PH = { governance: "Phase 2", security: "Phase 3 & 5", compliance: "Phase 4", health: "Phase 5", adoption: "Phase 6", licensing: "self-funding" };
            const out = [];
            Object.keys(FINDINGS).forEach(k => {
              (FINDINGS[k] || []).forEach(x => out.push({ cells: [x.t, PILLAR_META[k].label, PH[k] || "—"].map(v => ({ v: v })) }));
            });
            return out;
          }
          if (key && key.indexOf("INV:") === 0) {
            const parts = key.slice(4).split(".");
            const cfg = DIVE_INV[parts[0]];
            const rows = cfg ? (cfg.rows[parts[1]] || []) : [];
            const tone = { good: "#34d399", warn: "#fbbf24", bad: "#f87171", mute: "#94a3b8" };
            return rows.map(r => ({ cells: [r.name, r.tag, r.note].map(v => ({ v })), color: tone[r.tone] }));
          }
          const src = key === "SP" ? SITES.filter(x => x.type === "SharePoint")
            : key === "TEAMS" ? SITES.filter(x => x.type === "Teams") : ONEDRIVE;
          return src.map(x => ({
            cells: [x.name, x.exposure, x.files, x.sens].map(v => ({ v })),
            color: x.risk === "critical" ? "#f87171" : x.risk === "high" ? "#fbbf24" : "#94a3b8"
          }));
        };
        return {
          title: d.title, sub: d.sub, pillar: d.pillar, color: d.color, accent: d.accent,
          meta: d.meta.map(m => ({ l: m[0], v: m[1] })),
          setScroll: (el) => {
            this.docScroll = el;
            if (!el || el.__wired) return;
            el.__wired = true;
            el.addEventListener("scroll", () => {
              const ids = d.sections.map(x => x.id);
              let cur = ids[0];
              ids.forEach(id => {
                const n = el.querySelector("#" + id);
                if (n && n.offsetTop - el.scrollTop <= 90) cur = id;
              });
              if (cur !== this.state.docSec) this.setState({ docSec: cur });
            }, { passive: true });
          },
          toc: d.sections.map(sec => ({ label: sec.h, color: s.docSec === sec.id ? "#f1f5f9" : "#94a3b8",
            bg: s.docSec === sec.id ? d.color + "26" : "transparent",
            onClick: () => {
              const el = this.docScroll;
              this.setState({ docSec: sec.id });
              if (!el) return;
              const n = el.querySelector("#" + sec.id);
              if (n) el.scrollTo({ top: Math.max(0, n.offsetTop - 20), behavior: "smooth" });
            } })),
          sections: d.sections.map(sec => ({
            id: sec.id, h: sec.h,
            blocks: sec.blocks.map(b => ({
              isP: b.t === "p", isCallout: b.t === "callout", isTable: b.t === "table",
              isKv: b.t === "kv", isAi: b.t === "ai", isSteps: b.t === "steps", isHowto: b.t === "howto",
              v: b.v || "",
              cTone: b.tone ? tone[b.tone][0] : "#94a3b8",
              cBg: b.tone ? tone[b.tone][1] : "rgba(2,6,23,.5)",
              cBorder: b.tone ? tone[b.tone][2] : "rgba(30,41,59,.9)",
              head: (b.head || []).map(h => ({ h })),
              grid: (b.head || []).length === 3
                ? "minmax(180px,1.5fr) minmax(80px,.55fr) minmax(220px,2.4fr)"
                : "minmax(200px,2.4fr) minmax(96px,1fr) minmax(58px,.6fr) minmax(88px,1fr)",
              rows: b.t === "table" ? tableRows(b.rows)
                : b.t === "kv" ? (b.rows || []).map(r => ({ l: r[0], v: r[1] }))
                : b.t === "steps" ? GOV_EXPOSURE_PATH.map((r, i) => ({ n: String(i + 1), head: r[0], sub: r[1] }))
                : [],
              title: b.title || "", effort: b.effort || "",
              steps: (b.steps || []).map((x, i) => ({ n: String(i + 1), v: x }))
            }))
          })),
          onClose: () => this.setState({ doc: null, playing: true }, this.tick)
        };
      })(),

      transportOpen: !!s.transportOpen,
      transportChevron: s.transportOpen ? "180deg" : "0deg",
      onTransportMenu: () => this.setState(st => ({ transportOpen: !st.transportOpen })),
      // The target list and its resolution moved to warRoomSections.ts (#303) so
      // the URL restore path goes through this exact same mechanism. Same stops,
      // same labels, same colours, same liveness test, same branch order — the
      // only addition is emitSection(), which mirrors the chosen stop into the
      // URL as an explicit (Back-stop-worthy) navigation.
      transportJumps: WAR_ROOM_SECTIONS.map(t => {
        const key = t.key;
        const live = isWarRoomSectionLive(key);
        return {
          label: t.label,
          color: live ? "#cbd5e1" : "#475569",
          dot: live ? t.dot : "rgba(71,85,105,.6)",
          bg: s.dive === key ? "rgba(0,120,212,.14)" : "transparent",
          onClick: () => {
            this.setState({ transportOpen: false });
            if (!this.applySection(key)) return;
            this.emitSection(key, true);
          }
        };
      }),
      onTransport: () => {
        this.setState({ transportOpen: false });
        if (this.state.playing) {
          clearTimeout(this.timer); clearTimeout(this.injTimer); clearTimeout(this.answerTimer);
          this.exitPending = false;
          this.setState({ playing: false });
        } else this.setState({ playing: true, hidden: false }, this.tick);
      },
      host: persona("shane"),
      leftPersonas: ["jane", "priya", "marcus"].map(persona),
      rightPersonas: ["kirk", "beth"].map(k => {
        const p = persona(k);
        const active = s.joined.indexOf(k) >= 0;
        return Object.assign(p, {
          dockOpacity: active ? 1 : 0.42,
          statusLabel: active ? "IN SESSION" : "STANDBY",
          statusColor: active ? p.roleColor : "#475569"
        });
      }),
      showStandby: false,

      coreScore: Math.max(40, 100 - NODES.filter(n => s.statuses[n.id] !== "healthy").length * 7),
      mapSize: (() => {
        const z = focusNode ? 1.1 : 1, push = focusNode ? 36 : 0;
        const w = (this.stageW || 460), h = (this.stageH || 400);
        return Math.round(Math.max(280, Math.min(w * 1.06 - 2 * push, h - 2 * push) / z)) + "px";
      })(),
      setMapBox: this.setMapBox,
      boundarySize: (() => {
        const b = this.mapBox;
        if (!b) { const w = (this.stageW || 460), h = (this.stageH || 400); return Math.round(Math.max(280, Math.min(w * 1.06, h)) + 104) + "px"; }
        return Math.round((b.rPx + 78) * 2) + "px";
      })(),
      boundaryX: (this.mapBox ? this.mapBox.cx : 50).toFixed(2) + "%",
      boundaryY: (this.mapBox ? this.mapBox.cy : 50).toFixed(2) + "%",
      fcard: (() => {
        const c = s.findingCard;
        if (!c) return { show: false, steps: [] };
        const meta = PILLAR_META[c.pillar] || { label: "Tenant", color: "#3B82F6" };
        const D = {
          "f-gov-1": { means: "Forty-one sites carry an “Everyone except external users” or org-wide grant applied at site level and inherited by every library beneath them. It was set once at provisioning and nobody has revisited it.", blocks: "Copilot resolves permissions literally. Every one of those 214,806 files becomes a citable answer for any licensed account on day one — payroll, contracts, clinical documentation.", steps: ["Set the tenant default link type to Specific people so no new org-wide links are created.", "Replace each grant with a scoped security group, staged site by site with 48 hours' notice.", "Remove the old grant a week after the group is live, and log every change."] },
          "f-gov-2": { means: "Six hundred and twelve guest accounts hold standing access with no expiry and no re-attestation. Thirty-one were invited by people who have since left.", blocks: "A guest is a real identity that can be phished and never expires. Copilot does not treat guests differently from staff.", steps: ["Turn on a quarterly access review scoped to all groups holding guests.", "Set reviewers to group owners with an administrator fallback.", "Run the first cycle on Take recommendations, then tighten to Remove access."] },
          "f-gov-3": { means: "Label inheritance is off at site provisioning, so new content is born unclassified and the estate degrades every week the setting stays off.", blocks: "An answer grounded on unlabelled content inherits no classification and carries no warning to the person reading it.", steps: ["Enable default labels at provisioning so new sites start classified.", "Auto-label the backlog starting with clinical and billing libraries.", "Leave encryption off until the taxonomy has run a full cycle."] },
          "f-gov-4": { means: "Seventeen teams have at least one public channel, which exposes the whole connected SharePoint site to the tenant. Twenty-three of the links inside them are anonymous with no expiry.", blocks: "Copilot grounds on the connected site, not the channel — so a channel opened for a 2023 project still publishes its entire library.", steps: ["Convert public channels to private where no business case exists.", "Disable Anyone links at tenant level after converting the live ones.", "Apply a 90-day expiry so this cannot silently re-accumulate."] },
          "f-lic-1": { means: "1,308 paid seats are purchased and unassigned — $847,608 a year leaving the business for nothing.", blocks: "It does not block Copilot technically. It funds the remediation entirely, which is why it is the first conversation.", steps: ["Reclaim the unassigned seats at the next true-up.", "Move assignment to group-based licensing so leavers release automatically.", "Redirect the recovery into the Copilot pilot."] },
          "f-lic-2": { means: "Twenty-five Copilot licences are owned and two are assigned. The pilot cohort you need is four hundred.", blocks: "You cannot demonstrate value at two seats, and you cannot justify tenant-wide spend without a measured pilot.", steps: ["Assign the pilot cohort from the reclaimed seats.", "Scope the pilot to Finance and Legal, both inside a labelled boundary.", "Measure for one quarter before expanding."] },
          "f-sec-1": { means: "Two DLP policy sets are configured but never evaluate — 1,412 mailboxes and 8.4 million messages fall outside their scope entirely.", blocks: "A policy that reports and blocks nothing gives you the paperwork of protection with none of the effect.", steps: ["Correct the scope so finance and legal are inside the policy.", "Promote the policies out of test mode after reviewing match rates.", "Extend DLP to Copilot prompts and responses."] },
          "f-sec-2": { means: "There is no conditional access policy scoped to the Microsoft 365 Copilot application. Every session is unconditioned.", blocks: "Without a compliant-device grant, Copilot grounds on your regulated data from any device, managed or not.", steps: ["Create the policy scoped to Copilot with two break-glass accounts excluded.", "Require a compliant device and a 12-hour sign-in frequency.", "Run report-only for two weeks before enforcing."] },
          "f-cmp-1": { means: "Forty thousand four hundred and eighty regulated files — PHI, PII and contractual — carry no sensitivity label at all.", blocks: "Without labels there is no provable containment, which turns an internal incident into a reportable one under MSA §7.4.", steps: ["Promote the three PHI classifiers out of simulation after sampling matches.", "Auto-label clinical and billing first, then the rest of the backlog.", "Add label-based encryption once the taxonomy is stable."] },
          "f-hlt-1": { means: "Three hundred and twelve endpoints — one device in six — sit outside the Intune compliance baseline.", blocks: "The Copilot conditional access grant requires a compliant device. Enforce it today and a sixth of your users lose access.", steps: ["Bring the drifted devices back to baseline before enforcing the grant.", "Set automatic remediation for the common failure modes.", "Then enable the Copilot device requirement."] }
        };
        const d = D[c.id] || {
          means: c.t + " — measured directly in this morning's scan, not sampled. The underlying objects are listed in the " + meta.label.toLowerCase() + " report.",
          blocks: "It sits between where readiness is today and the 75 a tenant-wide Copilot go-live requires. It does not block a scoped pilot.",
          steps: ["Confirm the finding against the objects in the " + meta.label.toLowerCase() + " report.", "Stage the remediation in the phase named on this card.", "Re-measure and confirm the pillar score has moved."]
        };
        return {
          show: true, t: c.t, m: c.m, sow: c.sow,
          pillarLabel: meta.label, color: meta.color,
          means: d.means, blocks: d.blocks,
          steps: d.steps.map((v, i) => ({ n: String(i + 1), v: v })),
          onClose: () => this.setState({ findingCard: null }),
          onOpenPillar: () => this.setState({ findingCard: null, dive: c.pillar, playing: false })
        };
      })(),
      mapFindings: (() => {
        const groupOf = { governance: "Governance", licensing: "Licensing", adoption: "Adoption", compliance: "Compliance", health: "Health", security: "Security" };
        const short = {
          "f-gov-1": "41 sites publish org-wide", "f-gov-2": "612 standing guests",
          "f-gov-3": "22% unlabelled content", "f-gov-4": "Public Teams channels",
          "f-lic-1": "1,308 unassigned seats", "f-lic-2": "2 of 25 Copilot seats used",
          "f-lic-3": "47 leaver accounts licensed", "f-lic-4": "38% direct assignment",
          "f-ado-1": "22% of meetings transcribed", "f-ado-2": "No named champions",
          "f-ado-3": "64% shared in chat", "f-ado-4": "One deck for every role",
          "f-cmp-1": "40,480 files unlabelled", "f-cmp-2": "3 classifiers in simulation",
          "f-cmp-3": "Chat outside retention", "f-cmp-4": "MSA record unsigned",
          "f-hlt-1": "312 endpoints off baseline", "f-hlt-2": "47 settings drifted",
          "f-hlt-3": "18 standing global admins", "f-hlt-4": "No remediation runbooks",
          "f-sec-1": "2 DLP sets never evaluate", "f-sec-2": "No Copilot session policy",
          "f-sec-3": "Risk policy report-only", "f-sec-4": "Copilot out of DLP scope"
        };
        const out = [];
        Object.keys(FINDINGS).forEach(k => {
          const g = groupOf[k];
          if (!g) return;
          FINDINGS[k].forEach((x, i) => out.push({
            id: x.id, group: g, t: x.t, short: short[x.id] || x.t, m: x.m,
            sev: i < 2 ? "alert" : "drift"
          }));
        });
        return out;
      })(),
      onMapFinding: (id) => {
        let hit = null, pillar = null;
        Object.keys(FINDINGS).forEach(k => { const m = FINDINGS[k].find(x => x.id === id); if (m) { hit = m; pillar = k; } });
        if (hit) this.setState({ findingCard: Object.assign({}, hit, { pillar: pillar }), playing: false });
      },
      mapBaseline: (() => {
        let baseMo = 0;
        LIC_SKUS.forEach(sk => { baseMo += sk.purchased * sk.cost; });
        const licBase = Math.max(18, Math.round(100 - (LIC_SKUS.reduce((a, sk) => a + Math.max(0, sk.purchased - sk.assigned) * sk.cost, 0) / baseMo) * 250));
        return {
          Security: DIVES.security.score, Governance: GOV_BASE.score, Licensing: licBase,
          Adoption: DIVES.adoption.score, Copilot: COPILOT_BASE,
          Compliance: DIVES.compliance.score, Health: DIVES.health.score
        };
      })(),
      mapProjected: (() => {
        const on = s.levers || {};
        const staged = s.changes || {};
        const cap = (v) => Math.min(99, Math.round(v));
        const out = {};
        // every staged change feeds the pillar it belongs to
        let cGov = 0, cSec = 0, cRdy = 0;
        Object.keys(CHANGES).forEach(id => {
          if (!staged[id]) return;
          const c = CHANGES[id];
          cGov += c.gov || 0; cSec += c.sec || 0; cRdy += c.ready || 0;
        });
        const govGain = GOV_LEVERS.filter(l => on[l.id]).reduce((a, l) => a + l.d.score, 0) + cGov;
        if (govGain) out.Governance = cap(GOV_BASE.score + govGain);
        if (cSec) out.Security = cap((DIVES.security ? DIVES.security.score : 41) + cSec);
        if (cRdy) out.Copilot = cap(28 + cRdy);
        Object.keys(DIVES).forEach(k => {
          let gain = DIVES[k].levers.filter(l => on[k + ":" + l.id]).reduce((a, l) => a + l.score, 0);
          const ic = DIVE_INV[k];
          if (ic && on[k + ":" + ic.toggle.id]) gain += 9;
          if (ic && s.invRun && s.invRun[k] === "done") gain += 4;
          if (gain) out[k.charAt(0).toUpperCase() + k.slice(1)] = cap(DIVES[k].score + gain);
        });
        const adj = s.lic || {};
        if (Object.keys(adj).length) {
          let nowMo = 0, wasteMo = 0;
          LIC_SKUS.forEach(sk => { const q = adj[sk.id] === undefined ? sk.purchased : adj[sk.id]; nowMo += q * sk.cost; wasteMo += Math.max(0, q - sk.assigned) * sk.cost; });
          out.Licensing = Math.max(18, Math.min(99, Math.round(100 - (nowMo > 0 ? wasteMo / nowMo : 0) * 250)));
          const seats = adj.copilot === undefined ? 25 : adj.copilot;
          out.Copilot = cap(28 + Math.min(62, (seats / 1876) * 120));
        }
        return Object.keys(out).length ? out : null;
      })(),
      mapFocusNode: (() => {
        const site = SITES.find(x => x.id === s.demoSite);
        if (site) return site.type === "Teams" ? "External Access Risk" : "Sharing Governance";
        return MAP_NODE[focusNode] || null;
      })(),
      mapFocusPillar: focusNode ? (MAP_PILLAR[(NODES.find(n => n.id === focusNode) || {}).pillar] || null) : null,
      veilOpacity: (focusNode && s.act >= 4) ? "0.4" : "0",
      mapSweep: s.beat < 0 ? "fast" : "slow",
      mapPins: (() => {
        const out = [], seen = {};
        SCRIPT.slice(0, Math.max(0, s.beat + 1)).forEach(b => {
          if (!b.focus) return;
          if (b.who !== "kirk" && b.who !== "beth" && !b.chain && !b.card) return;
          const label = MAP_NODE[b.focus];
          if (!label || seen[label]) return;
          seen[label] = true;
          out.push({ node: label, n: out.length + 1, tone: "#8B5CF6" });
        });
        return out;
      })(),
      mapTransform: (() => {
        // keep the highlighted node clear of the speaking bubble
        const ANG = { security: -90, governance: -38.6, licensing: 12.9, adoption: 64.3, copilot: 115.7, compliance: 167.1, health: -141.4 };
        const pillar = focusNode ? (NODES.find(n => n.id === focusNode) || {}).pillar : null;
        const a = pillar && ANG[pillar] != null ? ANG[pillar] * Math.PI / 180 : null;
        const side = s.persona === "shane" ? "top" : s.persona === "user" ? "bottom"
          : ["jane", "priya", "marcus"].indexOf(s.persona) >= 0 ? "left" : "right";
        const zoom = a != null ? 1.1 : 1;
        const push = a != null ? 40 : 0;
        const tx = a != null ? -Math.cos(a) * push : 0;
        const ty = a != null ? -Math.sin(a) * push : 0;
        return "perspective(1900px) rotateX(11deg) scale(" + ((s.selected ? 0.92 : 1) * zoom).toFixed(3) +
          ") translate(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px)";
      })(),
      hostCardOpacity: speaker === "shane" ? "0" : "1",
      hostCardEvents: speaker === "shane" ? "none" : "auto",
      mapBlast: !!s.blast || !!s.demoSite,
      mapOutcome: (!s.demoSite && (s.payoff || s.readiness >= 75)) ? "good" : "bad",
      mapScenario: (() => {
        const bad = NODES.filter(n => s.statuses[n.id] !== "healthy").length;
        if (s.mood === "security" || bad >= 4) return "breach";
        if (bad >= 2) return "degraded";
        if (bad === 0 && s.readiness >= 75) return "optimal";
        return "baseline";
      })(),
      stageTransform: "perspective(1600px) rotateX(13deg) scale(" + (s.fit * (s.selected ? 0.9 : 1)).toFixed(3) + ") translateX(" + (s.selected ? "-70px" : "0px") + ")",
      setStage: this.setStage,
      nodes: s.fit < 0.62 ? [] : nodes,
      pillars: s.fit < 0.62 ? [] : pillars,
      links, sectors: s.fit < 0.62 ? sectors.map(x => Object.assign({}, x, { hideLabel: true })) : sectors,
      showSectorLabels: s.fit >= 0.62,
      legend: PILLARS.map(p => {
        const kids = NODES.filter(n => n.pillar === p.id);
        const worst = kids.reduce((a, n) => {
          const st = s.statuses[n.id];
          return st === "alert" ? "alert" : st === "drift" && a !== "alert" ? "drift" : a;
        }, "healthy");
        const open = kids.filter(n => s.statuses[n.id] !== "healthy").length;
        const active = focusPillar === p.id;
        return {
          label: p.label, impact: p.impact, color: p.color,
          statusColor: STATUS[worst].color,
          count: open ? open + " open" : "clear",
          bg: active ? p.color + "1a" : "transparent",
          border: active ? p.color + "66" : "rgba(51,65,85,.5)"
        };
      }),
      typePillar: Math.min(20, 11 / s.fit).toFixed(1) + "px",
      typeZone: Math.min(26, 12 / s.fit).toFixed(1) + "px",
      typeImpact: Math.min(19, 8.5 / s.fit).toFixed(1) + "px",
      typeCoreLabel: Math.min(17, 8 / s.fit).toFixed(1) + "px",
      typeCoreValue: Math.min(38, 17 / s.fit).toFixed(1) + "px",
      typeCoreFoot: Math.min(16, 7.5 / s.fit).toFixed(1) + "px",
      strokeMain: Math.max(1, Math.min(3, 1 / s.fit)).toFixed(1),
      tableSpan: Math.round(1060 * s.fit * 1.08) + "px",
      beamSpan: Math.round(1060 * s.fit * 0.62) + "px",
      roomFar: (s.par.x * -14).toFixed(1) + "px",
      roomNear: (s.par.x * 8).toFixed(1) + "px",
      parFar: (s.par.x * 26).toFixed(1) + "px",
      parNear: (s.par.x * 12).toFixed(1) + "px",

      chainSeverityLabel: s.metrics.chainSeverity === 0 ? "CLEARED" : s.metrics.chainSeverity + " OPEN",
      chainSeverityColor: s.metrics.chainSeverity === 0 ? "#34d399" : "#f87171",
      riskChain: chainStates.map((r, i) => ({
        label: r.label, detail: r.detail,
        color: r.active ? "#f87171" : "rgba(51,65,85,.9)",
        text: r.active ? "#fca5a5" : "#94a3b8",
        stem: i === chainStates.length - 1 ? "0px" : "26px"
      })),

      qaOpen: !!s.qa,
      qa: s.qa ? (() => {
        const p = PERSONAS[s.qa.who] || PERSONAS.shane;
        const t = TOPICS[s.qa.topicId] || {};
        return {
          q: s.qa.q,
          name: p.name, role: p.role, tile: p.tile, initials: p.initials, roleColor: p.color,
          thinking: !!s.qa.thinking,
          hasAnswer: !!s.qa.answer,
          answer: s.qa.answer || "",
          topic: (t.title || "Tenant detail").replace(" Details", ""),
          metrics: (t.metrics || []).map(m => ({ label: m[0], value: m[1], color: m[2] })),
          follow: this.followUps(s.qa.topicId, t)
            .filter(f => (s.qa.asked || []).indexOf(f.key) < 0 && f.who !== s.qa.who)
            .slice(0, 3)
            .map(f => ({ label: f.label, who: PERSONAS[f.who].name.split(" ")[0], onClick: () => this.askFollow(f.key) }))
        };
      })() : null,
      onQAResume: () => this.closeQA(true),
      onQAClose: () => this.closeQA(false),

      setChatScroll: (el) => {
        this.chatEl = el;
        if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
      },
      chatOpenLog: s.chatLog,
      chatCount: String(s.said.length),
      chatHasCount: s.said.length > 0,
      onToggleChatLog: () => this.setState(st => ({ chatLog: !st.chatLog })),
      transcript: s.said.map((m, i) => {
        const p = PERSONAS[m.who] || PERSONAS.shane;
        const mine = m.who === "user";
        const prev = s.said[i - 1];
        return {
          text: m.text, stamp: m.stamp,
          showWho: !mine && (!prev || prev.who !== m.who),
          name: p.name,
          align: mine ? "flex-end" : "flex-start",
          bubbleBg: mine ? "linear-gradient(180deg,#1e8fff,#0a6fe0)" : "#1c1c1e",
          bubbleColor: mine ? "#ffffff" : "#f2f2f7",
          tailRadius: mine ? "18px 18px 5px 18px" : "18px 18px 18px 5px",
          tile: p.tile, initials: p.initials
        };
      }),
      transcriptEmpty: s.said.length === 0,

      userSpeaking: !!s.userLine,
      userLine: s.userLine,
      onSpeak: () => this.speak("Hold on — give me the thirty-day path with owners and dates, not the full inventory."),
      playIcon: s.playing ? "M10 4H6v16h4zM18 4h-4v16h4z" : "M6 4l14 8-14 8z",
      playState: s.playing ? "LIVE" : "PAUSED",
      playStateColor: s.playing ? "#34d399" : "#fbbf24",
      onTogglePlay: () => this.setState(p => ({ playing: !p.playing }), this.tick),
      onNextLine: () => this.jumpTo(((s.beat < 0 ? -1 : s.beat) + 1) % SCRIPT.length),
      onNextScene: this.nextScene,
      acts: ["Hard", "Quantified", "Live proof", "Payoff", "The twist", "The ask"].map((label, i) => ({
        label, n: String(i + 1), onClick: () => this.jumpAct(i),
        color: i === s.act ? "#7dd3fc" : i < s.act ? "#34d399" : "#475569",
        border: i === s.act ? "rgba(103,232,249,.6)" : "rgba(51,65,85,.7)",
        bg: i === s.act ? "rgba(0,120,212,.16)" : "transparent"
      })),
      mapBlastData: (BLAST[s.blast] || {}).rings || (s.demoSite ? [["41", "sites reachable"], ["214K", "files exposed"], ["1,876", "users in range"]] : null),
      onResume: () => { clearTimeout(this.injTimer); this.setState({ demo: null, quantified: false, payoff: false, blast: null, injected: null, playing: true }, this.tick); },
      onDismissClosing: () => this.setState({ closing: false }),
      showDemo: !!s.demo,
      demoCaret: s.demo && s.demo.stage === 0 ? "1" : "0",
      demoScanning: !!s.demo && s.demo.stage === 1,
      demoResults: !!s.demo && s.demo.stage >= 2,
      demoAwaiting: !!s.demo && s.demo.stage === 0,
      onDemoSend: () => this.setState(st => (st.demo ? { demo: { stage: 1, step: 0 } } : null)),
      demoScanLabel: SCAN_STEPS[Math.min((s.demo && s.demo.step) || 0, SCAN_STEPS.length - 1)][0],
      demoScanPct: s.demo ? Math.round((((s.demo.step || 0) + 1) / SCAN_STEPS.length) * 100) + "%" : "4%",
      demoScanMeta: "1,204 sites · 3,912 libraries · 41,{{}} permissions evaluated".replace("{{}}", "306"),
      demoHitCount: String(SITES.length),
      demoSites: SITES.map(site => {
        const col = site.risk === "critical" ? "#f87171" : site.risk === "high" ? "#fbbf24" : "#38bdf8";
        const on = s.demoSite === site.id;
        return {
          type: site.type, name: site.name, exposure: site.exposure, files: site.files,
          risk: col, chipBg: col + "1f",
          border: on ? "rgba(103,232,249,.65)" : "rgba(30,41,59,.9)",
          bg: on ? "rgba(0,120,212,.14)" : "rgba(2,6,23,.55)",
          onClick: () => this.setState({ demoSite: site.id })
        };
      }),
      demoSite: (() => {
        const site = SITES.find(x => x.id === s.demoSite);
        if (!site) return null;
        return {
          name: site.type + " · " + site.name, note: site.note,
          stats: [
            { value: site.files, label: "files in scope" },
            { value: site.exposure, label: "exposure type" },
            { value: String(site.ext), label: "external identities" }
          ]
        };
      })(),
      demoQA: s.demoQA,
      demoDraft: s.demoDraft,
      demoSuggested: [
        "Which of these can Copilot actually cite today?",
        "Who added EEEU, and when?",
        "What breaks if we remove it?"
      ].map(q => ({ label: q, onClick: () => this.askDemo(q) })),
      onDemoDraft: (e) => this.setState({ demoDraft: e.target.value }),
      onDemoKey: (e) => { if (e.key === "Enter") { e.preventDefault(); this.askDemo(s.demoDraft); } },
      onDemoAsk: () => this.askDemo(s.demoDraft),
      demoPrompt: "Show me every SharePoint site and Teams site Copilot can ground on that has EEEU, org-wide or anonymous sharing — rank by exposure.",
      demoMeta: "11.4s · Graph + SharePoint Admin + Purview · read-only, zero content left the tenant",
      showQuantified: s.quantified,
      quantifiedStats: [
        { label: "Hours lost / person / week", value: "6.4", color: "#fbbf24" },
        { label: "Active users measured", value: "1,876", color: "#94a3b8" },
        { label: "Teams channels per user", value: "41", color: "#fbbf24" },
        { label: "Routine docs / week", value: "3", color: "#94a3b8" }
      ],
      showPayoff: s.payoff,
      payoffStats: [
        { label: "Hours returned / week", value: "12,006", color: "#34d399" },
        { label: "Annual value", value: "$512K", color: "#34d399" },
        { label: "Support deflection", value: "38%", color: "#60a5fa" },
        { label: "Payback", value: "4.1 mo", color: "#60a5fa" }
      ],
      board: s.board.map((t, i) => ({ text: t, n: String(i + 1), last: i === s.board.length - 1 })),
      showBoard: s.board.length > 0,
      closing: s.closing,
      closeChoice: s.closeChoice,
      onCloseDocs: () => this.speakAs("shane", "Good. The assessment pack, the remediation SOW and the Copilot rollout plan are all generated from this scan — I'll walk you through each one in this room.", "purview"),
      onClosePath: () => this.speakAs("shane", "Then here is the path: ten working days of remediation, a Finance and Legal pilot under audit retention, tenant-wide once the evidence pack closes. I'll scope it with you now.", "copilotready"),
      card: s.card ? (() => {
        const c = CARDS[s.card], from = PERSONAS[c.from];
        const sliderVal = s.card === "sharepoint" ? s.metrics.oversharing : s.card === "licensing" ? s.metrics.seatDrift : 0;
        return {
          id: s.card, title: c.title, blurb: c.blurb, icon: ICONS[c.icon],
          fromName: from.name, fromInitials: from.initials, tile: from.tile, color: from.color,
          question: c.question || "What do you want to do with this finding?",
          choices: (() => {
            const t = TOPICS[s.card] || TOPICS.copilotready;
            const who = c.from, p2 = PERSONAS[who];
            const pts = c.pts;
            const mk = (label, said, replyWho, reply, extra) => {
              const rp = PERSONAS[replyWho];
              return {
                label, initials: rp.initials, tile: rp.tile,
                color: "#cbd5e1", border: "rgba(103,232,249,.24)", bg: "rgba(0,120,212,.07)",
                onClick: () => { if (extra) extra(); this.userAsk(said, replyWho, reply, TOPIC_NODE[s.card] || null); }
              };
            };
            return [
              mk("Show me the blast radius", "Show me the blast radius on this one.", who, t.ugly[0] + ". The ring you are looking at is everything that finding touches today.", () => this.setState({ blast: s.card })),
              mk("Why does this matter?", "Why does this matter to us?", who === "shane" ? "jane" : who, t.copilot, null),
              mk("Model the impact on my score", "Model what fixing it does to my score.", "shane", "Modelled: that workstream returns roughly " + pts + " readiness points. Projected score moves to " + Math.min(100, Math.round(61 + pts + Object.keys(s.applied).reduce((a, k) => a + (k === s.card ? 0 : s.applied[k]), 0))) + " percent once delivered.", () => { this.applyCard(s.card, CARDS[s.card].control === "slider" ? (CARDS[s.card].invert ? CARDS[s.card].min : CARDS[s.card].max) : undefined); this.setState({ cardDone: true }); })
            ];
          })(),
          done: s.cardDone,
          statusLabel: s.cardDone ? "IN THE PLAN" : "NEEDS YOUR CALL",
          statusColor: s.cardDone ? "#34d399" : "#fbbf24",
          toggleOn: !!s.applied[s.card],
          knobLeft: s.applied[s.card] ? "22px" : "2px",
          trackBg: s.applied[s.card] ? "#0078D4" : "rgba(51,65,85,.9)",
          min: c.min, max: c.max, value: sliderVal,
          valueLabel: sliderVal + (c.unit || ""),
          onApply: () => this.applyCard(s.card),
          onSlide: (e) => this.applyCard(s.card, Number(e.target.value)),
          onDismiss: () => { clearTimeout(this.cardTimer); this.setState({ card: null, cardDone: false, blast: null, playing: true }, this.tick); }
        };
      })() : null,
      personaPanel: s.persona ? (() => {
        const key = s.persona, p = PERSONAS[key], b = PERSONA_BRIEF[key];
        return {
          name: p.name, role: p.role, initials: p.initials, tile: p.tile, color: p.color,
          fn: b.fn, cares: b.cares, blocking: b.blocking, needs: b.needs,
          columns: [
            { label: "Good", color: "#34d399", items: b.good.map(x => ({ text: x })) },
            { label: "Bad", color: "#fbbf24", items: b.bad.map(x => ({ text: x })) },
            { label: "Ugly", color: "#f87171", items: b.ugly.map(x => ({ text: x })) }
          ],
          priorities: b.priorities.map((x, i) => ({ text: x, n: String(i + 1) })),
          actions: b.actions.map(id => ({
            label: "Open " + TOPICS[id].cta.replace(/ Details$/, "") + " Details",
            onClick: () => this.setState({ persona: null, topic: id })
          }))
        };
      })() : null,
      onClosePersona: () => this.setState({ persona: null, playing: true }, this.tick),
      topic: s.topic ? (() => {
        const t = TOPICS[s.topic];
        return {
          title: t.title, copilot: t.copilot,
          columns: [
            { label: "Good", color: "#34d399", items: t.good.map(x => ({ text: x })) },
            { label: "Bad", color: "#fbbf24", items: t.bad.map(x => ({ text: x })) },
            { label: "Ugly", color: "#f87171", items: t.ugly.map(x => ({ text: x })) }
          ],
          metrics: t.metrics.map(m => ({ label: m[0], value: m[1], color: m[2] })),
          actions: t.actions.map(a => ({
            label: a[0],
            primary: !!a[1],
            color: a[1] ? "#fff" : "#94a3b8",
            bg: a[1] ? "#0078D4" : "rgba(2,6,23,.6)",
            border: a[1] ? "#0078D4" : "rgba(51,65,85,.85)",
            onClick: () => { if (a[1]) this.remediate(a[1]); this.setState({ topic: null, playing: true }, this.tick); }
          }))
        };
      })() : null,
      onCloseTopic: () => this.setState({ topic: null, playing: true }, this.tick),
      draft: s.draft,
      onDraft: (e) => {
        const v = e.target.value;
        if (v && this.state.playing) { clearTimeout(this.timer); this.setState({ playing: false }); }
        this.setState({ draft: v });
      },
      onDraftKey: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.ask(s.draft); } },
      onSend: () => this.ask(s.draft),
      quickActions: [
        { label: "Ask for summary", onClick: () => this.speakAs("shane", "Summary: readiness is 61 percent and blocked. Exchange DLP scope, SharePoint oversharing and Intune drift are the three gaps. Phase 3 closes all three, then Finance and Legal pilot first.", "copilotready") },
        { label: "Drill into SharePoint", onClick: () => this.speakAs("jane", "SharePoint governance: 1,204 sites in scope, 41 carrying org-wide links. The scoped-access sweep runs behind the DLP fix so grounding never sees them.", "sharepoint") },
        { label: "Show Copilot readiness", onClick: () => this.speakAs("priya", "Readiness panel reads 61 percent baseline. Device drift is my line item — 312 endpoints off baseline, all remediating tonight, which returns roughly nine points.", "copilotready") }
      ],
      composerPlaceholder: s.addressee ? "Ask " + PERSONAS[s.addressee].name.split(" ")[0] + " about your tenant…" : "Ask the room anything about your tenant…",
      askPills: ["shane", "jane", "priya", "marcus", "kirk", "beth"].map(k => {
        const p = PERSONAS[k], on = s.addressee === k;
        return {
          label: "Ask " + p.name.split(" ")[0], initials: p.initials, tile: p.tile,
          color: on ? "#e0f2fe" : "#94a3b8",
          border: on ? "rgba(103,232,249,.65)" : "rgba(51,65,85,.85)",
          bg: on ? "rgba(0,120,212,.18)" : "rgba(2,6,23,.55)",
          onClick: () => this.setState(st => ({ addressee: st.addressee === k ? null : k }))
        };
      }),

      logs: s.logs.map(l => ({
        time: l.time, method: l.method, url: l.url, status: l.status, latency: l.latency, text: l.text,
        statusColor: l.status >= 400 ? "#f87171" : l.status >= 300 ? "#fbbf24" : "#34d399"
      })),
      logCount: s.logs.length,
      avgLatency: avg,
      pauseLabel: s.paused ? "RESUME" : "PAUSE",
      onPauseLogs: () => this.setState(p => ({ paused: !p.paused })),
      onClearLogs: () => this.setState({ logs: [] }),
      consoleOpen: s.consoleOpen,
      consoleHeight: s.consoleOpen ? "132px" : "0px",
      consoleToggleLabel: s.consoleOpen ? "COLLAPSE" : "EXPAND",
      onToggleConsole: () => this.setState(p => ({ consoleOpen: !p.consoleOpen })),

      inspector: s.selected ? this.inspectorFor(s.selected) : null,
      onCloseInspector: () => this.setState({ selected: null })
    };
  }

  render() {
    // The design runtime renders the template against { ...props, ...renderVals() }
    // (support.js:965). Keep that merge so prop-driven bindings resolve identically.
    return <WarRoomView v={{ ...this.props, ...this.renderVals() }} />;
  }
}
