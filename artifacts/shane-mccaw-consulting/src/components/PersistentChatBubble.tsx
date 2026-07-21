import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { usePersonalizationState } from "@/hooks/usePersonalizationState";
import { usePortalUrl } from "@/hooks/usePersonalizationData";
import { trackEvent } from "@/lib/analytics";
import { ContactChatWidget } from "./ContactChatWidget";
import { PortalSupportHandoff } from "./PortalSupportHandoff";

const DISMISS_KEY = "chat-bubble-dismissed";

/**
 * Global, persistent-but-dismissible chat launcher — mounted once in Layout.tsx (not
 * per-page) so it follows the visitor across every route, mirroring BackToTop/
 * EngagementOfferPanel's existing "mount once in Layout" convention. Opens the exact same
 * live AI assistant Contact.tsx's own chat panel uses (ContactChatWidget, real
 * POST /api/contact-chat + POST /api/leads) rather than a second, fake chat surface — this
 * is a faster entry point into the same real intake flow, not a different one. Assessment-
 * tier visitors with a resolved Portal get the same PortalSupportHandoff routing Contact.tsx
 * gives them, for the same reason (their Portal AI has real tenant context this one lacks).
 * Dismissal is sessionStorage-backed (not localStorage) so closing it holds for the rest of
 * the browsing session without silently hiding it forever on a future visit — Layout itself
 * remounts on every client-side route change in this app (each page wraps its own <Layout>,
 * App.tsx does not wrap <Switch> once), so per-mount React state alone would reappear on
 * every navigation.
 */
export function PersistentChatBubble() {
  const [dismissed, setDismissed] = useState(true);
  const [open, setOpen] = useState(false);
  const { tier } = usePersonalizationState();
  const { portalUrl } = usePortalUrl();

  useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
  }, []);

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
            <ContactChatWidget
              className="border-0 rounded-none"
              bodyMaxHeight="280px"
              subtitle="Ask a quick question — Shane follows up personally"
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
