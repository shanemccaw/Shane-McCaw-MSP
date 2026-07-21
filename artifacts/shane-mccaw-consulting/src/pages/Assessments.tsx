import { useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import {
  ShieldCheck,
  Clock,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  KeyRound,
  ClipboardCheck,
  Database,
  Sparkles,
  DollarSign,
  Compass,
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { SEOMeta } from '@/components/SEOMeta';
import { GradientText } from '@/components/design-system/GradientText';
import { GlassPanel } from '@/components/design-system/GlassPanel';
import { useServices, type PublicService } from '@/hooks/useServices';

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

type ZoneKey = 'identity' | 'compliance' | 'data' | 'copilot' | 'cost' | 'bigpicture';

interface ZoneDef {
  key: ZoneKey;
  label: string;
  blurb: string;
  icon: typeof KeyRound;
}

// 6 zones, real assignment confirmed against all 21 real assessment rows
// (services.id 13-33, see lib/db/migrations/manual/2026-07-20-assessment-detail-content.sql).
// Matched by exact service name — do not re-derive or guess a different grouping.
const ZONES: ZoneDef[] = [
  { key: 'identity', label: 'Identity & Access', blurb: 'Who has access, and whether it’s actually controlled.', icon: KeyRound },
  { key: 'compliance', label: 'Compliance', blurb: 'Map your tenant against SOC 2, NIST CSF, ISO 27001, or CMMC.', icon: ClipboardCheck },
  { key: 'data', label: 'Data & Collaboration', blurb: 'SharePoint, Teams, Exchange, and how openly data is shared.', icon: Database },
  { key: 'copilot', label: 'Copilot Readiness', blurb: 'Whether your tenant is actually ready for Copilot.', icon: Sparkles },
  { key: 'cost', label: 'Cost & Licensing', blurb: 'What you’re paying for versus what’s actually being used.', icon: DollarSign },
  { key: 'bigpicture', label: 'Big Picture', blurb: 'The whole tenant, ranked and prioritized, fast.', icon: Compass },
];

const ZONE_ASSIGNMENTS: Record<ZoneKey, string[]> = {
  identity: [
    'Security Posture Assessment',
    'Conditional Access Assessment',
    'Entra ID / Identity Assessment',
    'Intune / Device Management Assessment',
  ],
  compliance: [
    'Compliance Framework Mapping Audit — SOC 2',
    'Compliance Framework Mapping Audit — NIST CSF',
    'Compliance Framework Mapping Audit — ISO 27001',
    'Compliance Framework Mapping Audit — CMMC Level 1-2',
  ],
  data: [
    'Data Governance Assessment',
    'Copilot Data Exposure Assessment',
    'SharePoint Assessment',
    'Teams Assessment',
    'Exchange Online Assessment',
  ],
  copilot: ['Copilot Readiness Snapshot', 'Copilot Readiness Assessment'],
  cost: ['License Waste Audit', 'License & Cost Optimization Assessment'],
  bigpicture: [
    'Tenant Governance Snapshot',
    'M365 Tenant Health Audit',
    'Migration Readiness Assessment',
    'Adoption & Change Management Maturity Assessment',
  ],
};

const NAME_TO_ZONE: Record<string, ZoneKey> = {};
for (const [zoneKey, names] of Object.entries(ZONE_ASSIGNMENTS) as [ZoneKey, string[]][]) {
  for (const name of names) {
    NAME_TO_ZONE[name.trim().toLowerCase()] = zoneKey;
  }
}

function getZoneForService(service: PublicService): ZoneKey | null {
  return NAME_TO_ZONE[service.name.trim().toLowerCase()] ?? null;
}

interface WizardOption {
  text: string;
  scores: Partial<Record<ZoneKey, number>>;
}

interface WizardQuestion {
  text: string;
  options: WizardOption[];
}

// Real questions and scoring, exactly as specified — do not invent different ones.
const WIZARD_QUESTIONS: WizardQuestion[] = [
  {
    text: "What's actually keeping you up at night about your M365 environment?",
    options: [
      { text: "I don't know who has access to what", scores: { identity: 2 } },
      { text: "We might get audited and I'd have no idea if we'd pass", scores: { compliance: 2 } },
      { text: "Files are shared way too openly, nobody's tracking it", scores: { data: 2 } },
      { text: "We're paying for Copilot licenses nobody's using right", scores: { copilot: 1, cost: 1 } },
    ],
  },
  {
    text: "What's driving this right now?",
    options: [
      { text: 'A specific compliance deadline or audit', scores: { compliance: 2 } },
      { text: "We're about to roll out (or already rolled out) Copilot", scores: { copilot: 2 } },
      { text: 'I just want to know where we actually stand, overall', scores: { bigpicture: 2 } },
      { text: 'Budget review — we want to cut waste', scores: { cost: 2 } },
    ],
  },
  {
    text: 'How deep do you need to go?',
    options: [
      { text: 'Just show me the big gaps, fast', scores: { bigpicture: 2 } },
      { text: 'I need something I can hand to legal or an auditor', scores: { compliance: 2 } },
      { text: 'Workload-specific detail — SharePoint, Teams, Exchange...', scores: { data: 2 } },
      { text: 'Identity and access specifically — MFA, CA policies, guests', scores: { identity: 2 } },
    ],
  },
];

const ZERO_SCORES: Record<ZoneKey, number> = {
  identity: 0,
  compliance: 0,
  data: 0,
  copilot: 0,
  cost: 0,
  bigpicture: 0,
};

function joinWithAnd(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export default function Assessments() {
  const [location, setLocation] = useLocation();

  // {{db.assessments.list}}
  const { services, loading, error } = useServices({ category: 'assessment' });

  // Retained only for backward-compatible link targets (Monitoring.tsx -> /assessments/start);
  // no longer a visible tab bar — the zone grid + wizard replace that browsing pattern.
  const tierFilter = location.includes('/start') ? 'free' : location.includes('/premium') ? 'paid' : 'all';

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardDone, setWizardDone] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [scores, setScores] = useState<Record<ZoneKey, number>>(ZERO_SCORES);
  // "Focused" zone: purely cosmetic (scroll target + highlight ring) — never gates
  // whether a zone's assessments are visible. All 6 zones always render.
  const [selectedZone, setSelectedZone] = useState<ZoneKey | null>(null);
  const [expandedSlugs, setExpandedSlugs] = useState<Set<string>>(new Set());
  const zoneSectionRefs = useRef<Partial<Record<ZoneKey, HTMLDivElement | null>>>({});

  const maxScore = Math.max(...Object.values(scores));
  const bestZones = maxScore > 0 ? ZONES.filter((z) => scores[z.key] === maxScore).map((z) => z.key) : [];
  const goodZones =
    maxScore > 0
      ? ZONES.filter((z) => scores[z.key] > 0 && scores[z.key] < maxScore && scores[z.key] >= maxScore - 1).map(
          (z) => z.key,
        )
      : [];

  const servicesByZone = useMemo(() => {
    const map: Record<ZoneKey, PublicService[]> = {
      identity: [],
      compliance: [],
      data: [],
      copilot: [],
      cost: [],
      bigpicture: [],
    };
    for (const service of services) {
      if (tierFilter === 'free' && !service.isFreeOffering) continue;
      if (tierFilter === 'paid' && service.isFreeOffering) continue;
      const zone = getZoneForService(service);
      if (zone) map[zone].push(service);
    }
    return map;
  }, [services, tierFilter]);

  function handleStartWizard() {
    setWizardOpen(true);
    setWizardDone(false);
    setQuestionIndex(0);
    setScores(ZERO_SCORES);
  }

  function handleAnswer(option: WizardOption) {
    const newScores = { ...scores };
    for (const key of Object.keys(option.scores) as ZoneKey[]) {
      newScores[key] += option.scores[key] ?? 0;
    }
    setScores(newScores);

    const isLast = questionIndex + 1 >= WIZARD_QUESTIONS.length;
    if (isLast) {
      setWizardDone(true);
      const newMax = Math.max(...Object.values(newScores));
      if (newMax > 0) {
        const top = ZONES.filter((z) => newScores[z.key] === newMax).map((z) => z.key);
        if (top.length === 1) setSelectedZone(top[0]);
      }
    } else {
      setQuestionIndex((i) => i + 1);
    }
  }

  function handleRetakeWizard() {
    setWizardOpen(false);
    setWizardDone(false);
    setQuestionIndex(0);
    setScores(ZERO_SCORES);
  }

  function focusZone(key: ZoneKey) {
    setSelectedZone(key);
    zoneSectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toggleCard(key: string) {
    setExpandedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function goToDetail(service: PublicService) {
    setLocation(`/assessments/${encodeURIComponent(service.slug ?? String(service.id))}`);
  }

  const renderAssessmentCard = (service: PublicService) => {
    const key = service.slug ?? String(service.id);
    const isExpanded = expandedSlugs.has(key);
    const priceDisplay = service.isFreeOffering
      ? 'FREE'
      : service.basePrice
        ? `$${Number(service.basePrice).toLocaleString()}`
        : 'Custom';
    const deliverables = service.deliverables?.length ? service.deliverables : (service.inclusions ?? []);
    const hook = service.tagline ?? service.description ?? '';

    return (
      <div key={key} className="rounded-2xl glass-panel overflow-hidden transition-all duration-200">
        <button
          onClick={() => toggleCard(key)}
          className="w-full flex items-center gap-4 p-5 text-left hover:bg-white/[0.03] transition-colors"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-display text-base font-bold text-text-primary truncate">{service.name}</h4>
              {service.isFreeOffering && (
                <span className="flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Free
                </span>
              )}
            </div>
            {hook && <p className="text-sm text-text-secondary truncate">{hook}</p>}
          </div>
          <div className="flex-shrink-0 flex items-center gap-4">
            <span className="font-numeric text-lg font-medium text-text-primary">{priceDisplay}</span>
            <ChevronDown
              className={`w-4 h-4 text-text-tertiary transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            />
          </div>
        </button>

        {isExpanded && (
          <div className="px-5 pb-5 pt-1 border-t border-white/[0.06]">
            {deliverables.length > 0 && (
              <ul className="space-y-2 mb-5 mt-4">
                {deliverables.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-accent-blue flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-text-secondary leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            )}
            {service.durationDays && (
              <p className="flex items-center gap-1 text-xs text-text-tertiary mb-4">
                <Clock className="w-3.5 h-3.5" />
                {service.durationDays} Day Turnaround
              </p>
            )}
            <button
              onClick={() => goToDetail(service)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-xs font-bold transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
            >
              <span>Start This Assessment</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <Layout>
      <SEOMeta
        title="Assessments | Shane McCaw Consulting"
        description="Free and paid Microsoft 365 assessments — a real, consent-gated Graph API scan, not a questionnaire, with the same scan depth as our continuous Monitoring service."
      />

      {/* 1. Hero Section */}
      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <ShieldCheck className="w-4 h-4" />
            Built by the M365 Architect at NASA
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-5">
            A Real Scan of Your Tenant.<br />
            <GradientText>Not a Guess.</GradientText>
          </h1>
          <p className="text-lg text-text-secondary leading-relaxed max-w-3xl mx-auto">
            Every assessment connects securely to your live Microsoft 365 tenant and scores your
            real governance, security, and compliance posture — not a self-reported
            questionnaire. Start free or go paid; the scan depth is identical either way.
          </p>
        </div>
      </section>

      {/* 2. What These Assessments Actually Do */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-5">
            What These Assessments Actually Do
          </h2>
          <p className="text-text-secondary text-lg leading-relaxed">
            Each assessment connects to your tenant through the Microsoft Graph API and reads
            your actual configuration — identity policies, sharing settings, licensing,
            compliance controls, whatever the category covers. It's evaluated against real
            security and governance baselines and returned as a prioritized set of findings:
            what's wrong, how bad it is, and what to fix first. Not a self-assessment checklist,
            not a generic industry report — a decision-grade read on what's actually happening
            inside your tenant right now.
          </p>
        </div>
      </section>

      {/* 3. Built by the CURRENT Microsoft 365 Architect for NASA */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <GlassPanel className="p-8 sm:p-10 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-blue/10 text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
              <ShieldCheck className="w-4 h-4" />
              Personal Credential
            </div>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-5">
              Built by the CURRENT Microsoft 365 Architect for NASA
            </h2>
            <p className="text-text-secondary text-lg leading-relaxed mb-4">
              Shane McCaw is the current M365 Architect at NASA, where he built the Copilot
              governance standard the agency distributes internally. The same engineering
              discipline — real telemetry, real scoring, no guesswork — is what runs underneath
              every assessment on this site.
            </p>
            <p className="text-text-tertiary text-sm leading-relaxed">
              That NASA role is a personal engineering credential, not a platform capability.
              These assessments are engineered for commercial Microsoft 365 tenants and do not
              provide federal compliance scoring, FedRAMP, or GCC alignment of any kind.
            </p>
          </GlassPanel>
        </div>
      </section>

      {/* 4. Why These Assessments Matter */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-5">
            Why These Assessments Matter
          </h2>
          <p className="text-text-secondary text-lg leading-relaxed">
            Misconfigured access, unmanaged sharing, and licensing waste don't announce
            themselves — they compound quietly until an incident, an audit, or a failed Copilot
            rollout forces the issue. An assessment turns that invisible risk into a
            prioritized, actionable list before it costs you, so the fix happens on your
            timeline instead of someone else's.
          </p>
        </div>
      </section>

      {/* 5. How These Assessments Work */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-10">
            How These Assessments Work
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
            {[
              { step: '1', title: 'Pick a category', body: "Browse by category or answer 3 quick questions and we'll point you to the right one." },
              { step: '2', title: 'Grant scoped consent', body: 'Nothing runs against your tenant until you explicitly authorize it.' },
              { step: '3', title: 'Real Graph-based scan', body: 'The same scan engine we run for continuous Monitoring reads your live environment.' },
              { step: '4', title: 'Findings compiled', body: 'Results are ranked by real risk, not a generic severity label.' },
              { step: '5', title: 'Portal access', body: 'Create your account and track findings, results, and next steps going forward.' },
            ].map((s) => (
              <div key={s.step} className="text-center">
                <div
                  className="w-9 h-9 mx-auto mb-3 rounded-full flex items-center justify-center text-white text-sm font-bold font-numeric"
                  style={GRADIENT_BG}
                >
                  {s.step}
                </div>
                <h3 className="font-display text-sm font-bold text-text-primary mb-1">{s.title}</h3>
                <p className="text-xs text-text-secondary leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Assessment Categories */}
      <section id="assessment-categories" className="py-16 px-4 sm:px-6 lg:px-8">
        <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-10">
          Assessment Categories
        </h2>

        {loading && (
          <div className="flex justify-center items-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent-blue" />
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-center max-w-xl mx-auto my-8">
            Failed to load assessment catalog. Please refresh or contact support.
          </div>
        )}

        {!loading && !error && (
          <div className="max-w-6xl mx-auto space-y-10">
            {services.length === 0 && (
              <div className="text-center py-12 text-text-secondary border border-white/[0.08] rounded-2xl bg-charcoal-1">
                No active offerings found in the database. Please contact support.
              </div>
            )}

            {services.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {ZONES.map((zone, idx) => {
                  const Icon = zone.icon;
                  const count = servicesByZone[zone.key].length;
                  const isBest = bestZones.includes(zone.key);
                  const isGood = !isBest && goodZones.includes(zone.key);
                  const isSelected = selectedZone === zone.key;
                  const rank = isBest ? 0 : isGood ? 1 : 2;

                  const tile = (
                    <button
                      onClick={() => focusZone(zone.key)}
                      className={`w-full h-full flex flex-col items-start text-left p-5 rounded-2xl transition-all duration-200 ${
                        isSelected
                          ? 'bg-charcoal-1 border border-accent-blue/50'
                          : isBest
                            ? 'bg-charcoal-1'
                            : 'glass-panel hover:border-white/[0.18]'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-3">
                        <Icon className="w-6 h-6 text-accent-blue" />
                        {isBest && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white" style={GRADIENT_BG}>
                            Best match
                          </span>
                        )}
                        {isGood && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent-blue/10 text-accent-blue border border-accent-blue/20">
                            Good match
                          </span>
                        )}
                      </div>
                      <h3 className="font-display text-base font-bold text-text-primary mb-1">{zone.label}</h3>
                      <p className="text-xs text-text-secondary leading-relaxed mb-3 flex-grow">{zone.blurb}</p>
                      <span className="text-[11px] text-text-tertiary">
                        {count} assessment{count === 1 ? '' : 's'}
                      </span>
                    </button>
                  );

                  return (
                    <div key={zone.key} style={{ order: rank * 10 + idx }}>
                      {isBest ? (
                        <div className="rounded-2xl p-[1.5px] h-full" style={GRADIENT_BG}>
                          {tile}
                        </div>
                      ) : (
                        tile
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {services.length > 0 && (
              <div className="flex flex-col gap-8">
                {ZONES.map((zone, idx) => {
                  const Icon = zone.icon;
                  const zoneServices = servicesByZone[zone.key];
                  const isBest = bestZones.includes(zone.key);
                  const isGood = !isBest && goodZones.includes(zone.key);
                  const isFocused = selectedZone === zone.key;
                  const rank = isBest ? 0 : isGood ? 1 : 2;
                  // Live-scored recede: only kicks in once the wizard has produced a
                  // score (maxScore > 0), same trigger as the zone tiles above — reacts
                  // after every answer, not just at wizard completion.
                  const isDimmed = maxScore > 0 && !isBest && !isGood;

                  return (
                    <div
                      key={zone.key}
                      ref={(el) => {
                        zoneSectionRefs.current[zone.key] = el;
                      }}
                      style={{ order: rank * 10 + idx }}
                      className={`scroll-mt-28 rounded-2xl transition-all duration-300 ${
                        isDimmed ? 'opacity-50' : 'opacity-100'
                      } ${isFocused ? 'ring-1 ring-accent-blue/40' : ''}`}
                    >
                      <div className="flex items-center gap-2 mb-4 px-1">
                        <Icon className="w-5 h-5 text-accent-blue" />
                        <h3 className="font-display text-lg font-bold text-text-primary">{zone.label}</h3>
                        {isBest && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white" style={GRADIENT_BG}>
                            Best match
                          </span>
                        )}
                        {isGood && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent-blue/10 text-accent-blue border border-accent-blue/20">
                            Good match
                          </span>
                        )}
                      </div>
                      {zoneServices.length > 0 ? (
                        <div className="space-y-3">{zoneServices.map((service) => renderAssessmentCard(service))}</div>
                      ) : (
                        <div className="text-center py-10 text-text-secondary border border-white/[0.08] rounded-2xl bg-charcoal-1">
                          No {tierFilter === 'all' ? '' : `${tierFilter} `}assessments in this category yet.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 7. Assessment Wizard */}
      <section id="assessment-wizard" className="py-16 px-4 sm:px-6 lg:px-8">
        <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-10">
          Assessment Wizard
        </h2>
        <div className="max-w-3xl mx-auto mb-10">
          <GlassPanel className="p-6 sm:p-8">
            {!wizardOpen && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-5">
                <div>
                  <h2 className="font-display text-xl font-bold text-text-primary mb-1">
                    Not sure where to start?
                  </h2>
                  <p className="text-sm text-text-secondary">
                    3 quick questions — watch the right category light up as you answer.
                  </p>
                </div>
                <button
                  onClick={handleStartWizard}
                  className="flex-shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-lg text-white text-sm font-bold transition-opacity hover:opacity-90"
                  style={GRADIENT_BG}
                  data-track="cta"
                >
                  Start
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {wizardOpen && !wizardDone && (
              <div>
                <div className="flex items-center justify-center gap-2 mb-6">
                  {WIZARD_QUESTIONS.map((_, i) => (
                    <span
                      key={i}
                      className={`h-2 w-2 rounded-full transition-all duration-200 ${
                        i === questionIndex
                          ? 'w-6 bg-accent-blue'
                          : i < questionIndex
                            ? 'bg-accent-blue/60'
                            : 'bg-white/[0.12]'
                      }`}
                    />
                  ))}
                </div>
                <h3 className="font-display text-lg sm:text-xl font-bold text-text-primary text-center mb-6">
                  {WIZARD_QUESTIONS[questionIndex].text}
                </h3>
                <div className="space-y-3">
                  {WIZARD_QUESTIONS[questionIndex].options.map((option) => (
                    <button
                      key={option.text}
                      onClick={() => handleAnswer(option)}
                      className="w-full text-left px-5 py-4 rounded-xl border border-white/[0.08] bg-white/[0.02] text-text-secondary hover:border-accent-blue/40 hover:text-text-primary hover:bg-white/[0.04] transition-all text-sm leading-relaxed"
                    >
                      {option.text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {wizardOpen && wizardDone && (
              <div className="text-center">
                <p className="text-xs uppercase tracking-widest text-accent-blue font-semibold mb-2">
                  Based on your answers
                </p>
                <h3 className="font-display text-xl font-bold text-text-primary mb-4">
                  {bestZones.length > 0 ? (
                    <>
                      <GradientText>{joinWithAnd(bestZones.map((k) => ZONES.find((z) => z.key === k)!.label))}</GradientText>{' '}
                      {bestZones.length > 1 ? 'are' : 'is'} your best match
                    </>
                  ) : (
                    "We couldn't quite pin down a single match — browse the categories below"
                  )}
                </h3>
                <button
                  onClick={handleRetakeWizard}
                  className="text-sm text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  Retake the quiz
                </button>
              </div>
            )}
          </GlassPanel>
        </div>
      </section>

      {/* 8. What's Inside Each Assessment */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-5">
            What's Inside Each Assessment
          </h2>
          <p className="text-text-secondary text-lg leading-relaxed">
            Every assessment hands you the same three things: findings ranked by real risk
            instead of a generic severity label, plain-language scoring you can hand straight to
            leadership or an auditor without translation, and the same underlying telemetry your
            account carries forward if you move into continuous Monitoring. Each individual
            assessment's specific deliverables are listed on its own card above — this is the
            construct all of them share.
          </p>
        </div>
      </section>

      {/* 9. Begin Your Assessment */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <GlassPanel className="p-8 sm:p-10 text-center">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Begin Your Assessment
            </h2>
            <p className="text-text-secondary text-lg leading-relaxed mb-8">
              Pick a category above, or let the 3-question wizard point you to the right one.
              Either way, you're getting a real scan of your real tenant.
            </p>
            <a
              href="#assessment-wizard"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-white text-sm font-bold transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Start the Wizard
              <ChevronRight className="w-4 h-4" />
            </a>
          </GlassPanel>
        </div>
      </section>
    </Layout>
  );
}
