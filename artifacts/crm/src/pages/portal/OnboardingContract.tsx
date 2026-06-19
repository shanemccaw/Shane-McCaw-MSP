import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { ShieldCheck, Loader2, ArrowRight, ArrowLeft, PenLine, X } from "lucide-react";

interface Service {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  price: string | null;
  turnaround: string | null;
  deliverables: string | null;
}

function fmt(p: string | null) {
  if (!p) return "—";
  return `$${parseFloat(p).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

function buildContractHtml(service: Service, signerName: string, today: string): string {
  return `
    <h2>Service Agreement — ${service.name}</h2>
    <p><strong>Date:</strong> ${today}</p>
    <p><strong>Service Provider:</strong> Shane McCaw Consulting LLC ("Consultant")</p>
    <p><strong>Client:</strong> ${signerName} ("Client")</p>
    <hr/>
    <h3>1. Services</h3>
    <p>Consultant agrees to deliver the <strong>${service.name}</strong> micro-offer package to Client. Deliverables include: ${service.deliverables ?? "as described on the service page"}. Turnaround: ${service.turnaround ?? `${service.price} — see service details`}.</p>
    <h3>2. Fees & Payment</h3>
    <p>The fixed fee for this engagement is <strong>${fmt(service.price)} USD</strong>, payable in full at checkout before work commences. No additional charges will be incurred for the standard deliverables listed above.</p>
    <h3>3. Scope</h3>
    <p>This agreement covers only the deliverables specified in Section 1. Any additional work beyond this scope must be agreed in writing and may be subject to additional fees.</p>
    <h3>4. Delivery</h3>
    <p>Consultant will deliver the agreed outputs within the stated turnaround period after receipt of payment and any required access or information from Client. Work will not commence until both payment is confirmed and all necessary access has been granted.</p>
    <h3>5. Revisions</h3>
    <p>One round of revisions is included within the scope. Additional revisions are available at Consultant's standard hourly rate.</p>
    <h3>6. Confidentiality</h3>
    <p>Each party agrees to keep the other party's confidential information confidential and not to disclose it to any third party without prior written consent.</p>
    <h3>7. Intellectual Property</h3>
    <p>Upon receipt of full payment, all deliverables produced by Consultant for Client under this agreement become the sole property of Client.</p>
    <h3>8. Limitation of Liability</h3>
    <p>Consultant's total liability under this agreement shall not exceed the fees paid. Consultant is not liable for any indirect, incidental, or consequential damages.</p>
    <h3>9. Governing Law</h3>
    <p>This agreement is governed by the laws of the State of Virginia, United States.</p>
    <h3>10. Entire Agreement</h3>
    <p>This document constitutes the entire agreement between the parties with respect to this engagement and supersedes all prior discussions.</p>
  `;
}

export default function OnboardingContract() {
  const { user, fetchWithAuth } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const serviceId = parseInt(params.get("serviceId") ?? "0", 10);
  const startDate = params.get("startDate") ?? new Date().toISOString().slice(0, 10);

  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [signerName, setSignerName] = useState(user?.email?.split("@")[0] ?? "");
  const [agreed, setAgreed] = useState(false);
  const [signed, setSigned] = useState(false);
  const [stripeError, setStripeError] = useState("");
  const [hasScrolled, setHasScrolled] = useState(false);

  // Canvas for signature
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contractScrollRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const hasDrawn = useRef(false);

  const handleContractScroll = useCallback(() => {
    const el = contractScrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) {
      setHasScrolled(true);
    }
  }, []);

  useEffect(() => {
    if (!serviceId) { setLocation("/portal/onboarding/select"); return; }
    if (!user) { setLocation("/"); return; }

    fetch(`/api/portal/onboarding/services`)
      .then(r => r.json() as Promise<Service[]>)
      .then(services => {
        const s = services.find(sv => sv.id === serviceId);
        if (!s) { setLocation("/portal/onboarding/select"); return; }
        setService(s);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [serviceId, user, setLocation]);

  // Canvas drawing
  const getPos = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
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
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn.current = false;
    setSigned(false);
  };

  const handleSign = async () => {
    if (!service) return;
    if (!signerName.trim()) { setError("Please enter your full name."); return; }
    if (!agreed) { setError("Please confirm you have read and agree to the terms."); return; }
    if (!signed || !hasDrawn.current) { setError("Please draw your signature in the box above."); return; }

    setError("");
    setSubmitting(true);

    try {
      const canvas = canvasRef.current;
      const signatureData = canvas?.toDataURL("image/png") ?? null;

      // Sign the contract
      const contractRes = await fetchWithAuth("/api/portal/onboarding/contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: service.id, signatureData, signerName }),
      });
      if (!contractRes.ok) {
        const err = await contractRes.json() as { error: string };
        throw new Error(err.error ?? "Failed to save contract");
      }
      const contract = await contractRes.json() as { id: number };

      // Create Stripe checkout session
      const checkoutRes = await fetchWithAuth("/api/portal/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: service.id,
          contractId: contract.id,
          startDate,
          returnUrl: window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, ""),
        }),
      });

      if (!checkoutRes.ok) {
        const err = await checkoutRes.json() as { error: string };
        throw new Error(err.error);
      }

      const { url } = await checkoutRes.json() as { url: string };
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

  if (!service) return null;

  return (
    <div className="min-h-screen bg-[#F7F9FC]">
      {/* Header */}
      <div className="bg-[#0A2540] border-b border-white/10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0078D4] flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-bold text-sm">Shane McCaw Consulting</span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-xs text-white/50">
            <span>1. Choose service</span>
            <span>→</span>
            <span className="text-white font-semibold">2. Sign agreement</span>
            <span>→</span>
            <span>3. Pay & confirm</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Service summary bar */}
        <div className="bg-white border border-border rounded-xl px-5 py-4 mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">You're purchasing</p>
            <p className="font-bold text-[#0A2540]">{service.name}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Fixed price</p>
            <p className="text-xl font-extrabold text-[#0078D4]">{fmt(service.price)}</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Left: Contract text */}
          <div className="bg-white border border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border bg-[#F7F9FC]">
              <h2 className="font-bold text-[#0A2540] text-sm">Service Agreement</h2>
              <p className="text-xs text-muted-foreground">Please read before signing</p>
            </div>
            {!hasScrolled && (
              <div className="px-5 pt-3 pb-0">
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
                  ↓ Scroll to the bottom to read the full agreement before signing
                </p>
              </div>
            )}
            <div
              ref={contractScrollRef}
              onScroll={handleContractScroll}
              className="px-5 py-4 prose prose-sm max-h-[500px] overflow-y-auto text-[#0A2540]"
              dangerouslySetInnerHTML={{ __html: buildContractHtml(service, signerName || "Client", today) }}
            />
          </div>

          {/* Right: Signature capture */}
          <div className="space-y-4">
            {/* Name */}
            <div className="bg-white border border-border rounded-2xl p-5">
              <label className="block text-sm font-semibold text-[#0A2540] mb-2">
                Full name (as it will appear on the agreement)
              </label>
              <input
                type="text"
                value={signerName}
                onChange={e => setSignerName(e.target.value)}
                placeholder="Your full name"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
              />
            </div>

            {/* Signature canvas */}
            <div className="bg-white border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-[#0A2540] flex items-center gap-1.5">
                  <PenLine className="w-4 h-4 text-[#0078D4]" />
                  Draw your signature
                </label>
                <button
                  onClick={clearCanvas}
                  className="text-xs text-muted-foreground hover:text-[#0078D4] flex items-center gap-1"
                >
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
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  Sign with mouse or touch above
                </p>
              )}
            </div>

            {/* Agree checkbox — gated on scroll completion */}
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
                  I have read and agree to the Service Agreement above. I understand that payment is required before work commences, and the fixed fee is non-refundable once work has begun.
                  {!hasScrolled && <span className="block text-xs text-muted-foreground mt-1">Please scroll through the full agreement first.</span>}
                </span>
              </label>
            </div>

            {/* Errors */}
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
                  <a href="mailto:info@shanemccaw.com" className="underline font-medium">
                    info@shanemccaw.com
                  </a>{" "}
                  to arrange payment and get started.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setLocation(`/portal/onboarding/select`)}
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
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing…
                  </>
                ) : (
                  <>
                    Sign & Continue to Payment
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
