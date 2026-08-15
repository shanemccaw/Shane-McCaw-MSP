/**
 * shared-live-documents-public.tsx — Git #1044 (Epic #660, Phase 2).
 *
 * Public, no-login viewer for a "Send for review" / "Send to purchasing"
 * link minted from `DocumentExportMenu.tsx`. Route:
 * `/shared-live-documents/:shareToken`.
 *
 * A FLAT top-level route, deliberately NOT under `/:slug/*` — that inner
 * router (`SlugScope` in App.tsx) is the branded, authenticated tenant
 * entry, and routing a public link through it would gate this page behind
 * login, defeating the whole point. Mirrors the two existing public
 * share-token routes' own placement (`/shared-documents/:shareToken`,
 * `/sow/:shareToken`).
 *
 * Deliberately its OWN read-only rendering, not a reuse of `DocumentBody`'s
 * interactive component tree (which threads `onSigned`/`onOpenSow`/edit
 * state meant for the logged-in customer) — a public review/purchasing link
 * has no sign/edit actions at all, so mounting that tree would be more risk
 * for a capability this page must never offer. What IS reused, per this
 * issue's own text, is the SOW's real pricing: `journeyScopeFromOffers()`
 * (`sowLiveScope.ts`, already shipped, the same mapper
 * `LiveStatementOfWorkBody` uses) turns the server's offers payload into
 * priced phases/totals here exactly the way it does there — no pricing math
 * is re-derived on this page.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import { Loader2, ShieldAlert } from "lucide-react";

import { journeyScopeFromOffers, type WireRecommendedOffers } from "@/components/copilot-journey/sowLiveScope";

// Same cross-file docType duplication convention journeyTokens.ts's
// JOURNEY_LIVE_DOCUMENTS registry already documents — this page is not the
// authenticated journey, so it keeps its own copy of just the labels it
// needs rather than importing the whole registry.
const DOC_TYPE_TO_WAR_ROOM_PILLAR: Record<string, string> = {
  copilot_readiness: "copilot",
  security_posture_report: "security",
  governance_maturity_report: "governance",
  compliance_alignment_report: "compliance",
  license_optimization_report: "licensing",
  adoption_report: "adoption",
  operational_health_report: "health",
};

interface SharedStat {
  readonly id: string;
  readonly label: string;
  readonly value: number | null;
  readonly unit?: string;
  readonly unavailableReason?: string;
}

interface SharedFinding {
  readonly severity: string;
  readonly checkKey: string;
  readonly title: string;
}

interface SharedPillar {
  readonly pillar: string;
  readonly score: number | null;
  readonly evaluation: string;
  readonly stats: readonly SharedStat[];
  readonly findings: readonly SharedFinding[];
  readonly findingCounts: { readonly critical: number; readonly warning: number };
}

interface SharedNarrativeSection {
  readonly key: string;
  readonly heading: string;
  readonly html: string | null;
}

interface SharedReport {
  readonly docType: string;
  readonly title: string;
  readonly sections: readonly SharedNarrativeSection[];
}

interface SharedLiveDocumentSet {
  readonly variant: "review" | "purchasing";
  readonly companyName: string | null;
  readonly pillars: readonly SharedPillar[];
  readonly reports: readonly SharedReport[];
  readonly offers?: WireRecommendedOffers;
}

function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function PurchasingScope({ offers }: { readonly offers: WireRecommendedOffers | undefined }) {
  const scope = useMemo(() => (offers ? journeyScopeFromOffers(offers) : null), [offers]);

  if (!scope || scope.phases.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No priced remediation scope is available for this tenant right now.
      </p>
    );
  }

  const phasesTotal = scope.phases.reduce((sum, p) => sum + p.priceUsd, 0);
  const total = phasesTotal + scope.adjustmentsUsd;

  return (
    <div className="space-y-3">
      {scope.phases.map((p) => (
        <div key={p.id} className="flex items-start justify-between gap-4 border-b border-border pb-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{p.title}</div>
            {p.scope ? <div className="text-xs text-muted-foreground mt-0.5">{p.scope}</div> : null}
            {p.weeksQuoted ? (
              <div className="text-[11px] text-muted-foreground mt-0.5">approx. {p.weeksQuoted} weeks</div>
            ) : null}
          </div>
          <div className="text-sm font-semibold shrink-0">{formatUsd(p.priceUsd)}</div>
        </div>
      ))}
      {scope.adjustments.map((a) => (
        <div key={a.id} className="flex items-start justify-between gap-4 text-sm text-muted-foreground">
          <div>{a.title}</div>
          <div className="shrink-0">{formatUsd(a.priceUsd)}</div>
        </div>
      ))}
      <div className="flex items-center justify-between pt-2">
        <div className="text-sm font-semibold">Total</div>
        <div className="text-base font-bold">{formatUsd(total)}</div>
      </div>
    </div>
  );
}

function ReportCard({ report, pillar }: { readonly report: SharedReport; readonly pillar: SharedPillar | undefined }) {
  return (
    <section className="border border-border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold">{report.title}</h2>
        {pillar?.score != null ? (
          <span className="text-sm font-bold shrink-0">{pillar.score}/100</span>
        ) : (
          <span className="text-xs text-muted-foreground shrink-0">Not yet scored</span>
        )}
      </div>

      {pillar && pillar.stats.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {pillar.stats.map((s) => (
            <div key={s.id} className="text-xs">
              <div className="text-muted-foreground">{s.label}</div>
              <div className="font-semibold">{s.value != null ? s.value : "—"}</div>
            </div>
          ))}
        </div>
      ) : null}

      {pillar && pillar.findings.length > 0 ? (
        <div className="space-y-1.5">
          {pillar.findings.map((f) => (
            <div key={f.checkKey} className="flex items-center gap-2 text-xs">
              <span className="uppercase tracking-wide font-semibold text-muted-foreground w-16 shrink-0">
                {f.severity}
              </span>
              <span>{f.title}</span>
            </div>
          ))}
        </div>
      ) : null}

      {report.sections.map((s) =>
        s.html ? (
          <div key={s.key}>
            <h3 className="text-sm font-semibold mb-1">{s.heading}</h3>
            {/* eslint-disable-next-line react/no-danger */}
            <div className="text-sm text-muted-foreground [&_p]:mb-2" dangerouslySetInnerHTML={{ __html: s.html }} />
          </div>
        ) : null,
      )}
    </section>
  );
}

