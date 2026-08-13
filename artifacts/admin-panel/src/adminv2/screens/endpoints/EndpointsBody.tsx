/**
 * M365 Endpoints — the centre column, and the loop `handoff.md` section 6 names
 * as the point of the whole screen:
 *
 *   run -> browse what came back -> click a value -> get a rule
 *
 * The failure it fixes, in the user's own words: *"I can see the field but
 * there's no path from that to a rule, so I write SQL instead."* Everything
 * below is arranged so that path is never more than one click long, and so the
 * screen never claims something it has not actually asked the server.
 *
 * Three places where this deliberately departs from the prototype, each because
 * the prototype's version would lie:
 *
 * 1. **"Would this fire?" comes from the trace route.** The design ships its own
 *    evaluator (`epEval`) over an invented `when` string. The platform's rules
 *    are `signal_derivation_rules` rows (`ruleType` + `sourceKey` +
 *    `compareValue`), evaluated by `evaluateRule`, and the trace route re-runs
 *    that real evaluation — plus the real `applyMapping` — against the response
 *    the run already captured, issuing no network call. A second client-side
 *    evaluator would drift, and `monitor-check-trace.ts` says outright that a
 *    trace disagreeing with production is worse than no trace.
 * 2. **The one-click candidates are the server's inferences.** The design offers
 *    `> 0` / `> current` / `> half` for any number. `inferSuggestion` reads the
 *    key's NAME as well as its value and states a direction with a rationale —
 *    a protective count gets `is fewer than`, because `> n` on
 *    `conditionalAccessPolicyCount` can only ever fire on tenants that are
 *    already well configured. That rationale is shown verbatim.
 * 3. **There is no 1–10 weight.** `monitor_checks` has no weight column; the
 *    prototype's weight bar was invented. What a check actually feeds — its
 *    packages, its engines, its pillar and the rules that read it — is real and
 *    is shown instead.
 */

import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ACCENT, ACCENT_TEXT, FONT, LINE, PRIMARY, SURFACE, TEXT, WASH } from "../../theme";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import {
  cancelDraft,
  draftFromKey,
  draftNeedsNewSignal,
  getSnapshot,
  overrideFor,
  packagesForCheck,
  reEvaluate,
  removeRule,
  resetOverride,
  runCheck,
  runnability,
  saveDraft,
  saveMapping,
  saveOverrideToCatalog,
  selectCheck,
  selectedCheck,
  setOverride,
  setShowRaw,
  setTenant,
  setView,
  stopPolling,
  subscribe,
  tryCandidateMapping,
  updateDraft,
  type EndpointsState,
  type EndpointView,
} from "./endpointsStore";
import {
  RULE_TYPES,
  SEVERITIES,
  displayValue,
  effectiveFilter,
  effectiveMethod,
  fieldsFromItems,
  hasOverride,
  pillarOf,
  requestUrlFor,
  resolveRuleVerdicts,
  ruleTypeLabel,
  ruleTypeNeedsValue,
  selectedFields,
  typeOf,
  verdictLabel,
  type MappingRule,
  type MonitorCheck,
  type RequestOverride,
  type TracedKey,
  type Verdict,
} from "./endpointsTypes";

const VIEWS: Array<{ key: EndpointView; label: string }> = [
  { key: "run", label: "Run it" },
  { key: "mapping", label: "Mapping" },
  { key: "rules", label: "Rules" },
];

/** The type badge's colour, from the design's `tone` map. */
const TYPE_TONE: Record<string, string> = {
  number: ACCENT.amber,
  string: ACCENT.green,
  boolean: "#bea4e8",
  array: ACCENT.info,
  object: ACCENT.info,
  null: TEXT.caption,
  undefined: TEXT.caption,
};

const VERDICT_TONE: Record<Verdict, string> = {
  fires: ACCENT.amber,
  quiet: TEXT.metaAlt,
  "cannot-read": ACCENT.danger,
};

export function EndpointsBody({ recordId }: { recordId?: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  // The open doc is the source of truth for which endpoint this is. Adopting it
  // here rather than in `render(ctx)` keeps the store write out of the shell's
  // render pass — `selectCheck` is synchronous, and the Explorer and Properties
  // panels are separate subscribers that must not be updated mid-render.
  useEffect(() => {
    if (recordId && getSnapshot().selectedKey !== recordId) selectCheck(recordId, pillarOf);
  }, [recordId]);

  // A run polls on a timer; leaving the screen has to stop it, or a screen that
  // is no longer mounted keeps calling the server until the run lands.
  useEffect(() => stopPolling, []);

  const check = selectedCheck(state);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <Header state={state} check={check} />
      {!check ? (
        <Empty state={state} />
      ) : (
        <>
          <RequestBar state={state} check={check} />
          <RunBar state={state} />
          {state.view === "run" && <RunView state={state} check={check} />}
          {state.view === "mapping" && <MappingView state={state} check={check} />}
          {state.view === "rules" && <RulesView state={state} check={check} />}
        </>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function Header({ state, check }: { state: EndpointsState; check: MonitorCheck | null }) {
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "11px 18px",
        borderBottom: `1px solid ${LINE.base}`,
        background: SURFACE.chrome,
      }}
    >
      <span style={{ flex: "none", fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: TEXT.primary }}>
        {check ? check.label : "M365 Endpoints"}
      </span>
      {check && (
        <span
          style={{
            flex: "none",
            padding: "2px 8px",
            borderRadius: 999,
            border: `1px solid ${LINE.strong}`,
            fontFamily: FONT.mono,
            fontSize: 10,
            color: TEXT.dimmer,
          }}
          title="The check key. Its prefix is the domain, and the domain is the taxonomy — monitor_checks has no category column."
        >
          {check.key}
        </span>
      )}
      {check && (
        <span style={{ flex: "none", fontSize: 11, color: TEXT.caption }}>{pillarOf(check.key)} pillar</span>
      )}
      {state.message && (
        <span
          style={{
            flex: "0 1 auto",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 11.5,
            color: ACCENT_TEXT.green,
          }}
        >
          {state.message}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 4 }} />
      {check
        && VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            style={{
              flex: "none",
              whiteSpace: "nowrap",
              padding: "4px 11px",
              borderRadius: 11,
              border: `1px solid ${state.view === v.key ? "rgba(255,255,255,.28)" : LINE.control}`,
              background: state.view === v.key ? WASH.hover : "transparent",
              color: state.view === v.key ? TEXT.primary : TEXT.dimmer,
              fontFamily: "inherit",
              fontSize: 11.5,
              cursor: "pointer",
            }}
          >
            {v.label}
          </button>
        ))}
    </div>
  );
}

