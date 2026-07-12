import { useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { useCatalog, type MonitoringTier } from "@/hooks/useCatalog";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  ArrowRight,
  Loader2,
  AlertCircle,
  Shield,
  Eye,
  Zap,
  Users,
  Phone,
  Minus,
} from "lucide-react";

function fmtDollars(dollars: number): string {
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 });
}

function computeTotal(perSeatDollars: string | null, seats: number): number | null {
  if (!perSeatDollars) return null;
  const n = parseFloat(perSeatDollars);
  if (isNaN(n)) return null;
  return Math.round(n * seats);
}

/** Catalog-driven: a tier without a price is a "contact us" tier. */
function isContactUsTier(t: MonitoringTier): boolean {
  return !t.price;
}

function SeatInput({ seats, onChange }: { seats: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => onChange(Math.max(1, seats - 5))}
        className="w-9 h-9 rounded-full border border-border bg-white flex items-center justify-center text-[#0A2540] font-bold hover:border-[#0078D4] transition-colors"
        aria-label="Decrease seats"
      >
        <Minus className="size-4" />
      </button>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={10000}
          value={seats}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v) && v >= 1) onChange(v);
          }}
          className="w-20 text-center text-xl font-bold text-[#0A2540] border border-border rounded-lg py-2 focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
        />
        <span className="text-muted-foreground text-sm">seats</span>
      </div>
      <button
        onClick={() => onChange(seats + 5)}
        className="w-9 h-9 rounded-full border border-border bg-white flex items-center justify-center text-[#0A2540] font-bold hover:border-[#0078D4] transition-colors"
        aria-label="Increase seats"
      >
        +
      </button>
    </div>
  );
}

interface PackCardProps {
  tier: MonitoringTier;
  seats: number;
}

