import { useState } from "react";

// Git #1359 — "email me a new results link" for a Free Scan return visit whose link is missing,
// invalid or expired. POST /api/public/free-scan/return-link always answers 202 whether or not the
// address belongs to a Free Scan Prospect, so the confirmation copy is deliberately conditional.
export function FreeScanReturnLinkRequest() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/public/free-scan/return-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <p data-testid="freescan-return-link-sent" style={{ margin: "10px 0 0", fontSize: 14, color: "#cbd5e1", lineHeight: 1.6 }}>
        If that address ran a free scan, a new results link is on its way.
      </p>
    );
  }

  return (
    <form
      onSubmit={submit}
      style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", width: "100%" }}
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@yourcompany.com"
        data-testid="freescan-return-email"
        style={{
          flex: "1 1 220px",
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid rgba(51,65,85,.9)",
          background: "#0b1524",
          color: "#f8fafc",
          fontFamily: "inherit",
          fontSize: 14,
        }}
      />
      <button
        type="submit"
        disabled={status === "sending"}
        data-testid="freescan-return-request"
        style={{
          padding: "10px 22px",
          borderRadius: 10,
          border: "1px solid #3b82f6",
          background: "#3b82f6",
          color: "#fff",
          fontFamily: "inherit",
          fontSize: 14,
          fontWeight: 600,
          cursor: status === "sending" ? "default" : "pointer",
        }}
      >
        {status === "sending" ? "Sending…" : "Email me a new link"}
      </button>
      {status === "error" && (
        <p style={{ flexBasis: "100%", margin: 0, fontSize: 12.5, color: "#f87171" }}>
          That didn&apos;t go through. Check the address and try again.
        </p>
      )}
    </form>
  );
}