function Empty({ state }: { state: EndpointsState }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 30 }}>
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <span style={{ display: "block", fontSize: 13, color: TEXT.soft, lineHeight: 1.6 }}>
          Pick an endpoint on the left.
        </span>
        <span style={{ display: "block", marginTop: 8, fontSize: 11.5, color: TEXT.faint, lineHeight: 1.6 }}>
          {state.checksLoading
            ? "Reading the catalog…"
            : state.checksError
              ? state.checksError
              : `${state.checks.length} endpoint${state.checks.length === 1 ? "" : "s"} are defined. Run one against a tenant, click a value it produced, and write a rule about it — the rule is measured against the response already in front of you, without calling the tenant again.`}
        </span>
      </div>
    </div>
  );
}

// ── Request ───────────────────────────────────────────────────────────────────

function RequestBar({ state, check }: { state: EndpointsState; check: MonitorCheck }) {
  const o: RequestOverride | undefined = overrideFor(check.key, state);
  const dirty = hasOverride(o);
  const { canRun, hasRequest, why } = runnability(check);
  const running = state.run?.status === "pending" || state.run?.status === "running";
  const tenant = state.tenants.find((t) => t.id === state.tenantId) ?? null;
  const url = requestUrlFor(check, o);

  const fields = useMemo(() => {
    const fromResponse = fieldsFromItems(state.items);
    const asked = selectedFields(check, o);
    return [...new Set([...asked, ...fromResponse])].sort();
  }, [state.items, check, o]);
  const asked = new Set(selectedFields(check, o));

  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 16px",
        borderBottom: `1px solid ${LINE.quiet}`,
        background: SURFACE.inset,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        {hasRequest ? (
          <>
            <button
              onClick={() => setOverride(check.key, { method: effectiveMethod(check, o) === "GET" ? "POST" : "GET" })}
              title="Switch the verb this endpoint is called with"
              style={{
                flex: "none",
                whiteSpace: "nowrap",
                padding: "3px 9px",
                borderRadius: 5,
                border: `1px solid rgba(127,180,216,.3)`,
                fontFamily: FONT.mono,
                fontSize: 10.5,
                fontWeight: 700,
                background: "rgba(127,180,216,.14)",
                color: ACCENT.info,
                cursor: "pointer",
              }}
            >
              {effectiveMethod(check, o)}
            </button>
            <input
              value={o?.endpoint !== undefined ? o.endpoint : check.endpoint}
              onChange={(e) => setOverride(check.key, { endpoint: e.target.value })}
              spellCheck={false}
              aria-label="Endpoint path"
              style={{
                flex: "1 1 220px",
                minWidth: 120,
                height: 28,
                padding: "0 10px",
                borderRadius: 5,
                border: `1px solid ${dirty ? "rgba(242,202,99,.4)" : LINE.control}`,
                background: SURFACE.root,
                color: TEXT.strong,
                outline: "none",
                fontFamily: FONT.mono,
                fontSize: 11.5,
              }}
            />
          </>
        ) : (
          <span style={{ flex: "1 1 220px", minWidth: 120, fontSize: 11.5, lineHeight: 1.5, color: TEXT.groupLabel }}>
            {why}
          </span>
        )}
        {dirty && (
          <>
            <span
              style={{
                flex: "none",
                whiteSpace: "nowrap",
                padding: "2px 8px",
                borderRadius: 999,
                background: WASH.context,
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: ACCENT.amber,
              }}
            >
              overridden
            </span>
            <QuietButton onClick={() => resetOverride(check.key)}>Reset</QuietButton>
            <QuietButton
              onClick={() => void saveOverrideToCatalog(check.key)}
              title="Write this request into the catalog. Every package that runs this check will ask for it."
            >
              Save to the catalog
            </QuietButton>
          </>
        )}
        <select
          value={state.tenantId ?? ""}
          onChange={(e) => setTenant(e.target.value === "" ? null : Number(e.target.value))}
          aria-label="Tenant to run against"
          style={{
            flex: "none",
            maxWidth: 220,
            height: 28,
            padding: "0 8px",
            borderRadius: 5,
            border: `1px solid ${LINE.control}`,
            background: SURFACE.root,
            color: TEXT.strong,
            fontFamily: "inherit",
            fontSize: 11.5,
          }}
        >
          <option value="">Pick a tenant…</option>
          {state.tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => void runCheck()}
          disabled={!canRun || running || state.tenantId == null}
          title={why ?? (state.tenantId == null ? "Pick a tenant first" : "Issues a real Graph request against this tenant")}
          style={{
            flex: "none",
            whiteSpace: "nowrap",
            padding: "6px 14px",
            borderRadius: 5,
            border: 0,
            background: running || !canRun || state.tenantId == null ? LINE.control : PRIMARY,
            color: "#fff",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 600,
            cursor: canRun && !running && state.tenantId != null ? "pointer" : "default",
          }}
        >
          {running ? "Calling…" : tenant ? `Run against ${tenant.name}` : "Run it"}
        </button>
      </div>

      {hasRequest ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{ flex: "none", whiteSpace: "nowrap", fontFamily: FONT.mono, fontSize: 10.5, color: TEXT.faintest }}>
              $select
            </span>
            {fields.length === 0 ? (
              <span style={{ fontSize: 10.5, color: TEXT.faint }}>
                everything — run it once and the fields it returns become pickable here
              </span>
            ) : (
              fields.map((f) => (
                <button
                  key={f}
                  onClick={() => {
                    const next = asked.has(f) ? [...asked].filter((x) => x !== f) : [...asked, f];
                    setOverride(check.key, { selectParams: next.length ? next.join(",") : null });
                  }}
                  style={{
                    flex: "none",
                    whiteSpace: "nowrap",
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: `1px solid ${asked.has(f) ? "rgba(127,180,216,.45)" : LINE.control}`,
                    background: asked.has(f) ? "rgba(127,180,216,.12)" : "transparent",
                    color: asked.has(f) ? ACCENT.info : TEXT.dimmer,
                    fontFamily: FONT.mono,
                    fontSize: 10.5,
                    cursor: "pointer",
                  }}
                >
                  {f}
                </button>
              ))
            )}
            {asked.size > 0 && (
              <QuietButton onClick={() => setOverride(check.key, { selectParams: null })}>ask for everything</QuietButton>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{ flex: "none", whiteSpace: "nowrap", fontFamily: FONT.mono, fontSize: 10.5, color: TEXT.faintest }}>
              $filter
            </span>
            <input
              value={effectiveFilter(check, o) ?? ""}
              onChange={(e) => setOverride(check.key, { filterParams: e.target.value === "" ? null : e.target.value })}
              placeholder="none — the whole tenant"
              spellCheck={false}
              aria-label="OData filter"
              style={{
                flex: "1 1 160px",
                minWidth: 100,
                height: 26,
                padding: "0 9px",
                borderRadius: 5,
                border: `1px solid ${LINE.control}`,
                background: SURFACE.root,
                color: TEXT.strong,
                outline: "none",
                fontFamily: FONT.mono,
                fontSize: 11,
              }}
            />
          </div>

          <span
            style={{ fontFamily: FONT.mono, fontSize: 10.5, color: TEXT.faint, wordBreak: "break-all", lineHeight: 1.5 }}
            title="What the executor will build from the endpoint plus $select and $filter — the columns replace their inline namesakes rather than being added twice"
          >
            {effectiveMethod(check, o)} {url}
          </span>
        </>
      ) : null}
    </div>
  );
}

function QuietButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "3px 10px",
        borderRadius: 5,
        border: `1px solid ${LINE.control}`,
        background: "transparent",
        color: TEXT.caption,
        fontFamily: "inherit",
        fontSize: 10.5,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// ── Run bar ───────────────────────────────────────────────────────────────────

function RunBar({ state }: { state: EndpointsState }) {
  const run = state.run;
  if (!run && !state.runError) return null;

  const running = run?.status === "pending" || run?.status === "running";
  const failed = run?.status === "failed" || !!state.runError;
  const result = run?.result;

  const text = state.runError
    ? state.runError
    : failed
      ? (result?.errorMessage ?? run?.error ?? "The run failed.")
      : running
        ? (run?.statusText ?? "Calling…")
        : `${result?.status ?? "done"} · ${result?.itemCount ?? 0} item${result?.itemCount === 1 ? "" : "s"}`
          + (result?.pageCount && result.pageCount > 1 ? ` over ${result.pageCount} pages` : "")
          + (result?.severityMatched ? ` · matched ${result.severityMatched}` : "");

  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 16px",
        borderBottom: `1px solid ${LINE.quiet}`,
        background: failed ? "#2e1c1c" : running ? "#2a2415" : "#14301f",
      }}
    >
      <span
        style={{
          flex: "none",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: failed ? ACCENT.danger : running ? ACCENT.amber : ACCENT.greenBright,
        }}
      />
      <span style={{ flex: "0 1 auto", minWidth: 0, fontSize: 11.5, color: TEXT.body, lineHeight: 1.5 }}>{text}</span>
      <div style={{ flex: 1, minWidth: 4 }} />
      {result?.severityLabel && (
        <span style={{ flex: "0 1 auto", minWidth: 0, fontSize: 11, color: ACCENT.amber, textAlign: "right" }}>
          {result.severityLabel}
        </span>
      )}
      <span style={{ flex: "none", whiteSpace: "nowrap", fontFamily: FONT.mono, fontSize: 11.5, color: TEXT.caption }}>
        {state.elapsedMs ? `${state.elapsedMs} ms` : ""}
      </span>
    </div>
  );
}

