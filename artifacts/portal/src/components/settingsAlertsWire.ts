/**
 * settingsAlertsWire.ts — the wire shapes behind GET/PUT
 * /api/portal/alert-preferences and GET /api/portal/alert-preferences/rules,
 * the Settings page's "Alert preferences" tab (Git #1276/#1278, wired by
 * #1736). `customer_alert_preferences` — a real, distinct 7-category
 * monitoring-digest taxonomy, not the 15-category
 * `customer_notification_preferences` bell system (that's the separate
 * "Notifications" tab). See docs/portal/alert_preferences.md.
 *
 * Pure functions, no React — the fetching lives in `settingsAlertsLive.ts`.
 */

export const ALERT_CATEGORIES = [
  "findings",
  "drift",
  "progress",
  "reviews",
  "remediation",
  "billing",
  "support",
] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

export type AlertDigestMode = "immediate" | "daily" | "weekly";
export type AlertPreset = "close" | "balanced" | "quiet" | "custom";

export interface AlertCategoryPref {
  readonly enabled: boolean;
  readonly emailEnabled: boolean;
  readonly mode: AlertDigestMode;
  readonly threshold: string;
}

export interface AlertSettings {
  readonly activePreset: AlertPreset;
  readonly quietHoursEnabled: boolean;
  readonly quietHoursFrom: string;
  readonly quietHoursTo: string;
  readonly quietBreakForCritical: boolean;
  readonly updatedAt: string | null;
  readonly updatedByName: string | null;
}

export interface AlertRecipient {
  readonly email: string;
  readonly role: string | null;
  /** null = scoped to all categories. */
  readonly scopeCategories: readonly AlertCategory[] | null;
}

export interface AlertPrimaryRecipient {
  readonly email: string;
  readonly name: string | null;
}

export interface AlertPreferencesProfile {
  readonly categories: Record<AlertCategory, AlertCategoryPref>;
  readonly settings: AlertSettings;
  readonly primaryRecipient: AlertPrimaryRecipient;
  readonly recipients: readonly AlertRecipient[];
}

export interface AlertRule {
  readonly ruleKey: string;
  readonly label: string;
  readonly alertCategory: AlertCategory | string;
  readonly severity: string;
  readonly detectorStatus: string;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function toMode(v: unknown): AlertDigestMode {
  return v === "daily" || v === "weekly" ? v : "immediate";
}

function toPreset(v: unknown): AlertPreset {
  return v === "close" || v === "quiet" || v === "custom" ? v : "balanced";
}

function toCategoryPref(raw: unknown): AlertCategoryPref {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    enabled: bool(row.enabled, true),
    emailEnabled: bool(row.emailEnabled, true),
    mode: toMode(row.mode),
    threshold: str(row.threshold, ""),
  };
}

export function isAlertCategory(v: string): v is AlertCategory {
  return (ALERT_CATEGORIES as readonly string[]).includes(v);
}

export function toAlertPreferencesProfile(raw: unknown): AlertPreferencesProfile {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawCategories = body.categories && typeof body.categories === "object" ? (body.categories as Record<string, unknown>) : {};
  const categories = {} as Record<AlertCategory, AlertCategoryPref>;
  for (const cat of ALERT_CATEGORIES) categories[cat] = toCategoryPref(rawCategories[cat]);

  const rawSettings = body.settings && typeof body.settings === "object" ? (body.settings as Record<string, unknown>) : {};
  const settings: AlertSettings = {
    activePreset: toPreset(rawSettings.activePreset),
    quietHoursEnabled: bool(rawSettings.quietHoursEnabled, true),
    quietHoursFrom: str(rawSettings.quietHoursFrom, "19:00"),
    quietHoursTo: str(rawSettings.quietHoursTo, "07:30"),
    quietBreakForCritical: bool(rawSettings.quietBreakForCritical, true),
    updatedAt: typeof rawSettings.updatedAt === "string" ? rawSettings.updatedAt : null,
    updatedByName: typeof rawSettings.updatedByName === "string" ? rawSettings.updatedByName : null,
  };

  const rawPrimary = body.primaryRecipient && typeof body.primaryRecipient === "object" ? (body.primaryRecipient as Record<string, unknown>) : {};
  const primaryRecipient: AlertPrimaryRecipient = {
    email: str(rawPrimary.email),
    name: typeof rawPrimary.name === "string" ? rawPrimary.name : null,
  };

  const rawRecipients = Array.isArray(body.recipients) ? body.recipients : [];
  const recipients: AlertRecipient[] = rawRecipients.map((r) => {
    const row = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
    const rawScope = Array.isArray(row.scopeCategories) ? row.scopeCategories : null;
    return {
      email: str(row.email),
      role: typeof row.role === "string" ? row.role : null,
      scopeCategories: rawScope ? rawScope.filter((c): c is string => typeof c === "string" && isAlertCategory(c)) as AlertCategory[] : null,
    };
  });

  return { categories, settings, primaryRecipient, recipients };
}

export function toAlertRules(raw: unknown): readonly AlertRule[] {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rows = Array.isArray(body.rules) ? body.rules : [];
  return rows
    .map((r) => {
      const row = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
      return {
        ruleKey: str(row.ruleKey),
        label: str(row.label),
        alertCategory: str(row.alertCategory),
        severity: str(row.severity, "info"),
        detectorStatus: str(row.detectorStatus, "live"),
      };
    })
    .filter((r) => r.ruleKey !== "");
}