export default function SharedLiveDocumentsPublicPage() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [data, setData] = useState<SharedLiveDocumentSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"not_found" | "revoked" | "unknown" | null>(null);

  useEffect(() => {
    if (!shareToken) {
      setError("not_found");
      setLoading(false);
      return;
    }
    fetch(`/api/public/live-document-shares/${encodeURIComponent(shareToken)}`)
      .then(async (res) => {
        if (res.status === 410) throw new Error("revoked");
        if (!res.ok) throw new Error("not_found");
        return (await res.json()) as SharedLiveDocumentSet;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error && e.message === "revoked" ? "revoked" : "not_found"))
      .finally(() => setLoading(false));
  }, [shareToken]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
        <ShieldAlert className="size-10 text-muted-foreground/40 mb-4" />
        <h1 className="text-lg font-semibold mb-1">{error === "revoked" ? "Link Revoked" : "Link Not Found"}</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          {error === "revoked"
            ? "This share link has been revoked. Ask your contact to send a new one."
            : "This link doesn't exist or has been removed."}
        </p>
      </div>
    );
  }

  const pillarByKey = new Map(data.pillars.map((p) => [p.pillar, p]));

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold">{data.companyName ?? "Copilot Readiness"} — Shared Documents</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data.variant === "purchasing"
              ? "Findings, scores, every report, and the statement of work."
              : "Findings, scores and every report. No pricing, no commercial terms."}
          </p>
        </div>
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground border border-border rounded-full px-2.5 py-1 shrink-0">
          Read only
        </span>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {data.variant === "purchasing" ? (
          <section className="border border-border rounded-lg p-5">
            <h2 className="text-base font-semibold mb-4">Statement of Work — Agreed Scope &amp; Totals</h2>
            <PurchasingScope offers={data.offers} />
          </section>
        ) : null}

        {data.reports.map((report) => (
          <ReportCard
            key={report.docType}
            report={report}
            pillar={pillarByKey.get(DOC_TYPE_TO_WAR_ROOM_PILLAR[report.docType] ?? "")}
          />
        ))}
      </div>
    </div>
  );
}
