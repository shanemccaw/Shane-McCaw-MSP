/**
 * AskShaneAffordance.tsx — the "Ask Shane" pill that appears over askable
 * content and hands it to ShaneBot as context.
 *
 * UI ONLY. Clicking it opens the ShaneBot panel with the hovered content quoted
 * in its "Asking about" block; there is no chat behind that yet.
 *
 * TWO RULES MAKE THIS CLICKABLE, AND BOTH ARE EASY TO GET WRONG
 * -------------------------------------------------------------
 * 1. It anchors to the hovered ELEMENT, never to the cursor. The position is
 *    computed once from `getBoundingClientRect()` when the pointer enters the
 *    element and does not move again while the pointer wanders inside it. A
 *    tooltip that chases the cursor can never be clicked, because it moves out
 *    from under the pointer on the way to it.
 * 2. The hover survives the gap between the content and the pill: `mouseout`
 *    returns early when the pointer is moving into the affordance itself (or
 *    back into the same askable element), and every other exit is deferred by
 *    260ms. This is how a native dropdown tolerates the travel into its own
 *    popup, and without it the pill vanishes the instant you reach for it.
 *
 * KEYBOARD — AND WHY IT IS A ROVING TABINDEX RATHER THAN A TAB STOP PER BLOCK
 * --------------------------------------------------------------------------
 * Hover and touch cannot be the only ways in, so the askable blocks are
 * focusable and `focusin` reveals the pill exactly as `mouseover` does.
 *
 * They are NOT each a tab stop. On a live report every `p`, `li`, `tr`,
 * `blockquote`, `h2` and `h3` in the platform's generated HTML is askable —
 * `tabIndex={0}` on all of them would put a hundred-odd stops between the
 * header and the ShaneBot dock, which is a worse experience than the one being
 * fixed, and docking a persistent trigger beside each finding has exactly the
 * same cost on a document with no "findings" structure to hang them off.
 *
 * So the pane takes ONE tab stop and the blocks rove: ArrowDown / ArrowUp move
 * focus between them, focus reveals the pill anchored to the focused block, and
 * Enter on the block asks about it directly (announced with `aria-keyshortcuts`
 * on the block that currently holds the stop). Tab from the block still reaches
 * the pill itself, which is focusable whenever it is visible. The set of
 * askable blocks changes as reports load, so a `MutationObserver` keeps the
 * roving stop in step.
 *
 * TOUCH: NOT VERIFIED ON A REAL DEVICE. `touchstart` is wired to the same
 * reveal, which works in a desktop emulator, but hover-to-reveal is a desktop
 * idiom and this has not been tested on a phone. If it does not read as
 * discoverable there, the fallback — the original spec — is a small persistent
 * icon docked beside each finding on narrow viewports, rather than tap-to-reveal.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";

import { BRAND, RADIUS } from "./journeyTokens.ts";

/** The design's own offsets: the pill hangs off the element's top-right corner. */
const OFFSET_RIGHT = 158;
const EDGE_MARGIN = 10;
const RIGHT_GUTTER = 178;
const OFFSET_TOP = 14;

/** How long the pill survives the pointer leaving the content. */
const DISMISS_MS = 260;

/** Longest quote handed to ShaneBot as context. */
const CONTEXT_MAX = 190;

/** The askable-block selector and the pill's own marker, in one place each. */
const ASKABLE = "[data-ask]";
const AFFORDANCE = "[data-ask-affordance]";

/** The quote a block hands to ShaneBot — collapsed whitespace, hard-capped. */
function contextText(el: Element): string {
  const raw = (el instanceof HTMLElement ? el.innerText : el.textContent) ?? "";
  return raw.replace(/\s+/g, " ").trim().slice(0, CONTEXT_MAX);
}

/**
 * Where the pill sits for a given element. Exported because it is the whole
 * behaviour worth checking: `x` is clamped so the pill never leaves the viewport
 * on a narrow screen, and `y` never rides above the top edge.
 */
