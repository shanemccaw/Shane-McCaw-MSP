import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { ShieldCheck, Loader2, ArrowRight, ArrowLeft, PenLine, X, RefreshCw, Sparkles } from "lucide-react";

interface Service {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  price: string | null;
  basePrice: string | null;
  maxPrice: string | null;
  turnaround: string | null;
  deliverables: string | null;
  billingType: "one_time" | "recurring_monthly";
}

interface WizardSelection {
  stepId: string;
  stepTitle: string;
  optionId: string;
  optionLabel: string;
  priceAdjustment: number;
}

function fmtPrice(p: number, billingType: "one_time" | "recurring_monthly") {
  const n = `$${p.toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
  return billingType === "recurring_monthly" ? `${n}/month` : n;
}

function fmt(p: string | null, billingType: "one_time" | "recurring_monthly") {
  if (!p) return "—";
  return fmtPrice(parseFloat(p), billingType);
}

function computeWizardDisplayPrice(svc: Service, sels: WizardSelection[]): number | null {
  if (!svc.basePrice || sels.length === 0) return null;
  const base = parseFloat(svc.basePrice);
  const adjustments = sels.reduce((sum, s) => sum + s.priceAdjustment, 0);
  let total = Math.round((base + adjustments) * 100) / 100;
  if (svc.maxPrice) {
    const max = parseFloat(svc.maxPrice);
    total = Math.min(total, max);
  }
  return total;
}

function buildContractHtml(
  services: Service[],
  signerName: string,
  today: string,
  getPrice: (s: Service) => string,
  getSelections: (s: Service) => WizardSelection[],
): string {
  const hasRecurring = services.some(s => s.billingType === "recurring_monthly");
  const hasOneTime = services.some(s => s.billingType === "one_time");

  const serviceTable = services.map(s => {
    const effectivePrice = getPrice(s);
    const sels = getSelections(s);
    const selectionsHtml = sels.length > 0
      ? `<tr><td colspan="2" style="padding:2px 0 8px 0;">
          <table style="width:100%;border-collapse:collapse;font-size:0.8em;color:#444;">
            ${sels.map(sel => `
            <tr>
              <td style="padding:2px 12px 2px 12px;color:#666;">${sel.stepTitle}: <strong style="color:#333;">${sel.optionLabel}</strong></td>
              <td style="padding:2px 0;text-align:right;white-space:nowrap;">${sel.priceAdjustment > 0 ? `+$${sel.priceAdjustment.toLocaleString("en-US")}` : "Included"}</td>
            </tr>`).join("")}
          </table>
         </td></tr>`
      : "";
    return `
    <tr>
      <td style="padding:6px 12px 6px 0;vertical-align:top;"><strong>${s.name}</strong></td>
      <td style="padding:6px 0;vertical-align:top;">${effectivePrice}${s.billingType === "recurring_monthly" ? " (billed monthly)" : " (one-time)"}</td>
    </tr>
    ${selectionsHtml}
    <tr>
      <td colspan="2" style="padding:0 0 10px 0;font-size:0.875em;color:#555;">
        ${s.deliverables
          ? `<ul style="margin:4px 0 0 0;padding-left:18px;">${s.deliverables.split("\n").filter((l: string) => l.trim()).map((l: string) => `<li style="margin-bottom:2px;">${l.trim()}</li>`).join("")}</ul>`
          : "As described on the service page"}
      </td>
    </tr>
  `;
  }).join("");

  return `
    <h2>Service Agreement — Shane McCaw Consulting LLC</h2>
    <p><strong>Date:</strong> ${today}</p>
    <p><strong>Service Provider:</strong> Shane McCaw Consulting LLC ("Consultant")</p>
    <p><strong>Client:</strong> ${signerName} ("Client")</p>
    <hr/>

    <h3>1. Services</h3>
    <p>Consultant agrees to deliver the following service(s) to Client:</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
      ${serviceTable}
    </table>

    <h3>2. Fees & Payment</h3>
    ${hasOneTime ? `<p>One-time services are payable in full at checkout before work commences. No additional charges will be incurred for the standard deliverables listed above.</p>` : ""}
    ${hasRecurring ? `<p>Monthly retainer services are billed at the stated monthly rate, payable in advance on a recurring monthly basis. Either party may cancel a monthly subscription with 30 days written notice. Cancellation takes effect at the end of the current billing period.</p>` : ""}
    <p>No refunds will be issued for one-time services once work has commenced. Monthly retainer fees for the current period are non-refundable on cancellation.</p>

    <h3>3. Scope</h3>
    <p>This agreement covers only the deliverables specified in Section 1. Any additional work beyond this scope must be agreed in writing and may be subject to additional fees.</p>

    <h3>4. Delivery</h3>
    <p>For one-time services, Consultant will deliver the agreed outputs within the stated turnaround period after receipt of payment and any required access or information from Client. Work will not commence until both payment is confirmed and all necessary access has been granted. For monthly retainers, Consultant will perform the described ongoing services throughout each billing period.</p>

    <h3>5. Revisions (One-Time Services)</h3>
    <p>One round of revisions is included within the scope of each one-time service. Additional revisions are available at Consultant's standard hourly rate.</p>

    <h3>6. Confidentiality</h3>
    <p>Each party agrees to keep the other party's confidential information confidential and not to disclose it to any third party without prior written consent. This obligation survives termination of this agreement.</p>

    <h3>7. Intellectual Property</h3>
    <p>Upon receipt of full payment (or, for ongoing retainers, upon payment for the relevant billing period), all deliverables produced by Consultant for Client under this agreement become the sole property of Client.</p>

    <h3>8. Limitation of Liability</h3>
    <p>Consultant's total liability under this agreement shall not exceed the total fees paid in the 12 months prior to any claim. Consultant is not liable for any indirect, incidental, or consequential damages.</p>

    <h3>9. Independent Contractor</h3>
    <p>Consultant is an independent contractor and not an employee of Client. Nothing in this agreement shall create any partnership, joint venture, agency, franchise, or employment relationship between the parties.</p>

    <h3>10. Governing Law</h3>
    <p>This agreement is governed by the laws of the State of Virginia, United States. Any disputes shall be resolved in the courts of Virginia.</p>

    <h3>11. Entire Agreement</h3>
    <p>This document constitutes the entire agreement between the parties with respect to this engagement and supersedes all prior discussions and representations. Amendments must be made in writing.</p>
  `;
}

export default function OnboardingContract() {
  const { user, fetchWithAuth } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);

  const serviceIdsParam = params.get("serviceIds") ?? params.get("serviceId") ?? "";
  const serviceIds = serviceIdsParam
    .split(",")
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n) && n > 0);
  const startDate = params.get("startDate") ?? new Date().toISOString().slice(0, 10);

  // Load wizard selections from sessionStorage (set by OnboardingSelect after wizard review step)
  // These are WizardSelection[] (with priceAdjustment info) keyed by serviceId string
  const wizardSelectionsData: Record<string, WizardSelection[]> = JSON.parse(
    sessionStorage.getItem("wizardSelections") ?? "{}"
  );

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [signerName, setSignerName] = useState(user?.name ?? user?.email?.split("@")[0] ?? "");
  const [company, setCompany] = useState(user?.company ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [address, setAddress] = useState(user?.address ?? "");
  const [agreed, setAgreed] = useState(false);
  const [signed, setSigned] = useState(false);
  const [stripeError, setStripeError] = useState("");
  const [hasScrolled, setHasScrolled] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contractScrollRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const hasDrawn = useRef(false);

  const handleContractScroll = useCallback(() => {
    const el = contractScrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) setHasScrolled(true);
  }, []);

  useEffect(() => {
    if (serviceIds.length === 0) { setLocation("/portal/onboarding/select"); return; }
    if (!user) { setLocation("/"); return; }

    fetch("/api/portal/onboarding/services")
      .then(r => r.json() as Promise<Service[]>)
      .then(all => {
        const matched = serviceIds.map(id => all.find(s => s.id === id)).filter(Boolean) as Service[];
        if (matched.length === 0) { setLocation("/portal/onboarding/select"); return; }
        setServices(matched);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const getPos = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e.nativeEvent as MouseEvent | TouchEvent, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e.nativeEvent as MouseEvent | TouchEvent, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#0A2540";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    hasDrawn.current = true;
    setSigned(true);
  };

  const stopDraw = () => { drawing.current = false; };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn.current = false;
    setSigned(false);
  };

  const handleSign = async () => {
    if (services.length === 0) return;
    if (!signerName.trim()) { setError("Please enter your full name."); return; }
    if (!agreed) { setError("Please confirm you have read and agree to the terms."); return; }
    if (!signed || !hasDrawn.current) { setError("Please draw your signature in the box above."); return; }

    setError("");
    setSubmitting(true);

    try {
      // Save profile fields before creating the contract
      await fetchWithAuth("/api/portal/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: signerName, company, phone, address }),
      });

      const canvas = canvasRef.current;
      const signatureData = canvas?.toDataURL("image/png") ?? null;

      // Persist full selection shape so the contract detail page can display human-readable labels
      const wizardSelectionsInput: Record<string, { stepId: string; stepTitle: string; optionId: string; optionLabel: string; priceAdjustment: number }[]> = {};
      for (const [svcIdStr, sels] of Object.entries(wizardSelectionsData)) {
        if (sels.length > 0) {
          wizardSelectionsInput[svcIdStr] = sels.map(s => ({
            stepId: s.stepId,
            stepTitle: s.stepTitle,
            optionId: s.optionId,
            optionLabel: s.optionLabel,
            priceAdjustment: s.priceAdjustment,
          }));
        }
      }

      const contractRes = await fetchWithAuth("/api/portal/onboarding/contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceIds: services.map(s => s.id),
          signatureData,
          signerName,
          wizardSelections: Object.keys(wizardSelectionsInput).length > 0 ? wizardSelectionsInput : undefined,
        }),
      });
      if (!contractRes.ok) {
        const err = await contractRes.json() as { error: string };
        throw new Error(err.error ?? "Failed to save contract");
      }
      const contractData = await contractRes.json() as { contractIds: number[] };
      const contractIds = contractData.contractIds;

      const checkoutRes = await fetchWithAuth("/api/portal/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceIds: services.map(s => s.id),
          contractIds,
          startDate,
          returnUrl: window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, ""),
        }),
      });

      if (!checkoutRes.ok) {
        let errMsg = `Checkout failed (${checkoutRes.status})`;
        try {
          const err = await checkoutRes.json() as { error: string };
          if (err.error) errMsg = err.error;
        } catch { /* non-JSON body, keep default message */ }
        throw new Error(errMsg);
      }

      const { url, secondaryUrl } = await checkoutRes.json() as { url: string; secondaryUrl?: string };

      sessionStorage.setItem("onboardingCartSummary", JSON.stringify(
        services.map(s => ({ name: s.name, billingType: s.billingType }))
      ));

      if (secondaryUrl) {
        sessionStorage.setItem("pendingCheckoutUrl", secondaryUrl);
      }

      if (url) {
        window.location.href = url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      if (msg.toLowerCase().includes("not yet configured") || msg.toLowerCase().includes("stripe")) {
        setStripeError(msg);
      } else {
        setError(msg);
      }
      setSubmitting(false);
    }
  };

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F9FC]">
        <Loader2 className="w-8 h-8 animate-spin text-[#0078D4]" />
      </div>
    );
  }

  if (services.length === 0) return null;

  const getDisplayPrice = (s: Service): number => {
    const sels = wizardSelectionsData[String(s.id)] ?? [];
    const wizardPrice = computeWizardDisplayPrice(s, sels);
    if (wizardPrice != null) return wizardPrice;
    return s.price ? parseFloat(s.price) : 0;
  };

  const oneTimeTotal = services
    .filter(s => s.billingType === "one_time")
    .reduce((sum, s) => sum + getDisplayPrice(s), 0);
  const monthlyTotal = services
    .filter(s => s.billingType === "recurring_monthly")
    .reduce((sum, s) => sum + getDisplayPrice(s), 0);

  return (
    <div className="min-h-screen bg-[#F7F9FC]">
      <div className="bg-[#0A2540] border-b border-white/10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0078D4] flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-bold text-sm">Shane McCaw Consulting</span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-xs text-white/50">
            <span>1. Choose services</span>
            <span>→</span>
            <span className="text-white font-semibold">2. Sign agreement</span>
            <span>→</span>
            <span>3. Pay & confirm</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="bg-white border border-border rounded-xl px-5 py-4 mb-6">
          <p className="text-xs text-muted-foreground mb-3">You're purchasing</p>
          <div className="space-y-2">
            {services.map(s => {
              const sels = wizardSelectionsData[String(s.id)] ?? [];
              const wizardPrice = computeWizardDisplayPrice(s, sels);
              const isCustom = wizardPrice != null;
              const displayPrice = isCustom
                ? fmtPrice(wizardPrice, s.billingType)
                : fmt(s.price, s.billingType);
              return (
                <div key={s.id}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-[#0A2540]">{s.name}</span>
                      {s.billingType === "recurring_monthly" && (
                        <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-1.5 py-0.5 flex items-center gap-1">
                          <RefreshCw className="w-2.5 h-2.5" />
                          monthly
                        </span>
                      )}
                      {isCustom && (
                        <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5 flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5" />
                          custom quote
                        </span>
                      )}
                    </div>
                    <span className="font-bold text-[#0078D4] text-sm">{displayPrice}</span>
                  </div>
                  {sels.length > 0 && (
                    <div className="mt-1 ml-2 space-y-0.5">
                      {sels.map(sel => (
                        <div key={sel.stepId} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium text-[#0A2540]/70">{sel.stepTitle}:</span>
                          <span>{sel.optionLabel}</span>
                          {sel.priceAdjustment > 0 && (
                            <span className="text-[#0078D4] font-medium">+${sel.priceAdjustment.toLocaleString()}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {(oneTimeTotal > 0 || monthlyTotal > 0) && (
            <div className="border-t border-border mt-3 pt-3 flex flex-wrap gap-4">
              {oneTimeTotal > 0 && (
                <div>
                  <span className="text-xs text-muted-foreground">One-time: </span>
                  <span className="text-sm font-bold text-[#0A2540]">${oneTimeTotal.toLocaleString("en-US")}</span>
                </div>
              )}
              {monthlyTotal > 0 && (
                <div>
                  <span className="text-xs text-muted-foreground">Monthly: </span>
                  <span className="text-sm font-bold text-emerald-700">${monthlyTotal.toLocaleString("en-US")}/mo</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white border border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border bg-[#F7F9FC]">
              <h2 className="font-bold text-[#0A2540] text-sm">Service Agreement</h2>
              <p className="text-xs text-muted-foreground">Please read before signing</p>
            </div>
            {!hasScrolled && (
              <div className="px-5 pt-3 pb-0">
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ↓ Scroll to the bottom to read the full agreement before signing
                </p>
              </div>
            )}
            <div
              ref={contractScrollRef}
              onScroll={handleContractScroll}
              className="px-5 py-4 prose prose-sm max-h-[500px] overflow-y-auto text-[#0A2540]"
              dangerouslySetInnerHTML={{ __html: buildContractHtml(
                services,
                signerName || "Client",
                today,
                (s) => {
                  const sels = wizardSelectionsData[String(s.id)] ?? [];
                  const wp = computeWizardDisplayPrice(s, sels);
                  return wp != null ? fmtPrice(wp, s.billingType) : fmt(s.price, s.billingType);
                },
                (s) => wizardSelectionsData[String(s.id)] ?? [],
              ) }}
            />
          </div>

          <div className="space-y-4">
            <div className="bg-white border border-border rounded-2xl p-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">
                  Full name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={signerName}
                  onChange={e => setSignerName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                />
                <p className="text-xs text-muted-foreground mt-1">As it will appear on the agreement</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">Company name</label>
                <input
                  type="text"
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  placeholder="Your company or organization"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">Business address</label>
                <input
                  type="text"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder="Street, City, State ZIP"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">Phone number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                />
              </div>
            </div>

            <div className="bg-white border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-[#0A2540] flex items-center gap-1.5">
                  <PenLine className="w-4 h-4 text-[#0078D4]" />
                  Draw your signature
                </label>
                <button onClick={clearCanvas} className="text-xs text-muted-foreground hover:text-[#0078D4] flex items-center gap-1">
                  <X className="w-3 h-3" />
                  Clear
                </button>
              </div>
              <div className="border-2 border-dashed border-border rounded-xl overflow-hidden bg-[#F7F9FC]">
                <canvas
                  ref={canvasRef}
                  width={480}
                  height={160}
                  className="w-full cursor-crosshair touch-none"
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={stopDraw}
                  onMouseLeave={stopDraw}
                  onTouchStart={startDraw}
                  onTouchMove={draw}
                  onTouchEnd={stopDraw}
                />
              </div>
              {!signed && (
                <p className="text-xs text-muted-foreground mt-2 text-center">Sign with mouse or touch above</p>
              )}
            </div>

            <div className={`bg-white border rounded-2xl p-5 transition-opacity ${hasScrolled ? "border-border opacity-100" : "border-border opacity-50"}`}>
              <label className={`flex items-start gap-3 ${hasScrolled ? "cursor-pointer" : "cursor-not-allowed"}`}>
                <input
                  type="checkbox"
                  checked={agreed}
                  disabled={!hasScrolled}
                  onChange={e => setAgreed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#0078D4] disabled:opacity-50"
                />
                <span className="text-sm text-[#0A2540]">
                  I have read and agree to the Service Agreement above. I understand that payment is required before work commences, and fees are non-refundable once work has begun.
                  {!hasScrolled && <span className="block text-xs text-muted-foreground mt-1">Please scroll through the full agreement first.</span>}
                </span>
              </label>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                {error}
              </div>
            )}

            {stripeError && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-4 text-sm">
                <p className="font-semibold mb-1">Online payment not yet configured</p>
                <p>{stripeError}</p>
                <p className="mt-2">
                  Please email{" "}
                  <a href="mailto:info@shanemccaw.com" className="underline font-medium">info@shanemccaw.com</a>{" "}
                  to arrange payment and get started.
                </p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={() => setLocation("/portal/onboarding/select")}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-[#0A2540] px-4 py-2.5 border border-border rounded-xl bg-white transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
              <button
                onClick={handleSign}
                disabled={submitting || !agreed || !signed || !signerName.trim()}
                className="flex-1 flex items-center justify-center gap-2 bg-[#0078D4] text-white font-semibold px-5 py-3 rounded-xl hover:bg-[#005A9E] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                ) : (
                  <>Sign & Continue to Payment <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
