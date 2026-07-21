import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Calendar, CheckCircle, Loader2, ChevronLeft } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Slot {
  startIso: string;
  endIso: string;
  label: string;
}

interface DateButton {
  dateStr: string; // YYYY-MM-DD
  label: string;   // "Mon Jun 23"
}

// ─── Business-day helpers ─────────────────────────────────────────────────────

function getNext14BusinessDays(): DateButton[] {
  const days: DateButton[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() + 1); // start tomorrow

  while (days.length < 14) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const yyyy = cursor.getUTCFullYear();
      const mm = String(cursor.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(cursor.getUTCDate()).padStart(2, "0");
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const label = cursor.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
      days.push({ dateStr, label });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function formatSlotDate(isoStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoStr)) + " ET";
}

// ─── Booking form schema ──────────────────────────────────────────────────────

const bookingSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Enter a valid email address"),
  company: z.string().max(120).optional(),
  topic: z
    .string()
    .min(1, "Please describe what you'd like to discuss")
    .max(300, "Keep it under 300 characters"),
});
type BookingFormData = z.infer<typeof bookingSchema>;

// ─── Component ────────────────────────────────────────────────────────────────

type Step = "date" | "time" | "form" | "success";

export function CalendarBooking() {
  const businessDays = getNext14BusinessDays();

  const [step, setStep] = useState<Step>("date");
  const [selectedDate, setSelectedDate] = useState<DateButton | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<BookingFormData>({ resolver: zodResolver(bookingSchema) });

  async function handleDateSelect(day: DateButton) {
    setSelectedDate(day);
    setSelectedSlot(null);
    setSlots([]);
    setSlotsError(null);
    setSlotsLoading(true);
    setStep("time");

    try {
      const res = await fetch(`/api/booking/slots?date=${day.dateStr}`);
      const data = await res.json() as { slots?: Slot[]; error?: string };
      if (!res.ok) {
        setSlotsError(data.error ?? "Failed to load available times.");
      } else {
        setSlots(data.slots ?? []);
      }
    } catch {
      setSlotsError("Could not connect to the server. Please try again.");
    } finally {
      setSlotsLoading(false);
    }
  }

  async function onSubmit(formData: BookingFormData) {
    if (!selectedSlot) return;
    setSubmitError(null);

    const res = await fetch("/api/booking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...formData,
        startIso: selectedSlot.startIso,
        endIso: selectedSlot.endIso,
      }),
    });

    const data = await res.json() as { ok?: boolean; error?: string };
    if (!res.ok) {
      setSubmitError(data.error ?? "Something went wrong. Please try again.");
      return;
    }
    setStep("success");
  }

  // ── Success ──────────────────────────────────────────────────────────────────

  if (step === "success" && selectedSlot) {
    return (
      <div className="w-full h-full flex items-center justify-center min-h-[600px]">
        <div className="rounded-2xl bg-charcoal-1 border border-accent-blue/20 p-12 text-center max-w-md w-full">
          <div className="w-16 h-16 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-8 h-8 text-accent-blue" />
          </div>
          <h2 className="font-display text-2xl font-bold text-text-primary mb-3">You're booked!</h2>
          <p className="text-text-primary font-medium mb-1">{formatSlotDate(selectedSlot.startIso)}</p>
          <p className="text-text-secondary text-sm mb-6">30 minutes · Microsoft Teams / Phone call</p>
          <p className="text-text-secondary text-sm leading-relaxed">
            Check your inbox — a calendar invite is on its way. Come prepared with your
            toughest Microsoft 365 questions.
          </p>
        </div>
      </div>
    );
  }

  // ── Main layout ───────────────────────────────────────────────────────────────

  return (
    <div className="w-full rounded-2xl bg-charcoal-1 border border-white/[0.06] overflow-hidden">

      {/* ── Step indicator ── */}
      <div className="border-b border-white/[0.06] px-6 py-4 flex items-center gap-6">
        {(["date", "time", "form"] as Step[]).map((s, idx) => {
          const labels = ["Choose a date", "Choose a time", "Your details"];
          const active = step === s;
          const done =
            (s === "date" && (step === "time" || step === "form")) ||
            (s === "time" && step === "form");
          return (
            <div key={s} className="flex items-center gap-2">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors
                  ${done ? "bg-accent-blue text-white" : active ? "bg-white/[0.12] text-text-primary" : "bg-white/[0.06] text-text-tertiary"}`}
              >
                {done ? "✓" : idx + 1}
              </span>
              <span className={`text-sm font-medium hidden sm:inline ${active ? "text-text-primary" : "text-text-secondary"}`}>
                {labels[idx]}
              </span>
            </div>
          );
        })}
      </div>

      <div className="p-6">

        {/* ── Step 1: Date picker ── */}
        {step === "date" && (
          <div>
            <p className="text-sm text-text-secondary mb-5">
              Select a date — available Monday through Friday, next 14 business days.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {businessDays.map((day) => (
                <button
                  key={day.dateStr}
                  onClick={() => void handleDateSelect(day)}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] hover:border-accent-blue/60 hover:bg-accent-blue/10 transition-colors p-3 text-left"
                >
                  <span className="block text-sm font-semibold text-text-primary">{day.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 2: Time slots ── */}
        {step === "time" && selectedDate && (
          <div>
            <button
              onClick={() => setStep("date")}
              className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary mb-4 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to dates
            </button>
            <p className="text-sm font-semibold text-text-primary mb-1">{selectedDate.label}</p>
            <p className="text-xs text-text-secondary mb-5">All times shown in Eastern Time (ET)</p>

            {slotsLoading && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-12 rounded-lg bg-white/[0.06] animate-pulse" />
                ))}
              </div>
            )}

            {slotsError && (
              <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">
                {slotsError}
              </div>
            )}

            {!slotsLoading && !slotsError && slots.length === 0 && (
              <div className="rounded-lg bg-white/[0.04] border border-white/[0.08] p-6 text-center text-sm text-text-secondary">
                No availability on this day. Please choose a different date.
              </div>
            )}

            {!slotsLoading && !slotsError && slots.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {slots.map((slot) => (
                  <button
                    key={slot.startIso}
                    onClick={() => { setSelectedSlot(slot); setStep("form"); }}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.04] hover:border-accent-blue/60 hover:bg-accent-blue/10 transition-colors p-3 text-sm font-medium text-text-primary"
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Booking form ── */}
        {step === "form" && selectedSlot && selectedDate && (
          <div>
            <button
              onClick={() => setStep("time")}
              className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary mb-4 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to times
            </button>

            {/* Selected slot summary */}
            <div className="rounded-xl bg-accent-blue/10 border border-accent-blue/20 p-4 flex items-center gap-3 mb-6">
              <Calendar className="w-5 h-5 text-accent-blue flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-text-primary">{selectedDate.label} · {selectedSlot.label} ET</p>
                <p className="text-xs text-text-secondary">30 minutes · Microsoft Teams / Phone call</p>
              </div>
            </div>

            <form onSubmit={(e) => { void handleSubmit(onSubmit)(e); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Full name <span className="text-rose-400">*</span>
                </label>
                <input
                  {...register("name")}
                  placeholder="Jane Smith"
                  className="w-full rounded-lg border border-white/[0.12] bg-white/[0.04] text-text-primary placeholder:text-text-tertiary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue/30 focus:border-accent-blue/60 transition"
                />
                {errors.name && <p className="text-xs text-rose-400 mt-1">{errors.name.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Work email <span className="text-rose-400">*</span>
                </label>
                <input
                  {...register("email")}
                  type="email"
                  placeholder="jane@company.com"
                  className="w-full rounded-lg border border-white/[0.12] bg-white/[0.04] text-text-primary placeholder:text-text-tertiary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue/30 focus:border-accent-blue/60 transition"
                />
                {errors.email && <p className="text-xs text-rose-400 mt-1">{errors.email.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Company <span className="text-text-secondary font-normal">(optional)</span>
                </label>
                <input
                  {...register("company")}
                  placeholder="Acme Corp"
                  className="w-full rounded-lg border border-white/[0.12] bg-white/[0.04] text-text-primary placeholder:text-text-tertiary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue/30 focus:border-accent-blue/60 transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Topic / agenda <span className="text-rose-400">*</span>
                </label>
                <textarea
                  {...register("topic")}
                  rows={4}
                  maxLength={300}
                  placeholder="What are your biggest Microsoft 365 challenges? What do you hope to get out of this call?"
                  className="w-full rounded-lg border border-white/[0.12] bg-white/[0.04] text-text-primary placeholder:text-text-tertiary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue/30 focus:border-accent-blue/60 transition resize-none"
                />
                {errors.topic && <p className="text-xs text-rose-400 mt-1">{errors.topic.message}</p>}
                <p className="text-xs text-text-secondary mt-1">Max 300 characters</p>
              </div>

              {submitError && (
                <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-sm text-rose-400">
                  {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-2 bg-accent-blue hover:bg-accent-blue/90 disabled:opacity-60 text-white font-semibold text-sm py-3 rounded-lg transition-colors"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Confirming booking…
                  </>
                ) : (
                  "Confirm booking"
                )}
              </button>

              <p className="text-xs text-text-secondary text-center">
                By booking, you'll receive a confirmation email and a calendar invite.
              </p>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}