export function askAnchor(
  rect: { readonly right: number; readonly top: number },
  viewportWidth: number,
): { readonly x: number; readonly y: number } {
  return {
    x: Math.max(EDGE_MARGIN, Math.min(rect.right - OFFSET_RIGHT, viewportWidth - RIGHT_GUTTER)),
    y: Math.max(EDGE_MARGIN, rect.top - OFFSET_TOP),
  };
}

interface TipState {
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

const HIDDEN: TipState = { visible: false, x: 0, y: 0, text: "" };

export function AskShaneAffordance({
  containerRef,
  onAsk,
}: {
  /** The scrolling reading pane. Hover is delegated from it, not from each row. */
  readonly containerRef: React.RefObject<HTMLElement | null>;
  readonly onAsk: (context: string) => void;
}) {
  const [tip, setTip] = useState<TipState>(HIDDEN);
  const anchorEl = useRef<Element | null>(null);
  const timer = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const dismissNow = useCallback(() => {
    clearTimer();
    anchorEl.current = null;
    setTip(HIDDEN);
  }, [clearTimer]);

  const dismissSoon = useCallback(() => {
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      anchorEl.current = null;
      setTip(HIDDEN);
    }, DISMISS_MS);
  }, [clearTimer]);

  const showFor = useCallback(
    (el: Element, force = false) => {
      clearTimer();
      // Already anchored here — do nothing, so the pill holds still while the
      // pointer moves around inside the same paragraph. `force` re-measures the
      // same element, which is what a scroll under a focused block needs.
      if (!force && el === anchorEl.current) return;

      const text = contextText(el);
      if (!text) return;

      const rect = el.getBoundingClientRect();
      const { x, y } = askAnchor(rect, window.innerWidth);
      anchorEl.current = el;
      setTip({ visible: true, x, y, text });
    },
    [clearTimer],
  );

  const ask = useCallback(
    (text: string) => {
      if (!text) return;
      onAsk(text);
      dismissNow();
    },
    [onAsk, dismissNow],
  );

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    const askables = () => Array.from(node.querySelectorAll<HTMLElement>(ASKABLE));

    /**
     * Keep exactly one askable block in the tab order. `preferred` wins when the
     * caller knows which block just took focus; otherwise whichever already
     * holds the stop keeps it, and a freshly rendered report starts at its
     * first block.
     */
    const syncRoving = (preferred?: HTMLElement) => {
      const list = askables();
      if (!list.length) return;
      const current =
        (preferred && list.includes(preferred) ? preferred : undefined) ??
        list.find((el) => el.getAttribute("tabindex") === "0") ??
        list[0];
      list.forEach((el) => {
        if (el === current) {
          el.setAttribute("tabindex", "0");
          el.setAttribute("aria-keyshortcuts", "Enter");
        } else {
          el.setAttribute("tabindex", "-1");
          el.removeAttribute("aria-keyshortcuts");
        }
      });
    };

    const handleOver = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const el = target.closest(ASKABLE);
      if (el) showFor(el);
    };

    const handleOut = (e: MouseEvent) => {
      const to = e.relatedTarget;
      if (to instanceof Element) {
        // Moving into the pill, or deeper inside the same askable element, is
        // not leaving — this early return is what makes the pill reachable.
        if (to.closest(AFFORDANCE)) return;
        if (anchorEl.current && to.closest(ASKABLE) === anchorEl.current) return;
      }
      dismissSoon();
    };

    const handleTouch = (e: TouchEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const el = target.closest(ASKABLE);
      if (el) showFor(el);
    };

    // Focus is the keyboard's mouseover. It also covers a link or control that
    // happens to sit inside an askable block.
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const el = target.closest<HTMLElement>(ASKABLE);
      if (!el) {
        dismissSoon();
        return;
      }
      syncRoving(el);
      showFor(el);
    };

    // The same early-return contract as `handleOut`, so tabbing from the block
    // to the pill does not dismiss the pill on the way.
    const handleFocusOut = (e: FocusEvent) => {
      const to = e.relatedTarget;
      if (to instanceof Element) {
        if (to.closest(AFFORDANCE)) return;
        if (anchorEl.current && to.closest(ASKABLE) === anchorEl.current) return;
      }
      dismissSoon();
    };

    const handleKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const el = target.closest<HTMLElement>(ASKABLE);
      if (!el) return;

      if (e.key === "Enter") {
        // Only when the block itself holds focus — a link inside a paragraph
        // must still follow its own href.
        if (target !== el) return;
        e.preventDefault();
        ask(contextText(el));
        return;
      }

      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const list = askables();
      const i = list.indexOf(el);
      if (i < 0) return;
      const next = list[e.key === "ArrowDown" ? i + 1 : i - 1];
      if (!next) return;
      e.preventDefault();
      syncRoving(next);
      // Focus fires `handleFocusIn`, which anchors the pill to the new block.
      next.focus();
    };

    // Scroll invalidates the anchor immediately — a pill left behind at a stale
    // rect points at nothing. The exception is the keyboard path: arrowing to
    // the next block scrolls it into view, and dismissing there would hide the
    // pill in the same frame that focus revealed it. While the anchor holds
    // focus the pill is re-measured against it instead of dropped.
    const handleScroll = () => {
      const anchor = anchorEl.current;
      const active = document.activeElement;
      if (anchor && active instanceof Element && (active === anchor || anchor.contains(active))) {
        showFor(anchor, true);
        return;
      }
      dismissNow();
    };

    // The askable set is rewritten every time a report loads — the live body
    // tags its own nodes after the HTML lands — so the roving stop is kept in
    // step by observing rather than by assuming a single pass is enough.
    let frame = 0;
    const scheduleSync = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncRoving();
      });
    };
    const observer = new MutationObserver(scheduleSync);
    observer.observe(node, { childList: true, subtree: true, attributeFilter: ["data-ask"] });
    syncRoving();

    node.addEventListener("mouseover", handleOver);
    node.addEventListener("mouseout", handleOut);
    node.addEventListener("touchstart", handleTouch, { passive: true });
    node.addEventListener("focusin", handleFocusIn);
    node.addEventListener("focusout", handleFocusOut);
    node.addEventListener("keydown", handleKey);
    node.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", dismissNow);

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      node.removeEventListener("mouseover", handleOver);
      node.removeEventListener("mouseout", handleOut);
      node.removeEventListener("touchstart", handleTouch);
      node.removeEventListener("focusin", handleFocusIn);
      node.removeEventListener("focusout", handleFocusOut);
      node.removeEventListener("keydown", handleKey);
      node.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", dismissNow);
      clearTimer();
    };
  }, [containerRef, showFor, dismissSoon, dismissNow, clearTimer, ask]);

  return (
    <button
      type="button"
      data-ask-affordance="1"
      onMouseEnter={clearTimer}
      onMouseLeave={dismissSoon}
      // Focus holds the pill open for as long as a keyboard user needs to press
      // it, and leaving it dismisses on the same 260ms as the pointer does.
      onFocus={clearTimer}
      onBlur={dismissSoon}
      onClick={() => ask(tip.text)}
      tabIndex={tip.visible ? 0 : -1}
      aria-hidden={!tip.visible}
      style={{
        position: "fixed",
        left: tip.x,
        top: tip.y,
        zIndex: 34,
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "6px 11px",
        background: BRAND.navy,
        border: "1px solid rgba(0,180,216,.4)",
        borderRadius: RADIUS.pill,
        boxShadow: "0 6px 18px rgba(10,37,64,.28)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontFamily: "inherit",
        transition: "opacity 140ms ease,left 120ms ease,top 120ms ease",
        opacity: tip.visible ? 1 : 0,
        pointerEvents: tip.visible ? "auto" : "none",
      }}
    >
      <MessageCircle size={12} strokeWidth={2} color={BRAND.teal} aria-hidden="true" />
      <span style={{ fontSize: 11.5, fontWeight: 600, color: BRAND.white }}>Ask Shane</span>
    </button>
  );
}
