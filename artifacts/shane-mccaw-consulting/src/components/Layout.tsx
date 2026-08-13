import { type ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { BackToTop } from "./BackToTop";
import { EngagementOfferPanel } from "./EngagementOfferPanel";
import { PersistentChatBubble } from "./PersistentChatBubble";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-[100dvh] flex flex-col font-sans bg-charcoal-0 text-text-primary">
      <Header />
      <main className="flex-1">
        {children}
      </main>
      <Footer />
      <BackToTop />
      <EngagementOfferPanel />
      <PersistentChatBubble />
    </div>
  );
}
