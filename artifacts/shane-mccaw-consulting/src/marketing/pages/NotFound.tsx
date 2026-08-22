import { Link } from "wouter";
import { MarketingLayout } from "../components/MarketingLayout";

// 404 fallback for the marketing site. The design handoff ships no 404 page, so this is a minimal,
// on-brand fallback in the new dark shell — not one of the 23 real pages.
export default function NotFound() {
  return (
    <MarketingLayout current="none">
      <section
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "120px 32px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: ".2em",
            textTransform: "uppercase",
            color: "#64748b",
          }}
        >
          Error 404
        </span>
        <h1
          style={{
            fontSize: "clamp(30px,3.4vw,40px)",
            fontWeight: 800,
            letterSpacing: "-.03em",
            color: "#f8fafc",
            margin: 0,
          }}
        >
          Page not found
        </h1>
        <p style={{ fontSize: "14px", color: "#94a3b8", margin: 0, lineHeight: 1.7 }}>
          The page you were looking for doesn’t exist.
        </p>
        <Link
          href="/"
          style={{
            marginTop: "6px",
            alignSelf: "flex-start",
            padding: "9px 15px",
            borderRadius: "9px",
            fontSize: "13px",
            fontWeight: 700,
            color: "#fff",
            background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
            textDecoration: "none",
          }}
        >
          Back to home
        </Link>
      </section>
    </MarketingLayout>
  );
}
