import React from "react";

/**
 * Renders one `{{ binding }}` interpolation from the design source.
 *
 * This mirrors the design runtime's own text handling (support.js:576-608) rather than
 * collapsing to a bare `{value}`. The wrapper span is not cosmetic: the prototype emits
 * `<span class="sc-interp">` around every interpolation, and because virtually every
 * container in these screens is `display:flex`, that span is a real flex item. Dropping
 * it would silently change gap spacing and alignment throughout the War Room.
 *
 * Null/undefined/boolean render as nothing, matching the runtime's behaviour for an
 * unresolved binding.
 */
export function Txt({ v }: { v: unknown }): React.ReactElement | null {
  if (v === undefined || v === null || typeof v === "boolean") return null;
  if (React.isValidElement(v) || Array.isArray(v)) return <>{v as React.ReactNode}</>;
  return <span className="sc-interp">{String(v)}</span>;
}
