// artifacts/admin-panel/src/components/AssessmentCreationWizard.tsx
//
// Simulator Assessments Phase 5 (Issue #28) — the assessment creation wizard.
// Opened via useModal().openModal("new-assessment", { assessments }) from
// SimulatorLeftTree.tsx's Section 11 header ("+" button or right-click "New
// Assessment"), rendered inside the shared ModalContainer's Dialog
// (contexts/ModalContext.tsx), which passes modalData.assessments and
// closeModal down as this component's `existingAssessments`/`onClose` props
// rather than this file calling useModal() itself — see the props-driven
// note below.
//
// No new backend routes: every step is built entirely on top of EXISTING
// admin CRUD —
//   Step 2 "create new package" -> POST /api/admin/monitoring-packages
//   Step 3 check selection      -> GET  /api/admin/monitor-checks (catalog)
//                                   PUT  /api/admin/monitoring-packages/:key/checks
//   Step 1 + final submit       -> POST /api/admin/services
// (admin-monitor-checks.ts, admin-services.ts). Only admin-services.ts itself
// changed for this phase — POST /admin/services was silently dropping
// category/basePrice/maxPrice/sortOrder/tagline/bestFor (and, found in the
// same pass, description/isFreeOffering/allowFreeCheckout) which would have
// left a wizard-created assessment invisible to every category='assessment'
// query. Fixed there, not worked around here.
//
// `existingAssessments` is Phase 1's already-fetched AssessmentNode[]
// (GET /api/admin/simulator/assessments) — reused for slug-uniqueness
// validation, the default sortOrder (max existing + 1), and detecting when an
// "attach to existing package" choice already backs another assessment.

import { useEffect, useMemo, useState } from "react";
import { DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Loader2,
  AlertTriangle,
  Package,
  Search,
  X,
} from "lucide-react";
import type { AssessmentNode } from "./SimulatorLeftTree";

interface MonitorCheckOption {
  key: string;
  label: string;
  description: string | null;
  status: string;
}

