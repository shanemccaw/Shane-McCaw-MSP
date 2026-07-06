import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useConfetti } from "@/hooks/useConfetti";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Calendar, ChevronLeft, Loader2, ExternalLink, Download, FileText, Receipt, CreditCard, CheckCircle2, Clock } from "lucide-react";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface SowPhase {
  id: string;
  title: string;
  price: number;
  deliveryDate?: string | null;
}

interface Props {
  clientName: string | null;
  projectTitle: string | null;
  onClose: () => void;
  presentationId: number;
  totalPrice: number;
  sowPhases: SowPhase[];
  projectId: number | null;
  shareToken?: string | null;
}

interface Slot {
  startIso: string;
  endIso: string;
  label: string;
}

interface MondayDate {
  dateStr: string;
  label: string;
}

type BuildStepStatus = "completed" | "in_progress" | "pending";
interface BuildStep { label: string; status: BuildStepStatus; }

interface M365Scores {
  security: number;
  compliance: number;
  copilot: number;
  adoption: number;
  composite: number;
}

interface PaymentSummary {
  receiptUrl: string | null;
  invoiceId: number | null;
  invoicePdfPath: string | null;
  contractId: number | null;
  contractPdfPath: string | null;
  paidAt: string | null;
  signerName: string | null;
  signedAt: string | null;
  paymentPlan: string;
  phases: Array<{ id: string; title: string; price: number; deliveryDate: string | null; invoiceStatus: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function boolScore(fields: (boolean | undefined)[]): number {
  if (fields.length === 0) return 0;
  return Math.round((fields.filter(Boolean).length / fields.length) * 100);
}

function computeScores(profile: Record<string, unknown>): M365Scores {
  const v = profile as {
    mfaEnforced?: boolean; conditionalAccessEnabled?: boolean; intuneEnabled?: boolean;
    hasAADP1orP2?: boolean; hasDefender?: boolean; hasDLP?: boolean; usesComplianceCenter?: boolean;
    sensitivityLabelsConfigured?: boolean; hasRetentionPolicies?: boolean; hasInsiderRisk?: boolean;
    hasCopilotLicenses?: boolean; allUsersLicensed?: boolean; activeUserPercent?: string;
  };
  const pct = parseInt(v.activeUserPercent ?? "0", 10);
  const security = boolScore([v.mfaEnforced, v.conditionalAccessEnabled, v.intuneEnabled, v.hasAADP1orP2, v.hasDefender, v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured, v.hasRetentionPolicies]);
  const compliance = boolScore([v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured, v.hasRetentionPolicies, v.hasInsiderRisk]);
  const copilot = boolScore([v.hasCopilotLicenses, v.mfaEnforced, v.sensitivityLabelsConfigured, v.hasDLP, v.hasRetentionPolicies]);
  const adoption = boolScore([v.allUsersLicensed, v.hasCopilotLicenses, pct >= 50, pct >= 75]);
  const composite = Math.round((security + compliance + copilot + adoption) / 4);
  return { security, compliance, copilot, adoption, composite };
}

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function getNextKickoffMondays(n: number): MondayDate[] {
  const result: MondayDate[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1);
  while (result.length < n) {
    if (cursor.getDay() === 1) {
      const yyyy = cursor.getFullYear();
      const mm = String(cursor.getMonth() + 1).padStart(2, "0");
      const dd = String(cursor.getDate()).padStart(2, "0");
      result.push({
        dateStr: `${yyyy}-${mm}-${dd}`,
        label: cursor.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function formatKickoffDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

const INITIAL_BUILD_STEPS: BuildStep[] = [
  { label: "Initializing project",                 status: "completed"   },
  { label: "Provisioning workspace",               status: "in_progress" },
  { label: "Generating reports",                   status: "pending"     },
  { label: "Building governance & security plans", status: "pending"     },
  { label: "Finalizing environment",               status: "pending"     },
  { label: "Preparing your dashboard",             status: "pending"     },
];

function advanceBuildSteps(steps: BuildStep[]): BuildStep[] {
  const next = [...steps];
  const inProg = next.findIndex(s => s.status === "in_progress");
  if (inProg !== -1) next[inProg] = { ...next[inProg], status: "completed" };
  const nextPending = next.findIndex(s => s.status === "pending");
  if (nextPending !== -1) next[nextPending] = { ...next[nextPending], status: "in_progress" };
  return next;
}

function completeAllBuildSteps(steps: BuildStep[]): BuildStep[] {
  return steps.map(s => ({ ...s, status: "completed" as const }));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AnimatedCheckmark() {
  return (
    <div className="flex items-center justify-center w-14 h-14 rounded-full bg-emerald-50 border-2 border-emerald-200">
      <svg className="w-7 h-7 text-emerald-500" viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="26" cy="26" r="24" stroke="currentColor" strokeWidth={3} opacity={0.2} />
        <path d="M14 27l9 9 16-18" style={{ strokeDasharray: 40, strokeDashoffset: 0, animation: "checkDraw 0.5s ease-out 0.15s both" }} />
      </svg>
      <style>{`@keyframes checkDraw { from { stroke-dashoffset: 40; } to { stroke-dashoffset: 0; } }`}</style>
    </div>
  );
}

function StatusBadge({ status }: { status: BuildStepStatus }) {
  if (status === "completed") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap">✓ Done</span>
  );
  if (status === "in_progress") return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700 border border-blue-200 whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />Active
    </span>
  );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-400 border border-slate-200 whitespace-nowrap">Pending</span>
  );
}

function PhaseBadge({ status }: { status: string }) {
  if (status === "paid") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap">
      <CheckCircle2 className="w-3 h-3" />Paid
    </span>
  );
  if (status === "overdue") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700 border border-red-200 whitespace-nowrap">
      <Clock className="w-3 h-3" />Overdue
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700 border border-blue-200 whitespace-nowrap">
      <Clock className="w-3 h-3" />Upcoming
    </span>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(0,120,212,0.08)" }}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: "#0078D4" }}>{label}</p>
        <p className="text-lg font-bold leading-tight" style={{ color: "#0A2540" }}>{value}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color: "#64748b" }}>{sub}</p>}
      </div>
    </div>
  );
}

