/**
 * Page-level background patterns. Every marketing page opens with a
 * PageGradientSection (a large low-opacity radial glow in the page's own
 * color, plus a giant faint watermark glyph behind the hero — never a
 * hard-edged color block). Body sections between hero and footer use
 * SeamSection instead: no hairline borders between sections, just a
 * gradient-to-raised-navy seam.
 *
 * @startingPoint section="Marketing" subtitle="Hero radial-glow background with watermark glyph" viewport="900x260"
 */
export interface PageGradientSectionProps {
  color?: string;
  /** raw SVG path/shape markup for the watermark glyph */
  watermark?: string;
  padding?: string;
  children?: React.ReactNode;
}

export interface SeamSectionProps {
  tintColor?: string;
  padding?: string;
  children?: React.ReactNode;
}
