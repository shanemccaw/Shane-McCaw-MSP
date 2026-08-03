/**
 * Scroll choreography for the home "room".
 *
 * Port of the export's `startLoop()` / `paintRoom()` with two deliberate changes:
 *
 *  - **The window is the scroller.** The export scrolls an inner
 *    `div[data-scroller]{height:100vh;overflow-y:auto}` because it renders inside
 *    a preview frame. On a real page that costs native scroll restoration, mobile
 *    address-bar collapse, and anchor behaviour, and it strands the site footer
 *    inside a nested scroll box. Every fixed/sticky element in the design behaves
 *    identically against the window, so the scroller is dropped.
 *
 *  - **State lands on data-attributes, not inline style.** React owns `style` on
 *    the transcript nodes and would overwrite an imperative write on the next
 *    state change; it never touches `data-in` / `data-soft` / `data-gen`, so those
 *    survive re-render. The one place inline `transform` is still written directly
 *    is the parallax stage, which is a props-less `memo` and therefore never
 *    re-renders after mount.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import { PILLARS, type ChapterId, type PillarId } from "./roomData";

const REVEAL_SEL = "[data-reveal]";
const REVEAL_LINE = 0.88;
const CHAPTER_LINE = 0.4;
const BEAT_LINE = 0.72;
const ASSEMBLE_LINE = 0.8;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion:reduce)").matches;
}

/** Per-pillar back-wall motion signature, injected into the fixed room stage. */
function motionHTML(kind: string, primary: string, accent: string): string {
  const a = accent;
  const p = primary;
  if (kind === "sweep")
    return (
      `<div style="position:absolute;inset:0;opacity:.5;background-image:linear-gradient(${a}22 1px,transparent 1px),linear-gradient(90deg,${a}18 1px,transparent 1px);background-size:80px 80px"></div>` +
      `<div style="position:absolute;top:0;bottom:0;left:0;width:26%;background:linear-gradient(90deg,transparent,${a}2e,transparent);animation:smcr-hsweep 7s linear infinite"></div>` +
      `<div style="position:absolute;left:0;right:0;top:38%;height:1px;background:linear-gradient(90deg,transparent,${a}66,transparent)"></div>`
    );
  if (kind === "grid")
    return (
      `<div style="position:absolute;inset:0;opacity:.5;background-image:linear-gradient(${a}22 1px,transparent 1px),linear-gradient(90deg,${a}22 1px,transparent 1px);background-size:46px 46px;animation:smcr-gridpulse 4.4s ease-in-out infinite"></div>` +
      `<div style="position:absolute;left:18%;top:20%;width:26%;height:52%;border:1px solid ${a}44;border-radius:8px"></div>` +
      `<div style="position:absolute;left:56%;top:32%;width:22%;height:36%;border:1px solid ${a}33;border-radius:8px;animation:smcr-gridpulse 5.6s ease-in-out 1s infinite"></div>`
    );
  if (kind === "arc")
    return (
      `<div style="position:absolute;left:50%;top:50%;width:64%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:99px;border:1px solid ${a}33;border-top-color:${a}aa;animation:smcr-arc 11s linear infinite"></div>` +
      `<div style="position:absolute;left:50%;top:50%;width:42%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:99px;border:1px dashed ${a}2e;border-right-color:${a}88;animation:smcr-arc 16s linear reverse infinite"></div>` +
      `<div style="position:absolute;left:50%;top:50%;width:22%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:99px;background:radial-gradient(closest-side,${a}33,transparent 70%)"></div>`
    );
  if (kind === "beam")
    return (
      `<div style="position:absolute;inset:0;opacity:.42;background-image:linear-gradient(90deg,${a}26 1px,transparent 1px);background-size:64px 100%"></div>` +
      `<div style="position:absolute;left:26%;top:0;bottom:0;width:16%;background:linear-gradient(180deg,transparent,${a}2e,transparent);animation:smcr-vbeam 6s linear infinite"></div>` +
      `<div style="position:absolute;left:64%;top:0;bottom:0;width:12%;background:linear-gradient(180deg,transparent,${a}24,transparent);animation:smcr-vbeam 8s linear 2s infinite"></div>`
    );
  if (kind === "pulse")
    return (
      `<div style="position:absolute;left:50%;top:50%;width:56%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:99px;border:1px solid ${a}3d;animation:smcr-heartbeat 2.6s ease-in-out infinite"></div>` +
      `<div style="position:absolute;left:50%;top:50%;width:34%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:99px;border:1px solid ${a}52;animation:smcr-heartbeat 2.6s ease-in-out .3s infinite"></div>` +
      `<div style="position:absolute;left:8%;right:8%;top:50%;height:1px;background:linear-gradient(90deg,transparent,${a}66,transparent)"></div>`
    );
  if (kind === "ripple")
    return (
      `<div style="position:absolute;left:50%;top:50%;width:70%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:99px;border:1px solid ${a}44;animation:smcr-ripple 5s ease-out infinite"></div>` +
      `<div style="position:absolute;left:50%;top:50%;width:70%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:99px;border:1px solid ${a}3a;animation:smcr-ripple 5s ease-out 1.6s infinite"></div>` +
      `<div style="position:absolute;left:50%;top:50%;width:70%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:99px;border:1px solid ${a}30;animation:smcr-ripple 5s ease-out 3.2s infinite"></div>`
    );
  return (
    `<div style="position:absolute;inset:0;animation:smcr-hue 18s linear infinite">` +
    `<div style="position:absolute;left:50%;top:50%;width:76%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:99px;background:conic-gradient(from 0turn,#3B82F644,#8B5CF644,#67E8F944,#F3F4F633,#3B82F644);filter:blur(38px);animation:smcr-spin 26s linear infinite"></div>` +
    `<div style="position:absolute;left:50%;top:50%;width:44%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:99px;border:1px solid ${a}55;animation:smcr-burst 4.5s ease-out infinite"></div>` +
    `<div style="position:absolute;left:50%;top:50%;width:44%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:99px;border:1px solid ${p}44;animation:smcr-burst 4.5s ease-out 2.2s infinite"></div></div>`
  );
}

