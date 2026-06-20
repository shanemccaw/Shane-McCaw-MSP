import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Service {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  deliverables: string | null;
  durationDays: number | null;
}

interface WorkflowStep {
  id: number;
  title: string;
  status: string;
  description: string | null;
  completedAt: string | null;
  order: number;
}

interface ClientService {
  id: number;
  status: string;
  progress: number;
  startDate: string | null;
  nextMilestone: string | null;
  nextMilestoneDate: string | null;
  purchasedAt: string;
  service: Service;
  steps: WorkflowStep[];
}

interface DbService {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  category: string | null;
  deliverables: string | null;
  basePrice: string | null;
  turnaround: string | null;
  billingType: "one_time" | "recurring_monthly";
  badge: string | null;
  highlighted: boolean;
  hoursPerMonth: string | null;
  tagline: string | null;
  inclusions: string[] | null;
  features: string[] | null;
  orderWorkflow: Array<unknown> | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(basePrice: string | null): string {
  if (!basePrice) return "Contact us";
  const num = parseFloat(basePrice);
  if (isNaN(num)) return "Contact us";
  return "$" + num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const BOOKINGS_URL = import.meta.env.VITE_BOOKINGS_URL as string | undefined;

// ─── Purchased service card ───────────────────────────────────────────────────

const STEP_STATUS: Record<string, { color: string; icon: React.ReactNode }> = {
  completed: {
    color: "bg-green-500",
    icon: <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>,
  },
  in_progress: {
    color: "bg-[#0078D4]",
    icon: <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  },
  blocked: {
    color: "bg-red-500",
    icon: <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>,
  },
  pending: {
    color: "bg-gray-200",
    icon: <svg className="w-3 h-3 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /></svg>,
  },
};

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-[#F7F9FC] rounded-full h-2">
      <div className="h-2 rounded-full bg-[#0078D4] transition-all duration-500" style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

function PurchasedServiceCard({ cs }: { cs: ClientService }) {
  const [expanded, setExpanded] = useState(false);
  const completedSteps = cs.steps.filter(s => s.status === "completed").length;

  return (
    <div className="bg-white border border-border rounded-xl overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {cs.service.category && (
                <span className="text-xs bg-[#0078D4]/10 text-[#0078D4] font-semibold px-2.5 py-1 rounded-full">{cs.service.category}</span>
              )}
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${
                cs.status === "completed" ? "bg-green-100 text-green-700" :
                cs.status === "active" ? "bg-blue-100 text-blue-700" :
                "bg-yellow-100 text-yellow-700"
              }`}>{cs.status}</span>
            </div>
            <h3 className="text-base font-bold text-[#0A2540]">{cs.service.name}</h3>
            {cs.service.description && <p className="text-sm text-muted-foreground mt-1">{cs.service.description}</p>}
          </div>
          <a
            href={BOOKINGS_URL ?? "mailto:info@shanemccaw.com"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 bg-[#0078D4] text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Book Meeting
          </a>
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span>Progress</span>
            <span className="font-bold text-[#0078D4]">{cs.progress}%</span>
          </div>
          <ProgressBar value={cs.progress} />
          {cs.steps.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">{completedSteps} of {cs.steps.length} workflow steps complete</p>
          )}
        </div>

        {cs.nextMilestone && (
          <div className="bg-[#0078D4]/5 border border-[#0078D4]/20 rounded-lg px-4 py-3 mb-4">
            <p className="text-xs font-bold text-[#0078D4] uppercase tracking-wide mb-0.5">Next Milestone</p>
            <p className="text-sm text-[#0A2540] font-medium">{cs.nextMilestone}</p>
            {cs.nextMilestoneDate && (
              <p className="text-xs text-muted-foreground mt-0.5">Target: {new Date(cs.nextMilestoneDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
            )}
          </div>
        )}

        {cs.service.deliverables && (
          <div className="mb-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Deliverables</p>
            <div className="flex flex-wrap gap-2">
              {cs.service.deliverables.split(",").map((d, i) => (
                <span key={i} className="text-xs bg-[#F7F9FC] border border-border text-[#0A2540] px-2.5 py-1 rounded-full">{d.trim()}</span>
              ))}
            </div>
          </div>
        )}

        {cs.steps.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-sm font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors"
          >
            <svg className={`w-4 h-4 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            {expanded ? "Hide" : "Show"} workflow steps ({cs.steps.length})
          </button>
        )}
      </div>

