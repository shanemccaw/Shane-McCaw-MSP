import { CreditCard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatCardDate, type SubscriptionCardData } from "./types";
import { statusBadgeVariant, formatStatusLabel } from "./card-status";

export function SubscriptionCard({ data }: { data: SubscriptionCardData }) {
  return (
    <Card className="max-w-md" data-testid="active-card-subscription">
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <CreditCard className="size-4 text-primary" />
        <CardTitle>Subscriptions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.subscriptions.map((sub, i) => (
          <div key={`${sub.name}-${i}`}>
            {i > 0 && <Separator className="mb-3" />}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{sub.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {sub.trialExpiresAt
                    ? `Trial ends ${formatCardDate(sub.trialExpiresAt)}`
                    : sub.activatedAt
                      ? `Active since ${formatCardDate(sub.activatedAt)}`
                      : "Not yet activated"}
                </p>
              </div>
              <Badge variant={statusBadgeVariant(sub.status)}>{formatStatusLabel(sub.status)}</Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