interface PaintTimers {
  wordmark?: number;
  motion?: number;
}

/** Repaints the fixed stage for a chapter: tint, alarm, flare, wordmark, motion signature. */
function paintRoom(root: HTMLElement, id: string, timers: PaintTimers, reduce: boolean) {
  const p = PILLARS.find((x) => x.id === id);
  const primary = p ? p.primary : "#67E8F9";
  const accent = p ? p.accent : "#7DD3FC";

  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);

  // Security is the alarm chapter: the whole room goes red.
  const alarm = q<HTMLElement>("[data-alarm]");
  if (alarm) alarm.style.opacity = id === "security" ? "1" : "0";

  // A one-shot flare on every chapter change, so the transition is felt.
  const flare = q<HTMLElement>("[data-flare]");
  if (flare && !reduce) {
    const band = flare.querySelector<HTMLElement>("[data-flare-band]");
    const line = flare.querySelector<HTMLElement>("[data-flare-line]");
    if (band) {
      band.style.background = `radial-gradient(ellipse 90% 60% at 50% 38%,${accent}3d, transparent 68%)`;
      band.style.animation = "none";
      void band.offsetWidth;
      band.style.animation = "smcr-flare 1100ms cubic-bezier(.22,1,.36,1) both";
    }
    if (line) {
      line.style.background = `linear-gradient(90deg,transparent,${accent},transparent)`;
      line.style.boxShadow = `0 0 40px ${accent}`;
      line.style.animation = "none";
      void line.offsetWidth;
      line.style.animation = "smcr-wipe 900ms cubic-bezier(.22,1,.36,1) both";
    }
    flare.style.opacity = "1";
  }

  // Giant pillar wordmark + glyph behind everything, so the chapter is unmistakable.
  const wm = q<HTMLElement>("[data-wordmark]");
  if (wm) {
    const icon = wm.querySelector<SVGElement>("[data-wordmark-icon]");
    const text = wm.querySelector<HTMLElement>("[data-wordmark-text]");
    wm.style.opacity = "0";
    wm.style.transform = "translateY(-50%) scale(.965)";
    window.clearTimeout(timers.wordmark);
    timers.wordmark = window.setTimeout(() => {
      if (!p) return;
      if (text) {
        text.textContent = p.title.toUpperCase();
        text.style.color = p.accent;
      }
      if (icon) {
        icon.style.color = p.accent;
        icon.innerHTML =
          p.paths.map((d) => `<path d="${d}"></path>`).join("") +
          (p.circles ?? []).map((c) => `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}"></circle>`).join("");
      }
      wm.style.opacity = "1";
      wm.style.transform = "translateY(-50%) scale(1)";
    }, 240);
  }

  const tint = q<HTMLElement>("[data-tint]");
  const table = q<HTMLElement>("[data-table]");
  const motion = q<HTMLElement>("[data-motion]");
  if (tint) tint.style.background = `radial-gradient(ellipse at 50% 30%,${accent}2e, transparent 66%)`;
  if (table) table.style.background = `radial-gradient(ellipse at 50% 42%,${accent}1f, transparent 66%)`;
  if (motion) {
    motion.style.transition = "opacity 500ms ease";
    motion.style.opacity = "0";
    window.clearTimeout(timers.motion);
    timers.motion = window.setTimeout(() => {
      motion.innerHTML = motionHTML(p ? p.motion : "burst", primary, accent);
      motion.style.opacity = "1";
    }, 240);
  }
}

