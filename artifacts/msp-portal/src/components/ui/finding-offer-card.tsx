import type { ReactNode } from "react"
import { AlertTriangle, AlertCircle, CheckCircle2, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

export type FindingSeverity = "high" | "watch" | "good"

const SEVERITY_META: Record<FindingSeverity, { label: string; dot: string; icon: ReactNode }> = {
  high: {
    label: "High severity",
    dot: "bg-status-red",
    icon: <AlertTriangle className="size-3.5 text-status-red" />,
  },
  watch: {
    label: "Watch",
    dot: "bg-status-amber",
    icon: <AlertCircle className="size-3.5 text-status-amber" />,
  },
  good: {
    label: "Nominal",
    dot: "bg-status-green",
    icon: <CheckCircle2 className="size-3.5 text-status-green" />,
  },
}

export interface FindingCardProps {
  /** Severity — rendered as both a color dot AND a text label, never color alone */
  severity: FindingSeverity
  /** Short tag naming the engine/source that produced this finding, e.g. "Identity Engine" */
  engineSource: string
  title: string
  description: string
  /** Consequence / risk line — what happens if left unaddressed */
  consequence: string
  timestamp: string
  className?: string
}

/**
 * Finding card — reports a detected issue. No action button by design;
 * remediation is offered separately via OfferCard/InstantRemediationCard.
 */
export function FindingCard({ severity, engineSource, title, description, consequence, timestamp, className }: FindingCardProps) {
  const meta = SEVERITY_META[severity]
  return (
    <Card className={cn("p-4 flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", meta.dot)} aria-hidden="true" />
          <span className="text-xs font-medium text-foreground">{meta.label}</span>
        </div>
        <span className="text-xs font-medium text-muted-foreground rounded-[var(--radius-control)] border border-border px-2 py-0.5">
          {engineSource}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-secondary-foreground/90">{description}</p>
      </div>

      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
        {meta.icon}
        <span>{consequence}</span>
      </div>

      <span className="text-xs font-mono text-muted-foreground">{timestamp}</span>
    </Card>
  )
}

export interface OfferCardProps {
  title: string
  /** Rationale referencing the linked finding this offer resolves */
  rationale: string
  /** Pre-formatted price string (e.g. "$450") — no numeric literals baked in here per no-hardcoding rule; callers pass a value already resolved from the Products Catalog / API. */
  price: string
  actionLabel: string
  onAction: () => void
  className?: string
}

/** Offer card — a sales offer tied to a finding, with a single action button. */
export function OfferCard({ title, rationale, price, actionLabel, onAction, className }: OfferCardProps) {
  return (
    <Card className={cn("p-4 flex flex-col gap-3 border-l-2 border-l-status-blue", className)}>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-secondary-foreground/90">{rationale}</p>
      <div className="flex items-center justify-between gap-3 mt-1">
        <span className="text-lg font-semibold font-mono text-foreground">{price}</span>
        <Button size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </Card>
  )
}

export interface InstantRemediationCardProps {
  title: string
  /** Copy signaling live/automatic execution rather than a sales process */
  rationale: string
  actionLabel: string
  onAction: () => void
  className?: string
}

/**
 * Instant remediation card — same shape as OfferCard, distinct green accent
 * and copy for offers that execute live/automatically instead of routing
 * through a sales process. No price line: nothing to purchase.
 */
export function InstantRemediationCard({ title, rationale, actionLabel, onAction, className }: InstantRemediationCardProps) {
  return (
    <Card className={cn("p-4 flex flex-col gap-3 border-l-2 border-l-status-green", className)}>
      <div className="flex items-center gap-1.5">
        <Zap className="size-3.5 text-status-green" />
        <span className="text-xs font-medium text-status-green">Instant remediation</span>
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-secondary-foreground/90">{rationale}</p>
      <div className="flex justify-end mt-1">
        <Button size="sm" className="bg-status-green text-white border-transparent" onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </Card>
  )
}
