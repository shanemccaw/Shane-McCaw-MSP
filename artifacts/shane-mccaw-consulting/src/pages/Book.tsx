import { useEffect } from "react";
import { Layout } from "@/components/Layout";
import { CheckCircle } from "lucide-react";

export default function Book() {
  useEffect(() => {
    document.title = "Book a Free Discovery Call | Shane McCaw Consulting";
  }, []);

  return (
    <Layout>
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Book a Call</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-3xl">
            Book Your Free 30-Minute Discovery Call
          </h1>
        </div>
      </section>

      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            <div>
              <h2 className="text-2xl font-extrabold text-[#0A2540] mb-6">What to Expect</h2>
              <p className="text-muted-foreground leading-relaxed mb-8">
                This is a genuine conversation, not a sales presentation. Bring your real questions, your actual challenges, and your honest concerns about your Microsoft 365 environment. Shane will give you direct, expert feedback — no upselling, no fluff.
              </p>
              <ul className="space-y-4">
                {[
                  "Assess your current Microsoft 365 environment and identify the biggest gaps",
                  "Identify 2–3 quick wins you can act on immediately",
                  "Discuss whether and how Shane can help — with full transparency on scope and cost",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3" data-testid={`book-expect-${i}`}>
                    <CheckCircle className="w-5 h-5 text-[#0078D4] mt-0.5 flex-shrink-0" />
                    <p className="text-foreground">{item}</p>
                  </li>
                ))}
              </ul>

              <div className="mt-10 p-6 bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-xl">
                <p className="font-semibold text-[#0A2540] mb-2">No pressure. No pitch.</p>
                <p className="text-muted-foreground text-sm">
                  If after the call you decide you don't need help, or that it's not the right time, that's completely fine. Shane would rather give you honest advice than close a deal that isn't right.
                </p>
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="bg-white rounded-xl border border-border overflow-hidden" data-testid="calendly-embed">
                <div
                  className="w-full flex flex-col items-center justify-center text-center p-16 text-muted-foreground"
                  style={{ minHeight: "700px" }}
                >
                  <div className="w-16 h-16 rounded-full bg-[#0078D4]/10 flex items-center justify-center mx-auto mb-6">
                    <CheckCircle className="w-8 h-8 text-[#0078D4]" />
                  </div>
                  <h3 className="text-xl font-bold text-[#0A2540] mb-3">Calendly Booking Widget</h3>
                  <p className="text-muted-foreground text-sm max-w-sm">
                    To embed your Calendly, replace this placeholder with an inline Calendly widget using:
                  </p>
                  <code className="mt-4 bg-[#F7F9FC] border border-border px-4 py-2 rounded text-xs text-[#0078D4] block max-w-sm break-all">
                    https://calendly.com/shanemccawconsulting/discovery
                  </code>
                  <p className="text-xs text-muted-foreground mt-4">
                    Add the Calendly script to index.html and use their inline embed code.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
