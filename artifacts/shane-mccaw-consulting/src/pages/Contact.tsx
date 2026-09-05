import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  MapPin,
  Send,
  ShieldAlert,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";

/**
 * Contact — design pass (Design/fractional_architecture/README.md §2, Contact.dc.html).
 * Visual/copy only: routes, the lead endpoint (POST /api/leads) and its submission
 * shape are unchanged. No email address or mailto: link anywhere on this page.
 */

const INTERESTS = ["Architect Retainer", "Copilot Readiness Assessment", "Not sure yet"] as const;

const STEPS = [
  {
    index: "01",
    kicker: "Within 24 hours",
    title: "Shane replies himself",
    body: "Your message goes to his inbox, not a queue. He answers it within 24 hours on the next business day.",
  },
  {
    index: "02",
    kicker: "30 minutes · Free",
    title: "A free consultation",
    body: "You pick a time. Thirty minutes on the issues you're facing and how Shane can help. No pitch.",
  },
  {
    index: "03",
    kicker: "Your decision",
    title: "You decide",
    body: "If it fits, you choose the engagement: a retainer tier or the Copilot Readiness Assessment. If it doesn't, you leave with a clearer picture and no obligation.",
  },
  {
    index: "04",
    kicker: "From $900 a month",
    title: "Purchase the hours. Work starts.",
    body: "Hours are purchased up front by card through Stripe. Shane schedules the first session and the engagement begins.",
  },
] as const;

const CHECK_ROW = ["No proposal cycle", "No SOW", "No minimum term"];

type Status = "idle" | "sending" | "sent";

