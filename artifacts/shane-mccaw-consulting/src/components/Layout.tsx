import React, { ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { BackToTop } from "./BackToTop";
import { TestimonialDiscountCallout } from "./TestimonialDiscountCallout";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-[100dvh] flex flex-col font-sans bg-background text-foreground">
      <Header />
      {/* Sticky coupon bar — fixed just below the nav (top-16 = 64 px), z-40 keeps it below nav dropdowns */}
      <div className="fixed top-16 left-0 right-0 z-40 shadow-sm">
        <TestimonialDiscountCallout variant="banner" />
      </div>
      <main className="flex-1">
        {children}
      </main>
      <Footer />
      <BackToTop />
    </div>
  );
}
