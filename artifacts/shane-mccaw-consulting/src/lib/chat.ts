/**
 * The public site's single "talk to a human" front door is the AI chat bubble
 * (PersistentChatBubble). The former contact form and booking-calendar pages have
 * been removed — every CTA that used to point at those opens the bubble instead,
 * via openChat().
 *
 * Implemented as a window CustomEvent so any component (nav, footer, page CTA, a
 * thin auto-open route) can trigger the bubble without prop-drilling or a shared
 * context — the bubble is mounted once in Layout and listens for this event.
 */
export const CHAT_OPEN_EVENT = "smc:open-chat";

/** Open the site AI assistant chat bubble from anywhere. */
export function openChat(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT));
}
