/**
 * Public, no-login viewer for a "Send for review" / "Send to purchasing"
 * link (#4001, Feature #1663, carried forward from Git #1044/Epic #660).
 * Route: /shared-live-documents/:shareToken — no authentication.
 *
 * Wired to `GET /api/public/live-document-shares/:token` (contract pack §2).
 * Computed live on every request — no expiry, `revokedAt` (a manual action
 * by whoever shared it) is the only real control. `pillars`/`reports` are
 * always populated on a 200; a per-report narrative-generation failure
 * degrades that one report to `sections: []` rather than failing the whole
 * response (pack §6) — rendered here as "could not be generated this time",
 * not as a page-level error. `offers`/`addons` under `variant: "purchasing"`
 * can legitimately be empty if the sales-offer engine finds nothing to
 * recommend — a real empty state, not an error.
 */
import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Loader2 } from "lucide-react";
import { PublicShareShell } from "@/components/public-share/PublicShareShell";
import { fetchLiveDocumentShare, ShareFetchError } from "@/lib/public-share-api";
import type { LiveDocumentShareSet, LiveSharePillar } from "@/lib/public-share-types";

const GONE_COPY: Record<"revoked" | "not_found", { title: string; body: string; code: string }> = {
  revoked: {
    title: "This link has been revoked",
    body: "The person who shared this assessment withdrew the link. Live shares never expire on their own — withdrawal is the only way they stop working, and that is what happened here.",
    code: "410 · revoked",
  },
  not_found: {
    title: "This link doesn't exist or has been removed",
    body: "Nothing is shown for a link that cannot be found, and a link that was never issued looks exactly like one that has gone.",
    code: "404",
  },
};

function scoreBarColor(score: number | null): string {
  if (score == null) return "bg-muted-foreground/40";
  if (score >= 80) return "bg-status-green";
  if (score >= 60) return "bg-status-amber";
  return "bg-status-red";
}

