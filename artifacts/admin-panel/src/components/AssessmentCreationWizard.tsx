// artifacts/admin-panel/src/components/AssessmentCreationWizard.tsx
//
// Simulator Assessments Phase 5 (Issue #28) — the assessment creation wizard —
// extended in Phase 6 (Issue #29) to also drive editing an existing
// assessment, rather than forking a parallel component. Opened via
// useModal().openModal("new-assessment", { assessments }) (create) or
// openModal("new-assessment", { assessments, editingAssessment }) (edit) from
// SimulatorLeftTree.tsx's Section 11 header/rows, rendered inside the shared
// ModalContainer's Dialog (contexts/ModalContext.tsx), which passes
// modalData.assessments/editingAssessment and closeModal down as this
// component's `existingAssessments`/`editingAssessment`/`onClose` props
// rather than this file calling useModal() itself — see the props-driven
// note below.
//
// No new backend routes: every step is built entirely on top of EXISTING
// admin CRUD —
//   Step 2 "create new package" -> POST /api/admin/monitoring-packages
//   Step 3 check selection      -> GET  /api/admin/monitor-checks (catalog)
//                                   PUT  /api/admin/monitoring-packages/:key/checks
//   Step 1 + final submit       -> POST /api/admin/services (create)
//                                   GET/PUT /api/admin/services/:id (edit)
// (admin-monitor-checks.ts, admin-services.ts). Only admin-services.ts itself
// changed for this phase — POST /admin/services was silently dropping
// category/basePrice/maxPrice/sortOrder/tagline/bestFor (and, found in the
// same pass, description/isFreeOffering/allowFreeCheckout) which would have
// left a wizard-created assessment invisible to every category='assessment'
// query. Fixed there, not worked around here.
//
// PUT /admin/services/:id sets nearly every column unconditionally from the
// request body — a field the caller omits is written as NULL/default, not
// left unchanged (only priceCents/internalCostCents/annualPriceCents and
// allowFreeCheckout/fulfillmentType are presence-based). Edit mode therefore
// GETs the full current row first (editingFullRow) and spreads it into the
// PUT body (editPutBody), overriding only the fields this wizard actually
// edits — never constructing the PUT body from wizard form state alone.
//
// Edit mode also lets the operator modify an ATTACHED package's own checks
// (Step 3 is shown for "attach" too, not just "create", when editing) —
// pre-populated from GET /monitoring-packages/:key/checks. Because several
// real packages back more than one assessment today (assess:copilot-
// readiness backs both Copilot Readiness Snapshot and Copilot Readiness
// Assessment; assess:license-cost-optimization backs two more), changing
// that selection while attached to a package used elsewhere blocks on an
// explicit choice: save to the shared package (affects every assessment
// using it) or fork a new package with these changes, leaving the shared one
// untouched.
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
  Plus,
} from "lucide-react";
import type { AssessmentNode } from "./SimulatorLeftTree";

interface MonitorCheckOption {
  key: string;
  label: string;
  description: string | null;
  status: string;
  endpoint: string;
  method: string;
  properties: string[];
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
  /** When present, the wizard edits this assessment instead of creating a
   *  new one. Only used to identify which row and kick off the full-row GET
   *  (`editingFullRow`) — Step 1 is pre-filled from that fetch, not from this
   *  lighter tree-row shape. */
  editingAssessment?: AssessmentNode | null;
  onClose: () => void;
}

