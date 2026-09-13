/**
 * The hero "artefact" panel: a semi-transparent, blended card (never a
 * flat panel) that lets the page's watermark and radial glow read
 * through it. Used for hero-side mockups (a matrix, a chart, a scan
 * readout) — always tinted to the page's own accent color.
 *
 * @startingPoint section="Marketing" subtitle="Semi-transparent glass panel for hero-side mockups" viewport="420x260"
 */
export interface GlassArtefactCardProps {
  color?: string;
  eyebrow?: string;
  tag?: string;
  children?: React.ReactNode;
}
