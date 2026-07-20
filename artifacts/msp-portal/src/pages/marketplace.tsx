/**
 * Marketplace — authenticated, in-portal "browse and buy more".
 *
 * Shared across roles (Assessment + CustomerUser today). One page; RBAC controls
 * what is shown — the same shared-page pattern used for Sharing, Account Basics,
 * and GDPR self-service elsewhere in this portal.
 *
 * Two surfaces:
 *   1. Recommended for your tenant (CustomerUser only) — real, personalised Sales
 *      Offer Engine offers (GET /api/portal/offers). That endpoint is floored at
 *      CustomerUser, so Assessment-tier customers do not see this section. "Review
 *      & purchase" deep-links to the canonical /customer-offers flow, which already
 *      owns the real offer checkout (portal-checkout.ts) — we do not duplicate it.
 *   2. Browse the catalog (both roles) — real category browsing + pricing from
 *      GET /api/portal/marketplace/catalog, role-scoped server-side.
 *
 * Purchase note (Deliverable 3): the two authenticated checkout endpoints are
 * object-bound — portal-checkout.ts takes an existing *sent offer* id, and
 * portal-assessment.ts derives everything from the caller's active *consolidated
 * SOW*. Neither accepts an arbitrary catalog service id, and the only
 * service-id → Stripe path is the *unauthenticated guest* onboarding flow. So an
 * arbitrary browse item cannot be self-serve-purchased through a correct
 * authenticated endpoint today. Rather than fabricate a checkout or repurpose the
 * guest flow, browse items route to the real "talk to your provider" surfaces.
 * The wired purchase path is Recommended offers → /customer-offers.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowRight,
  CheckCircle2,
  Gift,
  Info,
  Loader2,
  MessageCircle,
  ShoppingBag,
  Sparkles,
  Store,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────────

interface MarketplaceService {
  id: number;
  slug: string | null;
  name: string;
  tagline: string | null;
  description: string | null;
  category: string | null;
  serviceType: string | null;
  priceCents: number | null;
  perSeat: boolean;
  billingType: "one_time" | "recurring_monthly";
  deliverables: string[];
  badge: string | null;
  highlighted: boolean;
}

interface RecommendedOffer {
  id: number;
  title: string;
  rationale: string | null;
  adjustedPriceCents: number;
  state: string;
  expiresAt: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

function formatPrice(svc: MarketplaceService): string {
  if (svc.priceCents === null) return "On consultation";
  const dollars = (svc.priceCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  });
  if (svc.perSeat) return `${dollars}/user/mo`;
  if (svc.billingType === "recurring_monthly") return `${dollars}/mo`;
  return dollars;
}

function formatCents(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

// ── Recommended offer card ───────────────────────────────────────────────────────

function RecommendedCard({ offer, onReview }: { offer: RecommendedOffer; onReview: () => void }) {
  const isFree = offer.adjustedPriceCents === 0;
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2">
              <Sparkles className="size-3.5 text-primary shrink-0" />
              <CardTitle className="text-base leading-snug">{offer.title}</CardTitle>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-lg font-bold text-primary">{formatCents(offer.adjustedPriceCents)}</p>
            {isFree ? (
              <Badge variant="secondary" className="text-xs mt-0.5">Included</Badge>
            ) : (
              <p className="text-xs text-muted-foreground">recommended</p>
            )}
          </div>
        </div>
      </CardHeader>
      {offer.rationale && (
        <CardContent className="pt-0 pb-3">
          <CardDescription className="text-sm leading-relaxed">{offer.rationale}</CardDescription>
        </CardContent>
      )}
      <CardContent className="pt-0 pb-4">
        <Button size="sm" className="gap-1.5" onClick={onReview}>
          Review &amp; purchase <ArrowRight className="size-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Catalog service card ─────────────────────────────────────────────────────────

function CatalogCard({ svc, onInterest }: { svc: MarketplaceService; onInterest: (svc: MarketplaceService) => void }) {
  return (
    <Card className="border-border hover:border-primary/50 transition-colors flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base leading-snug">{svc.name}</CardTitle>
            {(svc.tagline || svc.description) && (
              <CardDescription className="mt-1 line-clamp-2">
                {svc.tagline ?? svc.description}
              </CardDescription>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-base font-bold text-primary whitespace-nowrap">{formatPrice(svc)}</div>
            {svc.badge && (
              <Badge variant="outline" className="text-[10px] mt-1">{svc.badge}</Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 pb-3 flex-1">
        {svc.deliverables.length > 0 && (
          <ul className="space-y-1.5 mt-1">
            {svc.deliverables.slice(0, 4).map((d, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-primary shrink-0 mt-0.5" />
                <span className="line-clamp-1">{d}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <CardContent className="pt-0 pb-4">
        <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => onInterest(svc)}>
          <ShoppingBag className="size-3.5" /> I'm interested
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const { user, fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const mspRole = user?.mspRole;
  const isAssessment = mspRole === "Assessment";

  const [services, setServices] = useState<MarketplaceService[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);

  const [offers, setOffers] = useState<RecommendedOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(!isAssessment);

  const [interest, setInterest] = useState<MarketplaceService | null>(null);

  // Catalog — both roles (server scopes by role).
  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(false);
    try {
      const res = await fetchWithAuth("/api/portal/marketplace/catalog");
      if (!res.ok) throw new Error("catalog");
      const data = (await res.json()) as { services: MarketplaceService[] };
      setServices(data.services ?? []);
    } catch {
      setCatalogError(true);
    } finally {
      setCatalogLoading(false);
    }
  }, [fetchWithAuth]);

  // Recommended offers — CustomerUser+ only. /api/portal/offers is floored at
  // CustomerUser, so we never call it for Assessment-tier (it would 403).
  const loadOffers = useCallback(async () => {
    if (isAssessment) return;
    setOffersLoading(true);
    try {
      const res = await fetchWithAuth("/api/portal/offers", undefined, { silent: true });
      if (!res.ok) {
        setOffers([]);
        return;
      }
      const data = (await res.json()) as { offers: RecommendedOffer[] };
      setOffers((data.offers ?? []).filter((o) => o.state === "sent"));
    } catch {
      setOffers([]);
    } finally {
      setOffersLoading(false);
    }
  }, [fetchWithAuth, isAssessment]);

  useEffect(() => {
    void loadCatalog();
    void loadOffers();
  }, [loadCatalog, loadOffers]);

  // Group catalog by category for browsing.
  const grouped = useMemo(() => {
    const map = new Map<string, MarketplaceService[]>();
    for (const svc of services) {
      const key = svc.category ?? "Other services";
      const list = map.get(key) ?? [];
      list.push(svc);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [services]);

  return (
    <AppShell title="Marketplace">
      <div className="p-6 space-y-8 max-w-5xl mx-auto">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2">
            <Store className="size-5 text-primary" />
            <h2 className="text-2xl font-bold tracking-tight">Marketplace</h2>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            {isAssessment
              ? "Explore assessments, governance and security packages, and monitoring for your Microsoft 365 environment."
              : "Browse services and add-ons, and review recommendations tailored to your tenant."}
          </p>
        </div>

        {/* Recommended for your tenant — CustomerUser+ only */}
        {!isAssessment && (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Recommended for your tenant
              </h3>
            </div>

            {offersLoading ? (
              <Skeleton className="h-40 w-full rounded-xl" />
            ) : offers.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                  <Gift className="size-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No personalised recommendations right now</p>
                  <p className="text-xs text-muted-foreground/60 max-w-sm">
                    Recommendations are generated from your Microsoft 365 environment. We'll surface them
                    here — and in your notifications — as soon as they're ready.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {offers.map((offer) => (
                  <RecommendedCard key={offer.id} offer={offer} onReview={() => navigate("/customer-offers")} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Browse the catalog */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <ShoppingBag className="size-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Browse the catalog
            </h3>
          </div>

          {catalogLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-52 w-full rounded-xl" />
              ))}
            </div>
          ) : catalogError ? (
            <Card>
              <CardContent className="py-10 text-center space-y-3">
                <p className="text-sm text-muted-foreground">Unable to load the catalog right now.</p>
                <Button variant="outline" size="sm" onClick={() => void loadCatalog()}>Try again</Button>
              </CardContent>
            </Card>
          ) : services.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No services are available for your account at this time.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-8">
              {grouped.map(([category, items]) => (
                <div key={category} className="space-y-3">
                  <h4 className="text-sm font-semibold text-foreground">{category}</h4>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((svc) => (
                      <CatalogCard key={svc.id} svc={svc} onInterest={setInterest} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Interest dialog — honest routing to the real purchase surfaces. */}
      <Dialog open={!!interest} onOpenChange={(v) => !v && setInterest(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <Info className="size-5 text-primary shrink-0" />
              <DialogTitle>Add {interest?.name}</DialogTitle>
            </div>
            <DialogDescription>
              Your provider sets up new services for your account. Choose how you'd like to move forward —
              we'll route you to the right place.
            </DialogDescription>
          </DialogHeader>

          <div className="py-1 text-sm text-muted-foreground">
            {isAssessment
              ? "To add this to your engagement, continue from your assessment or reach out to your provider."
              : "If this is one of your recommended offers, you can review and purchase it directly. Otherwise, start a conversation with your provider."}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {isAssessment ? (
              <Button className="w-full sm:w-auto gap-1.5" onClick={() => { setInterest(null); navigate("/assessment"); }}>
                Go to my assessment <ArrowRight className="size-4" />
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto gap-1.5"
                  onClick={() => { setInterest(null); navigate("/support"); }}
                >
                  <MessageCircle className="size-4" /> Contact provider
                </Button>
                <Button
                  className="w-full sm:w-auto gap-1.5"
                  onClick={() => { setInterest(null); navigate("/customer-offers"); }}
                >
                  View my offers <ArrowRight className="size-4" />
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
