// artifacts/admin-panel/src/components/AssessmentDeleteDeprecateModals.tsx
//
// Simulator Assessments Phase 7 (Issue #30) — delete / deprecate. Opened via
// useModal().openModal("delete-assessment", { assessment, assessments })
// (delete) or openModal("deprecate-assessment", { assessment }) (deprecate)
// from SimulatorLeftTree.tsx's Section 11 rows, rendered inside the shared
// ModalContainer's Dialog (contexts/ModalContext.tsx) — same props-driven
// pattern AssessmentCreationWizard.tsx documents (importing useModal back
// from here would create the same module cycle: ModalContext.tsx imports
// this file).
//
// No new backend routes — both actions reuse EXISTING admin CRUD as-is:
//   Delete    -> DELETE /api/admin/services/:id (admin-services.ts). Already
//                blocks with 409 + a real message when referenced by
//                client_services, contracts, workflow_templates, or
//                contract_templates — surfaced verbatim below, never
//                rewritten, and never auto-retried as a deprecate (the
//                operator chooses that explicitly, from the tree, if they
//                want it).
//   Deprecate -> PUT /api/admin/services/:id with visibility: "private".
//                servicesTable has no archived/deprecated column, so
//                deprecate = unpublish while keeping the row (and every
//                grandfathered client_services access) intact. PUT sets
//                nearly every column unconditionally from the request body,
//                so this GETs the full current row first and spreads it into
//                the PUT body with only `visibility` overridden — the exact
//                round-trip rule AssessmentCreationWizard.tsx's editPutBody
//                established for this same route.
//
// A successful delete of an assessment that was the LAST one pointing at a
// dedicated (non-null, non-core:security-baseline) packageKey offers to also
// archive that now-orphaned monitoring package via DELETE
// /api/admin/monitoring-packages/:key — that route archives unconditionally
// with no reference check of its own (unlike the services delete route), so
// the zero-other-referencing-assessments gate here (the same reference-
// counting AssessmentCreationWizard.tsx's attachSharedWith does, inverted to
// count === 0) is what keeps it from being offered — let alone called — for
// a still-shared package. It's always an explicit opt-in, offered as a
// second step of the SAME confirm flow, never a surprise second dialog and
// never automatic.

import { useState } from "react";
import { DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Trash2, Archive, AlertTriangle, Loader2, Package } from "lucide-react";
import type { AssessmentNode } from "./SimulatorLeftTree";

// Matched by literal, the same convention AssessmentCreationWizard.tsx's
// attachablePackages filter uses (`p.key === "core:security-baseline"`)
// rather than importing the backend's CORE_SECURITY_BASELINE_FALLBACK
// constant across the client/server boundary.
const CORE_SECURITY_BASELINE_FALLBACK = "core:security-baseline";

function dispatchAssessmentsUpdated() {
  // Same event AssessmentCreationWizard.tsx fires on create/edit success —
  // SimulatorLeftTree.tsx already listens for it and reloads Phase 1's tree
  // data, so a deleted/deprecated row is reflected without a manual reload.
  window.dispatchEvent(new CustomEvent("simulator-assessments-updated"));
}

// ─── Delete ─────────────────────────────────────────────────────────────────

interface DeleteAssessmentModalProps {
  assessment: AssessmentNode;
  /** Phase 1's already-fetched catalog — used only to count other
   *  assessments still referencing this one's packageKey, for the
   *  package-archive offer. */
  existingAssessments: AssessmentNode[];
  onClose: () => void;
}

type DeletePhase = "confirm" | "blocked" | "package-offer";

