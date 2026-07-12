import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";

const EFFECTIVE_DATE = "July 1, 2025";
const CONTACT_EMAIL = "hello@shanemccawconsulting.com";
const SITE_URL = "shanemccawconsulting.com";

export default function LegalPrivacy() {
  return (
    <Layout>
      <SEOMeta
        title="Privacy Policy | Shane McCaw Consulting"
        description="Privacy policy for the Shane McCaw Consulting website — how we collect, use, and protect your information."
      />

      <div className="bg-white pt-[130px] pb-20">
        <div className="max-w-2xl mx-auto px-6">
          {/* Header */}
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Legal</p>
          <h1 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-2">
            Privacy Policy
          </h1>
          <p className="text-muted-foreground text-sm mb-10">
            Effective date: {EFFECTIVE_DATE}
          </p>

          <div className="prose prose-sm max-w-none text-[#0A2540]/80 space-y-8">

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">1. Introduction</h2>
              <p>
                Shane McCaw Consulting ("we," "us," or "our") operates the website at{" "}
                <span className="font-semibold">{SITE_URL}</span> (the "Site"). This Privacy Policy
                describes how we collect, use, and protect information when you visit the Site, submit a
                contact form, or otherwise interact with our content.
              </p>
              <p className="mt-3">
                By using the Site, you agree to the practices described in this Privacy Policy. This policy
                covers the marketing website only and does not apply to any separate client portal, project
                management system, or paid engagement governed by a distinct agreement.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">2. Information We Collect</h2>

              <h3 className="font-bold text-[#0A2540] mt-4 mb-2">2.1 Information You Provide</h3>
              <p>
                When you submit a contact form or inquiry on the Site, we collect the information you
                voluntarily provide, which may include:
              </p>
              <ul className="list-disc pl-6 mt-2 space-y-1">
                <li>Your name</li>
                <li>Your email address</li>
                <li>Your organization name (if provided)</li>
                <li>The content of your message</li>
                <li>Any other information you choose to include in your submission</li>
              </ul>

              <h3 className="font-bold text-[#0A2540] mt-4 mb-2">2.2 Information Collected Automatically</h3>
              <p>
                When you visit the Site, certain information is collected automatically by our servers and
                analytics tools. This may include:
              </p>
              <ul className="list-disc pl-6 mt-2 space-y-1">
                <li>Your IP address (which may indicate your general geographic region)</li>
                <li>Browser type and version</li>
                <li>Operating system</li>
                <li>Referring URL (the page you came from before visiting our Site)</li>
                <li>Pages visited and time spent on each page</li>
                <li>Date and time of your visit</li>
              </ul>
              <p className="mt-3">
                This automatically collected information is used in aggregate to understand how visitors
                interact with the Site and to improve our content and user experience.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">3. How We Use Your Information</h2>
              <p>We use the information we collect for the following purposes:</p>
              <ul className="list-disc pl-6 mt-3 space-y-2">
                <li>
                  <span className="font-semibold">Responding to inquiries:</span> When you submit a contact
                  form, we use your name and email address to respond to your message.
                </li>
                <li>
                  <span className="font-semibold">Improving the Site:</span> Aggregate analytics data helps
                  us understand which content is most useful and identify areas for improvement.
                </li>
                <li>
                  <span className="font-semibold">Security and fraud prevention:</span> We may use
                  automatically collected information to monitor for and protect against unauthorized access
                  or misuse.
                </li>
                <li>
                  <span className="font-semibold">Legal compliance:</span> We may use or disclose
                  information as required by applicable law or legal process.
                </li>
              </ul>
              <p className="mt-3">
                We do not use your personal information for automated decision-making or profiling, and we
                do not sell your personal information to third parties.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">4. Cookies and Tracking Technologies</h2>
              <p>
                The Site may use cookies and similar tracking technologies. Cookies are small text files
                placed on your device by your browser when you visit a website.
              </p>
              <p className="mt-3">We may use the following types of cookies:</p>
              <ul className="list-disc pl-6 mt-2 space-y-2">
                <li>
                  <span className="font-semibold">Strictly necessary cookies:</span> Required for the Site
                  to function and cannot be switched off. They are typically set in response to actions you
                  take such as setting your preferences.
                </li>
                <li>
                  <span className="font-semibold">Analytics cookies:</span> Help us understand how visitors
                  interact with the Site by collecting and reporting information anonymously.
                </li>
              </ul>
              <p className="mt-3">
                You can control cookies through your browser settings. Most browsers allow you to refuse
                cookies, delete existing cookies, or be notified when a new cookie is set. If you disable
                cookies, some features of the Site may not work as intended.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">5. Third-Party Services</h2>
              <p>
                We use a limited number of third-party services to operate the Site. These services may
                process certain information on our behalf. We take reasonable steps to ensure that any
                third-party providers we use maintain appropriate data protection standards.
              </p>
              <p className="mt-3">Third-party services we may use include:</p>
              <ul className="list-disc pl-6 mt-2 space-y-1">
                <li>Web analytics platforms (for understanding site usage)</li>
                <li>Email delivery services (for delivering responses to contact form submissions)</li>
                <li>Web hosting and content delivery infrastructure</li>
              </ul>
              <p className="mt-3">
                These providers are authorized to use your information only as necessary to provide services
                to us and are bound by their own privacy policies.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">6. Data Retention</h2>
              <p>
                We retain contact form submissions for as long as necessary to respond to your inquiry and
                for a reasonable period afterward in case of follow-up questions. If you would like us to
                delete your submission, please contact us at the address below.
              </p>
              <p className="mt-3">
                Aggregate analytics data that cannot be used to identify individual users may be retained
                indefinitely for business planning and Site improvement purposes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">7. Data Security</h2>
              <p>
                We implement reasonable technical and organizational measures to protect your information
                against unauthorized access, alteration, disclosure, or destruction. However, no method of
                transmission over the internet or method of electronic storage is completely secure. While
                we strive to use commercially acceptable means to protect your information, we cannot
                guarantee absolute security.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">8. Children's Privacy</h2>
              <p>
                This Site is not directed at individuals under the age of 18, and we do not knowingly
                collect personal information from children. If you believe we have inadvertently collected
                information from a child, please contact us immediately.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">9. Your Rights and Choices</h2>
              <p>
                Depending on your location, you may have certain rights regarding your personal information,
                including:
              </p>
              <ul className="list-disc pl-6 mt-3 space-y-1">
                <li>The right to access personal information we hold about you</li>
                <li>The right to request correction of inaccurate information</li>
                <li>The right to request deletion of your personal information</li>
                <li>The right to object to processing of your personal information</li>
                <li>The right to withdraw consent where processing is based on consent</li>
              </ul>
              <p className="mt-3">
                To exercise any of these rights, please contact us at the address below. We will respond to
                your request in accordance with applicable law.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">10. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. When we make changes, we will update
                the effective date at the top of this page. Your continued use of the Site after any changes
                constitutes your acceptance of the updated policy. We encourage you to review this policy
                periodically.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">11. Contact Us</h2>
              <p>
                If you have questions about this Privacy Policy or wish to exercise your rights, please
                contact us at:
              </p>
              <div className="mt-3 bg-[#F7F9FC] border border-border rounded-xl p-5">
                <p className="font-semibold text-[#0A2540]">Shane McCaw Consulting</p>
                <p className="text-muted-foreground text-sm mt-1">
                  Email:{" "}
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                    className="text-[#0078D4] hover:underline"
                  >
                    {CONTACT_EMAIL}
                  </a>
                </p>
                <p className="text-muted-foreground text-sm">
                  Website:{" "}
                  <a href={`https://${SITE_URL}`} className="text-[#0078D4] hover:underline">
                    {SITE_URL}
                  </a>
                </p>
              </div>
            </section>

            <div className="pt-6 border-t border-border">
              <p className="text-muted-foreground text-sm">
                See also:{" "}
                <Link href="/legal/terms" className="text-[#0078D4] hover:underline">
                  Terms of Service
                </Link>
              </p>
            </div>

          </div>
        </div>
      </div>
    </Layout>
  );
}
