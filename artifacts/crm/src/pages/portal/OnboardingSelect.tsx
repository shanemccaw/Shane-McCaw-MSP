import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { CheckCircle, Clock, ArrowRight, Loader2, ShieldCheck, Calendar } from "lucide-react";

interface Service {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  category: string | null;
  deliverables: string | null;
  price: string | null;
  durationDays: number | null;
  turnaround: string | null;
}

const SLUG_ORDER = [
  "m365-health-check",
  "copilot-readiness",
  "sharepoint-blueprint",
  "power-automate",
  "security-audit",
  "copilot-prompts",
];

function fmt(p: string | null) {
  if (!p) return "Contact for pricing";
  return `$${parseFloat(p).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function OnboardingSelect() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const preselectedSlug = params.get("service") ?? "";

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState<string>(todayIso());

  useEffect(() => {
    fetch("/api/portal/onboarding/services")
      .then(r => r.json() as Promise<Service[]>)
      .then(data => {
        const sorted = [...data].sort((a, b) => {
          const ai = SLUG_ORDER.indexOf(a.slug ?? "");
          const bi = SLUG_ORDER.indexOf(b.slug ?? "");
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });
        setServices(sorted);
        if (preselectedSlug) {
          const match = sorted.find(s => s.slug === preselectedSlug);
          if (match) setSelectedId(match.id);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [preselectedSlug]);

  const handleContinue = () => {
    if (!selectedId) return;
    if (!user) {
      sessionStorage.setItem("onboardingReturnTo", `/portal/onboarding/select?service=${preselectedSlug || ""}`);
      setLocation("/");
      return;
    }
    const qs = new URLSearchParams({
      serviceId: String(selectedId),
      startDate,
    });
    setLocation(`/portal/onboarding/contract?${qs.toString()}`);
  };

  const selected = services.find(s => s.id === selectedId);

  return (
    <div className="min-h-screen bg-[#F7F9FC]">
      {/* Header */}
      <div className="bg-[#0A2540] border-b border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0078D4] flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-bold text-sm">Shane McCaw Consulting</span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-xs text-white/50">
            <span className="text-white font-semibold">1. Choose service</span>
            <span>→</span>
            <span>2. Sign agreement</span>
            <span>→</span>
            <span>3. Pay & confirm</span>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-2">
            Choose your micro-offer
          </h1>
          <p className="text-muted-foreground text-sm max-w-xl">
            Fixed-price, fast-turnaround engagements. Select one to review the deliverables, then sign a lightweight agreement before checkout.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-[#0078D4]" />
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {services.map(service => {
              const isSelected = service.id === selectedId;
              return (
                <button
                  key={service.id}
                  onClick={() => setSelectedId(service.id)}
                  className={`text-left rounded-2xl border-2 p-5 transition-all focus:outline-none ${
                    isSelected
                      ? "border-[#0078D4] bg-white shadow-md"
                      : "border-border bg-white hover:border-[#0078D4]/40 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#0078D4] bg-[#0078D4]/10 px-2 py-0.5 rounded-full">
                        {service.category ?? "Micro-offer"}
                      </span>
                    </div>
                    {isSelected && (
                      <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    )}
                  </div>

                  <h3 className="font-bold text-[#0A2540] text-sm mb-1">{service.name}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-4 line-clamp-3">
                    {service.description}
                  </p>

                  <div className="flex items-center justify-between">
                    <span className="text-lg font-extrabold text-[#0A2540]">{fmt(service.price)}</span>
                    {service.turnaround && (
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {service.turnaround}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Detail panel for selected service */}
        {selected && (
          <div className="bg-white border border-border rounded-2xl p-6 mb-6">
            <h2 className="font-bold text-[#0A2540] mb-1">{selected.name} — What's included</h2>
            <p className="text-sm text-muted-foreground mb-4">{selected.description}</p>
            {selected.deliverables && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#0078D4] mb-2">Deliverables</p>
                <ul className="space-y-1.5">
                  {selected.deliverables.split(",").map(d => (
                    <li key={d} className="flex items-center gap-2 text-sm text-[#0A2540]">
                      <CheckCircle className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0" />
                      {d.trim()}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Preferred start date */}
        <div className="bg-white border border-border rounded-2xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-[#0078D4]" />
            <h3 className="font-semibold text-[#0A2540] text-sm">Preferred start date</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            When would you like the engagement to begin? Shane will confirm availability after purchase.
          </p>
          <input
            type="date"
            value={startDate}
            min={todayIso()}
            onChange={e => setStartDate(e.target.value)}
            className="border border-border rounded-lg px-3 py-2 text-sm text-[#0A2540] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 focus:border-[#0078D4]"
          />
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={handleContinue}
            disabled={!selectedId}
            className="flex items-center gap-2 bg-[#0078D4] text-white font-semibold px-6 py-3 rounded-xl hover:bg-[#005A9E] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Continue to Agreement
            <ArrowRight className="w-4 h-4" />
          </button>
          <p className="text-xs text-muted-foreground">
            You'll review and sign a short service agreement before checkout.
          </p>
        </div>
      </div>
    </div>
  );
}
