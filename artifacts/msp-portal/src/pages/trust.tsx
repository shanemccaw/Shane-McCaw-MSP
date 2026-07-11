import { ShieldCheck, Lock, Eye, FileText, Server, Users } from "lucide-react";

export default function TrustPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="bg-sidebar border-b border-sidebar-border">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <ShieldCheck className="size-8 text-sidebar-primary" />
            <h1 className="text-2xl font-bold text-sidebar-foreground">Trust &amp; Security</h1>
          </div>
          <p className="text-sidebar-foreground/70 max-w-2xl">
            Shane McCaw Consulting is committed to protecting your data and operating transparently.
            This page summarises our practices.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-12 space-y-12">

        {/* Pillars */}
        <section className="grid sm:grid-cols-3 gap-6">
          {[
            { icon: Lock,     title: "Data Security",    body: "Data is encrypted in transit (TLS 1.3) and at rest. Access is role-scoped and audited." },
            { icon: Eye,      title: "Transparency",     body: "We log every privileged action. Audit trails are immutable and available to PlatformAdmins." },
            { icon: Server,   title: "Infrastructure",   body: "Hosted on hardened cloud infrastructure with automated backups and disaster-recovery procedures." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-border bg-card p-5 space-y-2">
              <div className="flex items-center gap-2 text-primary">
                <Icon className="size-5" />
                <h3 className="font-semibold text-sm">{title}</h3>
              </div>
              <p className="text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>

        {/* Terms of Service */}
        <section id="terms" className="space-y-4">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-primary" />
            <h2 className="text-xl font-semibold">Terms of Service</h2>
          </div>
          <div className="rounded-lg border border-border bg-card p-6 prose prose-sm max-w-none text-muted-foreground leading-relaxed space-y-3">
            <p>
              By accessing or using the Shane McCaw Consulting MSP Platform ("Platform"), you agree
              to these Terms of Service ("Terms"). The Platform is provided to authorised Managed
              Service Providers ("MSPs") and their customers for the delivery of Microsoft 365
              consulting services.
            </p>
            <p>
              <strong className="text-foreground">Access and accounts.</strong> Access is provisioned
              by the Platform administrator. You are responsible for maintaining the confidentiality
              of your credentials and for all activities that occur under your account.
            </p>
            <p>
              <strong className="text-foreground">Acceptable use.</strong> You may not use the Platform
              for any unlawful purpose, to transmit harmful or fraudulent content, or to attempt
              unauthorised access to any system.
            </p>
            <p>
              <strong className="text-foreground">Intellectual property.</strong> All Platform software,
              content, and deliverables remain the property of Shane McCaw Consulting unless explicitly
              transferred in a signed Statement of Work.
            </p>
            <p>
              <strong className="text-foreground">Limitation of liability.</strong> The Platform is
              provided "as is." Shane McCaw Consulting shall not be liable for indirect, incidental,
              or consequential damages arising from Platform use.
            </p>
            <p>
              <strong className="text-foreground">Governing law.</strong> These Terms are governed by
              the laws of the State of Virginia, United States.
            </p>
            <p className="text-xs italic">Last updated: July 2026</p>
          </div>
        </section>

        {/* Privacy Policy */}
        <section id="privacy" className="space-y-4">
          <div className="flex items-center gap-2">
            <Eye className="size-5 text-primary" />
            <h2 className="text-xl font-semibold">Privacy Policy</h2>
          </div>
          <div className="rounded-lg border border-border bg-card p-6 prose prose-sm max-w-none text-muted-foreground leading-relaxed space-y-3">
            <p>
              Shane McCaw Consulting ("we", "us") collects and processes personal data only as
              necessary to deliver the services described in the Platform MSA and any applicable
              Statement of Work.
            </p>
            <p>
              <strong className="text-foreground">What we collect.</strong> Name, email address,
              company name, IP address, and usage logs. We do not sell personal data to third parties.
            </p>
            <p>
              <strong className="text-foreground">How we use it.</strong> To provision and operate the
              Platform, communicate about service delivery, comply with legal obligations, and improve
              the Platform.
            </p>
            <p>
              <strong className="text-foreground">Data retention.</strong> Account data is retained
              for the duration of the contractual relationship plus a statutory retention period of
              seven years, or as required by applicable law.
            </p>
            <p>
              <strong className="text-foreground">Your rights.</strong> You may request access,
              correction, or deletion of your personal data by contacting{" "}
              <a href="mailto:privacy@shanemccawconsulting.com" className="text-primary underline">
                privacy@shanemccawconsulting.com
              </a>.
            </p>
            <p>
              <strong className="text-foreground">Cookies.</strong> We use session-scoped, httpOnly
              cookies solely for authentication. No tracking or advertising cookies are set.
            </p>
            <p className="text-xs italic">Last updated: July 2026</p>
          </div>
        </section>

        {/* Contact */}
        <section id="contact" className="space-y-4">
          <div className="flex items-center gap-2">
            <Users className="size-5 text-primary" />
            <h2 className="text-xl font-semibold">Contact</h2>
          </div>
          <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground space-y-2">
            <p>For security disclosures, privacy requests, or legal questions:</p>
            <p>
              <strong className="text-foreground">Email:</strong>{" "}
              <a href="mailto:legal@shanemccawconsulting.com" className="text-primary underline">
                legal@shanemccawconsulting.com
              </a>
            </p>
            <p>
              <strong className="text-foreground">Company:</strong> Shane McCaw Consulting LLC
            </p>
          </div>
        </section>

      </div>

      {/* Footer */}
      <div className="border-t border-border mt-12 py-6 text-center text-xs text-muted-foreground">
        <p>
          &copy; {new Date().getFullYear()} Shane McCaw Consulting LLC — All rights reserved ·{" "}
          <a href="#terms" className="hover:text-foreground">Terms</a> ·{" "}
          <a href="#privacy" className="hover:text-foreground">Privacy</a>
        </p>
      </div>
    </div>
  );
}
