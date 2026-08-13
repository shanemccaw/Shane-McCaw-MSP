import React, { useState } from "react";
import type { CSSProperties } from "react";

type HovProps = {
  /** Underlying intrinsic element to render — the design's original tag. */
  as?: string;
  style?: CSSProperties;
  /** Merged over `style` while hovered (the design's `style-hover` attribute). */
  hoverStyle?: CSSProperties;
  /** Merged over `style` while focused (the design's `style-focus` attribute). */
  focusStyle?: CSSProperties;
  children?: React.ReactNode;
  [key: string]: unknown;
};

/**
 * Element wrapper providing the design DSL's `style-hover` / `style-focus` attributes.
 *
 * The prototype styles everything with inline declarations, so there is no stylesheet
 * rule to hang a `:hover` off. Rather than invent class names for the ~120 affected
 * elements, this reproduces the DSL's own semantics: the hover/focus declarations are
 * merged over the base style while the element is in that state.
 */
export function Hov({
  as = "div",
  style,
  hoverStyle,
  focusStyle,
  children,
  ...rest
}: HovProps): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const merged: CSSProperties | undefined =
    (hovered && hoverStyle) || (focused && focusStyle)
      ? { ...style, ...(hovered ? hoverStyle : null), ...(focused ? focusStyle : null) }
      : style;

  // Preserve any handler the design already put on the element.
  const chain =
    (own: () => void, theirs: unknown) =>
    (event: React.SyntheticEvent) => {
      own();
      if (typeof theirs === "function") (theirs as (e: React.SyntheticEvent) => void)(event);
    };

  return React.createElement(
    as,
    {
      ...rest,
      style: merged,
      onMouseEnter: chain(() => setHovered(true), rest.onMouseEnter),
      onMouseLeave: chain(() => setHovered(false), rest.onMouseLeave),
      onFocus: chain(() => setFocused(true), rest.onFocus),
      onBlur: chain(() => setFocused(false), rest.onBlur),
    },
    children,
  );
}
