/**
 * The site's one primary CTA style (blue→violet gradient) and its
 * paired secondary (hairline outline, no fill). Primary is reserved for
 * the single most important action on a page — never more than one or
 * two per view.
 *
 * @startingPoint section="Marketing" subtitle="Primary gradient CTA and secondary outline button" viewport="360x60"
 */
export interface GradientButtonProps {
  size?: 'sm' | 'md' | 'lg';
  withArrow?: boolean;
  as?: string;
}
export interface OutlineButtonProps {
  size?: 'sm' | 'md' | 'lg';
  as?: string;
}
