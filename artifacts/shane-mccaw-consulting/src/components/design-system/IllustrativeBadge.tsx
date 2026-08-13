/**
 * The site's illustrative-data disclosure badge (Home.tsx Mission Control preview
 * convention) — pinned to the top-right of any panel whose numbers are example
 * data rather than the visitor's real tenant. Extracted from SolutionTopicPage.tsx
 * so flagship visuals outside that file (HowItWorksShowcase) share one definition.
 * Deliberately kept OUT of any aria-hidden wrapper by its consumers: the
 * disclosure must stay readable to assistive tech even when the decorated visual
 * itself is decorative.
 */
export function IllustrativeBadge() {
  return (
    <span className="absolute top-4 right-4 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/[0.08] text-text-secondary border border-white/[0.12]">
      Illustrative Example
    </span>
  );
}
