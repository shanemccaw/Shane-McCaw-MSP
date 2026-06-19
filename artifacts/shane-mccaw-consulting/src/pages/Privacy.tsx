import React from "react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";

export default function Privacy() {
  return (
    <Layout>
      <SEOMeta
        title="Privacy Policy | Shane McCaw Consulting"
        description="Privacy Policy for Shane McCaw Consulting. Learn how we collect, use, and protect your personal data."
      />
      <div className="bg-[#F7F9FC] min-h-screen py-16">
        <div className="max-w-[800px] mx-auto px-6">
          <h1 className="text-4xl font-bold text-[#0A2540] mb-3">Privacy Policy</h1>
          <p className="text-sm text-gray-500 mb-10">Effective Date: June 19, 2026</p>

          <div className="prose prose-slate max-w-none space-y-8 text-gray-700 leading-relaxed">

            <section>
              <h2 className="text-xl font-semibold text-[#0A2540] mb-3">1. Overview</h2>
              <p>
                Shane McCaw Consulting ("we," "us," or "our") respects your privacy and is committed
                to protecting the personal information you share with us. This Privacy Policy explains
                what information we collect, how we use it, and the choices you have regarding your
                information when you visit <strong>shanemccawconsulting.com</strong> or contact us
                through any of our channels.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-[#0A2540] mb-3">2. Information We Collect</h2>
              <p>We may collect the following categories of information:</p>
              <ul className="list-disc pl-6 mt-2 space-y-2">
                <li>
                  <strong>Contact information</strong> — name, email address, phone number, and
                  company name provided when you submit a contact or inquiry form.
                </li>
                <li>
                  <strong>Scheduling information</strong> — when you book a consultation through
                  Calendly, Calendly's own privacy policy governs the data collected at that step.
                </li>
                <li>
                  <strong>Usage data</strong> — standard server logs and analytics (pages visited,
                  time on site, browser type) collected automatically when you browse this website.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-[#0A2540] mb-3">3. How We Use Your Information</h2>
              <p>We use the information we collect to:</p>
              <ul className="list-disc pl-6 mt-2 space-y-2">
                <li>Respond to inquiries and provide consulting services.</li>
                <li>Schedule and manage consultation appointments.</li>
                <li>Send follow-up communications relevant to your inquiry.</li>
                <li>Improve the content and performance of this website.</li>
              </ul>
              <p className="mt-3">
                We do not sell, rent, or trade your personal information to third parties for their
                marketing purposes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-[#0A2540] mb-3">4. Third-Party Services</h2>
              <p>
                This website may use third-party tools such as Calendly for scheduling. Each
                third-party service is governed by its own privacy policy. We encourage you to review
                those policies before providing your information to those services.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-[#0A2540] mb-3">5. Data Retention</h2>
              <p>
                We retain contact form submissions and related correspondence for as long as necessary
                to fulfill the purpose for which they were collected or as required by applicable law.
                You may request deletion of your data at any time by contacting us directly.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-[#0A2540] mb-3">6. Security</h2>
              <p>
                We take reasonable technical and organizational measures to protect your personal
                information against unauthorized access, disclosure, or destruction. No method of
                transmission over the internet is 100% secure, however, and we cannot guarantee
                absolute security.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-[#0A2540] mb-3">7. Your Rights</h2>
              <p>
                Depending on your location, you may have the right to access, correct, or request
                deletion of the personal information we hold about you. To exercise any of these
                rights, please contact us at the address below.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-[#0A2540] mb-3">8. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. When we do, we will revise the
                "Effective Date" at the top of this page. Continued use of this website after any
                changes constitutes your acceptance of the revised policy.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-[#0A2540] mb-3">9. Contact Us</h2>
              <p>
                If you have questions or concerns about this Privacy Policy, please reach out:
              </p>
              <address className="not-italic mt-3 space-y-1">
                <p className="font-semibold text-[#0A2540]">Shane McCaw Consulting</p>
                <p>Vero Beach, FL</p>
                <p>
                  Email:{" "}
                  <a
                    href="mailto:shane@shanemccawconsulting.com"
                    className="text-[#0078D4] hover:underline"
                  >
                    shane@shanemccawconsulting.com
                  </a>
                </p>
              </address>
            </section>

          </div>
        </div>
      </div>
    </Layout>
  );
}