function PackCard({ tier, seats }: PackCardProps) {
  const hl = tier.highlighted;
  const features = tier.features ?? [];
  const contactUs = isContactUsTier(tier);
  const totalDollars = contactUs ? null : computeTotal(tier.price, seats);
  const hasCheckout = !contactUs && !!tier.fulfillmentTypeKey && !!tier.slug;

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-8 h-full transition-all duration-300 hover:shadow-lg hover:-translate-y-1 ${
        hl
          ? "bg-[#0A2540] border-[#0078D4]/60 shadow-xl ring-2 ring-[#0078D4]/20"
          : "bg-white border-border shadow-sm"
      }`}
    >
      {tier.badge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="bg-[#0078D4] text-white text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full whitespace-nowrap">
            {tier.badge}
          </span>
        </div>
      )}

      <div className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider mb-4 ${hl ? "text-[#00B4D8]" : "text-[#0078D4]"}`}>
        <Shield className="size-3.5" />
        {tier.name}
      </div>

      {contactUs ? (
        <div className="mb-4">
          <p className={`text-2xl font-extrabold ${hl ? "text-white" : "text-[#0A2540]"}`}>Custom pricing</p>
          <p className={`text-sm mt-0.5 ${hl ? "text-white/50" : "text-muted-foreground"}`}>Scoped to your environment</p>
        </div>
      ) : (
        <div className="mb-4">
          {totalDollars !== null ? (
            <>
              <p className="text-[#0078D4] text-3xl font-extrabold">{fmtDollars(totalDollars)}<span className="text-base font-normal text-muted-foreground">/mo</span></p>
              <p className={`text-xs mt-0.5 ${hl ? "text-white/40" : "text-muted-foreground"}`}>
                {tier.price ? fmtDollars(parseFloat(tier.price)) : "—"} per seat · {seats} seats
              </p>
            </>
          ) : (
            <p className={`text-2xl font-bold ${hl ? "text-white" : "text-[#0A2540]"}`}>—</p>
          )}
        </div>
      )}

      {(tier.tagline ?? tier.description) && (
        <p className={`text-sm mb-5 leading-relaxed ${hl ? "text-white/60" : "text-foreground/70"}`}>
          {tier.tagline ?? ""}
        </p>
      )}

      {features.length > 0 && (
        <ul className="space-y-2 mb-6 flex-1">
          {features.map((f, i) => (
            <li key={i} className={`flex items-start gap-2 text-sm ${hl ? "text-white/80" : "text-foreground"}`}>
              <CheckCircle2 className="size-4 text-[#0078D4] shrink-0 mt-0.5" />
              {f}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto pt-4">
        {contactUs ? (
          <Link href="/contact">
            <Button variant="outline" className={`w-full ${hl ? "border-white/30 text-white hover:bg-white/10" : ""}`}>
              Contact us <ArrowRight className="ml-2 size-4" />
            </Button>
          </Link>
        ) : !tier.fulfillmentTypeKey ? (
          <Button disabled className="w-full" variant="outline">
            Coming soon
          </Button>
        ) : (
          <Link href={`/checkout?product=${tier.slug ?? ""}&seats=${seats}`}>
            <Button className={`w-full ${hl ? "" : "bg-[#0A2540] hover:bg-[#0A2540]/90"}`}>
              Get Started <ArrowRight className="ml-2 size-4" />
            </Button>
          </Link>
        )}
        {!contactUs && hasCheckout && (
          <p className={`text-xs text-center mt-2 ${hl ? "text-white/40" : "text-muted-foreground"}`}>
            No minimum term · cancel anytime
          </p>
        )}
      </div>
    </div>
  );
}

export default function Monitoring() {
  const { monitoringTiers, loading, error } = useCatalog();
  const [seats, setSeats] = useState(25);

  const sorted = [...monitoringTiers].sort((a, b) => a.sortOrder - b.sortOrder);
  const visible = sorted.filter((t) => {
    const min = t.seatMin ?? 1;
    const max = t.seatMax ?? Infinity;
    return seats >= min && seats <= max;
  });

  return (
    <Layout>
      <SEOMeta
        title="M365 Tenant Monitoring | Shane McCaw Consulting"
        description="Continuous Microsoft 365 tenant monitoring to catch configuration drift, security gaps, and licence waste before they become problems."
      />

      {/* Hero */}
      <section className="bg-[#0A2540] pt-[130px] pb-20 px-6 text-center">
        <div className="max-w-[860px] mx-auto">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full mb-6">
            <Eye className="size-3.5 text-[#00B4D8]" />
            Your Assessment Was a Snapshot. This Keeps It Current.
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-6 leading-tight">
            Continuous Microsoft 365 oversight, not a once-a-year checkup.
          </h1>
          <p className="text-white/70 text-lg max-w-2xl mx-auto leading-relaxed mb-8">
            The same signals your Assessment found — tracked, scored, and alerted on, every day.
          </p>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-white/50">
            <span className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-[#00B4D8]" /> No agents to deploy</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-[#00B4D8]" /> Weekly signal reports</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-[#00B4D8]" /> Escalate to Shane directly</span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-white py-16 px-6 border-b border-border">
        <div className="max-w-[960px] mx-auto">
          <h2 className="text-center text-2xl font-extrabold text-[#0A2540] mb-10">How it works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-[#0078D4]/10 flex items-center justify-center mb-4">
                <Zap className="size-8 text-[#0078D4]" />
              </div>
              <h3 className="text-lg font-bold text-[#0A2540] mb-2">Connect once (consent, not credentials)</h3>
              <p className="text-sm text-foreground/70 leading-relaxed">
                Grant read-only access to your Microsoft 365 tenant via admin consent. No agents, no software to install.
              </p>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-[#0078D4]/10 flex items-center justify-center mb-4">
                <Eye className="size-8 text-[#0078D4]" />
              </div>
              <h3 className="text-lg font-bold text-[#0A2540] mb-2">We watch continuously</h3>
              <p className="text-sm text-foreground/70 leading-relaxed">
                Shane's monitoring engine continuously evaluates your tenant against your pack's signal library — configuration, security, licence, and compliance checks.
              </p>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-[#0078D4]/10 flex items-center justify-center mb-4">
                <Shield className="size-8 text-[#0078D4]" />
              </div>
              <h3 className="text-lg font-bold text-[#0A2540] mb-2">You act only when something actually changes.</h3>
              <p className="text-sm text-foreground/70 leading-relaxed">
                Receive a weekly signal digest. Critical signals trigger an immediate notification so you can remediate fast — or escalate to Shane for hands-on help.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Seat count selector */}
      <section className="bg-[#F7F9FC] py-10 px-6 border-b border-border">
        <div className="max-w-[640px] mx-auto text-center">
          <h2 className="text-lg font-bold text-[#0A2540] mb-2 flex items-center justify-center gap-2">
            <Users className="size-5 text-[#0078D4]" />
            How many licensed M365 seats does your organisation have?
          </h2>
          <p className="text-sm text-muted-foreground mb-5">Pricing adjusts live as you change the seat count.</p>
          <div className="flex justify-center">
            <SeatInput seats={seats} onChange={setSeats} />
          </div>
        </div>
      </section>

      {/* Pack cards — catalog-driven */}
      <section className="bg-[#F7F9FC] py-16 px-6">
        <div className="max-w-[1200px] mx-auto">
          {loading && (
            <div className="flex justify-center py-16">
              <Loader2 className="size-8 animate-spin text-[#0078D4]" />
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <AlertCircle className="size-8 text-destructive" />
              <p className="text-muted-foreground">Could not load monitoring packs. Please refresh and try again.</p>
            </div>
          )}

          {!loading && !error && sorted.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">No monitoring packs available yet — check back soon.</div>
          )}

          {!loading && !error && sorted.length > 0 && visible.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">No packs available for {seats} seats — <a href="/contact" className="underline text-[#0078D4]">contact us</a> for a custom quote.</div>
          )}

          {!loading && !error && visible.length > 0 && (
            <div className={`grid gap-6 ${visible.length === 1 ? "grid-cols-1 max-w-sm mx-auto" : visible.length === 2 ? "grid-cols-1 md:grid-cols-2 max-w-2xl mx-auto" : "grid-cols-1 md:grid-cols-3"}`}>
              {visible.map((tier) => (
                <PackCard key={tier.id} tier={tier} seats={seats} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* What monitoring catches */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[960px] mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-3">What monitoring catches</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Your tenant changes continuously. New users, app registrations, Teams policies, Conditional Access rules — each one is a potential signal.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <div className="bg-[#F7F9FC] rounded-xl p-6 border border-border">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="size-5 text-[#0078D4]" />
                <h3 className="font-bold text-[#0A2540]">Security misconfigurations</h3>
              </div>
              <p className="text-sm text-foreground/70 leading-relaxed">MFA gaps, legacy auth enabled, overly permissive Conditional Access, admin role sprawl.</p>
            </div>
            <div className="bg-[#F7F9FC] rounded-xl p-6 border border-border">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="size-5 text-[#0078D4]" />
                <h3 className="font-bold text-[#0A2540]">Configuration drift</h3>
              </div>
              <p className="text-sm text-foreground/70 leading-relaxed">Policies that changed without a change request — SharePoint sharing settings, Teams guest access, DLP rules.</p>
            </div>
            <div className="bg-[#F7F9FC] rounded-xl p-6 border border-border">
              <div className="flex items-center gap-2 mb-3">
                <Eye className="size-5 text-[#0078D4]" />
                <h3 className="font-bold text-[#0A2540]">Licence waste</h3>
              </div>
              <p className="text-sm text-foreground/70 leading-relaxed">Assigned but unused licences, duplicate SKUs, unactivated Copilot seats.</p>
            </div>
            <div className="bg-[#F7F9FC] rounded-xl p-6 border border-border">
              <div className="flex items-center gap-2 mb-3">
                <Users className="size-5 text-[#0078D4]" />
                <h3 className="font-bold text-[#0A2540]">User &amp; identity risks</h3>
              </div>
              <p className="text-sm text-foreground/70 leading-relaxed">Stale guest accounts, unmanaged service accounts, orphaned mailboxes.</p>
            </div>
            <div className="bg-[#F7F9FC] rounded-xl p-6 border border-border">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="size-5 text-[#0078D4]" />
                <h3 className="font-bold text-[#0A2540]">Compliance signals</h3>
              </div>
              <p className="text-sm text-foreground/70 leading-relaxed">Retention policy gaps, audit log disabled, data governance weaknesses.</p>
            </div>
            <div className="bg-[#F7F9FC] rounded-xl p-6 border border-border">
              <div className="flex items-center gap-2 mb-3">
                <Phone className="size-5 text-[#0078D4]" />
                <h3 className="font-bold text-[#0A2540]">Copilot readiness blockers</h3>
              </div>
              <p className="text-sm text-foreground/70 leading-relaxed">Data access oversharing, missing sensitivity labels, governance prerequisites not met.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-[#0A2540] py-20 px-6 text-center">
        <div className="max-w-[700px] mx-auto">
          <h2 className="text-3xl font-extrabold text-white mb-4">Not sure which pack fits?</h2>
          <p className="text-white/60 mb-8 text-lg">
            Book a free 30-minute call. Shane will recommend the right coverage for your environment — no pressure, no sales pitch.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/book">
              <Button size="lg" className="px-8">Book a Free Discovery Call</Button>
            </Link>
            <Link href="/contact">
              <Button size="lg" variant="outline" className="px-8 border-white/30 text-white hover:bg-white/10">
                Send Shane a message <ArrowRight className="ml-2 size-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
