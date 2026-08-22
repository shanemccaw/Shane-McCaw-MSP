import React from "react";
import { Nav, type NavCurrent } from "./Nav";
import { Footer } from "./Footer";

// The shared marketing shell: the dark slate canvas (#020617, Inter) with the sticky Nav on top
// and the Footer beneath. Every marketing page renders inside this so later parts only build the
// page body — the chrome is owned here, once. The portal is the light surface; the marketing site
// never is (README: "Visual mode: dark").
export function MarketingLayout({
  current,
  children,
}: {
  current: NavCurrent;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#020617",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        color: "#f8fafc",
      }}
    >
      <Nav current={current} />
      <main style={{ flex: "1 1 auto" }}>{children}</main>
      <Footer />
    </div>
  );
}

// Neutral placeholder body used by every Part-0 stub page. This is scaffolding, not marketing
// copy — later parts replace the whole body with the real page. It renders the page's title so
// each route resolves to a visible, real (if empty) page, and carries a data-testid so a smoke
// test can confirm the route landed.
export function PageStub({ title, route }: { title: string; route: string }) {
  return (
    <section
      data-testid="marketing-page-stub"
      data-page={title}
      style={{
        maxWidth: "1200px",
        margin: "0 auto",
        padding: "120px 32px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <h1
        style={{
          fontSize: "clamp(30px,3.4vw,40px)",
          fontWeight: 800,
          letterSpacing: "-.03em",
          color: "#f8fafc",
          margin: 0,
        }}
      >
        {title}
      </h1>
      <p style={{ fontSize: "13.5px", color: "#64748b", margin: 0 }}>
        {route}
      </p>
    </section>
  );
}

export default MarketingLayout;
