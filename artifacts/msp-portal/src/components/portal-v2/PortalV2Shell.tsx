/**
 * PortalV2Shell.tsx — the isolated chrome for the Customer Portal v2 pages.
 *
 * NOT `AppShell`. This build is a parallel verification of a new visual
 * language on a #020617 canvas; wrapping it in the live portal's Fluent 2
 * chrome would put a neutral-grey top bar and sidebar around a navy page and
 * tell us nothing about whether the design works. `AppShell` is untouched and
 * every existing page keeps using it.
 *
 * The nav here is deliberately the SIX PILLARS PLUS OVERVIEW ONLY. The full
 * handoff IA has eight groups (Operate, Standards & risk, Library, …) whose
 * pages are explicitly out of scope for this pass — rendering dead nav rows for
 * them would be a worse lie than leaving them out.
 */

import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";

import { cn } from "@/lib/utils";
import {
  PILLAR_ICON_PATHS,
  PILLAR_ORDER,
  hexAlpha,
  INK,
} from "@/components/copilot-journey/journeyTokens";

import "./portal-v2.css";

/** One pillar glyph, drawn from journeyTokens' own single-path definitions. */
export function PillarGlyph({
  pillar,
  color,
  size = 16,
}: {
  pillar: keyof typeof PILLAR_ICON_PATHS;
  color: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PILLAR_ICON_PATHS[pillar]} />
    </svg>
  );
}

function NavRow({
  href,
  label,
  active,
  glyph,
  color,
}: {
  href: string;
  label: string;
  active: boolean;
  glyph: ReactNode;
  color: string;
}) {
  return (
    <Link
      href={href}
      data-testid={`pv2-nav-${label.toLowerCase()}`}
      className={cn(
        "pv2-transition flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium",
        active ? "text-[color:var(--pv2-heading)]" : "text-[color:var(--pv2-muted)]",
      )}
      style={{
        background: active ? hexAlpha(color, 0.14) : undefined,
        boxShadow: active ? `inset 2px 0 0 0 ${color}` : undefined,
      }}
    >
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-[6px]"
        style={{ background: hexAlpha(color, active ? 0.22 : 0.12) }}
      >
        {glyph}
      </span>
      {label}
    </Link>
  );
}

export function PortalV2Shell({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  const [location] = useLocation();

  return (
    <div className="pv2-root flex min-h-screen">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside
        className="flex w-64 shrink-0 flex-col border-r"
        style={{ borderColor: "var(--pv2-border)", background: "var(--pv2-panel)" }}
      >
        <div
          className="flex h-14 items-center gap-2.5 border-b px-5"
          style={{ borderColor: "var(--pv2-border)" }}
        >
          <span
            className="flex size-7 items-center justify-center rounded-[8px] text-[11px] font-extrabold text-white"
            style={{ background: "linear-gradient(135deg,#0078D4,#00B4D8)" }}
          >
            SM
          </span>
          <span
            className="text-[13px] font-bold tracking-tight"
            style={{ color: "var(--pv2-heading)" }}
          >
            Shane McCaw MSP
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          <p
            className="px-3 pb-1.5 pt-2 text-[9.5px] font-bold uppercase tracking-[0.12em]"
            style={{ color: "var(--pv2-deemphasised)" }}
          >
            Overview
          </p>
          <NavRow
            href="/portal-v2"
            label="Tenant health"
            active={location === "/portal-v2" || location === "/portal-v2/"}
            color={INK.link}
            glyph={<PillarGlyph pillar="copilot" color={INK.link} />}
          />

          <p
            className="px-3 pb-1.5 pt-4 text-[9.5px] font-bold uppercase tracking-[0.12em]"
            style={{ color: "var(--pv2-deemphasised)" }}
          >
            Pillars
          </p>
          {PILLAR_ORDER.map((p) => (
            <NavRow
              key={p.key}
              href={`/portal-v2/${p.key}`}
              label={p.label}
              active={location === `/portal-v2/${p.key}`}
              color={p.primary}
              glyph={<PillarGlyph pillar={p.key} color={p.primary} />}
            />
          ))}
        </nav>

        <div
          className="border-t px-5 py-3 text-[10.5px]"
          style={{ borderColor: "var(--pv2-border)", color: "var(--pv2-micro)" }}
        >
          Parallel build — the live portal is unchanged.
        </div>
      </aside>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-20 flex h-14 shrink-0 items-center border-b px-7 backdrop-blur"
          style={{
            borderColor: "var(--pv2-border)",
            background: "rgba(2,6,23,.86)",
          }}
        >
          <div className="min-w-0">
            {eyebrow && (
              <p
                className="text-[9.5px] font-bold uppercase tracking-[0.14em]"
                style={{ color: "var(--pv2-micro)" }}
              >
                {eyebrow}
              </p>
            )}
            <h1
              className="truncate text-[15px] font-extrabold tracking-[-0.02em]"
              style={{ color: "var(--pv2-heading)" }}
              data-testid="pv2-page-title"
            >
              {title}
            </h1>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-7 py-7">
          <div className="mx-auto w-full max-w-[1320px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
