import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CalendarBooking } from "@/components/CalendarBooking";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { CheckCircle, XCircle, Target } from "lucide-react";

const EXPECT_ITEMS = [
  "Assess your current Microsoft 365 environment and identify the biggest gaps and risks holding your organisation back.",
  "Identify 2–3 quick wins you can act on immediately — regardless of whether you hire Shane.",
  "Discuss whether and how Shane can help — with full transparency on scope, approach, and cost.",
  "You'll walk away with clarity, direction, and 2–3 actionable next steps — even if you never engage further.",
];

const NOT_ITEMS = [
  "A sales pitch or a product demo",
  "A generic consultation from someone who hasn't built at enterprise scale",
  "A commitment on your part to engage Shane's services",
  "A call that gets handed off to a junior consultant",
  "A 90-minute deep-dive into your entire environment",
];

const OUTCOME_ITEMS = [
  "A clear picture of your biggest Microsoft 365 gaps and risks — documented and prioritised",
  "2–3 quick wins you can implement this week, with or without outside help",
  "Honest guidance on whether Shane's services are the right fit for your situation and timeline",
  "Zero pressure, zero pitch — just expert perspective you can act on immediately",
];

export default function Book() {
  return (
    <Layout>
      <SEOMeta
        title="Book a Free Discovery Call | Shane McCaw Consulting"
        description="Book a free 30-minute discovery call with Shane McCaw — NASA's Lead Microsoft 365 Architect. Discuss your M365 challenges and get expert guidance. Limited spots available."
      />

      {/* ── Hero ── */}
      <section className="relative pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center overflow-hidden">
        <div className="max-w-4xl mx-auto">
          <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">Book a Call</p>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            Book Your Free <GradientText>30-Minute Discovery Call</GradientText>
          </h1>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto leading-relaxed mb-3">
            30 years of Microsoft 365 expertise. The same assessment methodology used at NASA. Applied directly to your environment — at no cost and no obligation.
          </p>
          <p className="text-text-secondary text-base max-w-xl mx-auto leading-relaxed">
            A genuine conversation, not a sales presentation. Bring your real questions and your actual challenges.
          </p>
        </div>
      </section>

      {/* ── Main content + Bookings embed ── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

            {/* ── Left column: all copy sections ── */}
            <div className="space-y-10">

              {/* What to Expect */}
              <div>
                <h2 className="font-display text-2xl font-bold text-text-primary mb-4">What to Expect</h2>
                <p className="text-text-secondary leading-relaxed mb-6">
                  This is a focused 30-minute working session — not a meet-and-greet. Shane comes prepared. You leave with real answers. Bring your toughest Microsoft 365 questions and Shane will give you direct, expert feedback with no upselling, no fluff.
                </p>
                <ul className="space-y-4">
                  {EXPECT_ITEMS.map((item, i) => (
                    <li key={i} className="flex items-start gap-3" data-testid={`book-expect-${i}`}>
                      <CheckCircle className="w-5 h-5 text-accent-blue mt-0.5 flex-shrink-0" />
                      <p className="text-text-primary text-sm leading-relaxed">{item}</p>
                    </li>
                  ))}
                </ul>
              </div>

              {/* What This Call Is NOT */}
              <div>
                <h2 className="font-display text-2xl font-bold text-text-primary mb-4">What This Call Is NOT</h2>
                <div className="rounded-xl bg-charcoal-1 border border-white/[0.06] p-5">
                  <ul className="space-y-3">
                    {NOT_ITEMS.map((item, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <XCircle className="w-5 h-5 text-rose-400 mt-0.5 flex-shrink-0" />
                        <p className="text-text-secondary text-sm leading-relaxed">{item}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Outcomes of the Call */}
              <div>
                <h2 className="font-display text-2xl font-bold text-text-primary mb-4">Outcomes of the Call</h2>
                <ul className="space-y-4">
                  {OUTCOME_ITEMS.map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <Target className="w-5 h-5 text-accent-violet mt-0.5 flex-shrink-0" />
                      <p className="text-text-primary text-sm leading-relaxed">{item}</p>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Reassurance block */}
              <GlassPanel className="p-6">
                <p className="font-semibold text-text-primary mb-2">Honest advice over closing a deal.</p>
                <p className="text-text-secondary text-sm leading-relaxed">
                  Shane would rather give you honest advice than close a deal that isn't the right fit. If the call confirms you're in good shape on your own, he'll tell you exactly that — and give you a clear path forward anyway.
                </p>
              </GlassPanel>

            </div>

            {/* ── Right column: Calendar booking ── */}
            <div className="lg:col-span-2" data-testid="booking-calendar">
              <CalendarBooking />
            </div>

          </div>
        </div>
      </section>
    </Layout>
  );
}
