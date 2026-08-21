/**
 * alertPrefsModel.ts — the Alert preferences derivations (Part 12).
 *
 * Transcribes the prototype's preset apply / select-desc / per-category dest
 * logic (Customer Portal Shell.dc.html 15238-15311). Named and tested here so
 * "Balanced is the seed" and "editing a row switches the preset to Custom" can't
 * silently drift.
 */

import {
  ALERT_CUSTOM_DESC,
  ALERT_PRESETS,
  type AlertCatKey,
  type AlertPref,
  type AlertPrefs,
  type AlertPresetKey,
} from "./alertPrefsData";

/** A preset key, or the row-by-row "custom" state — prototype's select value. */
export type AlertSelectValue = AlertPresetKey | "custom";

/** The prefs a preset produces — prototype `ALERT_PRESETS.find(...).apply()`. */
export function applyPreset(key: AlertPresetKey): AlertPrefs {
  const p = ALERT_PRESETS.find((x) => x.key === key);
  if (!p) throw new Error(`unknown preset ${key}`);
  return p.apply();
}

/** The default prefs the page opens with — prototype seed (7372-7380) = Balanced. */
export const ALERT_PREFS_SEED: AlertPrefs = applyPreset("balanced");

/** The posture <select> options — prototype 15240. */
export const ALERT_SELECT_OPTIONS: readonly { value: AlertSelectValue; label: string }[] = [
  ...ALERT_PRESETS.map((p) => ({ value: p.key as AlertSelectValue, label: p.label })),
  { value: "custom" as AlertSelectValue, label: "Custom" },
];

/** The description under the posture select — prototype 15245. */
export function presetDesc(value: AlertSelectValue): string {
  return ALERT_PRESETS.find((p) => p.key === value)?.desc ?? ALERT_CUSTOM_DESC;
}

/** The "Preset: <label>" name — prototype 15760. */
export function presetLabel(value: AlertSelectValue): string {
  return ALERT_PRESETS.find((p) => p.key === value)?.label ?? "Custom";
}

/** The "Where it goes" select value for a category — prototype 15285. */
export function catDestValue(pref: AlertPref): "email" | "inapp" {
  return pref.email ? "email" : "inapp";
}

/**
 * Apply a patch to one category — prototype `setPref` (15259-15263): merges the
 * patch and flips the active preset to "custom", because any row edit means the
 * choices no longer match a posture.
 */
export function patchPref(
  prefs: AlertPrefs,
  key: AlertCatKey,
  patch: Partial<AlertPref>,
): AlertPrefs {
  return { ...prefs, [key]: { ...prefs[key], ...patch } };
}
