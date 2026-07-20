import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";

const EFFECTIVE_DATE = "July 1, 2025";
const CONTACT_EMAIL = "hello@shanemccawconsulting.com";

/**
 * Data Processing Agreement — the DPA referenced by the MSA/DPA-gated MSP checkout
 * (website-rebuild-reference-v2.md §2/§5). Real Stage 3 legal copy, drafted to the same
 * completeness bar as /legal/terms and /legal/privacy. NOTE: this is drafted content, not
 * attorney-reviewed — flagged for legal review before being relied on as a binding DPA, since a
 * defective DPA is a real compliance exposure for both Shane McCaw Consulting and its Partners.
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
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">1. Purpose and Parties</h2>
              <p>
                This Data Processing Agreement ("DPA") describes how Shane McCaw Consulting ("Processor,"
                "we") processes personal data and Microsoft 365 tenant data on behalf of an MSP Partner or
                direct customer ("Controller," "you") in connection with Monitoring, Assessment, and
                platform services. It forms part of, and is incorporated by reference into, the{" "}
                <Link href="/msp-terms" className="text-[#0078D4] hover:underline">
                  MSP Partner Terms of Service
                </Link>{" "}
                and general{" "}
                <Link href="/terms" className="text-[#0078D4] hover:underline">
                  Terms of Service
                </Link>
                . The Controller determines the purposes and means of processing with respect to its own
                end-customer tenants; the Processor processes data only on the Controller's documented
                instructions, as described in this DPA.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">2. Scope and Nature of Processing</h2>
              <p>
                Processing is limited to what is necessary to deliver the contracted service: running
                consented diagnostic scans via Microsoft Graph, computing and storing health, risk, and
                drift signals, and delivering resulting reports, alerts, and remediation guidance. Data is
                processed only for the tenant(s) the Controller has authorized, and only for the duration
                the underlying service agreement remains active.
              </p>
              <p className="mt-3">
                Categories of data processed typically include: Microsoft 365 tenant configuration and
                security posture data (e.g. sharing settings, guest access, license assignments,
                Conditional Access policy state), diagnostic findings derived from that configuration data,
                and end-user contact information (name, work email) where required to deliver reports or
                account access. The Processor does not intentionally process special categories of
                personal data (e.g. health or financial records) as part of normal Platform operation.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">3. Sub-processors</h2>
              <p>
                The Processor uses infrastructure and service sub-processors (including cloud hosting,
                database hosting, and Microsoft Graph API access) strictly to deliver the contracted
                service, under confidentiality and data-protection obligations no less protective than
                those in this DPA. The Processor will provide notice of any new sub-processor category that
                materially changes how tenant data is handled, and the Controller may object on reasonable
                data-protection grounds.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">4. Security Measures</h2>
              <p>
                Tenant data is isolated per customer at the data layer — every query and write path is
                scoped to the requesting tenant structurally, not by application-level discipline alone.
                See{" "}
                <Link href="/trust-security" className="text-[#0078D4] hover:underline">
                  Trust &amp; Security
                </Link>{" "}
                for the platform-level mechanisms currently in place: enforced tenant isolation, read-only
                and logged impersonation, explainable scoring lineage, idempotent write operations, and
                isolated simulation testbeds for anything that is not a real customer signal. The Processor
                is currently building toward SOC 2 Type I; no compliance certification beyond that is
                claimed today.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">5. Data Subject Rights and Controller Assistance</h2>
              <p>
                Where an end user exercises a data subject right (access, correction, deletion) against
                data held by the Processor on the Controller's behalf, the Processor will notify the
                Controller and provide reasonable assistance to fulfill that request, consistent with the
                account-level export and deletion mechanisms available in the Portal.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">6. Security Incident Notification</h2>
              <p>
                If the Processor becomes aware of a security incident affecting the confidentiality,
                integrity, or availability of tenant data processed under this DPA, it will notify the
                affected Controller without undue delay after becoming aware, and provide information
                reasonably available at the time to help the Controller meet its own notification
                obligations.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">7. Data Retention and Deletion</h2>
              <p>
                Upon termination of the underlying service agreement, tenant data is retained only as
                required for legal, billing, or audit purposes, and is deleted or anonymized in accordance
                with the Controller's instructions and applicable law. Aggregate, de-identified data that
                cannot reasonably be linked back to a specific tenant may be retained for Platform
                improvement purposes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">8. International Data Transfers</h2>
              <p>
                The Platform's infrastructure and sub-processors are based in the United States. The
                Processor does not currently represent support for data residency requirements outside the
                United States; Controllers with cross-border transfer requirements beyond this should
                confirm fit before onboarding tenants subject to those requirements.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">9. Contact</h2>
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
