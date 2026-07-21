import { Link } from "wouter";

export function ConsultationCTA() {
  return (
    <section
      className="relative bg-charcoal-0 py-28 overflow-hidden"
      data-testid="consultation-cta-section"
    >
      {/* Radial glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(91,141,239,0.18) 0%, transparent 75%)",
        }}
      />
      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="relative max-w-[860px] mx-auto px-6 text-center">
        <p className="text-accent-blue text-sm font-semibold uppercase tracking-widest mb-4">
          Free 30-Minute Discovery Call
        </p>
        <h2 className="text-4xl md:text-5xl font-extrabold text-text-primary leading-tight mb-6">
          Your Microsoft 365 Environment Deserves Senior Expertise
        </h2>
        <p className="text-text-secondary text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
          Work directly with Shane — a 30-year Microsoft veteran and Lead M365 Architect at NASA. No account managers, no junior staff. Just clear, actionable guidance from day one.
        </p>
        <Link
          href="/book"
          className="inline-flex items-center justify-center text-lg px-12 py-5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
          data-testid="consultation-cta-button"
          data-track="cta"
        >
          Book a Consultation
        </Link>
        <p className="mt-5 text-text-tertiary text-sm tracking-wide">
          No pitch. No obligation. Just clarity.
        </p>
      </div>
    </section>
  );
}
