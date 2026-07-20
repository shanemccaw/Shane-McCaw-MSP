import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";

const EFFECTIVE_DATE = "July 1, 2025";
const CONTACT_EMAIL = "hello@shanemccawconsulting.com";

/**
 * Data Processing Agreement — the DPA referenced by the MSA/DPA-gated MSP checkout
 * (website-rebuild-reference-v2.md §2/§5). Stub content per Stage 2 scope (real legal copy is
 * Stage 3) — linked from checkout, not primary nav.
 */
export default function Dpa() {
  return (
    <Layout>
      <SEOMeta
        title="Data Processing Agreement | Shane McCaw Consulting"
        description="Terms governing how Shane McCaw Consulting processes personal data and tenant data on behalf of MSP partners and their end customers."
      />

      <div className="bg-white pt-[130px] pb-20">
        <div className="max-w-2xl mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Legal</p>
          <h1 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-2">
            Data Processing Agreement
          </h1>
          <p className="text-muted-foreground text-sm mb-10">Effective date: {EFFECTIVE_DATE}</p>

          <div className="prose prose-sm max-w-none text-[#0A2540]/80 space-y-8">
            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">1. Purpose</h2>
              <p>
                This Data Processing Agreement ("DPA") describes how Shane McCaw Consulting ("Processor")
                processes personal data and Microsoft 365 tenant data on behalf of an MSP Partner or
                direct customer ("Controller") in connection with Monitoring, Assessment, and platform
                services. It forms part of, and is incorporated by reference into, the{" "}
                <Link href="/msp-terms" className="text-[#0078D4] hover:underline">
                  MSP Partner Terms of Service
                </Link>{" "}
                and general{" "}
                <Link href="/terms" className="text-[#0078D4] hover:underline">
                  Terms of Service
                </Link>
                .
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">2. Scope of Processing</h2>
              <p>
                Processing is limited to what is necessary to deliver the contracted service: running
                consented diagnostic scans via Microsoft Graph, computing and storing health, risk, and
                drift signals, and delivering resulting reports, alerts, and remediation guidance. Data is
                processed only for the tenant(s) the Controller has authorized.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">3. Sub-processors</h2>
              <p>
                The Processor uses infrastructure and service sub-processors (including cloud hosting and
                Microsoft Graph API access) strictly to deliver the contracted service, under
                confidentiality obligations no less protective than those in this DPA.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">4. Security Measures</h2>
              <p>
                Tenant data is isolated per customer at the data layer. See{" "}
                <Link href="/trust-security" className="text-[#0078D4] hover:underline">
                  Trust &amp; Security
                </Link>{" "}
                for the platform-level mechanisms in place — tenant isolation, read-only impersonation,
                explainable scoring lineage, idempotent operations, and isolated simulation testbeds.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">5. Data Deletion</h2>
              <p>
                Upon termination of the underlying service agreement, tenant data is retained only as
                required for legal, billing, or audit purposes, and is deleted or anonymized in accordance
                with the Controller's instructions and applicable law.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">6. Contact</h2>
              <p>
                Questions about this DPA can be sent to{" "}
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