export function DeleteAssessmentModal({ assessment, existingAssessments, onClose }: DeleteAssessmentModalProps) {
  const { fetchWithAuth } = useAuth();
  const [phase, setPhase] = useState<DeletePhase>("confirm");
  const [working, setWorking] = useState(false);
  const [blockerMessage, setBlockerMessage] = useState<string | null>(null);

  // Same reference-counting logic as AssessmentCreationWizard.tsx's
  // attachSharedWith, inverted to "count === 0" — only offered for a
  // dedicated package this assessment was the LAST one using.
  const otherAssessmentsOnPackage = assessment.packageKey
    ? existingAssessments.filter((a) => a.packageKey === assessment.packageKey && a.id !== assessment.id).length
    : 0;
  const packageArchiveEligible =
    assessment.packageKey != null &&
    assessment.packageKey !== CORE_SECURITY_BASELINE_FALLBACK &&
    otherAssessmentsOnPackage === 0;

  const handleDelete = async () => {
    setWorking(true);
    try {
      const res = await fetchWithAuth(`/api/admin/services/${assessment.id}`, { method: "DELETE" });
      if (res.status === 409) {
        const data = await res.json();
        // Surfaced verbatim — this is the route's real blocker message, not
        // a rewritten one.
        setBlockerMessage(data.error || "This assessment cannot be deleted because it is referenced elsewhere.");
        setPhase("blocked");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        toast.error(data.error || "Failed to delete assessment");
        return;
      }
      // 204 No Content — nothing to parse.
      toast.success(`Assessment "${assessment.name}" deleted`);
      dispatchAssessmentsUpdated();
      if (packageArchiveEligible) {
        setPhase("package-offer");
      } else {
        onClose();
      }
    } catch (err: any) {
      toast.error(err.message || "Network error deleting assessment");
    } finally {
      setWorking(false);
    }
  };

  const handleArchivePackage = async () => {
    if (!assessment.packageKey) return;
    setWorking(true);
    try {
      const res = await fetchWithAuth(`/api/admin/monitoring-packages/${encodeURIComponent(assessment.packageKey)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}) as { error?: string });
      if (res.ok) {
        toast.success(`Package "${assessment.packageKey}" archived`);
        onClose();
      } else {
        toast.error(data.error || "Failed to archive package");
      }
    } catch (err: any) {
      toast.error(err.message || "Network error archiving package");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-4">
      <DialogHeader>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-card border border-border">
            <Trash2 className="w-5 h-5 text-destructive" />
          </div>
          <div>
            <DialogTitle className="text-lg font-semibold text-foreground">Delete Assessment</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">{assessment.name}</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      {phase === "confirm" && (
        <>
          <p className="text-xs text-foreground/90">
            Delete <span className="font-semibold">{assessment.name}</span>? This permanently removes it from the
            catalog. This cannot be undone.
          </p>
          <div className="flex justify-end gap-3 pt-3 border-t border-border">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={working}
              className="bg-transparent border-border hover:bg-accent hover:text-foreground text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={working}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-medium text-xs flex items-center gap-2 px-4"
            >
              {working ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </>
              )}
            </Button>
          </div>
        </>
      )}

      {phase === "blocked" && (
        <>
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-[11px] text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{blockerMessage}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            To unpublish this assessment without removing it, close this dialog and use "Deprecate" instead.
          </p>
          <div className="flex justify-end pt-3 border-t border-border">
            <Button
              variant="outline"
              onClick={onClose}
              className="bg-transparent border-border hover:bg-accent hover:text-foreground text-xs"
            >
              Close
            </Button>
          </div>
        </>
      )}

      {phase === "package-offer" && (
        <>
          <div className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-[11px] text-amber-300">
            <Package className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              "{assessment.name}" was the only assessment using monitoring package{" "}
              <span className="font-mono">{assessment.packageKey}</span>. Also archive this now-unused package?
            </span>
          </div>
          <div className="flex justify-end gap-3 pt-3 border-t border-border">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={working}
              className="bg-transparent border-border hover:bg-accent hover:text-foreground text-xs"
            >
              Skip
            </Button>
            <Button
              onClick={handleArchivePackage}
              disabled={working}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs flex items-center gap-2 px-4"
            >
              {working ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Archiving…
                </>
              ) : (
                <>
                  <Archive className="w-3.5 h-3.5" /> Archive Package
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Deprecate ──────────────────────────────────────────────────────────────

interface DeprecateAssessmentModalProps {
  assessment: AssessmentNode;
  onClose: () => void;
}

export function DeprecateAssessmentModal({ assessment, onClose }: DeprecateAssessmentModalProps) {
  const { fetchWithAuth } = useAuth();
  const [working, setWorking] = useState(false);

  const handleDeprecate = async () => {
    setWorking(true);
    try {
      const getRes = await fetchWithAuth(`/api/admin/services/${assessment.id}`);
      if (!getRes.ok) {
        toast.error("Failed to load current assessment details");
        return;
      }
      const fullRow = await getRes.json();
      // Round-trip the full GET row per the exact rule
      // AssessmentCreationWizard.tsx's editPutBody established for this
      // route (PUT /admin/services/:id sets nearly every column
      // unconditionally from the body) — only `visibility` is overridden.
      const putRes = await fetchWithAuth(`/api/admin/services/${assessment.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fullRow, visibility: "private" }),
      });
      const data = await putRes.json().catch(() => ({}) as { error?: string; name?: string });
      if (!putRes.ok) {
        toast.error(data.error || "Failed to deprecate assessment");
        return;
      }
      toast.success(`Assessment "${data.name ?? assessment.name}" deprecated`);
      dispatchAssessmentsUpdated();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Network error deprecating assessment");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-4">
      <DialogHeader>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-card border border-border">
            <Archive className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <DialogTitle className="text-lg font-semibold text-foreground">Deprecate Assessment</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">{assessment.name}</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <p className="text-xs text-foreground/90">
        Deprecate <span className="font-semibold">{assessment.name}</span>? This unpublishes it (visibility set to
        private) — existing client access stays grandfathered, and it can be edited back to public later. This is
        reversible.
      </p>

      <div className="flex justify-end gap-3 pt-3 border-t border-border">
        <Button
          variant="outline"
          onClick={onClose}
          disabled={working}
          className="bg-transparent border-border hover:bg-accent hover:text-foreground text-xs"
        >
          Cancel
        </Button>
        <Button
          onClick={handleDeprecate}
          disabled={working}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs flex items-center gap-2 px-4"
        >
          {working ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Deprecating…
            </>
          ) : (
            <>
              <Archive className="w-3.5 h-3.5" /> Deprecate
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
