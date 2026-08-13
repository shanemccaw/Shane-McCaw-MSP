/**
 * PersonasScreenFluentPreview.tsx
 *
 * ISOLATED FLUENT 2 DESIGN PREVIEW — #288 (parent epic #183).
 *
 * This is a DUPLICATE of PersonasScreen.tsx restyled with real Fluent UI v9
 * (@fluentui/react-components — the official React implementation of Fluent 2),
 * built so Shane can see the real design system applied to a real page with
 * real data. It is an evaluation artifact, NOT a migration.
 *
 * Rules this file lives under:
 *  - The production `PersonasScreen.tsx` and its real route are UNTOUCHED. This
 *    file is additive; nothing in the real wizard imports it.
 *  - Same props as PersonasScreen so the comparison is genuinely like-for-like.
 *  - Same real data: the preview page hands this component the same real
 *    QuizProfile + AI-generated PersonaStory[] the live page renders (restored
 *    saved profile -> real POST /portal/copilot-assessment/personas SSE run).
 *    No placeholder personas exist anywhere in this file.
 *  - ZERO Tailwind. Every style here is Griffel (`makeStyles`) over real Fluent
 *    design tokens, so what renders is the design system, not our own chrome
 *    wearing Fluent's name. This also sidesteps the Tailwind-v4 `@source`
 *    scanning gap that affects shared packages.
 *
 * Typography (#288 item 5 — the "tiny text" problem):
 * The production screen is built almost entirely out of text-[8.5px] /
 * text-[9px] / text-[9.5px] / text-[10px] / text-[11px] / text-xs, including
 * for body copy. Here every one of those is mapped onto the real Fluent 2 type
 * ramp, and the two genuinely tiny sizes are reserved for genuine micro-labels:
 *
 *   production                     -> Fluent 2 ramp
 *   ---------------------------------------------------------------
 *   text-[8.5px]/[9px] chips       -> Caption1        (12px/16)
 *   text-[9px] micro stamps        -> Caption2        (10px/14)  <- ONLY unit
 *                                                                  stamps and
 *                                                                  the footer
 *   text-[10px] section labels     -> Caption1Strong  (12px/16 semibold)
 *   text-[11px] / text-xs labels   -> Body1           (14px/20)
 *   text-xs BODY COPY              -> Body1           (14px/20)
 *   text-sm narrative              -> Body2           (16px/22)
 *   text-lg persona name           -> Subtitle1       (20px/28 semibold)
 *   header title                   -> Subtitle2       (16px/22 semibold)
 *
 * Net effect, measured in-browser rather than asserted (see #288's session
 * notes): every run of prose — persona summaries, all seven narrative
 * sections, telemetry/unlock callouts, ROI breakdown, primaryBenefit, and the
 * remediation-dialog detail — renders at 14px or 16px. What legitimately stays
 * at Caption1 (12px) is labels: section headings, finding names in the metric
 * rails, chips, and helper captions. Caption2 (10px) survives in exactly two
 * places: the "0–100 scale" axis unit and the footer provenance stamp.
 * Nothing renders below 10px at all; production went down to 8.5px.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  FluentProvider,
  webDarkTheme,
  createDarkTheme,
  makeStyles,
  mergeClasses,
  tokens,
  Avatar,
  Badge,
  Body1,
  Body1Strong,
  Body2,
  Button,
  Caption1,
  Caption1Strong,
  Caption2,
  Card,
  CounterBadge,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Divider,
  Link,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  ProgressBar,
  Slider,
  Spinner,
  Subtitle1,
  Subtitle2,
  Tab,
  TabList,
  Title3,
  Tooltip,
  type BrandVariants,
  type Theme,
} from '@fluentui/react-components';
import {
  ArrowRight20Regular,
  ArrowTrendingLines20Regular,
  Checkmark16Regular,
  CheckmarkCircle20Regular,
  ChevronDown20Regular,
  ChevronRight16Regular,
  ChevronUp20Regular,
  Copy16Regular,
  Dismiss20Regular,
  Flash20Filled,
  LockClosed20Regular,
  PeopleTeam20Regular,
  PeopleTeam24Regular,
  Pulse20Regular,
  QuestionCircle20Regular,
  Sparkle20Filled,
  Target20Regular,
  Warning20Filled,
} from '@fluentui/react-icons';

import { PersonaStory, QuizProfile, PersonaGenerationStatus, PersonaSeverity } from '../types';
import {
  fetchRemediationDetail,
  type RemediationContext,
  type RemediationDetailResult,
} from '../remediationDetailClient';
import type { IssueCategory } from '../UseCaseIssueModal';

type FetchWithAuth = (
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: { silent?: boolean },
) => Promise<Response>;

/* ────────────────────────────────────────────────────────────────────────────
 * THEMES
 *
 * Two real Fluent 2 dark themes, switchable in the header so the evaluation can
 * separate "what does stock Fluent 2 look like" from "what does Fluent 2 look
 * like carrying our brand":
 *
 *  - "Fluent 2 dark (stock)" is `webDarkTheme` verbatim, unmodified. This is
 *    Microsoft's shipped Fluent 2 web dark theme, brand ramp and all.
 *  - "Fluent 2 dark (brand)" is `createDarkTheme(brand)` over a real 16-step
 *    BrandVariants ramp anchored on the Copilot blue/violet this product
 *    already uses in its CTAs (#3B82F6 -> #8B5CF6). Everything else — every
 *    neutral, stroke, shadow, radius, and the entire type ramp — is still
 *    generated by Fluent's own theme algorithm from real design tokens.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Real 16-step Fluent BrandVariants ramp for this product's Copilot blue→violet CTA colour. */
