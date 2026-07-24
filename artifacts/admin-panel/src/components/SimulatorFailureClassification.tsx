// artifacts/admin-panel/src/components/SimulatorFailureClassification.tsx
//
// The failure triage banner for the Simulator Studio's "M365 Endpoints" node
// (phase 4), plus the shared category chip the run-history rows use.
//
// WHAT THIS REPLACES: reading raw `error_message` text out of the database by
// hand and bucketing it by eye. The category, the evidence and the extracted
// permission name are all computed server-side by the real classifier
// (api-server lib/monitor-failure-classifier.ts) from that same real error text —
// this component only renders its answer.
//
// IT IS THE FIRST THING VISIBLE ON A FAILURE, deliberately: it sits directly under
// the run status and above the response viewer, because a triage that has to be
// hunted for is the thing it was built to remove.
//
// THE SAFETY BOUNDARY, which is the load-bearing part of this phase:
//   • Nothing here applies a fix. Every action opens a real, reviewable form or a
//     confirmed, reversible status change.
//   • MISSING PERMISSION has NO action button at all — it is display only. Adding
//     a permission to the multi-tenant app forces re-consent on every connected
//     tenant, so it stays a deliberate human decision made elsewhere. This panel
//     names the permission and says where it is declared; it never offers to add it.
//   • RETIRE goes through the existing reversible archive action (status →
//     "archived"), behind the same confirm the header's Retire button uses. It
//     never hard-deletes.

