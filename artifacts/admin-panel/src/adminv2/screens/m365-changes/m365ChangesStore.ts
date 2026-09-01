/**
 * m365ChangesStore.ts — the AdminV2 Microsoft Changes interpretation-authoring
 * screen's state (Git #1532, part of #1494).
 *
 * Plain external store (subscribe / getSnapshot), same shape as
 * riskDecisionsStore / marketingStore. Every figure shown is served by the API
 * (`routes/admin-m365-interpretations.ts`); the store never invents one, and it
 * never falls back to fixture content — an unread library renders an honest empty
 * state (the standing hard rule).
 *
 * Authoring model: Shane authors, AI proposes. `propose()` runs the model and
 * returns an UNSAVED reading the Body shows for review; `create()` persists it as
 * `status = 'proposed'`; `confirm()` promotes it to `status = 'confirmed'` — the
 * only path a reading takes before it can reach a tenant.
 */

import { logger } from "@/lib/logger";
import { ACCENT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";

const log = logger.child({ channel: "integration.azure" });

/** Live key for the Watch tab's "proposed, awaiting your confirmation" count. */
export const WATCH_PROPOSED_KEY = "m365-changes:watch-proposed";

// ── Wire types (mirror routes/admin-m365-interpretations.ts) ────────────────

export type M365ChangeClass = "retirement" | "default_flip" | "new_feature" | "breaking_change" | "licensing";
export type M365InterpretationStatus = "proposed" | "confirmed" | "rejected";
export type M365Actor = "microsoft" | "admin";
export type M365Controllability = "yes" | "no" | "unknown";
export type M365SourceKind = "roadmap" | "message_center" | "manual";

export interface M365Touches {
  services: string[];
  protocols: string[];
  skus: string[];
  settings: string[];
}

export interface M365Probe {
  description: string;
  monitorCheckKey?: string | null;
  powershell?: string | null;
  graphEndpoint?: string | null;
}

export interface Interpretation {
  id: number;
  mspId: number;
  featureId: string | null;
  graphMessageId: string | null;
  sourceKind: M365SourceKind;
  title: string;
  summary: string | null;
  changeClass: M365ChangeClass;
  touches: M365Touches;
  whoActs: M365Actor;
  controllable: M365Controllability;
  controlMethod: string | null;
  probe: M365Probe;
  status: M365InterpretationStatus;
  proposedBy: string;
  aiModel: string | null;
  aiRationale: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InterpretationCounts {
  proposed: number;
  confirmed: number;
  rejected: number;
  total: number;
}

export interface RoadmapCandidate {
  featureId: string;
  title: string;
  status: string | null;
  products: string[];
  msModified: string | null;
  /**
   * #1531 — whether this roadmap item has actually landed in at least one
   * tenant's Message Center feed yet (a real post's own body named this
   * featureId). That crossing is when the affected-object count stops being
   * hypothetical — worth showing the author picking what to interpret next.
   */
  crossedOver: boolean;
}

export interface MessageCenterCandidate {
  graphMessageId: string;
  title: string;
  category: string | null;
  isMajorChange: boolean;
  services: string[];
  /** #1531 — the roadmap feature ID(s) this post's own body named, if any. */
  roadmapFeatureIds: string[];
  lastModifiedDateTime: string | null;
}

/** The unsaved structured reading the model returns, before Shane creates it. */
export interface Proposal {
  summary: string;
  changeClass: M365ChangeClass;
  touches: M365Touches;
  whoActs: M365Actor;
  controllable: M365Controllability;
  controlMethod: string | null;
  probe: M365Probe;
  rationale: string;
  model: string;
}

export interface ProposalResult {
  sourceKind: "roadmap" | "message_center";
  featureId: string | null;
  graphMessageId: string | null;
  title: string;
  proposal: Proposal;
}

// ── Routing (#1701 — mirrors routes/admin-m365-interpretations.ts's
// /route + /routings, the on-demand trigger for the same m365_route_changes
// workflow node the nightly sweep runs) ──────────────────────────────────────

export type M365RoutingDecision = "auto_created" | "proposed" | "declined_risk" | "none";
export type M365RoutingReason = "auto_created" | "undated" | "zero_affected" | "not_measured" | "no_announcement";

export interface RoutingOutcome {
  id: number;
  customerId: number;
  tenantName: string;
  decision: M365RoutingDecision;
  reason: M365RoutingReason;
  intake: string | null;
  affectedCount: number | null;
  hasStructuralDate: boolean;
  changeRequestId: number | null;
  /** e.g. "CR-2026-142" — the real code every other change-control console shows for this CR. */
  changeRequestCode: string | null;
  riskDecisionId: number | null;
  routedAt: string | null;
  updatedAt: string;
}

/** One interpretation's on-demand routing run — surfaced next to the peek's Route action. */
export interface RoutingRunState {
  status: "running" | "completed" | "failed";
  runId: number | null;
  error: string | null;
}

// ── Resolution (#1615 — mirrors routes/admin-m365-interpretations.ts's
// /resolve + /resolutions, #1533's resolution layer; the on-demand caller was
// never wired into AdminV2 before this) ─────────────────────────────────────

export type M365ResolutionStatus = "measured" | "not_measured" | "error";
export type M365ResolutionBasis = "monitor_check" | "license_snapshot";

export interface ResolutionOutcome {
  id: number;
  customerId: number;
  tenantName: string;
  status: M365ResolutionStatus;
  affectedCount: number | null;
  basis: M365ResolutionBasis | null;
  basisDetail: Record<string, unknown>;
  errorMessage: string | null;
  measuredAt: string | null;
  updatedAt: string;
}

/** One interpretation's live resolve run — a synchronous request/response, not a polled workflow. */
export interface ResolveRunState {
  status: "running" | "completed" | "failed";
  error: string | null;
}

// ── Store shape ─────────────────────────────────────────────────────────────

interface M365ChangesState {
  interpretations: Interpretation[];
  counts: InterpretationCounts;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** true when no MSP is configured to author against — an honest, distinct state. */
  noMsp: boolean;

  candidatesLoading: boolean;
  candidatesLoaded: boolean;
  roadmapCandidates: RoadmapCandidate[];
  messageCenterCandidates: MessageCenterCandidate[];

  /** The in-flight/last AI proposal awaiting review, if any. */
  proposing: boolean;
  proposalError: string | null;
  proposal: ProposalResult | null;

  /** Per-interpretation on-demand routing run state, and the routing ledger it produces. */
  routingRuns: Record<number, RoutingRunState>;
  routingsByInterpretation: Record<number, RoutingOutcome[]>;

  /** Per-interpretation on-demand resolve run state, and the resolution ledger it produces. */
  resolveRuns: Record<number, ResolveRunState>;
  resolutionsByInterpretation: Record<number, ResolutionOutcome[]>;
}

const EMPTY_COUNTS: InterpretationCounts = { proposed: 0, confirmed: 0, rejected: 0, total: 0 };

type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;
const listeners = new Set<Listener>();

let state: M365ChangesState = {
  interpretations: [],
  counts: EMPTY_COUNTS,
  loading: false,
  loaded: false,
  error: null,
  noMsp: false,
  candidatesLoading: false,
  candidatesLoaded: false,
  roadmapCandidates: [],
  messageCenterCandidates: [],
  proposing: false,
  proposalError: null,
  proposal: null,
  routingRuns: {},
  routingsByInterpretation: {},
  resolveRuns: {},
  resolutionsByInterpretation: {},
};

function setState(patch: Partial<M365ChangesState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
  publishWatch();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getSnapshot(): M365ChangesState {
  return state;
}

export function configureM365ChangesFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

/** The Watch tab's live "n proposed, awaiting you" count. Amber while > 0. */
export function proposedCount(s: M365ChangesState = state): number {
  return s.counts.proposed;
}

function publishWatch(): void {
  const n = proposedCount();
  setLiveRibbonValue(
    WATCH_PROPOSED_KEY,
    n > 0 ? { label: `${n} proposed, awaiting you`, color: ACCENT.amber } : { label: "Nothing awaiting confirmation" },
  );
}

let warmed = false;
export function warmM365Changes(): void {
  if (warmed || !adminFetchRef) return;
  warmed = true;
  void loadInterpretations();
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function failureOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch { /* not JSON */ }
  return `${res.status} ${res.statusText}`;
}

// ── Loads ───────────────────────────────────────────────────────────────────

export async function loadInterpretations(force = false): Promise<void> {
  if (!adminFetchRef) return;
  if (!force && (state.loading || state.loaded)) return;
  setState({ loading: true, error: null });
  try {
    const res = await adminFetchRef("/api/admin/m365/interpretations");
    if (!res.ok) {
      setState({ loading: false, error: await failureOf(res) });
      return;
    }
    const body = (await res.json()) as {
      interpretations: Interpretation[];
      counts: InterpretationCounts;
      noMsp?: boolean;
    };
    setState({
      loading: false,
      loaded: true,
      interpretations: body.interpretations,
      counts: body.counts ?? EMPTY_COUNTS,
      noMsp: !!body.noMsp,
    });
  } catch (err) {
    log.warn({ err }, "m365 interpretations failed to load");
    setState({ loading: false, error: errorText(err) });
  }
}

export async function loadCandidates(force = false): Promise<void> {
  if (!adminFetchRef) return;
  if (!force && (state.candidatesLoading || state.candidatesLoaded)) return;
  setState({ candidatesLoading: true });
  try {
    const res = await adminFetchRef("/api/admin/m365/interpretations/candidates");
    if (!res.ok) {
      setState({ candidatesLoading: false });
      return;
    }
    const body = (await res.json()) as {
      roadmap: RoadmapCandidate[];
      messageCenter: MessageCenterCandidate[];
    };
    setState({
      candidatesLoading: false,
      candidatesLoaded: true,
      roadmapCandidates: body.roadmap ?? [],
      messageCenterCandidates: body.messageCenter ?? [],
    });
  } catch (err) {
    log.warn({ err }, "m365 candidates failed to load");
    setState({ candidatesLoading: false });
  }
}

// ── AI propose (does not persist) ────────────────────────────────────────────

export async function propose(source: { featureId?: string; graphMessageId?: string }): Promise<ProposalResult | null> {
  if (!adminFetchRef) return null;
  setState({ proposing: true, proposalError: null, proposal: null });
  try {
    const res = await adminFetchRef("/api/admin/m365/interpretations/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(source),
    });
    if (!res.ok) {
      setState({ proposing: false, proposalError: await failureOf(res) });
      return null;
    }
    const result = (await res.json()) as ProposalResult;
    setState({ proposing: false, proposal: result });
    return result;
  } catch (err) {
    log.warn({ err }, "m365 propose failed");
    setState({ proposing: false, proposalError: errorText(err) });
    return null;
  }
}

export function clearProposal(): void {
  setState({ proposal: null, proposalError: null });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export interface CreateInterpretationInput {
  featureId?: string | null;
  graphMessageId?: string | null;
  sourceKind: M365SourceKind;
  title: string;
  summary?: string | null;
  changeClass: M365ChangeClass;
  touches?: M365Touches;
  whoActs?: M365Actor;
  controllable?: M365Controllability;
  controlMethod?: string | null;
  probe?: M365Probe;
  proposedBy?: "ai" | "human";
  aiModel?: string | null;
  aiRationale?: string | null;
  notes?: string | null;
  status?: M365InterpretationStatus;
}

export async function createInterpretation(input: CreateInterpretationInput): Promise<Interpretation | null> {
  if (!adminFetchRef) return null;
  try {
    const res = await adminFetchRef("/api/admin/m365/interpretations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      setState({ error: await failureOf(res) });
      return null;
    }
    const body = (await res.json()) as { interpretation: Interpretation };
    await Promise.all([loadInterpretations(true), loadCandidates(true)]);
    return body.interpretation;
  } catch (err) {
    log.warn({ err }, "m365 create interpretation failed");
    setState({ error: errorText(err) });
    return null;
  }
}

export interface PatchInterpretationInput {
  title?: string;
  summary?: string | null;
  changeClass?: M365ChangeClass;
  touches?: M365Touches;
  whoActs?: M365Actor;
  controllable?: M365Controllability;
  controlMethod?: string | null;
  probe?: M365Probe;
  notes?: string | null;
}

export async function updateInterpretation(id: number, patch: PatchInterpretationInput): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const res = await adminFetchRef(`/api/admin/m365/interpretations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setState({ error: await failureOf(res) });
      return;
    }
    await loadInterpretations(true);
  } catch (err) {
    log.warn({ err, id }, "m365 update interpretation failed");
    setState({ error: errorText(err) });
  }
}

async function statusAction(id: number, action: "confirm" | "reject"): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const res = await adminFetchRef(`/api/admin/m365/interpretations/${id}/${action}`, { method: "POST" });
    if (!res.ok) {
      setState({ error: await failureOf(res) });
      return;
    }
    await loadInterpretations(true);
  } catch (err) {
    log.warn({ err, id, action }, "m365 status action failed");
    setState({ error: errorText(err) });
  }
}

/** Shane confirms an AI-proposed reading — the only path to 'confirmed'. */
export async function confirmInterpretation(id: number): Promise<void> {
  await statusAction(id, "confirm");
}

export async function rejectInterpretation(id: number): Promise<void> {
  await statusAction(id, "reject");
}

export async function deleteInterpretation(id: number): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const res = await adminFetchRef(`/api/admin/m365/interpretations/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setState({ error: await failureOf(res) });
      return;
    }
    await Promise.all([loadInterpretations(true), loadCandidates(true)]);
  } catch (err) {
    log.warn({ err, id }, "m365 delete interpretation failed");
    setState({ error: errorText(err) });
  }
}

// ── Routing (#1701) ──────────────────────────────────────────────────────────

function setRoutingRun(id: number, run: RoutingRunState): void {
  setState({ routingRuns: { ...state.routingRuns, [id]: run } });
}

// Not part of published state — a plain in-flight guard so re-opening the same
// peek repeatedly (the peek resolver re-runs on every store notification)
// never fires a duplicate GET while the first is still in flight.
const routingsLoadInFlight = new Set<number>();

export async function loadRoutings(id: number, force = false): Promise<void> {
  if (!adminFetchRef) return;
  if (!force && state.routingsByInterpretation[id]) return;
  if (routingsLoadInFlight.has(id)) return;
  routingsLoadInFlight.add(id);
  try {
    const res = await adminFetchRef(`/api/admin/m365/interpretations/${id}/routings`);
    if (!res.ok) return;
    const body = (await res.json()) as { routings: RoutingOutcome[] };
    setState({ routingsByInterpretation: { ...state.routingsByInterpretation, [id]: body.routings ?? [] } });
  } catch (err) {
    log.warn({ err, id }, "m365 routings failed to load");
  } finally {
    routingsLoadInFlight.delete(id);
  }
}

const ROUTING_POLL_INTERVAL_MS = 1200;
// ~36s ceiling. Routing is DB-only work (no external Graph calls) so a real run
// finishes in well under a second; this bound only guards against a genuinely
// stuck run, at which point the operator is pointed at Workflow Engine run
// history rather than left staring at a spinner forever.
const ROUTING_POLL_MAX_ATTEMPTS = 30;

/**
 * Fires the on-demand routing trigger for one confirmed interpretation
 * (`POST .../route`) and polls the fired workflow run
 * (`GET /admin/workflows/runs/:runId`) until it reaches a terminal state, then
 * reloads the routing ledger so the peek shows the real per-tenant outcome —
 * the "resolve now → route now" affordance #1701 was filed for. The run itself
 * goes through the real Workflow Engine (same m365_route_changes node the
 * nightly sweep runs); this function only fires it and watches it finish.
 */
export async function routeInterpretation(id: number): Promise<void> {
  if (!adminFetchRef) return;
  setRoutingRun(id, { status: "running", runId: null, error: null });
  try {
    const res = await adminFetchRef(`/api/admin/m365/interpretations/${id}/route`, { method: "POST" });
    if (!res.ok) {
      setRoutingRun(id, { status: "failed", runId: null, error: await failureOf(res) });
      return;
    }
    const body = (await res.json()) as { runId: number };
    setRoutingRun(id, { status: "running", runId: body.runId, error: null });
    await pollRoutingRun(id, body.runId, 0);
  } catch (err) {
    log.warn({ err, id }, "m365 route interpretation failed");
    setRoutingRun(id, { status: "failed", runId: null, error: errorText(err) });
  }
}

async function pollRoutingRun(id: number, runId: number, attempt: number): Promise<void> {
  if (!adminFetchRef) return;
  if (attempt >= ROUTING_POLL_MAX_ATTEMPTS) {
    setRoutingRun(id, { status: "failed", runId, error: "Routing run is taking longer than expected — check Workflow Engine run history." });
    return;
  }
  try {
    const res = await adminFetchRef(`/api/admin/workflows/runs/${runId}`);
    if (!res.ok) {
      setRoutingRun(id, { status: "failed", runId, error: await failureOf(res) });
      return;
    }
    const run = (await res.json()) as { status: string };
    if (run.status === "pending" || run.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, ROUTING_POLL_INTERVAL_MS));
      await pollRoutingRun(id, runId, attempt + 1);
      return;
    }
    if (run.status === "completed") {
      setRoutingRun(id, { status: "completed", runId, error: null });
      await loadRoutings(id, true);
      return;
    }
    setRoutingRun(id, { status: "failed", runId, error: `Routing run ${run.status}` });
  } catch (err) {
    log.warn({ err, id, runId }, "m365 routing run poll failed");
    setRoutingRun(id, { status: "failed", runId, error: errorText(err) });
  }
}

