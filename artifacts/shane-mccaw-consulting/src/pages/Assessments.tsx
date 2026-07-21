import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import {
  ShieldCheck,
  Clock,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  KeyRound,
  ClipboardCheck,
  ClipboardList,
  Database,
  Sparkles,
  DollarSign,
  Compass,
  Share2,
  FileText,
  Activity,
  Pause,
  Play,
  type LucideIcon,
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { SEOMeta } from '@/components/SEOMeta';
import { GradientText } from '@/components/design-system/GradientText';
import { GlassPanel } from '@/components/design-system/GlassPanel';
import { IllustrativeBadge } from '@/components/design-system/IllustrativeBadge';
import { WorkflowSteps } from '@/components/design-system/WorkflowSteps';
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

/**
 * Rows for the hero's illustrative scan preview. Every label/detail names a
 * surface a real assessment in the catalog actually reads (2026-07-20
 * assessment-detail-content.sql: Conditional Access Assessment, SharePoint
 * Assessment, Entra ID / Identity Assessment, Copilot Data Exposure
 * Assessment, License Waste Audit) — never invented coverage.
 */
const SCAN_PREVIEW_ROWS: { icon: LucideIcon; label: string; detail: string }[] = [
  { icon: KeyRound, label: 'Conditional Access policies', detail: 'Users, apps, and sign-in scenarios with no policy protection' },
  { icon: Share2, label: 'SharePoint sharing links', detail: 'Broad-access links and external access, site by site' },
  { icon: ShieldCheck, label: 'MFA registration coverage', detail: 'Privileged roles checked first' },
  { icon: Sparkles, label: 'Copilot data exposure', detail: 'Sensitive content the semantic index could surface today' },
  { icon: DollarSign, label: 'License assignment', detail: 'Unused and underused seats, SKU by SKU' },
];

const SCAN_ROW_MS = 1500;
const SCAN_HOLD_MS = 3400;
const SCAN_RESTART_MS = 700;

/**
 * The hero's signature visual: what watching a consented tenant scan actually
 * looks like — progress bar sweeping while real scan surfaces advance
 * queued → scanning → done, then a completion hold and a loop. Clearly
 * illustrative (IllustrativeBadge + explicit "not a live scan" caption),
 * never implying a scan is running for a cold visitor.
 *
 * Motion honesty follows HowItWorksShowcase's conventions: loops only while
 * scrolled into view, carries a persistent pause/play toggle (WCAG 2.2.2),
 * and renders the finished state statically under prefers-reduced-motion.
 * The whole visual stack is aria-hidden decoration — the badge, caption, and
 * pause control stay in the accessibility tree.
 */
function TenantScanPreview() {
  // Lazy static read, matching the site's usePrefersReducedMotion convention.
  const [reduced] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const total = SCAN_PREVIEW_ROWS.length;
  // Number of surfaces finished; the row at this index is "scanning".
  const [done, setDone] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Track visibility continuously — the loop stops again when scrolled away.
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    const obs = new IntersectionObserver(([entry]) => setInView(!!entry?.isIntersecting), { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [reduced]);

  // One self-rescheduling timeout per tick: rows advance on SCAN_ROW_MS, the
  // completed state holds for SCAN_HOLD_MS, and the emptied bar rests briefly
  // before the next pass starts.
  useEffect(() => {
    if (reduced || stopped || !inView) return;
    const delay = done >= total ? SCAN_HOLD_MS : done === 0 ? SCAN_RESTART_MS : SCAN_ROW_MS;
    const t = setTimeout(() => setDone((d) => (d >= total ? 0 : d + 1)), delay);
    return () => clearTimeout(t);
  }, [done, reduced, stopped, inView, total]);

  const shownDone = reduced ? total : done;
  const complete = shownDone >= total;

  return (
    <div ref={ref} className="relative rounded-2xl glass-panel p-6 sm:p-8">
      <IllustrativeBadge />
      <div className="text-[10px] uppercase tracking-wider text-text-secondary mb-5 pr-28">
        What a running assessment looks like
      </div>

      <div aria-hidden="true">
        <div className="h-2 rounded-full bg-white/[0.08] overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              ...GRADIENT_BG,
              width: `${(shownDone / total) * 100}%`,
              // Snap (no reverse-sweep) when the loop resets to an empty bar.
              transition: shownDone === 0 ? 'none' : `width ${SCAN_ROW_MS}ms linear`,
            }}
          />
        </div>
        <div className="mt-3 text-xs text-text-secondary min-h-[1.25rem]">
          {complete
            ? 'Scan complete — findings ranked by real risk'
            : `Scanning ${SCAN_PREVIEW_ROWS[shownDone]?.label ?? ''}…`}
        </div>

        <div className="mt-6 space-y-4">
          {SCAN_PREVIEW_ROWS.map((row, i) => {
            const state = i < shownDone ? 'done' : i === shownDone && !complete ? 'scanning' : 'queued';
            const Icon = row.icon;
            return (
              <div key={row.label} className="flex items-start gap-3">
                <Icon
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    state === 'scanning' ? 'text-accent-blue animate-pulse' : 'text-text-secondary'
                  } ${state === 'queued' ? 'opacity-40' : ''}`}
                />
                <div className={`flex-1 min-w-0 ${state === 'queued' ? 'opacity-50' : ''}`}>
                  <div className="text-xs text-text-secondary">{row.label}</div>
                  <div className="text-[11px] text-text-secondary opacity-60 leading-snug mt-0.5">
                    {row.detail}
                  </div>
                </div>
                {state === 'done' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <span className="text-[10px] uppercase tracking-wider text-text-secondary opacity-60 shrink-0 mt-0.5">
                    {state === 'scanning' ? 'Scanning…' : 'Queued'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center justify-between gap-3">
        <span className="text-xs text-text-secondary">
          Example data — a real scan runs only after you grant scoped, read-only consent.
        </span>
        {!reduced && (
          <button
            type="button"
            onClick={() => setStopped((s) => !s)}
            aria-pressed={stopped}
            aria-label={stopped ? 'Resume the scan preview animation' : 'Pause the scan preview animation'}
            className="shrink-0 w-6 h-6 rounded-full bg-white/[0.08] hover:bg-white/[0.16] flex items-center justify-center text-text-secondary transition-colors duration-300"
          >
            {stopped ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The three things every assessment hands back, whichever zone it lives in —
 * the shared construct (old "What These Assessments Actually Do" + "What's
 * Inside Each Assessment" prose, consolidated into one icon-led strip).
 */
const SHARED_CONSTRUCT: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ClipboardList,
    title: 'Findings ranked by real risk',
    body: 'Not a generic severity label — a prioritized list of what’s wrong, how bad it is, and what to fix first.',
  },
  {
    icon: FileText,
    title: 'Scoring leadership can read',
    body: 'Plain-language results you can hand straight to an executive, your compliance team, or an auditor without translation.',
  },
  {
    icon: Activity,
    title: 'Telemetry that carries forward',
    body: 'The same scan engine behind continuous Monitoring — your results carry into your account if you move up later.',
  },
];

interface WhyZoneCard {
  zone: ZoneKey;
  /** Real M365 surface tag, RiskList-detail idiom (amber = attention convention). */
  tag: string;
  hook: string;
  body: string;
  /** Real finding types, grounded in the zone's actual assessment deliverables
   *  (2026-07-20-assessment-detail-content.sql) — never invented capabilities. */
  finds: string[];
}

// One card per zone. Every "finds" line traces to a real deliverable on a real
// assessment in that zone (services.id noted per card) — do not add claims that
// don't exist in the catalog content.
const WHY_ZONE_CARDS: WhyZoneCard[] = [
  {
    zone: 'identity',
    tag: 'Entra ID · Conditional Access · Intune',
    hook: 'Identity is the layer attackers try first — and the gap between “enforced” and “actually enforced” is where they get in.',
    body:
      'A Conditional Access policy that quietly skips a legacy app, MFA that never got registered on a privileged role, a departed admin’s account still holding access — none of it announces itself until someone probes it. This zone audits what’s actually protecting your sign-ins and devices, not what the policy binder says.',
    // ids 17, 23, 32, 33
    finds: [
      'Users, apps, and sign-in scenarios with no Conditional Access protection at all',
      'MFA coverage gaps on privileged roles, plus stale and orphaned accounts still holding access',
      'Unmanaged and out-of-policy devices quietly sitting outside your security baseline',
    ],
  },
  {
    zone: 'compliance',
    tag: 'SOC 2 · NIST CSF · ISO 27001 · CMMC',
    hook: 'The worst time to learn where your tenant stands against a framework is when the auditor tells you.',
    body:
      'Each mapping audit takes your real configuration and walks it control by control against the framework you’re actually facing — SOC 2, NIST CSF, ISO 27001, or CMMC Level 1-2 — so every gap is known, scoped, and closing on your schedule instead of surfacing as a formal finding.',
    // ids 18-21
    finds: [
      'A control-by-control gap report against the specific framework you’re facing',
      'Remediation guidance scoped to close each gap — not generic best practices',
      'A document you can hand straight to your compliance team or auditor',
    ],
  },
  {
    zone: 'data',
    tag: 'SharePoint · Teams · Exchange',
    hook: 'Sharing sprawl doesn’t fail loudly. It compounds quietly until an audit or an incident finds it for you.',
    body:
      'Broad-access links nobody remembers creating, guest access that outlived its project, retention and labeling policies silently failing, mail authentication loose enough to let spoofed messages through — this zone reads how your collaboration stack is actually configured, workload by workload.',
    // ids 22, 26, 29, 30, 31
    finds: [
      'Overshared sites, broad-access links, and external guest access as actually configured',
      'Sensitive data that’s unlabeled or overexposed, mapped by location',
      'Mail authentication gaps (SPF/DKIM/DMARC) that let phishing and spoofing get through',
    ],
  },
  {
    zone: 'copilot',
    tag: 'Readiness · Data exposure · Licensing',
    hook: 'Copilot will happily summarize whatever your permission model already exposes — for anyone who asks.',
    body:
      'Readiness isn’t a license count. It’s whether the content Copilot’s index can reach is content people should actually see, whether the seats you’re paying for will get used, and what’s standing between you and a safe rollout. This zone answers all three before you flip the switch.',
    // ids 14, 25, 26
    finds: [
      'Sensitive content Copilot could surface today, mapped by location and exposure type',
      'Licensing eligibility plus every rollout blocker, identified and ranked',
      'A phased rollout plan scoped to your tenant — not a generic adoption deck',
    ],
  },
  {
    zone: 'cost',
    tag: 'Every SKU · Every seat',
    hook: 'License waste never shows up as a line item. It just renews.',
    body:
      'Seats still assigned to people who left, premium SKUs doing basic work, add-ons nobody activated — the utilization data exists in your tenant, but nobody reconciles it against what you’re paying. This zone turns it into named, counted savings you can take into your next renewal.',
    // ids 15, 27
    finds: [
      'Unused and underused licenses, named and counted across every SKU',
      'A right-sized licensing plan mapped to actual usage patterns',
      'Cost projections modeled against your real renewal terms — negotiation-ready',
    ],
  },
  {
    zone: 'bigpicture',
    tag: 'Whole tenant · Ranked',
    hook: 'No single admin center shows you cross-domain drift. That’s why it goes unnoticed for years.',
    body:
      'Identity, security, governance, and licensing degrade together, and the first symptom usually shows up in a different domain than its cause. The big-picture assessments read the whole tenant in one pass and rank what to fix first — including whether you’re actually ready for the migration or rollout you’re planning.',
    // ids 13, 16, 24, 28
    finds: [
      'One cross-domain picture: identity, security, governance, and licensing together',
      'Every finding ranked by real risk, not generic severity labels',
      'Migration blockers and stalled adoption identified before they derail a cutover date',
    ],
  },
];

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

  // Live counts for the hero — derived from the real catalog response, never
  // hardcoded (the 6-zone count is code-defined above, so that one is literal).
  const freeCount = useMemo(() => services.filter((s) => s.isFreeOffering).length, [services]);

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
              <p className="flex items-center gap-1 text-xs text-text-secondary mb-4">
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

      {/* 1. Hero — headline + the page's signature visual: an illustrative
             tenant scan in progress, side by side. */}
      <section className="pt-32 sm:pt-40 pb-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
              <ShieldCheck className="w-4 h-4" />
              Built by the M365 Architect at NASA
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-5">
              A Real Scan of Your Tenant.<br />
              <GradientText>Not a Guess.</GradientText>
            </h1>
            <p className="text-lg text-text-secondary leading-relaxed mb-4">
              Every assessment connects securely to your live Microsoft 365 tenant and scores your
              real governance, security, and compliance posture — not a self-reported
              questionnaire. Start free or go paid; the scan depth is identical either way.
            </p>
            <p className="text-sm text-text-secondary mb-8">
              {services.length > 0 ? (
                <>
                  <span className="font-numeric text-text-primary">{services.length}</span> assessments across{' '}
                  <span className="font-numeric text-text-primary">6</span> zones
                  {freeCount > 0 && (
                    <>
                      {' — '}
                      <span className="font-numeric text-text-primary">{freeCount}</span> of them free to start
                    </>
                  )}
                  .
                </>
              ) : (
                <>Six zones, free and paid, one scan engine.</>
              )}
            </p>
            <div className="flex flex-col sm:flex-row justify-center lg:justify-start items-center gap-4">
              <a
                href="#assessment-wizard"
                className="w-full sm:w-auto px-7 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
                style={GRADIENT_BG}
                data-track="cta"
              >
                <span>Find Your Assessment</span>
                <ChevronRight className="w-4 h-4" />
              </a>
              <a
                href="#assessment-categories"
                className="w-full sm:w-auto px-7 py-3.5 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors text-center"
                data-track="cta"
              >
                Browse All Zones
              </a>
            </div>
          </div>
          <TenantScanPreview />
        </div>
      </section>

      {/* 2. Finder — the page's actual job, directly under the hero: the
             3-question wizard live-sorting the six zones and their cards.
             Two-column so the wizard and its live-sorted zone results stay
             visible together — the wizard sticks in the left column while the
             right column (zone tiles + card results, reordered live by score)
             scrolls independently. */}
      <section id="assessment-wizard" className="py-12 px-4 sm:px-6 lg:px-8 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-10">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Six zones. Three questions. <GradientText>One right starting point.</GradientText>
            </h2>
            <p className="text-text-secondary text-lg leading-relaxed">
              Every assessment lives in one of six zones. Answer three quick questions and watch
              the right zone rise to the top as you go — or skip the questions and browse
              straight to the problem you already know you have.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-8 items-start">
            <div className="lg:sticky lg:top-28">
              <GlassPanel className="p-6 sm:p-8">
                {!wizardOpen && (
                  <div className="flex flex-col sm:flex-row lg:flex-col items-center justify-between gap-5 lg:items-start lg:text-left text-center sm:text-left">
                    <div>
                      <h3 className="font-display text-xl font-bold text-text-primary mb-1">
                        Not sure where to start?
                      </h3>
                      <p className="text-sm text-text-secondary">
                        3 quick questions — watch the right zone light up as you answer.
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
                        "We couldn't quite pin down a single match — browse the zones below"
                      )}
                    </h3>
                    {bestZones.length > 0 && (
                      <div className="flex flex-col gap-2 mb-4">
                        {bestZones.map((k) => {
                          const zone = ZONES.find((z) => z.key === k)!;
                          return (
                            <button
                              key={k}
                              onClick={() => focusZone(k)}
                              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white text-sm font-bold transition-opacity hover:opacity-90"
                              style={GRADIENT_BG}
                              data-track="cta"
                            >
                              See {zone.label} assessments
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <button
                      onClick={handleRetakeWizard}
                      className="text-sm text-text-secondary hover:text-text-primary transition-colors"
                    >
                      Retake the quiz
                    </button>
                  </div>
                )}
              </GlassPanel>
            </div>

            <div id="assessment-categories" className="scroll-mt-28">
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
                <div className="space-y-10">
                  {services.length === 0 && (
                    <div className="text-center py-12 text-text-secondary border border-white/[0.08] rounded-2xl bg-charcoal-1">
                      No active offerings found in the database. Please contact support.
                    </div>
                  )}

                  {services.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-text-secondary mb-3 px-1">
                        Browse by zone
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {ZONES.map((zone, idx) => {
                          const Icon = zone.icon;
                          const zoneServices = servicesByZone[zone.key];
                          const count = zoneServices.length;
                          const hasFree = zoneServices.some((s) => s.isFreeOffering);
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
                                <span className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
                                  <Icon className="w-5 h-5 text-accent-blue" />
                                </span>
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
                              <span className="flex items-center gap-2 text-[11px] text-text-secondary">
                                <span>
                                  <span className="font-numeric">{count}</span> assessment{count === 1 ? '' : 's'}
                                </span>
                                {hasFree && (
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    Free start
                                  </span>
                                )}
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
                            <div className="flex items-center gap-3 mb-1 px-1">
                              <span className="shrink-0 w-9 h-9 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
                                <Icon className="w-4 h-4 text-accent-blue" />
                              </span>
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
                            <p className="text-xs text-text-secondary leading-relaxed mb-4 px-1 sm:pl-[52px]">
                              {zone.blurb}
                            </p>
                            {zoneServices.length > 0 ? (
                              <div className="space-y-3">{zoneServices.map((service) => renderAssessmentCard(service))}</div>
                            ) : (
                              <div className="text-center py-10 text-text-secondary border border-white/[0.08] rounded-2xl bg-charcoal-1">
                                No {tierFilter === 'all' ? '' : `${tierFilter} `}assessments in this zone yet.
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 3. The shared construct — what every assessment hands back, whichever
             zone it lives in (consolidates the old "What These Assessments
             Actually Do" and "What's Inside Each Assessment" prose blocks). */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-10">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Every assessment hands back the same three things.
            </h2>
            <p className="text-text-secondary text-lg leading-relaxed">
              Whichever zone you start in, the mechanism is identical: a consented, read-only
              Microsoft Graph API connection reads your actual configuration — identity policies,
              sharing settings, licensing, compliance controls, whatever the zone covers — and
              evaluates it against real security and governance baselines. What comes back is
              always the same construct:
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {SHARED_CONSTRUCT.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-white/[0.06] bg-charcoal-1 p-6">
                <span className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-accent-blue" />
                </span>
                <h3 className="font-display text-base font-bold text-text-primary mb-2">{title}</h3>
                <p className="text-sm text-text-secondary leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Why these assessments matter — one card per zone, two columns:
             the real risk story plus what a scan there actually turns up,
             grounded in the catalog's real deliverables. */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-10">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Every gap below gets found eventually. The question is who finds it first.
            </h2>
            <p className="text-text-secondary text-lg leading-relaxed">
              Misconfigured access, unmanaged sharing, and licensing waste don't announce
              themselves — they compound quietly until an incident, an audit, or a renewal forces
              the issue on someone else's timeline. Here's what that looks like zone by zone, and
              what a scan actually turns up while the fix is still cheap.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {WHY_ZONE_CARDS.map((card) => {
              const zone = ZONES.find((z) => z.key === card.zone)!;
              const Icon = zone.icon;
              return (
                <article key={card.zone} className="rounded-2xl border border-white/[0.06] bg-charcoal-1 p-6 flex flex-col">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="shrink-0 w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-amber-400" />
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/90">
                      {card.tag}
                    </span>
                  </div>
                  <h3 className="font-display text-base font-bold text-text-primary leading-snug mb-2">
                    {card.hook}
                  </h3>
                  <p className="text-sm text-text-secondary leading-relaxed mb-5">{card.body}</p>
                  <div className="mt-auto pt-4 border-t border-white/[0.06]">
                    <div className="text-[10px] uppercase tracking-wider text-text-secondary mb-3">
                      What a scan here turns up
                    </div>
                    <ul className="space-y-2">
                      {card.finds.map((f) => (
                        <li key={f} className="flex items-start gap-2.5">
                          <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                          <span className="text-sm text-text-secondary leading-relaxed">{f}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => focusZone(card.zone)}
                      className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-blue hover:opacity-80 transition-opacity"
                      data-track="cta"
                    >
                      See {zone.label} assessments
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* 5. How These Assessments Work */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-10">
            From scoped consent to ranked findings — five steps
          </h2>
          <WorkflowSteps
            steps={[
              { title: 'Pick a zone', description: "Browse by zone or answer 3 quick questions and we'll point you to the right one." },
              { title: 'Grant scoped consent', description: 'Nothing runs against your tenant until you explicitly authorize it.' },
              { title: 'Real Graph-based scan', description: 'The same scan engine we run for continuous Monitoring reads your live environment.' },
              { title: 'Findings compiled', description: 'Results are ranked by real risk, not a generic severity label.' },
              { title: 'Portal access', description: 'Create your account and track findings, results, and next steps going forward.' },
            ]}
          />
        </div>
      </section>

      {/* 6. Built by the CURRENT Microsoft 365 Architect for NASA */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <GlassPanel className="p-8 sm:p-10 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-blue/10 text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
              <ShieldCheck className="w-4 h-4" />
              Personal Credential
            </div>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-5">
              Built by the CURRENT <GradientText>Microsoft 365 Architect</GradientText> for NASA
            </h2>
            <p className="text-text-secondary text-lg leading-relaxed mb-4">
              Shane McCaw is the current M365 Architect at NASA, where he built the Copilot
              governance standard the agency distributes internally. The same engineering
              discipline — real telemetry, real scoring, no guesswork — is what runs underneath
              every assessment on this site.
            </p>
            <p className="text-text-secondary text-sm leading-relaxed">
              That NASA role is a personal engineering credential, not a platform capability.
              These assessments are engineered for commercial Microsoft 365 tenants and do not
              provide federal compliance scoring, FedRAMP, or GCC alignment of any kind.
            </p>
          </GlassPanel>
        </div>
      </section>

      {/* 7. Final CTA */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <GlassPanel className="p-8 sm:p-10 text-center">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Your tenant already has the answers.
            </h2>
            <p className="text-text-secondary text-lg leading-relaxed mb-8">
              Pick a zone, or let three questions point you to the right scan. Nothing runs until
              you grant scoped, read-only consent — and the free assessments mean finding out
              where you stand costs nothing.
            </p>
            <a
              href="#assessment-wizard"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-white text-sm font-bold transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Find Your Assessment
              <ChevronRight className="w-4 h-4" />
            </a>
          </GlassPanel>
        </div>
      </section>
    </Layout>
  );
}
