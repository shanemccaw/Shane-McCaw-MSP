/**
 * riskDecisionsStore.ts — the AdminV2 Risk-Based Decisions screen's state
 * (Git #1294).
 *
 * Plain external store (subscribe / getSnapshot), same shape as
 * retainerStore / contentStudioStore. Every figure shown is served by the API
 * (`routes/admin-rbd.ts`); the store never invents one.
 *
 * The linked-check catalog is read from the existing
 * `GET /api/msp/rbd/available-checks` — reused as-is per #1294 (PlatformAdmin
 * sessions reach it, and it carries no MSP scoping).
 */

import { logger } from "@/lib/logger";
import { pushUndo as _pushUndo } from "../../shell/undoStore";

const log = logger.child({ channel: "tenant.admin" });

const SCREEN_ID = "risk-decisions";

// ── Wire types (mirror routes/admin-rbd.ts) ─────────────────────────────────

export interface RbdCustomer {
  customerId: number;
  name: string;
  hasTenantIdentity: boolean;
  decisionCount: number;
  activeCount: number;
  linkedCount: number;
}

export type RbdStatus = "active" | "pending_signature" | "expired" | "revoked";
export type RawRiskLevel = "critical" | "high" | "medium";
export type ResidualRiskLevel = "high" | "medium" | "low";

export interface RiskDecision {
  id: number;
  rbdId: string;
  tenantName: string;
  title: string;
  controlViolated: string;
  framework: string;
  checkKey: string | null;
  rawRiskLevel: string;
  residualRiskLevel: string;
  rawRiskScore: number;
  residualRiskScore: number;
  liabilityValueUsd: number;
  hazardDescription: string;
  graphEndpoint: string;
  expirationDate: string;
  status: string;
  rationale: string | null;
  clientApproverName: string | null;
  createdAt: string;
}

export interface RbdDetail {
  customer: { customerId: number; name: string; primaryDomain: string };
  decisions: RiskDecision[];
}

/** One entry of the linked-check catalog. */
export interface AvailableCheck {
  key: string;
  label: string;
  description: string | null;
}

interface RbdState {
  customers: RbdCustomer[];
  customersLoading: boolean;
  customersLoaded: boolean;
  customersError: string | null;
  selectedCustomerId: number | null;
  detail: RbdDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  checks: AvailableCheck[];
  checksLoaded: boolean;
}

// ── Store plumbing ──────────────────────────────────────────────────────────

type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;
const listeners = new Set<Listener>();

let state: RbdState = {
  customers: [],
  customersLoading: false,
  customersLoaded: false,
  customersError: null,
  selectedCustomerId: null,
  detail: null,
  detailLoading: false,
  detailError: null,
  checks: [],
  checksLoaded: false,
};