function ScoreBar({ label, score, loading }: { label: string; score: number; loading: boolean }) {
  const color = score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-medium" style={{ color: "#0A2540" }}>{label}</span>
        {loading ? (
          <span className="w-8 h-3 rounded bg-slate-200 animate-pulse" />
        ) : (
          <span className="text-xs font-bold" style={{ color }}>{score}%</span>
        )}
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        {!loading && (
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score}%`, backgroundColor: color }} />
        )}
        {loading && <div className="h-full w-1/3 rounded-full bg-slate-200 animate-pulse" />}
      </div>
    </div>
  );
}

// ─── Card shell ───────────────────────────────────────────────────────────────

function Card({ title, icon, children, className }: { title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden ${className ?? ""}`}>
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        {icon && <div className="w-5 h-5 flex items-center justify-center flex-shrink-0" style={{ color: "#0078D4" }}>{icon}</div>}
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#0078D4" }}>{title}</p>
      </div>
      <div className="px-5 py-4">
        {children}
      </div>
    </div>
  );
}

function SkeletonLine({ w }: { w?: string }) {
  return <div className={`h-4 rounded bg-slate-100 animate-pulse ${w ?? "w-full"}`} />;
}

// ─── Kickoff Calendar Picker ──────────────────────────────────────────────────

const bookingSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Enter a valid email"),
  topic: z.string().min(1, "Please describe your agenda").max(300, "Max 300 characters"),
});
type BookingForm = z.infer<typeof bookingSchema>;

