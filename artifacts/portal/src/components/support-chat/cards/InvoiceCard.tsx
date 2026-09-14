import { formatCardDate, type InvoiceCardData } from "./types";
import { CardShell, Eyebrow, CardRow, StatusPill } from "./CardChrome";

export function InvoiceCard({ data }: { data: InvoiceCardData }) {
  return (
    <CardShell testId="active-card-invoice">
      <Eyebrow>Invoices</Eyebrow>
      {data.invoices.map((inv, i) => (
        <CardRow key={inv.invoiceNumber || i}>
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="truncate text-[12.5px] leading-[1.4]" style={{ color: "#e2e8f0" }}>
              {inv.description || inv.invoiceNumber}
            </span>
            {inv.description && (
              <span
                className="truncate text-[10.5px]"
                style={{ color: "#64748b", fontFamily: "ui-monospace, Menlo, monospace" }}
              >
                {inv.invoiceNumber}
              </span>
            )}
            <span className="text-[10.5px]" style={{ color: "#64748b" }}>
              {inv.status === "paid" ? `Paid ${formatCardDate(inv.paidAt)}` : `Due ${formatCardDate(inv.dueDate)}`}
            </span>
          </div>
          <span className="shrink-0 whitespace-nowrap text-[12.5px] tabular-nums" style={{ color: "#e2e8f0" }}>
            {inv.amount} {inv.currency.toUpperCase()}
          </span>
          <StatusPill status={inv.status} />
        </CardRow>
      ))}
    </CardShell>
  );
}