// ── Resolution (#1615) ───────────────────────────────────────────────────────

function setResolveRun(id: number, run: ResolveRunState): void {
  setState({ resolveRuns: { ...state.resolveRuns, [id]: run } });
}

// Not part of published state — same in-flight guard as routingsLoadInFlight,
// for the same reason: the peek resolver re-runs on every store notification.
const resolutionsLoadInFlight = new Set<number>();

export async function loadResolutions(id: number, force = false): Promise<void> {
  if (!adminFetchRef) return;
  if (!force && state.resolutionsByInterpretation[id]) return;
  if (resolutionsLoadInFlight.has(id)) return;
  resolutionsLoadInFlight.add(id);
  try {
    const res = await adminFetchRef(`/api/admin/m365/interpretations/${id}/resolutions`);
    if (!res.ok) return;
    const body = (await res.json()) as { resolutions: ResolutionOutcome[] };
    setState({ resolutionsByInterpretation: { ...state.resolutionsByInterpretation, [id]: body.resolutions ?? [] } });
  } catch (err) {
    log.warn({ err, id }, "m365 resolutions failed to load");
  } finally {
    resolutionsLoadInFlight.delete(id);
  }
}

/**
 * Fires the on-demand resolve for one confirmed interpretation
 * (`POST .../resolve`) — runs the count against the MSP's tenants right now —
 * then reloads the resolution ledger (`GET .../resolutions`) so the peek shows
 * the real per-tenant numbers. Unlike routing, resolve is a synchronous
 * request/response (no workflow run to poll): the endpoint itself runs the
 * count and returns before responding.
 */
