import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { MicrosoftBookingsEmbed } from "@/components/MicrosoftBookingsEmbed";
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
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Book a Call</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-3xl mb-6">
            Book Your Free 30-Minute Discovery Call
          </h1>
          <p className="text-white/70 text-lg max-w-2xl leading-relaxed mb-3">
            30 years of Microsoft 365 expertise. The same assessment methodology used at NASA. Applied directly to your environment — at no cost and no obligation.
          </p>
          <p className="text-white/50 text-base max-w-xl leading-relaxed">
            A genuine conversation, not a sales presentation. Bring your real questions and your actual challenges.
          </p>
        </div>
      </section>

      {/* ── Main content + Bookings embed ── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

            {/* ── Left column: all copy sections ── */}
            <div className="space-y-12">

              {/* What to Expect */}
              <div>
                <h2 className="text-2xl font-extrabold text-[#0A2540] mb-4">What to Expect</h2>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  This is a focused 30-minute working session — not a meet-and-greet. Shane comes prepared. You leave with real answers. Bring your toughest Microsoft 365 questions and Shane will give you direct, expert feedback with no upselling, no fluff.
                </p>
                <ul className="space-y-4">
                  {EXPECT_ITEMS.map((item, i) => (
                    <li key={i} className="flex items-start gap-3" data-testid={`book-expect-${i}`}>
                      <CheckCircle className="w-5 h-5 text-[#0078D4] mt-0.5 flex-shrink-0" />
                      <p className="text-foreground text-sm leading-relaxed">{item}</p>
                    </li>
                  ))}
                </ul>
              </div>

              {/* What This Call Is NOT */}
              <div>
                <h2 className="text-2xl font-extrabold text-[#0A2540] mb-4">What This Call Is NOT</h2>
                <div className="bg-white border border-border rounded-xl p-5">
                  <ul className="space-y-3">
                    {NOT_ITEMS.map((item, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <XCircle className="w-5 h-5 text-rose-400 mt-0.5 flex-shrink-0" />
                        <p className="text-muted-foreground text-sm leading-relaxed">{item}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Outcomes of the Call */}
              <div>
                <h2 className="text-2xl font-extrabold text-[#0A2540] mb-4">Outcomes of the Call</h2>
                <ul className="space-y-4">
                  {OUTCOME_ITEMS.map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <Target className="w-5 h-5 text-[#00B4D8] mt-0.5 flex-shrink-0" />
                      <p className="text-foreground text-sm leading-relaxed">{item}</p>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Reassurance block */}
              <div className="p-6 bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-xl">
                <p className="font-semibold text-[#0A2540] mb-2">Honest advice over closing a deal.</p>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Shane would rather give you honest advice than close a deal that isn't the right fit. If the call confirms you're in good shape on your own, he'll tell you exactly that — and give you a clear path forward anyway.
                </p>
              </div>

            </div>

            {/* ── Right column: Bookings embed ── */}
            <div className="lg:col-span-2" data-testid="bookings-embed">
              <MicrosoftBookingsEmbed minHeight={700} />
            </div>

          </div>
        </div>
      </section>
    </Layout>
  );
}