      {expanded && cs.steps.length > 0 && (
        <div className="border-t border-border bg-[#F7F9FC] px-5 py-4 space-y-3">
          {cs.steps.map((s, idx) => {
            const config = STEP_STATUS[s.status] ?? STEP_STATUS.pending;
            return (
              <div key={s.id} className="flex items-start gap-3">
                <div className="flex flex-col items-center mt-0.5">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${config.color}`}>
                    {config.icon}
                  </div>
                  {idx < cs.steps.length - 1 && <div className="w-0.5 h-4 bg-border mt-0.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${s.status === "completed" ? "line-through text-muted-foreground" : "text-[#0A2540]"}`}>{s.title}</p>
                  {s.description && <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>}
                  {s.completedAt && <p className="text-xs text-green-600 mt-0.5">✓ {new Date(s.completedAt).toLocaleDateString()}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Micro-offer card ─────────────────────────────────────────────────────────

function MicroOfferCard({
  offer,
  onBuy,
  buying,
}: {
  offer: DbService;
  onBuy: (offer: DbService) => void;
  buying: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const inclusions = offer.inclusions ?? [];

  return (
    <div className="bg-white border border-border rounded-xl overflow-hidden flex flex-col hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              {offer.badge && (
                <span className="text-xs bg-[#0078D4] text-white font-bold px-2.5 py-0.5 rounded-full">{offer.badge}</span>
              )}
              {offer.turnaround && (
                <span className="text-xs bg-[#F7F9FC] border border-border text-muted-foreground font-medium px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {offer.turnaround}
                </span>
              )}
            </div>
            <h3 className="text-sm font-bold text-[#0A2540]">{offer.name}</h3>
          </div>
          <span className="text-xl font-extrabold text-[#0078D4] flex-shrink-0">{formatPrice(offer.basePrice)}</span>
        </div>

        {offer.description && (
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">{offer.description}</p>
        )}

        {offer.deliverables && (
          <div className="text-xs bg-[#F7F9FC] border border-border rounded-lg px-3 py-2 mb-3">
            <span className="font-bold text-[#0A2540]">Deliverable: </span>
            <span className="text-muted-foreground">{offer.deliverables}</span>
          </div>
        )}

        {inclusions.length > 0 && (
          <>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1.5 text-xs font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors mb-4"
            >
              <svg className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              {expanded ? "Hide" : "See"} what's included
            </button>

            {expanded && (
              <ul className="mb-4 space-y-1.5">
                {inclusions.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[#0A2540]">
                    <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="mt-auto">
          <button
            onClick={() => onBuy(offer)}
            disabled={buying}
            className="w-full bg-[#0078D4] hover:bg-[#0078D4]/90 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {buying ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Preparing checkout…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Purchase — {formatPrice(offer.basePrice)}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Retainer card ────────────────────────────────────────────────────────────

function RetainerCard({ plan }: { plan: DbService }) {
  const features = plan.features ?? [];
  const highlighted = plan.highlighted;

  return (
    <div className={`rounded-xl overflow-hidden flex flex-col border transition-all duration-200 ${
      highlighted
        ? "bg-[#0A2540] border-[#0078D4] shadow-xl shadow-[#0078D4]/10"
        : "bg-white border-border hover:shadow-md hover:-translate-y-0.5"
    }`}>
      <div className="p-5 flex-1 flex flex-col">
        {highlighted && (
          <div className="mb-3">
            <span className="text-xs bg-[#0078D4] text-white font-bold px-3 py-1 rounded-full">Most popular</span>
          </div>
        )}

        <div className="mb-3">
          {plan.hoursPerMonth && (
            <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${highlighted ? "text-[#00B4D8]" : "text-[#0078D4]"}`}>{plan.hoursPerMonth}</p>
          )}
          <h3 className={`text-base font-bold ${highlighted ? "text-white" : "text-[#0A2540]"}`}>{plan.name}</h3>
          <div className="flex items-baseline gap-1 mt-1">
            <span className={`text-2xl font-extrabold ${highlighted ? "text-white" : "text-[#0078D4]"}`}>{formatPrice(plan.basePrice)}</span>
            <span className={`text-sm ${highlighted ? "text-white/50" : "text-muted-foreground"}`}>/month</span>
          </div>
        </div>

        {plan.tagline && (
          <p className={`text-xs leading-relaxed mb-4 ${highlighted ? "text-white/70" : "text-muted-foreground"}`}>{plan.tagline}</p>
        )}

        {features.length > 0 && (
          <ul className="space-y-2 mb-5 flex-1">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <svg className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${highlighted ? "text-[#00B4D8]" : "text-green-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className={highlighted ? "text-white/80" : "text-[#0A2540]"}>{f}</span>
              </li>
            ))}
          </ul>
        )}

        <a
          href={BOOKINGS_URL ?? "mailto:info@shanemccaw.com?subject=Retainer Inquiry"}
          target="_blank"
          rel="noopener noreferrer"
          className={`w-full text-center text-sm font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 ${
            highlighted
              ? "bg-[#0078D4] hover:bg-[#0078D4]/90 text-white"
              : "border-2 border-[#0078D4] text-[#0078D4] hover:bg-[#0078D4] hover:text-white"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Schedule a Consultation
        </a>
      </div>
    </div>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function CatalogSpinner() {
  return (
    <div className="flex items-center justify-center py-10 bg-white border border-border rounded-xl">
      <div className="w-7 h-7 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type AlertState = { type: "success" | "error"; message: string } | null;

export default function PortalServices() {
  const { fetchWithAuth } = useAuth();
  const [location, setLocation] = useLocation();
  const [purchasedServices, setPurchasedServices] = useState<ClientService[]>([]);
  const [packages, setPackages] = useState<DbService[]>([]);
  const [retainers, setRetainers] = useState<DbService[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [alert, setAlert] = useState<AlertState>(null);
  const [buyingOffer, setBuyingOffer] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"packages" | "retainers">("packages");

  // Handle Stripe return
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("purchase") === "success") {
      const svc = params.get("service");
      setAlert({ type: "success", message: `Payment received for "${svc ?? "service"}"! Shane will activate your service within 1–2 business days.` });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("purchase") === "cancelled") {
      setAlert({ type: "error", message: "Checkout was cancelled. You can try again at any time." });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [location]);

  // Load purchased services
  useEffect(() => {
    fetchWithAuth("/api/portal/services")
      .then(r => r.json() as Promise<ClientService[]>)
      .then(purchased => setPurchasedServices(purchased))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  // Load public service catalog
  useEffect(() => {
    fetch("/api/services")
      .then(r => r.json() as Promise<DbService[]>)
      .then(services => {
        setPackages(services.filter(s => s.billingType === "one_time"));
        setRetainers(services.filter(s => s.billingType === "recurring_monthly"));
      })
      .catch(() => null)
      .finally(() => setCatalogLoading(false));
  }, []);

  const active = purchasedServices.filter(s => s.status === "active");
  const completed = purchasedServices.filter(s => s.status === "completed");

  const handleBuy = async (offer: DbService) => {
    const hasWizard =
      Array.isArray(offer.orderWorkflow) &&
      offer.orderWorkflow.length > 0 &&
      offer.basePrice;

    if (hasWizard && offer.slug) {
      setLocation(`/portal/onboarding/select?service=${encodeURIComponent(offer.slug)}`);
      return;
    }

    const priceInCents = Math.round(parseFloat(offer.basePrice ?? "0") * 100);

    setBuyingOffer(offer.id);
    try {
      const res = await fetchWithAuth("/api/portal/services/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: offer.name,
          priceInCents,
          description: offer.deliverables ?? offer.description,
          category: offer.category ?? "Quick-Win Package",
          returnUrl: window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "") + "/portal/services",
        }),
      });
      if (res.ok) {
        const data = await res.json() as { url: string };
        window.location.href = data.url;
      } else {
        const err = await res.json() as { error: string };
        setAlert({ type: "error", message: err.error ?? "Could not start checkout. Please try again." });
      }
    } catch {
      setAlert({ type: "error", message: "Network error. Please try again." });
    } finally {
      setBuyingOffer(null);
    }
  };

  return (
    <PortalLayout>
      <div className="px-6 py-8 max-w-5xl mx-auto">

        {/* Alert banner */}
        {alert && (
          <div className={`mb-6 flex items-start gap-3 px-4 py-3.5 rounded-xl border text-sm ${
            alert.type === "success"
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}>
            {alert.type === "success" ? (
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            ) : (
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            )}
            <p>{alert.message}</p>
            <button onClick={() => setAlert(null)} className="ml-auto flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}

        {/* ── SECTION 1: Purchased services ──────────────────────────────── */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-8 h-8 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
              <svg className="w-4.5 h-4.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-[#0A2540] leading-tight">Your Purchased Services</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Active engagements and their delivery progress</p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 bg-white border border-border rounded-xl">
              <div className="w-7 h-7 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : purchasedServices.length === 0 ? (
            <div className="bg-white border border-border border-dashed rounded-xl px-6 py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-[#0078D4]/10 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
              <p className="text-[#0A2540] font-semibold text-sm mb-1">No active services yet</p>
              <p className="text-muted-foreground text-xs">Purchased services will appear here once activated. Browse the catalog below to get started.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {active.length > 0 && (
                <section>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Active ({active.length})</p>
                  <div className="space-y-4">
                    {active.map(cs => <PurchasedServiceCard key={cs.id} cs={cs} />)}
                  </div>
                </section>
              )}
              {completed.length > 0 && (
                <section>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Completed ({completed.length})</p>
                  <div className="space-y-4">
                    {completed.map(cs => <PurchasedServiceCard key={cs.id} cs={cs} />)}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-border mb-10" />

        {/* ── SECTION 2: Available services ──────────────────────────────── */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#00B4D8]/10 flex items-center justify-center flex-shrink-0">
              <svg className="w-4.5 h-4.5 text-[#00B4D8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-[#0A2540] leading-tight">Available Services</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Fixed-price packages and monthly retainers — all delivered personally by Shane McCaw</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6 mt-5">
            <button
              onClick={() => setActiveTab("packages")}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                activeTab === "packages"
                  ? "bg-[#0078D4] text-white shadow-md"
                  : "bg-white text-[#0A2540] border border-border hover:border-[#0078D4]/40 hover:text-[#0078D4]"
              }`}
            >
              Quick-Win Packages
            </button>
            <button
              onClick={() => setActiveTab("retainers")}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                activeTab === "retainers"
                  ? "bg-[#0078D4] text-white shadow-md"
                  : "bg-white text-[#0A2540] border border-border hover:border-[#0078D4]/40 hover:text-[#0078D4]"
              }`}
            >
              Monthly Retainers
            </button>
          </div>

          {activeTab === "packages" && (
            <div>
              <p className="text-sm text-muted-foreground mb-5">
                Fixed scope. Fixed price. Clear deliverables. Start within 3–5 business days.
              </p>
              {catalogLoading ? (
                <CatalogSpinner />
              ) : packages.length === 0 ? (
                <div className="bg-white border border-dashed border-border rounded-xl px-6 py-8 text-center">
                  <p className="text-[#0A2540] font-semibold text-sm mb-1">No packages available right now</p>
                  <p className="text-muted-foreground text-xs">Check back soon or contact Shane directly.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {packages.map((offer) => (
                    <MicroOfferCard
                      key={offer.id}
                      offer={offer}
                      onBuy={handleBuy}
                      buying={buyingOffer === offer.id}
                    />
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground text-center mt-5">
                Secure checkout powered by Stripe. After purchase, Shane will be in touch within 1–2 business days to schedule your kickoff.
              </p>
            </div>
          )}

          {activeTab === "retainers" && (
            <div>
              <p className="text-sm text-muted-foreground mb-5">
                Ongoing senior M365 architect access — no hiring overhead, no long-term lock-in.
              </p>
              {catalogLoading ? (
                <CatalogSpinner />
              ) : retainers.length === 0 ? (
                <div className="bg-white border border-dashed border-border rounded-xl px-6 py-8 text-center">
                  <p className="text-[#0A2540] font-semibold text-sm mb-1">No retainer plans available right now</p>
                  <p className="text-muted-foreground text-xs">Contact Shane directly to discuss ongoing support.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {retainers.map((plan) => (
                    <RetainerCard key={plan.id} plan={plan} />
                  ))}
                </div>
              )}
              <div className="mt-6 bg-[#0078D4]/5 border border-[#0078D4]/20 rounded-xl px-5 py-4 text-center">
                <p className="text-sm font-semibold text-[#0A2540] mb-1">Not sure which retainer fits?</p>
                <p className="text-xs text-muted-foreground mb-3">Book a free 30-minute consultation and Shane will recommend the right level for your situation.</p>
                <a
                  href={BOOKINGS_URL ?? "mailto:info@shanemccaw.com?subject=Retainer Inquiry"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#0078D4]/90 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Book a Free Consultation
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}
