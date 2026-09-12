/**
 * Display helpers ported verbatim from the design's own logic class
 * (`Risk Register.dc.html`'s `tone()`/`money()`), so the exact hex/rgba values
 * this specific screen was designed against survive into the real build
 * unchanged — not substituted for the shell's own (slightly different) token
 * set, which belongs to the chrome, not this module.
 */
import type { RawRiskLevel, ResidualRiskLevel, RiskAcceptanceStatus, RiskInstanceStatus } from "@/api/rbd-api";

export type ToneKind = "green" | "amber" | "red" | "blue" | "violet" | "slate";

/** [text color, tint background, border color] — the design's own 3-tuple. */
export type Tone = readonly [color: string, tint: string, line: string];

const TONES: Record<ToneKind, Tone> = {
  green: ["#34d399", "rgba(52,211,153,.1)", "rgba(52,211,153,.26)"],
  amber: ["#fbbf24", "rgba(251,191,36,.1)", "rgba(251,191,36,.26)"],
  red: ["#f87171", "rgba(248,113,113,.1)", "rgba(248,113,113,.26)"],
  blue: ["#60a5fa", "rgba(96,165,250,.1)", "rgba(96,165,250,.26)"],
  violet: ["#a78bfa", "rgba(167,139,250,.1)", "rgba(167,139,250,.26)"],
  slate: ["#94a3b8", "rgba(148,163,184,.08)", "rgba(148,163,184,.2)"],
};

export function tone(kind: ToneKind | undefined): Tone {
  return TONES[kind ?? "slate"];
}

export function money(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1).replace(".0", "") + "m";
  if (n >= 1_000) return "$" + Math.round(n / 1_000) + "k";
  return "$" + n;
}

/** Raw/residual risk level → tone, exactly as the design's `LEVEL` map. */
const LEVEL_TONE: Record<RawRiskLevel | ResidualRiskLevel, ToneKind> = {
  critical: "red",
  high: "amber",
  medium: "blue",
  low: "green",
};

export function levelTone(level: RawRiskLevel | ResidualRiskLevel): Tone {
  return tone(LEVEL_TONE[level]);
}

/**
 * Acceptance status → tone, extending the design's `ST` map with
 * `converted_to_poam` — a real fourth `RISK_ACCEPTANCE_STATUSES` value the
 * design's own filter/status set never pictured (the prototype predates the
 * POA&M conversion route, #3081). Left un-fabricated: violet keeps it visually
 * distinct from the three the design already tones, rather than mislabeling it
 * as one of them.
 */
const STATUS_TONE: Record<RiskAcceptanceStatus, ToneKind> = {
  active: "green",
  pending_signature: "amber",
  revoked: "slate",
  converted_to_poam: "violet",
};

export function statusTone(status: RiskAcceptanceStatus): Tone {
  return tone(STATUS_TONE[status]);
}

export function statusLabel(status: RiskAcceptanceStatus): string {
  switch (status) {
    case "pending_signature": return "awaiting signature";
    case "converted_to_poam": return "converted to POA&M";
    default: return status;
  }
}

const ITEM_TONE: Record<RiskInstanceStatus, ToneKind> = {
  active: "amber",
  remediated: "green",
  object_removed: "slate",
};

export function instanceTone(status: RiskInstanceStatus): Tone {
  return tone(ITEM_TONE[status]);
}

export function instanceStatusLabel(status: RiskInstanceStatus): string {
  return status === "object_removed" ? "gone" : status;
}

export function instanceIcon(status: RiskInstanceStatus): string {
  if (status === "active") return "circle-dot";
  if (status === "remediated") return "circle-check-big";
  return "circle-minus";
}

const CONTROL_TONE: Record<string, readonly [string, string]> = {
  technical: ["#60a5fa", "shield"],
  administrative: ["#a78bfa", "file-text"],
  operational: ["#34d399", "eye"],
};

export function controlToneAndIcon(type: string): readonly [string, string] {
  return CONTROL_TONE[type] ?? CONTROL_TONE.technical;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Same real generation scheme `admin-rbd.ts`'s own POST route already uses for
 * new `rbdId`s — `msp-rbd.ts`'s create route takes `rbdId` from the caller
 * rather than assigning one itself, so the client must supply a real one. */
export function generateRbdId(): string {
  return `RBD-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;
}

/** A representative numeric score for a qualitative level, since the create
 * drawer (matching the design) only collects the level, not a hand-typed
 * score — every row's `raw/residualRiskScore` needs a real int, so this is a
 * documented, deterministic band rather than a fabricated random number. */
export function representativeScore(level: RawRiskLevel | ResidualRiskLevel): number {
  switch (level) {
    case "critical": return 90;
    case "high": return 70;
    case "medium": return 45;
    case "low": return 20;
  }
}

/** sha256 hex digest via the browser's SubtleCrypto — the same
 * evidentiary-hash concept `portal-rbd-document.ts` computes server-side
 * (`sha256(rbdId + versionUid + signerName + timestamp)`), computed
 * client-side here because `msp-rbd.ts`'s `PATCH .../sign` schema puts the
 * burden of supplying `signatureHash` on the caller — this route is the MSP
 * operator attesting to a signature captured off-platform, not a live
 * in-browser signing ceremony (see `msp-rbd-versions.ts`'s own comment on the
 * sibling `/versions/:versionUid/sign` route). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
