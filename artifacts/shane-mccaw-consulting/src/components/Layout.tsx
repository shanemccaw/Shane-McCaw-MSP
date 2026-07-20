import { useState, useEffect, type ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { BackToTop } from "./BackToTop";
import { TestimonialDiscountCallout } from "./TestimonialDiscountCallout";
import { EngagementOfferPanel } from "./EngagementOfferPanel";

const BANNER_KEY = "offer-banner-dismissed";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [bannerVisible, setBannerVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(BANNER_KEY)) {
      setBannerVisible(true);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem(BANNER_KEY, "1");
    setBannerVisible(false);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col font-sans bg-charcoal-0 text-text-primary">
      <Header />
      {/* Sticky coupon bar — fixed just below the nav (top-16 = 64 px), z-40 keeps it below nav dropdowns */}
      {bannerVisible && (
        <div className="fixed top-16 left-0 right-0 z-40 shadow-sm">
          <TestimonialDiscountCallout variant="banner" onClose={handleClose} />
        </div>
      )}
      <main className="flex-1">
        {children}
      </main>
      <Footer />
      <BackToTop />
      <EngagementOfferPanel />
    </div>
  );
}
