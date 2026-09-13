/**
 * Site footer: logo + description, three link columns, a legal row.
 * A floating gradient chat FAB (AskChatFAB) is a sibling pattern any
 * page can trigger — the footer owns its open/closed state.
 *
 * @startingPoint section="Marketing" subtitle="Site footer with link columns and legal row" viewport="1200x300"
 */
export interface FooterProps {
  columns?: { title: string; links: string[] }[];
}

export interface AskChatFABProps {
  open: boolean;
  onToggle: () => void;
}