interface MonitoringPackageOption {
  key: string;
  label: string;
  description: string | null;
  status: string;
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type PackageMode = "create" | "attach";

const STEP_LABELS: Record<number, string> = {
  1: "Service",
  2: "Package",
  3: "Checks",
  4: "Review",
};

interface AssessmentCreationWizardProps {
  /** Phase 1's already-fetched assessment catalog (SimulatorLeftTree.tsx's
   *  `assessments` state) — reused here rather than re-fetched. */
  existingAssessments: AssessmentNode[];
  onClose: () => void;
}

// Props-driven rather than reading useModal() directly: ModalContext.tsx
// imports this component, so importing useModal back from here would create
// a module cycle (the same reason that file's editorSurfaceTheme is defined
// locally instead of imported from a component).
export function AssessmentCreationWizard({ existingAssessments, onClose }: AssessmentCreationWizardProps) {
  const { fetchWithAuth } = useAuth();

  // ── Step 1: service metadata ────────────────────────────────────────────
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [tagline, setTagline] = useState("");
  const [bestFor, setBestFor] = useState("");
  const [isFreeOffering, setIsFreeOffering] = useState(false);
  const [allowFreeCheckout, setAllowFreeCheckout] = useState(false);
  const [allowFreeCheckoutEdited, setAllowFreeCheckoutEdited] = useState(false);
  const [basePrice, setBasePrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [sortOrderEdited, setSortOrderEdited] = useState(false);

  // ── Step 2: package ──────────────────────────────────────────────────────
  const [packageMode, setPackageMode] = useState<PackageMode>("create");
  const [newPackageName, setNewPackageName] = useState("");
  const [newPackageKey, setNewPackageKey] = useState("");
  const [packageKeyEdited, setPackageKeyEdited] = useState(false);
  const [attachPackageKey, setAttachPackageKey] = useState("");
  const [packages, setPackages] = useState<MonitoringPackageOption[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);

  // ── Step 3: checks (only reachable when packageMode === "create") ──────
  const [allChecks, setAllChecks] = useState<MonitorCheckOption[]>([]);
  const [loadingChecks, setLoadingChecks] = useState(false);
  const [checkSearch, setCheckSearch] = useState("");
  const [selectedCheckKeys, setSelectedCheckKeys] = useState<string[]>([]);

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ message: string; createdPackageKey: string | null } | null>(null);

  // Default sortOrder = max(existing) + 1, computed from Phase 1's
  // already-fetched catalog rather than a second fetch — stops once the
  // operator edits it directly.
  useEffect(() => {
    if (!sortOrderEdited) {
      const maxExisting = existingAssessments.reduce((m, a) => Math.max(m, a.sortOrder ?? 0), 0);
      setSortOrder(maxExisting + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingAssessments.length, sortOrderEdited]);

  // Auto-derive slug from name until the operator edits it directly.
  useEffect(() => {
    if (!slugEdited) setSlug(slugify(name));
  }, [name, slugEdited]);

  // allowFreeCheckout defaults to match isFreeOffering until edited directly.
  useEffect(() => {
    if (!allowFreeCheckoutEdited) setAllowFreeCheckout(isFreeOffering);
  }, [isFreeOffering, allowFreeCheckoutEdited]);

  // Auto-derive the new package key from the slug (assess:<slug>, the same
  // pattern as the 4 real dedicated packages) until edited directly.
  useEffect(() => {
    if (!packageKeyEdited) setNewPackageKey(slug ? `assess:${slug}` : "");
  }, [slug, packageKeyEdited]);

  // Monitoring package catalog — needed for the "attach" dropdown AND
  // create-mode key-uniqueness validation.
  useEffect(() => {
    let cancelled = false;
    setLoadingPackages(true);
    (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/monitoring-packages");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setPackages(data.packages ?? []);
        }
      } catch {
        // Dropdown/validation just stays empty; submit-time checks still guard.
      } finally {
        if (!cancelled) setLoadingPackages(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  // Full monitor check catalog for Step 3 — same route the M365 Endpoints
  // tree node already uses.
  useEffect(() => {
    let cancelled = false;
    setLoadingChecks(true);
    (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/monitor-checks");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setAllChecks(data.checks ?? []);
        }
      } catch {
        // Step 3 list just stays empty; submit-time validation still guards.
      } finally {
        if (!cancelled) setLoadingChecks(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  // Packages eligible for "attach to existing" — dedicated assess:* keys plus
  // the core:security-baseline fallback, matched by pattern rather than
  // hardcoding the 4 current names so a newly-created assess:* package is
  // immediately attachable too.
  const attachablePackages = useMemo(
    () => packages.filter((p) => p.key.startsWith("assess:") || p.key === "core:security-baseline"),
    [packages],
  );

  // Other assessments already backed by the currently-chosen attach target —
  // drives the "editing this will affect every assessment using it" notice.
  const attachSharedWith = useMemo(() => {
    if (packageMode !== "attach" || !attachPackageKey) return [];
    return existingAssessments.filter((a) => a.packageKey === attachPackageKey);
  }, [packageMode, attachPackageKey, existingAssessments]);

  const slugTaken = useMemo(
    () => slug.trim().length > 0 && existingAssessments.some((a) => (a.slug ?? "").toLowerCase() === slug.trim().toLowerCase()),
    [existingAssessments, slug],
  );

  const newPackageKeyTaken = useMemo(
    () => newPackageKey.trim().length > 0 && packages.some((p) => p.key === newPackageKey.trim()),
    [packages, newPackageKey],
  );

  const checksByDomain = useMemo(() => {
    const q = checkSearch.trim().toLowerCase();
    const filtered = q
      ? allChecks.filter((c) => `${c.key} ${c.label} ${c.description ?? ""}`.toLowerCase().includes(q))
      : allChecks;
    const grouped: Record<string, MonitorCheckOption[]> = {};
    for (const check of filtered) {
      const domain = check.key.includes(":") ? check.key.split(":")[0]! : "other";
      (grouped[domain] ??= []).push(check);
    }
    return grouped;
  }, [allChecks, checkSearch]);

  const checkByKey = useMemo(() => new Map(allChecks.map((c) => [c.key, c])), [allChecks]);

  const toggleCheck = (key: string) => {
    setSelectedCheckKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const moveCheck = (index: number, dir: -1 | 1) => {
    setSelectedCheckKeys((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeCheck = (key: string) => {
    setSelectedCheckKeys((prev) => prev.filter((k) => k !== key));
  };

  // Step 3 only exists in the flow when creating a new package.
  const visibleSteps = packageMode === "create" ? [1, 2, 3, 4] : [1, 2, 4];
  const stepPosition = visibleSteps.indexOf(step) + 1;

  function validateStep(s: number): string | null {
    if (s === 1) {
      if (!name.trim()) return "Name is required";
      if (!slug.trim()) return "Slug is required";
      if (!/^[a-z0-9-]+$/.test(slug.trim())) return "Slug must be lowercase letters, numbers, and dashes only";
      if (slugTaken) return `Slug "${slug.trim()}" is already used by another assessment in the catalog`;
      return null;
    }
    if (s === 2) {
      if (packageMode === "create") {
        if (!newPackageName.trim()) return "Package name is required";
        if (!/^assess:[a-z0-9-]+$/.test(newPackageKey.trim())) return 'Package key must look like "assess:<slug>"';
        if (newPackageKeyTaken) return `Package key "${newPackageKey.trim()}" already exists`;
      } else if (!attachPackageKey) {
        return "Select a package to attach to";
      }
      return null;
    }
    if (s === 3) {
      if (selectedCheckKeys.length === 0) return "Select at least one check for the new package";
      return null;
    }
    return null;
  }

  const goNext = () => {
    const err = validateStep(step);
    if (err) {
      toast.error(err);
      return;
    }
    const idx = visibleSteps.indexOf(step);
    const nextStep = visibleSteps[idx + 1];
    if (nextStep != null) setStep(nextStep);
  };

  const goBack = () => {
    const idx = visibleSteps.indexOf(step);
    const prevStep = visibleSteps[idx - 1];
    if (prevStep != null) setStep(prevStep);
  };

  const resolvedPackageKey = packageMode === "attach" ? attachPackageKey.trim() : newPackageKey.trim();

  const servicePayload = {
    name: name.trim(),
    slug: slug.trim(),
    description: description.trim() || null,
    category: "assessment",
    tagline: tagline.trim() || null,
    bestFor: bestFor.trim() || null,
    isFreeOffering,
    allowFreeCheckout,
    basePrice: basePrice.trim() || null,
    maxPrice: maxPrice.trim() || null,
    sortOrder,
    typeAttributes: { packageKey: resolvedPackageKey },
  };

  const newPackagePayload =
    packageMode === "create" ? { key: newPackageKey.trim(), label: newPackageName.trim() } : null;

  const checksPayload = packageMode === "create" ? { checkKeys: selectedCheckKeys } : null;

  const handleSubmit = async () => {
    const err = validateStep(1) ?? validateStep(2) ?? (packageMode === "create" ? validateStep(3) : null);
    if (err) {
      toast.error(err);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    let createdPackageKey: string | null = null;

    try {
      if (packageMode === "create" && newPackagePayload) {
        const pkgRes = await fetchWithAuth("/api/admin/monitoring-packages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newPackagePayload),
        });
        const pkgData = await pkgRes.json();
        if (!pkgRes.ok) {
          toast.error(pkgData.error || "Failed to create monitoring package");
          setSubmitting(false);
          return;
        }
        createdPackageKey = pkgData.package.key as string;

        const checksRes = await fetchWithAuth(
          `/api/admin/monitoring-packages/${encodeURIComponent(createdPackageKey)}/checks`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(checksPayload),
          },
        );
        const checksData = await checksRes.json();
        if (!checksRes.ok) {
          // Package exists but has no checks yet — surface the key rather
          // than silently discarding it (do not attempt the service create).
          setSubmitError({
            message: `Package "${createdPackageKey}" was created, but setting its checks failed: ${checksData.error || "unknown error"}. The package exists — attach checks to it manually via the Monitoring Packages admin, or retry.`,
            createdPackageKey,
          });
          setSubmitting(false);
          return;
        }
      }

      const svcRes = await fetchWithAuth("/api/admin/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(servicePayload),
      });
      const svcData = await svcRes.json();
      if (!svcRes.ok) {
        setSubmitError({
          message: createdPackageKey
            ? `The monitoring package "${createdPackageKey}" was created (with its checks set), but creating the assessment failed: ${svcData.error || "unknown error"}. The package was NOT rolled back — retry service creation pointing at packageKey "${createdPackageKey}", or clean it up manually via the Monitoring Packages admin.`
            : svcData.error || "Failed to create assessment",
          createdPackageKey,
        });
        setSubmitting(false);
        return;
      }

      toast.success(`Assessment "${svcData.name}" created`);
      window.dispatchEvent(new CustomEvent("simulator-assessments-updated"));
      onClose();
    } catch (err: any) {
      setSubmitError({ message: err.message || "Network error creating assessment", createdPackageKey });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <DialogHeader>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-card border border-border">
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
          <div>
            <DialogTitle className="text-lg font-semibold text-foreground">New Assessment</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Step {stepPosition} of {visibleSteps.length} — {STEP_LABELS[step]}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      {/* Step indicator */}
      <div className="flex items-center gap-1.5">
        {visibleSteps.map((s, i) => (
          <div key={s} className="flex items-center gap-1.5">
            <div
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                s === step
                  ? "bg-primary text-primary-foreground"
                  : visibleSteps.indexOf(step) > i
                    ? "bg-emerald-400/20 text-emerald-400"
                    : "bg-card text-muted-foreground border border-border"
              }`}
            >
              {i + 1}
            </div>
            {i < visibleSteps.length - 1 && <div className="h-px w-6 bg-border" />}
          </div>
        ))}
      </div>

      <div className="max-h-[55vh] overflow-y-auto pr-1 space-y-4">
        {/* ── Step 1: Service metadata ───────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="assessment-name" className="text-xs font-semibold text-muted-foreground">Name</Label>
                <Input
                  id="assessment-name"
                  placeholder="Entra ID Governance Assessment"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-background border-border text-foreground text-xs h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assessment-slug" className="text-xs font-semibold text-muted-foreground">Slug</Label>
                <Input
                  id="assessment-slug"
                  placeholder="entra-id-governance-assessment"
                  value={slug}
                  onChange={(e) => {
                    setSlugEdited(true);
                    setSlug(e.target.value);
                  }}
                  className={`bg-background border-border text-foreground text-xs h-9 font-mono ${slugTaken ? "border-destructive" : ""}`}
                />
                {slugTaken && <p className="text-[10px] text-destructive">Already used by another assessment.</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Description</Label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="What this assessment evaluates and delivers"
                className="w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Tagline</Label>
                <Input
                  placeholder="Find what's broken before it costs you"
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  className="bg-background border-border text-foreground text-xs h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Best for</Label>
                <Input
                  placeholder="Mid-market IT teams"
                  value={bestFor}
                  onChange={(e) => setBestFor(e.target.value)}
                  className="bg-background border-border text-foreground text-xs h-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Category</Label>
              <Input value="assessment" disabled className="bg-card border-border text-muted-foreground text-xs h-9 font-mono disabled:opacity-70" />
              <p className="text-[10px] text-muted-foreground">This wizard only creates assessments.</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Base price ($)</Label>
                <Input
                  type="number"
                  placeholder="500"
                  value={basePrice}
                  onChange={(e) => setBasePrice(e.target.value)}
                  className="bg-background border-border text-foreground text-xs h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Max price ($)</Label>
                <Input
                  type="number"
                  placeholder="750"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  className="bg-background border-border text-foreground text-xs h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Sort order</Label>
                <Input
                  type="number"
                  value={sortOrder}
                  onChange={(e) => {
                    setSortOrderEdited(true);
                    setSortOrder(Number(e.target.value));
                  }}
                  className="bg-background border-border text-foreground text-xs h-9"
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card/50">
              <div>
                <h4 className="text-xs font-semibold text-foreground">Free offering</h4>
                <p className="text-[10px] text-muted-foreground">Shown in the tree's "Free" group instead of "Paid".</p>
              </div>
              <Checkbox checked={isFreeOffering} onCheckedChange={(v) => setIsFreeOffering(v === true)} />
            </div>

            <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card/50">
              <div>
                <h4 className="text-xs font-semibold text-foreground">Allow free checkout</h4>
                <p className="text-[10px] text-muted-foreground">Defaults to match "Free offering" above — editable independently.</p>
              </div>
              <Checkbox
                checked={allowFreeCheckout}
                onCheckedChange={(v) => {
                  setAllowFreeCheckoutEdited(true);
                  setAllowFreeCheckout(v === true);
                }}
              />
            </div>
          </div>
        )}

        {/* ── Step 2: Package ─────────────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-3.5">
            <RadioGroup value={packageMode} onValueChange={(v) => setPackageMode(v as PackageMode)} className="grid grid-cols-2 gap-3">
              <label
                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${
                  packageMode === "create" ? "border-primary bg-primary/5" : "border-border bg-card/50"
                }`}
              >
                <RadioGroupItem value="create" className="mt-0.5" />
                <div>
                  <div className="text-xs font-semibold text-foreground">Create new package</div>
                  <p className="text-[10px] text-muted-foreground">A dedicated monitoring package just for this assessment.</p>
                </div>
              </label>
              <label
                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${
                  packageMode === "attach" ? "border-primary bg-primary/5" : "border-border bg-card/50"
                }`}
              >
                <RadioGroupItem value="attach" className="mt-0.5" />
                <div>
                  <div className="text-xs font-semibold text-foreground">Attach to existing package</div>
                  <p className="text-[10px] text-muted-foreground">Reuse an existing dedicated package or the core:security-baseline fallback.</p>
                </div>
              </label>
            </RadioGroup>

            {packageMode === "create" ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="new-package-name" className="text-xs font-semibold text-muted-foreground">Package name</Label>
                  <Input
                    id="new-package-name"
                    placeholder="Entra ID Governance"
                    value={newPackageName}
                    onChange={(e) => setNewPackageName(e.target.value)}
                    className="bg-background border-border text-foreground text-xs h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-package-key" className="text-xs font-semibold text-muted-foreground">Package key</Label>
                  <Input
                    id="new-package-key"
                    placeholder="assess:entra-id-governance"
                    value={newPackageKey}
                    onChange={(e) => {
                      setPackageKeyEdited(true);
                      setNewPackageKey(e.target.value);
                    }}
                    className={`bg-background border-border text-foreground text-xs h-9 font-mono ${newPackageKeyTaken ? "border-destructive" : ""}`}
                  />
                  {newPackageKeyTaken && <p className="text-[10px] text-destructive">A package with this key already exists.</p>}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground">Attach to</Label>
                {loadingPackages ? (
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading packages…
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {attachablePackages.map((p) => (
                      <label
                        key={p.key}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 ${
                          attachPackageKey === p.key ? "border-primary bg-primary/5" : "border-border bg-card/50"
                        }`}
                      >
                        <input
                          type="radio"
                          name="attach-package"
                          checked={attachPackageKey === p.key}
                          onChange={() => setAttachPackageKey(p.key)}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs text-foreground">{p.label}</div>
                          <div className="truncate font-mono text-[10px] text-muted-foreground">{p.key}</div>
                        </div>
                      </label>
                    ))}
                    {attachablePackages.length === 0 && (
                      <p className="text-[11px] italic text-muted-foreground">No dedicated assessment packages found.</p>
                    )}
                  </div>
                )}

                {attachSharedWith.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-[11px] text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      This package already backs {attachSharedWith.length === 1 ? "another assessment" : `${attachSharedWith.length} other assessments`}
                      {" "}({attachSharedWith.map((a) => a.name).join(", ")}). Editing its checks later will affect every assessment using it.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Check selection (create-package flow only) ──────────── */}
        {step === 3 && packageMode === "create" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={checkSearch}
                  onChange={(e) => setCheckSearch(e.target.value)}
                  placeholder="Filter checks…"
                  className="w-full rounded border border-border bg-background py-1 pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                />
              </div>
              {loadingChecks ? (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading checks…
                </div>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {Object.keys(checksByDomain)
                    .sort()
                    .map((domain) => (
                      <div key={domain}>
                        <div className="px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 capitalize">
                          {domain}
                        </div>
                        {checksByDomain[domain]!.map((check) => (
                          <label
                            key={check.key}
                            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-accent"
                          >
                            <Checkbox
                              checked={selectedCheckKeys.includes(check.key)}
                              onCheckedChange={() => toggleCheck(check.key)}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[11px] text-foreground">{check.label}</div>
                              <div className="truncate font-mono text-[10px] text-muted-foreground">{check.key}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    ))}
                  {Object.keys(checksByDomain).length === 0 && (
                    <p className="text-[11px] italic text-muted-foreground">No checks match this filter.</p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground">Selected ({selectedCheckKeys.length})</Label>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border bg-card/50 p-1.5">
                {selectedCheckKeys.length === 0 ? (
                  <p className="p-2 text-[11px] italic text-muted-foreground">No checks selected yet.</p>
                ) : (
                  selectedCheckKeys.map((key, i) => (
                    <div key={key} className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1">
                      <span className="w-4 shrink-0 text-center text-[9px] tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground">
                        {checkByKey.get(key)?.label ?? key}
                      </span>
                      <button
                        onClick={() => moveCheck(i, -1)}
                        disabled={i === 0}
                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                        title="Move up"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => moveCheck(i, 1)}
                        disabled={i === selectedCheckKeys.length - 1}
                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                        title="Move down"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => removeCheck(key)}
                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Step 4: Review ───────────────────────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-3">
            {packageMode === "create" && (
              <>
                <div>
                  <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    POST /api/admin/monitoring-packages
                  </h4>
                  <pre className="max-h-32 overflow-y-auto rounded-lg border border-border bg-card p-2.5 font-mono text-[11px] text-emerald-400">
                    {JSON.stringify(newPackagePayload, null, 2)}
                  </pre>
                </div>
                <div>
                  <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    PUT /api/admin/monitoring-packages/{newPackageKey.trim()}/checks
                  </h4>
                  <pre className="max-h-32 overflow-y-auto rounded-lg border border-border bg-card p-2.5 font-mono text-[11px] text-emerald-400">
                    {JSON.stringify(checksPayload, null, 2)}
                  </pre>
                </div>
              </>
            )}
            <div>
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                POST /api/admin/services
              </h4>
              <pre className="max-h-48 overflow-y-auto rounded-lg border border-border bg-card p-2.5 font-mono text-[11px] text-emerald-400">
                {JSON.stringify(servicePayload, null, 2)}
              </pre>
            </div>

            {submitError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-[11px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{submitError.message}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <Button
          variant="outline"
          onClick={() => (stepPosition === 1 ? onClose() : goBack())}
          disabled={submitting}
          className="bg-transparent border-border hover:bg-accent hover:text-foreground text-xs"
        >
          {stepPosition === 1 ? (
            "Cancel"
          ) : (
            <>
              <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Back
            </>
          )}
        </Button>

        {step === 4 ? (
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs flex items-center gap-2 px-4"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…
              </>
            ) : (
              "Create Assessment"
            )}
          </Button>
        ) : (
          <Button
            onClick={goNext}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs flex items-center gap-2 px-4"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
