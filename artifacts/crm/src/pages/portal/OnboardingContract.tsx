import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { ShieldCheck, Loader2, ArrowRight, ArrowLeft, PenLine, X, RefreshCw, Sparkles, Tag, ChevronDown, Check, Clock } from "lucide-react";

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

const HEADING_STYLE = "font-size:0.72em;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#0078D4;border-bottom:2px solid #e2e8f0;padding-bottom:5px;margin:20px 0 8px 0;";
const PARA_STYLE = "font-size:0.85em;color:#374151;line-height:1.6;margin:0 0 10px 0;";
const TD_BASE = "padding:9px 12px;vertical-align:top;border-bottom:1px solid #e2e8f0;";

function buildContractHtml(
  services: Service[],
  signerName: string,
  today: string,
  getPrice: (s: Service) => string,
  getSelections: (s: Service) => WizardSelection[],
  clientInfo?: { company?: string; address?: string; phone?: string; email?: string },
  coupon?: { code: string; discountAmount: number; discountedTotal: number } | null,
  isFree?: boolean,
  requiredPermissions?: { scope: string; reason: string }[],
): string {
  const hasRecurring = services.some(s => s.billingType === "recurring_monthly");
  const hasOneTime = services.some(s => s.billingType === "one_time");

  const serviceRows = services.map((s, idx) => {
    const effectivePrice = getPrice(s);
    const sels = getSelections(s);
    const rowBg = idx % 2 === 1 ? "background:#F7F9FC;" : "";
    const selectionsHtml = sels.length > 0
      ? `<tr style="${rowBg}">
          <td colspan="2" style="${TD_BASE}padding-top:2px;padding-bottom:10px;">
            <table style="width:100%;border-collapse:collapse;font-size:0.9em;">
              ${sels.map(sel => `
              <tr>
                <td style="padding:2px 0 2px 12px;color:#6B7280;">${sel.stepTitle}: <strong style="color:#374151;">${sel.optionLabel}</strong></td>
                <td style="padding:2px 0;text-align:right;white-space:nowrap;color:#6B7280;">${sel.priceAdjustment > 0 ? `<span style="color:#0078D4;font-weight:600;">+$${sel.priceAdjustment.toLocaleString("en-US")}</span>` : "Included"}</td>
              </tr>`).join("")}
            </table>
          </td>
        </tr>`
      : "";
    const deliverableLines: string[] = Array.isArray(s.deliverables)
      ? (s.deliverables as string[]).filter((l: string) => l.trim())
      : typeof s.deliverables === "string"
        ? (s.deliverables as string).split("\n").filter((l: string) => l.trim())
        : [];
    const deliverableHtml = deliverableLines.length > 0
      ? `<ul style="margin:4px 0 0 0;padding-left:16px;font-size:0.85em;color:#6B7280;">${deliverableLines.map((l: string) => `<li style="margin-bottom:2px;">${l.trim()}</li>`).join("")}</ul>`
      : `<span style="font-size:0.85em;color:#9CA3AF;">As described on the service page</span>`;
    return `
    <tr style="${rowBg}">
      <td style="${TD_BASE}font-weight:600;color:#0A2540;">
        ${s.name}
        ${deliverableHtml}
      </td>
      <td style="${TD_BASE}text-align:right;white-space:nowrap;color:#0078D4;font-weight:700;">${effectivePrice}</td>
      <td style="${TD_BASE}text-align:right;white-space:nowrap;color:#6B7280;font-size:0.8em;">${s.billingType === "recurring_monthly" ? "monthly" : "one-time"}</td>
    </tr>
    ${selectionsHtml}`;
  }).join("");

  const clientAddrLines = clientInfo?.address
    ? clientInfo.address.split(/\s{2,}|\n/).filter(Boolean)
    : [];

  return `
    <div style="background:linear-gradient(135deg,#0A2540 0%,#0d3060 100%);color:#fff;padding:20px 24px 18px;border-radius:10px;margin-bottom:16px;">
      <div style="font-size:0.7em;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.55);margin-bottom:4px;">Service Agreement</div>
      <div style="font-size:1.1em;font-weight:800;color:#fff;margin-bottom:12px;">Shane McCaw Consulting LLC</div>
      <div style="display:flex;flex-wrap:wrap;gap:16px;font-size:0.78em;color:rgba(255,255,255,0.75);">
        <span><strong style="color:rgba(255,255,255,0.5);font-weight:600;">Date</strong>&nbsp;&nbsp;${today}</span>
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:16px;font-size:0.85em;">
      <thead>
        <tr style="background:#F7F9FC;">
          <th style="padding:8px 14px;text-align:left;font-weight:700;font-size:0.72em;text-transform:uppercase;letter-spacing:0.06em;color:#6B7280;border-bottom:1px solid #e2e8f0;width:50%;">Provider</th>
          <th style="padding:8px 14px;text-align:left;font-weight:700;font-size:0.72em;text-transform:uppercase;letter-spacing:0.06em;color:#6B7280;border-bottom:1px solid #e2e8f0;width:50%;">Client</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:12px 14px;vertical-align:top;border-right:1px solid #e2e8f0;">
            <div style="font-weight:700;color:#0A2540;margin-bottom:4px;">Shane McCaw Consulting LLC</div>
            <div style="color:#6B7280;font-size:0.9em;line-height:1.6;">
              Shane McCaw<br/>
              info@shanemccaw.com
            </div>
          </td>
          <td style="padding:12px 14px;vertical-align:top;">
            <div style="font-weight:700;color:#0A2540;margin-bottom:4px;">${signerName}${clientInfo?.company ? `<span style="font-weight:400;color:#6B7280;"> — ${clientInfo.company}</span>` : ""}</div>
            <div style="color:#6B7280;font-size:0.9em;line-height:1.6;">
              ${clientInfo?.email ? `${clientInfo.email}<br/>` : ""}
              ${clientInfo?.phone ? `${clientInfo.phone}<br/>` : ""}
              ${clientInfo?.address ? `${clientAddrLines.length > 0 ? clientAddrLines.join("<br/>") : clientInfo.address}` : ""}
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <h3 style="${HEADING_STYLE}">1. Services</h3>
    <p style="${PARA_STYLE}">Consultant agrees to deliver the following service(s) to Client:</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:16px;font-size:0.88em;">
      <thead>
        <tr style="background:#F7F9FC;">
          <th style="padding:8px 12px;text-align:left;font-weight:700;font-size:0.75em;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280;border-bottom:1px solid #e2e8f0;">Service &amp; Deliverables</th>
          <th style="padding:8px 12px;text-align:right;font-weight:700;font-size:0.75em;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280;border-bottom:1px solid #e2e8f0;">Price</th>
          <th style="padding:8px 12px;text-align:right;font-weight:700;font-size:0.75em;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280;border-bottom:1px solid #e2e8f0;">Type</th>
        </tr>
      </thead>
      <tbody>
        ${serviceRows}
        ${coupon ? `
        <tr>
          <td style="${TD_BASE}color:#6B7280;font-style:italic;">Subtotal</td>
          <td style="${TD_BASE}text-align:right;color:#6B7280;">—</td>
          <td style="${TD_BASE}"></td>
        </tr>
        <tr style="background:#f0fdf4;">
          <td style="${TD_BASE}font-weight:600;color:#15803d;">
            Promotional discount
            <span style="margin-left:6px;font-size:0.8em;font-family:monospace;background:#dcfce7;color:#15803d;border:1px solid #86efac;border-radius:4px;padding:1px 5px;">${coupon.code}</span>
          </td>
          <td style="${TD_BASE}text-align:right;font-weight:700;color:#15803d;">−$${coupon.discountAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
          <td style="${TD_BASE}"></td>
        </tr>
        <tr style="background:#F7F9FC;">
          <td style="${TD_BASE}font-weight:700;color:#0A2540;">Total due at checkout</td>
          <td style="${TD_BASE}text-align:right;font-weight:800;color:#0078D4;font-size:1.05em;">$${coupon.discountedTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
          <td style="${TD_BASE}"></td>
        </tr>
        ` : ""}
      </tbody>
    </table>

    <h3 style="${HEADING_STYLE}">2. ${isFree ? "Complimentary Service" : "Fees &amp; Payment"}</h3>
    ${isFree
      ? `<p style="${PARA_STYLE}">This is a complimentary service provided at no charge. No payment is required. Shane McCaw Consulting LLC reserves the right to modify or withdraw complimentary offers at any time without prior notice.</p>`
      : `${hasOneTime ? `<p style="${PARA_STYLE}">One-time services are payable in full at checkout before work commences. No additional charges will be incurred for the standard deliverables listed above.</p>` : ""}
    ${hasRecurring ? `<p style="${PARA_STYLE}">Monthly retainer services are billed at the stated monthly rate, payable in advance on a recurring monthly basis. Either party may cancel a monthly subscription with 30 days written notice. Cancellation takes effect at the end of the current billing period.</p>` : ""}
    <p style="${PARA_STYLE}">No refunds will be issued for one-time services once work has commenced. Monthly retainer fees for the current period are non-refundable on cancellation.</p>`
    }

    <h3 style="${HEADING_STYLE}">3. Scope</h3>
    <p style="${PARA_STYLE}">This agreement covers only the deliverables specified in Section 1. Any additional work beyond this scope must be agreed in writing and may be subject to additional fees.</p>

    <h3 style="${HEADING_STYLE}">4. Delivery</h3>
    ${isFree
      ? `<p style="${PARA_STYLE}">Consultant will deliver the agreed outputs automatically upon execution of this agreement and receipt of any required access or information from Client. Delivery is initiated immediately after signing.</p>`
      : `<p style="${PARA_STYLE}">For one-time services, Consultant will deliver the agreed outputs within the stated turnaround period after receipt of payment and any required access or information from Client. Work will not commence until both payment is confirmed and all necessary access has been granted. For monthly retainers, Consultant will perform the described ongoing services throughout each billing period.</p>`
    }

    <h3 style="${HEADING_STYLE}">5. Revisions (One-Time Services)</h3>
    <p style="${PARA_STYLE}">One round of revisions is included within the scope of each one-time service. Additional revisions are available at Consultant's standard hourly rate.</p>

    <h3 style="${HEADING_STYLE}">6. Confidentiality</h3>
    <p style="${PARA_STYLE}">Each party agrees to keep the other party's confidential information confidential and not to disclose it to any third party without prior written consent. This obligation survives termination of this agreement.</p>

    <h3 style="${HEADING_STYLE}">7. Intellectual Property</h3>
    <p style="${PARA_STYLE}">${isFree
      ? "Upon execution of this agreement, all deliverables produced by Consultant for Client under this agreement become the sole property of Client."
      : "Upon receipt of full payment (or, for ongoing retainers, upon payment for the relevant billing period), all deliverables produced by Consultant for Client under this agreement become the sole property of Client."
    }</p>

    <h3 style="${HEADING_STYLE}">8. Limitation of Liability</h3>
    <p style="${PARA_STYLE}">${isFree
      ? "Consultant's total liability under this agreement shall not exceed $100. Consultant is not liable for any indirect, incidental, or consequential damages."
      : "Consultant's total liability under this agreement shall not exceed the total fees paid in the 12 months prior to any claim. Consultant is not liable for any indirect, incidental, or consequential damages."
    }</p>

    <h3 style="${HEADING_STYLE}">9. Independent Contractor</h3>
    <p style="${PARA_STYLE}">Consultant is an independent contractor and not an employee of Client. Nothing in this agreement shall create any partnership, joint venture, agency, franchise, or employment relationship between the parties.</p>

    <h3 style="${HEADING_STYLE}">10. Governing Law</h3>
    <p style="${PARA_STYLE}">This agreement is governed by the laws of the State of Virginia, United States. Any disputes shall be resolved in the courts of Virginia.</p>

    <h3 style="${HEADING_STYLE}">11. Entire Agreement</h3>
    <p style="${PARA_STYLE}">This document constitutes the entire agreement between the parties with respect to this engagement and supersedes all prior discussions and representations. Amendments must be made in writing.</p>

    ${requiredPermissions && requiredPermissions.length > 0 ? `
    <h3 style="${HEADING_STYLE}">${coupon?.code === "TESTIMONIAL" ? "13" : "12"}. App Registration Permissions</h3>
    <p style="${PARA_STYLE}">To enable automated Microsoft 365 management, Client agrees to grant the following Application permissions (not Delegated) in an Azure AD App Registration and to click "Grant admin consent" in the Azure portal before work commences on automated deliverables. These permissions are required for Consultant's scripts and automation to operate on Client's tenant.</p>
    <table style="width:100%;border-collapse:collapse;margin:8px 0 12px 0;font-size:0.85em;">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px 10px;background:#0A2540;color:#fff;border-radius:4px 0 0 4px;">Permission Scope</th>
          <th style="text-align:left;padding:6px 10px;background:#0A2540;color:#fff;border-radius:0 4px 4px 0;">Purpose</th>
        </tr>
      </thead>
      <tbody>
        ${requiredPermissions.map((p, i) => `
        <tr style="${i % 2 === 1 ? "background:#F7F9FC;" : ""}">
          <td style="padding:5px 10px;font-family:monospace;font-weight:600;color:#0078D4;white-space:nowrap;">${p.scope}</td>
          <td style="padding:5px 10px;color:#6B7280;">${p.reason || "—"}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    ` : ""}
    ${coupon?.code === "TESTIMONIAL" ? `
    <h3 style="${HEADING_STYLE}">12. Testimonial</h3>
    <p style="${PARA_STYLE}">Upon satisfactory completion of the services described herein, Client agrees to provide Consultant with a brief written testimonial or case study (2–5 sentences) describing the results achieved. Client grants Consultant the non-exclusive right to publish this testimonial on Consultant's website and marketing materials, attributed to Client's name and company unless Client requests anonymity in writing. Consultant agrees not to alter the substance of the testimonial without Client's prior approval.</p>
    ` : ""}
  `;
}

function readGuestInfo(): { name: string; email: string; company: string } {
  try {
    const raw = sessionStorage.getItem("onboardingGuest");
    if (!raw) return { name: "", email: "", company: "" };
    const parsed = JSON.parse(raw) as { name?: string; email?: string; company?: string };
    return { name: parsed.name ?? "", email: parsed.email ?? "", company: parsed.company ?? "" };
  } catch { return { name: "", email: "", company: "" }; }
}

export default function OnboardingContract() {
  const { user, fetchWithAuth, accessToken } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);

  const serviceIdsParam = params.get("serviceIds") ?? params.get("serviceId") ?? "";
  const serviceIds = serviceIdsParam
    .split(",")
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n) && n > 0);

  // Load wizard selections from sessionStorage (set by OnboardingSelect after wizard review step)
  // These are WizardSelection[] (with priceAdjustment info) keyed by serviceId string
  const wizardSelectionsData: Record<string, WizardSelection[]> = JSON.parse(
    sessionStorage.getItem("wizardSelections") ?? "{}"
  );

  // Guest info (used when user is not logged in)
  const guestInfo = readGuestInfo();

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [signerName, setSignerName] = useState(user?.name ?? guestInfo.name ?? user?.email?.split("@")[0] ?? "");
  const [company, setCompany] = useState(user?.company ?? guestInfo.company ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [street, setStreet] = useState(user?.address ?? "");
  const [city, setCity] = useState(user?.addressCity ?? "");
  const [addrState, setAddrState] = useState(user?.addressState ?? "");
  const [zip, setZip] = useState(user?.addressZip ?? "");
  const [agreed, setAgreed] = useState(false);
  const [appRegAgreed, setAppRegAgreed] = useState(false);
  const [requiredPermissions, setRequiredPermissions] = useState<{ scope: string; reason: string }[]>([]);
  const [signed, setSigned] = useState(false);
  const [stripeError, setStripeError] = useState("");
  const [hasScrolled, setHasScrolled] = useState(false);

  const [offerAvailable, setOfferAvailable] = useState<boolean | null>(null);
  const [lpTokenExpired, setLpTokenExpired] = useState(false);
  const [lpTokenMinsLeft, setLpTokenMinsLeft] = useState<number | null>(null);
  const lpUrl = (() => {
    const stored = sessionStorage.getItem("onboardingLpUrl");
    if (stored) return stored;
    const slug = sessionStorage.getItem("onboardingLpSlug");
    if (slug) return `/lp/${slug}`;
    // Fallback: read from localStorage (survives tab-close / session-storage wipe)
    try {
      const latestExpRaw = localStorage.getItem("onboardingLpLatestExp");
      if (latestExpRaw) {
        const lsKey = `onboardingLp_${latestExpRaw}`;
        const raw = localStorage.getItem(lsKey);
        if (raw) {
          const data = JSON.parse(raw) as { slug?: string; lpUrl?: string; exp?: number };
          if (typeof data.exp === "number" && Date.now() > data.exp * 1000) {
            // Expired — prune and return nothing
            localStorage.removeItem(lsKey);
            localStorage.removeItem("onboardingLpLatestExp");
            return null;
          }
          return data.lpUrl ?? (data.slug ? `/lp/${data.slug}` : null);
        }
      }
    } catch { /* localStorage unavailable — ignore */ }
    return null;
  })();

  const [couponOpen, setCouponOpen] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discountType: string;
    discountValue: string;
    discountAmount: number;
    discountedTotal: number;
  } | null>(null);

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
    // No auth check — guests can reach the contract page; account is created at signing time

    const servicesReq = fetch("/api/portal/onboarding/services")
      .then(r => r.json() as Promise<Service[]>)
      .then(async all => {
        // Match as many as possible from the public list
        let matched = serviceIds.map(id => all.find(s => s.id === id)).filter(Boolean) as Service[];
        // For any IDs not in the public list (e.g. landing_page_only services),
        // fetch them individually using the single-service endpoint
        const missingIds = serviceIds.filter(id => !matched.find(s => s.id === id));
        if (missingIds.length > 0) {
          const extras = await Promise.all(
            missingIds.map(id =>
              fetch(`/api/portal/onboarding/service/${id}`)
                .then(r => r.ok ? (r.json() as Promise<Service>) : null)
                .catch(() => null)
            )
          );
          matched = [...matched, ...(extras.filter(Boolean) as Service[])];
          // Re-sort to match the original serviceIds order
          matched.sort((a, b) => serviceIds.indexOf(a.id) - serviceIds.indexOf(b.id));
        }
        if (matched.length === 0) { setLocation("/portal/onboarding/select"); return; }
        setServices(matched);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch("/api/portal/coupons/available/TESTIMONIAL")
      .then(r => r.json() as Promise<{ available: boolean }>)
      .then(d => setOfferAvailable(d.available))
      .catch(() => setOfferAvailable(false));

    // Fetch aggregated required permissions for these services (public endpoint, no auth needed with ?serviceIds=)
    if (serviceIds.length > 0) {
      fetch(`/api/portal/required-permissions?serviceIds=${serviceIds.join(",")}`)
        .then(r => r.ok ? r.json() as Promise<{ permissions: { scope: string; reason: string }[] }> : null)
        .then(d => { if (d?.permissions?.length) setRequiredPermissions(d.permissions); })
        .catch(() => { /* silently ignore — permissions section just won't appear */ });
    }

    // Only fetch profile if logged in
    if (user) {
      void fetchWithAuth("/api/portal/profile")
        .then(r => r.ok ? r.json() as Promise<{
          name?: string | null; company?: string | null; phone?: string | null;
          address?: string | null; addressCity?: string | null;
          addressState?: string | null; addressZip?: string | null;
        }> : null)
        .then(profile => {
          if (!profile) return;
          if (profile.name) setSignerName(profile.name);
          if (profile.company) setCompany(profile.company);
          if (profile.phone) setPhone(profile.phone);
          if (profile.address) setStreet(profile.address);
          if (profile.addressCity) setCity(profile.addressCity);
          if (profile.addressState) setAddrState(profile.addressState);
          if (profile.addressZip) setZip(profile.addressZip);
        })
        .catch(() => { /* silently ignore */ });
    }

    void servicesReq;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countdown timer for LP token expiry warning
  useEffect(() => {
    const expRaw = sessionStorage.getItem("onboardingLpTokenExp");
    if (!expRaw) return; // No LP token — no countdown needed

    const computeMins = () => {
      const expMs = Number(expRaw) * 1000;
      const diffMs = expMs - Date.now();
      return Math.ceil(diffMs / 60000);
    };

    const tick = () => {
      const mins = computeMins();
      if (mins <= 0) {
        setLpTokenMinsLeft(0);
        setLpTokenExpired(true);
      } else if (mins <= 30) {
        setLpTokenMinsLeft(mins);
      } else {
        setLpTokenMinsLeft(null);
      }
    };

    tick(); // run immediately
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!street.trim() || !city.trim() || !addrState.trim() || !zip.trim() || !phone.trim()) {
      setError("Please fill in all required fields: street address, city, state, ZIP, and phone.");
      return;
    }
    if (!agreed) { setError("Please confirm you have read and agree to the terms."); return; }
    if (requiredPermissions.length > 0 && !appRegAgreed) { setError("Please confirm you will configure the required Azure AD App Registration permissions."); return; }
    if (!signed || !hasDrawn.current) { setError("Please draw your signature in the box above."); return; }

    setError("");
    setSubmitting(true);

    try {
      // Check LP token expiry before making any API calls
      const lpTokenRaw = sessionStorage.getItem("onboardingLpToken");
      const lpTokenExpRaw = sessionStorage.getItem("onboardingLpTokenExp");
      if (lpTokenRaw && lpTokenExpRaw) {
        const expMs = Number(lpTokenExpRaw) * 1000;
        if (Date.now() > expMs) {
          setLpTokenExpired(true);
          setSubmitting(false);
          return;
        }
      }

      // Save profile fields — only if logged in
      if (user) {
        await fetchWithAuth("/api/portal/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: signerName, company, phone, address: street, addressCity: city, addressState: addrState, addressZip: zip }),
        });
      }

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

      // Auth header for contract call (logged-in users only; guests use guestEmail body field)
      const contractAuthHeader: Record<string, string> = {};
      if (accessToken) {
        contractAuthHeader["Authorization"] = `Bearer ${accessToken}`;
      }

      const contractRes = await fetch("/api/portal/onboarding/contract", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...contractAuthHeader },
        body: JSON.stringify({
          serviceIds: services.map(s => s.id),
          signatureData,
          signerName,
          wizardSelections: Object.keys(wizardSelectionsInput).length > 0 ? wizardSelectionsInput : undefined,
          couponCode: appliedCoupon?.code ?? undefined,
          appRegPermissionsAgreed: requiredPermissions.length > 0 ? appRegAgreed : false,
          // Pass guest info when not logged in — address is saved to their profile at signing time
          ...(!user ? {
            guestEmail: guestInfo.email,
            guestName: guestInfo.name || signerName,
            guestCompany: company || undefined,
            guestPhone: phone || undefined,
            guestAddress: street || undefined,
            guestCity: city || undefined,
            guestState: addrState || undefined,
            guestZip: zip || undefined,
          } : {}),
        }),
      });
      if (!contractRes.ok) {
        const err = await contractRes.json() as { error: string };
        throw new Error(err.error ?? "Failed to save contract");
      }
      const contractData = await contractRes.json() as { contractIds: number[] };
      const contractIds = contractData.contractIds;

      // Checkout is now public; logged-in users pass JWT, guests pass guestEmail in body
      const checkoutAuthHeader: Record<string, string> = {};
      if (accessToken) checkoutAuthHeader["Authorization"] = `Bearer ${accessToken}`;

      const storedLpToken = sessionStorage.getItem("onboardingLpToken") ?? undefined;
      const checkoutRes = await fetch("/api/portal/checkout/create-session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...checkoutAuthHeader },
        body: JSON.stringify({
          serviceIds: services.map(s => s.id),
          contractIds,
          returnUrl: window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, ""),
          ...(appliedCoupon ? { couponCode: appliedCoupon.code } : {}),
          ...(!user ? { guestEmail: guestInfo.email } : {}),
          ...(storedLpToken ? { lpToken: storedLpToken } : {}),
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
        // Clean up localStorage back-link entries so stale data doesn't
        // surface on a future visit from a different landing page.
        try {
          const latestExpRaw = localStorage.getItem("onboardingLpLatestExp");
          if (latestExpRaw) {
            localStorage.removeItem(`onboardingLp_${latestExpRaw}`);
          }
          localStorage.removeItem("onboardingLpLatestExp");
        } catch { /* localStorage unavailable — ignore */ }
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

  const handleApplyCoupon = async () => {
    if (!couponInput.trim()) return;
    setCouponError("");
    setCouponLoading(true);
    const cartTotal = services.reduce((sum, s) => sum + getDisplayPrice(s), 0);
    try {
      const res = await fetch("/api/portal/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponInput.trim(), cartTotal }),
      });
      const data = await res.json() as { error?: string; code?: string; discountType?: string; discountValue?: string; discountAmount?: number; discountedTotal?: number };
      if (!res.ok) {
        setCouponError(data.error ?? "Invalid coupon code");
        return;
      }
      setAppliedCoupon({
        code: data.code!,
        discountType: data.discountType!,
        discountValue: data.discountValue!,
        discountAmount: data.discountAmount!,
        discountedTotal: data.discountedTotal!,
      });
      setCouponInput("");
    } catch {
      setCouponError("Could not validate coupon. Please try again.");
    } finally {
      setCouponLoading(false);
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
  const isFree = oneTimeTotal === 0 && monthlyTotal === 0;

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
            <span>{isFree ? "3. Confirm" : "3. Pay & confirm"}</span>
          </div>
        </div>
      </div>

      {lpTokenMinsLeft !== null && lpTokenMinsLeft > 0 && (
        <div className="bg-amber-50 border-b border-amber-300">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              <span className="font-semibold">Your access link expires in ~{lpTokenMinsLeft} {lpTokenMinsLeft === 1 ? "minute" : "minutes"}</span>
              {" — "}please complete checkout soon to avoid losing your progress.
            </p>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="bg-white border border-border rounded-xl px-5 py-4 mb-6">
          <p className="text-xs text-muted-foreground mb-3">{isFree ? "You're claiming" : "You're purchasing"}</p>
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
                    {isFree
                      ? <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">Free</span>
                      : <span className="font-bold text-[#0078D4] text-sm">{displayPrice}</span>
                    }
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
            <div className="border-t border-border mt-3 pt-3">
              <div className="flex flex-wrap gap-4">
                {oneTimeTotal > 0 && (
                  <div>
                    <span className="text-xs text-muted-foreground">One-time: </span>
                    {appliedCoupon ? (
                      <>
                        <span className="text-sm font-bold text-[#0A2540] line-through opacity-50">${oneTimeTotal.toLocaleString("en-US")}</span>
                        <span className="text-sm font-bold text-emerald-700 ml-1.5">
                          ${Math.max(0, oneTimeTotal - appliedCoupon.discountAmount * (oneTimeTotal / (oneTimeTotal + monthlyTotal || 1))).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm font-bold text-[#0A2540]">${oneTimeTotal.toLocaleString("en-US")}</span>
                    )}
                  </div>
                )}
                {monthlyTotal > 0 && (
                  <div>
                    <span className="text-xs text-muted-foreground">Monthly: </span>
                    {appliedCoupon ? (
                      <>
                        <span className="text-sm font-bold text-emerald-700 line-through opacity-50">${monthlyTotal.toLocaleString("en-US")}/mo</span>
                        <span className="text-sm font-bold text-emerald-700 ml-1.5">
                          ${Math.max(0, monthlyTotal - appliedCoupon.discountAmount * (monthlyTotal / (oneTimeTotal + monthlyTotal || 1))).toLocaleString("en-US", { maximumFractionDigits: 2 })}/mo
                        </span>
                      </>
                    ) : (
                      <span className="text-sm font-bold text-emerald-700">${monthlyTotal.toLocaleString("en-US")}/mo</span>
                    )}
                  </div>
                )}
                {appliedCoupon && (
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
                    <Check className="w-3 h-3" />
                    {appliedCoupon.code}: −${appliedCoupon.discountAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    <button
                      onClick={() => setAppliedCoupon(null)}
                      className="ml-0.5 text-emerald-500 hover:text-red-500 transition-colors"
                      title="Remove coupon"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* Early Client Offer banner — visible while the TESTIMONIAL coupon is valid in the DB, hidden for free services */}
              {offerAvailable && !isFree && (
                <div className="mt-3 rounded-lg border border-[#0078D4]/40 bg-[#0078D4]/5 px-4 py-3">
                  <p className="text-sm font-semibold text-[#0A2540] mb-1">Early Client Offer</p>
                  <p className="text-sm text-muted-foreground mb-2.5">
                    Early clients receive 10% off any entry-point engagement — saving $300 or more — in exchange for a short written testimonial or case study after project completion.
                  </p>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0078D4] px-3 py-1 text-xs font-bold text-white tracking-wide">
                    <Tag className="w-3.5 h-3.5" />
                    TESTIMONIAL — 10% off, save $300+
                  </span>
                </div>
              )}

              {/* Promo code toggle — hidden when all services are free */}
              {!appliedCoupon && (oneTimeTotal + monthlyTotal) > 0 && (
                <div className="mt-3">
                  <button
                    onClick={() => { setCouponOpen(o => !o); setCouponError(""); }}
                    className="flex items-center gap-1.5 text-xs text-[#0078D4] hover:underline font-medium"
                  >
                    <Tag className="w-3 h-3" />
                    Have a promo code?
                    <ChevronDown className={`w-3 h-3 transition-transform ${couponOpen ? "rotate-180" : ""}`} />
                  </button>
                  {couponOpen && (
                    <div className="mt-2 flex items-stretch gap-2">
                      <input
                        type="text"
                        value={couponInput}
                        onChange={e => { setCouponInput(e.target.value.toUpperCase()); setCouponError(""); }}
                        onKeyDown={e => { if (e.key === "Enter") void handleApplyCoupon(); }}
                        placeholder="PROMO CODE"
                        className="flex-1 border border-border rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                      />
                      <button
                        onClick={() => void handleApplyCoupon()}
                        disabled={couponLoading || !couponInput.trim()}
                        className="flex items-center gap-1.5 bg-[#0078D4] text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[#005A9E] disabled:opacity-50 transition-colors"
                      >
                        {couponLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Apply"}
                      </button>
                    </div>
                  )}
                  {couponError && (
                    <p className="text-xs text-red-600 mt-1.5">{couponError}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-6 md:items-start">
          <div className="bg-white border border-border rounded-2xl overflow-hidden flex flex-col md:sticky md:top-6">
            <div className="px-5 py-4 border-b border-border bg-[#F7F9FC] shrink-0">
              <h2 className="font-bold text-[#0A2540] text-sm">Service Agreement</h2>
              <p className="text-xs text-muted-foreground">Please read before signing</p>
            </div>
            {!hasScrolled && (
              <div className="px-5 pt-3 pb-0 shrink-0">
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ↓ Scroll to the bottom to read the full agreement before signing
                </p>
              </div>
            )}
            <div
              ref={contractScrollRef}
              onScroll={handleContractScroll}
              className="px-5 py-4 prose prose-sm overflow-y-auto text-[#0A2540]" style={{ maxHeight: "calc(100vh - 220px)" }}
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
                {
                  company,

                  address: [street, city && addrState ? `${city}, ${addrState}` : city || addrState, zip].filter(Boolean).join(" "),
                  phone,
                  email: user?.email ?? guestInfo.email,
                },
                appliedCoupon,
                isFree,
                requiredPermissions.length > 0 ? requiredPermissions : undefined,
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
                <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">Street address <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={street}
                  onChange={e => setStreet(e.target.value)}
                  placeholder="123 Main St"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">City <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={city}
                    onChange={e => setCity(e.target.value)}
                    placeholder="Springfield"
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">State <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={addrState}
                    onChange={e => setAddrState(e.target.value)}
                    placeholder="VA"
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">ZIP code <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={zip}
                  onChange={e => setZip(e.target.value)}
                  placeholder="22150"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">Phone number <span className="text-red-500">*</span></label>
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
                  {isFree
                    ? "I have read and agree to the Service Agreement above. I understand this is a complimentary automated service delivered upon signing."
                    : "I have read and agree to the Service Agreement above. I understand that payment is required before work commences, and fees are non-refundable once work has begun."
                  }
                  {!hasScrolled && <span className="block text-xs text-muted-foreground mt-1">Please scroll through the full agreement first.</span>}
                </span>
              </label>
            </div>

            {requiredPermissions.length > 0 && (
              <div className={`bg-white border rounded-2xl p-5 transition-opacity ${hasScrolled ? "border-border opacity-100" : "border-border opacity-50"}`}>
                <label className={`flex items-start gap-3 ${hasScrolled ? "cursor-pointer" : "cursor-not-allowed"}`}>
                  <input
                    type="checkbox"
                    checked={appRegAgreed}
                    disabled={!hasScrolled}
                    onChange={e => setAppRegAgreed(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-[#0078D4] disabled:opacity-50"
                  />
                  <span className="text-sm text-[#0A2540]">
                    I understand that the {requiredPermissions.length} Azure AD App Registration permission{requiredPermissions.length !== 1 ? "s" : ""} listed in Section 12 of this agreement must be granted in my tenant before automated deliverables can be activated. I agree to configure these permissions and grant admin consent in the Azure portal.
                    {!hasScrolled && <span className="block text-xs text-muted-foreground mt-1">Please scroll through the full agreement first.</span>}
                  </span>
                </label>
              </div>
            )}

            {lpTokenExpired && (
              <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl px-4 py-4 text-sm">
                <p className="font-semibold mb-1">Your access link has expired</p>
                <p className="mb-3 text-amber-800">This offer link is only valid for 24 hours. Please return to the landing page and click the button again to get a fresh link.</p>
                {lpUrl ? (
                  <a
                    href={lpUrl}
                    onClick={() => {
                      try {
                        const latestExpRaw = localStorage.getItem("onboardingLpLatestExp");
                        if (latestExpRaw) {
                          localStorage.removeItem(`onboardingLp_${latestExpRaw}`);
                        }
                        localStorage.removeItem("onboardingLpLatestExp");
                      } catch { /* localStorage unavailable — ignore */ }
                    }}
                    className="inline-flex items-center gap-1.5 bg-amber-700 hover:bg-amber-800 text-white font-semibold px-4 py-2 rounded-lg text-xs transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Return to landing page
                  </a>
                ) : (
                  <button
                    onClick={() => window.history.back()}
                    className="inline-flex items-center gap-1.5 bg-amber-700 hover:bg-amber-800 text-white font-semibold px-4 py-2 rounded-lg text-xs transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Go back
                  </button>
                )}
              </div>
            )}

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
                disabled={submitting || lpTokenExpired || !agreed || !signed || !signerName.trim() || !street.trim() || !city.trim() || !addrState.trim() || !zip.trim() || !phone.trim()}
                className="flex-1 flex items-center justify-center gap-2 bg-[#0078D4] text-white font-semibold px-5 py-3 rounded-xl hover:bg-[#005A9E] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                ) : isFree ? (
                  <>Sign & Get Free Access <ArrowRight className="w-4 h-4" /></>
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
