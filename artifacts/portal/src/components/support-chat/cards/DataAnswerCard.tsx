import { Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatCardDate, type DataAnswerCardData } from "./types";
import { statusBadgeVariant, formatStatusLabel } from "./card-status";

/**
 * `data-answer` is the fallback of last resort (contract pack §4.4) — a
 * composite snapshot the model reaches for only when none of the three
 * specific cards fit. Unlike the other three, this key is ALWAYS built
 * server-side (never `undefined`), so its interior arrays can legitimately
 * all be empty — that is a real, honest "nothing here yet" state, not a
 * fetch failure.
 */
export function DataAnswerCard({ data }: { data: DataAnswerCardData }) {
  const hasAnything =
    data.subscriptions.length > 0 || data.purchases.length > 0 || data.latestScan !== null;

  return (
    <Card className="max-w-md" data-testid="active-card-data-answer">
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <Database className="size-4 text-primary" />
        <CardTitle>Account Snapshot</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasAnything && (
          <p className="text-sm text-muted-foreground">Nothing on file yet for this account.</p>
        )}

        {data.subscriptions.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Subscriptions
            </p>
            <div className="space-y-2">
              {data.subscriptions.map((sub, i) => (
                <div key={`${sub.name}-${i}`} className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm text-foreground">{sub.name}</span>
                  <Badge variant={statusBadgeVariant(sub.status)}>{formatStatusLabel(sub.status)}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.latestScan && (
          <>
            {data.subscriptions.length > 0 && <Separator />}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Latest Scan
              </p>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{data.latestScan.packageKey}</p>
                  <p className="text-xs text-muted-foreground">
                    Started {formatCardDate(data.latestScan.startedAt)}
                  </p>
                </div>
                <Badge variant={statusBadgeVariant(data.latestScan.status)}>
                  {formatStatusLabel(data.latestScan.status)}
                </Badge>
              </div>
            </div>
          </>
        )}

        {data.purchases.length > 0 && (
          <>
            {(data.subscriptions.length > 0 || data.latestScan) && <Separator />}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Purchases
              </p>
              <div className="space-y-2">
                {data.purchases.map((p, i) => (
                  <div key={`${p.title}-${i}`} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{p.title}</p>
                      <p className="text-xs text-muted-foreground">{formatCardDate(p.date)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm font-medium text-foreground">{p.amount}</span>
                      <Badge variant={statusBadgeVariant(p.status)}>{formatStatusLabel(p.status)}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
