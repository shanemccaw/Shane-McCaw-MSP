/**
 * The recurring "category identity" pattern: a stroke glyph in a tinted
 * rounded tile, in the category's own color. Used wherever a category is
 * named — nav dropdown, hero eyebrow, strips at the bottom of a page.
 * Two variants: a plain icon tile, or a pill/chip with a label (with an
 * active state for the current category).
 *
 * @startingPoint section="Marketing" subtitle="Tinted icon tile / chip for a category's identity color" viewport="240x60"
 */
export interface PillarIdentityProps {
  color: string;
  icon?: string;
  label?: string;
  variant?: 'tile' | 'chip';
  active?: boolean;
}
