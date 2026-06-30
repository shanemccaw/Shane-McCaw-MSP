import { useEffect, useState, useRef } from "react";
import { useLocation, useSearch, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { CheckCircle, Clock, ArrowRight, Loader2, ShieldCheck, Phone, ShoppingCart, RefreshCw, X, Settings2 } from "lucide-react";
import OrderWizard, { type WizardStep, type WizardSelection } from "@/components/OrderWizard";

interface Service {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  category: string | null;
  deliverables: string | null;
  price: string | null;
  basePrice: string | null;
  maxPrice: string | null;
  durationDays: number | null;
  turnaround: string | null;
  billingType: "one_time" | "recurring_monthly";
  orderWorkflow: WizardStep[] | null;
}


function fmtService(s: Service) {
  const fmt = (v: string | null) => {
    if (!v) return null;
    const n = parseFloat(v);
    if (isNaN(n)) return null;
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0 });
  };
  const base = fmt(s.basePrice);
  const max = fmt(s.maxPrice);
  if (base && max) {
    const range = `${base} – ${max}`;
    return s.billingType === "recurring_monthly" ? `${range}/mo` : range;
  }
  if (base) {
    const range = `from ${base}`;
    return s.billingType === "recurring_monthly" ? `${range}/mo` : range;
  }
  if (!s.price) return "Contact for pricing";
  const formatted = fmt(s.price)!;
  return s.billingType === "recurring_monthly" ? `${formatted}/mo` : formatted;
}

function fmtNum(p: string | null) {
  if (!p) return 0;
  return parseFloat(p);
}