export interface ChoreographyHandlers {
  onChapter: (id: ChapterId) => void;
  onScrolledPast: (id: string) => void;
  onAutoSkip: () => void;
  focusMode?: boolean;
  /** The booking conversation is never softened once opened — it is what the visitor just asked for. */
  bookOpen?: boolean;
}

export function useRoomChoreography(
  rootRef: React.RefObject<HTMLDivElement | null>,
  handlers: ChoreographyHandlers,
) {
  // Handlers change identity every render; a ref keeps the listener stable.
  const hRef = useRef(handlers);
  hRef.current = handlers;

  // Arm the reveal targets before first paint: anything already below the fold
  // starts hidden, everything above stays visible. Done with the transition
  // suppressed for one frame so arming is never itself animated. If this never
  // runs (JS off, hydration error) nothing carries data-in and the whole page
  // renders visible — the reveal is decoration, never a gate on content.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) return;
    const h = window.innerHeight;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(REVEAL_SEL));
    root.setAttribute("data-arming", "1");
    nodes.forEach((n) => {
      n.setAttribute("data-in", n.getBoundingClientRect().top >= h * REVEAL_LINE ? "0" : "1");
    });
    void root.offsetWidth;
    root.removeAttribute("data-arming");
  }, [rootRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reduce = prefersReducedMotion();
    const timers: PaintTimers = {};
    const genTimers: number[] = [];
    let raf = 0;
    let lastChapter: string | null = null;
    let plxLayers: HTMLElement[] = [];

    const getLayers = () => {
      if (!plxLayers.length || !plxLayers[0].isConnected) {
        plxLayers = Array.from(root.querySelectorAll<HTMLElement>("[data-plx]"));
        plxLayers.forEach((l) => {
          if (l.dataset.plxBase === undefined) l.dataset.plxBase = l.style.transform || "";
        });
      }
      return plxLayers;
    };

    const tick = () => {
      raf = 0;
      const H = window.innerHeight;

      // --- reveal ---
      root.querySelectorAll<HTMLElement>('[data-reveal][data-in="0"]').forEach((n) => {
        if (n.getBoundingClientRect().top < H * REVEAL_LINE) n.setAttribute("data-in", "1");
      });

      // --- the "generating" beat on each assistant turn ---
      if (!reduce) {
        root.querySelectorAll<HTMLElement>(".smcr-gen:not([data-gen])").forEach((n) => {
          if (n.getBoundingClientRect().top >= H * 0.9) return;
          n.setAttribute("data-gen", "pending");
          genTimers.push(window.setTimeout(() => n.setAttribute("data-gen", "done"), 620));
        });
      }

      // --- parallax ---
      const hero = root.querySelector<HTMLElement>('[data-chapter="hero"]');
      if (!reduce && hero) {
        const y = Math.max(0, -hero.getBoundingClientRect().top);
        getLayers().forEach((l) => {
          const f = parseFloat(l.dataset.plx || "0");
          l.style.transform = `${l.dataset.plxBase || ""} translate3d(0,${-y * f}px,0)`;
        });
      }

      // --- chapter tracking ---
      // Guarded on a settled document height: on the very first paint every
      // section can report bottom < 0 and mark the whole page as already read.
      const settled = document.documentElement.scrollHeight > H * 2;
      let id = "hero";
      root.querySelectorAll<HTMLElement>("[data-chapter]").forEach((n) => {
        const r = n.getBoundingClientRect();
        if (!settled || r.height <= 0) return;
        if (r.top <= H * CHAPTER_LINE) id = n.dataset.chapter || id;
        // A pillar counts as passed once its own box has left the top of the viewport.
        if (r.bottom < 0 && n.dataset.chapter) hRef.current.onScrolledPast(n.dataset.chapter);
      });

      // Reaching a pillar's divider without answering is a decision: take the sector defaults.
      if (settled) {
        root.querySelectorAll<HTMLElement>("[data-pillar-beat]").forEach((n) => {
          const key = n.dataset.pillarBeat;
          if (key && n.getBoundingClientRect().top < H * BEAT_LINE) hRef.current.onScrolledPast(key);
        });
      }

      if (id !== lastChapter) {
        lastChapter = id;
        paintRoom(root, id, timers, reduce);
        hRef.current.onChapter(id as ChapterId);
      }

      // Reaching the assemble beat means they are done answering — take the
      // defaults so the dossier is populated rather than sitting empty behind them.
      const assemble = root.querySelector<HTMLElement>("[data-assemble]");
      if (assemble && settled && window.scrollY > 40) {
        if (assemble.getBoundingClientRect().top < H * ASSEMBLE_LINE) hRef.current.onAutoSkip();
      }

      // --- focus mode: everything below the chapter being read softens back ---
      if (hRef.current.focusMode !== false && !reduce) {
        const secs = Array.from(root.querySelectorAll<HTMLElement>("[data-chapter]"));
        const activeI = secs.findIndex((n) => n.dataset.chapter === id);
        const bookOpen = hRef.current.bookOpen === true;
        secs.forEach((n, i) => {
          const soften =
            activeI >= 0 && i > activeI && !(bookOpen && n.dataset.chapter === "book");
          const want = soften ? "1" : "0";
          if (n.getAttribute("data-soft") !== want) n.setAttribute("data-soft", want);
        });
      }

      // --- the fixed rails yield to the real site footer ---
      const footer = root.querySelector<HTMLElement>("[data-room-footer]");
      if (footer) {
        const over = footer.getBoundingClientRect().top < H;
        const want = over ? "off" : "on";
        if (root.getAttribute("data-chrome") !== want) root.setAttribute("data-chrome", want);
      }
    };

    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(tick);
    };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    const onVisibility = () => root.setAttribute("data-idle", document.visibilityState === "hidden" ? "1" : "0");
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();

    // The document grows as sections mount and fonts settle; a short poll keeps
    // the geometry-derived state honest without a ResizeObserver per section.
    const poll = window.setInterval(schedule, 400);

    paintRoom(root, "hero", timers, reduce);
    schedule();

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(poll);
      if (raf) window.cancelAnimationFrame(raf);
      window.clearTimeout(timers.wordmark);
      window.clearTimeout(timers.motion);
      genTimers.forEach((t) => window.clearTimeout(t));
    };
  }, [rootRef]);
}

/** Smooth-scrolls to a chapter, clearing the sticky header. */
export function scrollToChapter(id: PillarId | string) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 78;
  window.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}