// ── Run view ──────────────────────────────────────────────────────────────────

function RunView({ state, check }: { state: EndpointsState; check: MonitorCheck }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>
      <div style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", borderRight: `1px solid ${LINE.quiet}` }}>
        <WhatCameBack state={state} />
      </div>
      <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column" }}>
        {state.draft && <RuleBuilder state={state} />}
        <LiveRules state={state} check={check} />
      </div>
    </div>
  );
}

function WhatCameBack({ state }: { state: EndpointsState }) {
  const keys = state.trace?.keys ?? [];

  return (
    <>
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 9,
          flexWrap: "wrap",
          padding: "8px 14px",
          borderBottom: `1px solid ${LINE.subtle}`,
        }}
      >
        <Eyebrow>What came back</Eyebrow>
        <div style={{ flex: 1, minWidth: 4 }} />
        <MiniTab on={!state.showRaw} onClick={() => setShowRaw(false)}>
          Properties
        </MiniTab>
        <MiniTab on={state.showRaw} onClick={() => setShowRaw(true)}>
          Raw JSON
        </MiniTab>
      </div>

      {state.showRaw ? (
        <pre
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            margin: 0,
            padding: "12px 14px",
            fontFamily: FONT.mono,
            fontSize: 11,
            lineHeight: 1.65,
            color: ACCENT_TEXT.neutral,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {state.items
            ? JSON.stringify(state.items, null, 2)
            : (state.itemsError ?? "Run it to see what the tenant actually returned.")}
        </pre>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <span style={{ display: "block", padding: "9px 14px 5px", fontSize: 11, lineHeight: 1.5, color: TEXT.faintest }}>
            {keys.length
              ? "These are the keys the mapping produced. Click one to write a rule about it."
              : state.traceError
                ? state.traceError
                : "Run it. What appears here is what the real mapping produced from the real response — not the raw fields."}
          </span>
          {keys.map((k) => (
            <KeyRow key={k.key} node={k} state={state} />
          ))}
        </div>
      )}
    </>
  );
}

function KeyRow({ node, state }: { node: TracedKey; state: EndpointsState }) {
  const t = typeOf(node.value);
  const tone = TYPE_TONE[t] ?? TEXT.caption;
  const picked = state.draft?.sourceKey === node.key || (node.origin === "itemCount" && state.draft?.ruleType === "threshold");
  const firing = node.rules.filter((r) => r.result).length;
  const { menu, open, close } = useContextMenu();
  const startDraft = () => draftFromKey(node.key, node.suggestion, state.selectedKey ?? "");

  return (
    <>
    <div
      role="button"
      tabIndex={0}
      onClick={startDraft}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          startDraft();
        }
      }}
      onContextMenu={(e) =>
        open(
          e,
          [
            { label: "New rule from this value", onSelect: startDraft },
            { label: "Copy key", onSelect: () => navigator.clipboard?.writeText(node.key) },
            { label: "Copy value", onSelect: () => navigator.clipboard?.writeText(displayValue(node.value)) },
          ],
          `Actions for ${node.key}`,
        )
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "7px 14px",
        cursor: "pointer",
        borderBottom: `1px solid #232323`,
        borderLeft: `2px solid ${picked ? ACCENT.amber : "transparent"}`,
        background: picked ? "rgba(242,202,99,.09)" : "transparent",
      }}
    >
      <span
        style={{
          flex: "none",
          minWidth: 44,
          textAlign: "center",
          whiteSpace: "nowrap",
          padding: "2px 6px",
          borderRadius: 4,
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: ".05em",
          textTransform: "uppercase",
          background: `${tone}1e`,
          color: tone,
        }}
      >
        {t}
      </span>
      <span style={{ flex: "1 1 130px", minWidth: 88, fontFamily: FONT.mono, fontSize: 11.5, lineHeight: 1.4, wordBreak: "break-all", color: TEXT.strong }}>
        {node.key}
      </span>
      <span
        style={{
          flex: "0 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: FONT.mono,
          fontSize: 11.5,
          fontWeight: 700,
          color: tone,
        }}
      >
        {displayValue(node.value)}
      </span>
      <span
        style={{
          flex: "none",
          whiteSpace: "nowrap",
          fontSize: 10,
          fontWeight: 700,
          color: node.uncovered ? ACCENT.amber : firing ? ACCENT.amber : TEXT.metaAlt,
        }}
        title={
          node.uncovered
            ? "No rule reads this key, so nothing this value does can ever raise a finding."
            : `${node.rules.length} rule${node.rules.length === 1 ? "" : "s"} read this key`
        }
      >
        {node.uncovered ? "+ rule" : firing ? `${firing} firing` : `${node.rules.length} read it`}
      </span>
    </div>
    <ContextMenu menu={menu} onClose={close} />
    </>
  );
}

// ── Rule builder ──────────────────────────────────────────────────────────────

