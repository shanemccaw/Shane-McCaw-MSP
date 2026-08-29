/**
 * useSelectionAsk.ts — the selection chip and the ⌘K key, ported from the
 * prototype's document listeners (shell 7457-7484).
 *
 * README §"ShaneBot — selection-based, not always-on": "Highlight any text on
 * any page and a single chip appears at the selection; ⌘K with a selection sends
 * it to ShaneBot with tenant context attached; Escape dismisses. Nothing follows
 * the pointer." So the chip is placed ONCE, at the selection's bounding rect, on
 * mouse-up / key-up — it does not track the pointer. ⌘K with no selection opens
 * the palette instead (shell 7479).
 *
 * The chip is deliberately NOT shown for a selection made inside the ShaneBot
 * panel or a form field (shell 7462), so highlighting a reply to copy it does
 * not offer to ask about it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface SelectionChip {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly words: number;
}

export interface SelectionAskApi {
  readonly chip: SelectionChip | null;
  dismiss(): void;
}

export function useSelectionAsk(askShane: (topic: string) => void, openPalette: () => void): SelectionAskApi {
  const [chip, setChip] = useState<SelectionChip | null>(null);

  // Keep the latest callbacks without re-binding the document listeners.
  const askRef = useRef(askShane);
  askRef.current = askShane;
  const paletteRef = useRef(openPalette);
  paletteRef.current = openPalette;

  const dismiss = useCallback(() => setChip(null), []);

  useEffect(() => {
    const selectionText = (): string => {
      const sel = window.getSelection();
      return sel ? sel.toString().replace(/\s+/g, " ").trim() : "";
    };

    const onSelect = () => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().replace(/\s+/g, " ").trim() : "";
      if (!text || text.length < 3) {
        setChip((c) => (c ? null : c));
        return;
      }
      const anchor =
        sel && sel.anchorNode
          ? sel.anchorNode.nodeType === 1
            ? (sel.anchorNode as Element)
            : sel.anchorNode.parentElement
          : null;
      if (
        anchor &&
        anchor.closest &&
        (anchor.closest("[data-sb-panel]") || anchor.closest("input") || anchor.closest("textarea"))
      ) {
        return;
      }
      let rect: DOMRect;
      try {
        rect = sel!.getRangeAt(0).getBoundingClientRect();
      } catch {
        return;
      }
      if (!rect || (!rect.width && !rect.height)) return;
      setChip({
        label: text.slice(0, 600),
        words: text.split(/\s+/).length,
        x: Math.min(Math.max(rect.left + rect.width / 2, 150), window.innerWidth - 30),
        y: Math.max(rect.top - 12, 54),
      });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setChip((c) => (c ? null : c));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const t = selectionText();
        if (t) {
          setChip(null);
          askRef.current(`About this, from my tenant: "${t.slice(0, 600)}"`);
        } else {
          paletteRef.current();
        }
      }
    };

    document.addEventListener("mouseup", onSelect);
    document.addEventListener("keyup", onSelect);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mouseup", onSelect);
      document.removeEventListener("keyup", onSelect);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return { chip, dismiss };
}