// Props-driven rather than reading useModal() directly: ModalContext.tsx
// imports this component, so importing useModal back from here would create
// a module cycle (the same reason that file's editorSurfaceTheme is defined
// locally instead of imported from a component).
export function AssessmentCreationWizard({ existingAssessments, editingAssessment, onClose }: AssessmentCreationWizardProps) {
  const { fetchWithAuth } = useAuth();
  const isEditing = editingAssessment != null;

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
  // The check selection as loaded from the currently-attached package —
  // diffed against selectedCheckKeys to detect an edit-mode checks change.
  const [originalCheckKeys, setOriginalCheckKeys] = useState<string[]>([]);

  // Inline "+ New check" section (Phase 8, Issue #55) — deliberately NOT the
  // existing MonitorCheckEditorModal/"new-monitor-check" ModalType: opening
  // that modal from inside this wizard would replace/close the wizard itself
  // via ModalContext's single-activeModal slot, silently discarding Steps 1-2
  // and any already-selected checks. This is a same-component expandable
  // section instead, calling the same POST /api/admin/monitor-checks route.
  const [inlineCreateOpen, setInlineCreateOpen] = useState(false);
  const [newCheckKey, setNewCheckKey] = useState("");
  const [newCheckLabel, setNewCheckLabel] = useState("");
  const [newCheckEndpoint, setNewCheckEndpoint] = useState("");
  const [newCheckMethod, setNewCheckMethod] = useState("GET");
  const [inlineCreateSubmitting, setInlineCreateSubmitting] = useState(false);
  const [inlineCreateError, setInlineCreateError] = useState<string | null>(null);

  // ── Edit mode only ──────────────────────────────────────────────────────
  // Full current row from GET /admin/services/:id — the round-trip base for
  // the PUT body (editPutBody below), never constructed from wizard form
  // state alone (PUT sets most columns unconditionally from the body).
  const [editingFullRow, setEditingFullRow] = useState<Record<string, unknown> | null>(null);
  const [loadingEditingRow, setLoadingEditingRow] = useState(false);
  // Explicit choice required before submitting a checks change on a package
  // shared with other assessments — null means "not yet chosen".
  const [sharedPackageAction, setSharedPackageAction] = useState<"shared" | "fork" | null>(null);

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

  // Edit mode: fetch the full current row (not the lighter AssessmentNode
  // summary) and pre-fill Step 1 + Step 2's package-mode choice from it.
  useEffect(() => {
    if (!editingAssessment) return;
    let cancelled = false;
    setLoadingEditingRow(true);
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/admin/services/${editingAssessment.id}`);
        if (!res.ok) {
          if (!cancelled) toast.error("Failed to load assessment details for editing");
          return;
        }
        const data = await res.json();
        if (cancelled) return;

        setEditingFullRow(data);
        setName(data.name ?? "");
        setSlug(data.slug ?? "");
        setSlugEdited(true);
        setDescription(data.description ?? "");
        setTagline(data.tagline ?? "");
        setBestFor(data.bestFor ?? "");
        setIsFreeOffering(Boolean(data.isFreeOffering));
        setAllowFreeCheckout(Boolean(data.allowFreeCheckout));
        setAllowFreeCheckoutEdited(true);
        setBasePrice(data.basePrice != null ? String(data.basePrice) : "");
        setMaxPrice(data.maxPrice != null ? String(data.maxPrice) : "");
        setSortOrder(data.sortOrder ?? 0);
        setSortOrderEdited(true);

        const typeAttrs = (data.typeAttributes && typeof data.typeAttributes === "object") ? data.typeAttributes : {};
        const pk = typeof typeAttrs.packageKey === "string" ? (typeAttrs.packageKey as string) : null;
        if (pk) {
          setPackageMode("attach");
          setAttachPackageKey(pk);
        } else {
          // One of the fallback assessments being given its first dedicated
          // package — same "create new" default the plain create flow uses.
          setPackageMode("create");
        }
      } catch {
        if (!cancelled) toast.error("Network error loading assessment details");
      } finally {
        if (!cancelled) setLoadingEditingRow(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingAssessment?.id]);

  // Edit mode, "attach": pre-populate (and re-populate on attach-target
  // change) Step 3's selection from the currently-attached package's real
  // checks — this is what lets the operator edit a shared package's checks,
  // not just re-point the assessment at a different existing package.
  useEffect(() => {
    if (!isEditing || packageMode !== "attach" || !attachPackageKey) return;
    let cancelled = false;
    setLoadingChecks(true);
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/admin/monitoring-packages/${encodeURIComponent(attachPackageKey)}/checks`);
        if (res.ok) {
          const data = await res.json();
          const keys = ((data.checks ?? []) as { checkKey: string; sortOrder: number }[])
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((c) => c.checkKey);
          if (!cancelled) {
            setSelectedCheckKeys(keys);
            setOriginalCheckKeys(keys);
            setSharedPackageAction(null);
          }
        }
      } catch {
        // Selection just stays empty; submit-time validation still guards.
      } finally {
        if (!cancelled) setLoadingChecks(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEditing, packageMode, attachPackageKey, fetchWithAuth]);

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

  // Other assessments already backed by the currently-chosen attach target
  // (excluding this assessment itself, in edit mode) — drives both the
  // "editing this will affect every assessment using it" notice and the
  // edit-mode shared-package-checks-change warning below.
  const attachSharedWith = useMemo(() => {
    if (packageMode !== "attach" || !attachPackageKey) return [];
    return existingAssessments.filter(
      (a) => a.packageKey === attachPackageKey && a.id !== editingAssessment?.id,
    );
  }, [packageMode, attachPackageKey, existingAssessments, editingAssessment]);

  // Excludes the assessment being edited — its own unchanged slug must not
  // block Step 1 as a false "already taken" collision against itself.
  const slugTaken = useMemo(
    () =>
      slug.trim().length > 0 &&
      existingAssessments.some(
        (a) => (a.slug ?? "").toLowerCase() === slug.trim().toLowerCase() && a.id !== editingAssessment?.id,
      ),
    [existingAssessments, slug, editingAssessment],
  );

  const newPackageKeyTaken = useMemo(
    () => newPackageKey.trim().length > 0 && packages.some((p) => p.key === newPackageKey.trim()),
    [packages, newPackageKey],
  );

  const checksByDomain = useMemo(() => {
    const q = checkSearch.trim().toLowerCase();
    const filtered = q
      ? allChecks.filter((c) =>
          `${c.key} ${c.label} ${c.description ?? ""} ${c.endpoint ?? ""} ${(c.properties ?? []).join(" ")}`
            .toLowerCase()
            .includes(q),
        )
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

  // Opening the inline "+ New check" section pre-fills the endpoint field
  // from whatever the operator just searched for — almost certainly the
  // Graph endpoint they were looking for and didn't find in the catalog.
  const openInlineCreate = () => {
    setNewCheckEndpoint(checkSearch.trim());
    setInlineCreateError(null);
    setInlineCreateOpen(true);
  };

  const cancelInlineCreate = () => {
    setInlineCreateOpen(false);
    setInlineCreateError(null);
    setNewCheckKey("");
    setNewCheckLabel("");
    setNewCheckEndpoint("");
    setNewCheckMethod("GET");
  };

  // Same key format MonitorCheckEditorModal (ModalContext.tsx) already
  // enforces, so this can't produce a check the rest of the system's
  // key-parsing (domain-grouping split on ":") can't handle.
  async function submitInlineCreate() {
    const key = newCheckKey.trim();
    const label = newCheckLabel.trim();
    const endpoint = newCheckEndpoint.trim();

    if (!key) {
      setInlineCreateError("Key is required");
      return;
    }
    if (!/^[a-z0-9]+:[a-z0-9-]+$/.test(key)) {
      setInlineCreateError("Key must look like domain:check-name — the prefix is what groups it in the tree");
      return;
    }
    if (!label) {
      setInlineCreateError("Label is required");
      return;
    }
    if (!endpoint) {
      setInlineCreateError("Endpoint is required");
      return;
    }

    setInlineCreateSubmitting(true);
    setInlineCreateError(null);
    try {
      const res = await fetchWithAuth("/api/admin/monitor-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, label, endpoint, method: newCheckMethod }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInlineCreateError(data.error || "Failed to create monitor check");
        return;
      }
      const created = data.check as MonitorCheckOption;
      // Optimistic append into this component's own state — no need to wait
      // for/listen to the simulator-endpoints-updated event.
      setAllChecks((prev) => [...prev, created]);
      setSelectedCheckKeys((prev) => (prev.includes(created.key) ? prev : [...prev, created.key]));
      cancelInlineCreate();
    } catch (err: any) {
      setInlineCreateError(err?.message || "Network error creating monitor check");
    } finally {
      setInlineCreateSubmitting(false);
    }
  }

  // Step 3 exists when creating a new package, and (edit mode only) when
  // attached to an existing package — editing that package's checks is a
  // real Phase 6 capability, not just re-pointing at a different package.
  const showChecksStep = packageMode === "create" || (isEditing && packageMode === "attach");
  const visibleSteps = showChecksStep ? [1, 2, 3, 4] : [1, 2, 4];
  const stepPosition = visibleSteps.indexOf(step) + 1;

  // Has the operator actually changed the attached package's check
  // selection from what was loaded? Only meaningful in edit + attach mode —
  // this is what gates the shared-package warning ("Step 1 only" edits never
  // trigger it, the package itself is untouched).
  const checksChangedFromOriginal = useMemo(() => {
    if (!isEditing || packageMode !== "attach") return false;
    if (selectedCheckKeys.length !== originalCheckKeys.length) return true;
    return selectedCheckKeys.some((k, i) => k !== originalCheckKeys[i]);
  }, [isEditing, packageMode, selectedCheckKeys, originalCheckKeys]);

  // Blocking choice required: editing checks on a package used by other
  // assessments must not silently mutate it out from under them.
  const sharedPackageWarningApplies =
    isEditing && packageMode === "attach" && checksChangedFromOriginal && attachSharedWith.length > 0;

  // What Step 4's submit will actually do with the package/checks —
  // resolved once so both the review preview and handleSubmit agree.
  const checksAction = useMemo((): (
    | { kind: "create"; packageKey: string; packageLabel: string }
    | { kind: "fork"; packageKey: string; packageLabel: string }
    | { kind: "update-shared"; packageKey: string }
    | { kind: "none" }
  ) => {
    if (packageMode === "create") {
      return { kind: "create", packageKey: newPackageKey.trim(), packageLabel: newPackageName.trim() };
    }
    if (packageMode === "attach" && isEditing && checksChangedFromOriginal) {
      if (sharedPackageWarningApplies && sharedPackageAction === "fork") {
        return { kind: "fork", packageKey: newPackageKey.trim(), packageLabel: newPackageName.trim() };
      }
      return { kind: "update-shared", packageKey: attachPackageKey.trim() };
    }
    return { kind: "none" };
  }, [packageMode, isEditing, checksChangedFromOriginal, sharedPackageWarningApplies, sharedPackageAction, newPackageKey, newPackageName, attachPackageKey]);

  // Selecting "fork" seeds sensible defaults into the (otherwise unused, in
  // attach mode) create-package fields, rather than introducing a parallel
  // set of form fields just for the fork path.
  const selectSharedPackageAction = (action: "shared" | "fork") => {
    setSharedPackageAction(action);
    // newPackageKey may already carry the plain assess:<slug> auto-derivation
    // (harmless — a reasonable fork key too) even though nothing has used it
    // yet; newPackageName has no such auto-effect, so it reliably signals
    // "not seeded yet".
    if (action === "fork" && !newPackageName.trim()) {
      const currentLabel = packages.find((p) => p.key === attachPackageKey)?.label ?? attachPackageKey;
      setNewPackageName(`${currentLabel} (Fork for ${name.trim() || "this assessment"})`);
      setPackageKeyEdited(true);
      setNewPackageKey(`assess:${slug || "assessment"}-fork`);
    }
  };

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

  function validateSharedPackageChoice(): string | null {
    if (!sharedPackageWarningApplies) return null;
    if (!sharedPackageAction) return "Choose how to save your check changes to this shared package";
    if (sharedPackageAction === "fork") {
      if (!newPackageName.trim()) return "Fork package name is required";
      if (!/^assess:[a-z0-9-]+$/.test(newPackageKey.trim())) return 'Fork package key must look like "assess:<slug>"';
      if (newPackageKeyTaken) return `Package key "${newPackageKey.trim()}" already exists`;
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

  // The package the assessment will point at once submit completes — a fork
  // targets the new package, everything else keeps whatever was chosen in
  // Step 2.
  const resolvedPackageKey =
    checksAction.kind === "fork" ? checksAction.packageKey : packageMode === "attach" ? attachPackageKey.trim() : newPackageKey.trim();

  // Create-mode payload — unchanged shape from Phase 5.
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

  // Edit-mode PUT body: the full GET row, with only the fields this wizard
  // actually manages overridden on top — the round-trip rule PUT
  // /admin/services/:id requires (see header comment). Never built from
  // wizard form state alone.
  const editPutBody = useMemo(() => {
    if (!isEditing || !editingFullRow) return null;
    const existingTypeAttributes =
      editingFullRow.typeAttributes && typeof editingFullRow.typeAttributes === "object" && !Array.isArray(editingFullRow.typeAttributes)
        ? (editingFullRow.typeAttributes as Record<string, unknown>)
        : {};
    return {
      ...editingFullRow,
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || null,
      tagline: tagline.trim() || null,
      bestFor: bestFor.trim() || null,
      isFreeOffering,
      allowFreeCheckout,
      basePrice: basePrice.trim() || null,
      maxPrice: maxPrice.trim() || null,
      sortOrder,
      typeAttributes: { ...existingTypeAttributes, packageKey: resolvedPackageKey },
    };
  }, [isEditing, editingFullRow, name, slug, description, tagline, bestFor, isFreeOffering, allowFreeCheckout, basePrice, maxPrice, sortOrder, resolvedPackageKey]);

  const handleSubmit = async () => {
    const err =
      (isEditing && !editPutBody ? "Assessment details are still loading — wait a moment and try again." : null) ??
      validateStep(1) ??
      validateStep(2) ??
      (showChecksStep ? validateStep(3) : null) ??
      validateSharedPackageChoice();
    if (err) {
      toast.error(err);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    let createdPackageKey: string | null = null;

    try {
      if (checksAction.kind === "create" || checksAction.kind === "fork") {
        const pkgRes = await fetchWithAuth("/api/admin/monitoring-packages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: checksAction.packageKey, label: checksAction.packageLabel }),
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
            body: JSON.stringify({ checkKeys: selectedCheckKeys }),
          },
        );
        const checksData = await checksRes.json();
        if (!checksRes.ok) {
          // Package exists but has no checks yet — surface the key rather
          // than silently discarding it (do not attempt the service save).
          setSubmitError({
            message: `Package "${createdPackageKey}" was created, but setting its checks failed: ${checksData.error || "unknown error"}. The package exists — attach checks to it manually via the Monitoring Packages admin, or retry.`,
            createdPackageKey,
          });
          setSubmitting(false);
          return;
        }
      } else if (checksAction.kind === "update-shared") {
        // Operator chose "save to shared package" — mutates the package all
        // of attachSharedWith also uses. Deliberate; the alternative is the
        // fork branch above.
        const checksRes = await fetchWithAuth(
          `/api/admin/monitoring-packages/${encodeURIComponent(attachPackageKey.trim())}/checks`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ checkKeys: selectedCheckKeys }),
          },
        );
        const checksData = await checksRes.json();
        if (!checksRes.ok) {
          setSubmitError({
            message: `Updating checks on "${attachPackageKey.trim()}" failed: ${checksData.error || "unknown error"}. This package is shared with ${attachSharedWith.length} other assessment(s) — the save was NOT applied. Retry, or choose the fork option instead.`,
            createdPackageKey: null,
          });
          setSubmitting(false);
          return;
        }
      }

      if (isEditing && editingAssessment) {
        const svcRes = await fetchWithAuth(`/api/admin/services/${editingAssessment.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editPutBody),
        });
        const svcData = await svcRes.json();
        if (!svcRes.ok) {
          setSubmitError({
            message: createdPackageKey
              ? `The monitoring package "${createdPackageKey}" was created (with its checks set), but saving the assessment failed: ${svcData.error || "unknown error"}. The package was NOT rolled back — retry, or clean it up manually via the Monitoring Packages admin.`
              : svcData.error || "Failed to save assessment",
            createdPackageKey,
          });
          setSubmitting(false);
          return;
        }
        toast.success(`Assessment "${svcData.name}" updated`);
        window.dispatchEvent(new CustomEvent("simulator-assessments-updated"));
        onClose();
        return;
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
      setSubmitError({ message: err.message || "Network error saving assessment", createdPackageKey });
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
            <DialogTitle className="text-lg font-semibold text-foreground">
              {isEditing ? `Edit Assessment${editingAssessment ? ` — ${editingAssessment.name}` : ""}` : "New Assessment"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Step {stepPosition} of {visibleSteps.length} — {STEP_LABELS[step]}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      {isEditing && loadingEditingRow && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading current assessment data…
        </div>
      )}

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

        {/* ── Step 3: Check selection (new package, or edit-mode attach) ──── */}
        {step === 3 && showChecksStep && (
          <div className="space-y-2">
          {isEditing && packageMode === "attach" && (
            <div className="text-[10px] text-muted-foreground">
              Editing checks for <span className="font-mono">{attachPackageKey}</span>
              {attachSharedWith.length > 0 &&
                ` — shared with ${attachSharedWith.length} other assessment${attachSharedWith.length === 1 ? "" : "s"}. Changing this selection will require a save-vs-fork choice on Review.`}
            </div>
          )}
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

          {/* ── Inline "+ New check" (Phase 8, Issue #55) — expandable
              section, never a Dialog, so Steps 1-2 and the current check
              selection are never at risk of being discarded. ── */}
          <div className="rounded-lg border border-border">
            <button
              type="button"
              onClick={() => (inlineCreateOpen ? cancelInlineCreate() : openInlineCreate())}
              className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
            >
              {inlineCreateOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              New check
            </button>
            {inlineCreateOpen && (
              <div className="space-y-2.5 border-t border-border p-2.5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-check-key" className="text-xs font-semibold text-muted-foreground">Key</Label>
                    <Input
                      id="new-check-key"
                      placeholder="identity:users-list"
                      value={newCheckKey}
                      onChange={(e) => setNewCheckKey(e.target.value)}
                      className="bg-background border-border text-foreground text-xs h-9 font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-check-label" className="text-xs font-semibold text-muted-foreground">Label</Label>
                    <Input
                      id="new-check-label"
                      placeholder="Users list"
                      value={newCheckLabel}
                      onChange={(e) => setNewCheckLabel(e.target.value)}
                      className="bg-background border-border text-foreground text-xs h-9"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-check-endpoint" className="text-xs font-semibold text-muted-foreground">Endpoint</Label>
                    <Input
                      id="new-check-endpoint"
                      placeholder="/users"
                      value={newCheckEndpoint}
                      onChange={(e) => setNewCheckEndpoint(e.target.value)}
                      className="bg-background border-border text-foreground text-xs h-9 font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-check-method" className="text-xs font-semibold text-muted-foreground">Method</Label>
                    <select
                      id="new-check-method"
                      value={newCheckMethod}
                      onChange={(e) => setNewCheckMethod(e.target.value)}
                      className="h-9 rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                    </select>
                  </div>
                </div>
                {inlineCreateError && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{inlineCreateError}</span>
                  </div>
                )}
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={cancelInlineCreate}
                    disabled={inlineCreateSubmitting}
                    className="bg-transparent border-border hover:bg-accent hover:text-foreground text-xs h-8"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={submitInlineCreate}
                    disabled={inlineCreateSubmitting}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs flex items-center gap-2 h-8 px-3"
                  >
                    {inlineCreateSubmitting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Adding…
                      </>
                    ) : (
                      "Add check"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
          </div>
        )}

        {/* ── Step 4: Review ───────────────────────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-3">
            {sharedPackageWarningApplies && (
              <div className="space-y-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3">
                <div className="flex items-start gap-2 text-[11px] text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    <span className="font-mono">{attachPackageKey}</span> also backs{" "}
                    {attachSharedWith.length === 1 ? "another assessment" : `${attachSharedWith.length} other assessments`}
                    {" "}({attachSharedWith.map((a) => a.name).join(", ")}). Choose how to save your check changes:
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSharedPackageAction("shared")}
                    className={`rounded-lg border p-2 text-left ${
                      sharedPackageAction === "shared" ? "border-primary bg-primary/5" : "border-border bg-card/50"
                    }`}
                  >
                    <div className="text-[11px] font-semibold text-foreground">
                      Save changes to the shared package (affects {attachSharedWith.length} other assessment{attachSharedWith.length === 1 ? "" : "s"})
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => selectSharedPackageAction("fork")}
                    className={`rounded-lg border p-2 text-left ${
                      sharedPackageAction === "fork" ? "border-primary bg-primary/5" : "border-border bg-card/50"
                    }`}
                  >
                    <div className="text-[11px] font-semibold text-foreground">
                      Fork: create a new package with these changes, leave the shared one untouched
                    </div>
                  </button>
                </div>
                {sharedPackageAction === "fork" && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1.5">
                      <Label htmlFor="fork-package-name" className="text-xs font-semibold text-muted-foreground">Fork package name</Label>
                      <Input
                        id="fork-package-name"
                        value={newPackageName}
                        onChange={(e) => setNewPackageName(e.target.value)}
                        className="bg-background border-border text-foreground text-xs h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="fork-package-key" className="text-xs font-semibold text-muted-foreground">Fork package key</Label>
                      <Input
                        id="fork-package-key"
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
                )}
              </div>
            )}

            {(checksAction.kind === "create" || checksAction.kind === "fork") && (
              <>
                <div>
                  <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    POST /api/admin/monitoring-packages
                  </h4>
                  <pre className="max-h-32 overflow-y-auto rounded-lg border border-border bg-card p-2.5 font-mono text-[11px] text-emerald-400">
                    {JSON.stringify({ key: checksAction.packageKey, label: checksAction.packageLabel }, null, 2)}
                  </pre>
                </div>
                <div>
                  <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    PUT /api/admin/monitoring-packages/{checksAction.packageKey}/checks
                  </h4>
                  <pre className="max-h-32 overflow-y-auto rounded-lg border border-border bg-card p-2.5 font-mono text-[11px] text-emerald-400">
                    {JSON.stringify({ checkKeys: selectedCheckKeys }, null, 2)}
                  </pre>
                </div>
              </>
            )}

            {checksAction.kind === "update-shared" && (
              <div>
                <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  PUT /api/admin/monitoring-packages/{attachPackageKey.trim()}/checks
                </h4>
                <pre className="max-h-32 overflow-y-auto rounded-lg border border-border bg-card p-2.5 font-mono text-[11px] text-emerald-400">
                  {JSON.stringify({ checkKeys: selectedCheckKeys }, null, 2)}
                </pre>
              </div>
            )}

            <div>
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {isEditing ? `PUT /api/admin/services/${editingAssessment?.id}` : "POST /api/admin/services"}
              </h4>
              <pre className="max-h-48 overflow-y-auto rounded-lg border border-border bg-card p-2.5 font-mono text-[11px] text-emerald-400">
                {JSON.stringify(isEditing ? editPutBody : servicePayload, null, 2)}
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
            disabled={submitting || (isEditing && loadingEditingRow)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs flex items-center gap-2 px-4"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {isEditing ? "Saving…" : "Creating…"}
              </>
            ) : isEditing ? (
              "Save Changes"
            ) : (
              "Create Assessment"
            )}
          </Button>
        ) : (
          <Button
            onClick={goNext}
            disabled={isEditing && loadingEditingRow}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs flex items-center gap-2 px-4"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
