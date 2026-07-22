import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { usePersonalizationState } from "@/hooks/usePersonalizationState";
import { usePortalUrl } from "@/hooks/usePersonalizationData";
import { trackEvent } from "@/lib/analytics";
import { CHAT_OPEN_EVENT } from "@/lib/chat";
import { PublicChatWidget } from "./PublicChatWidget";
import { PortalSupportHandoff } from "./PortalSupportHandoff";

const DISMISS_KEY = "chat-bubble-dismissed";

/**
 * Global, persistent-but-dismissible chat launcher — mounted once in Layout.tsx (not
 * per-page) so it follows the visitor across every route, mirroring BackToTop/
 * EngagementOfferPanel's existing "mount once in Layout" convention.
 *
 * This bubble is the public site's SINGLE "talk to a human" front door: the former
 * contact form and booking-calendar pages have been removed — every CTA that used to
 * point there now fires openChat() (a `smc:open-chat` window event this bubble hears),
 * which un-dismisses and opens the panel. The panel runs the real, grounded, guarded
 * public AI assistant (PublicChatWidget → POST /api/public-chat). Assessment-tier
 * visitors with a resolved Portal are instead handed off to the authenticated Portal
 * support chat (PortalSupportHandoff) — that system is separate and out of scope.
 *
 * Dismissal is sessionStorage-backed (not localStorage) so closing it holds for the
 * rest of the browsing session without silently hiding it forever on a future visit —
 * Layout itself remounts on every client-side route change in this app (each page
 * wraps its own <Layout>, App.tsx does not wrap <Switch> once), so per-mount React
 * state alone would reappear on every navigation. An openChat() event overrides the
 * dismissed state so a CTA click always reopens it.
 */
export function PersistentChatBubble() {
  const [dismissed, setDismissed] = useState(true);
  const [open, setOpen] = useState(false);
  const { tier } = usePersonalizationState();
  const { portalUrl } = usePortalUrl();

  useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  // A CTA anywhere on the site (former contact-form and booking links) fires
  // openChat() → un-dismiss and open. This is the only front door, so an explicit open
  // request always wins over a prior session dismissal.
  useEffect(() => {
    const onOpen = () => {
      sessionStorage.removeItem(DISMISS_KEY);
      setDismissed(false);
      setOpen(true);
      trackEvent("personalization_shown", { tier, surface: "persistent_chat_bubble_cta" });
    };
    window.addEventListener(CHAT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CHAT_OPEN_EVENT, onOpen);
  }, [tier]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      trackEvent("personalization_shown", { tier, surface: "persistent_chat_bubble" });
    }
  };

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
    setOpen(false);
  };

  if (dismissed) return null;

  return (
    <>
      {open && (
        <div
          className="menu-panel fixed bottom-24 right-6 z-40 w-[calc(100vw-3rem)] max-w-sm max-h-[70vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          role="complementary"
          aria-label="Chat with Shane's AI Assistant"
        >
          {tier === "assessment" && portalUrl ? (
            <div className="p-1 overflow-y-auto">
              <PortalSupportHandoff portalUrl={portalUrl} surface="persistent_chat_bubble" compact />
            </div>
          ) : (
            <PublicChatWidget
              className="border-0 rounded-none"
              bodyMaxHeight="280px"
              subtitle="Ask about services, pricing, or getting started"
            />
          )}
        </div>
      )}

      <div className="fixed bottom-6 right-6 z-40">
        <button
          onClick={handleToggle}
          aria-label={open ? "Close chat" : "Chat with Shane's AI Assistant"}
          aria-expanded={open}
          className="w-14 h-14 rounded-full text-white shadow-2xl flex items-center justify-center transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-charcoal-0"
          style={{ background: "linear-gradient(135deg, var(--accent-blue), var(--accent-violet))" }}
          data-testid="chat-bubble-toggle"
        >
          {open ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
        </button>
        {!open && (
          <button
            onClick={handleDismiss}
            aria-label="Dismiss chat bubble"
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-charcoal-1 border border-white/[0.12] text-text-tertiary hover:text-text-primary flex items-center justify-center transition-colors"
            data-testid="chat-bubble-dismiss"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </>
  );
}
