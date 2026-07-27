import { Link } from "wouter";
import { ArrowRight, MessageCircle, MapPin, Clock, ShieldCheck } from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { ChatCTA } from "@/components/ChatCTA";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

export default function Contact() {
  return (
    <Layout>
      <SEOMeta
        title="Contact | Shane McCaw Consulting"
        description="Get in touch with Shane McCaw Consulting — Microsoft 365 architecture, Copilot readiness, and security consulting based in Vero Beach, FL."
      />

      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-8">
            <MessageCircle className="w-3.5 h-3.5" />
            Contact
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            Talk to <GradientText>Shane</GradientText> directly
          </h1>
          <p className="text-lg text-text-secondary leading-relaxed mb-10">
            No contact form, no ticket queue — every question on this site goes straight to Shane through the chat. Ask about a service, a retainer, or just where to start.
          </p>
          <ChatCTA
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-semibold text-white text-base transition-opacity hover:opacity-90"
            style={GRADIENT_BG}
            data-track="cta"
          >
            Start a Conversation <ArrowRight className="w-4 h-4" />
          </ChatCTA>
        </div>
      </section>

      <section className="pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-6">
          <GlassPanel className="p-6 text-center">
            <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-accent-blue mx-auto mb-4">
              <MapPin className="w-5 h-5" />
            </div>
            <h2 className="font-display font-semibold text-text-primary mb-1">Based In</h2>
            <p className="text-sm text-text-secondary">Vero Beach, FL — working with clients nationwide</p>
          </GlassPanel>
          <GlassPanel className="p-6 text-center">
            <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-accent-blue mx-auto mb-4">
              <Clock className="w-5 h-5" />
            </div>
            <h2 className="font-display font-semibold text-text-primary mb-1">Response Time</h2>
            <p className="text-sm text-text-secondary">Most questions answered within one business day</p>
          </GlassPanel>
          <GlassPanel className="p-6 text-center">
            <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-accent-blue mx-auto mb-4">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h2 className="font-display font-semibold text-text-primary mb-1">Not Sure Where to Start?</h2>
            <p className="text-sm text-text-secondary">Take the free assessment — no call required first</p>
          </GlassPanel>
        </div>
      </section>

      <section className="pb-24 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-2xl mx-auto">
          <p className="text-text-secondary mb-6">
            Prefer to explore first? Start with a free assessment or browse what Shane can help with.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link
              href="/assessment"
              className="px-7 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 inline-flex items-center justify-center gap-2"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Start a Free Assessment
            </Link>
            <Link
              href="/services"
              className="px-7 py-3.5 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors"
              data-track="cta"
            >
              Browse Services
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