import {
  AlertTriangle,
  Archive,
  FileWarning,
  KeyRound,
  Link2Off,
  PencilLine,
  Route,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";

// ─── API shape (matches api-server lib/monitor-failure-classifier.ts) ─────────

export type FailureCategory =
  | "missing_scope"
  | "wrong_endpoint"
  | "bad_path"
  | "parameter_slot"
  | "wrong_api_pattern"
  | "dead_api"
  | "license_gap"
  | "consent_revoked"
  | "unclassified";

export type FailureActionKind = "show_permission" | "edit_endpoint" | "retire_check" | "none";

export interface FailureClassification {
  category: FailureCategory;
  title: string;
  summary: string;
  guidance: string;
  evidence: string[];
  statusCode: number | null;
  permissions: string[];
  alreadyDeclaredPermissions: string[];
  action: { kind: FailureActionKind; label: string; focusField?: "endpoint" | "selectParams" | "requestBody" };
}

export interface ClassificationGroup {
  category: FailureCategory;
  title: string;
  count: number;
  checkKeys: string[];
  permissions: string[];
  alreadyDeclaredPermissions: string[];
  actionKind: FailureActionKind;
  guidance: string;
}

export interface BatchTriage {
  totalFailures: number;
  classifiedCount: number;
  unclassifiedCount: number;
  groups: ClassificationGroup[];
  permissionsNeeded: string[];
  permissionsAlreadyDeclared: string[];
}

// ─── Presentation ─────────────────────────────────────────────────────────────

/** Tone is a read of severity-to-the-operator, not of HTTP status. */
const CATEGORY_TONE: Record<FailureCategory, string> = {
  missing_scope: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  wrong_endpoint: "border-destructive/40 bg-destructive/10 text-destructive",
  bad_path: "border-destructive/40 bg-destructive/10 text-destructive",
  parameter_slot: "border-destructive/40 bg-destructive/10 text-destructive",
  wrong_api_pattern: "border-destructive/40 bg-destructive/10 text-destructive",
  dead_api: "border-muted-foreground/40 bg-muted/40 text-muted-foreground",
  license_gap: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  consent_revoked: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  unclassified: "border-border bg-card text-muted-foreground",
};

const CATEGORY_ICON: Record<FailureCategory, React.ComponentType<{ className?: string }>> = {
  missing_scope: KeyRound,
  wrong_endpoint: Link2Off,
  bad_path: Route,
  parameter_slot: SlidersHorizontal,
  wrong_api_pattern: FileWarning,
  dead_api: Archive,
  license_gap: KeyRound,
  consent_revoked: ShieldAlert,
  unclassified: AlertTriangle,
};

/** Compact chip for dense lists (run history, batch rows). */
export function FailureCategoryChip({ classification }: { classification: FailureClassification }) {
  const Icon = CATEGORY_ICON[classification.category];
  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-sm border px-1 text-[9px] uppercase tracking-wider ${CATEGORY_TONE[classification.category]}`}
      title={classification.summary}
    >
      <Icon className="h-2.5 w-2.5" />
      {classification.title}
    </span>
  );
}

// ─── The banner ───────────────────────────────────────────────────────────────

export function SimulatorFailureClassification({
  classification,
  /** Focus a field in the endpoint edit form already on screen. Opens, never saves. */
  onEditEndpoint,
  /** The existing reversible archive action (confirm → status "archived"). */
  onRetire,
  /** Hidden when the check is already archived — there is nothing left to retire. */
  canRetire = true,
}: {
  classification: FailureClassification;
  onEditEndpoint?: (focusField: "endpoint" | "selectParams" | "requestBody") => void;
  onRetire?: () => void;
  canRetire?: boolean;
}) {
  const Icon = CATEGORY_ICON[classification.category];
  const { action } = classification;

  const showEdit = action.kind === "edit_endpoint" && onEditEndpoint != null;
  const showRetire = action.kind === "retire_check" && onRetire != null && canRetire;

  return (
    <div className={`mb-3 rounded border ${CATEGORY_TONE[classification.category]}`}>
      <div className="flex items-start gap-2 px-3 py-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">{classification.title}</span>
            {classification.statusCode != null && (
              <span className="font-mono text-[10px] opacity-80">HTTP {classification.statusCode}</span>
            )}
          </div>
          <p className="mt-0.5 break-words text-[11px] opacity-95">{classification.summary}</p>

          {/* MISSING PERMISSION — display only, by design. No button adds this. */}
          {classification.permissions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider opacity-70">Named permission:</span>
              {classification.permissions.map((p) => {
                const declared = classification.alreadyDeclaredPermissions.some(
                  (d) => d.toLowerCase() === p.toLowerCase(),
                );
                return (
                  <span
                    key={p}
                    className="flex items-center gap-1 rounded-sm border border-current/30 bg-background/40 px-1.5 py-px font-mono text-[10px]"
                    title={
                      declared
                        ? "Already declared on the multi-tenant app — this tenant's consent predates it, so it needs re-consent, not a new declaration."
                        : "Not currently declared on the multi-tenant app."
                    }
                  >
                    {p}
                    {declared && <span className="text-[9px] uppercase tracking-wider opacity-70">declared</span>}
                  </span>
                );
              })}
            </div>
          )}

          <p className="mt-1.5 break-words text-[10px] leading-relaxed opacity-80">{classification.guidance}</p>

          {/* The proof: the literal signatures that produced this verdict. */}
          {classification.evidence.length > 0 && (
            <ul className="mt-1.5 space-y-px font-mono text-[10px] opacity-60">
              {classification.evidence.map((e, i) => (
                <li key={i} className="break-words">
                  · {e}
                </li>
              ))}
            </ul>
          )}
        </div>

        {(showEdit || showRetire) && (
          <div className="flex shrink-0 flex-col gap-1">
            {showEdit && (
              <button
                onClick={() => onEditEndpoint!(action.focusField ?? "endpoint")}
                className="flex items-center gap-1 rounded border border-current/40 px-2 py-1 text-[10px] font-semibold transition-opacity hover:opacity-80"
                title="Jump to the endpoint edit form — nothing is saved until you click Save"
              >
                <PencilLine className="h-3 w-3" /> {action.label}
              </button>
            )}
            {showRetire && (
              <button
                onClick={onRetire}
                className="flex items-center gap-1 rounded border border-current/40 px-2 py-1 text-[10px] font-semibold transition-opacity hover:opacity-80"
                title="Archive this check — reversible, never a delete"
              >
                <Archive className="h-3 w-3" /> {action.label}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Said out loud rather than left implicit, because the whole phase turns on it. */}
      {action.kind === "show_permission" && (
        <p className="border-t border-current/20 px-3 py-1.5 text-[10px] opacity-70">
          Display only — no button here grants a permission. Adding one forces re-consent on every connected tenant.
        </p>
      )}
    </div>
  );
}

// ─── Batch roll-up ────────────────────────────────────────────────────────────

/**
 * The batch triage panel: N failures collapsed into a short list of real causes.
 *
 * Actions are offered PER CHECK inside a group rather than per group — "edit the
 * endpoint" and "retire the check" are statements about one check, and a button
 * that applied either to six checks at once would be exactly the silent bulk
 * mutation this phase is built to avoid.
 */
export function SimulatorBatchTriage({
  triage,
  onEditCheck,
  onRetireCheck,
}: {
  triage: BatchTriage;
  onEditCheck?: (checkKey: string) => void;
  onRetireCheck?: (checkKey: string) => void;
}) {
  if (triage.totalFailures === 0) return null;

  return (
    <div className="mb-3 rounded border border-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Failure triage
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
          {triage.classifiedCount}/{triage.totalFailures} classified
          {triage.unclassifiedCount > 0 && ` · ${triage.unclassifiedCount} unclassified`}
        </span>
      </div>

      {/* The compounding win: the distinct permissions behind however many failures. */}
      {triage.permissionsNeeded.length > 0 && (
        <div className="border-b border-border bg-amber-400/10 px-2.5 py-1.5 text-[10px] text-amber-300">
          Distinct permission{triage.permissionsNeeded.length > 1 ? "s" : ""} named across this batch:{" "}
          <span className="font-mono">{triage.permissionsNeeded.join(", ")}</span>
          {triage.permissionsAlreadyDeclared.length > 0 && (
            <>
              {" "}
              — <span className="font-mono">{triage.permissionsAlreadyDeclared.join(", ")}</span>{" "}
              {triage.permissionsAlreadyDeclared.length > 1 ? "are" : "is"} already declared on the app, so those are
              re-consent cases rather than missing declarations.
            </>
          )}
        </div>
      )}

      <div className="divide-y divide-border">
        {triage.groups.map((group) => {
          const Icon = CATEGORY_ICON[group.category];
          return (
            <div key={group.category} className="px-2.5 py-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={`flex items-center gap-1 rounded-sm border px-1 text-[9px] uppercase tracking-wider ${CATEGORY_TONE[group.category]}`}
                >
                  <Icon className="h-2.5 w-2.5" />
                  {group.title}
                </span>
                <span className="text-[11px] tabular-nums text-foreground">
                  {group.count} of {triage.totalFailures} failure{triage.totalFailures > 1 ? "s" : ""}
                </span>
                {group.permissions.length > 0 && (
                  <span className="font-mono text-[10px] text-amber-300">{group.permissions.join(", ")}</span>
                )}
              </div>
              <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{group.guidance}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {group.checkKeys.map((key) => (
                  <span
                    key={key}
                    className="flex items-center gap-1 rounded-sm border border-border bg-background px-1.5 py-px font-mono text-[10px] text-muted-foreground"
                  >
                    {key}
                    {group.actionKind === "edit_endpoint" && onEditCheck && (
                      <button
                        onClick={() => onEditCheck(key)}
                        className="text-[9px] uppercase tracking-wider text-primary transition-opacity hover:opacity-80"
                        title="Open this check's endpoint edit form — nothing is saved until you click Save"
                      >
                        edit
                      </button>
                    )}
                    {group.actionKind === "retire_check" && onRetireCheck && (
                      <button
                        onClick={() => onRetireCheck(key)}
                        className="text-[9px] uppercase tracking-wider text-destructive transition-opacity hover:opacity-80"
                        title="Archive this check — reversible, never a delete"
                      >
                        retire
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
