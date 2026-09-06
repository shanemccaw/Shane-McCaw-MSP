import { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { comingSoonHref } from "@/components/shell/moduleNav";
import { PolicyDecisionsCard } from "@/components/risk-register/PolicyDecisionsCard";
import { RiskHeatMap } from "@/components/risk-register/RiskHeatMap";
import { RiskRow } from "@/components/risk-register/RiskRow";
import { useRiskRegister } from "@/lib/risk-register-api";
import { formatLiability, riskStatusSwatch } from "@/lib/risk-register-visuals";
import { cn } from "@/lib/utils";

const RISK_STATUS_ORDER = ["Open", "Mitigating", "Accepted", "Closed", "Expired"] as const;

const CLOCKS = [
  {
    tag: "RISK",
    note: "The risk's own state. It can be mitigating with nothing signed, or open again after a revoked signature.",
    className: "text-status-blue border-status-blue/30 bg-status-blue/10",
  },
  {
    tag: "ACCEPTANCE",
    note: "Your signature. Awaiting yours, signed, or revoked — and never expired, because a signature does not lapse.",
    className: "text-status-green border-status-green/30 bg-status-green/10",
  },
  {
    tag: "REVIEW",
    note: "The review clock. Falling overdue raises a flag; it never invalidates a signature or closes a risk.",
    className: "text-status-amber border-status-amber/30 bg-status-amber/10",
  },
];

const LEDGER: { gap: string; where: string; link?: { label: string; href: string } }[] = [
  {
    gap: "No second signature, on a line or on a document. Acceptance is written once and cannot be replaced, re-signed or amended.",
    where: "§9.3",
  },
  {
    gap: "No renewal on your behalf. Your MSP has no path to re-accept or extend anything you signed, by design.",
    where: "§9.6",
  },
  {
    gap: "No name check. The name you type is recorded as typed and is never matched against your account.",
    where: "§9.5",
  },
  {
    gap: "No document produced on request, and the document viewer / drawn-signature flow are not wired into this portal yet — the endpoints behind them are live. Your MSP prepares the render so it always has a real author.",
    where: "§9.9",
  },
  {
    gap: "No authority check on cross-cutting risks. Cost, governance and licence checks resolve to no workload owner, so anyone signed in here may sign them.",
    where: "§9.8",
  },
  {
    gap: "No line items. A risk covering many accounts is one line here; the individual objects are tracked by your MSP and not served to this page.",
    where: "§6.2",
  },
  {
    gap: "No structured owner as an editable field. The owner shown is display text; the person who may sign is resolved through the workload instead.",
    where: "§4",
  },
  {
    gap: 'No fabricated values. Anything unrecorded reads "Not recorded" rather than a zero, a dash or a guessed default.',
    where: "§8",
  },
  {
    gap: "No difference between an empty register and a tenant we cannot identify — both answer with an empty list.",
    where: "§8",
  },
  {
    gap: "No provenance for a risk raised by a declined remediation step. The pointer exists in the database but is not served, so such a risk looks authored from scratch.",
    where: "§7.3",
  },
  {
    gap: 'Two separate registers use the name "policy decisions". This page shows only the risk-derived ones.',
    where: "§0.1",
    link: { label: "Open the standing Policy Decisions register", href: comingSoonHref("Policy Decisions", "module") },
  },
  {
    gap: "Whether a risk's own Expired state should still be a product concept is unsettled — if your MSP has used it, it renders like any other status here rather than being hidden.",
    where: "§2",
  },
];

export default function RiskRegisterPage() {
  const { data: risks, isLoading, isError, refetch, isRefetching } = useRiskRegister();
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [ledgerOpen, setLedgerOpen] = useState(true);

  const toggleRow = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openFromDecision = (rbdId: string) => {
    setOpenIds((prev) => new Set(prev).add(rbdId));
    requestAnimationFrame(() => {
      document.getElementById(`risk-row-${rbdId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const statusChips = useMemo(() => {
    if (!risks) return [];
    const counts = new Map<string, number>();
    for (const r of risks) {
      const key = r.status ?? "Not recorded";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return RISK_STATUS_ORDER.filter((k) => counts.has(k)).map((k) => ({ key: k, n: counts.get(k)! }));
  }, [risks]);

  const { acceptedTotal, openTotal } = useMemo(() => {
    if (!risks) return { acceptedTotal: 0, openTotal: 0 };
    let acceptedTotal = 0;
    let openTotal = 0;
    for (const r of risks) {
      const accStatus = r.accepted?.status;
      if (accStatus === "active") acceptedTotal += r.liabilityValueUsd;
      else openTotal += r.liabilityValueUsd;
    }
    return { acceptedTotal, openTotal };
  }, [risks]);

  const isEmpty = !isLoading && !isError && (risks?.length ?? 0) === 0;
  const hasRows = !isLoading && !isError && (risks?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4 pb-14">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Risk register</h1>
        <span
          title="Risks your MSP has recorded against your tenant, and the ones you have signed to accept. Signing transfers the named exposure to you."
          className="flex size-[17px] cursor-help items-center justify-center rounded-full border border-muted-foreground/35 text-[10px] font-bold text-muted-foreground"
        >
          i
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", isError ? "bg-status-red" : isLoading ? "bg-muted-foreground" : "bg-status-green")} />
          {isLoading
            ? "Reading your register"
            : isError
              ? "Could not read your register"
              : isEmpty
                ? "Live — 0 risks recorded"
                : `Live — ${risks?.length ?? 0} risks`}
        </span>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex animate-pulse flex-col gap-2 rounded-xl border border-border/60 bg-muted/10 p-4">
              <div className="h-2.5 w-2/5 rounded-full bg-muted-foreground/20" />
              <div className="h-2 w-1/2 rounded-full bg-muted-foreground/10" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="flex gap-2.5 rounded-xl border border-dashed border-status-red/45 bg-status-red/[.06] p-4">
          <AlertTriangle className="mt-0.5 size-4 flex-none text-status-red" />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-foreground">Your register could not be read</span>
            <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">
              This is a failed read, not an empty register. Risks may well stand against your
              tenant right now, and a signature you have already given is unaffected.
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto w-fit p-0 text-[11.5px]"
              onClick={() => void refetch()}
              disabled={isRefetching}
            >
              {isRefetching && <Loader2 className="size-3 animate-spin" />}
              Try again
            </Button>
          </div>
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
          <span className="text-[13.5px] font-semibold text-foreground">No risks recorded</span>
          <span className="max-w-[560px] text-xs leading-relaxed text-muted-foreground">
            Your MSP has raised nothing against your tenant, and you have signed nothing. Your MSP
            records risks here; there is no self-service way to add one.
          </span>
          <span className="max-w-[560px] text-[11.5px] leading-relaxed text-status-amber">
            One caveat we would rather state than hide: this is also the answer given when your
            tenant cannot be identified. An empty register and an unreadable tenant look identical
            from here.
          </span>
        </div>
      )}

      {hasRows && risks && (
        <>
          <div className="flex flex-wrap gap-3">
            <Card className="flex-1 min-w-[280px]">
              <CardContent className="flex flex-col gap-2.5 pt-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold tracking-tight tabular-nums text-foreground">{risks.length}</span>
                  <span className="text-xs text-muted-foreground">risks on your register</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {statusChips.map(({ key, n }) => {
                    const swatch = riskStatusSwatch(key);
                    return (
                      <Badge key={key} variant="outline" className={cn(swatch.text, swatch.bg, swatch.border)}>
                        {swatch.label} {n}
                      </Badge>
                    );
                  })}
                </div>
                <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                  {formatLiability(acceptedTotal)} of named exposure sits with you under a
                  signature · {formatLiability(openTotal)} is still open
                </span>
              </CardContent>
            </Card>
            <Card className="flex-1 min-w-[280px]">
              <CardContent className="flex flex-col gap-2.5 pt-6">
                <span className="text-[12.5px] font-semibold text-foreground">Three clocks, kept apart</span>
                {CLOCKS.map((c) => (
                  <div key={c.tag} className="flex items-start gap-2.5">
                    <Badge variant="outline" className={cn("w-[82px] flex-none justify-center text-[9px] tracking-wider", c.className)}>
                      {c.tag}
                    </Badge>
                    <span className="text-[11.5px] leading-relaxed text-muted-foreground">{c.note}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <RiskHeatMap risks={risks} />

          <Card>
            <div className="flex items-center gap-3 px-5 pb-2 pt-4">
              <span className="text-[13.5px] font-semibold text-foreground">Register</span>
              <span className="text-[11px] text-muted-foreground">newest first</span>
              <span className="ml-auto w-[84px] flex-none text-center text-[9px] font-bold tracking-wider text-muted-foreground">
                RISK
              </span>
              <span className="w-[92px] flex-none text-center text-[9px] font-bold tracking-wider text-muted-foreground">
                ACCEPT
              </span>
              <span className="w-[74px] flex-none text-center text-[9px] font-bold tracking-wider text-muted-foreground">
                REVIEW
              </span>
              <span className="w-16 flex-none text-right text-[9px] font-bold tracking-wider text-muted-foreground">
                EXPOSURE
              </span>
              <span className="w-3.5 flex-none" />
            </div>
            <CardContent className="flex flex-col px-5 pb-3 pt-0">
              {risks.map((r) => (
                <RiskRow key={r.id} risk={r} open={openIds.has(r.id)} onToggle={() => toggleRow(r.id)} />
              ))}
            </CardContent>
          </Card>

          <PolicyDecisionsCard onSelect={openFromDecision} />
        </>
      )}

      <Card className="bg-muted/5">
        <CardContent className="flex flex-col gap-2.5 pt-6">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[13px] font-semibold text-foreground">What this page deliberately does not do</span>
            <Button
              variant="link"
              size="sm"
              className="ml-auto h-auto p-0 text-[11.5px] font-semibold text-muted-foreground"
              onClick={() => setLedgerOpen((o) => !o)}
            >
              {ledgerOpen ? "Collapse" : "Expand"}
            </Button>
          </div>
          {ledgerOpen && (
            <>
              <div className="flex flex-col">
                {LEDGER.map((l, i) => (
                  <div key={i} className="flex items-start gap-3 border-t border-border/50 py-2 first:border-t-0">
                    <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-foreground">
                      {l.gap}
                      {l.link && (
                        <>
                          {" "}
                          <Link href={l.link.href} className="font-semibold text-primary hover:underline">
                            {l.link.label}
                          </Link>
                        </>
                      )}
                    </div>
                    <span className="flex-none font-mono text-[10.5px] text-muted-foreground/70">{l.where}</span>
                  </div>
                ))}
              </div>
              <span className="pt-1 text-[10.5px] leading-relaxed text-muted-foreground/70">
                The last two are open questions rather than settled positions, and are shown here
                so nobody has to discover them from a blank field.
              </span>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
