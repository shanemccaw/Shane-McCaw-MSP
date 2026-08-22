import React from "react";
import { Link, useParams } from "wouter";
import { Nav } from "../components/Nav";
import { getChangeRecord, RESULT_COLOR, type ChangeRecordData } from "../data/changeRecord";

// Route /records/:id — recreated from Design/design_handoff_marketing/Quick-Start Change
// Record.dc.html. A real document, not a dashboard: site nav + a dark header band (record ID,
// Download PDF/CSV, Back to packs), then a paged document below with a running header/footer per
// printed page. Copy and figures are the design's own verbatim example, kept in
// marketing/data/changeRecord.ts (README: production reads this from the real execution log —
// this fixture stands in until the write-back engine is real).
//
// This page owns its own chrome (Nav only, no Footer) — the design ends at the document, the same
// choice FreeScan/Buy made for their own focused, non-browsing pages.
//
// PRINT GEOMETRY: the design's doc-page.js is a web-component custom element (paged-document
// shell with running header/footer). This React/Vite/Tailwind stack has no such element loaded
// anywhere else in the app, so rather than port a whole custom-element library for one page, this
// rebuilds doc-page's INTENT with plain CSS: `display: table-header-group` / `table-footer-group`
// on the header/footer bands (browsers natively repeat these on every printed page, the same
// mechanism doc-page.js uses internally via a real <table>), `@page` for the sheet margin, and
// `@media print` to hide the site chrome so only the document prints.

const eyebrow: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: ".2em",
  textTransform: "uppercase",
};

