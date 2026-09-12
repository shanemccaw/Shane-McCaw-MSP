import { Link } from "wouter";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh", background: "#020617", color: "#e2e8f0",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: ".12em", color: "#64748b" }}>404</p>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-.02em", color: "#f8fafc" }}>Page not found</h1>
        <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>This route isn't part of the MSP Console.</p>
        <Link href="/tenants" style={{ marginTop: 8, fontSize: 13, fontWeight: 500, color: "#60a5fa", textDecoration: "underline", textUnderlineOffset: 4 }}>
          Back to Managed Tenants
        </Link>
      </div>
    </div>
  );
}
