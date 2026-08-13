import type { QuizProfile } from './types';

// Deterministic ROI scoring (Copilot Assessment epic #183, Phase 7 / #190).
// No AI, no telemetry — pure function over the quiz's own load values
// (QuizProfile.draftingLoad/researchLoad/communicationLoad/repetitiveLoad).
//
// Weights below are Shane's blueprint starting point, not verified against
// real customer outcomes yet. FLAGGED FOR SHANE: LicenseWasteReduction has
// no source anywhere in the current QuizProfile shape or quiz UI (#184) — it
// isn't a telemetry signal (this phase is explicitly telemetry-free) and
// isn't collected by the quiz. `licenseWasteReduction` is left as an
// optional input defaulting to 0 until a real source exists; until then the
// blueprint's 0.10 weight is effectively dead weight on every score. Confirm
// whether that weight should be redistributed across the four real loads or
// wait for a real input before this ships in front of a customer.
export const ROI_SCORE_WEIGHTS = {
  draftingLoad: 0.3,
  researchLoad: 0.25,
  communicationLoad: 0.2,
  repetitiveLoad: 0.15,
  licenseWasteReduction: 0.1,
} as const;

// Also flag for Shane: these convert the 0-100 score into hours/$/percent
// and aren't part of the blueprint's formula — they're this phase's own
// assumptions, not yet validated against real customer data.
export const ROI_SCORE_ASSUMPTIONS = {
  maxWeeklyHoursSavedAtScore100: 15,
  blendedHourlyRateUsd: 65, // matches RoiScreen.tsx's existing simulation rate
  weeksPerYear: 52,
} as const;

export interface RoiScoreInput {
  quizProfile: Pick<
    QuizProfile,
    'draftingLoad' | 'researchLoad' | 'communicationLoad' | 'repetitiveLoad'
  >;
  /** 0-1. Not currently collected anywhere — see the flag above. Defaults to 0. */
  licenseWasteReduction?: number;
}

export interface RoiScoreResult {
  score: number; // 0-100
  timeSavedHoursPerWeek: number;
  costSavedPerYear: number;
  efficiencyGainPct: number; // 0-100
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function calculateRoiScore(input: RoiScoreInput): RoiScoreResult {
  const { draftingLoad, researchLoad, communicationLoad, repetitiveLoad } = input.quizProfile;
  const licenseWasteReduction = input.licenseWasteReduction ?? 0;

  const weightedLoad =
    clamp01(draftingLoad) * ROI_SCORE_WEIGHTS.draftingLoad +
    clamp01(researchLoad) * ROI_SCORE_WEIGHTS.researchLoad +
    clamp01(communicationLoad) * ROI_SCORE_WEIGHTS.communicationLoad +
    clamp01(repetitiveLoad) * ROI_SCORE_WEIGHTS.repetitiveLoad +
    clamp01(licenseWasteReduction) * ROI_SCORE_WEIGHTS.licenseWasteReduction;

  const score = Math.round(weightedLoad * 100);

  const timeSavedHoursPerWeek =
    Math.round((score / 100) * ROI_SCORE_ASSUMPTIONS.maxWeeklyHoursSavedAtScore100 * 10) / 10;

  const costSavedPerYear = Math.round(
    timeSavedHoursPerWeek * ROI_SCORE_ASSUMPTIONS.weeksPerYear * ROI_SCORE_ASSUMPTIONS.blendedHourlyRateUsd
  );

  return {
    score,
    timeSavedHoursPerWeek,
    costSavedPerYear,
    efficiencyGainPct: score,
  };
}