export default function OnboardingSelect() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const preselectedSlug = params.get("service") ?? "";
  const lpServiceId = params.get("serviceId") ? Number(params.get("serviceId")) : null;

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lockedServiceId, setLockedServiceId] = useState<number | null>(null);

  // Wizard state
  const [wizardQueue, setWizardQueue] = useState<Service[]>([]);
  const [wizardIndex, setWizardIndex] = useState(0);
  // "card" = wizard opened by clicking a service card (close on complete, return to cart)
  // "checkout" = wizard opened by Continue button (navigate to contract on complete)
  const [wizardMode, setWizardMode] = useState<"card" | "checkout">("card");
  // Track confirmed wizard selections in component state so cart can show configured prices
  const [configuredSelections, setConfiguredSelections] = useState<Record<number, { price: number; selections: WizardSelection[] }>>({});

  // Guest info modal (shown when user is not logged in)
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestCompany, setGuestCompany] = useState("");
  const [guestError, setGuestError] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Clear stale wizard selections from previous tab sessions so the contract page
    // always receives fresh data that matches what the user configured this session.
    sessionStorage.removeItem("wizardSelections");

    // Handle LP token flow: read service data injected by landing page
    let injectedService: Service | null = null;
    if (lpServiceId) {
      const raw = sessionStorage.getItem("onboardingLpService");
      if (raw) {
        try {
          const lpSvc = JSON.parse(raw) as { id: number; slug: string | null; name: string; description?: string | null; visibility: string; billingType: string; price: string | null; basePrice: string | null; maxPrice: string | null; turnaround: string | null };
          if (lpSvc.id === lpServiceId) {
            injectedService = {
              id: lpSvc.id,
              slug: lpSvc.slug,
              name: lpSvc.name,
              description: lpSvc.description ?? null,
              category: null,
              deliverables: null,
              price: lpSvc.price,
              basePrice: lpSvc.basePrice,
              maxPrice: lpSvc.maxPrice,
              durationDays: null,
              turnaround: lpSvc.turnaround,
              billingType: lpSvc.billingType as "one_time" | "recurring_monthly",
              orderWorkflow: null,
            };
          }
        } catch { /* ignore malformed data */ }
      }
    }

    fetch("/api/portal/onboarding/services")
      .then(r => r.json() as Promise<Service[]>)
      .then(data => {
        const oneTime = data.filter(s => s.billingType === "one_time");
        const monthly = data.filter(s => s.billingType === "recurring_monthly");
        let sorted = [...oneTime, ...monthly];

        if (injectedService && !sorted.find(s => s.id === injectedService!.id)) {
          // Prepend the LP-only service so it appears first in the list
          sorted = [injectedService, ...sorted];
          setLockedServiceId(injectedService.id);
          setSelectedIds(new Set([injectedService.id]));
        } else if (preselectedSlug) {
          const match = sorted.find(s => s.slug === preselectedSlug);
          if (match) setSelectedIds(new Set([match.id]));
        }
        setServices(sorted);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [preselectedSlug, lpServiceId]);

  const toggleService = (id: number) => {
    // Locked LP-only services cannot be deselected
    if (id === lockedServiceId && selectedIds.has(id)) return;

    const svc = services.find(s => s.id === id);
    const wasSelected = selectedIds.has(id);

    // If deselecting a wizard service, clear its configured price so it re-runs the wizard next time
    if (wasSelected && svc?.orderWorkflow?.length && svc.basePrice) {
      setConfiguredSelections(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }

    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (svc?.billingType === "recurring_monthly") {
          for (const existing of next) {
            if (services.find(s => s.id === existing)?.billingType === "recurring_monthly") {
              next.delete(existing);
            }
          }
        }
        next.add(id);
      }
      return next;
    });

    // Open the wizard immediately when a wizard-service is newly selected
    if (!wasSelected && svc?.orderWorkflow?.length && svc.basePrice) {
      setWizardMode("card");
      setWizardQueue([svc]);
      setWizardIndex(0);
    }
  };

  const navigateToContract = () => {
    const qs = new URLSearchParams({
      serviceIds: Array.from(selectedIds).join(","),
    });
    setLocation(`/portal/onboarding/contract?${qs.toString()}`);
  };

  const proceedWithCheckout = () => {
    const selected = services.filter(s => selectedIds.has(s.id));
    // Only skip wizard for services already configured via card-click IN THIS SESSION.
    // We intentionally use component state (not sessionStorage) so stale data from
    // previous tab sessions can never silently skip the wizard.
    const needsWizard = selected.filter(
      s => s.orderWorkflow?.length && s.basePrice && !configuredSelections[s.id]
    );
    if (needsWizard.length > 0) {
      setWizardMode("checkout");
      setWizardQueue(needsWizard);
      setWizardIndex(0);
    } else {
      navigateToContract();
    }
  };

  const handleContinue = () => {
    if (selectedIds.size === 0) return;
    if (!user) {
      setGuestError("");
      setShowGuestModal(true);
      return;
    }
    proceedWithCheckout();
  };

  const handleGuestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setGuestError("");
    if (!guestEmail.trim()) { setGuestError("Please enter your email address."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail.trim())) { setGuestError("Please enter a valid email address."); return; }
    sessionStorage.setItem("onboardingGuest", JSON.stringify({ name: guestName.trim(), email: guestEmail.trim().toLowerCase(), company: guestCompany.trim() }));
    setShowGuestModal(false);
    proceedWithCheckout();
  };

  const handleWizardComplete = (finalPrice: number, selections: WizardSelection[]) => {
    const currentService = wizardQueue[wizardIndex];
    // Persist to sessionStorage for the contract page
    const allSelections = JSON.parse(sessionStorage.getItem("wizardSelections") ?? "{}") as Record<string, WizardSelection[]>;
    allSelections[String(currentService.id)] = selections;
    sessionStorage.setItem("wizardSelections", JSON.stringify(allSelections));

    // Build the updated configured map synchronously so we can check completeness
    const newConfigured = {
      ...configuredSelections,
      [currentService.id]: { price: finalPrice, selections },
    };
    setConfiguredSelections(newConfigured);

    if (wizardIndex + 1 < wizardQueue.length) {
      setWizardIndex(i => i + 1);
    } else {
      setWizardQueue([]);
      setWizardIndex(0);
      // Always go to contract once every selected wizard service is configured —
      // regardless of whether the wizard was opened by card-click or by Continue.
      const allConfigured = services
        .filter(s => selectedIds.has(s.id) && s.orderWorkflow?.length && s.basePrice)
        .every(s => !!newConfigured[s.id]);
      if (allConfigured) {
        navigateToContract();
      }
    }
  };

  const handleWizardCancel = () => {
    // Deselect the service whose wizard was cancelled (only for card-click triggered wizards)
    const cancelledService = wizardQueue[wizardIndex];
    if (cancelledService && wizardMode === "card") {
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(cancelledService.id);
        return next;
      });
    }
    setWizardQueue([]);
    setWizardIndex(0);
  };

  // Open wizard for a service that's already selected (re-configure)
  const reconfigureService = (svc: Service) => {
    setWizardMode("card");
    setWizardQueue([svc]);
    setWizardIndex(0);
  };

  const selectedServices = services.filter(s => selectedIds.has(s.id));
  const oneTimeTotal = selectedServices
    .filter(s => s.billingType === "one_time" && !s.orderWorkflow?.length)
    .reduce((sum, s) => sum + fmtNum(s.price ?? s.basePrice), 0);
  const monthlyTotal = selectedServices
    .filter(s => s.billingType === "recurring_monthly" && !s.orderWorkflow?.length)
    .reduce((sum, s) => sum + fmtNum(s.price ?? s.basePrice), 0);

  const hasWizardServices = selectedServices.some(s => s.orderWorkflow?.length && s.basePrice);
  const microOffers = services.filter(s => s.billingType === "one_time");
  const consultingServices = services.filter(s => s.billingType === "recurring_monthly");
  const activeWizardService = wizardQueue.length > 0 ? wizardQueue[wizardIndex] : null;

  return (
    <div className="min-h-screen bg-[#F7F9FC]">
      {activeWizardService && (
        <OrderWizard
          key={activeWizardService.id}
          serviceName={activeWizardService.name}
          basePrice={parseFloat(activeWizardService.basePrice!)}
          steps={activeWizardService.orderWorkflow!}
          onComplete={handleWizardComplete}
          onCancel={handleWizardCancel}
        />
      )}

      {/* ── Guest Info Modal ────────────────────────────────────────── */}
      {showGuestModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowGuestModal(false); }}
        >
          <div ref={modalRef} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="bg-[#0A2540] px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-white/60 text-xs font-medium uppercase tracking-wider mb-0.5">One step away</p>
                <h2 className="text-white font-bold text-base leading-tight">Where should we send your agreement?</h2>
              </div>
              <button onClick={() => setShowGuestModal(false)} className="text-white/50 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGuestSubmit} className="p-6 space-y-4">
              <p className="text-xs text-muted-foreground leading-relaxed bg-[#F7F9FC] rounded-xl px-3 py-2.5 border border-border">
                No account needed upfront — you'll set your portal password <strong>after</strong> payment. Already a client?{" "}
                <a href={`${import.meta.env.BASE_URL}login`} className="text-[#0078D4] hover:underline font-semibold">Sign in →</a>
              </p>

              <div>
                <label className="text-xs font-semibold text-[#0A2540] mb-1.5 block">Your name <span className="text-muted-foreground font-normal">(optional)</span></label>
                <input
                  type="text"
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-[#0A2540] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4]"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[#0A2540] mb-1.5 block">Company <span className="text-muted-foreground font-normal">(optional)</span></label>
                <input
                  type="text"
                  value={guestCompany}
                  onChange={e => setGuestCompany(e.target.value)}
                  placeholder="Acme Corp"
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-[#0A2540] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4]"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[#0A2540] mb-1.5 block">Work email <span className="text-red-500">*</span></label>
                <input
                  type="email"
                  required
                  autoFocus
                  value={guestEmail}
                  onChange={e => setGuestEmail(e.target.value)}
                  placeholder="jane@company.com"
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-[#0A2540] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4]"
                />
              </div>

              {guestError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                  {guestError}
                </p>
              )}

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 bg-[#0078D4] text-white font-semibold px-5 py-3 rounded-xl hover:bg-[#005A9E] transition-colors text-sm"
              >
                Continue to sign agreement
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="bg-[#0A2540] border-b border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0078D4] flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-bold text-sm">Shane McCaw Consulting</span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-xs text-white/50">
            <span className="text-white font-semibold">1. Choose services</span>
            <span>→</span>
            <span>2. Sign agreement</span>
            <span>→</span>
            <span>3. Pay & confirm</span>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-2">
            Choose your services
          </h1>
          <p className="text-muted-foreground text-sm max-w-xl">
            Select one or more services. Quick-win packages are one-time fixed-price; consulting retainers bill monthly. You can mix both in a single order.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-[#0078D4]" />
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-8">
              {microOffers.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#0078D4]">Quick Win Packages</span>
                    <span className="text-[10px] bg-[#0078D4]/10 text-[#0078D4] px-2 py-0.5 rounded-full font-semibold">One-time</span>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {microOffers.map(service => {
                      const isSelected = selectedIds.has(service.id);
                      const hasWizard = !!(service.orderWorkflow?.length && service.basePrice);
                      return (
                        <button
                          key={service.id}
                          onClick={() => toggleService(service.id)}
                          className={`text-left rounded-2xl border-2 p-4 transition-all focus:outline-none ${
                            isSelected
                              ? "border-[#0078D4] bg-white shadow-md"
                              : "border-border bg-white hover:border-[#0078D4]/40 hover:shadow-sm"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#0078D4] bg-[#0078D4]/10 px-2 py-0.5 rounded-full">
                              {service.category ?? "Micro-offer"}
                            </span>
                            {isSelected && <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0" />}
                          </div>
                          <h3 className="font-bold text-[#0A2540] text-sm mb-1">{service.name}</h3>
                          <p className="text-xs text-muted-foreground leading-relaxed mb-3 line-clamp-2">
                            {service.description}
                          </p>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-base font-extrabold text-[#0A2540]">{fmtService(service)}</span>
                              {hasWizard && (
                                <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-medium">
                                  custom quote
                                </span>
                              )}
                            </div>
                            {service.turnaround && (
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <Clock className="w-3 h-3" />
                                {service.turnaround}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {consultingServices.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#0078D4]">Consulting Retainers</span>
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                      <RefreshCw className="w-2.5 h-2.5" />
                      Monthly
                    </span>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {consultingServices.map(service => {
                      const isSelected = selectedIds.has(service.id);
                      const hasWizard = !!(service.orderWorkflow?.length && service.basePrice);
                      return (
                        <button
                          key={service.id}
                          onClick={() => toggleService(service.id)}
                          className={`text-left rounded-2xl border-2 p-4 transition-all focus:outline-none ${
                            isSelected
                              ? "border-emerald-500 bg-white shadow-md"
                              : "border-border bg-white hover:border-emerald-400/60 hover:shadow-sm"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                              {service.category ?? "Consulting"}
                            </span>
                            {isSelected && <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                          </div>
                          <h3 className="font-bold text-[#0A2540] text-sm mb-1">{service.name}</h3>
                          <p className="text-xs text-muted-foreground leading-relaxed mb-3 line-clamp-2">
                            {service.description}
                          </p>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-base font-extrabold text-[#0A2540]">{fmtService(service)}</span>
                              {hasWizard && (
                                <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-medium">
                                  custom quote
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                              <RefreshCw className="w-3 h-3" />
                              billed monthly
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>

            <div className="lg:col-span-1">
              <div className="sticky top-6 space-y-4">
                <div className="bg-white border border-border rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 bg-[#0A2540] flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-white" />
                    <span className="text-white text-sm font-semibold">Your cart</span>
                    {selectedIds.size > 0 && (
                      <span className="ml-auto text-xs bg-[#0078D4] text-white rounded-full px-2 py-0.5 font-semibold">
                        {selectedIds.size}
                      </span>
                    )}
                  </div>

                  <div className="p-4">
                    {selectedIds.size === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Select services above to see your cart
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {selectedServices.map(s => {
                          const hasWizard = !!(s.orderWorkflow?.length && s.basePrice);
                          const configured = configuredSelections[s.id];
                          return (
                            <div key={s.id} className="flex items-start justify-between gap-2 text-sm">
                              <div className="flex-1 min-w-0">
                                <p className="text-[#0A2540] font-medium text-xs leading-snug line-clamp-2">{s.name}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                  {s.billingType === "recurring_monthly" ? "monthly subscription" : "one-time"}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {hasWizard ? (
                                  configured ? (
                                    <>
                                      <span className="text-[#0A2540] font-bold text-xs">
                                        ${configured.price.toLocaleString("en-US")}
                                        {s.billingType === "recurring_monthly" ? "/mo" : ""}
                                      </span>
                                      <button
                                        onClick={() => reconfigureService(s)}
                                        className="text-muted-foreground hover:text-[#0078D4] transition-colors ml-0.5"
                                        title="Reconfigure"
                                      >
                                        <Settings2 className="w-3 h-3" />
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => reconfigureService(s)}
                                      className="text-amber-600 text-[10px] font-medium bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded hover:bg-amber-100 transition-colors flex items-center gap-1"
                                    >
                                      <Settings2 className="w-2.5 h-2.5" />
                                      Configure
                                    </button>
                                  )
                                ) : (
                                  <span className="text-[#0A2540] font-semibold text-xs">{fmtService(s)}</span>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {!hasWizardServices && (
                          <div className="border-t border-border pt-2 mt-2 space-y-1">
                            {oneTimeTotal > 0 && (
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground text-xs">One-time total</span>
                                <span className="font-bold text-[#0A2540] text-xs">${oneTimeTotal.toLocaleString("en-US")}</span>
                              </div>
                            )}
                            {monthlyTotal > 0 && (
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground text-xs">Monthly total</span>
                                <span className="font-bold text-emerald-700 text-xs">${monthlyTotal.toLocaleString("en-US")}/mo</span>
                              </div>
                            )}
                            {monthlyTotal > 0 && (
                              <p className="text-[10px] text-muted-foreground leading-relaxed pt-1">
                                Subscription items renew monthly. Cancel any time.
                              </p>
                            )}
                          </div>
                        )}
                        {hasWizardServices && (
                          <div className="border-t border-border pt-2 mt-2">
                            {selectedServices.some(s => s.orderWorkflow?.length && s.basePrice && !configuredSelections[s.id]) ? (
                              <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 leading-relaxed">
                                Click <strong>Configure</strong> above to set your custom price, then continue.
                              </p>
                            ) : (
                              <p className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5 leading-relaxed">
                                ✓ All services configured — click Continue to sign your agreement.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={handleContinue}
                  disabled={selectedIds.size === 0}
                  className="w-full flex items-center justify-center gap-2 bg-[#0078D4] text-white font-semibold px-5 py-3 rounded-xl hover:bg-[#005A9E] transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm"
                >
                  {hasWizardServices ? "Get Your Custom Quote" : "Continue to Agreement"}
                  <ArrowRight className="w-4 h-4" />
                </button>

                <div className="text-center">
                  <Link
                    href="/book"
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-[#0078D4] transition-colors font-medium"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Prefer to talk first? Schedule a free discovery call →
                  </Link>
                </div>

                <p className="text-xs text-muted-foreground text-center">
                  You'll review and sign a short service agreement before checkout.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
