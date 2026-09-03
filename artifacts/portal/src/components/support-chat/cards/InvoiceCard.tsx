import { Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatCardDate, type InvoiceCardData } from "./types";
import { statusBadgeVariant, formatStatusLabel } from "./card-status";

export function InvoiceCard({ data }: { data: InvoiceCardData }) {
  return (
    <Card className="max-w-md" data-testid="active-card-invoice">
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <Receipt className="size-4 text-primary" />
        <CardTitle>Invoices</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.invoices.map((inv, i) => (
          <div key={inv.invoiceNumber || i}>
            {i > 0 && <Separator className="mb-3" />}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{inv.invoiceNumber}</p>
                {inv.description && (
                  <p className="truncate text-xs text-muted-foreground">{inv.description}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {inv.status === "paid"
                    ? `Paid ${formatCardDate(inv.paidAt)}`
                    : `Due ${formatCardDate(inv.dueDate)}`}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-sm font-semibold text-foreground">
                  {inv.amount} {inv.currency.toUpperCase()}
                </span>
                <Badge variant={statusBadgeVariant(inv.status)}>{formatStatusLabel(inv.status)}</Badge>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
