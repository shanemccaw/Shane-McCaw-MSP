import { formatCardDate, type DataAnswerCardData } from "./types";
import { formatStatusLabel } from "./card-status";
import { CardShell } from "./CardChrome";

interface Section {
  label: string;
  rows: Array<{ left: string; right: string }>;
}

/**
 * `data-answer` is the fallback of last resort (contract pack §4.4) — a
 * composite snapshot the model reaches for only when none of the three
 * specific cards fit. Unlike the other three, this key is ALWAYS built
 * server-side (never `undefined`), so its interior arrays can legitimately
 * all be empty — that is a real, honest "nothing here yet" state, not a
 * fetch failure.
 */
export function DataAnswerCard({ data }: { data: DataAnswerCardData }) {
  const sections: Section[] = [];
  if (data.subscriptions.length > 0) {
    sections.push({
      label: "Subscriptions",
      rows: data.subscriptions.map((s) => ({ left: s.name, right: formatStatusLabel(s.status) })),
    });
  }
  if (data.latestScan) {
    sections.push({
      label: "Latest Scan",
      rows: [{ left: data.latestScan.packageKey, right: formatStatusLabel(data.latestScan.status) }],
    });
  }
  if (data.purchases.length > 0) {
    sections.push({
      label: "Purchases",
      rows: data.purchases.map((p) => ({ left: p.title, right: p.amount })),
    });
  }

  return (
    <CardShell testId="active-card-data-answer">
      {sections.length === 0 && (
        <span className="text-[12.5px] leading-[1.55]" style={{ color: "#94a3b8" }}>
          Nothing on file yet for this account.
        </span>
      )}
      {sections.map((s, i) => (
        <div
          key={s.label}
          className="flex flex-col gap-[7px]"
          style={i > 0 ? { paddingTop: 11, borderTop: "1px solid rgba(255,255,255,.06)" } : undefined}
        >
          <span className="text-[10px] font-bold uppercase" style={{ letterSpacing: ".11em", color: "#475569" }}>
            {s.label}
          </span>
          {s.rows.map((r, j) => (
            <div key={`${r.left}-${j}`} className="flex items-center gap-[11px]">
              <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: "#cbd5e1" }}>
                {r.left}
              </span>
              <span className="shrink-0 whitespace-nowrap text-[11.5px]" style={{ color: "#64748b" }}>
                {r.right}
              </span>
            </div>
          ))}
        </div>
      ))}
    </CardShell>
  );
}