function KickoffCalendarPicker({ prefillName, prefillEmail }: { prefillName: string; prefillEmail: string }) {
  const mondays = getNextKickoffMondays(3);
  const [selectedMonday, setSelectedMonday] = useState<MondayDate>(mondays[0]!);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [booked, setBooked] = useState(false);
  const [bookedLabel, setBookedLabel] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors, isSubmitting }, setValue } = useForm<BookingForm>({
    resolver: zodResolver(bookingSchema),
    defaultValues: { name: prefillName, email: prefillEmail, topic: "Kickoff call for my Microsoft 365 engagement" },
  });

  useEffect(() => { if (prefillName) setValue("name", prefillName); }, [prefillName, setValue]);
  useEffect(() => { if (prefillEmail) setValue("email", prefillEmail); }, [prefillEmail, setValue]);

  const fetchSlots = useCallback(async (monday: MondayDate) => {
    setSlotsLoading(true);
    setSlotsError(null);
    setSlots([]);
    setSelectedSlot(null);
    try {
      const r = await fetch(`/api/booking/slots?date=${monday.dateStr}`);
      const d = await r.json() as { slots?: Slot[]; error?: string };
      if (!r.ok) setSlotsError(d.error ?? "Failed to load slots.");
      else setSlots(d.slots ?? []);
    } catch {
      setSlotsError("Could not connect. Please try again.");
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  useEffect(() => { void fetchSlots(mondays[0]!); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectMonday = (m: MondayDate) => { setSelectedMonday(m); void fetchSlots(m); };

  const onSubmit = async (data: BookingForm) => {
    if (!selectedSlot) return;
    setSubmitError(null);
    try {
      const r = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, startIso: selectedSlot.startIso, endIso: selectedSlot.endIso }),
      });
      const d = await r.json() as { ok?: boolean; slotLabel?: string; error?: string };
      if (!r.ok) { setSubmitError(d.error ?? "Something went wrong."); return; }
      setBookedLabel(d.slotLabel ?? selectedSlot.label);
      setBooked(true);
    } catch {
      setSubmitError("Network error. Please try again.");
    }
  };

  if (booked) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center">
          <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="font-bold text-sm" style={{ color: "#0A2540" }}>Kickoff call booked!</p>
        <p className="text-xs" style={{ color: "#64748b" }}>{bookedLabel}</p>
        <p className="text-xs" style={{ color: "#94a3b8" }}>Check your inbox for the calendar invite.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {mondays.map(m => (
          <button
            key={m.dateStr}
            onClick={() => handleSelectMonday(m)}
            className={`flex-1 rounded-lg border py-2 px-1 text-xs font-semibold transition-all text-center ${
              selectedMonday.dateStr === m.dateStr
                ? "border-[#0078D4] bg-[#0078D4]/8 text-[#0078D4]"
                : "border-slate-200 bg-white text-slate-600 hover:border-[#0078D4]/50"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {slotsLoading && (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-9 rounded-lg bg-slate-100 animate-pulse" />)}
        </div>
      )}
      {slotsError && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">{slotsError}</div>
      )}
      {!slotsLoading && !slotsError && slots.length === 0 && (
        <p className="text-xs text-center py-4" style={{ color: "#94a3b8" }}>No availability this Monday — try another.</p>
      )}
      {!slotsLoading && !slotsError && slots.length > 0 && !selectedSlot && (
        <div className="grid grid-cols-3 gap-2">
          {slots.map(s => (
            <button
              key={s.startIso}
              onClick={() => setSelectedSlot(s)}
              className="rounded-lg border border-slate-200 bg-white hover:border-[#0078D4] hover:bg-[#0078D4]/5 transition-colors py-2 text-xs font-medium text-center"
              style={{ color: "#0A2540" }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {selectedSlot && (
        <div>
          <div className="flex items-center gap-2 rounded-lg border border-[#0078D4]/20 bg-[#0078D4]/5 px-3 py-2 mb-3">
            <Calendar className="w-4 h-4 flex-shrink-0" style={{ color: "#0078D4" }} />
            <div className="min-w-0">
              <p className="text-xs font-semibold" style={{ color: "#0A2540" }}>{selectedMonday.label} · {selectedSlot.label} ET</p>
              <p className="text-[11px]" style={{ color: "#64748b" }}>30 min · Microsoft Teams</p>
            </div>
            <button onClick={() => setSelectedSlot(null)} className="ml-auto">
              <ChevronLeft className="w-4 h-4" style={{ color: "#94a3b8" }} />
            </button>
          </div>
          <form onSubmit={(e) => { void handleSubmit(onSubmit)(e); }} className="flex flex-col gap-3">
            <div>
              <input {...register("name")} placeholder="Full name" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4]" />
              {errors.name && <p className="text-[11px] text-rose-500 mt-0.5">{errors.name.message}</p>}
            </div>
            <div>
              <input {...register("email")} type="email" placeholder="Work email" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4]" />
              {errors.email && <p className="text-[11px] text-rose-500 mt-0.5">{errors.email.message}</p>}
            </div>
            <div>
              <textarea {...register("topic")} rows={2} maxLength={300} placeholder="Agenda / key topics" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] resize-none" />
              {errors.topic && <p className="text-[11px] text-rose-500 mt-0.5">{errors.topic.message}</p>}
            </div>
            {submitError && <p className="text-[11px] text-rose-500">{submitError}</p>}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-60"
              style={{ background: "linear-gradient(135deg,#0078D4,#00B4D8)" }}
            >
              {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" />Confirming…</> : "Confirm kickoff call"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ConfirmationStep({
  clientName,
  projectTitle,
  onClose,
  presentationId,
  totalPrice,
  sowPhases,
  projectId: initialProjectId,
  shareToken,
}: Props) {
  const { accessToken, user } = useAuth();
  const [, navigate] = useLocation();
  const { fireSidecannons } = useConfetti();

  const [projectId, setProjectId] = useState<number | null>(initialProjectId);
  const [ctaReady, setCtaReady] = useState(initialProjectId !== null);
  const [buildSteps, setBuildSteps] = useState<BuildStep[]>(INITIAL_BUILD_STEPS);
  const [scores, setScores] = useState<M365Scores | null>(null);
  const [scoresLoading, setScoresLoading] = useState(true);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const lastSseRef = useRef<number>(Date.now());
  const heuristicRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const firstName = clientName ? clientName.split(" ")[0] : null;

  const kickoffDate = (() => {
    const mondays = getNextKickoffMondays(1);
    if (!mondays[0]) return "";
    const [y, m, d] = mondays[0].dateStr.split("-").map(Number);
    return formatKickoffDate(new Date(y!, m! - 1, d!));
  })();

  // Build fetch function that includes auth token or share token
  const fetchFn = useCallback((url: string, opts: RequestInit = {}) => {
    const headers: Record<string, string> = { ...(opts.headers as Record<string, string> ?? {}) };
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    const tokenParam = shareToken ? `?token=${encodeURIComponent(shareToken)}` : "";
    const separator = url.includes("?") ? "&" : "?";
    const finalUrl = shareToken ? `${url}${url.includes("?") ? separator : "?"}token=${encodeURIComponent(shareToken)}` : url;
    return fetch(finalUrl, { ...opts, headers });
  }, [accessToken, shareToken]);

  // ── Confetti on mount ──────────────────────────────────────────────────────
  useEffect(() => { fireSidecannons(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Payment summary ────────────────────────────────────────────────────────
  useEffect(() => {
    setSummaryLoading(true);
    const authHeaders: Record<string, string> = {};
    if (accessToken) authHeaders["Authorization"] = `Bearer ${accessToken}`;
    const tokenParam = shareToken ? `?token=${encodeURIComponent(shareToken)}` : "";
    fetch(`/api/portal/presentations/${presentationId}/payment-summary${tokenParam}`, { headers: authHeaders })
      .then(r => r.ok ? r.json() as Promise<PaymentSummary> : null)
      .then(s => { if (s) setSummary(s); })
      .catch(() => { /* non-fatal */ })
      .finally(() => setSummaryLoading(false));
  }, [presentationId, accessToken, shareToken]);

  // ── M365 profile → scores ─────────────────────────────────────────────────
  useEffect(() => {
    if (!accessToken) { setScoresLoading(false); return; }
    fetch("/api/portal/m365-profile", { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.ok ? r.json() as Promise<Record<string, unknown>> : null)
      .then(profile => {
        if (profile && Object.keys(profile).length > 0) setScores(computeScores(profile));
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => setScoresLoading(false));
  }, [accessToken]);

  // ── Heuristic step advance (3s fallback when SSE is absent or slow) ───────
  useEffect(() => {
    if (ctaReady) return;
    heuristicRef.current = setInterval(() => {
      const sinceSse = Date.now() - lastSseRef.current;
      if (sinceSse >= 3000) {
        setBuildSteps(prev => {
          const hasMore = prev.some(s => s.status !== "completed");
          return hasMore ? advanceBuildSteps(prev) : prev;
        });
      }
    }, 3000);
    return () => { if (heuristicRef.current) clearInterval(heuristicRef.current); };
  }, [ctaReady]);

  // ── SSE: listen for scope-events (step advance) and project_ready ─────────
  const openSSE = useCallback(() => {
    if (ctaReady) return;
    const params = new URLSearchParams();
    if (accessToken) params.set("jwt", accessToken);
    else if (shareToken) params.set("token", shareToken);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const es = new EventSource(`/api/portal/presentations/${presentationId}/scope-events${qs}`);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as { type?: string; projectId?: number };
        lastSseRef.current = Date.now();
        if (msg.type === "project_ready" && msg.projectId) {
          setProjectId(msg.projectId);
          setCtaReady(true);
          setBuildSteps(completeAllBuildSteps);
          es.close();
        } else {
          setBuildSteps(advanceBuildSteps);
        }
      } catch { /* keepalive ping */ }
    };
    es.onerror = () => { es.close(); };
    return () => es.close();
  }, [presentationId, accessToken, shareToken, ctaReady]);

  useEffect(() => { const cleanup = openSSE(); return cleanup; }, [openSSE]);

  // ── Poll once on mount in case project was created before page loaded ─────
  useEffect(() => {
    if (ctaReady || !accessToken) return;
    fetch(`/api/portal/presentations/${presentationId}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.ok ? r.json() : null)
      .then((d: { projectId?: number | null } | null) => {
        if (d?.projectId) { setProjectId(d.projectId); setCtaReady(true); setBuildSteps(completeAllBuildSteps); }
      })
      .catch(() => { /* non-fatal */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGoToProject = () => {
    if (!projectId) return;
    navigate(`/portal/projects/${projectId}`);
    onClose();
  };

  const compositeLabel = scores
    ? scores.composite >= 70 ? "Strong" : scores.composite >= 40 ? "Moderate" : "Needs Work"
    : "—";

  const selectedPhases = sowPhases.filter(p => p.price > 0);
  const sowTotal = selectedPhases.reduce((s, p) => s + p.price, 0) || totalPrice;

  return (
    <div className="flex-1" style={{ backgroundColor: "#F7F9FC" }}>
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-6">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <div className="flex flex-col items-center text-center gap-2 py-2">
          <AnimatedCheckmark />
          <p className="text-[10px] font-bold uppercase tracking-widest mt-1" style={{ color: "#0078D4" }}>Payment Confirmed</p>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight leading-tight" style={{ color: "#0A2540" }}>
            {projectTitle ?? "Your project is being built."}
          </h1>
          {firstName && (
            <p className="text-base font-semibold" style={{ color: "#0078D4" }}>
              Let's go, {firstName}. Your environment transformation starts now.
            </p>
          )}
        </div>

        {/* ── Stat row ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard
            icon={<svg className="w-4 h-4" style={{ color: "#0078D4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
            label="Kickoff Start"
            value={kickoffDate}
            sub="Next Monday"
          />
          <StatCard
            icon={<svg className="w-4 h-4" style={{ color: "#0078D4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>}
            label="Amount Paid"
            value={formatPrice(totalPrice)}
            sub="Total investment"
          />
          <StatCard
            icon={<svg className="w-4 h-4" style={{ color: "#0078D4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>}
            label="M365 Score"
            value={scoresLoading ? "…" : scores ? `${scores.composite}%` : "N/A"}
            sub={scoresLoading ? "Loading…" : scores ? compositeLabel : "No profile yet"}
          />
        </div>

        {/* ── Two-column grid ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* ── Left column ─────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">

            {/* Payment & Receipt */}
            <Card title="Payment & Receipt" icon={<Receipt className="w-4 h-4" />}>
              {summaryLoading ? (
                <div className="flex flex-col gap-3">
                  <SkeletonLine w="w-2/3" />
                  <SkeletonLine w="w-1/2" />
                  <SkeletonLine w="w-3/4" />
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium" style={{ color: "#64748b" }}>Amount paid</span>
                    <span className="text-sm font-bold" style={{ color: "#0A2540" }}>{formatPrice(totalPrice)}</span>
                  </div>
                  {summary?.paidAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium" style={{ color: "#64748b" }}>Date</span>
                      <span className="text-sm font-semibold" style={{ color: "#0A2540" }}>{formatDate(summary.paidAt)}</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-2 pt-1">
                    {summary?.receiptUrl ? (
                      <a
                        href={summary.receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
                        style={{ color: "#0078D4" }}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />View Receipt →
                      </a>
                    ) : (
                      <span className="text-xs" style={{ color: "#94a3b8" }}>Receipt not available yet</span>
                    )}
                    {summary?.invoicePdfPath ? (
                      <a
                        href={summary.invoicePdfPath}
                        download
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold transition-colors hover:bg-slate-50 w-fit"
                        style={{ color: "#0A2540" }}
                      >
                        <Download className="w-3.5 h-3.5" />Download Invoice PDF
                      </a>
                    ) : null}
                  </div>
                </div>
              )}
            </Card>

            {/* Your Contract */}
            <Card title="Your Contract" icon={<FileText className="w-4 h-4" />}>
              {summaryLoading ? (
                <div className="flex flex-col gap-3">
                  <SkeletonLine w="w-2/3" />
                  <SkeletonLine w="w-1/2" />
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {summary?.signedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium" style={{ color: "#64748b" }}>Signed</span>
                      <span className="text-sm font-semibold" style={{ color: "#0A2540" }}>{formatDate(summary.signedAt)}</span>
                    </div>
                  )}
                  {summary?.signerName && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium" style={{ color: "#64748b" }}>Signed by</span>
                      <span className="text-sm font-semibold" style={{ color: "#0A2540" }}>{summary.signerName}</span>
                    </div>
                  )}
                  {!summary?.signedAt && !summary?.signerName && (
                    <span className="text-xs" style={{ color: "#94a3b8" }}>Contract details not available yet</span>
                  )}
                  {summary?.contractPdfPath ? (
                    <a
                      href={summary.contractPdfPath}
                      download
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold transition-colors hover:bg-slate-50 w-fit"
                      style={{ color: "#0A2540" }}
                    >
                      <Download className="w-3.5 h-3.5" />Download Contract PDF
                    </a>
                  ) : null}
                </div>
              )}
            </Card>

            {/* What We Agreed To */}
            {selectedPhases.length > 0 && (
              <Card title="What We Agreed To" icon={<CreditCard className="w-4 h-4" />}>
                <div className="flex flex-col gap-2">
                  {selectedPhases.map(phase => (
                    <div key={phase.id} className="flex items-center justify-between gap-2 py-1 border-b border-slate-50 last:border-0">
                      <span className="text-xs font-medium truncate" style={{ color: "#0A2540" }}>{phase.title}</span>
                      <span className="text-xs font-bold whitespace-nowrap" style={{ color: "#0078D4" }}>{formatPrice(phase.price)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200 mt-1">
                    <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "#0A2540" }}>Total</span>
                    <span className="text-sm font-black" style={{ color: "#0A2540" }}>{formatPrice(sowTotal)}</span>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* ── Right column ─────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">

            {/* Book Your Kickoff Call */}
            <Card title="Book Your Kickoff Call" icon={<Calendar className="w-4 h-4" />}>
              <p className="text-xs mb-3" style={{ color: "#64748b" }}>Monday slots only — pick a time and confirm before you leave.</p>
              <KickoffCalendarPicker
                prefillName={clientName ?? user?.name ?? ""}
                prefillEmail={user?.email ?? ""}
              />
            </Card>

            {/* Payment Schedule (phased only) */}
            {!summaryLoading && summary?.paymentPlan === "phased" && summary.phases.length > 0 && (
              <Card title="Payment Schedule" icon={<CreditCard className="w-4 h-4" />}>
                <div className="flex flex-col gap-2">
                  {summary.phases.map(phase => (
                    <div key={phase.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-50 last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate" style={{ color: "#0A2540" }}>{phase.title}</p>
                        {phase.deliveryDate && (
                          <p className="text-[11px]" style={{ color: "#64748b" }}>Due: {formatDate(phase.deliveryDate)}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-xs font-bold" style={{ color: "#0A2540" }}>{formatPrice(phase.price)}</span>
                        <PhaseBadge status={phase.invoiceStatus} />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Project Build Status */}
            <Card title="Project Build Status">
              <p className="text-xs mb-3" style={{ color: "#64748b" }}>Your workspace is being provisioned and configured.</p>
              <ul className="divide-y divide-slate-100 -mx-5 px-0">
                {buildSteps.map((step, i) => (
                  <li key={i} className="px-5 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-sm font-medium" style={{ color: "#0A2540" }}>{step.label}</span>
                    <StatusBadge status={step.status} />
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>

        {/* ── M365 Scorecard (full-width) ───────────────────────────────────── */}
        <Card title="M365 Health Scorecard">
          <p className="text-xs mb-4" style={{ color: "#64748b" }}>Based on your environment profile — improvement areas identified.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ScoreBar label="Security" score={scores?.security ?? 0} loading={scoresLoading} />
            <ScoreBar label="Compliance" score={scores?.compliance ?? 0} loading={scoresLoading} />
            <ScoreBar label="Copilot Readiness" score={scores?.copilot ?? 0} loading={scoresLoading} />
            <ScoreBar label="Adoption" score={scores?.adoption ?? 0} loading={scoresLoading} />
          </div>
          {!scoresLoading && !scores && (
            <p className="text-xs text-center py-2 mt-2" style={{ color: "#94a3b8" }}>Complete your M365 profile to see scores.</p>
          )}
        </Card>

        {/* ── CTA button ───────────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-2 pb-4">
          {ctaReady ? (
            <button
              onClick={handleGoToProject}
              className="w-full max-w-sm py-4 rounded-xl font-bold text-base text-white transition-all active:scale-95"
              style={{ background: "linear-gradient(135deg,#0078D4 0%,#00B4D8 100%)", boxShadow: "0 0 40px 8px rgba(0,120,212,0.3)", animation: "ctaGlow 2s ease-in-out infinite" }}
            >
              Go to Your Project →
            </button>
          ) : (
            <button
              disabled
              className="w-full max-w-sm py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-3 cursor-not-allowed border border-slate-200"
              style={{ background: "#F1F5F9", color: "#94A3B8" }}
            >
              <span className="w-3 h-3 rounded-full flex-shrink-0 bg-blue-400" style={{ animation: "ctaPulse 1.4s ease-in-out infinite" }} />
              Generating your project…
            </button>
          )}
          {!ctaReady && (
            <p className="text-[11px] text-center" style={{ color: "#94A3B8" }}>
              Button activates once your workspace is ready — usually within seconds.
            </p>
          )}
          <a href="/contact" className="text-xs hover:underline mt-1" style={{ color: "#0078D4" }}>Need help? Contact support →</a>
        </div>
      </div>

      <style>{`
        @keyframes ctaPulse { 0%,100%{box-shadow:0 0 0 0 rgba(59,130,246,0.6);}50%{box-shadow:0 0 0 8px rgba(59,130,246,0);} }
        @keyframes ctaGlow  { 0%,100%{box-shadow:0 0 30px 4px rgba(0,120,212,0.3);}50%{box-shadow:0 0 50px 12px rgba(0,180,216,0.45);} }
      `}</style>
    </div>
  );
}