export async function resolveInterpretation(id: number): Promise<void> {
  if (!adminFetchRef) return;
  setResolveRun(id, { status: "running", error: null });
  try {
    const res = await adminFetchRef(`/api/admin/m365/interpretations/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      setResolveRun(id, { status: "failed", error: await failureOf(res) });
      return;
    }
    setResolveRun(id, { status: "completed", error: null });
    await loadResolutions(id, true);
  } catch (err) {
    log.warn({ err, id }, "m365 resolve interpretation failed");
    setResolveRun(id, { status: "failed", error: errorText(err) });
  }
}

// ── Selectors ─────────────────────────────────────────────────────────────────

export function interpretationById(id: number): Interpretation | undefined {
  return state.interpretations.find((i) => i.id === id);
}

/** Test seam. */
export function resetM365ChangesStore(): void {
  listeners.clear();
  adminFetchRef = null;
  warmed = false;
  state = {
    interpretations: [],
    counts: EMPTY_COUNTS,
    loading: false,
    loaded: false,
    error: null,
    noMsp: false,
    candidatesLoading: false,
    candidatesLoaded: false,
    roadmapCandidates: [],
    messageCenterCandidates: [],
    proposing: false,
    proposalError: null,
    proposal: null,
    routingRuns: {},
    routingsByInterpretation: {},
    resolveRuns: {},
    resolutionsByInterpretation: {},
  };
}
