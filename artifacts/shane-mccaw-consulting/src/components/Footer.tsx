import { Link } from "wouter";
import { ShieldCheck } from "lucide-react";
import { useVersionInfo, formatRunningSince } from "@/hooks/useVersionInfo";

/**
 * The four approved links (#382) are treated as an indexed directory rather than a nav row:
 * each gets one of the site's six pillar colours, in the order the pillars appear on Home's
 * radar. The two omitted pillars are deliberate — Compliance's #D1D5DB reads as a disabled
 * link on charcoal, and Adoption's #fb923c is spoken for by the white-glove section above.
 */
const FOOTER_LINKS = [
  { href: "/resources", label: "Resources", color: "#60a5fa" },
  { href: "/terms", label: "Terms & Service", color: "#a78bfa" },
  { href: "/about", label: "About", color: "#2dd4bf" },
  { href: "/contact", label: "Contact", color: "#4ADE80" },
];

/** Home.tsx closes on this exact six-segment bar; the footer's top edge rhymes with it. */
const PILLAR_SPECTRUM = ["#3B82F6", "#8B5CF6", "#D1D5DB", "#14B8A6", "#F97316", "#22C55E"];

const UPTIME_GREEN = "#4ADE80";

export function Footer() {
  const versionInfo = useVersionInfo();
  const runningSince = formatRunningSince(versionInfo.startedAt);

  return (
    <footer className="bg-charcoal-0">
      {/* Full-bleed pillar spectrum — the footer's only rule across the top. */}
      <div aria-hidden className="flex h-px w-full">
        {PILLAR_SPECTRUM.map((color) => (
          <span key={color} className="flex-1" style={{ background: color, opacity: 0.55 }} />
        ))}
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-10 sm:pt-16">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
          {/* Brand */}
          <div className="flex flex-col">
            <div className="flex items-center gap-2.5">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
                style={{ background: "linear-gradient(135deg, var(--accent-blue), var(--accent-violet))" }}
              >
                <ShieldCheck className="w-5 h-5" />
              </div>
              <span className="text-text-primary font-display font-semibold text-base">Shane McCaw Consulting</span>
            </div>

            <p className="mt-5 text-text-secondary text-sm leading-relaxed max-w-xs">
              Vero Beach, FL — M365 · Copilot AI · SharePoint · Power Platform
            </p>

            {/* Version + uptime, read as a live signal rather than a build stamp. On wide
                viewports it drops to the foot of the column so the brand block spans the
                directory's full height instead of leaving a void beneath it. */}
            <div className="mt-7 lg:mt-auto lg:pt-10">
              <div className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-full border border-white/[0.09] bg-white/[0.03] px-3.5 py-2">
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span
                    aria-hidden
                    className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping motion-reduce:hidden"
                    style={{ background: UPTIME_GREEN }}
                  />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: UPTIME_GREEN }} />
                </span>
                <span className="font-mono text-[11px] tracking-wide text-text-secondary">v{versionInfo.display}</span>
                {runningSince ? (
                  <>
                    <span aria-hidden className="h-2.5 w-px bg-white/15" />
                    <span className="font-mono text-[11px] tracking-wide text-text-secondary">{runningSince}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {/* Indexed directory */}
          <nav aria-label="Footer">
            <ul>
              {FOOTER_LINKS.map((link, i) => (
                <li key={link.href} className="border-t border-white/[0.07] last:border-b">
                  <Link
                    href={link.href}
                    className="group relative flex items-center gap-5 sm:gap-7 py-5 sm:py-6"
                  >
                    {/* Colour wash, left-anchored so the row resolves toward the label. Bleeds
                        past the text column into the container gutter. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 -left-3 -right-3 sm:-left-4 sm:-right-4 opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-focus-visible:opacity-100"
                      style={{ background: `linear-gradient(90deg, ${link.color}1F, transparent 68%)` }}
                    />
                    {/* Pillar rule that draws down the left edge on hover. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -left-3 sm:-left-4 inset-y-0 w-px origin-top scale-y-0 transition-transform duration-500 group-hover:scale-y-100 group-focus-visible:scale-y-100 motion-reduce:transition-none"
                      style={{ background: link.color, boxShadow: `0 0 12px ${link.color}` }}
                    />

                    <span
                      aria-hidden
                      className="relative font-mono text-[11px] tabular-nums tracking-[0.18em] opacity-70 transition-opacity duration-300 group-hover:opacity-100"
                      style={{ color: link.color }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>

                    <span className="relative flex-1 font-display font-medium text-text-secondary text-[clamp(1.25rem,2.6vw,1.875rem)] leading-none tracking-tight transition-colors duration-300 group-hover:text-text-primary">
                      {link.label}
                    </span>

                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      className="relative w-4 h-4 shrink-0 opacity-0 -translate-x-1.5 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0 motion-reduce:transition-none motion-reduce:translate-x-0"
                      fill="none"
                      stroke={link.color}
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 12h13" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <p className="mt-14 text-text-secondary text-xs">
          &copy; {new Date().getFullYear()} Shane McCaw Consulting. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

export default Footer;