function RuleBuilder({ state }: { state: EndpointsState }) {
  const draft = state.draft!;
  const needsNewSignal = draftNeedsNewSignal(state);
  const needsValue = ruleTypeNeedsValue(draft.ruleType);

  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        flexDirection: "column",
        gap: 9,
        padding: "12px 14px",
        borderBottom: `1px solid ${LINE.quiet}`,
        background: "rgba(242,202,99,.05)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Eyebrow color={ACCENT.amber}>New rule</Eyebrow>
        <div style={{ flex: 1, minWidth: 4 }} />
        <span style={{ fontSize: 10.5, color: TEXT.caption }}>
          it will be checked against this response the moment you save it
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span
          style={{
            flex: "1 1 130px",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            padding: "0 9px",
            height: 29,
            lineHeight: "29px",
            borderRadius: 5,
            border: `1px solid ${LINE.control}`,
            background: SURFACE.root,
            fontFamily: FONT.mono,
            fontSize: 11.5,
            color: ACCENT.info,
          }}
        >
          {draft.sourceKey}
        </span>
        <select
          value={draft.ruleType}
          onChange={(e) => updateDraft({ ruleType: e.target.value })}
          aria-label="How to compare it"
          style={fieldStyle(150)}
        >
          {RULE_TYPES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        {needsValue && (
          <input
            value={draft.compareValue}
            onChange={(e) => updateDraft({ compareValue: e.target.value })}
            aria-label="Compare value"
            style={{ ...fieldStyle(100), fontFamily: FONT.mono }}
          />
        )}
      </div>

      <span style={{ fontSize: 11, lineHeight: 1.55, color: TEXT.groupLabel }}>
        {RULE_TYPES.find((r) => r.value === draft.ruleType)?.hint}
      </span>

      {draft.from && (
        <div
          style={{
            padding: "9px 11px",
            borderRadius: 7,
            border: `1px solid ${LINE.quiet}`,
            background: SURFACE.card,
          }}
        >
          <span style={{ display: "block", fontSize: 9.5, fontWeight: 800, letterSpacing: ".11em", textTransform: "uppercase", color: TEXT.metaAlt }}>
            Why this direction
          </span>
          <span style={{ display: "block", marginTop: 5, fontSize: 11, lineHeight: 1.6, color: TEXT.groupLabel }}>
            {draft.from.rationale}
          </span>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ flex: "none", fontSize: 10.5, color: TEXT.caption }}>writes to</span>
        <input
          value={draft.signalKey}
          onChange={(e) => updateDraft({ signalKey: e.target.value })}
          list="adminv2-endpoint-signals"
          placeholder="signal key"
          aria-label="Signal this rule writes to"
          style={{ ...fieldStyle(220), fontFamily: FONT.mono }}
        />
        <datalist id="adminv2-endpoint-signals">
          {state.signals.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </datalist>
        {SEVERITIES.map((sev) => (
          <button
            key={sev}
            onClick={() => updateDraft({ severity: sev })}
            style={{
              flex: "none",
              whiteSpace: "nowrap",
              padding: "4px 10px",
              borderRadius: 10,
              border: `1px solid ${draft.severity === sev ? "rgba(242,202,99,.4)" : LINE.control}`,
              background: draft.severity === sev ? WASH.context : "transparent",
              color: draft.severity === sev ? ACCENT.amber : TEXT.metaAlt,
              fontFamily: "inherit",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".04em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {sev}
          </button>
        ))}
      </div>

      {needsNewSignal && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, lineHeight: 1.55, color: ACCENT.amber }}>
            No signal is catalogued under that key. Name it and say what it means, and it is registered in the same write
            as the rule — a rule against an uncatalogued signal fires here and is invisible to real dashboard scoring.
          </span>
          <input
            value={draft.newSignalLabel}
            onChange={(e) => updateDraft({ newSignalLabel: e.target.value })}
            placeholder="What this signal is called"
            aria-label="New signal label"
            style={fieldStyle(260)}
          />
          <input
            value={draft.newSignalDescription}
            onChange={(e) => updateDraft({ newSignalDescription: e.target.value })}
            placeholder="What it means when it fires"
            aria-label="New signal description"
            style={fieldStyle(320)}
          />
        </div>
      )}

      <input
        value={draft.description}
        onChange={(e) => updateDraft({ description: e.target.value })}
        placeholder="Why this matters, in your words"
        aria-label="Rule description"
        style={{ ...fieldStyle(320), width: "100%" }}
      />

      {state.saveError && (
        <span style={{ fontSize: 11, lineHeight: 1.55, color: ACCENT.danger }}>{state.saveError}</span>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 4 }} />
        <QuietButton onClick={cancelDraft}>Cancel</QuietButton>
        <button
          onClick={() => void saveDraft()}
          disabled={state.saving}
          style={{
            flex: "none",
            whiteSpace: "nowrap",
            padding: "5px 13px",
            borderRadius: 5,
            border: 0,
            background: state.saving ? LINE.control : PRIMARY,
            color: "#fff",
            fontFamily: "inherit",
            fontSize: 11.5,
            fontWeight: 600,
            cursor: state.saving ? "default" : "pointer",
          }}
        >
          {state.saving ? "Saving…" : "Add the rule"}
        </button>
      </div>
    </div>
  );
}