function setState(patch: Partial<RbdState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getSnapshot(): RbdState {
  return state;
}

function pushUndo(entry: Parameters<typeof _pushUndo>[1]): void {
  _pushUndo(SCREEN_ID, entry);
}

export function configureRbdFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

let warmed = false;
export function warmRbd(): void {
  if (warmed || !adminFetchRef) return;
  warmed = true;
  void loadCustomers();
  void loadChecks();
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

export async function loadCustomers(force = false): Promise<void> {
  if (!adminFetchRef) return;
  if (!force && (state.customersLoading || state.customersLoaded)) return;
  setState({ customersLoading: true, customersError: null });
  try {
    const res = await adminFetchRef("/api/admin/rbd/customers");
    if (!res.ok) {
      setState({ customersLoading: false, customersError: await failureOf(res) });
      return;
    }
    const body = (await res.json()) as { customers: RbdCustomer[] };
    setState({ customersLoading: false, customersLoaded: true, customers: body.customers });
  } catch (err) {
    log.warn({ err }, "rbd customers failed to load");
    setState({ customersLoading: false, customersError: errorText(err) });
  }
}

/** The linked-check catalog — reused from the existing msp-rbd route. */
export async function loadChecks(): Promise<void> {
  if (!adminFetchRef || state.checksLoaded) return;
  try {
    const res = await adminFetchRef("/api/msp/rbd/available-checks");
    if (!res.ok) return;
    const checks = (await res.json()) as AvailableCheck[];
    setState({ checks, checksLoaded: true });
  } catch (err) {
    log.warn({ err }, "rbd available-checks failed to load");
  }
}

export async function loadDetail(customerId: number): Promise<void> {
  if (!adminFetchRef) return;
  setState({ detailLoading: true, detailError: null });
  try {
    const res = await adminFetchRef(`/api/admin/rbd/${customerId}`);
    if (!res.ok) {
      setState({ detailLoading: false, detailError: await failureOf(res) });
      return;
    }
    const detail = (await res.json()) as RbdDetail;
    setState({ detailLoading: false, detail });
  } catch (err) {
    log.warn({ err, customerId }, "rbd detail failed to load");
    setState({ detailLoading: false, detailError: errorText(err) });
  }
}

export function selectCustomer(customerId: number): void {
  setState({ selectedCustomerId: customerId, detail: null });
  void loadDetail(customerId);
}

/** Return to the customer picker without fetching anything. */
export function clearSelection(): void {
  setState({ selectedCustomerId: null, detail: null, detailError: null });
}

async function refreshAfterMutation(customerId: number): Promise<void> {
  await Promise.all([loadDetail(customerId), loadCustomers(true)]);
}

// ── Mutations ───────────────────────────────────────────────────────────────

export interface CreateRbdInput {
  title: string;
  controlViolated?: string;
  framework?: string;
  hazardDescription?: string;
  checkKey?: string | null;
  rawRiskLevel?: RawRiskLevel;
  residualRiskLevel?: ResidualRiskLevel;
  rawRiskScore?: number;
  residualRiskScore?: number;
  liabilityValueUsd?: number;
  expirationDate?: string;
  status?: RbdStatus;
  rationale?: string | null;
}

export async function createDecision(customerId: number, input: CreateRbdInput): Promise<RiskDecision | null> {
  if (!adminFetchRef) return null;
  try {
    const res = await adminFetchRef(`/api/admin/rbd/${customerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      setState({ detailError: await failureOf(res) });
      return null;
    }
    const body = (await res.json()) as { decision: RiskDecision };
    await refreshAfterMutation(customerId);
    pushUndo({
      label: `Create "${input.title.slice(0, 40)}"`,
      // A created decision is reverted by revoking it — the table has no delete
      // route (revocation is the real lifecycle end), so undo mirrors that.
      revert: async () => { await updateDecision(customerId, body.decision.id, { status: "revoked" }, true); },
    });
    return body.decision;
  } catch (err) {
    log.warn({ err, customerId }, "create risk decision failed");
    setState({ detailError: errorText(err) });
    return null;
  }
}

export interface RbdPatch {
  title?: string;
  controlViolated?: string;
  framework?: string;
  hazardDescription?: string;
  checkKey?: string | null;
  rawRiskLevel?: RawRiskLevel;
  residualRiskLevel?: ResidualRiskLevel;
  rawRiskScore?: number;
  residualRiskScore?: number;
  liabilityValueUsd?: number;
  expirationDate?: string;
  status?: RbdStatus;
  rationale?: string | null;
}

export async function updateDecision(
  customerId: number,
  id: number,
  patch: RbdPatch,
  _skipUndo = false,
): Promise<void> {
  if (!adminFetchRef) return;
  const existing = state.detail?.decisions.find((d) => d.id === id);
  if (!_skipUndo && existing) {
    const prev: RbdPatch = {};
    if (patch.title !== undefined) prev.title = existing.title;
    if (patch.controlViolated !== undefined) prev.controlViolated = existing.controlViolated;
    if (patch.framework !== undefined) prev.framework = existing.framework;
    if (patch.hazardDescription !== undefined) prev.hazardDescription = existing.hazardDescription;
    if (patch.checkKey !== undefined) prev.checkKey = existing.checkKey;
    if (patch.rawRiskLevel !== undefined) prev.rawRiskLevel = existing.rawRiskLevel as RawRiskLevel;
    if (patch.residualRiskLevel !== undefined) prev.residualRiskLevel = existing.residualRiskLevel as ResidualRiskLevel;
    if (patch.rawRiskScore !== undefined) prev.rawRiskScore = existing.rawRiskScore;
    if (patch.residualRiskScore !== undefined) prev.residualRiskScore = existing.residualRiskScore;
    if (patch.liabilityValueUsd !== undefined) prev.liabilityValueUsd = existing.liabilityValueUsd;
    if (patch.expirationDate !== undefined) prev.expirationDate = existing.expirationDate;
    if (patch.status !== undefined) prev.status = existing.status as RbdStatus;
    if (patch.rationale !== undefined) prev.rationale = existing.rationale;
    pushUndo({
      label: `Edit "${existing.title.slice(0, 40)}"`,
      revert: async () => { await updateDecision(customerId, id, prev, true); },
    });
  }
  try {
    const res = await adminFetchRef(`/api/admin/rbd/entry/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setState({ detailError: await failureOf(res) });
      return;
    }
    await refreshAfterMutation(customerId);
  } catch (err) {
    log.warn({ err, customerId, id }, "update risk decision failed");
    setState({ detailError: errorText(err) });
  }
}

// ── Derived / selectors ──────────────────────────────────────────────────────

export function decisionById(id: number): RiskDecision | undefined {
  return state.detail?.decisions.find((d) => d.id === id);
}

/** A human label for a check key, resolved from the loaded catalog. */
export function checkLabel(key: string | null): string | null {
  if (!key) return null;
  return state.checks.find((c) => c.key === key)?.label ?? key;
}

/** Total active, linked decisions across every customer — an answer figure. */
export function totalLinkedActive(): number {
  return state.customers.reduce((sum, c) => sum + c.linkedCount, 0);
}

/** Test seam. */
export function resetRbdStore(): void {
  listeners.clear();
  adminFetchRef = null;
  warmed = false;
  state = {
    customers: [],
    customersLoading: false,
    customersLoaded: false,
    customersError: null,
    selectedCustomerId: null,
    detail: null,
    detailLoading: false,
    detailError: null,
    checks: [],
    checksLoaded: false,
  };
}
