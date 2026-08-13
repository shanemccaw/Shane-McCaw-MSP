/**
 * DocumentPager.tsx — previous / next across the document set.
 *
 * The set is a reading order, not a menu: nine documents that build on each
 * other, ending on the contract. Without a pager the only way forward is back to
 * the rail, which is a decision the reader should not have to make nine times.
 *
 * At the end of the set the two pills give way to the one thing left to do. That
 * is the design's own shape, and it is why this component knows about the SOW at
 * all — the last page of a report set is where the offer belongs.
 *
 * Titles are shown, not just arrows: "Next" alone makes somebody click to find
 * out where they are going.
 */

import { ArrowLeft, ArrowRight } from "lucide-react";

import { BRAND, INK, RADIUS, hexAlpha } from "./journeyTokens.ts";
import { useState } from "react";

function Pill({
  direction,
  title,
  onClick,
}: {
  readonly direction: "prev" | "next";
  readonly title: string;
  readonly onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const prev = direction === "prev";
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flex: "1 1 260px",
        minWidth: 0,
        maxWidth: 420,
        padding: "12px 16px",
        border: `1px solid ${hovered ? hexAlpha(BRAND.teal, 0.35) : INK.hairlineDark}`,
        borderRadius: RADIUS.card,
        background: hovered ? "rgba(255,255,255,.04)" : "rgba(2,6,23,.4)",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: prev ? "left" : "right",
        flexDirection: prev ? "row" : "row-reverse",
        transition: "background 160ms, border-color 160ms",
      }}
    >
      <span aria-hidden="true" style={{ flex: "none", color: INK.micro, display: "flex" }}>
        {prev ? <ArrowLeft size={15} strokeWidth={1.9} /> : <ArrowRight size={15} strokeWidth={1.9} />}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: "1 1 auto" }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: INK.micro,
          }}
        >
          {prev ? "Previous" : "Next"}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: INK.headingDark,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
      </span>
    </button>
  );
}

export function DocumentPager({
  prevTitle,
  nextTitle,
  onPrev,
  onNext,
  onOpenSow,
  atEnd,
}: {
  readonly prevTitle: string | null;
  readonly nextTitle: string | null;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onOpenSow?: () => void;
  /** True on the last document in the set. */
  readonly atEnd: boolean;
}) {
  // On the contract itself there is nothing to page to and nothing to sell.
  if (!prevTitle && !nextTitle && !atEnd) return null;

  return (
    <div
      data-print-hide
      style={{
        maxWidth: 748,
        margin: "22px auto 0",
        display: "flex",
        alignItems: "stretch",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      {prevTitle ? <Pill direction="prev" title={prevTitle} onClick={onPrev} /> : <span style={{ flex: "1 1 260px" }} />}
      {nextTitle ? (
        <Pill direction="next" title={nextTitle} onClick={onNext} />
      ) : atEnd && onOpenSow ? (
        <button
          type="button"
          onClick={onOpenSow}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            flex: "1 1 260px",
            maxWidth: 420,
            padding: "12px 16px",
            border: 0,
            borderRadius: RADIUS.card,
            background: BRAND.blue,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: ".18em",
                textTransform: "uppercase",
                color: hexAlpha("#FFFFFF", 0.72),
              }}
            >
              That&rsquo;s the set
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: BRAND.white }}>Ready to fix this?</span>
          </span>
          <ArrowRight size={15} strokeWidth={1.9} color={BRAND.white} aria-hidden="true" />
        </button>
      ) : (
        <span style={{ flex: "1 1 260px" }} />
      )}
    </div>
  );
}