function fieldStyle(width: number): CSSProperties {
  return {
    flex: `0 1 ${width}px`,
    minWidth: 80,
    height: 29,
    padding: "0 9px",
    borderRadius: 5,
    border: `1px solid ${LINE.control}`,
    background: SURFACE.root,
    color: TEXT.strong,
    outline: "none",
    fontFamily: "inherit",
    fontSize: 11.5,
  };
}

// ── Live rules ────────────────────────────────────────────────────────────────

function LiveRules({ state, check }: { state: EndpointsState; check: MonitorCheck }) {
  const resolved = resolveRuleVerdicts(state.rules, state.trace);
  const firing = resolved.filter((r) => r.verdict === "fires").length;
  const blind = resolved.filter((r) => r.verdict === "cannot-read").length;

  return (
    <>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 9, padding: "8px 14px", borderBottom: `1px solid ${LINE.subtle}` }}>
        <Eyebrow>Rules against this result</Eyebrow>
        <div style={{ flex: 1, minWidth: 4 }} />
        {state.run?.status === "completed" && (
          <QuietButton onClick={() => void reEvaluate()} title="Re-run the rules against the response already captured. No tenant is called.">
            Re-evaluate
          </QuietButton>
        )}
        <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 10.5, fontWeight: 700, color: firing ? ACCENT.amber : TEXT.metaAlt }}>
          {firing ? `${firing} firing` : "none firing"}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px 14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        {blind > 0 && state.trace && (
          <span style={{ fontSize: 11, lineHeight: 1.55, color: ACCENT.danger }}>
            {blind} rule{blind === 1 ? "" : "s"} read a key this response does not produce. {blind === 1 ? "It" : "They"} can
            never fire, whatever the tenant does.
          </span>
        )}
        {state.rulesError && <span style={{ fontSize: 11.5, color: ACCENT.danger }}>{state.rulesError}</span>}
        {resolved.length === 0 && (
          <span style={{ fontSize: 11.5, lineHeight: 1.5, color: TEXT.faintest }}>
            No rule reads {check.label}. Nothing it returns can raise a finding until one does — run it and click a value on
            the left to write the first.
          </span>
        )}
        {resolved.map((r) => (
          <RuleResultRow key={r.rule.id} resolved={r} state={state} />
        ))}
      </div>
    </>
  );
}

function RuleResultRow({
  resolved: { rule, verdict, reason, producedValue },
  state,
}: {
  resolved: ReturnType<typeof resolveRuleVerdicts>[number];
  state: EndpointsState;
}) {
  const { menu, open, close } = useContextMenu();
  const conditionText = `${rule.sourceKey} ${ruleTypeLabel(rule.ruleType)}${
    ruleTypeNeedsValue(rule.ruleType) ? ` ${rule.compareValue ?? ""}` : ""
  }`;

  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        border: `1px solid ${verdict === "fires" ? "rgba(242,202,99,.3)" : verdict === "cannot-read" ? "rgba(229,122,122,.3)" : LINE.quiet}`,
        background: verdict === "fires" ? "rgba(242,202,99,.05)" : SURFACE.card,
      }}
      onContextMenu={(e) =>
        open(
          e,
          [
            { label: "Copy condition", onSelect: () => navigator.clipboard?.writeText(conditionText) },
            { label: "Copy signal key", onSelect: () => navigator.clipboard?.writeText(rule.signalKey) },
            { label: "Delete rule", danger: true, onSelect: () => void removeRule(rule.id) },
          ],
          `Actions for ${conditionText}`,
        )
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            flex: "none",
            minWidth: 60,
            textAlign: "center",
            whiteSpace: "nowrap",
            padding: "3px 8px",
            borderRadius: 5,
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            background: verdict === "quiet" ? WASH.hoverSoft : `${VERDICT_TONE[verdict]}26`,
            color: VERDICT_TONE[verdict],
          }}
        >
          {verdictLabel(verdict)}
        </span>
        <span style={{ flex: "1 1 130px", minWidth: 0, fontFamily: FONT.mono, fontSize: 11.5, color: TEXT.strong, wordBreak: "break-all" }}>
          {conditionText}
        </span>
        <button
          onClick={() => void removeRule(rule.id)}
          title="Delete this rule"
          aria-label={`Delete rule ${rule.id}`}
          style={{
            flex: "none",
            width: 22,
            height: 22,
            borderRadius: 4,
            border: `1px solid ${LINE.control}`,
            background: "transparent",
            color: TEXT.caption,
            fontFamily: "inherit",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>
      <span style={{ display: "block", marginTop: 6, fontSize: 11.5, lineHeight: 1.5, color: TEXT.groupLabel }}>
        {rule.description ?? `writes to ${rule.signalKey}`}
      </span>
      <span style={{ display: "block", marginTop: 5, fontFamily: FONT.mono, fontSize: 10.5, color: verdict === "cannot-read" ? ACCENT_TEXT.danger : TEXT.faintest }}>
        {verdict === "cannot-read"
          ? state.trace
            ? `${rule.sourceKey} is not among the keys this response produced — the rule can never fire.`
            : "Run it to see whether this rule lands."
          : (reason ?? `reads ${displayValue(producedValue)}`)}
      </span>
      <ContextMenu menu={menu} onClose={close} />
    </div>
  );
}

// ── Mapping view ──────────────────────────────────────────────────────────────

