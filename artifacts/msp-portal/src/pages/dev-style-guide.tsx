/**
 * /dev/style-guide — internal-only visual QA page for the Portal Foundation
 * Redesign token/component system (design-tokens + base components). Not
 * linked from any nav menu; reachable only by navigating directly while
 * signed in. Renders every token and base component side by side with a
 * live light/dark toggle so the system can be verified before any real page
 * migrates to it in a later task. Does not touch or replace the account-level
 * theme preference wired in lib/theme-context.tsx — this page's toggle is a
 * local QA control only, per the task's non-goals.
 */
import { useEffect, useState } from "react";
import { Sun, Moon, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScoreRing } from "@/components/ui/score-ring";
import {
  FindingCard,
  OfferCard,
  InstantRemediationCard,
} from "@/components/ui/finding-offer-card";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-foreground border-b border-border pb-2">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={`h-16 rounded-[var(--radius-card)] border border-border ${className}`} />
      <span className="text-xs font-medium text-muted-foreground">{name}</span>
    </div>
  );
}

export default function DevStyleGuidePage() {
  const [mode, setMode] = useState<"dark" | "light">("dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    return () => {
      // Restore the real app default (dark) when leaving this preview page.
      document.documentElement.classList.add("dark");
    };
  }, [mode]);

  return (
    <div className="min-h-screen bg-background text-foreground p-8 flex flex-col gap-10 max-w-6xl mx-auto">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Style Guide — Portal Foundation Redesign</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Internal QA page. Not linked from nav — Fluent 2 token/component preview only.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMode((m) => (m === "dark" ? "light" : "dark"))}
        >
          {mode === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          Switch to {mode === "dark" ? "light" : "dark"}
        </Button>
      </header>

      <Section title="Surface layers">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Swatch name="background" className="bg-background" />
          <Swatch name="sidebar / header layer" className="bg-sidebar" />
          <Swatch name="card" className="bg-card" />
          <Swatch name="elevated / secondary" className="bg-secondary" />
        </div>
      </Section>

      <Section title="Text hierarchy">
        <div className="flex flex-col gap-2 bg-card border border-card-border rounded-[var(--radius-card)] p-4">
          <p className="text-foreground text-base">Primary text — text-foreground</p>
          <p className="text-muted-foreground text-base">Secondary / dim text — text-muted-foreground</p>
          <p className="text-muted-foreground/70 text-sm">Tertiary / faint text — text-muted-foreground/70</p>
        </div>
      </Section>

      <Section title="Semantic status colors">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <Swatch name="red — high/error" className="bg-status-red" />
          <Swatch name="amber — watch" className="bg-status-amber" />
          <Swatch name="green — good/nominal" className="bg-status-green" />
          <Swatch name="blue — brand/primary" className="bg-status-blue" />
          <Swatch name="violet — secondary accent" className="bg-status-violet" />
        </div>
      </Section>

      <Section title="Corner radius scale">
        <div className="flex items-end gap-6">
          <div className="flex flex-col items-center gap-2">
            <div className="size-16 bg-primary rounded-[var(--radius-control)]" />
            <span className="text-xs text-muted-foreground">control — 4px</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="size-16 bg-primary rounded-[var(--radius-card)]" />
            <span className="text-xs text-muted-foreground">card — 6px</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="size-16 bg-primary rounded-[var(--radius-large)]" />
            <span className="text-xs text-muted-foreground">large — 8px</span>
          </div>
        </div>
      </Section>

      <Section title="Spacing scale (4px base unit)">
        <div className="flex items-end gap-2">
          {[1, 2, 3, 4, 5, 6, 8].map((n) => (
            <div key={n} className="flex flex-col items-center gap-1.5">
              <div className="bg-primary" style={{ width: `${n * 4}px`, height: `${n * 4}px` }} />
              <span className="text-xs font-mono text-muted-foreground">{n * 4}px</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <div className="flex flex-col gap-2">
          <p className="font-sans text-base">Sans (labels/headers/body) — 'Segoe UI', 'Inter', system-ui</p>
          <p className="font-mono text-base">142.7 — mono (numeric values only) — 'IBM Plex Mono'</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="ghost">Ghost</Button>
          <Button size="sm">Small</Button>
        </div>
      </Section>

      <Section title="Tags / Badges">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </div>
      </Section>

      <Section title="Panel / Card">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-1">Base panel</h3>
            <p className="text-sm text-muted-foreground">
              Opaque neutral fill, subtle border, soft shadow, 6px radius.
            </p>
          </Card>
          <Card className="p-4 bg-secondary">
            <h3 className="text-sm font-semibold mb-1">Elevated / hover surface</h3>
            <p className="text-sm text-muted-foreground">One layer lighter than the base panel.</p>
          </Card>
        </div>
      </Section>

      <Section title="Ring chart">
        <div className="flex flex-wrap items-end gap-8">
          <ScoreRing value={82} color="blue" size={140} strokeWidth={10} label="Overall health" />
          <ScoreRing value={64} color="amber" size={90} label="Identity" />
          <ScoreRing value={91} color="green" size={90} label="Licensing" />
          <ScoreRing value={38} color="red" size={90} label="Security" />
          <ScoreRing value={70} color="violet" size={90} label="Offers accepted" />
        </div>
      </Section>

      <Section title="Finding / Offer / Instant remediation cards">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <FindingCard
            severity="high"
            engineSource="Identity Engine"
            title="12 admin accounts without MFA"
            description="Global admin roles were found without multi-factor authentication enforced."
            consequence="A single compromised password could grant full tenant control."
            timestamp="2026-07-18 09:14"
          />
          <OfferCard
            title="Enforce MFA for all admins"
            rationale="Resolves the 12 unprotected admin accounts flagged above."
            price="$450"
            actionLabel="Request this"
            onAction={() => {}}
          />
          <InstantRemediationCard
            title="Auto-enable MFA enforcement"
            rationale="Runs immediately via Graph API — no approval needed, reversible any time."
            actionLabel="Run now"
            onAction={() => {}}
          />
        </div>
      </Section>

      <Section title="Hero gradient (restrained exception)">
        <p className="text-3xl font-semibold">
          Your tenant's{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(90deg, hsl(var(--status-blue)), hsl(var(--status-violet)))",
            }}
          >
            security posture
          </span>{" "}
          at a glance.
        </p>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
          <AlertTriangle className="size-3.5" />
          Gradient is restricted to a hero headline's key phrase only — not reused elsewhere.
        </p>
      </Section>
    </div>
  );
}
