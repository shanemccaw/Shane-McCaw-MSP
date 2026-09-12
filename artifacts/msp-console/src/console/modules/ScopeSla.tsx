/**
 * ScopeSla — MSP Console module page (Git #2656, Feature #2572). Mounts into the
 * shell's `ScreenSlot` at `/ops/sla` (MSP-wide, not per-tenant —
 * `Design/MSP_Console/design_handoff_msp_console/Scope and SLA.dc.html`, README
 * screen 30), wiring the real, live, previously-unwired backend documented at
 * `docs/msp-console/scope-and-sla-msp-console-contract-pack.md` and
 * `@/api/scope-sla-api` (read that file's header first — it records every honest
 * departure from the design's fixture-driven mock in one place; this file does not
 * repeat them).
 *
 * Five tabs, faithful to the design's own logic class where the real backend
 * covers it: Needs an operator (the virtual `/msp/operator-tasks` queue), Clocks
 * (`/msp/sla/timers` + `/msp/sla/summary`), Scope (`/msp/scope-creep/detections` +
 * `/violations`), Policies (both engines' policy CRUD, copy-on-write), History
 * (both engines' monthly compliance records, joined client-side by customer+month
 * for the combined table the design renders).
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon, type IconName } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import type { DirectoryCustomer } from "@/api/console-api";
import {
  ScopeSlaApiError,
  useDeactivateScopeCreepPolicy,
  useDeactivateSlaPolicy,
  useEscalateScopeCreepViolation,
  useEvaluateScopeCreepForCustomer,
  useEvaluateSlaForMsp,
  useOperatorTasks,
  usePatchScopeCreepPolicy,
  usePatchSlaPolicy,
  useResolveScopeCreepViolation,
  useResolveSlaTimer,
  useScopeCreepCompliance,
  useScopeCreepDetections,
  useScopeCreepPolicies,
  useScopeCreepViolations,
  useSlaCompliance,
  useSlaPolicies,
  useSlaSummary,
  useSlaTimers,
  type OperatorTask,
  type ScopeCreepDetection,
  type ScopeCreepEngineOutput,
  type ScopeCreepPolicy,
  type ScopeCreepViolation,
  type SlaEngineOutput,
  type SlaPolicy,
  type SlaTimer,
} from "@/api/scope-sla-api";

type Tab = "queue" | "timers" | "scope" | "policies" | "compliance";
type TimerFilter = "all" | "running" | "warning" | "breached" | "stopped";
type ScopeFilter = "open" | "acknowledged" | "all";
type PolicyFilter = "all" | "sla" | "scope";
type ToneKind = "green" | "amber" | "red" | "blue" | "violet" | "slate";

const TONE: Record<ToneKind, { color: string; tint: string; line: string }> = {
  green: { color: signal.ok.text, tint: signal.ok.tint, line: signal.ok.border },
  amber: { color: signal.warning.text, tint: signal.warning.tint, line: signal.warning.border },
  red: { color: signal.critical.text, tint: signal.critical.tint, line: signal.critical.border },
  blue: { color: signal.info.text, tint: signal.info.tint, line: signal.info.border },
  violet: { color: "#c4b5fd", tint: signal.notice.tint, line: signal.notice.border },
  slate: { color: text.muted, tint: signal.neutral.tint, line: signal.neutral.border },
};

const SEVERITY_TONE: Record<string, ToneKind> = { critical: "red", high: "amber", medium: "blue", low: "slate" };
const TIMER_TONE: Record<string, [ToneKind, IconName, string]> = {
  running: ["green", "timer", "running"],
  warning: ["amber", "triangle-alert", "close to breach"],
  breached: ["red", "circle-x", "breached"],
  stopped: ["slate", "square", "stopped"],
  paused: ["slate", "pause", "paused"],
};
const DETECTION_KIND: Record<string, [ToneKind, string]> = {
  drift: ["blue", "drift"],
  expansion: ["violet", "extra work"],
  timeline_slip: ["amber", "running late"],
};
const DETECTION_STATUS_TONE: Record<string, [ToneKind, string]> = {
  open: ["red", "open"],
  acknowledged: ["amber", "seen"],
  resolved: ["slate", "closed"],
};

function dur(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function nameFor(customers: DirectoryCustomer[], id: number | null | undefined): string {
  if (id == null) return "Unknown customer";
  return customers.find((c) => c.id === id)?.name ?? `Customer #${id}`;
}

function deriveScopeSeverity(compositeScore: number): "critical" | "high" | "medium" | "low" {
  // Real bands, matching scope-creep-engine.ts's own deriveSeverity() exactly
  // (contract pack §3): >=85 critical, >=65 high, >=40 medium, else low.
  if (compositeScore >= 85) return "critical";
  if (compositeScore >= 65) return "high";
  if (compositeScore >= 40) return "medium";
  return "low";
}

function Pill({ label, tone: t }: { label: string; tone: { color: string; tint: string; line: string } }) {
  return (
    <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 999, background: t.tint, border: `1px solid ${t.line}`, fontSize: 10.5, fontWeight: 600, color: t.color, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 28, padding: "0 10px", borderRadius: 7,
        border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
        background: active ? "rgba(37,99,235,.18)" : "transparent",
        color: active ? "#bfdbfe" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

function ErrorPanel({ err, wire }: { err: unknown; wire: string }) {
  const status = err instanceof ScopeSlaApiError ? err.status : null;
  const message = err instanceof Error ? err.message : "The request failed.";
  return (
    <div style={{ border: `1px solid ${status === 403 ? signal.critical.border : signal.warning.border}`, borderRadius: 12, background: surface.card, padding: 22, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
      <Icon name={status === 403 ? "shield-alert" : "triangle-alert"} size={20} color={status === 403 ? signal.critical.strong : signal.warning.strong} />
      <span style={{ fontSize: 15, fontWeight: 700, color: text.title }}>{status === 403 ? "Not authorized" : "Could not load"}</span>
      <span style={{ fontSize: 12.5, color: text.muted }}>{message}</span>
      <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.faint }}>{wire}</span>
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: "44px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
      <span style={{ width: 40, height: 40, borderRadius: 12, background: signal.info.tint, border: `1px solid ${signal.info.border}`, color: signal.info.strong, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={19} />
      </span>
      <span style={{ fontSize: 15, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>{title}</span>
      <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 420, textWrap: "pretty" }}>{body}</span>
    </div>
  );
}

export function ScopeSla({
  customers,
  onOpenTenant,
}: {
  customers: DirectoryCustomer[];
  onOpenTenant: (customerId: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("queue");
  const [timerFilter, setTimerFilter] = useState<TimerFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("open");
  const [policyFilter, setPolicyFilter] = useState<PolicyFilter>("all");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [evalOpen, setEvalOpen] = useState(false);

  const summaryQuery = useSlaSummary();
  const tasksQuery = useOperatorTasks();
  const timersQuery = useSlaTimers();
  const detectionsQuery = useScopeCreepDetections();
  const violationsQuery = useScopeCreepViolations();
  const slaPoliciesQuery = useSlaPolicies();
  const scopePoliciesQuery = useScopeCreepPolicies();
  const slaComplianceQuery = useSlaCompliance();
  const scopeComplianceQuery = useScopeCreepCompliance();

  const tasks = tasksQuery.data?.tasks ?? [];
  const timers = timersQuery.data?.timers ?? [];
  const detections = detectionsQuery.data ?? [];
  const violations = violationsQuery.data?.violations ?? [];
  const slaPolicies = slaPoliciesQuery.data?.policies ?? [];
  const scopePolicies = scopePoliciesQuery.data?.policies ?? [];
  const slaCompliance = slaComplianceQuery.data?.records ?? [];
  const scopeCompliance = scopeComplianceQuery.data?.records ?? [];

  const openDetectionsCount = detections.filter((d) => d.status === "open").length;
  const policyCount = slaPolicies.length + scopePolicies.length;
  const complianceRowCount = useMemo(() => mergeCompliance(slaCompliance, scopeCompliance).length, [slaCompliance, scopeCompliance]);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "queue", label: "Needs an operator", count: tasks.length },
    { id: "timers", label: "Clocks", count: timers.length },
    { id: "scope", label: "Scope", count: openDetectionsCount },
    { id: "policies", label: "Policies", count: policyCount },
    { id: "compliance", label: "History", count: complianceRowCount },
  ];

  const activeTask = taskId ? tasks.find((t) => t.id === taskId) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 7,
                border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
                background: active ? "rgba(37,99,235,.18)" : "transparent",
                color: active ? "#bfdbfe" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {t.label}
              <span style={{ fontSize: 10.5, color: active ? signal.info.strong : text.faint }}>{t.count}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 7, border: `1px solid ${border.card}`, background: "rgba(148,163,184,.06)", whiteSpace: "nowrap" }}>
          <Icon name="radio" size={12} color={text.muted} />
          <span style={{ fontSize: 11.5, fontWeight: 600, color: text.muted }}>Live updates idle</span>
        </div>
      </div>

      {tab === "queue" && (
        <QueueTab
          tasks={tasks}
          loading={tasksQuery.isLoading}
          error={tasksQuery.error}
          summary={summaryQuery.data}
          summaryError={summaryQuery.error}
          customers={customers}
          onOpenTask={setTaskId}
        />
      )}

      {tab === "timers" && (
        <TimersTab
          timers={timers}
          loading={timersQuery.isLoading}
          error={timersQuery.error}
          filter={timerFilter}
          onFilter={setTimerFilter}
          policies={slaPolicies}
          customers={customers}
        />
      )}

      {tab === "scope" && (
        <ScopeTab
          detections={detections}
          detectionsLoading={detectionsQuery.isLoading}
          detectionsError={detectionsQuery.error}
          violations={violations}
          violationsLoading={violationsQuery.isLoading}
          violationsError={violationsQuery.error}
          filter={scopeFilter}
          onFilter={setScopeFilter}
          customers={customers}
          onScoreCustomer={() => setEvalOpen(true)}
        />
      )}

      {tab === "policies" && (
        <PoliciesTab
          slaPolicies={slaPolicies}
          scopePolicies={scopePolicies}
          loading={slaPoliciesQuery.isLoading || scopePoliciesQuery.isLoading}
          error={slaPoliciesQuery.error ?? scopePoliciesQuery.error}
          filter={policyFilter}
          onFilter={setPolicyFilter}
        />
      )}

      {tab === "compliance" && (
        <ComplianceTab
          slaCompliance={slaCompliance}
          scopeCompliance={scopeCompliance}
          loading={slaComplianceQuery.isLoading || scopeComplianceQuery.isLoading}
          error={slaComplianceQuery.error ?? scopeComplianceQuery.error}
          customers={customers}
        />
      )}

      {evalOpen && (
        <EvaluateDrawer customers={customers} onClose={() => setEvalOpen(false)} />
      )}

      {activeTask && (
        <TaskDrawer
          task={activeTask}
          customers={customers}
          onClose={() => setTaskId(null)}
          onOpenTenant={(id) => { setTaskId(null); onOpenTenant(id); }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 2 }}>
        <Icon name="info" size={13} color={text.faint} />
        <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
          Scoring one customer on the scope side is a read unless "raise a violation" is ticked; the clock side has no
          per-customer score at all — only the whole book. Live updates are wired to a channel nothing currently
          broadcasts on, so this screen will not move on its own until that exists.
        </span>
      </div>
    </div>
  );
}

// ── Queue tab ──────────────────────────────────────────────────────────────────

function taskTone(task: OperatorTask): { color: string; tint: string; line: string } {
  if (task.type === "scope_creep_violation") return TONE[SEVERITY_TONE[task.severity] ?? "slate"];
  return TONE.red; // any unresolved SLA breach is, by definition, already over its threshold
}

function QueueTab({
  tasks, loading, error, summary, summaryError, customers, onOpenTask,
}: {
  tasks: OperatorTask[];
  loading: boolean;
  error: unknown;
  summary: { activeTimers: number; warningTimers: number; breachedTimers: number; avgCompliancePct: number | null } | undefined;
  summaryError: unknown;
  customers: DirectoryCustomer[];
  onOpenTask: (id: string) => void;
}) {
  const evaluateSla = useEvaluateSlaForMsp();
  const [slaResult, setSlaResult] = useState<SlaEngineOutput | null>(null);

  if (error) return <ErrorPanel err={error} wire="GET /api/msp/operator-tasks" />;

  const tiles = [
    { label: "CLOCKS RUNNING", value: summary ? String(summary.activeTimers) : "—", note: "Inside target and still ticking", color: signal.ok.text },
    { label: "CLOSE TO BREACH", value: summary ? String(summary.warningTimers) : "—", note: "Past the warning mark, not yet blown", color: summary && summary.warningTimers > 0 ? signal.warning.text : signal.ok.text },
    { label: "BREACHED", value: summary ? String(summary.breachedTimers) : "—", note: "Target missed and unresolved", color: summary && summary.breachedTimers > 0 ? signal.critical.text : signal.ok.text },
    { label: "SLA THIS QUARTER", value: summary?.avgCompliancePct == null ? "—" : `${summary.avgCompliancePct}%`, note: summary?.avgCompliancePct == null ? "Never computed — not zero" : "Across every month rolled up so far", color: summary?.avgCompliancePct == null ? text.faint : summary.avgCompliancePct >= 95 ? signal.ok.text : signal.warning.text },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        {tiles.map((c) => (
          <div key={c.label} style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 15, display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.label }}>{c.label}</span>
            <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", color: c.color }}>{c.value}</span>
            <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{c.note}</span>
          </div>
        ))}
      </div>
      {!!summaryError && <span style={{ fontSize: 11, color: signal.warning.text }}>SLA summary tiles could not load — GET /api/msp/sla/summary failed.</span>}

      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <button
          onClick={() => evaluateSla.mutate(undefined, { onSuccess: setSlaResult, onError: (e) => toast.error(e instanceof Error ? e.message : "SLA evaluation failed.") })}
          disabled={evaluateSla.isPending}
          title="There is no per-customer version of this on the clock side — it only ever scores the whole book"
          style={{ display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: 7, border: "1px solid rgba(96,165,250,.3)", background: "rgba(37,99,235,.14)", color: "#bfdbfe", fontSize: 11.5, fontWeight: 600, cursor: evaluateSla.isPending ? "wait" : "pointer", whiteSpace: "nowrap" }}
        >
          <Icon name="calculator" size={12} />
          {evaluateSla.isPending ? "Scoring…" : slaResult ? "Score again" : "Score the clocks across the book"}
        </button>
        <span style={{ fontSize: 11.5, color: slaResult ? signal.warning.text : text.label, textWrap: "pretty", flex: 1, minWidth: 200 }}>
          {slaResult
            ? `Book scored — ${slaResult.score}% across everyone. That covers every customer at once and cannot be pinned on any one of them.`
            : "Unlike the scope score, this one has no per-customer version — it reads the whole book and returns one number. It raises nothing either way."}
        </span>
      </div>

      {loading ? (
        <div style={{ fontSize: 11.5, color: text.muted }}>Loading the operator queue…</div>
      ) : tasks.length === 0 ? (
        <div style={{ border: `1px solid ${signal.ok.border}`, borderRadius: 12, background: signal.ok.tint, padding: "44px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <Icon name="circle-check-big" size={20} color={signal.ok.strong} />
          <span style={{ fontSize: 15, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>Nothing waiting on an operator</span>
          <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 420, textWrap: "pretty" }}>
            No unresolved breach and no open scope violation across the book. This queue is built from both engines, so
            an empty queue means both are quiet.
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {tasks.map((t) => {
            const tt = taskTone(t);
            const ageMin = (Date.now() - new Date(t.createdAt).getTime()) / 60_000;
            return (
              <div
                key={t.id}
                onClick={() => onOpenTask(t.id)}
                style={{ border: `1px solid ${t.type === "sla_breach" ? signal.critical.border : border.card}`, borderRadius: 11, background: surface.card, padding: 14, display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0, cursor: "pointer" }}
              >
                <span style={{ width: 30, height: 30, flex: "0 0 30px", borderRadius: 9, background: tt.tint, border: `1px solid ${tt.line}`, color: tt.color, padding: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name={t.type === "sla_breach" ? "timer" : "move-diagonal"} size={16} />
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: text.title, textWrap: "pretty" }}>{t.category}</span>
                    <Pill label={t.severity} tone={tt} />
                  </div>
                  <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{t.description}</span>
                  <span style={{ fontSize: 11, color: text.label }}>{t.customerName ?? nameFor(customers, t.customerId)}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end", flex: "0 0 auto" }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: ageMin > 240 ? signal.critical.text : text.muted, whiteSpace: "nowrap" }}>waiting {dur(ageMin)}</span>
                  <Pill label={t.type === "sla_breach" ? "clock" : "scope"} tone={TONE.slate} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Timers tab ──────────────────────────────────────────────────────────────────

function TimersTab({
  timers, loading, error, filter, onFilter, policies, customers,
}: {
  timers: SlaTimer[];
  loading: boolean;
  error: unknown;
  filter: TimerFilter;
  onFilter: (f: TimerFilter) => void;
  policies: SlaPolicy[];
  customers: DirectoryCustomer[];
}) {
  const resolve = useResolveSlaTimer();

  if (error) return <ErrorPanel err={error} wire="GET /api/msp/sla/timers" />;
  if (loading) return <div style={{ fontSize: 11.5, color: text.muted }}>Loading SLA clocks…</div>;

  const visible = filter === "all" ? timers : timers.filter((t) => t.status === filter);
  const filters: { id: TimerFilter; label: string }[] = [
    { id: "all", label: "All clocks" },
    { id: "running", label: "running" },
    { id: "warning", label: "close to breach" },
    { id: "breached", label: "breached" },
    { id: "stopped", label: "stopped" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        {filters.map((f) => <FilterChip key={f.id} label={f.label} active={filter === f.id} onClick={() => onFilter(f.id)} />)}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: text.label, whiteSpace: "nowrap" }}>{visible.length} of {timers.length} clocks</span>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="timer-off"
          title={timers.length === 0 ? "No clock has ever started" : "None in that state"}
          body={timers.length === 0
            ? "A clock starts when a ticket or a signal opens against a policy. None has started for anyone in the book yet."
            : "Clocks move between states on their own as time passes — this filter will fill as they do."}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {visible.map((t) => {
            const [toneKind, icon, label] = TIMER_TONE[t.status] ?? TIMER_TONE.stopped;
            const tt = TONE[toneKind];
            const policy = policies.find((p) => p.id === t.policyId);
            const targetMin = policy ? (t.phase === "response" ? policy.responseTimeMinutes : policy.resolutionTimeMinutes) : null;
            const elapsedMin = (Date.now() - new Date(t.startedAt).getTime()) / 60_000;
            const pct = targetMin ? Math.min(100, Math.round((elapsedMin / targetMin) * 100)) : null;
            const over = targetMin != null && elapsedMin > targetMin;
            const live = t.status === "running" || t.status === "warning";
            const canResolve = live || t.status === "breached";
            return (
              <div key={t.timerId} style={{ border: `1px solid ${t.status === "breached" ? signal.critical.border : t.status === "warning" ? signal.warning.border : border.card}`, borderRadius: 11, background: surface.card, padding: 14, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: tt.tint, border: `1px solid ${tt.line}`, fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", color: tt.color, whiteSpace: "nowrap" }}>
                    <Icon name={icon} size={11} />
                    {label}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: text.title, textWrap: "pretty", minWidth: 0 }}>
                    {nameFor(customers, t.customerId)} — {t.ticketType === "signal_compliance" ? "Signal compliance" : (t.ticketRef ?? "Ticket")}
                  </span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 11.5, color: text.muted, whiteSpace: "nowrap" }}>{t.phase === "response" ? "first response" : "resolution"}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ height: 5, borderRadius: 999, background: "rgba(148,163,184,.14)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct ?? 0}%`, background: tt.color }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11.5, color: text.secondary, whiteSpace: "nowrap" }}>{dur(elapsedMin)} elapsed</span>
                    <span style={{ fontSize: 11.5, color: text.label, whiteSpace: "nowrap" }}>{targetMin != null ? `target ${dur(targetMin)}` : "no matching policy on file"}</span>
                    <div style={{ flex: 1 }} />
                    {targetMin != null && (
                      <span style={{ fontSize: 11.5, color: over ? signal.critical.text : (pct ?? 0) > 75 ? signal.warning.text : signal.ok.text, whiteSpace: "nowrap" }}>
                        {over ? `${dur(elapsedMin - targetMin)} over` : `${dur(targetMin - elapsedMin)} left`}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: text.label }}>{t.ticketType === "signal_compliance" ? "Counted in the signal half of the score" : "Counted in the ticket half of the score"}</span>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={() => resolve.mutate({ timerId: t.timerId }, { onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to stop the clock.") })}
                    disabled={!canResolve || resolve.isPending}
                    title={canResolve ? "Stopping records who stopped it and when" : "Only a running, warned or breached clock can be stopped"}
                    style={{ height: 28, padding: "0 11px", borderRadius: 7, border: `1px solid ${canResolve ? "rgba(96,165,250,.3)" : border.card}`, background: canResolve ? "rgba(37,99,235,.14)" : "transparent", color: canResolve ? "#bfdbfe" : text.faint, fontSize: 11.5, fontWeight: 600, cursor: canResolve ? "pointer" : "not-allowed", opacity: canResolve ? 1 : 0.6, whiteSpace: "nowrap" }}
                  >
                    {t.status === "stopped" ? "Stopped" : "Stop the clock"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Scope tab ────────────────────────────────────────────────────────────────

function ScopeTab({
  detections, detectionsLoading, detectionsError, violations, violationsLoading, violationsError, filter, onFilter, customers, onScoreCustomer,
}: {
  detections: ScopeCreepDetection[];
  detectionsLoading: boolean;
  detectionsError: unknown;
  violations: ScopeCreepViolation[];
  violationsLoading: boolean;
  violationsError: unknown;
  filter: ScopeFilter;
  onFilter: (f: ScopeFilter) => void;
  customers: DirectoryCustomer[];
  onScoreCustomer: () => void;
}) {
  const resolveViolation = useResolveScopeCreepViolation();
  const escalate = useEscalateScopeCreepViolation();
  const [escalated, setEscalated] = useState<Record<string, boolean>>({});

  if (detectionsError) return <ErrorPanel err={detectionsError} wire="GET /api/msp/scope-creep/detections" />;

  const visible = filter === "all" ? detections : detections.filter((d) => d.status === filter);
  const openViolations = violations.filter((v) => !v.resolvedAt);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <FilterChip label="Open" active={filter === "open"} onClick={() => onFilter("open")} />
        <FilterChip label="Seen" active={filter === "acknowledged"} onClick={() => onFilter("acknowledged")} />
        <FilterChip label="All" active={filter === "all"} onClick={() => onFilter("all")} />
        <div style={{ flex: 1 }} />
        <button
          onClick={onScoreCustomer}
          style={{ display: "flex", alignItems: "center", gap: 7, height: 28, padding: "0 11px", borderRadius: 7, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
        >
          <Icon name="calculator" size={12} />
          Score a customer
        </button>
      </div>

      {detectionsLoading ? (
        <div style={{ fontSize: 11.5, color: text.muted }}>Loading scope detections…</div>
      ) : (
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflowX: "auto" }}>
          <div style={{ minWidth: 1020 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1.2fr 1fr 1.5fr 1fr 1.2fr", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.soft}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
              <span>CUSTOMER</span><span>KIND</span><span>OVER BY</span><span>WHAT DRIFTED</span><span>STATE</span><span>FOUND</span>
            </div>
            {visible.length === 0 ? (
              <div style={{ padding: "24px 16px", fontSize: 12, color: text.muted }}>Nothing matches this filter.</div>
            ) : visible.map((d) => {
              const [kindTone, kindLabel] = DETECTION_KIND[d.detectionType] ?? ["slate", d.detectionType];
              const [statusTone, statusLabel] = DETECTION_STATUS_TONE[d.status] ?? ["slate", d.status];
              const kt = TONE[kindTone], st = TONE[statusTone];
              const over = d.changePct != null ? `${Math.round(d.changePct)}%` : "—";
              const what = d.ref ?? (d.baselineValue != null && d.currentValue != null ? `${d.currentValue} vs baseline ${d.baselineValue}` : "No detail recorded");
              return (
                <div key={d.detectionId} style={{ display: "grid", gridTemplateColumns: "1.6fr 1.2fr 1fr 1.5fr 1fr 1.2fr", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${border.faint}` }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: text.title, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nameFor(customers, d.customerId)}</span>
                  <Pill label={kindLabel} tone={kt} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: (d.changePct ?? 0) >= 20 ? signal.critical.text : signal.warning.text, whiteSpace: "nowrap" }}>{over}</span>
                  <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>{what}</span>
                  <Pill label={statusLabel} tone={st} />
                  <span style={{ fontSize: 12, color: text.muted, whiteSpace: "nowrap" }}>{formatDate(d.detectedAt)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>VIOLATIONS RAISED FROM THESE</span>
        {violationsError ? (
          <ErrorPanel err={violationsError} wire="GET /api/msp/scope-creep/violations" />
        ) : violationsLoading ? (
          <div style={{ fontSize: 11.5, color: text.muted }}>Loading violations…</div>
        ) : openViolations.length === 0 ? (
          <span style={{ fontSize: 12, color: text.muted }}>No open violations right now.</span>
        ) : openViolations.map((v) => {
          const tt = TONE[SEVERITY_TONE[v.severity] ?? "slate"];
          const esc = !!escalated[v.violationId];
          return (
            <div key={v.violationId} style={{ border: `1px solid ${v.severity === "critical" ? signal.critical.border : border.card}`, borderRadius: 11, background: surface.card, padding: "13px 14px", display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
              <span style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 11, background: tt.tint, border: `1px solid ${tt.line}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: tt.color }}>{Math.round(v.compositeScore)}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: text.title, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nameFor(customers, v.customerId)}</span>
                  <Pill label={v.severity} tone={tt} />
                </div>
                <span style={{ fontSize: 11.5, color: text.muted }}>Composite score {v.compositeScore} against a threshold of {v.threshold}.</span>
                <span style={{ fontSize: 11, color: text.label }}>Raised {formatDateTime(v.createdAt)}{esc ? " · escalated just now" : ""}</span>
              </div>
              <div style={{ display: "flex", gap: 7, flex: "0 0 auto", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  onClick={() => escalate.mutate({ violationId: v.violationId, customerId: v.customerId }, {
                    onSuccess: () => setEscalated((p) => ({ ...p, [v.violationId]: true })),
                    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to escalate."),
                  })}
                  disabled={esc || escalate.isPending}
                  title="Adds a level to this violation for someone else to pick up"
                  style={{ height: 28, padding: "0 10px", borderRadius: 7, border: `1px solid ${border.soft}`, background: "transparent", color: esc ? text.faint : text.secondary, fontSize: 11.5, fontWeight: 600, cursor: esc ? "not-allowed" : "pointer", opacity: esc ? 0.6 : 1, whiteSpace: "nowrap" }}
                >
                  {esc ? "Escalated" : "Escalate"}
                </button>
                <button
                  onClick={() => resolveViolation.mutate({ violationId: v.violationId }, { onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to resolve.") })}
                  disabled={resolveViolation.isPending}
                  title="Closes this violation and every escalation hanging off it in one move"
                  style={{ height: 28, padding: "0 10px", borderRadius: 7, border: `1px solid ${signal.ok.border}`, background: signal.ok.tint, color: signal.ok.text, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  Resolve
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Policies tab ──────────────────────────────────────────────────────────────

type UnifiedPolicy =
  | { engine: "sla"; policy: SlaPolicy }
  | { engine: "scope"; policy: ScopeCreepPolicy };

function PoliciesTab({
  slaPolicies, scopePolicies, loading, error, filter, onFilter,
}: {
  slaPolicies: SlaPolicy[];
  scopePolicies: ScopeCreepPolicy[];
  loading: boolean;
  error: unknown;
  filter: PolicyFilter;
  onFilter: (f: PolicyFilter) => void;
}) {
  const patchSla = usePatchSlaPolicy();
  const deactivateSla = useDeactivateSlaPolicy();
  const patchScope = usePatchScopeCreepPolicy();
  const deactivateScope = useDeactivateScopeCreepPolicy();

  if (error) return <ErrorPanel err={error} wire="GET /api/msp/sla/policies · GET /api/msp/scope-creep/policies" />;
  if (loading) return <div style={{ fontSize: 11.5, color: text.muted }}>Loading policies…</div>;

  const unified: UnifiedPolicy[] = [
    ...slaPolicies.map((policy): UnifiedPolicy => ({ engine: "sla", policy })),
    ...scopePolicies.map((policy): UnifiedPolicy => ({ engine: "scope", policy })),
  ];
  const visible = filter === "all" ? unified : unified.filter((u) => u.engine === filter);

  const makeCopyOrEdit = (u: UnifiedPolicy) => {
    const mutate = u.engine === "sla" ? patchSla.mutate : patchScope.mutate;
    mutate({ id: u.policy.id }, {
      onSuccess: (res) => toast.success(res.override ? "Created your own copy of this policy." : "Policy saved."),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save the policy."),
    });
  };
  const toggle = (u: UnifiedPolicy) => {
    if (u.policy.isActive) {
      if (u.policy.mspId === null) {
        const mutate = u.engine === "sla" ? deactivateSla.mutate : deactivateScope.mutate;
        mutate(u.policy.id, { onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to switch off.") });
      } else {
        const mutate = u.engine === "sla" ? patchSla.mutate : patchScope.mutate;
        mutate({ id: u.policy.id, body: { isActive: false } }, { onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to switch off.") });
      }
    } else {
      const mutate = u.engine === "sla" ? patchSla.mutate : patchScope.mutate;
      mutate({ id: u.policy.id, body: { isActive: true } }, { onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to switch on.") });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <FilterChip label="Both engines" active={filter === "all"} onClick={() => onFilter("all")} />
        <FilterChip label="Clocks" active={filter === "sla"} onClick={() => onFilter("sla")} />
        <FilterChip label="Scope" active={filter === "scope"} onClick={() => onFilter("scope")} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {visible.length === 0 ? (
          <span style={{ fontSize: 12, color: text.muted }}>No policies on file for this filter.</span>
        ) : visible.map((u) => {
          const isGlobal = u.policy.mspId === null;
          const tt = TONE[!u.policy.isActive ? "slate" : isGlobal ? "blue" : "violet"];
          const thresholds: { label: string; value: string }[] = u.engine === "sla"
            ? [
                { label: "RESPOND", value: dur(u.policy.responseTimeMinutes) },
                { label: "RESOLVE", value: dur(u.policy.resolutionTimeMinutes) },
                { label: "WARN AT", value: `${u.policy.warningThresholdPct}%` },
              ]
            : [
                { label: "DRIFT", value: `${u.policy.driftThresholdPct}% over` },
                { label: "EXPANSION", value: `${u.policy.expansionThresholdPct}% over` },
                { label: "SLIP", value: `${u.policy.timelineSlipDays} days` },
              ];
          return (
            <div key={`${u.engine}-${u.policy.id}`} style={{ border: `1px solid ${!u.policy.isActive ? border.faint : border.card}`, borderRadius: 11, background: surface.card, padding: 14, display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
              <span style={{ width: 30, height: 30, flex: "0 0 30px", borderRadius: 9, background: tt.tint, border: `1px solid ${tt.line}`, color: tt.color, padding: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={u.engine === "sla" ? "timer" : "move-diagonal"} size={16} />
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: text.title, textWrap: "pretty" }}>{u.policy.name}</span>
                  <Pill label={isGlobal ? "shared default" : "yours"} tone={tt} />
                  {!u.policy.isActive && <Pill label="switched off" tone={TONE.slate} />}
                </div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  {thresholds.map((th) => (
                    <span key={th.label} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{th.label}</span>
                      <span style={{ fontSize: 12.5, color: text.secondary, whiteSpace: "nowrap" }}>{th.value}</span>
                    </span>
                  ))}
                </div>
                {u.policy.description && <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{u.policy.description}</span>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: "0 0 auto" }}>
                <button
                  onClick={() => makeCopyOrEdit(u)}
                  title={isGlobal ? "Leaves the shared default alone and gives you your own to change" : "Changes your own copy in place"}
                  style={{ height: 28, padding: "0 10px", borderRadius: 7, border: "1px solid rgba(96,165,250,.3)", background: "rgba(37,99,235,.14)", color: "#bfdbfe", fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {isGlobal ? "Make my copy" : "Edit"}
                </button>
                <button
                  onClick={() => toggle(u)}
                  title={isGlobal && u.policy.isActive ? "Switching off a shared default gives you an off copy — the default stays on for everyone else" : ""}
                  style={{ height: 28, padding: "0 10px", borderRadius: 7, border: `1px solid ${border.soft}`, background: "transparent", color: text.secondary, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {u.policy.isActive ? "Switch off" : "Switch on"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
        Editing a shared default does not change it for anyone else — it creates your own copy and leaves the original
        alone. Switching your copy off is the same move: the shared default stays where it was.
      </span>
    </div>
  );
}

// ── Compliance ("History") tab ──────────────────────────────────────────────

interface MergedComplianceRow {
  key: string;
  month: string;
  customerId: number;
  sla: number | null;
  scope: number | null;
  notes: string[];
}

function mergeCompliance(
  slaRecords: { customerId: number; periodStart: string; compliancePct: number; notes: string | null }[],
  scopeRecords: { customerId: number; periodStart: string; compliancePct: number; notes: string | null }[],
): MergedComplianceRow[] {
  const map = new Map<string, MergedComplianceRow>();
  const monthKey = (iso: string) => iso.slice(0, 7);
  for (const r of slaRecords) {
    const key = `${r.customerId}:${monthKey(r.periodStart)}`;
    const row = map.get(key) ?? { key, month: r.periodStart, customerId: r.customerId, sla: null, scope: null, notes: [] };
    row.sla = r.compliancePct;
    if (r.notes) row.notes.push(r.notes);
    map.set(key, row);
  }
  for (const r of scopeRecords) {
    const key = `${r.customerId}:${monthKey(r.periodStart)}`;
    const row = map.get(key) ?? { key, month: r.periodStart, customerId: r.customerId, sla: null, scope: null, notes: [] };
    row.scope = r.compliancePct;
    if (r.notes) row.notes.push(r.notes);
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.month.localeCompare(a.month));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, v) => a + v, 0) / values.length) * 10) / 10;
}

function ComplianceTab({
  slaCompliance, scopeCompliance, loading, error, customers,
}: {
  slaCompliance: { customerId: number; periodStart: string; compliancePct: number; notes: string | null }[];
  scopeCompliance: { customerId: number; periodStart: string; compliancePct: number; notes: string | null }[];
  loading: boolean;
  error: unknown;
  customers: DirectoryCustomer[];
}) {
  if (error) return <ErrorPanel err={error} wire="GET /api/msp/sla/compliance · GET /api/msp/scope-creep/compliance" />;
  if (loading) return <div style={{ fontSize: 11.5, color: text.muted }}>Loading compliance history…</div>;

  const rows = mergeCompliance(slaCompliance, scopeCompliance);
  const avgSla = average(slaCompliance.map((r) => r.compliancePct));
  const avgScope = average(scopeCompliance.map((r) => r.compliancePct));

  const tiles = [
    { label: "SLA, AVERAGED", value: avgSla == null ? "—" : `${avgSla}%`, note: avgSla == null ? "Never computed" : "Across every rolled-up month", color: avgSla == null ? text.faint : avgSla >= 95 ? signal.ok.text : signal.warning.text },
    { label: "SCOPE, AVERAGED", value: avgScope == null ? "—" : `${avgScope}%`, note: avgScope == null ? "Never computed" : "Monthly roll-up uses a different formula than the live score", color: avgScope == null ? text.faint : avgScope >= 80 ? signal.ok.text : signal.warning.text },
    { label: "MONTHS ON RECORD", value: String(rows.length), note: "Written by a nightly roll-up, not by anything on this screen", color: text.title },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        {tiles.map((c) => (
          <div key={c.label} style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 15, display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.label }}>{c.label}</span>
            <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", color: c.color }}>{c.value}</span>
            <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{c.note}</span>
          </div>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon="chart-no-axes-column" title="Never computed" body="No month has been rolled up yet. That is different from a month that scored zero, and it reads as blank here rather than as 0%." />
      ) : (
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflowX: "auto" }}>
          <div style={{ minWidth: 820 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.8fr 1.2fr 1.2fr 1.4fr", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.soft}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
              <span>MONTH</span><span>CUSTOMER</span><span>SLA</span><span>SCOPE</span><span>WHAT MOVED IT</span>
            </div>
            {rows.map((r) => (
              <div key={r.key} style={{ display: "grid", gridTemplateColumns: "1.2fr 1.8fr 1.2fr 1.2fr 1.4fr", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${border.faint}` }}>
                <span style={{ fontSize: 12, color: text.muted, whiteSpace: "nowrap" }}>{formatDate(r.month)}</span>
                <span style={{ fontSize: 12.5, color: text.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nameFor(customers, r.customerId)}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: r.sla == null ? text.faint : r.sla >= 95 ? signal.ok.text : r.sla >= 85 ? signal.warning.text : signal.critical.text, whiteSpace: "nowrap" }}>{r.sla == null ? "—" : `${r.sla}%`}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: r.scope == null ? text.faint : r.scope >= 80 ? signal.ok.text : r.scope >= 60 ? signal.warning.text : signal.critical.text, whiteSpace: "nowrap" }}>{r.scope == null ? "—" : `${r.scope}%`}</span>
                <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{r.notes.length > 0 ? r.notes.join(" · ") : "No notes recorded for this period."}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Score-a-customer drawer ────────────────────────────────────────────────────

function EvaluateDrawer({ customers, onClose }: { customers: DirectoryCustomer[]; onClose: () => void }) {
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [fire, setFire] = useState(false);
  const evaluate = useEvaluateScopeCreepForCustomer();
  const result: ScopeCreepEngineOutput | undefined = evaluate.data;

  const picked = customerId != null ? customers.find((c) => c.id === customerId) ?? null : null;
  const run = () => {
    if (customerId == null) return;
    evaluate.mutate({ customerId, autoFireViolations: fire }, {
      onError: (e) => toast.error(e instanceof Error ? e.message : "Scope creep evaluation failed."),
    });
  };

  const verdict = result ? deriveScopeSeverity(result.score.compositeScore) : null;
  const fired = result?.autoFired?.find((a) => a.violationId && !a.belowThreshold);
  const resNote = !result
    ? ""
    : fire
      ? (fired ? `A violation was raised against ${picked?.name ?? "this customer"} because this crossed their policy threshold.` : "Nothing was raised — the score did not cross any policy's threshold this time.")
      : "Nothing was raised. This was a read of where they stand right now.";
  const resTone = verdict ? TONE[SEVERITY_TONE[verdict] ?? "slate"] : TONE.slate;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(460px,94%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.soft}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.info.text }}>SCORE A CUSTOMER</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>Run the scope score now</span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "none", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>Which customer</span>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {customers.length === 0 ? (
              <span style={{ fontSize: 11.5, color: text.muted }}>No customers in this MSP's book yet.</span>
            ) : customers.map((c) => {
              const isPicked = customerId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => { setCustomerId(c.id); evaluate.reset(); }}
                  style={{ height: 30, padding: "0 11px", borderRadius: 7, border: `1px solid ${isPicked ? "rgba(96,165,250,.32)" : border.card}`, background: isPicked ? "rgba(37,99,235,.18)" : "transparent", color: isPicked ? "#bfdbfe" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>
            One customer at a time, by design. There is no "score the whole book" here — a portfolio number cannot be
            pinned on anyone.
          </span>
        </div>

        <button
          onClick={() => setFire((v) => !v)}
          style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: 12, borderRadius: 10, border: `1px solid ${fire ? signal.warning.border : border.card}`, background: fire ? signal.warning.tint : "rgba(2,6,23,.4)", cursor: "pointer", textAlign: "left", minWidth: 0 }}
        >
          <Icon name={fire ? "square-check-big" : "square"} size={16} color={fire ? signal.warning.text : text.label} style={{ marginTop: 1, flex: "0 0 16px" }} />
          <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: text.title }}>Raise a violation if it breaches</span>
            <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
              Off by default. On, a score over the policy threshold writes a real violation and its escalations against
              this customer — visible to them, and it will not quietly undo itself.
            </span>
          </span>
        </button>

        {result && (
          <div style={{ border: `1px solid ${resTone.line}`, borderRadius: 11, background: resTone.tint, padding: 14, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", color: resTone.color }}>{Math.round(result.score.compositeScore)}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: text.title, textTransform: "capitalize" }}>{verdict}</span>
                <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{resNote}</span>
              </div>
            </div>
            {[
              { label: "Drift", value: result.score.driftScore, color: signal.warning.text },
              { label: "Extra work", value: result.score.expansionScore, color: "#c4b5fd" },
              { label: "Running late", value: result.score.timelineSlipScore, color: signal.critical.text },
            ].map((b) => (
              <div key={b.label} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                  <span style={{ fontSize: 11.5, color: text.secondary, flex: 1, minWidth: 0 }}>{b.label}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: b.color, whiteSpace: "nowrap" }}>{Math.round(b.value)} of 100</span>
                </div>
                <div style={{ height: 4, borderRadius: 999, background: "rgba(148,163,184,.14)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, Math.round(b.value))}%`, background: b.color }} />
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
          <button
            onClick={run}
            disabled={customerId == null || evaluate.isPending}
            title={customerId == null ? "Pick a customer first" : ""}
            style={{ flex: 1, height: 38, borderRadius: 8, border: `1px solid ${customerId != null ? "#2563eb" : border.card}`, background: customerId != null ? "#2563eb" : "transparent", color: customerId != null ? "#fff" : text.faint, fontSize: 13, fontWeight: 600, cursor: customerId == null || evaluate.isPending ? "not-allowed" : "pointer", opacity: customerId == null ? 0.6 : 1 }}
          >
            {evaluate.isPending ? "Scoring…" : result ? "Score again" : "Run the score"}
          </button>
          <button onClick={onClose} style={{ height: 38, padding: "0 15px", borderRadius: 8, border: `1px solid ${border.soft}`, background: "transparent", color: text.secondary, fontSize: 13, cursor: "pointer" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Task detail drawer ────────────────────────────────────────────────────────

function TaskDrawer({
  task, customers, onClose, onOpenTenant,
}: {
  task: OperatorTask;
  customers: DirectoryCustomer[];
  onClose: () => void;
  onOpenTenant: (customerId: number) => void;
}) {
  const resolveViolation = useResolveScopeCreepViolation();
  const resolveTimer = useResolveSlaTimer();
  const tt = taskTone(task);
  const ageMin = (Date.now() - new Date(task.createdAt).getTime()) / 60_000;

  const facts = [
    { label: "CUSTOMER", value: task.customerName ?? nameFor(customers, task.customerId), color: text.secondary },
    { label: "CATEGORY", value: task.category, color: tt.color },
    { label: "WAITING", value: dur(ageMin), color: ageMin > 240 ? signal.critical.text : text.secondary },
    { label: "RAISED", value: formatDateTime(task.createdAt), color: text.muted },
  ];

  const canResolveTimer = task.type === "sla_breach" && task.timerId != null;
  const primaryLabel = task.type === "scope_creep_violation"
    ? "Resolve the violation"
    : canResolveTimer ? "Stop the clock" : "Open in Admin Panel";
  const primaryIcon: IconName = task.type === "scope_creep_violation" || canResolveTimer ? "check" : "external-link";
  const runPrimary = () => {
    if (task.type === "scope_creep_violation") {
      resolveViolation.mutate({ violationId: task.id }, {
        onSuccess: onClose,
        onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to resolve."),
      });
    } else if (canResolveTimer) {
      resolveTimer.mutate({ timerId: task.timerId! }, {
        onSuccess: onClose,
        onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to stop the clock."),
      });
    } else {
      window.open(task.deepLink, "_blank", "noopener,noreferrer");
    }
  };
  const note = task.type === "scope_creep_violation"
    ? "Resolving closes every escalation hanging off this violation too."
    : canResolveTimer
      ? "Stopping the clock records this queue as who resolved it and when."
      : "This console can't stop the specific clock behind this breach from a queue task alone — open it in Admin Panel to resolve the underlying timer.";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(470px,94%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.soft}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: tt.color }}>{task.type === "sla_breach" ? "SLA BREACH" : "SCOPE VIOLATION"}</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>{task.category}</span>
            <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>{task.description}</span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "none", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 11 }}>
          {facts.map((f) => (
            <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{f.label}</span>
              <span style={{ fontSize: 12.5, color: f.color, textWrap: "pretty" }}>{f.value}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={runPrimary}
              disabled={resolveViolation.isPending || resolveTimer.isPending}
              style={{ display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 12px", borderRadius: 8, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              <Icon name={primaryIcon} size={13} />
              {primaryLabel}
            </button>
            {task.customerId != null && (
              <button
                onClick={() => onOpenTenant(task.customerId!)}
                style={{ display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 12px", borderRadius: 8, border: `1px solid ${border.soft}`, background: "transparent", color: text.secondary, fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                <Icon name="arrow-right" size={13} />
                Open the customer
              </button>
            )}
          </div>
          <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>{note}</span>
        </div>
      </div>
    </div>
  );
}