const copilotBrand: BrandVariants = {
  10: '#04030B',
  20: '#111124',
  30: '#191C3D',
  40: '#1F2553',
  50: '#252E6A',
  60: '#2B3882',
  70: '#31429B',
  80: '#374DB4',
  90: '#3D58CD',
  100: '#4463E6',
  110: '#3B82F6',
  120: '#6E9BF8',
  130: '#8B5CF6',
  140: '#A78BFA',
  150: '#C4B5FD',
  160: '#D8B4FE',
};

const copilotDarkTheme: Theme = createDarkTheme(copilotBrand);

type PreviewThemeName = 'stock' | 'brand';

const THEMES: Record<PreviewThemeName, Theme> = {
  stock: webDarkTheme,
  brand: copilotDarkTheme,
};

/* ────────────────────────────────────────────────────────────────────────────
 * STYLES — Griffel over real Fluent tokens. No Tailwind, no hardcoded colours
 * outside the brand ramp above.
 * ──────────────────────────────────────────────────────────────────────────── */

const useStyles = makeStyles({
  root: {
    height: '100vh',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyBase,
  },

  /* Preview banner — this must never be mistakable for the real wizard. */
  previewBanner: {
    flexShrink: 0,
    borderRadius: 0,
  },

  header: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: tokens.spacingHorizontalL,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXL}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  headerIdentity: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
    minWidth: 0,
  },
  headerMark: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    flexShrink: 0,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke2}`,
  },
  headerTitleRow: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalS,
    flexWrap: 'wrap',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
    flexShrink: 0,
  },

  body: {
    flexGrow: 1,
    display: 'flex',
    minHeight: 0,
    overflow: 'hidden',
  },

  /* Left rail */
  rail: {
    width: '340px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
    overflowY: 'auto',
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    // Without this the column's children shrink to fit the viewport instead of
    // scrolling, which silently clips card content (Card is overflow:hidden).
    '& > *': { flexShrink: 0 },
  },
  railHeading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: tokens.spacingHorizontalS,
    paddingBottom: tokens.spacingVerticalS,
  },
  railHeadingLabel: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground2,
  },
  personaCard: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalM,
    cursor: 'pointer',
    position: 'relative',
    transitionDuration: tokens.durationNormal,
    transitionTimingFunction: tokens.curveEasyEase,
    transitionProperty: 'background-color, border-color',
  },
  personaCardActive: {
    border: `${tokens.strokeWidthThick} solid ${tokens.colorBrandStroke1}`,
    backgroundColor: tokens.colorBrandBackground2,
  },
  personaCardTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    columnGap: tokens.spacingHorizontalS,
  },
  personaIdentity: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalS,
    minWidth: 0,
  },
  personaNameBlock: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
  },
  chipRowLabel: {
    color: tokens.colorNeutralForeground3,
    marginRight: tokens.spacingHorizontalXXS,
  },
  personaOutcome: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorPaletteGreenBackground1,
    color: tokens.colorPaletteGreenForeground1,
  },
  truncate: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  /* Fluent's typography components render inline <span>s; a heading above a
     paragraph has to be told it is a block or the two run together. */
  blockLabel: {
    display: 'block',
    marginBottom: tokens.spacingVerticalXS,
  },
  transColumn: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
  },

  /* Centre column */
  main: {
    flexGrow: 1,
    minWidth: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalL,
    padding: tokens.spacingHorizontalXL,
    '& > *': { flexShrink: 0 },
  },
  heroCard: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalL,
    padding: tokens.spacingHorizontalXL,
    '& > *': { flexShrink: 0 },
  },
  heroHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    columnGap: tokens.spacingHorizontalL,
    flexWrap: 'wrap',
    rowGap: tokens.spacingVerticalM,
  },
  heroIdentity: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalL,
    minWidth: 0,
  },
  heroActions: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
    flexShrink: 0,
  },
  valueStat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  quoteCard: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalL,
    borderLeft: `${tokens.strokeWidthThicker} solid ${tokens.colorBrandStroke1}`,
  },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: tokens.spacingHorizontalL,
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalL,
  },
  panelHeading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: tokens.spacingHorizontalS,
  },
  sectionHeading: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground2,
  },
  roiBanner: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalXL,
    backgroundColor: tokens.colorBrandBackground2,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke2}`,
  },
  roiBannerHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: tokens.spacingHorizontalL,
    flexWrap: 'wrap',
  },
  centerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: tokens.spacingHorizontalS,
  },

  /* Transformation surface */
  transHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
    rowGap: tokens.spacingVerticalS,
  },
  transSliderRow: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
  },
  transSlider: {
    flexGrow: 1,
  },
  stateList: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXS,
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  stateListItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground3,
  },

  /* Right rail */
  metricsRail: {
    width: '340px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalL,
    padding: tokens.spacingHorizontalL,
    overflowY: 'auto',
    backgroundColor: tokens.colorNeutralBackground2,
    borderLeft: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    '& > *': { flexShrink: 0 },
  },
  gaugeGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: tokens.spacingHorizontalM,
  },
  gauge: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    rowGap: tokens.spacingVerticalXS,
    padding: tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  gaugeRing: {
    position: 'relative',
    width: '72px',
    height: '72px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gaugeSvg: {
    transform: 'rotate(-90deg)',
  },
  gaugeValue: {
    position: 'absolute',
  },
  issueRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: tokens.spacingHorizontalS,
    width: '100%',
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    cursor: 'pointer',
    textAlign: 'left',
    // `borderColor` alone is one of the handful of shorthands Griffel does not
    // support (see @griffel/style-types' unsupported list) — the full `border`
    // shorthand is fine.
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground3Hover,
      border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke1}`,
    },
  },
  statGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: tokens.spacingHorizontalS,
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXXS,
    padding: tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  railFooter: {
    textAlign: 'center',
    color: tokens.colorNeutralForeground4,
    paddingTop: tokens.spacingVerticalS,
  },

  /* Status pane (loading / error / blocked) */
  statusPane: {
    flexGrow: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: tokens.spacingHorizontalXXL,
  },
  statusCard: {
    maxWidth: '480px',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    rowGap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalXXL,
    textAlign: 'center',
  },

  /* Dialog */
  dialogSteps: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
    margin: 0,
    paddingLeft: tokens.spacingHorizontalXL,
  },
  codeBlock: {
    marginTop: tokens.spacingVerticalXS,
    borderRadius: tokens.borderRadiusMedium,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    overflow: 'hidden',
  },
  codeBlockHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  codePre: {
    margin: 0,
    padding: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground1,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground1,
    whiteSpace: 'pre-wrap',
    overflowX: 'auto',
  },
  dialogSection: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
  },
});

/* ────────────────────────────────────────────────────────────────────────────
 * Severity → real Fluent palette tokens. The production screen hardcodes
 * `text-destructive` / `text-status-amber` / `text-status-green`; Fluent 2 has
 * first-class semantic palette tokens for exactly this, so use them.
 * ──────────────────────────────────────────────────────────────────────────── */

type BadgeColor = 'danger' | 'warning' | 'success' | 'brand' | 'informative';

const SEVERITY_BADGE_COLOR: Record<PersonaSeverity, BadgeColor> = {
  High: 'danger',
  Medium: 'warning',
  Low: 'success',
};

/** Real Fluent palette foreground tokens, used for the SVG gauge strokes. */
function riskStrokeToken(score: number): string {
  if (score > 50) return tokens.colorPaletteRedForeground1;
  if (score > 30) return tokens.colorPaletteYellowForeground1;
  return tokens.colorPaletteGreenForeground1;
}

function riskLabel(score: number): { text: string; color: BadgeColor } {
  if (score > 50) return { text: 'Elevated risk', color: 'danger' };
  if (score > 30) return { text: 'Moderate', color: 'warning' };
  return { text: 'Low risk', color: 'success' };
}

/* ────────────────────────────────────────────────────────────────────────────
 * PROPS — deliberately identical to PersonasScreenProps so this really is a
 * drop-in visual comparison of the same screen, not a different screen.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PersonasScreenFluentPreviewProps {
  quizProfile: QuizProfile | null;
  personas: PersonaStory[];
  personasStatus: PersonaGenerationStatus;
  personasError?: string | null;
  /** Real server-reported progress (#283) — derived from the model's actual streamed output. */
  personasProgress?: { pct: number; label: string } | null;
  /** Real authenticated fetch, used for the real remediation-detail call behind the issue dialog. */
  fetchWithAuth: FetchWithAuth;
  onContinue?: () => void;
  onHelpClick?: () => void;
  onExitClick?: () => void;
}

export const PersonasScreenFluentPreview: React.FC<PersonasScreenFluentPreviewProps> = (props) => {
  const [themeName, setThemeName] = useState<PreviewThemeName>('brand');

  return (
    <FluentProvider theme={THEMES[themeName]} style={{ height: '100vh' }}>
      <PreviewShell {...props} themeName={themeName} onThemeChange={setThemeName} />
    </FluentProvider>
  );
};

/* The shell renders INSIDE FluentProvider so `tokens` resolve against the live theme. */
const PreviewShell: React.FC<
  PersonasScreenFluentPreviewProps & {
    themeName: PreviewThemeName;
    onThemeChange: (name: PreviewThemeName) => void;
  }
> = ({
  quizProfile,
  personas,
  personasStatus,
  personasError,
  personasProgress,
  fetchWithAuth,
  onContinue,
  onHelpClick,
  onExitClick,
  themeName,
  onThemeChange,
}) => {
  const styles = useStyles();

  const [activePersonaId, setActivePersonaId] = useState<string>('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [transSliderPos, setTransSliderPos] = useState(50);
  const [selectedIssue, setSelectedIssue] = useState<
    { label: string; category: IssueCategory; severity: PersonaSeverity } | null
  >(null);

  // Real elapsed-time counter (#283) — the one honest signal that always updates
  // whether or not the server has emitted a progress event yet.
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const isAwaitingPersonas =
    personasStatus === 'loading' || (personasStatus === 'idle' && personas.length === 0);
  useEffect(() => {
    if (!isAwaitingPersonas) {
      setElapsedSeconds(0);
      return;
    }
    setElapsedSeconds(0);
    const startedAt = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isAwaitingPersonas]);

  // Real personas arrive asynchronously — default the rail selection to the
  // first one once they land, never to a hardcoded id.
  useEffect(() => {
    if (personas.length > 0 && !personas.some((p) => p.id === activePersonaId)) {
      setActivePersonaId(personas[0].id);
    }
  }, [personas, activePersonaId]);

  const activePersona = personas.find((p) => p.id === activePersonaId) ?? personas[0];

  const themeSwitcher = (
    <TabList
      size="small"
      selectedValue={themeName}
      onTabSelect={(_e, data) => onThemeChange(data.value as PreviewThemeName)}
    >
      <Tab value="stock">Fluent 2 dark (stock)</Tab>
      <Tab value="brand">Fluent 2 dark (brand)</Tab>
    </TabList>
  );

  /* ── Honest non-ready states, same three the production screen has ─────── */

  if (!quizProfile) {
    return (
      <StatusShell
        themeSwitcher={themeSwitcher}
        onExitClick={onExitClick}
        onHelpClick={onHelpClick}
        intent="warning"
        icon={<Warning20Filled />}
        title="Complete the quiz first"
        detail="Persona generation needs your quiz answers as context. Go back and finish the quiz to continue."
      />
    );
  }

  if (isAwaitingPersonas) {
    const elapsedLabel = `${elapsedSeconds}s elapsed`;
    const detail = personasProgress?.label
      ? `${personasProgress.label} (${Math.round(personasProgress.pct)}%) — ${elapsedLabel}`
      : `Sending your profile to M365 Copilot… — ${elapsedLabel}`;
    return (
      <StatusShell
        themeSwitcher={themeSwitcher}
        onExitClick={onExitClick}
        onHelpClick={onHelpClick}
        intent="info"
        icon={<Spinner size="small" />}
        title="Generating your persona cohort…"
        detail={detail}
        progressPct={personasProgress?.pct}
      />
    );
  }

  if (personasStatus === 'error' || !activePersona) {
    return (
      <StatusShell
        themeSwitcher={themeSwitcher}
        onExitClick={onExitClick}
        onHelpClick={onHelpClick}
        intent="error"
        icon={<Warning20Filled />}
        title="Persona generation failed"
        detail={personasError || 'Something went wrong generating personas. Please try again.'}
      />
    );
  }

  /* ── Real reactive metrics, same maths the production screen uses ──────── */

  const ratio = transSliderPos / 100;
  const effectiveRiskScore = Math.max(0, Math.round(activePersona.riskScore * (1.8 - 0.8 * ratio)));
  const effectiveFeasibilityScore = Math.min(
    100,
    Math.round(activePersona.feasibilityScore * (0.6 + 0.4 * ratio)),
  );
  const effectiveAdoptionFriction = Math.max(
    0,
    Math.round(activePersona.adoptionFriction * (1.8 - 0.8 * ratio)),
  );
  const effectiveHoursSaved = (
    activePersona.valuePotential.hoursSavedPerWeek * (0.2 + 0.8 * ratio)
  ).toFixed(1);

  // The persona's real generated `insightRibbonText` is always shown — it is a
  // real model-generated field and the production screen's collapsed default
  // surfaces it, so hiding it behind a slider band would quietly drop real
  // content from the comparison. The blend-mode note is additive.
  const ribbonModeNote =
    transSliderPos < 30
      ? `Telemetry reality mode (${transSliderPos}%) — high unmonitored risk and manual workflow friction for ${activePersona.name}.`
      : transSliderPos < 70
        ? `Transformation transition mode (${transSliderPos}%) — Purview governance and Copilot grounding in progress.`
        : `Copilot-optimised mode (${transSliderPos}%).`;

  const risk = riskLabel(effectiveRiskScore);

  return (
    <div className={styles.root}>
      <MessageBar intent="warning" className={styles.previewBanner}>
        <MessageBarBody>
          <MessageBarTitle>Fluent 2 design preview — not the production screen.</MessageBarTitle>{' '}
          Isolated evaluation artifact for issue #288. The live wizard still renders the original
          Personas screen; nothing here is wired into the customer flow. Data below is real.
        </MessageBarBody>
      </MessageBar>

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerIdentity}>
          <div className={styles.headerMark}>
            <PeopleTeam24Regular />
          </div>
          <div>
            <div className={styles.headerTitleRow}>
              <Subtitle2>Persona Stories &amp; Cohort Fusion</Subtitle2>
              <Badge appearance="tint" color="brand" size="medium">
                Step 4 of 8
              </Badge>
            </div>
            {/* Caption1 (12px), not the production 10px — this is a real subtitle, not a micro-label. */}
            <Caption1>Quiz intent × live telemetry reality surface</Caption1>
          </div>
        </div>

        <div className={styles.headerActions}>
          {themeSwitcher}
          {onHelpClick && (
            <Button appearance="subtle" icon={<QuestionCircle20Regular />} onClick={onHelpClick}>
              Spec info
            </Button>
          )}
          {onContinue && (
            <Button appearance="primary" icon={<ArrowRight20Regular />} iconPosition="after" onClick={onContinue}>
              Evaluate use-case stories
            </Button>
          )}
          {onExitClick && (
            <Tooltip content="Exit preview" relationship="label">
              <Button appearance="subtle" icon={<Dismiss20Regular />} onClick={onExitClick} />
            </Tooltip>
          )}
        </div>
      </header>

      <div className={styles.body}>
        {/* ── LEFT RAIL ─────────────────────────────────────────────────── */}
        <aside className={styles.rail}>
          <div className={styles.railHeading}>
            <span className={styles.railHeadingLabel}>
              <PeopleTeam20Regular />
              <Caption1Strong>Persona cohort rail</Caption1Strong>
            </span>
            <CounterBadge count={personas.length} appearance="filled" color="brand" size="small" />
          </div>

          {personas.map((p) => {
            const isActive = p.id === activePersonaId;
            return (
              <Card
                key={p.id}
                appearance={isActive ? 'filled-alternative' : 'filled'}
                // mergeClasses, not template-string concatenation: Griffel
                // atomic classes must be merged through it or the later rule
                // does not reliably win (it warns about this at runtime).
                className={mergeClasses(
                  styles.personaCard,
                  isActive && styles.personaCardActive,
                )}
                onClick={() => setActivePersonaId(p.id)}
              >
                <div className={styles.personaCardTop}>
                  <div className={styles.personaIdentity}>
                    <Avatar
                      size={36}
                      shape="square"
                      color={isActive ? 'brand' : 'neutral'}
                      name={p.name}
                      icon={<span aria-hidden>{p.avatar}</span>}
                    />
                    <div className={styles.personaNameBlock}>
                      {/* Body1Strong (14px) — was text-xs (12px). */}
                      <Body1Strong className={styles.truncate}>{p.name}</Body1Strong>
                      {/* Caption1 (12px) — was text-[10px]. */}
                      <Caption1 className={styles.truncate}>{p.role}</Caption1>
                    </div>
                  </div>
                  <Badge appearance="outline" color="informative" size="small">
                    {p.department.split(' ')[0]}
                  </Badge>
                </div>

                <Divider />

                <div className={styles.chipRow}>
                  <Caption1Strong className={styles.chipRowLabel}>Channels</Caption1Strong>
                  {p.collaborationPattern.slice(0, 3).map((ch) => (
                    <Badge key={ch} appearance="tint" color="brand" size="small">
                      {ch}
                    </Badge>
                  ))}
                </div>

                <div className={styles.chipRow}>
                  <Caption1Strong className={styles.chipRowLabel}>Sensitivity</Caption1Strong>
                  {p.sensitivitySet.slice(0, 2).map((sen) => (
                    <Badge key={sen} appearance="tint" color="danger" size="small">
                      {sen}
                    </Badge>
                  ))}
                </div>

                <div className={styles.personaOutcome}>
                  <Caption1 className={styles.truncate}>
                    <Target20Regular style={{ verticalAlign: 'text-bottom' }} />{' '}
                    {p.outcomePriorities[0]}
                  </Caption1>
                  <ChevronRight16Regular />
                </div>
              </Card>
            );
          })}
        </aside>

        {/* ── CENTRE ────────────────────────────────────────────────────── */}
        <main className={styles.main}>
          <MessageBar intent={transSliderPos < 30 ? 'warning' : 'info'}>
            <MessageBarBody>
              <MessageBarTitle>Insight ribbon</MessageBarTitle>{' '}
              {activePersona.insightRibbonText} <em>{ribbonModeNote}</em>
            </MessageBarBody>
          </MessageBar>

          <Card className={styles.heroCard}>
            <div className={styles.heroHeader}>
              <div className={styles.heroIdentity}>
                <Avatar
                  size={56}
                  shape="square"
                  color="brand"
                  name={activePersona.name}
                  icon={<span aria-hidden style={{ fontSize: '28px' }}>{activePersona.avatar}</span>}
                />
                <div>
                  <div className={styles.headerTitleRow}>
                    {/* Subtitle1 (20px) — the persona's name is the page's real subject. */}
                    <Subtitle1>{activePersona.name}</Subtitle1>
                    <Badge appearance="tint" color="brand">
                      {activePersona.department}
                    </Badge>
                  </div>
                  {/* Body1 (14px) — was text-xs (12px). */}
                  <Body1>
                    {activePersona.role} · {activePersona.useCaseCluster}
                  </Body1>
                </div>
              </div>

              <div className={styles.heroActions}>
                <div className={styles.valueStat}>
                  <Caption1>Value potential</Caption1>
                  <Body1Strong>{activePersona.valuePotential.annualValuePerSeat}</Body1Strong>
                </div>
                <Button
                  appearance="primary"
                  icon={isExpanded ? <ChevronUp20Regular /> : <ChevronDown20Regular />}
                  iconPosition="after"
                  onClick={() => setIsExpanded((v) => !v)}
                >
                  {isExpanded ? 'Collapse 7-part story' : 'Expand full 7-part narrative'}
                </Button>
              </div>
            </div>

            <Divider />

            {!isExpanded ? (
              <>
                <Card appearance="filled-alternative" className={styles.quoteCard}>
                  <Caption1Strong>Persona story narrative synthesis</Caption1Strong>
                  {/* Body2 (16px) — the hero narrative was text-sm (14px) sitting in a sea of 9–11px. */}
                  <Body2>{activePersona.shortStory.summary}</Body2>
                </Card>

                {/* Transformation surface — rebuilt on the real Fluent Slider rather
                    than importing the Tailwind-styled TransformationSurface, so the
                    preview is 100% Fluent chrome over the same real values. */}
                <Card appearance="filled" className={styles.panel}>
                  <div className={styles.transHead}>
                    <span className={styles.sectionHeading}>
                      <Sparkle20Filled />
                      <Body1Strong>Telemetry reality → Copilot-optimised</Body1Strong>
                    </span>
                    <Badge appearance="tint" color="brand">
                      {transSliderPos}% transformed
                    </Badge>
                  </div>

                  <div className={styles.transSliderRow}>
                    <Caption1>Reality</Caption1>
                    <Slider
                      className={styles.transSlider}
                      min={0}
                      max={100}
                      step={1}
                      value={transSliderPos}
                      onChange={(_e, data) => setTransSliderPos(data.value)}
                      aria-label="Transformation blend between telemetry reality and Copilot-optimised state"
                    />
                    <Caption1>Optimised</Caption1>
                  </div>

                  <div className={styles.twoCol}>
                    <div className={styles.transColumn}>
                      <Caption1Strong className={styles.blockLabel}>
                        Before — telemetry reality
                      </Caption1Strong>
                      <Body1 as="p">
                        {activePersona.role} operates with unmonitored data exposure and manual
                        collaboration friction across {activePersona.collaborationPattern.length}{' '}
                        channels.
                      </Body1>
                      <ul className={styles.stateList}>
                        {activePersona.sensitivityExposure.map((item) => (
                          <li key={item.label} className={styles.stateListItem}>
                            <Caption1 className={styles.truncate}>{item.label}</Caption1>
                            <Badge
                              appearance="tint"
                              color={SEVERITY_BADGE_COLOR[item.severity]}
                              size="small"
                            >
                              {item.severity}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className={styles.transColumn}>
                      <Caption1Strong className={styles.blockLabel}>
                        After — Copilot &amp; Purview governed
                      </Caption1Strong>
                      <Body1 as="p">
                        M365 Copilot and Purview auto-governance optimise {activePersona.name}
                        &apos;s daily workflow with zero credential leakage.
                      </Body1>
                      <ul className={styles.stateList}>
                        {activePersona.outcomePriorities.map((op) => (
                          <li key={op} className={styles.stateListItem}>
                            <Caption1 className={styles.truncate}>{op}</Caption1>
                            <Badge appearance="tint" color="success" size="small">
                              Automated
                            </Badge>
                          </li>
                        ))}
                      </ul>
                      <Body1 as="p">
                        {effectiveHoursSaved} hrs/wk saved (
                        {activePersona.valuePotential.annualValuePerSeat})
                      </Body1>
                    </div>
                  </div>
                </Card>

                <div className={styles.twoCol}>
                  <Card appearance="filled" className={styles.panel}>
                    <div className={styles.panelHeading}>
                      <Caption1Strong>Multi-select collaboration pattern</Caption1Strong>
                      <CounterBadge
                        count={activePersona.collaborationPattern.length}
                        appearance="filled"
                        color="brand"
                        size="small"
                      />
                    </div>
                    <div className={styles.chipRow}>
                      {activePersona.collaborationPattern.map((ch) => (
                        <Badge key={ch} appearance="tint" color="brand">
                          {ch}
                        </Badge>
                      ))}
                    </div>
                  </Card>

                  <Card appearance="filled" className={styles.panel}>
                    <div className={styles.panelHeading}>
                      <Caption1Strong>Multi-select sensitivity profile</Caption1Strong>
                      <CounterBadge
                        count={activePersona.sensitivitySet.length}
                        appearance="filled"
                        color="danger"
                        size="small"
                      />
                    </div>
                    <div className={styles.chipRow}>
                      {activePersona.sensitivitySet.map((sen) => (
                        <Badge key={sen} appearance="tint" color="danger">
                          {sen}
                        </Badge>
                      ))}
                    </div>
                  </Card>
                </div>

                <div className={styles.twoCol}>
                  <MessageBar intent="warning">
                    <MessageBarBody>
                      <MessageBarTitle>Telemetry reality check</MessageBarTitle>{' '}
                      {activePersona.shortStory.telemetryCheck}
                    </MessageBarBody>
                  </MessageBar>
                  <MessageBar intent="info">
                    <MessageBarBody>
                      <MessageBarTitle>Copilot value unlock</MessageBarTitle>{' '}
                      {activePersona.shortStory.copilotUnlock}
                    </MessageBarBody>
                  </MessageBar>
                </div>

                <Card appearance="filled" className={styles.panel}>
                  <div className={styles.panelHeading}>
                    <span className={styles.sectionHeading}>
                      <Target20Regular />
                      <Caption1Strong>Outcome priorities</Caption1Strong>
                    </span>
                    <div className={styles.chipRow}>
                      <Caption1>Weekly return</Caption1>
                      <Body1Strong>
                        {activePersona.valuePotential.hoursSavedPerWeek} hrs/week
                      </Body1Strong>
                      <Caption1>ROI multiplier</Caption1>
                      <Body1Strong>{activePersona.valuePotential.roiMultiplier}</Body1Strong>
                    </div>
                  </div>
                  <div className={styles.chipRow}>
                    {activePersona.outcomePriorities.map((op) => (
                      <Badge key={op} appearance="tint" color="success">
                        {op}
                      </Badge>
                    ))}
                  </div>
                </Card>
              </>
            ) : (
              <>
                <div className={styles.sectionHeading}>
                  <Sparkle20Filled />
                  <Body1Strong>Full 7-part persona narrative surface</Body1Strong>
                </div>

                <div className={styles.twoCol}>
                  <NarrativeSection
                    icon={<PeopleTeam20Regular />}
                    label="1. Identity &amp; role context"
                    body={activePersona.expandedNarrative.identityContext}
                  />
                  <NarrativeSection
                    icon={<LockClosed20Regular />}
                    label="2. Collaboration patterns &amp; sensitivity"
                    body={activePersona.expandedNarrative.collaborationSensitivity}
                  />
                  <NarrativeSection
                    icon={<Warning20Filled />}
                    label="3. Telemetry reality check"
                    body={activePersona.expandedNarrative.telemetryRealityCheck}
                  />
                  <NarrativeSection
                    icon={<Pulse20Regular />}
                    label="4. Workflow friction &amp; governance gaps"
                    body={activePersona.expandedNarrative.workflowFriction}
                  />
                  <NarrativeSection
                    icon={<CheckmarkCircle20Regular />}
                    label="5. Use-case feasibility &amp; adoption"
                    body={activePersona.expandedNarrative.feasibilityReadiness}
                  />
                  <NarrativeSection
                    icon={<Flash20Filled />}
                    label="6. Copilot value story"
                    body={activePersona.expandedNarrative.copilotValueStory}
                  />
                </div>

                <Card className={styles.roiBanner}>
                  <div className={styles.roiBannerHead}>
                    <span className={styles.sectionHeading}>
                      <ArrowTrendingLines20Regular />
                      <Body1Strong>7. Persona-specific ROI potential &amp; seat value</Body1Strong>
                    </span>
                    <Title3>{activePersona.valuePotential.annualValuePerSeat}</Title3>
                  </div>
                  <Body1>{activePersona.expandedNarrative.roiBreakdown}</Body1>
                </Card>

                <div className={styles.centerRow}>
                  <Button
                    appearance="secondary"
                    icon={<ChevronUp20Regular />}
                    onClick={() => setIsExpanded(false)}
                  >
                    Collapse 7-part story view
                  </Button>
                </div>
              </>
            )}
          </Card>
        </main>

        {/* ── RIGHT RAIL ────────────────────────────────────────────────── */}
        <aside className={styles.metricsRail}>
          <div className={styles.railHeading}>
            <span className={styles.railHeadingLabel}>
              <Pulse20Regular />
              <Caption1Strong>Persona telemetry metrics</Caption1Strong>
            </span>
            <Badge appearance="tint" color="brand" size="small">
              Live fusion
            </Badge>
          </div>

          <Card appearance="filled" className={styles.panel}>
            <div className={styles.panelHeading}>
              <Caption1Strong>Score vectors</Caption1Strong>
              {/* Caption2 (10px) is legitimate here: a bare axis unit, not content. */}
              <Caption2>0–100 scale</Caption2>
            </div>
            <div className={styles.gaugeGrid}>
              <Gauge
                label="Risk score"
                value={effectiveRiskScore}
                display={String(effectiveRiskScore)}
                stroke={riskStrokeToken(effectiveRiskScore)}
                badgeText={risk.text}
                badgeColor={risk.color}
              />
              <Gauge
                label="Feasibility"
                value={effectiveFeasibilityScore}
                display={`${effectiveFeasibilityScore}%`}
                stroke={tokens.colorBrandForeground1}
                badgeText="High readiness"
                badgeColor="brand"
              />
            </div>
          </Card>

          <Card appearance="filled" className={styles.panel}>
            <div className={styles.panelHeading}>
              <Caption1Strong>Adoption friction</Caption1Strong>
              <Body1Strong>{effectiveAdoptionFriction}%</Body1Strong>
            </div>
            {/* Real Fluent ProgressBar rather than a hand-rolled gradient div. */}
            <ProgressBar
              value={Math.min(100, effectiveAdoptionFriction) / 100}
              thickness="large"
              shape="rounded"
              color={
                effectiveAdoptionFriction > 60
                  ? 'error'
                  : effectiveAdoptionFriction > 35
                    ? 'warning'
                    : 'success'
              }
            />
            <Caption1>Change management resistance factor</Caption1>
          </Card>

          <Card appearance="filled" className={styles.panel}>
            <Caption1Strong>Sensitivity exposure (telemetry × quiz)</Caption1Strong>
            {activePersona.sensitivityExposure.map((item) => (
              <button
                key={item.label}
                type="button"
                className={styles.issueRow}
                onClick={() =>
                  setSelectedIssue({
                    label: item.label,
                    category: 'sensitivity',
                    severity: item.severity,
                  })
                }
              >
                <Caption1 className={styles.truncate}>{item.label}</Caption1>
                <Badge appearance="tint" color={SEVERITY_BADGE_COLOR[item.severity]} size="small">
                  {item.severity}
                </Badge>
              </button>
            ))}
          </Card>

          <Card appearance="filled" className={styles.panel}>
            <Caption1Strong>Collaboration friction bottlenecks</Caption1Strong>
            {activePersona.collaborationFriction.map((item) => (
              <button
                key={item.label}
                type="button"
                className={styles.issueRow}
                onClick={() =>
                  setSelectedIssue({
                    label: item.label,
                    category: 'friction',
                    severity: item.severity,
                  })
                }
              >
                <Caption1 className={styles.truncate}>{item.label}</Caption1>
                <Badge appearance="tint" color={SEVERITY_BADGE_COLOR[item.severity]} size="small">
                  {item.severity}
                </Badge>
              </button>
            ))}
          </Card>

          <Card appearance="filled" className={styles.panel}>
            <div className={styles.panelHeading}>
              <span className={styles.sectionHeading}>
                <ArrowTrendingLines20Regular />
                <Caption1Strong>Value potential ROI vector</Caption1Strong>
              </span>
              <Body1Strong>{activePersona.valuePotential.roiMultiplier}</Body1Strong>
            </div>
            <div className={styles.statGrid}>
              <div className={styles.stat}>
                <Caption1>Weekly return</Caption1>
                <Body1Strong>
                  {activePersona.valuePotential.hoursSavedPerWeek} hrs/wk
                </Body1Strong>
              </div>
              <div className={styles.stat}>
                <Caption1>Annual seat value</Caption1>
                <Body1Strong>{activePersona.valuePotential.annualValuePerSeat}</Body1Strong>
              </div>
            </div>
            {/* Body1 (14px) — real prose, so it takes the body size even though
                production had it at text-[9.5px]. */}
            <Body1>{activePersona.valuePotential.primaryBenefit}</Body1>
          </Card>

          {/* Caption2 (10px) — a provenance stamp, the other legitimate micro-label. */}
          <div className={styles.railFooter}>
            <Caption2>Persona Cohort Fusion Engine · live telemetry active</Caption2>
          </div>
        </aside>
      </div>

      <IssueDetailDialog
        issue={selectedIssue}
        onClose={() => setSelectedIssue(null)}
        fetchWithAuth={fetchWithAuth}
        context={{
          role: quizProfile.role,
          department: quizProfile.department,
          industry: quizProfile.industry,
          personaName: activePersona.name,
          personaRole: activePersona.role,
          useCaseCluster: activePersona.useCaseCluster,
          collaborationPattern: activePersona.collaborationPattern,
          sensitivitySet: activePersona.sensitivitySet,
        }}
      />
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
 * Subcomponents
 * ──────────────────────────────────────────────────────────────────────────── */

const NarrativeSection: React.FC<{ icon: React.ReactNode; label: string; body: string }> = ({
  icon,
  label,
  body,
}) => {
  const styles = useStyles();
  return (
    <Card appearance="filled" className={styles.panel}>
      <span className={styles.sectionHeading}>
        {icon}
        <Caption1Strong>{label}</Caption1Strong>
      </span>
      {/* Body1 (14px) — production rendered all seven of these at text-xs (12px). */}
      <Body1>{body}</Body1>
    </Card>
  );
};

/**
 * Radial score gauge. Fluent 2 ships no radial primitive, so this stays a small
 * SVG — but every colour comes from a real Fluent palette token and the numeral
 * sits on the real type ramp, so it reads as part of the system rather than
 * beside it. (The linear metric next to it uses the real Fluent ProgressBar.)
 */
const Gauge: React.FC<{
  label: string;
  value: number;
  display: string;
  stroke: string;
  badgeText: string;
  badgeColor: BadgeColor;
}> = ({ label, value, display, stroke, badgeText, badgeColor }) => {
  const styles = useStyles();
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference;

  return (
    <div className={styles.gauge}>
      <Caption1>{label}</Caption1>
      <div className={styles.gaugeRing}>
        <svg className={styles.gaugeSvg} width="72" height="72" aria-hidden>
          <circle
            cx="36"
            cy="36"
            r={radius}
            stroke={tokens.colorNeutralStroke2}
            strokeWidth="6"
            fill="transparent"
          />
          <circle
            cx="36"
            cy="36"
            r={radius}
            stroke={stroke}
            strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            fill="transparent"
          />
        </svg>
        {/* Subtitle2 (16px) — the number is the point of the component. */}
        <Subtitle2 className={styles.gaugeValue}>{display}</Subtitle2>
      </div>
      <Badge appearance="tint" color={badgeColor} size="small">
        {badgeText}
      </Badge>
    </div>
  );
};

/**
 * Real Fluent Dialog over the real remediation-detail endpoint (#195) — the
 * same call UseCaseIssueModal makes, so the content here is genuinely
 * AI-generated for this persona, not canned preview copy.
 */
const IssueDetailDialog: React.FC<{
  issue: { label: string; category: IssueCategory; severity: PersonaSeverity } | null;
  onClose: () => void;
  fetchWithAuth: FetchWithAuth;
  context: RemediationContext;
}> = ({ issue, onClose, fetchWithAuth, context }) => {
  const styles = useStyles();
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [result, setResult] = useState<RemediationDetailResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const contextKey = useMemo(() => JSON.stringify(context), [context]);

  useEffect(() => {
    if (!issue) {
      setStatus('idle');
      setResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setResult(null);
    setError(null);
    fetchRemediationDetail(fetchWithAuth, issue, JSON.parse(contextKey) as RemediationContext)
      .then((detail) => {
        if (cancelled) return;
        setResult(detail);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Remediation guidance failed');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
    // contextKey is the stable serialisation of `context`; depending on the
    // object itself would refetch on every parent render.
  }, [issue, fetchWithAuth, contextKey]);

  return (
    <Dialog open={issue !== null} onOpenChange={(_e, data) => !data.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle
            action={
              <Button appearance="subtle" icon={<Dismiss20Regular />} onClick={onClose} aria-label="Close" />
            }
          >
            {issue?.label ?? ''}
          </DialogTitle>
          <DialogContent>
            <div className={styles.dialogSection}>
              {issue && (
                <div className={styles.chipRow}>
                  <Badge appearance="tint" color={SEVERITY_BADGE_COLOR[issue.severity]}>
                    {issue.severity} severity
                  </Badge>
                  <Badge appearance="outline" color="informative">
                    {issue.category}
                  </Badge>
                </div>
              )}

              {status === 'loading' && <Spinner size="small" label="Generating remediation guidance…" />}

              {status === 'error' && (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}

              {status === 'ready' && result && (
                <>
                  {/* Body1 (14px) — the production modal renders this at text-xs. */}
                  <Body1>{result.detail}</Body1>
                  <Divider />
                  <Caption1Strong>Remediation steps</Caption1Strong>
                  <ol className={styles.dialogSteps}>
                    {result.steps.map((step, idx) => (
                      <li key={idx}>
                        <Body1>{step.text}</Body1>
                        {step.code && <CodeBlock code={step.code} />}
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>
              Close
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};

const CodeBlock: React.FC<{ code: string }> = ({ code }) => {
  const styles = useStyles();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeBlockHead}>
        {/* Caption2 (10px) — a language stamp, a genuine micro-label. */}
        <Caption2>PowerShell</Caption2>
        <Link as="button" onClick={handleCopy}>
          <span className={styles.centerRow}>
            {copied ? <Checkmark16Regular /> : <Copy16Regular />}
            <Caption1>{copied ? 'Copied' : 'Copy'}</Caption1>
          </span>
        </Link>
      </div>
      <pre className={styles.codePre}>{code}</pre>
    </div>
  );
};

/** Loading / error / blocked shell — honest states, never a fabricated persona. */
const StatusShell: React.FC<{
  themeSwitcher: React.ReactNode;
  intent: 'info' | 'warning' | 'error';
  icon: React.ReactNode;
  title: string;
  detail: string;
  progressPct?: number;
  onExitClick?: () => void;
  onHelpClick?: () => void;
}> = ({ themeSwitcher, intent, icon, title, detail, progressPct, onExitClick, onHelpClick }) => {
  const styles = useStyles();
  return (
    <div className={styles.root}>
      <MessageBar intent="warning" className={styles.previewBanner}>
        <MessageBarBody>
          <MessageBarTitle>Fluent 2 design preview — not the production screen.</MessageBarTitle>{' '}
          Isolated evaluation artifact for issue #288.
        </MessageBarBody>
      </MessageBar>

      <header className={styles.header}>
        <div className={styles.headerIdentity}>
          <div className={styles.headerMark}>
            <PeopleTeam24Regular />
          </div>
          <Subtitle2>Persona Stories &amp; Cohort Fusion</Subtitle2>
        </div>
        <div className={styles.headerActions}>
          {themeSwitcher}
          {onHelpClick && (
            <Button appearance="subtle" icon={<QuestionCircle20Regular />} onClick={onHelpClick}>
              Spec info
            </Button>
          )}
          {onExitClick && (
            <Tooltip content="Exit preview" relationship="label">
              <Button appearance="subtle" icon={<Dismiss20Regular />} onClick={onExitClick} />
            </Tooltip>
          )}
        </div>
      </header>

      <div className={styles.statusPane}>
        <Card className={styles.statusCard}>
          {icon}
          <Subtitle1>{title}</Subtitle1>
          <Body1>{detail}</Body1>
          {typeof progressPct === 'number' && (
            <ProgressBar
              value={Math.min(100, Math.max(0, progressPct)) / 100}
              thickness="large"
              shape="rounded"
            />
          )}
          {intent === 'error' && (
            <MessageBar intent="error">
              <MessageBarBody>The preview shows the real failure state, unmodified.</MessageBarBody>
            </MessageBar>
          )}
        </Card>
      </div>
    </div>
  );
};