function PillarTile({ pillar }: { pillar: LiveSharePillar }) {
  const width = pillar.score != null ? `${Math.max(0, Math.min(100, pillar.score))}%` : "0%";
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-white/[.07] bg-white/[.015] px-3.5 py-2.5">
      <span className="text-[9px] font-bold tracking-widest text-muted-foreground/70 uppercase">
        {pillar.pillar}
      </span>
      <span className="text-[22px] font-bold tracking-tight tabular-nums text-foreground">
        {pillar.score ?? "—"}
      </span>
      <div className="h-1 overflow-hidden rounded-full bg-white/[.06]">
        <div className={`h-full ${scoreBarColor(pillar.score)}`} style={{ width }} />
      </div>
    </div>
  );
}

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function SharedLiveDocumentsPublicPage() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [data, setData] = useState<LiveDocumentShareSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState<"revoked" | "not_found" | null>(null);

  useEffect(() => {
    if (!shareToken) {
      setGone("not_found");
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchLiveDocumentShare(shareToken)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setGone(e instanceof ShareFetchError && e.kind === "revoked" ? "revoked" : "not_found");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  if (loading) {
    return (
      <PublicShareShell topLine="Shared assessment · no sign-in needed · live">
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </PublicShareShell>
    );
  }

  if (gone || !data) {
    const copy = GONE_COPY[gone ?? "not_found"];
    return (
      <PublicShareShell topLine="Shared link">
        <div className="flex w-[620px] max-w-full flex-col gap-2 rounded-2xl border border-white/[.09] bg-white/[.02] p-6">
          <span className="text-lg font-bold tracking-tight text-foreground">{copy.title}</span>
          <span className="text-[12.5px] leading-relaxed text-muted-foreground">{copy.body}</span>
          <span className="pt-1 font-mono text-[11px] text-muted-foreground/70">{copy.code}</span>
        </div>
      </PublicShareShell>
    );
  }

  const isPurchasing = data.variant === "purchasing";

  return (
    <PublicShareShell topLine="Shared assessment · no sign-in needed · live">
      <div className="flex w-[840px] max-w-full flex-col gap-3.5">
        <div className="flex flex-col gap-3 rounded-2xl border border-white/[.09] bg-white/[.02] p-5.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
              <span className="text-[11px] font-semibold tracking-widest text-status-blue uppercase">
                {isPurchasing ? "For purchasing approval" : "For review"}
              </span>
              <span className="text-xl font-bold tracking-tight text-foreground">
                {data.companyName ?? "This tenant"} — Microsoft 365 assessment
              </span>
              <span className="text-[11px] leading-relaxed text-muted-foreground/70">
                Generated live from the tenant's latest scan each time this page opens. It does not
                expire; the person who shared it can withdraw it at any time.
              </span>
            </div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5 border-t border-white/[.07] pt-3">
            {data.pillars.map((p) => (
              <PillarTile key={p.pillar} pillar={p} />
            ))}
          </div>
        </div>

        <div className="flex flex-col rounded-2xl border border-white/[.09] bg-white/[.02] px-5.5 pb-3.5">
          <div className="flex flex-wrap items-center gap-3 py-3.5">
            <span className="text-[13.5px] font-semibold text-foreground">Seven reports</span>
            <span className="text-[11px] text-muted-foreground/70">
              narratives written from the same scan · one may be temporarily unavailable
            </span>
          </div>
          {data.reports.map((r) => {
            const empty = r.sections.length === 0;
            const lead = r.sections.find((s) => s.html)?.heading ?? r.sections[0]?.heading;
            return (
              <div key={r.docType} className="flex flex-col gap-1.5 border-t border-white/[.06] py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-foreground/90">{r.title}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/70">{r.docType}</span>
                  {empty && (
                    <span className="rounded-full border border-status-amber/30 bg-status-amber/10 px-2 py-0.5 text-[10px] font-semibold text-status-amber">
                      Could not be generated this time
                    </span>
                  )}
                </div>
                {!empty && (
                  <>
                    {lead && (
                      <span className="max-w-[720px] text-xs leading-relaxed text-muted-foreground">{lead}</span>
                    )}
                    <span className="text-[10.5px] text-muted-foreground/60">{r.sections.length} sections</span>
                  </>
                )}
                {empty && (
                  <span className="text-[11.5px] leading-relaxed text-muted-foreground/70">
                    This one report failed to generate on this load; the other six are unaffected.
                    Reload in a few minutes.
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {isPurchasing && (
          <div className="flex flex-col rounded-2xl border border-status-blue/30 bg-status-blue/[.04] px-5.5 pb-4">
            <div className="flex flex-wrap items-center gap-3 py-3.5">
              <span className="text-[13.5px] font-semibold text-foreground">Recommended engagement</span>
              <span className="text-[11px] text-muted-foreground/70">
                for the approver — the same recommendations the customer sees, priced live
              </span>
            </div>
            {(data.offers?.offers ?? []).length === 0 ? (
              <p className="border-t border-white/[.06] py-3 text-xs text-muted-foreground">
                No priced recommendations are available for this tenant right now.
              </p>
            ) : (
              data.offers?.offers.map((o) => (
                <div key={o.serviceId} className="flex items-start gap-3 border-t border-white/[.06] py-2.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[12.5px] font-semibold text-foreground/90">{o.title}</span>
                    <span className="text-[11.5px] leading-relaxed text-muted-foreground">{o.rationale}</span>
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                    {formatUsd(o.priceCents)}
                  </span>
                </div>
              ))
            )}
            {(data.offers?.addons ?? []).length > 0 && (
              <div className="flex flex-wrap gap-2.5 border-t border-white/[.06] pt-2.5">
                {data.offers?.addons.map((a, i) => (
                  <span
                    key={a.id ?? i}
                    className="rounded-full border border-white/[.12] px-2.5 py-1 text-[11px] text-foreground/90"
                  >
                    {a.title ?? "Add-on"}
                  </span>
                ))}
              </div>
            )}
            <span className="pt-2.5 text-[10.5px] leading-relaxed text-muted-foreground/60">
              Nothing can be bought from this page. It is a read-only copy for whoever approves the
              spend; the customer accepts inside their own portal.
            </span>
          </div>
        )}
      </div>
    </PublicShareShell>
  );
}