function downloadCsv(record: ChangeRecordData) {
  const rows: string[][] = [["Pack", "Setting", "Before", "After", "Result"]];
  for (const pack of record.packs) {
    for (const row of pack.rows) {
      rows.push([pack.name, row.setting, row.before, row.after, row.resultLabel]);
    }
  }
  const csv = rows
    .map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(","))
    .join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `${record.id}-change-record.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function ChangeRecord() {
  const params = useParams<{ id: string }>();
  const record = getChangeRecord(params.id ?? "");

  return (
    <div style={{ background: "#f5f5f4", minHeight: "100vh" }}>
      <style>{`
        @media print {
          .cr-site-chrome { display: none !important; }
          .cr-sheet {
            box-shadow: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            width: auto !important;
          }
          @page { margin: 0.7in; }
        }
      `}</style>

      {/* ── Site chrome: Nav + dark header band ─────────────────────────────────── */}
      <div className="cr-site-chrome" style={{ background: "#020617" }}>
        <Nav current="none" />
        <div
          style={{
            maxWidth: "1120px",
            margin: "0 auto",
            padding: "26px 32px 22px",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "20px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ ...eyebrow, color: "#60a5fa" }}>Your documents · change record</span>
            <span
              style={{
                fontSize: "22px",
                fontWeight: 800,
                letterSpacing: "-.025em",
                color: "#f8fafc",
                lineHeight: 1.25,
              }}
              data-testid="cr-record-id"
            >
              {record.id} · {record.tenantName}
            </span>
            <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.6, maxWidth: "70ch" }}>
              {record.tagline}
            </span>
          </div>
          <div style={{ flex: "0 0 auto", display: "flex", gap: "9px", flexWrap: "wrap" }}>
            <button
              data-testid="cr-download-pdf"
              onClick={() => window.print()}
              style={{
                padding: "11px 18px",
                border: 0,
                borderRadius: "10px",
                fontFamily: "inherit",
                fontSize: "12.5px",
                fontWeight: 700,
                color: "#fff",
                background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Download PDF
            </button>
            <button
              data-testid="cr-download-csv"
              onClick={() => downloadCsv(record)}
              style={{
                padding: "11px 18px",
                borderRadius: "10px",
                fontFamily: "inherit",
                fontSize: "12.5px",
                fontWeight: 600,
                color: "#cbd5e1",
                background: "transparent",
                border: "1px solid rgba(148,163,184,.22)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Download CSV
            </button>
            <Link
              href="/quick-start"
              data-testid="cr-back-to-packs"
              style={{
                padding: "11px 18px",
                borderRadius: "10px",
                fontSize: "12.5px",
                fontWeight: 600,
                color: "#94a3b8",
                border: "1px solid rgba(148,163,184,.16)",
                whiteSpace: "nowrap",
                textDecoration: "none",
              }}
            >
              Back to packs
            </Link>
          </div>
        </div>
        <div style={{ maxWidth: "1120px", margin: "0 auto", padding: "0 32px 4px" }}>
          <span
            style={{
              display: "block",
              height: "1px",
              background: "linear-gradient(90deg,rgba(59,130,246,.35),rgba(2,6,23,0))",
            }}
          />
        </div>
      </div>

      {/* ── The document ─────────────────────────────────────────────────────────── */}
      <div
        className="cr-sheet"
        data-testid="change-record-document"
        style={{
          width: "8.5in",
          maxWidth: "calc(100% - 48px)",
          margin: "48px auto",
          background: "#fff",
          boxShadow: "0 2px 10px rgba(20,20,19,.12)",
          borderRadius: "7px",
          boxSizing: "border-box",
          padding: "0.7in",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ padding: 0, fontWeight: "inherit", textAlign: "left" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: "16px",
                    paddingBottom: "8px",
                    borderBottom: "1px solid #d7dee7",
                    marginBottom: "16px",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "baseline", gap: "9px" }}>
                    <span style={{ fontSize: "10.5pt", fontWeight: 800, color: "#0A2540", letterSpacing: "-.01em" }}>
                      Shane McCaw Consulting
                    </span>
                    <span
                      style={{
                        fontSize: "8.5pt",
                        fontWeight: 700,
                        letterSpacing: ".14em",
                        textTransform: "uppercase",
                        color: "#64748b",
                      }}
                    >
                      Change record
                    </span>
                  </span>
                  <span style={{ fontSize: "8.5pt", color: "#64748b" }}>
                    {record.id} · {record.tenantName}
                  </span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: 0 }}>
                <h1
                  style={{
                    margin: "0 0 6px",
                    fontSize: "23pt",
                    fontWeight: 800,
                    letterSpacing: "-.025em",
                    color: "#0A2540",
                    lineHeight: 1.15,
                  }}
                >
                  Quick-Start Pack change record
                </h1>
                <p style={{ margin: "0 0 22px", fontSize: "11pt", lineHeight: 1.6, color: "#475569", maxWidth: "74ch" }}>
                  Every configuration value this purchase changed in the {record.tenantName} tenant, as read
                  before the change and after it. Items you deselected are listed too, with the value left in
                  place. This document is the record of work: nothing here is a recommendation.
                </p>

                {/* Summary tiles */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4,minmax(0,1fr))",
                    gap: 0,
                    marginBottom: "24px",
                    border: "1px solid #d7dee7",
                    borderRadius: "8px",
                    overflow: "hidden",
                  }}
                >
                  {[
                    { label: "Packs purchased", value: record.summary.packsPurchased, last: false },
                    { label: "Changes applied", value: record.summary.changesApplied, last: false },
                    { label: "Declined by you", value: record.summary.declinedByYou, last: false },
                    { label: "Already correct", value: record.summary.alreadyCorrect, last: true },
                  ].map((tile) => (
                    <div
                      key={tile.label}
                      style={{
                        padding: "12px 14px",
                        borderRight: tile.last ? undefined : "1px solid #e7ebf0",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "8pt",
                          fontWeight: 700,
                          letterSpacing: ".12em",
                          textTransform: "uppercase",
                          color: "#64748b",
                          marginBottom: "4px",
                        }}
                      >
                        {tile.label}
                      </div>
                      <div style={{ fontSize: "15pt", fontWeight: 800, color: "#0A2540" }}>{tile.value}</div>
                    </div>
                  ))}
                </div>

                {/* Authorisation and access */}
                <h2 style={{ margin: "0 0 10px", fontSize: "13pt", fontWeight: 800, color: "#0A2540", letterSpacing: "-.01em" }}>
                  Authorisation and access
                </h2>
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "24px", fontSize: "10pt" }}>
                  <tbody>
                    {record.authorisation.map((row, i) => (
                      <tr key={row.label}>
                        <td
                          style={{
                            padding: "7px 0",
                            borderBottom: i === record.authorisation.length - 1 ? undefined : "1px solid #e7ebf0",
                            color: "#64748b",
                            width: "40%",
                          }}
                        >
                          {row.label}
                        </td>
                        <td
                          style={{
                            padding: "7px 0",
                            borderBottom: i === record.authorisation.length - 1 ? undefined : "1px solid #e7ebf0",
                            color: "#0A2540",
                            fontWeight: 600,
                          }}
                        >
                          {row.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Per-pack setting/before/after/result tables */}
                {record.packs.map((pack, packIndex) => (
                  <React.Fragment key={pack.name}>
                    <h2
                      data-testid={`cr-pack-heading-${packIndex}`}
                      style={{ margin: "0 0 4px", fontSize: "13pt", fontWeight: 800, color: "#0A2540", letterSpacing: "-.01em" }}
                    >
                      {pack.name}
                    </h2>
                    <p style={{ margin: "0 0 10px", fontSize: "9.5pt", color: "#64748b" }}>
                      {pack.priceLabel} · {pack.scopeNote}
                    </p>
                    <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "22px", fontSize: "9.5pt" }}>
                      <thead>
                        <tr>
                          {["Setting", "Before", "After", "Result"].map((h, i) => (
                            <th
                              key={h}
                              style={{
                                textAlign: "left",
                                padding: i === 0 ? "7px 8px 7px 0" : i === 3 ? "7px 0 7px 8px" : "7px 8px",
                                borderBottom: "2px solid #0A2540",
                                fontSize: "8pt",
                                fontWeight: 700,
                                letterSpacing: ".1em",
                                textTransform: "uppercase",
                                color: "#0A2540",
                                width: i === 0 ? "30%" : i === 1 || i === 2 ? "28%" : undefined,
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pack.rows.map((row, i) => {
                          const notLast = i !== pack.rows.length - 1;
                          const border = notLast ? "1px solid #e7ebf0" : undefined;
                          const dimmed = row.result === "correct";
                          return (
                            <tr key={row.setting}>
                              <td style={{ padding: "8px 8px 8px 0", borderBottom: border, color: "#0A2540", fontWeight: 600 }}>
                                {row.setting}
                              </td>
                              <td style={{ padding: "8px", borderBottom: border, color: "#475569" }}>{row.before}</td>
                              <td style={{ padding: "8px", borderBottom: border, color: dimmed ? "#475569" : "#0A2540" }}>
                                {row.after}
                              </td>
                              <td
                                data-testid={row.result === "declined" ? "cr-result-declined" : undefined}
                                style={{
                                  padding: "8px 0 8px 8px",
                                  borderBottom: border,
                                  color: RESULT_COLOR[row.result],
                                  fontWeight: 600,
                                }}
                              >
                                {row.resultLabel}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </React.Fragment>
                ))}

                {/* Verification */}
                <h2 style={{ margin: "0 0 8px", fontSize: "13pt", fontWeight: 800, color: "#0A2540", letterSpacing: "-.01em" }}>
                  Verification
                </h2>
                <p style={{ margin: "0 0 10px", fontSize: "10pt", lineHeight: 1.6, color: "#475569", maxWidth: "74ch" }}>
                  {record.verification.intro}
                </p>
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "24px", fontSize: "10pt" }}>
                  <tbody>
                    {record.verification.rows.map((row, i) => (
                      <tr key={row.label}>
                        <td
                          style={{
                            padding: "7px 0",
                            borderBottom: i === record.verification.rows.length - 1 ? undefined : "1px solid #e7ebf0",
                            color: "#64748b",
                            width: "40%",
                          }}
                        >
                          {row.label}
                        </td>
                        <td
                          style={{
                            padding: "7px 0",
                            borderBottom: i === record.verification.rows.length - 1 ? undefined : "1px solid #e7ebf0",
                            color: "#0A2540",
                            fontWeight: 600,
                          }}
                        >
                          {row.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* What was not done */}
                <h2 style={{ margin: "0 0 8px", fontSize: "13pt", fontWeight: 800, color: "#0A2540", letterSpacing: "-.01em" }}>
                  What was not done
                </h2>
                <p style={{ margin: "0 0 22px", fontSize: "10pt", lineHeight: 1.6, color: "#475569", maxWidth: "74ch" }}>
                  {record.whatWasNotDone}
                </p>

                {/* Appendix */}
                <h2 style={{ margin: "0 0 8px", fontSize: "13pt", fontWeight: 800, color: "#0A2540", letterSpacing: "-.01em" }}>
                  {record.appendix.heading}
                </h2>
                <p style={{ margin: "0 0 10px", fontSize: "10pt", lineHeight: 1.6, color: "#475569", maxWidth: "74ch" }}>
                  {record.appendix.intro}
                </p>
                <div
                  style={{
                    columns: 2,
                    columnGap: "28px",
                    fontSize: "9.5pt",
                    color: "#0A2540",
                    lineHeight: 1.8,
                    marginBottom: "8px",
                    breakInside: "avoid",
                  }}
                >
                  {record.appendix.accounts.map((account, i) => (
                    <div key={account} data-testid={i === 0 ? "cr-appendix-account" : undefined}>
                      {account}
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td style={{ padding: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: "16px",
                    paddingTop: "8px",
                    borderTop: "1px solid #d7dee7",
                    marginTop: "16px",
                  }}
                >
                  <span style={{ fontSize: "8pt", color: "#64748b" }}>
                    Generated {record.generatedAtUtc} from the execution log. Values read from Microsoft Graph.
                  </span>
                  <span style={{ fontSize: "8pt", color: "#64748b" }}>Retain for audit</span>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
