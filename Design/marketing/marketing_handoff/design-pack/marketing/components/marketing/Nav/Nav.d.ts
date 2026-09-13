/**
 * Fixed marketing header: logo lockup, a centered nav row with a
 * box-shadow underline active state, and a solid CTA pinned right.
 * The row never wraps as a whole — only the inner link list wraps.
 *
 * @startingPoint section="Marketing" subtitle="Fixed header with active-state nav links" viewport="1200x64"
 */
export interface NavProps {
  /** Key of the currently active nav item — drives the underline state */
  current?: string;
  /** Override the default nav item list */
  items?: { key: string; label: string }[];
}
