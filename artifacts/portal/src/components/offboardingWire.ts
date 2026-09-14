/**
 * offboardingWire.ts — the wire shape behind `GET /api/portal/customer/export`
 * (Git #4002, contract pack §6, `docs/offboarding-contract-pack.md`), and the
 * pure normalisation the Offboarding page's export preview and "Affected now"
 * service list are built from.
 *
 * Pure functions, no React — the fetching lives in `offboardingLive.ts`.
 */

export interface WireExportService {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly purchasedAt?: unknown;
  readonly serviceName?: unknown;
  readonly billingType?: unknown;
  readonly price?: unknown;
}

export interface WireExportPayload {
  readonly exportedAt?: unknown;
  readonly customer?: {
    readonly name?: unknown;
    readonly domain?: unknown;
    readonly industry?: unknown;
    readonly tenantId?: unknown;
    readonly status?: unknown;
  } | null;
  readonly services?: readonly WireExportService[];
  readonly projects?: readonly unknown[];
  readonly reports?: readonly unknown[];
  readonly diagnostics?: readonly unknown[];
}

export interface ExportBlock {
  readonly label: string;
  readonly count: string;
  readonly what: string;
}

/** `client_services.status` (`"active" | "completed" | "paused"`, contract
 *  pack §7) mapped to the pill copy/colour the design's `pill()` helper
 *  draws — real enum values only, no invented fourth state. */
export interface AffectedServiceRow {
  readonly name: string;
  readonly billing: string;
  readonly status: string;
  readonly ink: string;
  readonly bg: string;
  readonly bd: string;
  /** `true` for `"active"`/`"paused"` — the rows `/portal/customer/offboard`
   *  actually touches; `false` for `"completed"`, left as-is. */
  readonly affected: boolean;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const STATUS_PILL: Record<string, { status: string; ink: string; bg: string; bd: string }> = {
  active: { status: "Active → paused", ink: "#34d399", bg: "rgba(52,211,153,.10)", bd: "rgba(52,211,153,.28)" },
  paused: { status: "Paused → paused", ink: "#fbbf24", bg: "rgba(251,191,36,.10)", bd: "rgba(251,191,36,.28)" },
  completed: { status: "Completed · untouched", ink: "#94a3b8", bg: "rgba(148,163,184,.08)", bd: "rgba(148,163,184,.22)" },
};

/** `services.billing_type` (`"one_time" | "recurring_monthly"`, contract
 *  pack §7) to the design's short billing-cadence label. */
function billingLabel(billingType: unknown): string {
  return str(billingType) === "recurring_monthly" ? "monthly" : "one-off";
}

export function toAffectedServices(payload: WireExportPayload | null | undefined): readonly AffectedServiceRow[] {
  const services = payload?.services;
  if (!Array.isArray(services)) return [];
  return services.map((s) => {
    const rawStatus = str(s.status);
    const pill = STATUS_PILL[rawStatus] ?? STATUS_PILL.completed;
    return {
      name: str(s.serviceName) || "Unnamed service",
      billing: billingLabel(s.billingType),
      status: pill.status,
      ink: pill.ink,
      bg: pill.bg,
      bd: pill.bd,
      affected: rawStatus === "active" || rawStatus === "paused",
    };
  });
}

/** The "Take a copy of your records first" summary row — real counts off the
 *  same payload the download itself sends, never a fixture. */
export function toExportBlocks(payload: WireExportPayload | null | undefined): readonly ExportBlock[] {
  const orgName = str(payload?.customer?.name) || "Your organisation";
  const services = Array.isArray(payload?.services) ? payload!.services!.length : 0;
  const projects = Array.isArray(payload?.projects) ? payload!.projects!.length : 0;
  const reports = Array.isArray(payload?.reports) ? payload!.reports!.length : 0;
  const diagnostics = Array.isArray(payload?.diagnostics) ? payload!.diagnostics!.length : 0;
  return [
    { label: "ORGANISATION", count: orgName, what: "name, domain, industry, tenant id, status" },
    { label: "SERVICES", count: String(services), what: "what was bought, when, billing type, historical price" },
    { label: "PROJECTS", count: String(projects), what: "title, status, progress" },
    { label: "REPORTS", count: String(reports), what: "title and period of each report filed" },
    { label: "ENGINE READINGS", count: String(diagnostics), what: "every score snapshot per signal engine, with its breakdown" },
  ];
}
