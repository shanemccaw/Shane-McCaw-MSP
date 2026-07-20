import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";

const EFFECTIVE_DATE = "July 1, 2025";
const CONTACT_EMAIL = "hello@shanemccawconsulting.com";

/**
 * MSP Partner Terms of Service — gates the self-serve MSP onboarding flow (website-rebuild-reference-v2.md
 * §2/§5: "MSA/DPA (MSP Partner ToS + Data Processing Agreement)"). Stub content per Stage 2 scope
 * (real legal copy is Stage 3) — linked from checkout, not primary nav.
 */
export default function MspPartnerTerms() {
  return (
    <Layout>
      <SEOMeta
        title="MSP Partner Terms of Service | Shane McCaw Consulting"
        description="Terms governing MSP partners reselling or hosting monitoring, assessment, and platform services through Shane McCaw Consulting."
      />

      <div className="bg-white pt-[130px] pb-20">
        <div className="max-w-2xl mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Legal</p>
          <h1 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-2">
            MSP Partner Terms of Service
          </h1>
          <p className="text-muted-foreground text-sm mb-10">Effective date: {EFFECTIVE_DATE}</p>

          <div className="prose prose-sm max-w-none text-[#0A2540]/80 space-y-8">
            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">1. Scope of This Agreement</h2>
              <p>
                These MSP Partner Terms of Service ("Partner Terms") govern any organization that
                onboards as a Managed Service Provider ("Partner", "you") to resell, host, or manage
                Monitoring, Assessment, or platform services on behalf of your own end customers through
                Shane McCaw Consulting's platform. They apply in addition to, not instead of, the general{" "}
                <Link href="/terms" className="text-[#0078D4] hover:underline">
                  Terms of Service
                </Link>
                .
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">2. Partner Responsibilities</h2>
              <p>
                As a Partner, you are responsible for your own end-customer relationships, billing, and
                support commitments unless otherwise agreed in writing. You agree to maintain accurate
                tenant and consent records for every end customer you onboard, and to obtain proper
                authorization before any diagnostic scan or monitoring is enabled against a customer
                tenant.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">3. Data Processing</h2>
              <p>
                Where the platform processes personal data or tenant data on your behalf, that processing
                is governed by the{" "}
                <Link href="/dpa" className="text-[#0078D4] hover:underline">
                  Data Processing Agreement
                </Link>
                , which forms part of this Agreement.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">4. Platform Tiers and Fees</h2>
              <p>
                Partner platform tiers, tenant allowances, and fees are as described on the{" "}
                <Link href="/msp" className="text-[#0078D4] hover:underline">
                  MSP / Partners
                </Link>{" "}
                page at the time of signup, and are billed according to the plan selected during
                onboarding.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">5. Termination</h2>
              <p>
                Either party may terminate this Agreement as described in your onboarding plan terms.
                Termination does not relieve either party of obligations accrued prior to the termination
                date.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">6. Contact</h2>
              <p>
                Questions about these Partner Terms can be sent to{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#0078D4] hover:underline">
                  {CONTACT_EMAIL}
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </div>
    </Layout>
  );
}
