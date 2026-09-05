import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useModal } from "@/contexts/ModalContext";
import { useTestbedContext } from "@/contexts/TestbedContext";
import {
  ChevronRight,
  ChevronDown,
  CreditCard,
  Shield,
  Clock,
  RefreshCw,
  Database,
  Plus,
  Folder,
  FolderOpen,
  FileCode,
  Edit2,
  Sparkles,
  Play,
  Trash2,
  AlertTriangle,
  ListChecks,
  Loader2,
  Cpu,
  Zap,
  FileDiff,
  Globe,
  Archive,
  LayoutGrid,
  Package,
  Search,
  X,
  FileText,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { readTreeState, writeTreeState, DEFAULT_EXPANDED_CATS } from "./simulatorTreeState";
import { ActiveDirectoryTree } from "./ActiveDirectoryTree";

interface EventDef {
  id: string;
  name: string;
  icon: string;
  category: "billing" | "security" | "sow" | "sla" | "crm";
  description: string;
  demoSpeakerNote?: string;
}

interface SavedScript {
  id: number;
  name: string;
  category: string;
  query: string;
  isDestructive: boolean;
  isResetScript: boolean;
}

// One row from GET /api/simulator/migrations/files — ranAt is the last time the
// file's own trailing self-mark INSERT recorded a run in simulator_migration_runs
// (#497), or null if it has never been run against the live DB.
interface MigrationFileEntry {
  filename: string;
  ranAt: string | null;
}

function normalizeMigrationFiles(raw: unknown): MigrationFileEntry[] {
  return (Array.isArray(raw) ? raw : []).map((f: any) =>
    typeof f === "string" ? { filename: f, ranAt: null } : { filename: f.filename, ranAt: f.ranAt ?? null }
  );
}

// Exact step shapes stored by /api/admin/test-suites — the tree only needs the
// step count, but the full union keeps the edit-test-suite modalData typed.
type TestSuiteStep =
  | { type: "sql"; scriptId: number }
  | { type: "scenario"; eventId: string }
  | { type: "exception_trigger"; marker?: string }
  | { type: "orchestrated_pipeline"; testbedCustomerId?: number; engineKeys?: string[] }
  | { type: "migration_file"; filename: string };

interface TestSuite {
  id: number;
  name: string;
  steps: TestSuiteStep[];
  createdAt: string;
  updatedAt: string;
}

interface EngineDefSummary {
  key: string;
  label: string;
  description: string;
  categoryPrefix: string;
  tenantScoped: boolean;
}

// Canonical event-bus event types from GET /api/admin/events/types,
// grouped by dot-prefix (e.g. "auth", "customer", "dlq").
interface BusEventType {
  eventType: string;
  group: string;
}

// Real monitor_checks rows from GET /api/admin/monitor-checks. There is no
// `category` column on monitor_checks — the real taxonomy is the domain prefix
// of the check's own `key` ("identity:mfa-registration" → "identity"), which is
// how every seeded check is named. Grouping is derived from that, not invented.
interface MonitorCheckNode {
  key: string;
  label: string;
  description: string | null;
  endpoint: string;
  method: string;
  selectParams: string | null;
  filterParams?: string | null;
  requestBody: Record<string, unknown> | null;
  properties: string[];
  mapping: Array<{ sourceField: string; targetField: string; transform?: string }>;
  requiresCustomerScript: boolean;
  status: string;
}

// Real baseline_action_templates rows (the executable write-action universe)
// from GET /api/admin/write-actions, each with its LEFT-JOINed
// write_action_catalog safety metadata (or null when the catalog link is not
// yet established). Grouped by the template's own `category` column.
export interface WriteActionNode {
  templateId: string;
  label: string;
  description: string | null;
  category: string;
  endpoint: string;
  method: string;
  requiredVariables: string[];
  dependsOn: string[];
  requiresVerificationGate: boolean;
  reversible: boolean;
  reverseTemplateId: string | null;
  reverseTemplateLabel: string | null;
  status: string;
  catalogLinked: boolean;
  catalog: {
    domain: string;
    surface: string;
    requiredPermission: string | null;
    safeOrGated: "safe" | "gated" | null;
    minBundledTier: string | null;
    snapshotNotes: string | null;
    status: string | null;
    blockedReason: string | null;
  } | null;
}

// Real config_packs rows (ordered baseline_action_templates sequences) from
// GET /api/admin/config-packs. Each opens in the center as a runnable pack:
// whole-pack (dependency-ordered) or one step at a time — all testbed-only.
export interface ConfigPackNode {
  packKey: string;
  label: string;
  description: string | null;
  status: string;
  categories: string[];
}

// Real `services` rows (category='assessment') from
// GET /api/admin/simulator/assessments, with the resolved packageKey (the
// SAME `type_attributes->>'packageKey'` path consent.ts uses at scan time)
// and — when a dedicated package exists — its ordered check_key list.
export interface AssessmentNode {
  id: number;
  name: string;
  slug: string | null;
  isFreeOffering: boolean;
  sortOrder: number;
  /** Real services.visibility. "private" is Phase 7's Deprecate action
   *  (PUT /admin/services/:id, visibility: "private") — unpublished but the
   *  row (and any grandfathered client access) stays intact. */
  visibility: "public" | "private" | "landing_page_only";
  packageKey: string | null;
  hasDedicatedPackage: boolean;
  checkKeys: string[] | null;
  checkCount: number | null;
}

// Real `document_types` rows from GET /api/admin/document-types — the same
// registry DocumentGeneratorIde.tsx / DocumentTypesManager.tsx already read.
// Grouped by the real `category` column ("report"/"consulting"), mirroring
// how Section 11 groups Assessments Free/Paid on `is_free_offering`.
export interface DocumentTypeNode {
  id: number;
  key: string;
  label: string;
  category: "report" | "consulting";
  sectionHints: string | null;
  sections: { id: string; heading: string; guidance: string }[];
  requiresSowHtml: boolean;
  serviceId: number | null;
  includedProfileKeyPatterns: string[];
  includedSignalCategories: string[];
  pipelineCategory: "standalone" | "pipeline_output";
  sortOrder: number;
  isActive: boolean;
  aiPromptId: number | null;
}

// ~5 minutes of polling at 1500ms per tick.
const SUITE_POLL_INTERVAL_MS = 1500;
const SUITE_POLL_MAX_TICKS = 200;

// The seven real radar pillars, mirroring PILLAR_LABELS in api-server
// lib/pillar-coverage.ts (same order the spec lists them). Each opens the
// cross-signal Pillar Matrix pre-selected to that pillar.
const PILLAR_MATRIX_PILLARS: Array<{ key: string; label: string }> = [
  { key: "governance", label: "Governance" },
  { key: "security", label: "Security" },
  { key: "compliance", label: "Compliance" },
  { key: "adoption", label: "Adoption" },
  { key: "copilot", label: "Copilot Readiness" },
  { key: "architecture", label: "Architecture" },
  { key: "licensing", label: "Licensing" },
];

function itemMatchesSearch(query: string, fields: (string | null | undefined | string[] | number | boolean | Record<string, unknown>)[]): boolean {
  if (!query) return true;
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  
  const combined = fields
    .map((f) => {
      if (f == null) return "";
      if (Array.isArray(f)) return f.join(" ");
      if (typeof f === "object") return JSON.stringify(f);
      return String(f);
    })
    .join(" ")
    .toLowerCase();
    
  return terms.every((term) => combined.includes(term));
}

export function SimulatorLeftTree() {
  const { fetchWithAuth } = useAuth();
  const { openModal } = useModal();
  const { selectedCustomerId } = useTestbedContext();
  const [, navigate] = useLocation();

  const [scenarios, setScenarios] = useState<EventDef[]>([]);
  const [scripts, setScripts] = useState<SavedScript[]>([]);
  const [migrationFiles, setMigrationFiles] = useState<MigrationFileEntry[]>([]);
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [engines, setEngines] = useState<EngineDefSummary[]>([]);
  const [busEventTypes, setBusEventTypes] = useState<BusEventType[]>([]);
  const [monitorChecks, setMonitorChecks] = useState<MonitorCheckNode[]>([]);
  const [writeActions, setWriteActions] = useState<WriteActionNode[]>([]);
  const [configPacks, setConfigPacks] = useState<ConfigPackNode[]>([]);
  const [assessments, setAssessments] = useState<AssessmentNode[]>([]);
  const [documentTypes, setDocumentTypes] = useState<DocumentTypeNode[]>([]);
  const [loading, setLoading] = useState(false);

  // The domain whose bulk run is being started — one at a time, so a stray
  // double-click can't queue two full-domain sweeps against the same tenant.
  const [bulkRunningDomain, setBulkRunningDomain] = useState<string | null>(null);

  const [triggeringException, setTriggeringException] = useState(false);
  // Suites with an in-flight run — spinner on the row, re-run blocked.
  const [runningSuites, setRunningSuites] = useState<Record<number, boolean>>({});
  // Engines with an in-flight run — spinner on the row, re-run blocked.
  const [runningEngines, setRunningEngines] = useState<Record<string, boolean>>({});
  const pollTimersRef = useRef<number[]>([]);

  // Tree toggle states — seeded from the persisted state, if any, so a reload
  // doesn't reset every node back to its hardcoded default.
  const initialTreeState = useRef(readTreeState()).current;
  const [scenariosOpen, setScenariosOpen] = useState(initialTreeState?.sections.scenarios ?? true);
  const [scriptsOpen, setScriptsOpen] = useState(initialTreeState?.sections.scripts ?? true);
  const [activeDirectoryOpen, setActiveDirectoryOpen] = useState(
    initialTreeState?.sections.activeDirectory ?? true,
  );
  const [migrationsOpen, setMigrationsOpen] = useState(initialTreeState?.sections.migrations ?? true);
  const [exceptionsOpen, setExceptionsOpen] = useState(initialTreeState?.sections.exceptions ?? true);
  const [suitesOpen, setSuitesOpen] = useState(initialTreeState?.sections.suites ?? true);
  const [enginesOpen, setEnginesOpen] = useState(initialTreeState?.sections.engines ?? true);
  const [busEventsOpen, setBusEventsOpen] = useState(initialTreeState?.sections.busEvents ?? true);
  const [endpointsOpen, setEndpointsOpen] = useState(initialTreeState?.sections.endpoints ?? true);
  const [writeActionsOpen, setWriteActionsOpen] = useState(initialTreeState?.sections.writeActions ?? true);
  const [pillarMatrixOpen, setPillarMatrixOpen] = useState(initialTreeState?.sections.pillarMatrix ?? true);
  const [configPacksOpen, setConfigPacksOpen] = useState(initialTreeState?.sections.configPacks ?? true);
  const [assessmentsOpen, setAssessmentsOpen] = useState(initialTreeState?.sections.assessments ?? true);
  const [documentsOpen, setDocumentsOpen] = useState(initialTreeState?.sections.documents ?? true);
  // Which endpoint the center canvas is showing — highlighted in the tree.
  const [selectedEndpointKey, setSelectedEndpointKey] = useState<string | null>(null);
  // Which write-action template the center canvas is showing — highlighted in the tree.
  const [selectedWriteActionId, setSelectedWriteActionId] = useState<string | null>(null);
  // Which pillar the Pillar Matrix tab is showing — highlighted in the tree.
  const [selectedPillarKey, setSelectedPillarKey] = useState<string | null>(null);
  // Which config pack the center canvas is showing — highlighted in the tree.
  const [selectedConfigPackKey, setSelectedConfigPackKey] = useState<string | null>(null);
  // Which assessment the center canvas is showing — highlighted in the tree.
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<number | null>(null);
  // Which document type the center canvas is showing — highlighted in the tree.
  const [selectedDocumentKey, setSelectedDocumentKey] = useState<string | null>(null);

  // Categorized expansion states
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>(
    initialTreeState?.cats ?? DEFAULT_EXPANDED_CATS,
  );

  const toggleCat = (catName: string) => {
    setExpandedCats((prev) => ({ ...prev, [catName]: !prev[catName] }));
  };

  // Persist whenever any node's open/closed state changes. One combined write
  // (not one key per node) keeps this to a single localStorage round-trip.
  useEffect(() => {
    writeTreeState({
      sections: {
        scenarios: scenariosOpen,
        scripts: scriptsOpen,
        activeDirectory: activeDirectoryOpen,
        migrations: migrationsOpen,
        exceptions: exceptionsOpen,
        suites: suitesOpen,
        engines: enginesOpen,
        busEvents: busEventsOpen,
        endpoints: endpointsOpen,
        writeActions: writeActionsOpen,
        pillarMatrix: pillarMatrixOpen,
        configPacks: configPacksOpen,
        assessments: assessmentsOpen,
        documents: documentsOpen,
      },
      cats: expandedCats,
    });
  }, [
    scenariosOpen,
    scriptsOpen,
    activeDirectoryOpen,
    migrationsOpen,
    exceptionsOpen,
    suitesOpen,
    enginesOpen,
    busEventsOpen,
    endpointsOpen,
    writeActionsOpen,
    pillarMatrixOpen,
    configPacksOpen,
    assessmentsOpen,
    documentsOpen,
    expandedCats,
  ]);

  const [searchQuery, setSearchQuery] = useState("");
  const isSearching = searchQuery.trim().length > 0;

  const filteredScenarios = useMemo(() => {
    if (!isSearching) return scenarios;
    return scenarios.filter((event) =>
      itemMatchesSearch(searchQuery, [event.name, event.description, event.category, event.demoSpeakerNote, event.id])
    );
  }, [scenarios, searchQuery, isSearching]);

  const filteredScripts = useMemo(() => {
    if (!isSearching) return scripts;
    return scripts.filter((script) =>
      itemMatchesSearch(searchQuery, [script.name, script.category, script.query])
    );
  }, [scripts, searchQuery, isSearching]);

  const filteredMigrationFiles = useMemo(() => {
    if (!isSearching) return migrationFiles.filter((file) => file.ranAt == null);
    return migrationFiles.filter((file) =>
      itemMatchesSearch(searchQuery, [file.filename])
    );
  }, [migrationFiles, searchQuery, isSearching]);

  const unrunMigrationCount = useMemo(
    () => migrationFiles.filter((file) => file.ranAt == null).length,
    [migrationFiles]
  );

  const exceptionMatches = useMemo(() => {
    if (!isSearching) return true;
    return itemMatchesSearch(searchQuery, [
      "Trigger Synthetic Exception",
      "synthetic",
      "exception",
      "alert",
      "error",
      "testing",
    ]);
  }, [searchQuery, isSearching]);

  const filteredSuites = useMemo(() => {
    if (!isSearching) return suites;
    return suites.filter((suite) =>
      itemMatchesSearch(searchQuery, [
        suite.name,
        ...suite.steps.map((s) => s.type),
      ])
    );
  }, [suites, searchQuery, isSearching]);

  const filteredEngines = useMemo(() => {
    if (!isSearching) return engines;
    return engines.filter((engine) =>
      itemMatchesSearch(searchQuery, [engine.key, engine.label, engine.description, engine.categoryPrefix])
    );
  }, [engines, searchQuery, isSearching]);

  const filteredBusEventTypes = useMemo(() => {
    if (!isSearching) return busEventTypes;
    return busEventTypes.filter((t) =>
      itemMatchesSearch(searchQuery, [t.eventType, t.group])
    );
  }, [busEventTypes, searchQuery, isSearching]);

  const filteredMonitorChecks = useMemo(() => {
    if (!isSearching) return monitorChecks;
    return monitorChecks.filter((check) =>
      itemMatchesSearch(searchQuery, [
        check.key,
        check.label,
        check.description,
        check.endpoint,
        check.method,
        check.selectParams,
        check.filterParams,
        ...(check.properties || []),
        check.status,
      ])
    );
  }, [monitorChecks, searchQuery, isSearching]);

  const filteredWriteActions = useMemo(() => {
    if (!isSearching) return writeActions;
    return writeActions.filter((wa) =>
      itemMatchesSearch(searchQuery, [
        wa.templateId,
        wa.label,
        wa.description,
        wa.category,
        wa.endpoint,
        wa.method,
        ...(wa.requiredVariables || []),
        ...(wa.dependsOn || []),
        wa.status,
        wa.catalog?.domain,
        wa.catalog?.surface,
        wa.catalog?.requiredPermission,
      ])
    );
  }, [writeActions, searchQuery, isSearching]);

  const filteredPillars = useMemo(() => {
    if (!isSearching) return PILLAR_MATRIX_PILLARS;
    return PILLAR_MATRIX_PILLARS.filter((p) =>
      itemMatchesSearch(searchQuery, [p.key, p.label, "pillar", "matrix"])
    );
  }, [searchQuery, isSearching]);

  const filteredConfigPacks = useMemo(() => {
    if (!isSearching) return configPacks;
    return configPacks.filter((pack) =>
      itemMatchesSearch(searchQuery, [
        pack.packKey,
        pack.label,
        pack.description,
        ...(pack.categories || []),
        pack.status,
      ])
    );
  }, [configPacks, searchQuery, isSearching]);

  const filteredAssessments = useMemo(() => {
    if (!isSearching) return assessments;
    return assessments.filter((a) =>
      itemMatchesSearch(searchQuery, [a.name, a.slug, a.packageKey, ...(a.checkKeys || [])])
    );
  }, [assessments, searchQuery, isSearching]);

  const filteredDocumentTypes = useMemo(() => {
    if (!isSearching) return documentTypes;
    return documentTypes.filter((d) =>
      itemMatchesSearch(searchQuery, [d.key, d.label, d.category, d.pipelineCategory])
    );
  }, [documentTypes, searchQuery, isSearching]);

  const showScenarios = !isSearching || filteredScenarios.length > 0;
  const showScripts = !isSearching || filteredScripts.length > 0;
  const showMigrations = !isSearching || filteredMigrationFiles.length > 0;
  const showExceptions = !isSearching || exceptionMatches;
  const showSuites = !isSearching || filteredSuites.length > 0;
  const showEngines = !isSearching || filteredEngines.length > 0;
  const showBusEvents = !isSearching || filteredBusEventTypes.length > 0;
  const showEndpoints = !isSearching || filteredMonitorChecks.length > 0;
  const showWriteActions = !isSearching || filteredWriteActions.length > 0;
  const showPillarMatrix = !isSearching || filteredPillars.length > 0;
  const showConfigPacks = !isSearching || filteredConfigPacks.length > 0;
  const showAssessments = !isSearching || filteredAssessments.length > 0;
  const showDocuments = !isSearching || filteredDocumentTypes.length > 0;

  // Group assessments Free/Paid, exactly the real `is_free_offering` column —
  // there is no other free/paid split on this row.
  const assessmentsByGroup = filteredAssessments.reduce(
    (acc, a) => {
      const group = a.isFreeOffering ? "Free" : "Paid";
      if (!acc[group]) acc[group] = [];
      acc[group].push(a);
      return acc;
    },
    {} as Record<"Free" | "Paid", AssessmentNode[]>,
  );

  // Group document types by the real `category` column ("report"/"consulting") —
  // the same split DocumentGeneratorIde.tsx/DocumentTypesManager.tsx already show.
  const documentsByCategory = filteredDocumentTypes.reduce(
    (acc, d) => {
      if (!acc[d.category]) acc[d.category] = [];
      acc[d.category].push(d);
      return acc;
    },
    {} as Record<"report" | "consulting", DocumentTypeNode[]>,
  );

  // Group event types by dot-prefix; keys are namespaced ("evt:auth") so event
  // groups never collide with scenario/script categories in expandedCats.
  const busEventsByGroup = filteredBusEventTypes.reduce(
    (acc, t) => {
      const group = t.group || "other";
      if (!acc[group]) acc[group] = [];
      acc[group].push(t);
      return acc;
    },
    {} as Record<string, BusEventType[]>,
  );

  // Group monitor checks by the domain prefix of their own key (the real
  // taxonomy — identity/security/governance/sharepoint/teams/exchange/devices/
  // copilot/cost/appgov/adoption/platform/m365 all come from the key itself,
  // there is no category column). Keys are namespaced ("ep:identity") so
  // endpoint groups never collide with scenario/script/event categories in
  // expandedCats — the same collision guard the event groups use.
  const checksByDomain = filteredMonitorChecks.reduce(
    (acc, check) => {
      const domain = check.key.includes(":") ? check.key.split(":")[0]! : "other";
      if (!acc[domain]) acc[domain] = [];
      acc[domain].push(check);
      return acc;
    },
    {} as Record<string, MonitorCheckNode[]>,
  );

  // Group write-action templates by their own `category` column (Users, Auth/MFA,
  // Licensing, Groups, Teams, SharePoint/OneDrive...). Keys are namespaced
  // ("wa:Users") so write-action groups never collide with endpoint/event/script
  // categories in expandedCats — the same collision guard the others use.
  const writeActionsByCategory = filteredWriteActions.reduce(
    (acc, wa) => {
      const cat = wa.category || "Other";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(wa);
      return acc;
    },
    {} as Record<string, WriteActionNode[]>,
  );

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch simulator manifest
      const manifestRes = await fetchWithAuth("/api/simulator/manifest");
      if (manifestRes.ok) {
        const manifestData = await manifestRes.json();
        setScenarios(manifestData.events || []);
      } else {
        // Fallback default manifest if server fails
        setScenarios([
          {
            id: "MSP_SUSPEND_7_DAYS",
            name: "Simulate Unpaid Bill (>7 Days)",
            icon: "CreditCard",
            category: "billing",
            description: "Fast-forwards the MSP's suspended_at date to trigger the red lock-out banner in the portal.",
          },
          {
            id: "INJECT_MFA_DRIFT",
            name: "Fire MFA Disabled Alert",
            icon: "ShieldAlert",
            category: "security",
            description: "Injects an active MFA_DISABLED signal directly into the tenant to trigger a score drop.",
          },
          {
            id: "SLA_BREACH_TICKETS",
            name: "Age Open Tickets (SLA Breach)",
            icon: "Clock",
            category: "sla",
            description: "Ages all open Kanban tasks for this MSP past 48 hours to trigger escalation rules.",
          },
          {
            id: "FACTORY_RESET",
            name: "Factory Reset Testbed",
            icon: "RefreshCcw",
            category: "crm",
            description: "Wipes all generated signals, clears suspensions, and restores baseline health scores.",
          },
        ]);
      }

      // 2. Fetch saved SQL scripts
      const scriptsRes = await fetchWithAuth("/api/simulator/sql/scripts");
      if (scriptsRes.ok) {
        const scriptsData = await scriptsRes.json();
        setScripts(scriptsData.scripts || []);
      }

      // 2b. Fetch manual migration files (lib/db/migrations/manual/, server filesystem)
      const migrationsRes = await fetchWithAuth("/api/simulator/migrations/files");
      if (migrationsRes.ok) {
        const migrationsData = await migrationsRes.json();
        setMigrationFiles(normalizeMigrationFiles(migrationsData.files));
      }

      // 3. Fetch test suites
      const suitesRes = await fetchWithAuth("/api/admin/test-suites");
      if (suitesRes.ok) {
        const suitesData = await suitesRes.json();
        setSuites(suitesData.suites || []);
      }

      // 4. Fetch engine registry
      const enginesRes = await fetchWithAuth("/api/admin/engines");
      if (enginesRes.ok) {
        const enginesData = await enginesRes.json();
        setEngines(enginesData.engines || []);
      }

      // 5. Fetch canonical event-bus event types
      const eventTypesRes = await fetchWithAuth("/api/admin/events/types");
      if (eventTypesRes.ok) {
        const eventTypesData = await eventTypesRes.json();
        setBusEventTypes(eventTypesData.types || []);
      }

      // 6. Fetch the real monitor_checks catalog (M365 Endpoints).
      const checksRes = await fetchWithAuth("/api/admin/monitor-checks");
      if (checksRes.ok) {
        const checksData = await checksRes.json();
        setMonitorChecks(checksData.checks || []);
      }

      // 7. Fetch the real baseline_action_templates catalog (Write Actions).
      const writeActionsRes = await fetchWithAuth("/api/admin/write-actions");
      if (writeActionsRes.ok) {
        const writeActionsData = await writeActionsRes.json();
        setWriteActions(writeActionsData.templates || []);
      }

      // 8. Fetch the real config_packs catalog (orchestrated write-action sequences).
      const configPacksRes = await fetchWithAuth("/api/admin/config-packs");
      if (configPacksRes.ok) {
        const configPacksData = await configPacksRes.json();
        setConfigPacks(configPacksData.packs || []);
      }

      // 9. Fetch the real assessment catalog (services, category='assessment')
      // + resolved packageKey audit.
      const assessmentsRes = await fetchWithAuth("/api/admin/simulator/assessments");
      if (assessmentsRes.ok) {
        const assessmentsData = await assessmentsRes.json();
        setAssessments(assessmentsData.assessments || []);
      }

      // 10. Fetch the real document_types registry (Document Generator).
      const documentTypesRes = await fetchWithAuth("/api/admin/document-types");
      if (documentTypesRes.ok) {
        const documentTypesData = await documentTypesRes.json();
        setDocumentTypes(Array.isArray(documentTypesData) ? documentTypesData : []);
      }
    } catch (err) {
      console.error("Error loading simulator tree data:", err);
      toast.error("Failed to load some simulator workspace items");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Listen for scripts-updated / suites-updated events to reload lists
    const handleScriptsUpdate = () => {
      loadData();
    };
    const handleSuitesUpdate = () => {
      loadData();
    };
    // Save/retire/reactivate in the endpoint canvas re-reads the catalog so the
    // tree's status badges stay truthful.
    const handleEndpointsUpdate = () => {
      loadData();
    };
    // AssessmentCreationWizard fires this on a successful create so the new
    // assessment appears in the tree without a manual reload (Phase 5, #28).
    const handleAssessmentsUpdate = () => {
      loadData();
    };
    // The document canvas's Save button fires this so the tree's warning-triangle
    // state and label/category reflect the saved row without a manual reload.
    const handleDocumentsUpdate = () => {
      loadData();
    };
    window.addEventListener("simulator-scripts-updated", handleScriptsUpdate);
    window.addEventListener("simulator-suites-updated", handleSuitesUpdate);
    window.addEventListener("simulator-endpoints-updated", handleEndpointsUpdate);
    window.addEventListener("simulator-assessments-updated", handleAssessmentsUpdate);
    window.addEventListener("simulator-documents-updated", handleDocumentsUpdate);
    return () => {
      window.removeEventListener("simulator-scripts-updated", handleScriptsUpdate);
      window.removeEventListener("simulator-suites-updated", handleSuitesUpdate);
      window.removeEventListener("simulator-endpoints-updated", handleEndpointsUpdate);
      window.removeEventListener("simulator-assessments-updated", handleAssessmentsUpdate);
      window.removeEventListener("simulator-documents-updated", handleDocumentsUpdate);
    };
  }, [fetchWithAuth]);

  // Stop any in-flight suite-run polling on unmount.
  useEffect(() => {
    return () => {
      pollTimersRef.current.forEach((timer) => window.clearInterval(timer));
      pollTimersRef.current = [];
    };
  }, []);

  // #497: refresh the run-tracking checkboxes after a migration execute. The
  // tree only observes the run *starting* (SqlQueryCanvas owns the execute
  // round-trip and emits no completion event), so poll the files endpoint
  // briefly after each simulator-run-migration until the file's ranAt is set —
  // the run itself writes the tracking row via the migration's own trailing
  // self-mark INSERT, so a set ranAt means the run round-tripped.
  useEffect(() => {
    const timers = new Set<number>();
    const handleRunMigration = (e: Event) => {
      const filename = (e as CustomEvent).detail?.filename as string | undefined;
      let attempts = 0;
      const timer = window.setInterval(async () => {
        attempts += 1;
        const done = attempts >= 15; // ~30s cap; a failed run never sets ranAt
        try {
          const res = await fetchWithAuth("/api/simulator/migrations/files");
          if (res.ok) {
            const data = await res.json();
            const files = normalizeMigrationFiles(data.files);
            setMigrationFiles(files);
            const entry = filename ? files.find((f) => f.filename === filename) : undefined;
            if (entry?.ranAt || done) {
              window.clearInterval(timer);
              timers.delete(timer);
            }
          } else if (done) {
            window.clearInterval(timer);
            timers.delete(timer);
          }
        } catch {
          if (done) {
            window.clearInterval(timer);
            timers.delete(timer);
          }
        }
      }, 2000);
      timers.add(timer);
    };
    window.addEventListener("simulator-run-migration", handleRunMigration);
    return () => {
      window.removeEventListener("simulator-run-migration", handleRunMigration);
      timers.forEach((timer) => window.clearInterval(timer));
    };
  }, [fetchWithAuth]);

  // Group events by category
  const scenariosByCategory = filteredScenarios.reduce(
    (acc, event) => {
      const cat = event.category || "crm";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(event);
      return acc;
    },
    {} as Record<string, EventDef[]>,
  );

  // Group scripts by category
  const scriptsByCategory = filteredScripts.reduce(
    (acc, script) => {
      const cat = script.category || "Uncategorized";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(script);
      return acc;
    },
    {} as Record<string, SavedScript[]>,
  );

  const getCategoryIcon = (cat: string) => {
    switch (cat.toLowerCase()) {
      case "billing":
        return <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />;
      case "security":
        return <Shield className="h-3.5 w-3.5 text-muted-foreground" />;
      case "sla":
        return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
      default:
        return <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const handleScriptClick = (script: SavedScript) => {
    // Fire event to load script query in Editor canvas
    window.dispatchEvent(new CustomEvent("simulator-load-script", { detail: script }));
  };

  const handleScriptRun = (script: SavedScript) => {
    window.dispatchEvent(new CustomEvent("simulator-run-script", { detail: script }));
  };

  const handleScriptDelete = async (script: SavedScript) => {
    if (!confirm(`Delete saved script "${script.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetchWithAuth(`/api/simulator/sql/scripts/${script.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Script deleted");
        window.dispatchEvent(new CustomEvent("simulator-scripts-updated"));
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to delete script");
      }
    } catch (err: any) {
      toast.error(err.message || "Network error deleting script");
    }
  };

  const handleTriggerException = async () => {
    if (triggeringException) return;
    setTriggeringException(true);
    try {
      const res = await fetchWithAuth("/api/admin/exceptions/_test/trigger?marker=simulator-tree", {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
      } else {
        toast.error(data.error || "Failed to trigger synthetic exception");
      }
    } catch (err: any) {
      toast.error(err.message || "Network error triggering synthetic exception");
    } finally {
      setTriggeringException(false);
    }
  };

  const stopSuitePoll = (timer: number, suiteId: number) => {
    window.clearInterval(timer);
    pollTimersRef.current = pollTimersRef.current.filter((t) => t !== timer);
    setRunningSuites((prev) => ({ ...prev, [suiteId]: false }));
  };

  const handleSuiteRun = async (suite: TestSuite) => {
    if (runningSuites[suite.id]) return;
    if (selectedCustomerId == null) {
      toast.error("Select a testbed customer in the header first");
      return;
    }
    setRunningSuites((prev) => ({ ...prev, [suite.id]: true }));
    try {
      const res = await fetchWithAuth(`/api/admin/test-suites/${suite.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testbedCustomerId: selectedCustomerId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRunningSuites((prev) => ({ ...prev, [suite.id]: false }));
        toast.error(data.error || "Failed to start suite run");
        return;
      }
      const runId: number = data.runId;
      toast.success(`Suite run #${runId} started — output streams to the Log Stream`);

      // Async interval callbacks can overlap when a poll runs longer than the
      // interval: `inFlight` skips a tick while the previous fetch is pending,
      // and `done` guarantees exactly one tick finalizes (stop + toast).
      let ticks = 0;
      let inFlight = false;
      let done = false;
      const finalize = (notify: () => void) => {
        if (done) return;
        done = true;
        stopSuitePoll(timer, suite.id);
        notify();
      };
      const timer = window.setInterval(async () => {
        if (done) return;
        // Every tick counts toward the cap — including skipped ones — so a
        // hung request can't stretch the 5-minute budget.
        ticks += 1;
        if (!inFlight) {
          inFlight = true;
          try {
            const pollRes = await fetchWithAuth(`/api/admin/test-suites/runs/${runId}`);
            if (!done && pollRes.ok) {
              const pollData = await pollRes.json();
              const run = pollData.run;
              if (run && run.status !== "running") {
                finalize(() => {
                  if (run.status === "completed") {
                    toast.success(`Suite run #${runId} completed`);
                  } else {
                    const stepResults: Array<{ status: string }> = run.stepResults ?? [];
                    const failed = stepResults.filter((s) => s.status === "failed").length;
                    toast.error(`Suite run #${runId} failed — ${failed} of ${stepResults.length} steps failed`);
                  }
                });
                return;
              }
            }
          } catch {
            // Transient poll error — keep polling until the tick budget runs out.
          } finally {
            inFlight = false;
          }
        }
        if (ticks >= SUITE_POLL_MAX_TICKS) {
          finalize(() => toast.error(`Suite run #${runId} is still running after 5 minutes — stopped polling`));
        }
      }, SUITE_POLL_INTERVAL_MS);
      pollTimersRef.current.push(timer);
    } catch (err: any) {
      setRunningSuites((prev) => ({ ...prev, [suite.id]: false }));
      toast.error(err.message || "Network error starting suite run");
    }
  };

  const handleEngineRun = async (engine: EngineDefSummary) => {
    if (runningEngines[engine.key]) return;
    if (selectedCustomerId == null) {
      toast.error("Select a testbed customer in the header first");
      return;
    }
    setRunningEngines((prev) => ({ ...prev, [engine.key]: true }));
    try {
      const res = await fetchWithAuth(`/api/admin/engines/${engine.key}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: selectedCustomerId, debug: true }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`${engine.key} ran against real tenant data`);
      } else {
        toast.error(data.error || "Engine run failed");
      }
    } catch (err: any) {
      toast.error(err.message || "Network error running engine");
    } finally {
      setRunningEngines((prev) => ({ ...prev, [engine.key]: false }));
    }
  };

  // Selecting an endpoint opens it in the center canvas (same event-driven
  // hand-off the saved-script rows use to load into the SQL canvas).
  const handleEndpointSelect = (check: MonitorCheckNode) => {
    setSelectedEndpointKey(check.key);
    window.dispatchEvent(new CustomEvent("simulator-select-endpoint", { detail: check }));
  };

  // Selecting a write-action opens it in the center canvas (the tenant-MUTATING
  // sibling of handleEndpointSelect — separate event so the center routes it to
  // the write-action canvas with its confirmation flow, never the read canvas).
  const handleWriteActionSelect = (wa: WriteActionNode) => {
    setSelectedWriteActionId(wa.templateId);
    window.dispatchEvent(new CustomEvent("simulator-select-write-action", { detail: wa }));
  };

  // Selecting a pillar opens the cross-signal Pillar Matrix in the center canvas
  // (same event-driven hand-off pattern as endpoints/write-actions; the detail
  // carries which pillar to pre-select).
  const handlePillarSelect = (pillar: string) => {
    setSelectedPillarKey(pillar);
    window.dispatchEvent(new CustomEvent("simulator-select-pillar-matrix", { detail: { pillar } }));
  };

  // Selecting a config pack opens it in the center canvas — the orchestrated
  // sibling of Write Actions (whole-pack, dependency-ordered, or one step at a
  // time). Same event-driven hand-off pattern as endpoints/write-actions.
  const handleConfigPackSelect = (pack: ConfigPackNode) => {
    setSelectedConfigPackKey(pack.packKey);
    window.dispatchEvent(new CustomEvent("simulator-select-config-pack", { detail: pack }));
  };

  // Create/modify packs + steps reuses the real, tested CRUD editor in Baseline
  // Templates (drag-reorder, per-pack dependsOn overrides, create/edit dialog) —
  // deep-linked rather than duplicated here. The Simulator's own value-add is
  // running a pack, not re-implementing its editor.
  const openConfigPackManager = () => navigate("/delivery/baseline-templates?tab=config-packs");

  // Selecting an assessment opens its read-only catalog + packageKey audit view
  // in the center canvas — same event-driven hand-off pattern as endpoints/
  // write-actions/config-packs. Read-only in this phase: no run/create/edit.
  const handleAssessmentSelect = (assessment: AssessmentNode) => {
    setSelectedAssessmentId(assessment.id);
    window.dispatchEvent(new CustomEvent("simulator-select-assessment", { detail: assessment }));
  };

  // Selecting a document type opens the client/project picker + dry-run
  // preview / real-AI generate pane in the center canvas, same event-driven
  // hand-off pattern as endpoints/write-actions/config-packs/assessments.
  const handleDocumentSelect = (doc: DocumentTypeNode) => {
    setSelectedDocumentKey(doc.key);
    window.dispatchEvent(new CustomEvent("simulator-select-document", { detail: doc }));
  };

  /**
   * Starts a bulk run over one domain prefix and hands the batch to the center
   * canvas, which polls the real persisted rows for a live summary.
   *
   * The server runs each check through the SAME single-run execution path this
   * tree's per-endpoint Run uses — there is no separate bulk implementation to
   * drift from it — and one check failing never stops the rest.
   */
  const handleBulkRun = async (domain: string) => {
    if (bulkRunningDomain != null) return;
    if (selectedCustomerId == null) {
      toast.error("Select a testbed customer in the header first");
      return;
    }
    setBulkRunningDomain(domain);
    try {
      const res = await fetchWithAuth("/api/admin/monitor-checks/bulk-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: selectedCustomerId, domain }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to start bulk run");
        return;
      }
      toast.success(`Running ${data.total} ${domain}:* check${data.total === 1 ? "" : "s"}`);
      window.dispatchEvent(
        new CustomEvent("simulator-bulk-run", {
          detail: {
            batchId: data.batchId,
            domain,
            customerId: selectedCustomerId,
            total: data.total,
            skipped: data.skipped ?? [],
          },
        }),
      );
    } catch (err: any) {
      toast.error(err.message || "Network error starting bulk run");
    } finally {
      setBulkRunningDomain(null);
    }
  };

  const handleEndpointRetire = async (check: MonitorCheckNode) => {
    if (!confirm(`Retire "${check.key}"? It stays in the catalog as "archived" and can be reactivated.`)) return;
    try {
      // DELETE on the CRUD route is already a reversible archive, never a hard delete.
      const res = await fetchWithAuth(`/api/admin/monitor-checks/${encodeURIComponent(check.key)}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        toast.success("Endpoint retired (archived — reversible)");
        window.dispatchEvent(new CustomEvent("simulator-endpoints-updated"));
      } else {
        toast.error(data.error || "Failed to retire endpoint");
      }
    } catch (err: any) {
      toast.error(err.message || "Network error retiring endpoint");
    }
  };

  const handleMigrationRun = (filename: string) => {
    // One-click execute, no confirmation — internal tool, Shane's the only user.
    window.dispatchEvent(new CustomEvent("simulator-run-migration", { detail: { filename } }));
  };

  const handleSuiteDelete = async (suite: TestSuite) => {
    if (!confirm(`Delete test suite "${suite.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetchWithAuth(`/api/admin/test-suites/${suite.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Test suite deleted");
        window.dispatchEvent(new CustomEvent("simulator-suites-updated"));
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to delete test suite");
      }
    } catch (err: any) {
      toast.error(err.message || "Network error deleting test suite");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-xs select-none">
      {/* Explorer header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Explorer</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => openModal("new-script")}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="New SQL script"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Refresh explorer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Explorer Search Box */}
      <div className="shrink-0 border-b border-border bg-card/50 px-2 py-1.5">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search endpoints, events, scripts, packs..."
            className="w-full rounded border border-border bg-background py-1 pl-7 pr-6 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-1.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Tree content */}
      <ContextMenu>
      <ContextMenuTrigger asChild>
      <div className="flex-1 space-y-1 overflow-y-auto py-1">
        {isSearching &&
          !showScenarios &&
          !showScripts &&
          !showMigrations &&
          !showExceptions &&
          !showSuites &&
          !showEngines &&
          !showBusEvents &&
          !showEndpoints &&
          !showWriteActions &&
          !showPillarMatrix &&
          !showConfigPacks &&
          !showDocuments && (
            <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
              <Search className="mb-2 h-6 w-6 opacity-40" />
              <p className="text-xs font-medium text-foreground/80">No results found</p>
              <p className="mt-0.5 text-[10px]">No endpoints, events, or scripts match "{searchQuery}"</p>
              <button
                onClick={() => setSearchQuery("")}
                className="mt-3 rounded bg-accent px-2 py-1 text-[10px] font-medium text-foreground hover:bg-accent/80"
              >
                Clear search
              </button>
            </div>
          )}
        {/* Section 1: Simulation Scenarios */}
        {showScenarios && (
        <div>
          <div
            onClick={() => setScenariosOpen(!scenariosOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {isSearching || scenariosOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate">Simulation Scenarios</span>
          </div>

          {(isSearching || scenariosOpen) && (
            <div>
              {Object.keys(scenariosByCategory).map((cat) => (
                <div key={cat}>
                  <div
                    onClick={() => toggleCat(cat)}
                    className="flex h-[22px] cursor-pointer items-center gap-1.5 pl-4 pr-2 text-muted-foreground hover:bg-accent"
                  >
                    {isSearching || expandedCats[cat] ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground/70" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground/70" />
                    )}
                    {isSearching || expandedCats[cat] ? (
                      <FolderOpen className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <Folder className="h-3.5 w-3.5 text-primary" />
                    )}
                    <span className="truncate capitalize">{cat}</span>
                    <span className="ml-auto text-[9px] tabular-nums text-muted-foreground/60">
                      {scenariosByCategory[cat].length}
                    </span>
                  </div>

                  {(isSearching || expandedCats[cat]) && (
                    <div className="ml-[22px] border-l border-accent">
                      {scenariosByCategory[cat].map((event) => (
                        <ContextMenu key={event.id}>
                          <ContextMenuTrigger asChild>
                            <div
                              onClick={() => openModal("execute-scenario", { event })}
                              className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 text-foreground/85 transition-colors hover:bg-accent hover:text-foreground"
                            >
                              <Sparkles className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-primary" />
                              <span className="flex-1 truncate" title={event.description || event.name}>
                                {event.name}
                              </span>
                              <span className="hidden shrink-0 group-hover:inline">{getCategoryIcon(event.category)}</span>
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="w-44">
                            <ContextMenuItem onSelect={() => openModal("execute-scenario", { event })} className="gap-2 text-xs">
                              <Play className="h-3.5 w-3.5" />
                              Execute
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* Section 2: Saved SQL Scripts */}
        {showScripts && (
        <div>
          <div
            onClick={() => setScriptsOpen(!scriptsOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {isSearching || scriptsOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate">Saved SQL Scripts</span>
          </div>

          {(isSearching || scriptsOpen) && (
            <div>
              {Object.keys(scriptsByCategory).length === 0 ? (
                <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">No saved scripts</div>
              ) : (
                Object.keys(scriptsByCategory).map((cat) => (
                  <div key={cat}>
                    <div
                      onClick={() => toggleCat(cat)}
                      className="flex h-[22px] cursor-pointer items-center gap-1.5 pl-4 pr-2 text-muted-foreground hover:bg-accent"
                    >
                      {isSearching || expandedCats[cat] ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground/70" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground/70" />
                      )}
                      <Database className="h-3.5 w-3.5 text-primary" />
                      <span className="truncate">{cat}</span>
                      <span className="ml-auto text-[9px] tabular-nums text-muted-foreground/60">
                        {scriptsByCategory[cat].length}
                      </span>
                    </div>

                    {(isSearching || expandedCats[cat]) && (
                      <div className="ml-[22px] border-l border-accent">
                        {scriptsByCategory[cat].map((script) => (
                          <ContextMenu key={script.id}>
                            <ContextMenuTrigger asChild>
                              <div className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 text-foreground/85 transition-colors hover:bg-accent hover:text-foreground">
                                <div className="flex min-w-0 flex-1 items-center gap-1.5" onClick={() => handleScriptClick(script)}>
                                  <FileCode
                                    className={`h-3.5 w-3.5 shrink-0 ${
                                      script.isDestructive
                                        ? "text-destructive"
                                        : script.isResetScript
                                          ? "text-amber-400"
                                          : "text-muted-foreground"
                                    }`}
                                    aria-label={
                                      script.isDestructive
                                        ? "Destructive script"
                                        : script.isResetScript
                                          ? "Reset script (always runs first in test suites)"
                                          : undefined
                                    }
                                  />
                                  <span className="truncate font-mono text-[11px]" title={script.name}>
                                    {script.name}
                                  </span>
                                </div>
                                <button
                                  onClick={() => openModal("edit-script", { script })}
                                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-all hover:text-foreground group-hover:opacity-100"
                                  title="Edit script details"
                                >
                                  <Edit2 className="h-3 w-3" />
                                </button>
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-44">
                              <ContextMenuItem onSelect={() => handleScriptRun(script)} className="gap-2 text-xs">
                                <Play className="h-3.5 w-3.5" />
                                Execute
                              </ContextMenuItem>
                              <ContextMenuItem onSelect={() => openModal("edit-script", { script })} className="gap-2 text-xs">
                                <Edit2 className="h-3.5 w-3.5" />
                                Edit
                              </ContextMenuItem>
                              <ContextMenuItem
                                onSelect={() => handleScriptDelete(script)}
                                className="gap-2 text-xs text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        )}

        {/* Section 2b: Migrations (lib/db/migrations/manual/, server filesystem) */}
        {showMigrations && (
        <div>
          <div
            onClick={() => setMigrationsOpen(!migrationsOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {isSearching || migrationsOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate">Migrations{unrunMigrationCount > 0 ? ` (${unrunMigrationCount})` : ""}</span>
          </div>

          {(isSearching || migrationsOpen) && (
            <div className="ml-[22px] border-l border-accent">
              {filteredMigrationFiles.length === 0 ? (
                <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">
                  {!isSearching && migrationFiles.length > 0 ? "All migrations have been run" : "No manual migration files"}
                </div>
              ) : (
                filteredMigrationFiles.map(({ filename, ranAt }) => (
                  <ContextMenu key={filename}>
                    <ContextMenuTrigger asChild>
                      <div
                        onClick={() => handleMigrationRun(filename)}
                        className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 text-foreground/85 transition-colors hover:bg-accent hover:text-foreground"
                      >
                        {/* Display-only run-tracking checkbox (#497): checked = the file's
                            trailing self-mark INSERT has recorded a run in
                            simulator_migration_runs. Auto-tracked only — deliberately no
                            manual toggle, so it reflects DB reality, not clicks. The
                            wrapper span eats the click so it can never fire the row's
                            execute handler. */}
                        <span
                          className="flex shrink-0 items-center"
                          title={ranAt ? `Ran ${new Date(ranAt).toLocaleString()}` : "Not yet run"}
                          onClick={(evt) => evt.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={ranAt != null}
                            disabled
                            tabIndex={-1}
                            aria-label={ranAt ? `Ran ${new Date(ranAt).toLocaleString()}` : "Not yet run"}
                            className="pointer-events-none h-3 w-3 accent-green-500"
                          />
                        </span>
                        <FileDiff className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-primary" />
                        <span className="flex-1 truncate font-mono text-[11px]" title={filename}>
                          {filename}
                        </span>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-44">
                      <ContextMenuItem onSelect={() => handleMigrationRun(filename)} className="gap-2 text-xs">
                        <Play className="h-3.5 w-3.5" />
                        Execute
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))
              )}
            </div>
          )}
        </div>
        )}

        {/* Section 2c: Active Directory (#537) — the standalone /system/active-directory
            page's own tree, embedded here so Simulator Studio doesn't rebuild it.
            Independent of Simulator's own search box — it has its own universal
            search (MSPs/tenants/users/roles) and doesn't participate in
            isSearching's expand-on-match behavior above. */}
        <div>
          <div
            onClick={() => setActiveDirectoryOpen(!activeDirectoryOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {activeDirectoryOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="truncate">Active Directory</span>
          </div>

          {activeDirectoryOpen && (
            <div className="h-96 border-l border-accent">
              <ActiveDirectoryTree embedded />
            </div>
          )}
        </div>

        {/* Section 3: Exception Testing */}
        {showExceptions && (
        <div>
          <div
            onClick={() => setExceptionsOpen(!exceptionsOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {isSearching || exceptionsOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate">Exception Testing</span>
          </div>

          {(isSearching || exceptionsOpen) && (
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  onClick={() => {
                    if (!triggeringException) handleTriggerException();
                  }}
                  className={`group flex h-[22px] items-center gap-1.5 pl-4 pr-2 text-foreground/85 transition-colors hover:bg-accent hover:text-foreground ${
                    triggeringException ? "cursor-default opacity-60" : "cursor-pointer"
                  }`}
                >
                  {triggeringException ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-400" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  )}
                  <span
                    className="flex-1 truncate"
                    title="Fires a synthetic exception through the exception pipeline (marker: simulator-tree)"
                  >
                    Trigger Synthetic Exception
                  </span>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-44">
                <ContextMenuItem
                  onSelect={handleTriggerException}
                  disabled={triggeringException}
                  className="gap-2 text-xs"
                >
                  <Play className="h-3.5 w-3.5" />
                  Trigger
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )}
        </div>
        )}

        {/* Section 4: Test Suites */}
        {showSuites && (
        <div>
          <div
            onClick={() => setSuitesOpen(!suitesOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {isSearching || suitesOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate">Test Suites</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                openModal("new-test-suite");
              }}
              className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="New test suite"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          {(isSearching || suitesOpen) && (
            <div>
              {filteredSuites.length === 0 ? (
                <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">No test suites</div>
              ) : (
                filteredSuites.map((suite) => {
                  const isRunning = !!runningSuites[suite.id];
                  return (
                    <ContextMenu key={suite.id}>
                      <ContextMenuTrigger asChild>
                        <div
                          onClick={() => openModal("edit-test-suite", { suite })}
                          className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-4 pr-2 text-foreground/85 transition-colors hover:bg-accent hover:text-foreground"
                        >
                          {isRunning ? (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-label="Suite run in progress" />
                          ) : (
                            <ListChecks className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                          )}
                          <span className="flex-1 truncate" title={suite.name}>
                            {suite.name}
                          </span>
                          <span className="ml-auto text-[9px] tabular-nums text-muted-foreground/60">
                            {suite.steps.length}
                          </span>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-44">
                        <ContextMenuItem
                          onSelect={() => handleSuiteRun(suite)}
                          disabled={isRunning}
                          className="gap-2 text-xs"
                        >
                          <Play className="h-3.5 w-3.5" />
                          Run
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => openModal("edit-test-suite", { suite })} className="gap-2 text-xs">
                          <Edit2 className="h-3.5 w-3.5" />
                          Edit
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => handleSuiteDelete(suite)}
                          className="gap-2 text-xs text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })
              )}
            </div>
          )}
        </div>
        )}

        {/* Section 5: Engines */}
        {showEngines && (
        <div>
          <div
            onClick={() => setEnginesOpen(!enginesOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {isSearching || enginesOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate">Engines</span>
          </div>

          {(isSearching || enginesOpen) && (
            <div>
              {filteredEngines.length === 0 ? (
                <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">No engines</div>
              ) : (
                filteredEngines.map((engine) => {
                  const isRunning = !!runningEngines[engine.key];
                  return (
                    <ContextMenu key={engine.key}>
                      <ContextMenuTrigger asChild>
                        <div
                          onClick={() => handleEngineRun(engine)}
                          className={`group flex h-[22px] items-center gap-1.5 pl-4 pr-2 text-foreground/85 transition-colors hover:bg-accent hover:text-foreground ${
                            isRunning ? "cursor-default opacity-60" : "cursor-pointer"
                          }`}
                        >
                          {isRunning ? (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-label="Engine run in progress" />
                          ) : (
                            <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                          )}
                          <span className="flex-1 truncate" title={engine.description || engine.label}>
                            {engine.label}
                          </span>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-44">
                        <ContextMenuItem
                          onSelect={() => handleEngineRun(engine)}
                          disabled={isRunning}
                          className="gap-2 text-xs"
                        >
                          <Play className="h-3.5 w-3.5" />
                          Run
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })
              )}
            </div>
          )}
        </div>
        )}

        {/* Section 6: Events (canonical event bus) */}
        {showBusEvents && (
        <div>
          <div
            onClick={() => setBusEventsOpen(!busEventsOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {isSearching || busEventsOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate">Events</span>
          </div>

          {(isSearching || busEventsOpen) && (
            <div>
              {filteredBusEventTypes.length === 0 ? (
                <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">No event types</div>
              ) : (
                Object.keys(busEventsByGroup).map((group) => (
                  <div key={group}>
                    <div
                      onClick={() => toggleCat(`evt:${group}`)}
                      className="flex h-[22px] cursor-pointer items-center gap-1.5 pl-4 pr-2 text-muted-foreground hover:bg-accent"
                    >
                      {isSearching || expandedCats[`evt:${group}`] ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground/70" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground/70" />
                      )}
                      {isSearching || expandedCats[`evt:${group}`] ? (
                        <FolderOpen className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <Folder className="h-3.5 w-3.5 text-primary" />
                      )}
                      <span className="truncate">{group}</span>
                      <span className="ml-auto text-[9px] tabular-nums text-muted-foreground/60">
                        {busEventsByGroup[group].length}
                      </span>
                    </div>

                    {(isSearching || expandedCats[`evt:${group}`]) && (
                      <div className="ml-[22px] border-l border-accent">
                        {busEventsByGroup[group].map((t) => (
                          <ContextMenu key={t.eventType}>
                            <ContextMenuTrigger asChild>
                              <div
                                onClick={() => openModal("fire-bus-event", { eventType: t.eventType })}
                                className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 text-foreground/85 transition-colors hover:bg-accent hover:text-foreground"
                              >
                                <Zap className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-amber-400" />
                                <span className="flex-1 truncate font-mono text-[11px]" title={t.eventType}>
                                  {t.eventType}
                                </span>
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-44">
                              <ContextMenuItem
                                onSelect={() => openModal("fire-bus-event", { eventType: t.eventType })}
                                className="gap-2 text-xs"
                              >
                                <Zap className="h-3.5 w-3.5" />
                                Fire…
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        )}
        {/* Section 7: M365 Endpoints (real monitor_checks catalog) */}
        {showEndpoints && (
        <div>
          <div
            onClick={() => setEndpointsOpen(!endpointsOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {isSearching || endpointsOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate">M365 Endpoints</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                openModal("new-monitor-check");
              }}
              className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="New M365 endpoint"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          {(isSearching || endpointsOpen) && (
            <div>
              {filteredMonitorChecks.length === 0 ? (
                <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">No monitor checks</div>
              ) : (
                Object.keys(checksByDomain)
                  .sort()
                  .map((domain) => (
                    <div key={domain}>
                      <div
                        onClick={() => toggleCat(`ep:${domain}`)}
                        className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-4 pr-2 text-muted-foreground hover:bg-accent"
                      >
                        {isSearching || expandedCats[`ep:${domain}`] ? (
                          <ChevronDown className="h-3 w-3 text-muted-foreground/70" />
                        ) : (
                          <ChevronRight className="h-3 w-3 text-muted-foreground/70" />
                        )}
                        {isSearching || expandedCats[`ep:${domain}`] ? (
                          <FolderOpen className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <Folder className="h-3.5 w-3.5 text-primary" />
                        )}
                        <span className="truncate capitalize">{domain}</span>
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                          {/* Bulk run: every active check under this domain prefix,
                              each executed through the same single-run path. */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleBulkRun(domain);
                            }}
                            disabled={bulkRunningDomain != null}
                            className={`shrink-0 items-center gap-1 rounded px-1 text-[9px] uppercase tracking-wider text-muted-foreground/70 transition-colors hover:bg-background hover:text-primary disabled:opacity-40 ${
                              bulkRunningDomain === domain ? "flex" : "hidden group-hover:flex"
                            }`}
                            title={`Run every active check under "${domain}:" against the selected testbed customer`}
                          >
                            {bulkRunningDomain === domain ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                            Run all
                          </button>
                          <span className="text-[9px] tabular-nums text-muted-foreground/60">
                            {checksByDomain[domain]!.length}
                          </span>
                        </span>
                      </div>

                      {(isSearching || expandedCats[`ep:${domain}`]) && (
                        <div className="ml-[22px] border-l border-accent">
                          {checksByDomain[domain]!.map((check) => (
                            <ContextMenu key={check.key}>
                              <ContextMenuTrigger asChild>
                                <div
                                  onClick={() => handleEndpointSelect(check)}
                                  className={`group flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 transition-colors hover:bg-accent hover:text-foreground ${
                                    selectedEndpointKey === check.key
                                      ? "bg-accent text-foreground"
                                      : "text-foreground/85"
                                  } ${check.status !== "active" ? "opacity-50" : ""}`}
                                >
                                  <Globe
                                    className={`h-3 w-3 shrink-0 ${
                                      check.requiresCustomerScript
                                        ? "text-amber-400"
                                        : "text-muted-foreground group-hover:text-primary"
                                    }`}
                                    aria-label={
                                      check.requiresCustomerScript ? "Collected by customer-side script" : undefined
                                    }
                                  />
                                  <span
                                    className="flex-1 truncate font-mono text-[11px]"
                                    title={check.description || check.label}
                                  >
                                    {check.key.includes(":") ? check.key.split(":").slice(1).join(":") : check.key}
                                  </span>
                                  {check.status !== "active" && (
                                    <span className="shrink-0 text-[9px] uppercase tracking-wider text-amber-400/80">
                                      {check.status}
                                    </span>
                                  )}
                                </div>
                              </ContextMenuTrigger>
                              <ContextMenuContent className="w-44">
                                <ContextMenuItem onSelect={() => handleEndpointSelect(check)} className="gap-2 text-xs">
                                  <Play className="h-3.5 w-3.5" />
                                  Open
                                </ContextMenuItem>
                                <ContextMenuItem
                                  onSelect={() => openModal("edit-monitor-check", { check })}
                                  className="gap-2 text-xs"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                  Edit
                                </ContextMenuItem>
                                <ContextMenuItem
                                  onSelect={() => handleEndpointRetire(check)}
                                  disabled={check.status !== "active"}
                                  className="gap-2 text-xs text-destructive focus:text-destructive"
                                >
                                  <Archive className="h-3.5 w-3.5" />
                                  Retire
                                </ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
              )}
            </div>
          )}
        </div>
        )}

        {/* Section 8: Write Actions (real baseline_action_templates catalog) —
            the tenant-MUTATING sibling of M365 Endpoints. Testbed-only; the
            confirmation + safety flow lives in the center canvas. */}
        {showWriteActions && (
        <div>
          <div
            onClick={() => setWriteActionsOpen(!writeActionsOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {isSearching || writeActionsOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <Zap className="h-3.5 w-3.5 text-amber-400" />
            <span className="truncate">Write Actions</span>
            <span
              className="ml-auto text-[9px] uppercase tracking-wider text-amber-400/70"
              title="These execute REAL tenant-mutating writes — testbed customers only"
            >
              testbed
            </span>
          </div>

          {(isSearching || writeActionsOpen) && (
            <div>
              {filteredWriteActions.length === 0 ? (
                <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">No write-action templates</div>
              ) : (
                Object.keys(writeActionsByCategory)
                  .sort()
                  .map((cat) => (
                    <div key={cat}>
                      <div
                        onClick={() => toggleCat(`wa:${cat}`)}
                        className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-4 pr-2 text-muted-foreground hover:bg-accent"
                      >
                        {isSearching || expandedCats[`wa:${cat}`] ? (
                          <ChevronDown className="h-3 w-3 text-muted-foreground/70" />
                        ) : (
                          <ChevronRight className="h-3 w-3 text-muted-foreground/70" />
                        )}
                        {isSearching || expandedCats[`wa:${cat}`] ? (
                          <FolderOpen className="h-3.5 w-3.5 text-amber-400" />
                        ) : (
                          <Folder className="h-3.5 w-3.5 text-amber-400" />
                        )}
                        <span className="truncate">{cat}</span>
                        <span className="ml-auto text-[9px] tabular-nums text-muted-foreground/60">
                          {writeActionsByCategory[cat]!.length}
                        </span>
                      </div>

                      {(isSearching || expandedCats[`wa:${cat}`]) && (
                        <div className="ml-[22px] border-l border-accent">
                          {writeActionsByCategory[cat]!.map((wa) => (
                            <ContextMenu key={wa.templateId}>
                              <ContextMenuTrigger asChild>
                                <div
                                  onClick={() => handleWriteActionSelect(wa)}
                                  className={`group flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 transition-colors hover:bg-accent hover:text-foreground ${
                                    selectedWriteActionId === wa.templateId
                                      ? "bg-accent text-foreground"
                                      : "text-foreground/85"
                                  } ${wa.status !== "active" ? "opacity-50" : ""}`}
                                >
                                  <span
                                    className={`shrink-0 rounded px-1 text-[8px] font-bold uppercase tracking-wider ${
                                      wa.method === "DELETE"
                                        ? "bg-red-500/15 text-red-400"
                                        : wa.method === "POST"
                                          ? "bg-emerald-500/15 text-emerald-400"
                                          : "bg-amber-500/15 text-amber-400"
                                    }`}
                                    title={`${wa.method} ${wa.endpoint}`}
                                  >
                                    {wa.method}
                                  </span>
                                  <span
                                    className="flex-1 truncate text-[11px]"
                                    title={wa.description || wa.label}
                                  >
                                    {wa.label}
                                  </span>
                                  {wa.status !== "active" && (
                                    <span
                                      className="shrink-0 text-[9px] uppercase tracking-wider text-amber-400/80"
                                      title="Retired — not runnable. See the template description for why."
                                    >
                                      {wa.status}
                                    </span>
                                  )}
                                  {!wa.reversible && (
                                    <span
                                      className="shrink-0 text-[9px] uppercase tracking-wider text-red-400/70"
                                      title="No single-step rollback path"
                                    >
                                      1-way
                                    </span>
                                  )}
                                  {wa.catalog?.safeOrGated === "gated" && (
                                    <Shield className="h-3 w-3 shrink-0 text-amber-400/70" aria-label="Gated action" />
                                  )}
                                </div>
                              </ContextMenuTrigger>
                              <ContextMenuContent className="w-44">
                                <ContextMenuItem onSelect={() => handleWriteActionSelect(wa)} className="gap-2 text-xs">
                                  <Play className="h-3.5 w-3.5" />
                                  Open
                                </ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
              )}
            </div>
          )}
        </div>
        )}

        {/* Section 9: Pillar Matrix — cross-signal per-pillar impact tuning.
            Distinct from the per-endpoint Engine Trace: pick a pillar and edit
            every rule that contributes to it, across all signals, in one table.
            Each pillar row opens the matrix pre-selected to that pillar. */}
        {showPillarMatrix && (
        <div>
          <div
            onClick={() => setPillarMatrixOpen(!pillarMatrixOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {isSearching || pillarMatrixOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <LayoutGrid className="h-3.5 w-3.5 text-primary" />
            <span className="truncate">Pillar Matrix</span>
          </div>

          {(isSearching || pillarMatrixOpen) && (
            <div className="ml-[22px] border-l border-accent">
              {filteredPillars.map((p) => (
                <div
                  key={p.key}
                  onClick={() => handlePillarSelect(p.key)}
                  className={`group flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 transition-colors hover:bg-accent hover:text-foreground ${
                    selectedPillarKey === p.key ? "bg-accent text-foreground" : "text-foreground/85"
                  }`}
                  title={`Tune every rule contributing to the ${p.label} pillar`}
                >
                  <LayoutGrid className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-primary" />
                  <span className="flex-1 truncate text-[11px]">{p.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* Section 10: Config Packs — orchestrated sequences of the real Write
            Actions, run whole (in dependency order) or one step at a time.
            Testbed-only; the confirmation + safety + progress flow lives in the
            center canvas. Create/modify the packs themselves in Baseline
            Templates (deep-linked — that CRUD editor is reused, not rebuilt). */}
        {showConfigPacks && (
        <div>
          <div
            onClick={() => setConfigPacksOpen(!configPacksOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {isSearching || configPacksOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <Package className="h-3.5 w-3.5 text-amber-400" />
            <span className="truncate">Config Packs</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                openConfigPackManager();
              }}
              className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Create / edit packs and their steps (Baseline Templates)"
            >
              <Edit2 className="h-3 w-3" />
            </button>
          </div>

          {(isSearching || configPacksOpen) && (
            <div className="ml-[22px] border-l border-accent">
              {filteredConfigPacks.length === 0 ? (
                <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">
                  No config packs — create one in Baseline Templates
                </div>
              ) : (
                filteredConfigPacks.map((pack) => (
                  <ContextMenu key={pack.packKey}>
                    <ContextMenuTrigger asChild>
                      <div
                        onClick={() => handleConfigPackSelect(pack)}
                        className={`group flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 transition-colors hover:bg-accent hover:text-foreground ${
                          selectedConfigPackKey === pack.packKey ? "bg-accent text-foreground" : "text-foreground/85"
                        } ${pack.status !== "active" ? "opacity-50" : ""}`}
                      >
                        <Package className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-primary" />
                        <span className="flex-1 truncate text-[11px]" title={pack.description || pack.label}>
                          {pack.label}
                        </span>
                        {pack.status !== "active" && (
                          <span className="shrink-0 text-[9px] uppercase tracking-wider text-amber-400/80">{pack.status}</span>
                        )}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-48">
                      <ContextMenuItem onSelect={() => handleConfigPackSelect(pack)} className="gap-2 text-xs">
                        <Play className="h-3.5 w-3.5" />
                        Open runner
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={openConfigPackManager} className="gap-2 text-xs">
                        <Edit2 className="h-3.5 w-3.5" />
                        Edit pack & steps
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))
              )}
            </div>
          )}
        </div>
        )}

        {/* Section 11: Assessments — real `services` rows (category='assessment'),
            grouped Free/Paid on the real is_free_offering column. Read-only
            catalog + packageKey audit view (Phase 1); create wizard (Phase 5,
            #28) — right-click the section header or use the "+" button, both
            open the same AssessmentCreationWizard via openModal. Per-row Edit
            (Phase 6, #29) opens the same wizard in edit mode via
            openModal("new-assessment", { assessments, editingAssessment }).
            Per-row Delete/Deprecate (Phase 7, #30) open
            AssessmentDeleteDeprecateModals.tsx via
            openModal("delete-assessment", { assessment, assessments }) /
            openModal("deprecate-assessment", { assessment }) — a deprecated
            (visibility: "private") row is dimmed and badged "Private" here,
            refreshed by the same simulator-assessments-updated event the
            create/edit wizard already dispatches. */}
        {showAssessments && (
        <div>
          <ContextMenu>
          <ContextMenuTrigger asChild>
          <div
            onClick={() => setAssessmentsOpen(!assessmentsOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {isSearching || assessmentsOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <ListChecks className="h-3.5 w-3.5 text-emerald-400" />
            <span className="truncate">Assessments</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                openModal("new-assessment", { assessments });
              }}
              className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="New assessment"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-44">
            <ContextMenuItem onSelect={() => openModal("new-assessment", { assessments })} className="gap-2 text-xs">
              <Plus className="h-3.5 w-3.5" />
              New Assessment
            </ContextMenuItem>
          </ContextMenuContent>
          </ContextMenu>

          {(isSearching || assessmentsOpen) && (
            <div className="ml-[22px] border-l border-accent">
              {filteredAssessments.length === 0 ? (
                <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">No assessments</div>
              ) : (
                (["Free", "Paid"] as const).map((group) =>
                  assessmentsByGroup[group]?.length ? (
                    <div key={group}>
                      <div
                        onClick={() => toggleCat(`asmt:${group}`)}
                        className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-4 pr-2 text-muted-foreground hover:bg-accent"
                      >
                        {isSearching || expandedCats[`asmt:${group}`] ? (
                          <ChevronDown className="h-3 w-3 text-muted-foreground/70" />
                        ) : (
                          <ChevronRight className="h-3 w-3 text-muted-foreground/70" />
                        )}
                        {isSearching || expandedCats[`asmt:${group}`] ? (
                          <FolderOpen className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <Folder className="h-3.5 w-3.5 text-primary" />
                        )}
                        <span className="truncate">{group}</span>
                        <span className="ml-auto shrink-0 text-[9px] tabular-nums text-muted-foreground/60">
                          {assessmentsByGroup[group]!.length}
                        </span>
                      </div>

                      {(isSearching || expandedCats[`asmt:${group}`]) && (
                        <div className="ml-[22px] border-l border-accent">
                          {assessmentsByGroup[group]!.map((assessment) => {
                            const isDeprecated = assessment.visibility === "private";
                            return (
                            <ContextMenu key={assessment.id}>
                              <ContextMenuTrigger asChild>
                                <div
                                  onClick={() => handleAssessmentSelect(assessment)}
                                  className={`group flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 transition-colors hover:bg-accent hover:text-foreground ${
                                    selectedAssessmentId === assessment.id ? "bg-accent text-foreground" : "text-foreground/85"
                                  } ${isDeprecated ? "opacity-50" : ""}`}
                                >
                                  <ListChecks className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-primary" />
                                  <span className="flex-1 truncate text-[11px]" title={assessment.slug ?? assessment.name}>
                                    {assessment.name}
                                  </span>
                                  {isDeprecated && (
                                    <span
                                      className="shrink-0 rounded border border-amber-400/40 px-1 text-[9px] uppercase tracking-wider text-amber-400/80"
                                      title="Deprecated — visibility set to private, unpublished from the catalog"
                                    >
                                      Private
                                    </span>
                                  )}
                                  {!assessment.hasDedicatedPackage && (
                                    <span
                                      className="shrink-0 text-[9px] uppercase tracking-wider text-destructive"
                                      title="No dedicated packageKey — runs on the core:security-baseline fallback at scan time"
                                    >
                                      ⚠️ no dedicated package
                                    </span>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openModal("new-assessment", { assessments, editingAssessment: assessment });
                                    }}
                                    className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-all hover:text-foreground group-hover:opacity-100"
                                    title="Edit assessment"
                                  >
                                    <Edit2 className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openModal("deprecate-assessment", { assessment });
                                    }}
                                    className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-all hover:text-foreground group-hover:opacity-100"
                                    title="Deprecate assessment (unpublish, reversible)"
                                  >
                                    <Archive className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openModal("delete-assessment", { assessment, assessments });
                                    }}
                                    className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover:opacity-100"
                                    title="Delete assessment"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              </ContextMenuTrigger>
                              <ContextMenuContent className="w-44">
                                <ContextMenuItem
                                  onSelect={() => openModal("new-assessment", { assessments, editingAssessment: assessment })}
                                  className="gap-2 text-xs"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                  Edit
                                </ContextMenuItem>
                                <ContextMenuItem
                                  onSelect={() => openModal("deprecate-assessment", { assessment })}
                                  className="gap-2 text-xs"
                                >
                                  <Archive className="h-3.5 w-3.5" />
                                  Deprecate
                                </ContextMenuItem>
                                <ContextMenuItem
                                  onSelect={() => openModal("delete-assessment", { assessment, assessments })}
                                  className="gap-2 text-xs text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Delete
                                </ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null
                )
              )}
            </div>
          )}
        </div>
        )}

        {/* Section 12: Documents — real `document_types` rows
            (GET /api/admin/document-types), grouped by the real `category`
            column ("report"/"consulting"), mirroring how Section 11 groups
            Assessments Free/Paid. Clicking a row opens the client/project
            picker + dry-run preview / real-AI generate pane + editable
            properties panel in the center canvas. Read-only browse here —
            no tree-level create/edit/delete (that stays Document Types
            Manager's job elsewhere); a yellow warning triangle flags any
            row with no linked AI prompt (aiPromptId null). */}
        {showDocuments && (
        <div>
          <div
            onClick={() => setDocumentsOpen(!documentsOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {isSearching || documentsOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <FileText className="h-3.5 w-3.5 text-sky-400" />
            <span className="truncate">Documents</span>
          </div>

          {(isSearching || documentsOpen) && (
            <div className="ml-[22px] border-l border-accent">
              {filteredDocumentTypes.length === 0 ? (
                <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">No document types</div>
              ) : (
                (["report", "consulting"] as const).map((cat) =>
                  documentsByCategory[cat]?.length ? (
                    <div key={cat}>
                      <div
                        onClick={() => toggleCat(`doc:${cat}`)}
                        className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-4 pr-2 text-muted-foreground hover:bg-accent"
                      >
                        {isSearching || expandedCats[`doc:${cat}`] ? (
                          <ChevronDown className="h-3 w-3 text-muted-foreground/70" />
                        ) : (
                          <ChevronRight className="h-3 w-3 text-muted-foreground/70" />
                        )}
                        {isSearching || expandedCats[`doc:${cat}`] ? (
                          <FolderOpen className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <Folder className="h-3.5 w-3.5 text-primary" />
                        )}
                        <span className="truncate capitalize">{cat}</span>
                        <span className="ml-auto shrink-0 text-[9px] tabular-nums text-muted-foreground/60">
                          {documentsByCategory[cat]!.length}
                        </span>
                      </div>

                      {(isSearching || expandedCats[`doc:${cat}`]) && (
                        <div className="ml-[22px] border-l border-accent">
                          {documentsByCategory[cat]!.map((doc) => (
                            <div
                              key={doc.key}
                              onClick={() => handleDocumentSelect(doc)}
                              className={`group flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 transition-colors hover:bg-accent hover:text-foreground ${
                                selectedDocumentKey === doc.key ? "bg-accent text-foreground" : "text-foreground/85"
                              } ${!doc.isActive ? "opacity-50" : ""}`}
                            >
                              <FileText className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-primary" />
                              <span className="flex-1 truncate text-[11px]" title={doc.label}>
                                {doc.label}
                              </span>
                              {doc.aiPromptId == null && (
                                <span
                                  className="shrink-0 text-amber-400"
                                  title="No AI prompt configured — this document type has no database-backed generation logic yet."
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null
                )
              )}
            </div>
          )}
        </div>
        )}
      </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onSelect={() => openModal("new-script")} className="gap-2 text-xs">
          <Plus className="h-3.5 w-3.5" />
          New Script
        </ContextMenuItem>
      </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