export default function Contact() {
  const [status, setStatus] = useState<Status>("idle");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [interest, setInterest] = useState<(typeof INTERESTS)[number] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) {
      setError("Add your name, a work email and a sentence about what's stuck.");
      return;
    }
    setError(null);
    setStatus("sending");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          company: company.trim() || undefined,
          serviceArea: interest ?? undefined,
          message: message.trim(),
          source: "contact_form",
        }),
      });
      if (!res.ok) throw new Error("Submit failed");
      setStatus("sent");
    } catch {
      setStatus("idle");
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <Layout>
      <SEOMeta
        title="Contact | Shane McCaw Consulting"
        description="Send Shane the problem directly. He replies within 24 hours — no intake team, no ticket queue."
      />

      <div className="bg-[#020617]">
        <section
          id="top"
          className="relative overflow-hidden scroll-mt-[72px]"
          style={{
            background:
              "radial-gradient(circle 1100px at 76% -20%, rgba(139,92,246,.12), rgba(2,6,23,0) 62%), radial-gradient(circle 800px at 6% 12%, rgba(0,120,212,.06), rgba(2,6,23,0) 66%)",
          }}
        >
          <Send
            aria-hidden="true"
            className="hidden sm:block absolute -right-[50px] -top-[30px] w-[440px] h-[440px] opacity-10 pointer-events-none"
            stroke="#a78bfa"
            strokeWidth={0.7}
            style={{ filter: "drop-shadow(0 0 26px rgba(139,92,246,.3))" }}
          />

          <div className="relative max-w-[1160px] mx-auto px-[clamp(16px,4vw,32px)] pt-[clamp(56px,9vw,104px)] pb-[clamp(56px,8vw,96px)]">
            <div className="max-w-[760px]">
              <div className="flex items-center gap-3">
                <span
                  className="w-[26px] h-px"
                  style={{ background: "linear-gradient(90deg,#00B4D8,rgba(0,180,216,.15))" }}
                />
                <span className="text-[11px] font-semibold tracking-[.16em] uppercase text-[#00B4D8]">
                  Contact · Direct to Shane
                </span>
              </div>
              <h1 className="text-[clamp(28px,4vw,44px)] leading-[1.08] tracking-[-.025em] font-extrabold text-[#f8fafc] mt-[22px] mb-5 text-pretty">
                Send the Problem. <span className="text-[#a78bfa]">Shane Replies Within 24 Hours.</span>
              </h1>
              <p className="text-[clamp(16px,2.2vw,18px)] leading-[1.6] text-[#94a3b8] max-w-[640px] text-pretty">
                Two sentences is plenty: the decision, the migration, the Copilot question. Every message goes to
                Shane's own inbox, and every reply is his. No intake team, no ticket queue.
              </p>
            </div>

            <div
              className="mt-[clamp(36px,5vw,56px)] grid gap-[clamp(32px,5vw,64px)] items-start"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))" }}
            >
              {/* Left — form card */}
              <div
                id="form"
                className="scroll-mt-24 rounded-[20px] p-[clamp(22px,3.5vw,32px)]"
                style={{
                  border: "1px solid rgba(0,120,212,.3)",
                  background:
                    "radial-gradient(700px 300px at 8% -10%, rgba(0,120,212,.18), transparent 60%), linear-gradient(168deg, rgba(10,37,64,.5), #070d1e 64%)",
                }}
              >
                {status === "idle" && (
                  <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
                    <div className="flex items-center gap-3">
                      <span
                        className="w-[26px] h-px"
                        style={{ background: "linear-gradient(90deg,#00B4D8,rgba(0,180,216,.15))" }}
                      />
                      <span className="text-[11px] font-semibold tracking-[.16em] uppercase text-[#00B4D8]">
                        Send Shane a Message
                      </span>
                    </div>

                    <div
                      className="grid gap-3"
                      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))" }}
                    >
                      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[#cbd5e1]">
                        Name
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Your name"
                          autoComplete="name"
                          className="w-full rounded-[9px] border border-[rgba(148,163,184,.28)] bg-[rgba(2,6,23,.55)] px-3 py-[11px] text-sm text-[#f1f5f9] placeholder-[#64748b] outline-none focus:border-[#0078D4] focus:ring-[3px] focus:ring-[rgba(0,120,212,.25)]"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[#cbd5e1]">
                        Work email
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@yourcompany.com"
                          autoComplete="email"
                          className="w-full rounded-[9px] border border-[rgba(148,163,184,.28)] bg-[rgba(2,6,23,.55)] px-3 py-[11px] text-sm text-[#f1f5f9] placeholder-[#64748b] outline-none focus:border-[#0078D4] focus:ring-[3px] focus:ring-[rgba(0,120,212,.25)]"
                        />
                      </label>
                    </div>

                    <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[#cbd5e1]">
                      Company
                      <input
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        placeholder="Company"
                        autoComplete="organization"
                        className="w-full rounded-[9px] border border-[rgba(148,163,184,.28)] bg-[rgba(2,6,23,.55)] px-3 py-[11px] text-sm text-[#f1f5f9] placeholder-[#64748b] outline-none focus:border-[#0078D4] focus:ring-[3px] focus:ring-[rgba(0,120,212,.25)]"
                      />
                    </label>

                    <div className="flex flex-col gap-2">
                      <span className="text-[13px] font-medium text-[#cbd5e1]">
                        What you're considering <span className="text-[#64748b] font-normal">(optional)</span>
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {INTERESTS.map((label) => {
                          const selected = interest === label;
                          return (
                            <button
                              key={label}
                              type="button"
                              onClick={() => setInterest((prev) => (prev === label ? null : label))}
                              className={
                                selected
                                  ? "flex items-center gap-1.5 rounded-full border border-[#0078D4] px-4 py-2.5 text-[13px] font-semibold text-[#f8fafc]"
                                  : "rounded-full border border-[rgba(148,163,184,.28)] px-4 py-2.5 text-[13px] font-medium text-[#cbd5e1] transition-colors hover:border-[rgba(0,120,212,.6)] hover:text-[#f8fafc]"
                              }
                              style={
                                selected
                                  ? { background: "rgba(0,120,212,.18)" }
                                  : { background: "rgba(2,6,23,.55)" }
                              }
                            >
                              {selected && <Check className="w-[13px] h-[13px]" stroke="#00B4D8" strokeWidth={2.5} />}
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[#cbd5e1]">
                      What's stuck
                      <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        rows={5}
                        placeholder="The decision, the migration, the Copilot question. Two sentences is plenty."
                        className="w-full resize-y rounded-[9px] border border-[rgba(148,163,184,.28)] bg-[rgba(2,6,23,.55)] px-3 py-[11px] text-sm leading-normal text-[#f1f5f9] placeholder-[#64748b] outline-none focus:border-[#0078D4] focus:ring-[3px] focus:ring-[rgba(0,120,212,.25)]"
                      />
                    </label>

                    {error && <p className="-mt-1 text-[13px] leading-normal text-[#fca5a5]">{error}</p>}

                    <button
                      type="submit"
                      className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-[10px] text-[15px] font-semibold text-white"
                      style={{ background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }}
                    >
                      Send to Shane
                      <ArrowRight className="w-4 h-4" />
                    </button>

                    <p className="text-[12.5px] leading-[1.55] text-[#94a3b8]">
                      Goes to Shane directly. He cannot take on organizations that work with, contract to, or partner
                      with NASA.
                    </p>
                  </form>
                )}

                {status === "sending" && (
                  <div className="flex min-h-[520px] flex-col items-center justify-center gap-3.5 text-center">
                    <Loader2 className="w-7 h-7 animate-spin" stroke="#0078D4" />
                    <div className="text-[15px] text-[#e2e8f0]">Sending to Shane…</div>
                  </div>
                )}

                {status === "sent" && (
                  <div className="flex min-h-[520px] flex-col justify-center gap-3.5">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(0,180,216,.3)] bg-[rgba(0,180,216,.1)] text-[#00B4D8]">
                      <CheckCircle2 className="w-[22px] h-[22px]" />
                    </span>
                    <div className="text-[11px] font-semibold tracking-[.16em] uppercase text-[#00B4D8]">Sent</div>
                    <div className="text-2xl font-extrabold tracking-[-.02em] leading-[1.2] text-[#f8fafc]">
                      Shane has it.
                    </div>
                    <p className="max-w-[460px] text-[15px] leading-[1.65] text-[#cbd5e1] text-pretty">
                      He reads these himself and replies from his own inbox within 24 hours on the next business day.
                      If the answer is short, you get it there. If it needs a conversation, his reply includes a time
                      for the free 30-minute consultation.
                    </p>
                    <div className="mt-1.5 flex items-center gap-2 border-t border-[rgba(30,41,59,.9)] pt-4 text-[13px] leading-normal text-[#94a3b8]">
                      <Clock className="w-3.5 h-3.5 shrink-0" stroke="#00B4D8" />
                      Sent on a weekend or holiday? The 24 hours start the next business day.
                    </div>
                  </div>
                )}
              </div>

              {/* Right — What Happens Next stepper */}
              <div className="pt-1.5">
                <div className="flex items-center gap-3">
                  <span
                    className="w-[26px] h-px"
                    style={{ background: "linear-gradient(90deg,#00B4D8,rgba(0,180,216,.15))" }}
                  />
                  <span className="text-[11px] font-semibold tracking-[.16em] uppercase text-[#00B4D8]">
                    What Happens Next
                  </span>
                </div>
                <h2 className="text-[clamp(24px,3.4vw,32px)] leading-[1.15] tracking-[-.025em] font-extrabold text-[#f8fafc] mt-3.5 mb-7 text-pretty">
                  Four Steps, All of Them With Shane.
                </h2>

                <div className="flex flex-col">
                  {STEPS.map((step, i) => (
                    <div
                      key={step.index}
                      className="grid gap-x-[18px]"
                      style={{ gridTemplateColumns: "40px minmax(0,1fr)" }}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[rgba(0,180,216,.35)] bg-[rgba(0,180,216,.08)] font-mono text-xs tracking-[.08em] text-[#00B4D8]">
                          {step.index}
                        </span>
                        {i < STEPS.length - 1 && <span className="w-px flex-1 bg-[rgba(30,41,59,.9)]" />}
                      </div>
                      <div className={i < STEPS.length - 1 ? "pb-[30px]" : ""}>
                        <div className="pt-[3px] text-[11px] font-semibold tracking-[.14em] uppercase text-[#00B4D8]">
                          {step.kicker}
                        </div>
                        <h3 className="mt-2 mb-1.5 text-[17px] font-bold tracking-[-.01em] leading-[1.3] text-[#f8fafc]">
                          {step.title}
                        </h3>
                        <p className="text-[14.5px] leading-[1.6] text-[#94a3b8] text-pretty">{step.body}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-[30px] flex flex-wrap gap-x-[22px] gap-y-2.5 text-[13px] text-[#94a3b8]">
                  {CHECK_ROW.map((label) => (
                    <span key={label} className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" stroke="#00B4D8" strokeWidth={2.5} />
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Details strip */}
        <section className="border-t border-[rgba(30,41,59,.8)] bg-[rgba(15,23,42,.4)]">
          <div
            className="mx-auto grid max-w-[1160px] gap-[clamp(20px,3vw,32px)] px-[clamp(16px,4vw,32px)] py-[clamp(32px,5vw,48px)]"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))" }}
          >
            <div className="flex items-start gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[rgba(96,165,250,.2)] bg-[rgba(96,165,250,.1)] text-[#60a5fa]">
                <MapPin className="w-5 h-5" />
              </span>
              <div>
                <div className="text-[15px] font-bold tracking-[-.01em] text-[#f8fafc]">Based in Vero Beach, FL</div>
                <p className="mt-1.5 text-sm leading-[1.55] text-[#94a3b8]">
                  Working with clients nationwide, on Eastern time.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[rgba(0,180,216,.2)] bg-[rgba(0,180,216,.1)] text-[#00B4D8]">
                <Mail className="w-5 h-5" />
              </span>
              <div>
                <div className="text-[15px] font-bold tracking-[-.01em] text-[#f8fafc]">The form is the front door</div>
                <p className="mt-1.5 text-sm leading-[1.55] text-[#94a3b8]">
                  No public inbox. Messages sent here reach Shane directly, and his reply comes from his own address.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[rgba(251,191,36,.2)] bg-[rgba(251,191,36,.1)] text-[#fbbf24]">
                <ShieldAlert className="w-5 h-5" />
              </span>
              <div>
                <div className="text-[15px] font-bold tracking-[-.01em] text-[#f8fafc]">One exclusion</div>
                <p className="mt-1.5 text-sm leading-[1.55] text-[#94a3b8]">
                  Shane's NASA role is a personal credential, not an endorsement. He cannot take on organizations that
                  work with, contract to, or partner with NASA.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
