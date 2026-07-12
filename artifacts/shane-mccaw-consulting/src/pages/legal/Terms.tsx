import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";

const EFFECTIVE_DATE = "July 1, 2025";
const CONTACT_EMAIL = "hello@shanemccawconsulting.com";
const SITE_URL = "shanemccawconsulting.com";

export default function Terms() {
  return (
    <Layout>
      <SEOMeta
        title="Terms of Service | Shane McCaw Consulting"
        description="Terms of service for use of the Shane McCaw Consulting website, contact forms, and marketing materials."
      />

      <div className="bg-white pt-[130px] pb-20">
        <div className="max-w-2xl mx-auto px-6">
          {/* Header */}
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Legal</p>
          <h1 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-2">
            Terms of Service
          </h1>
          <p className="text-muted-foreground text-sm mb-10">
            Effective date: {EFFECTIVE_DATE}
          </p>

          <div className="prose prose-sm max-w-none text-[#0A2540]/80 space-y-8">

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">1. About These Terms</h2>
              <p>
                These Terms of Service ("Terms") govern your access to and use of the website located at{" "}
                <span className="font-semibold">{SITE_URL}</span> (the "Site"), operated by Shane McCaw
                Consulting ("we," "us," or "our"). By visiting the Site, submitting a contact form, or
                otherwise interacting with our content, you agree to these Terms. If you do not agree,
                please do not use the Site.
              </p>
              <p className="mt-3">
                These Terms cover the marketing website only — they do not govern any paid consulting
                engagement, statement of work, or client portal agreement. Separate agreements apply to
                those relationships.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">2. Use of This Website</h2>
              <p>You may use the Site for lawful purposes and in accordance with these Terms. You agree not to:</p>
              <ul className="list-disc pl-6 mt-3 space-y-2">
                <li>Use the Site in any way that violates applicable laws or regulations</li>
                <li>
                  Transmit or submit any content that is unlawful, harmful, threatening, abusive, defamatory,
                  or otherwise objectionable
                </li>
                <li>
                  Attempt to gain unauthorized access to any portion of the Site or any systems connected to
                  the Site
                </li>
                <li>
                  Use automated tools (bots, scrapers, crawlers) to access the Site for purposes other than
                  legitimate search engine indexing
                </li>
                <li>
                  Interfere with or disrupt the integrity or performance of the Site or its underlying
                  infrastructure
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">3. Contact Forms and Inquiries</h2>
              <p>
                The Site includes a contact form that allows you to send us a message. When you submit a
                contact form, you consent to us collecting and using the information you provide (such as
                your name, email address, and message content) to respond to your inquiry.
              </p>
              <p className="mt-3">
                Submitting a contact form does not create a consulting or client relationship between you
                and Shane McCaw Consulting, and does not constitute an offer, acceptance, or agreement to
                provide any services. No attorney-client, fiduciary, or advisory relationship is formed
                through the use of this Site.
              </p>
              <p className="mt-3">
                We will not share your contact form submissions with third parties for their own marketing
                purposes. See our{" "}
                <Link href="/legal/privacy" className="text-[#0078D4] hover:underline">
                  Privacy Policy
                </Link>{" "}
                for full details on how your information is handled.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">4. Analytics and Cookies</h2>
              <p>
                This Site uses analytics tools to understand how visitors interact with our content. These
                tools may collect information such as your browser type, operating system, referring URLs,
                pages visited, and time spent on pages. This information is used in aggregate to improve the
                Site and is not used to personally identify individual visitors.
              </p>
              <p className="mt-3">
                The Site may use cookies or similar tracking technologies to support analytics and remember
                your preferences. Most browsers allow you to refuse cookies or to be alerted when cookies
                are being sent. If you disable cookies, some functionality of the Site may not work as
                intended.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">5. Intellectual Property</h2>
              <p>
                All content on this Site — including text, graphics, logos, page layouts, and code — is
                owned by or licensed to Shane McCaw Consulting and is protected by applicable intellectual
                property laws. You may not reproduce, distribute, modify, or create derivative works from
                any content on this Site without our express written permission.
              </p>
              <p className="mt-3">
                You may share links to publicly accessible pages on this Site for informational purposes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">6. Third-Party Links</h2>
              <p>
                The Site may contain links to third-party websites or services that are not owned or
                controlled by Shane McCaw Consulting. We have no control over, and assume no responsibility
                for, the content, privacy policies, or practices of any third-party sites. We encourage you
                to review the terms and privacy policies of any third-party sites you visit.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">7. Disclaimer of Warranties</h2>
              <p>
                The Site and its content are provided on an "as is" and "as available" basis without
                warranties of any kind, either express or implied, including but not limited to warranties of
                merchantability, fitness for a particular purpose, or non-infringement. We do not warrant
                that the Site will be uninterrupted, error-free, or free of viruses or other harmful
                components.
              </p>
              <p className="mt-3">
                Nothing on this Site constitutes professional advice of any kind. Content is provided for
                general informational purposes only.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">8. Limitation of Liability</h2>
              <p>
                To the fullest extent permitted by applicable law, Shane McCaw Consulting shall not be
                liable for any indirect, incidental, special, consequential, or punitive damages arising
                from your use of, or inability to use, the Site or its content — even if we have been
                advised of the possibility of such damages.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">9. Changes to These Terms</h2>
              <p>
                We reserve the right to update or modify these Terms at any time. When we make changes, we
                will update the effective date at the top of this page. Your continued use of the Site after
                any changes constitutes your acceptance of the updated Terms. We encourage you to review
                these Terms periodically.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">10. Governing Law</h2>
              <p>
                These Terms are governed by and construed in accordance with the laws of the United States,
                without regard to its conflict of law provisions. Any disputes arising under these Terms
                shall be subject to the exclusive jurisdiction of the courts located in the United States.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-extrabold text-[#0A2540] mb-3">11. Contact Us</h2>
              <p>
                If you have questions about these Terms, please contact us at:
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
                <Link href="/legal/privacy" className="text-[#0078D4] hover:underline">
                  Privacy Policy
                </Link>
              </p>
            </div>

          </div>
        </div>
      </div>
    </Layout>
  );
}