/**
 * The response -> signal-key mapping, editable and testable.
 *
 * The "Try it" button is the part worth knowing about: it posts the candidate
 * mapping to the trace route, which re-applies it to the response THIS run
 * already captured and returns the keys it would produce, without saving
 * anything and without calling the tenant. That is the only faithful way to
 * test a mapping — re-applying one to the stored `rawResponse` instead would
 * use a snapshot holding only the first page (and only five rows of a CSV
 * report), so every paginated check would report a confident, wrong count.
 */
function MappingView({ state, check }: { state: EndpointsState; check: MonitorCheck }) {
  const [mappingText, setMappingText] = useState(() => JSON.stringify(check.mapping, null, 2));
  const [propsText, setPropsText] = useState(() => JSON.stringify(check.properties, null, 2));

  // Re-seed when the operator switches endpoint, or the catalog copy changes
  // under them after a save.
  useEffect(() => {
    setMappingText(JSON.stringify(check.mapping, null, 2));
    setPropsText(JSON.stringify(check.properties, null, 2));
  }, [check.key, check.mapping, check.properties]);

  const parsedMapping = parseJson<MappingRule[]>(mappingText, (v) => Array.isArray(v));
  const parsedProps = parseJson<string[]>(propsText, (v) => Array.isArray(v) && v.every((x) => typeof x === "string"));
  const valid = parsedMapping.ok && parsedProps.ok;
  const canTry = valid && state.run?.status === "completed";

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "14px 16px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
      <span style={{ fontSize: 11.5, lineHeight: 1.6, color: TEXT.faint }}>
        Every rule is measured against what this mapping produces, never against the raw response. Change it here, try it
        against the last response, then save it.
      </span>

      <JsonField
        label="Mapping"
        value={mappingText}
        onChange={setMappingText}
        error={parsedMapping.ok ? null : parsedMapping.error}
        help={`Each entry reads a field off every returned item and writes one key: { "sourceField", "targetField", "transform" }. Transforms the executor knows: count, exists, first, join, raw, countTruthy, countFalse, countEmptyArray, countEquals('x'), countIfLastSignInOlderThan(30), groupByCount, countDuplicates, countWhere('{{field}} == 1'), valueWhere('f','v'), flattenValues('f'), countDuplicatesBy('f').`}
      />

      <JsonField
        label="Properties"
        value={propsText}
        onChange={setPropsText}
        error={parsedProps.ok ? null : parsedProps.error}
        help="Plain field names pulled off every item. Each one produces three keys — name_count, name_first and name_values — before any mapping runs."
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => void tryCandidateMapping(parsedMapping.value!, parsedProps.value!)}
          disabled={!canTry}
          title={
            state.run?.status === "completed"
              ? "Re-applies this mapping to the response already captured. No tenant is called, and the catalog is not changed — but the run's stored trace IS overwritten with this result."
              : "Run the endpoint first — a mapping can only be tried against a real response."
          }
          style={{
            flex: "none",
            padding: "5px 13px",
            borderRadius: 5,
            border: `1px solid ${LINE.strong}`,
            background: "transparent",
            color: canTry ? TEXT.soft : TEXT.faint,
            fontFamily: "inherit",
            fontSize: 11.5,
            cursor: canTry ? "pointer" : "default",
          }}
        >
          Try it against the last response
        </button>
        <button
          onClick={() => void saveMapping(parsedMapping.value!, parsedProps.value!)}
          disabled={!valid}
          title="Writes it into the catalog for every tenant. Bumps the check's schema version."
          style={{
            flex: "none",
            padding: "5px 13px",
            borderRadius: 5,
            border: 0,
            background: valid ? PRIMARY : LINE.control,
            color: "#fff",
            fontFamily: "inherit",
            fontSize: 11.5,
            fontWeight: 600,
            cursor: valid ? "pointer" : "default",
          }}
        >
          Save it to the catalog
        </button>
      </div>

      {state.trace && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Eyebrow>What it produces</Eyebrow>
          {state.trace.keys.map((k) => (
            <div key={k.key} style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ flex: "0 0 auto", fontFamily: FONT.mono, fontSize: 11.5, color: TEXT.strong }}>{k.key}</span>
              <span style={{ flex: "0 0 auto", fontFamily: FONT.mono, fontSize: 11.5, color: TYPE_TONE[typeOf(k.value)] ?? TEXT.caption }}>
                {displayValue(k.value)}
              </span>
              <span style={{ flex: "1 1 120px", minWidth: 0, fontSize: 11, color: TEXT.faint }}>
                {k.origin === "mapping"
                  ? `from ${k.sourceField} via ${k.transform ?? "none"}`
                  : k.origin === "property"
                    ? "extracted property"
                    : "how many items came back"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function parseJson<T>(text: string, guard: (v: unknown) => boolean): { ok: boolean; value: T | null; error: string | null } {
  try {
    const value = JSON.parse(text) as unknown;
    if (!guard(value)) return { ok: false, value: null, error: "That parses, but it is not the shape this field takes." };
    return { ok: true, value: value as T, error: null };
  } catch (err) {
    return { ok: false, value: null, error: err instanceof Error ? err.message : "Not valid JSON." };
  }
}

function JsonField({
  label,
  value,
  onChange,
  error,
  help,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  error: string | null;
  help: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Eyebrow>{label}</Eyebrow>
        <div style={{ flex: 1, minWidth: 4 }} />
        <span style={{ fontSize: 10.5, fontWeight: 700, color: error ? ACCENT.danger : ACCENT_TEXT.green }}>
          {error ? "will not parse" : "reads fine"}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        aria-label={label}
        style={{
          width: "100%",
          minHeight: 120,
          padding: "9px 11px",
          borderRadius: 6,
          border: `1px solid ${error ? "rgba(229,122,122,.4)" : LINE.control}`,
          background: SURFACE.root,
          color: TEXT.strong,
          outline: "none",
          fontFamily: FONT.mono,
          fontSize: 11.5,
          lineHeight: 1.6,
          resize: "vertical",
        }}
      />
      {error && <span style={{ fontSize: 11, color: ACCENT.danger }}>{error}</span>}
      <span style={{ fontSize: 11, lineHeight: 1.6, color: TEXT.faint }}>{help}</span>
    </div>
  );
}

// ── Rules view ────────────────────────────────────────────────────────────────

function RulesView({ state, check }: { state: EndpointsState; check: MonitorCheck }) {
  const resolved = resolveRuleVerdicts(state.rules, state.trace);
  const packages = packagesForCheck(check.key, state);

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "14px 16px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Eyebrow>Rules on this endpoint</Eyebrow>
        <span style={{ fontSize: 11.5, lineHeight: 1.6, color: TEXT.faint }}>
          Each one reads a key the mapping produces, not the raw response. A rule pointing at a key this endpoint never
          produces is listed here too — it is the failure that is otherwise invisible.
        </span>
        {resolved.length === 0 && (
          <span style={{ fontSize: 11.5, color: TEXT.faintest }}>Nothing reads this endpoint yet.</span>
        )}
        {resolved.map((r) => (
          <RuleSummaryRow key={r.rule.id} resolved={r} />
        ))}
      </div>

      <div style={{ paddingTop: 12, borderTop: `1px solid ${LINE.quiet}`, display: "flex", flexDirection: "column", gap: 8 }}>
        <Eyebrow>What this feeds</Eyebrow>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: TEXT.softer }}>{pillarOf(check.key)} pillar</span>
          <span style={{ fontSize: 11.5, color: TEXT.faint }}>
            {check.engines.length ? `feeds ${check.engines.join(", ")}` : "feeds no engine"}
          </span>
          <span style={{ fontSize: 11.5, color: TEXT.faint }}>runs {check.frequency}</span>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {packages.length === 0 ? (
            <span style={{ fontSize: 11.5, color: ACCENT.amber }}>In no package yet — it runs against nobody.</span>
          ) : (
            packages.map((p) => (
              <span
                key={p.key}
                style={{
                  padding: "3px 10px",
                  borderRadius: 999,
                  border: `1px solid ${LINE.control}`,
                  fontSize: 11,
                  color: TEXT.softer,
                }}
              >
                {p.label}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function RuleSummaryRow({ resolved: { rule, verdict, reason } }: { resolved: ReturnType<typeof resolveRuleVerdicts>[number] }) {
  const { menu, open, close } = useContextMenu();
  const conditionText = `${rule.sourceKey} ${ruleTypeLabel(rule.ruleType)}${
    ruleTypeNeedsValue(rule.ruleType) ? ` ${rule.compareValue ?? ""}` : ""
  }`;

  return (
    <div
      style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${LINE.quiet}`, background: SURFACE.card }}
      onContextMenu={(e) =>
        open(
          e,
          [
            { label: "Copy condition", onSelect: () => navigator.clipboard?.writeText(conditionText) },
            { label: "Copy signal key", onSelect: () => navigator.clipboard?.writeText(rule.signalKey) },
            { label: "Delete rule", danger: true, onSelect: () => void removeRule(rule.id) },
          ],
          `Actions for ${conditionText}`,
        )
      }
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
        <span style={{ flex: "1 1 180px", minWidth: 0, fontFamily: FONT.mono, fontSize: 11.5, color: TEXT.strong, wordBreak: "break-all" }}>
          {conditionText}
        </span>
        <span style={{ flex: "none", fontSize: 10.5, color: TEXT.caption }}>writes to {rule.signalKey}</span>
        <span style={{ flex: "none", fontSize: 9.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: VERDICT_TONE[verdict] }}>
          {verdictLabel(verdict)}
        </span>
      </div>
      {(rule.description || reason) && (
        <span style={{ display: "block", marginTop: 6, fontSize: 11.5, lineHeight: 1.5, color: TEXT.groupLabel }}>
          {rule.description ?? reason}
        </span>
      )}
      <ContextMenu menu={menu} onClose={close} />
    </div>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function Eyebrow({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      style={{
        flex: "none",
        fontSize: 9.5,
        fontWeight: 800,
        letterSpacing: ".11em",
        textTransform: "uppercase",
        color: color ?? TEXT.metaAlt,
      }}
    >
      {children}
    </span>
  );
}

function MiniTab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "2px 9px",
        borderRadius: 10,
        border: `1px solid ${on ? "rgba(255,255,255,.28)" : LINE.control}`,
        background: on ? WASH.hover : "transparent",
        color: on ? TEXT.primary : TEXT.caption,
        fontFamily: "inherit",
        fontSize: 10.5,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
