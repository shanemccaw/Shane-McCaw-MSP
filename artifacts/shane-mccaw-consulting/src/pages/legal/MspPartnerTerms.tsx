import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";

const EFFECTIVE_DATE = "July 1, 2025";
const CONTACT_EMAIL = "hello@shanemccawconsulting.com";

/**
 * MSP Partner Terms of Service — gates the self-serve MSP onboarding flow (website-rebuild-reference-v2.md
 * §2/§5: "MSA/DPA (MSP Partner ToS + Data Processing Agreement)"). Real Stage 3 legal copy, drafted to the
 * same completeness bar as /legal/terms and /legal/privacy. NOTE: this is drafted content, not
 * attorney-reviewed — flagged for legal review before being relied on as a binding partner agreement.
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
                onboards as a Managed Service Provider ("Partner," "you") to resell, host, or manage
                Monitoring, Assessment, or platform services on behalf of your own end customers through
                Shane McCaw Consulting's platform (the "Platform"). They apply in addition to, not instead
                of, the general{" "}
                <Link href="/terms" className="text-[#0078D4] hover:underline">
                  Terms of Service
                </Link>
                . Where these Partner Terms conflict with the general Terms of Service on a matter specific
                to the Partner relationship, these Partner Terms control.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">2. Onboarding and Account Setup</h2>
              <p>
                Partner status begins once you complete the onboarding flow described on the{" "}
                <Link href="/msp" className="text-[#0078D4] hover:underline">
                  MSP / Partners
                </Link>{" "}
                page, select a partnership tier, choose an onboarding option (self-service or
                white-glove), and accept these Partner Terms and the{" "}
                <Link href="/dpa" className="text-[#0078D4] hover:underline">
                  Data Processing Agreement
                </Link>
                . We may decline or suspend onboarding for any organization at our discretion, including
                where we cannot verify the organization's identity or legitimate business purpose.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">3. Partner Responsibilities</h2>
              <p>
                As a Partner, you are responsible for your own end-customer relationships, billing, and
                support commitments unless otherwise agreed in writing. You agree to:
              </p>
              <ul className="list-disc pl-6 mt-3 space-y-2">
                <li>
                  Maintain accurate tenant and consent records for every end customer you onboard, and
                  obtain proper, documented authorization before any diagnostic scan or monitoring is
                  enabled against a customer tenant
                </li>
                <li>
                  Only submit end-customer tenants you have a lawful basis and contractual right to
                  authorize for scanning or monitoring
                </li>
                <li>
                  Keep your account credentials and any break-glass or delegated-access credentials issued
                  to you confidential, and notify us promptly of any suspected unauthorized access
                </li>
                <li>
                  Comply with applicable law in how you market, resell, and represent the Platform's
                  capabilities to your end customers — including not claiming certifications, compliance
                  authorizations, or capabilities the Platform does not actually hold (see{" "}
                  <Link href="/trust-security" className="text-[#0078D4] hover:underline">
                    Trust &amp; Security
                  </Link>{" "}
                  for what is currently true)
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">4. White-Label Use</h2>
              <p>
                Partner tiers that include white-label deliverables permit you to present assessment
                reports, dashboards, and monitoring output under your own branding to your end customers,
                subject to your plan's tier capabilities. White-labeling does not transfer ownership of the
                underlying Platform, its methodology, or its source code, and does not permit
                sublicensing the Platform itself to a third party outside your own end-customer
                relationships.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">5. Data Processing</h2>
              <p>
                Where the Platform processes personal data or tenant data on your behalf or on behalf of
                your end customers, that processing is governed by the{" "}
                <Link href="/dpa" className="text-[#0078D4] hover:underline">
                  Data Processing Agreement
                </Link>
                , which forms part of this Agreement. You remain responsible for having a valid legal basis
                to authorize that processing with respect to each end customer.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">6. Platform Tiers, Fees, and Overages</h2>
              <p>
                Partner platform tiers, tenant allowances, AI credit allowances, and fees are as described
                on the{" "}
                <Link href="/msp" className="text-[#0078D4] hover:underline">
                  MSP / Partners
                </Link>{" "}
                page at the time of signup, and are billed according to the plan selected during
                onboarding. Tenant allowance overages, where applicable, are billed at the flat overage
                rate shown for your tier at the time the overage occurs. We may update tier pricing
                prospectively; changes do not apply retroactively to fees already billed.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">7. Confidentiality</h2>
              <p>
                Each party agrees to keep the other party's non-public business, technical, and
                customer information confidential, and to use it only as necessary to perform under this
                Agreement. This obligation survives termination of this Agreement.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">8. Disclaimers and Limitation of Liability</h2>
              <p>
                The Platform is provided "as is" to Partners, without warranties of any kind beyond what is
                expressly stated in these Partner Terms. To the fullest extent permitted by applicable law,
                neither party will be liable to the other for indirect, incidental, special, or
                consequential damages arising from this Agreement.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">9. Term and Termination</h2>
              <p>
                This Agreement remains in effect for as long as your Partner account is active. Either
                party may terminate as described in your onboarding plan terms, or with written notice
                where no specific term is stated. Termination does not relieve either party of obligations
                accrued prior to the termination date, and does not affect end-customer data deletion
                obligations under the{" "}
                <Link href="/dpa" className="text-[#0078D4] hover:underline">
                  Data Processing Agreement
                </Link>
                .
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">10. Changes to These Partner Terms</h2>
              <p>
                We may update these Partner Terms from time to time. When we make changes, we will update
                the effective date at the top of this page. Material changes affecting active Partners will
                be communicated directly, not just posted here.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">11. Governing Law</h2>
              <p>
                These Partner Terms are governed by and construed in accordance with the laws of the United
                States, without regard to its conflict of law provisions.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">12. Contact</h2>
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
