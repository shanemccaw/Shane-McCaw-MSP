import { formatCardDate, type SubscriptionCardData } from "./types";
import { CardShell, Eyebrow, CardRow, StatusPill } from "./CardChrome";

export function SubscriptionCard({ data }: { data: SubscriptionCardData }) {
  return (
    <CardShell testId="active-card-subscription">
      <Eyebrow>Subscriptions</Eyebrow>
      {data.subscriptions.map((sub, i) => (
        <CardRow key={`${sub.name}-${i}`}>
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="truncate text-[12.5px] leading-[1.4]" style={{ color: "#e2e8f0" }}>
              {sub.name}
            </span>
            <span className="text-[10.5px]" style={{ color: "#64748b" }}>
              {sub.trialExpiresAt
                ? `Trial ends ${formatCardDate(sub.trialExpiresAt)}`
                : sub.activatedAt
                  ? `Active since ${formatCardDate(sub.activatedAt)}`
                  : "Not yet activated"}
            </span>
          </div>
          <StatusPill status={sub.status} />
        </CardRow>
      ))}
    </CardShell>
  );
}
