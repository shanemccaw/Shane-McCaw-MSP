import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import { ContactChatWidget } from "@/components/ContactChatWidget";
import { PortalSupportHandoff } from "@/components/PortalSupportHandoff";
import { Mail, MapPin, Clock, MessageSquare } from "lucide-react";
import { usePersonalizationState } from "@/hooks/usePersonalizationState";
import { usePortalUrl } from "@/hooks/usePersonalizationData";
import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

export default function Contact() {
  const { tier } = usePersonalizationState();
  const { portalUrl } = usePortalUrl();

  useEffect(() => {
    if (tier === "assessment" && portalUrl) {
      trackEvent("personalization_shown", { tier: "assessment", surface: "contact_portal_handoff" });
    }
  }, [tier, portalUrl]);

  return (
    <Layout>
      <SEOMeta
        title="Contact Shane McCaw | Microsoft 365 Consultant | Shane McCaw Consulting"
        description="Contact Shane McCaw — NASA's Lead Microsoft 365 Architect. Get expert answers about M365, Copilot AI, SharePoint, and governance. Expect a personal response within 1 business day."
      />

      {/* HERO */}
      <section className="relative pt-32 sm:pt-40 pb-12 px-4 sm:px-6 lg:px-8 text-center overflow-hidden">
        <div className="max-w-5xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <MessageSquare className="w-4 h-4" />
            Direct Line — No Account Managers
          </div>
          <h1 className="font-display text-4xl sm:text-6xl font-bold text-text-primary tracking-tight leading-tight max-w-4xl mx-auto mb-6">
            Get in <GradientText>Touch</GradientText>
          </h1>
          <p className="text-lg sm:text-xl text-text-secondary max-w-3xl mx-auto leading-relaxed mb-10">
            You're contacting the Lead M365 Architect at NASA. Tell me what you're dealing
            with and you'll get a straight, senior-level answer on whether and how I can
            help — no fluff, no sales pitch.
          </p>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-3xl mx-auto">
            <StatPanel label="Response Time" value="1 Day" />
            <StatPanel label="Experience" value="30 Years" />
            <StatPanel label="Background" value="NASA Lead Architect" />
            <StatPanel label="Who You Reach" value="Shane, Directly" />
          </div>
        </div>
      </section>

      {/* WHO I WORK WITH */}
      <section className="pb-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06] pt-16">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs uppercase tracking-widest text-text-secondary mb-6">Who I Work With</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { title: "Mid-Market Organizations", desc: "200–2,000 employees ready to modernize their Microsoft 365 environment at scale." },
              { title: "Regulated Industries", desc: "Healthcare, finance, and legal organizations with strict compliance requirements." },
              { title: "Growing IT Teams", desc: "Internal teams that need a senior architect's judgment without a full-time hire." },
              { title: "Scaling Startups", desc: "Fast-growing organizations building a Microsoft 365 foundation that can handle compliance from day one." },
            ].map(({ title, desc }) => (
              <div key={title} className="flex items-start gap-3 p-5 rounded-2xl bg-charcoal-1 border border-white/[0.06]">
                <div className="w-2 h-2 rounded-full bg-accent-blue mt-1.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-text-primary text-sm">{title}</p>
                  <p className="text-text-secondary text-xs mt-1 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CHAT + SIDEBAR */}
      <section className="pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

            {/* Chat */}
            <div className="lg:col-span-2 flex flex-col">

              {/* Why People Contact Me */}
              <div className="mb-6">
                <h3 className="font-display text-base font-bold text-text-primary mb-3">Why People Contact Me</h3>
                <ul className="space-y-2">
                  {[
                    "Planning a Microsoft 365 migration, consolidation, or tenant-to-tenant move",
                    "Rolling out Copilot AI and need to get governance right before it becomes a liability",
                    "SharePoint has become a mess — sprawl, stale content, broken governance",
                    "Power Platform is growing ungoverned and nobody owns the strategy",
                    "Preparing for a HIPAA, SOC 2, or similar compliance audit",
                    "Current Microsoft partner or consultant isn't delivering senior-level architecture thinking",
                  ].map((reason) => (
                    <li key={reason} className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="text-accent-blue font-bold leading-5 flex-shrink-0">·</span>
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Micro-positioning */}
              <p className="text-text-secondary text-sm font-medium border-l-4 border-accent-blue/40 pl-4 py-1 mb-5">
                You'll speak directly with me — no account managers, no junior staff, no outsourcing.
              </p>

              {tier === "assessment" && portalUrl ? (
                <PortalSupportHandoff portalUrl={portalUrl} surface="contact_portal_handoff" />
              ) : (
                <ContactChatWidget style={{ minHeight: "520px" }} />
              )}

              {/* What Happens Next */}
              <div className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6 mt-6">
                <h4 className="font-display font-bold text-text-primary mb-4">What Happens Next</h4>
                <ol className="space-y-3">
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center mt-0.5" style={GRADIENT_BG}>1</span>
                    <div>
                      <p className="text-sm font-semibold text-text-primary">Review</p>
                      <p className="text-text-secondary text-sm">I read every message within 1 business day.</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center mt-0.5" style={GRADIENT_BG}>2</span>
                    <div>
                      <p className="text-sm font-semibold text-text-primary">Clarity</p>
                      <p className="text-text-secondary text-sm">You get a direct recommendation or a clear next step — no fluff.</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center mt-0.5" style={GRADIENT_BG}>3</span>
                    <div>
                      <p className="text-sm font-semibold text-text-primary">Call</p>
                      <p className="text-text-secondary text-sm">If it's a fit, we schedule a free 30-minute discovery call.</p>
                    </div>
                  </li>
                </ol>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              <div className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
                <div className="flex items-start gap-3 mb-4">
                  <Clock className="w-5 h-5 text-accent-blue mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-display font-bold text-text-primary mb-1">Personal Response</h4>
                    <p className="text-text-secondary text-sm">I personally respond to every inquiry within 1 business day.</p>
                  </div>
                </div>
              </div>

              <div className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
                <div className="flex items-start gap-3 mb-4">
                  <Mail className="w-5 h-5 text-accent-blue mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-display font-bold text-text-primary mb-1">Direct Email</h4>
                    <a href="mailto:info@shanemccaw.com" className="text-accent-blue text-sm hover:underline" data-testid="contact-email">
                      info@shanemccaw.com
                    </a>
                  </div>
                </div>
              </div>

              <div className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-accent-blue mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-display font-bold text-text-primary mb-1">Location</h4>
                    <p className="text-text-secondary text-sm">Based in Vero Beach, FL.</p>
                    <p className="text-text-secondary text-sm">Serving clients nationwide via remote engagement.</p>
                  </div>
                </div>
              </div>

              <GlassPanel className="p-6">
                <h4 className="font-display font-bold text-text-primary mb-2">Prefer to skip the form?</h4>
                <p className="text-text-secondary text-sm mb-1">Book directly on my calendar.</p>
                <p className="text-text-secondary text-xs mb-4">You'll speak directly with me — no junior staff.</p>
                <a
                  href="/book"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-white text-sm font-semibold transition-opacity hover:opacity-90"
                  style={GRADIENT_BG}
                  data-track="cta"
                  data-testid="contact-book-link"
                >
                  Book a Free Call
                </a>
              </GlassPanel>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="pb-24 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <GlassPanel className="p-8 sm:p-12">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Your Microsoft 365 environment deserves <GradientText>senior expertise</GradientText>.
            </h2>
            <p className="text-text-secondary max-w-xl mx-auto mb-8 text-sm sm:text-base">
              Reach out and get clarity from someone who architects at NASA scale.
            </p>
            <a
              href="/book"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Book a Free Call
            </a>
          </GlassPanel>
        </div>
      </section>
    </Layout>
  );
}
