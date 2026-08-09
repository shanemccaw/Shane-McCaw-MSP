/**
 * Tenant Signals body — the design's `sg` screen, on real data.
 *
 * Three views, exactly the design's: **Rules** (what a signal is made of and
 * the one editor for it), **Test it** (run the whole set against a simulation
 * profile without touching a tenant), **Conflicts** (what is broken, and the
 * shared save-point history).
 *
 * Two deliberate departures from `Admin Shell.dc.html`, both forced by what
 * the platform really stores:
 *
 * 1. **The condition is three fields, not one.** The design has a single
 *    free-text `when` box. `signal_derivation_rules` stores `rule_type`,
 *    `source_key` and `compare_value`, and `evaluateRule()` reads exactly
 *    those. The line above the fields renders them as the design's one-liner
 *    so it still reads that way; the controls edit what exists.
 * 2. **Pillar impact is not clamped to 0-10.** The design's stepper clamps at
 *    10. Real rules in this catalog carry values well above that (a security
 *    impact of 40 is normal), so a 0-10 clamp would silently truncate a live
 *    rule the moment anyone nudged it.
 *
 * Every number on this screen comes from the API. Nothing is evaluated
 * client-side — the server is what scores a tenant, so the server is what is
 * asked what fires.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { ACCENT, ACCENT_TEXT, FONT, LINE, PRIMARY, SURFACE, TEXT } from "../../theme";
import {
  cancelDraft,
  commitDraft,
  configureSignalsFetch,
  deleteRule,
  dryRunSow,
  getSnapshot,
  groupsFor,
  importClientProfile,
  loadAll,
  patchDraft,
  patchRule,
  restoreVersion,
  rulesFor,
  runProfile,
  savePoint,
  selectProfile,
  selectRule,
  selectSignal,
  selectedRule,
  setView,
  signalFor,
  startDraft,
  subscribe,
  warm,
  type SignalsStoreState,
  type SignalsView,
} from "./signalsStore";
import {
  IMPACT_FIELDS,
  IMPACT_LABELS,
  RULE_TYPES,
  SEVERITIES,
  conditionText,
  needsCompareValue,
  ruleFaults,
  ruleTypeMeta,
  totalImpact,
  type ImpactField,
  type SignalRule,
} from "./signalsTypes";

const VIEWS: Array<{ key: SignalsView; label: string }> = [
  { key: "rules", label: "Rules" },
  { key: "test", label: "Test it" },
  { key: "health", label: "Conflicts" },
];

const SEVERITY_TONE: Record<string, string> = {
  critical: ACCENT.danger,
  high: ACCENT.amberDim,
  medium: ACCENT.amber,
  low: ACCENT.info,
  informational: TEXT.meta,
};

export function TenantSignalsBody({ recordId }: { recordId?: string }) {
  const { adminFetch } = useAdminFetch();
  const state = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    configureSignalsFetch(adminFetch);
    warm();
  }, [adminFetch]);

  // A doc opened on a signal (palette record row, gallery, Back group) carries
  // the key as its recordId — follow it, so the tab strip and the screen can
  // never disagree about which signal is open.
  useEffect(() => {
    if (recordId && recordId !== state.selectedKey) selectSignal(recordId);
  }, [recordId, state.selectedKey]);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: "#202020" }}>
      <Header state={state} />
      {state.error && state.signals.length === 0 ? (
        <div style={{ padding: 20, fontSize: 12.5, color: ACCENT.danger }}>
          {state.error}{" "}
          <button
            onClick={() => void loadAll()}
            style={{ marginLeft: 8, background: "transparent", border: "none", color: ACCENT.info, cursor: "pointer", font: "inherit" }}
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {state.view === "rules" && <RulesView state={state} />}
          {state.view === "test" && <TestView state={state} />}
          {state.view === "health" && <HealthView state={state} />}
        </>
      )}
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────

function Header({ state }: { state: SignalsStoreState }) {
  const signal = signalFor(state.selectedKey);

  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 9,
        flexWrap: "wrap",
        padding: "10px 16px",
        borderBottom: `1px solid ${LINE.base}`,
        background: SURFACE.chrome,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: TEXT.primary }}>
        {signal?.label ?? "Tenant Signals"}
      </span>
      {signal && (
        <span
          style={{
            flex: "none",
            padding: "2px 9px",
            borderRadius: 10,
            border: `1px solid ${LINE.strong}`,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: ".05em",
            textTransform: "uppercase",
            color: TEXT.dimmer,
          }}
        >
          {signal.isAdjustment ? "adjustment" : "project"}
        </span>
      )}
      {signal && !signal.enabled && (
        <span
          style={{
            flex: "none",
            padding: "2px 9px",
            borderRadius: 10,
            background: "rgba(229,122,122,.14)",
            border: "1px solid rgba(229,122,122,.36)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: ".05em",
            textTransform: "uppercase",
            color: ACCENT_TEXT.danger,
          }}
        >
          disabled
        </span>
      )}
      <div style={{ display: "flex", gap: 4, marginLeft: 6 }}>
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            style={{
              padding: "4px 11px",
              borderRadius: 11,
              border: `1px solid ${state.view === v.key ? "rgba(255,255,255,.28)" : LINE.control}`,
              background: state.view === v.key ? "rgba(255,255,255,.12)" : "transparent",
              color: state.view === v.key ? TEXT.primary : TEXT.dimmer,
              fontFamily: "inherit",
              fontSize: 11.5,
              cursor: "pointer",
            }}
          >
            {v.label}
            {v.key === "health" && state.conflicts.length > 0 ? ` · ${state.conflicts.length}` : ""}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 4 }} />
      {state.said && (
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
          title={state.said}
        >
          {state.said}
        </span>
      )}
    </div>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

function SectionLabel({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: color ?? TEXT.caption }}>
      {children}
    </span>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <span style={{ display: "block", fontSize: 11.5, lineHeight: 1.55, color: TEXT.faint, textWrap: "pretty" }}>{children}</span>;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 30,
  padding: "0 10px",
  borderRadius: 5,
  border: `1px solid ${LINE.control}`,
  background: SURFACE.chrome,
  color: TEXT.strong,
  outline: "none",
  fontFamily: FONT.mono,
  fontSize: 12,
};

function ghostButton(disabled = false): React.CSSProperties {
  return {
    flex: "none",
    whiteSpace: "nowrap",
    padding: "4px 11px",
    borderRadius: 5,
    border: `1px solid ${LINE.strong}`,
    background: "transparent",
    color: disabled ? TEXT.faintest : TEXT.soft,
    fontFamily: "inherit",
    fontSize: 11.5,
    cursor: disabled ? "default" : "pointer",
  };
}

function primaryButton(disabled = false): React.CSSProperties {
  return {
    flex: "none",
    whiteSpace: "nowrap",
    padding: "4px 11px",
    borderRadius: 5,
    border: 0,
    background: disabled ? SURFACE.wellHover : PRIMARY,
    color: disabled ? TEXT.faintest : "#fff",
    fontFamily: "inherit",
    fontSize: 11.5,
    cursor: disabled ? "default" : "pointer",
  };
}

// ─── Rules view ──────────────────────────────────────────────────────────────

function RulesView({ state }: { state: SignalsStoreState }) {
  const rules = rulesFor(state.selectedKey);
  const groups = groupsFor(state.selectedKey);
  const rule = selectedRule();
  const signal = signalFor(state.selectedKey);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>
      {/* Rule list */}
      <div style={{ flex: "none", width: 296, minHeight: 0, display: "flex", flexDirection: "column", borderRight: `1px solid ${LINE.quiet}` }}>
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 13px",
            borderBottom: `1px solid ${LINE.subtle}`,
          }}
        >
          <SectionLabel>Rules</SectionLabel>
          <div style={{ flex: 1 }} />
          <button onClick={startDraft} disabled={!state.selectedKey} style={ghostButton(!state.selectedKey)}>
            Add
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {state.draft && (
            <div style={{ padding: "9px 13px", borderLeft: `2px solid ${ACCENT.amberDim}`, background: "rgba(242,202,99,.07)" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: TEXT.primary }}>New rule</span>
              <span style={{ display: "block", marginTop: 3, fontSize: 11, color: ACCENT.amber }}>not saved yet</span>
            </div>
          )}
          {rules.map((r) => {
            const on = !state.draft && rule?.id === r.id;
            const faults = ruleFaults(r);
            const cond = conditionText(r);
            const group = groups.find((g) => g.id === r.groupId);
            return (
              <button
                key={r.id}
                onClick={() => selectRule(r.id)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "9px 13px",
                  border: "none",
                  borderLeft: `2px solid ${on ? TEXT.quiet : "transparent"}`,
                  background: on ? "rgba(255,255,255,.07)" : "transparent",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: TEXT.primary,
                    }}
                  >
                    {r.description || cond || `Rule ${r.id}`}
                  </span>
                  <span
                    style={{
                      flex: "none",
                      whiteSpace: "nowrap",
                      padding: "1px 8px",
                      borderRadius: 9,
                      fontSize: 9.5,
                      fontWeight: 700,
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                      background: `${SEVERITY_TONE[r.severity] ?? TEXT.meta}22`,
                      border: `1px solid ${SEVERITY_TONE[r.severity] ?? TEXT.meta}55`,
                      color: SEVERITY_TONE[r.severity] ?? TEXT.meta,
                    }}
                  >
                    {r.severity}
                  </span>
                </div>
                <span
                  style={{
                    display: "block",
                    marginTop: 4,
                    fontFamily: FONT.mono,
                    fontSize: 11,
                    color: cond ? TEXT.dim : ACCENT_TEXT.danger,
                  }}
                >
                  {cond || "no condition — it can never fire"}
                </span>
                <span style={{ display: "block", marginTop: 3, fontSize: 10.5, color: faults.length ? ACCENT.amberDim : TEXT.meta }}>
                  {faults.length
                    ? faults.join(" · ")
                    : `weight ${r.weight} · ${group?.label ?? (r.groupId ? `group ${r.groupId}` : "no group")} · ${totalImpact(r)} impact`}
                </span>
              </button>
            );
          })}
          {rules.length === 0 && !state.draft && (
            <div style={{ padding: "12px 13px", fontSize: 11.5, color: TEXT.faint, textWrap: "pretty" }}>
              {state.loading ? "Reading the rule set…" : "No rules on this signal yet. Without one it can never fire."}
            </div>
          )}
        </div>
      </div>

      {/* Editor */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", padding: "16px 20px 26px" }}>
        {state.draft ? (
          <DraftEditor state={state} />
        ) : rule ? (
          <RuleEditor rule={rule} />
        ) : (
          <Note>
            {signal
              ? "This signal has no rules. Add one to give it a condition — until then it can never fire."
              : "Pick a signal from the Explorer to see what it is made of."}
          </Note>
        )}
      </div>
    </div>
  );
}

function ConditionLine({ text }: { text: string }) {
  return (
    <span style={{ display: "block", fontFamily: FONT.mono, fontSize: 12.5, color: text ? TEXT.strong : ACCENT_TEXT.danger }}>
      {text || "no condition — it can never fire"}
    </span>
  );
}

function DraftEditor({ state }: { state: SignalsStoreState }) {
  const draft = state.draft!;
  const meta = ruleTypeMeta(draft.ruleType);
  const ready = draft.sourceKey.trim().length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <SectionLabel>Condition</SectionLabel>
        <ConditionLine text={conditionText({ ...draft, compareValue: draft.compareValue || null })} />
        <input
          value={draft.sourceKey}
          onChange={(e) => patchDraft({ sourceKey: e.target.value })}
          placeholder={meta?.sourceLabel ?? "Profile field"}
          spellCheck={false}
          style={inputStyle}
        />
        <select
          value={draft.ruleType}
          onChange={(e) => patchDraft({ ruleType: e.target.value })}
          style={{ ...inputStyle, fontFamily: "inherit" }}
        >
          {RULE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {meta?.compare && (
          <input
            value={draft.compareValue}
            onChange={(e) => patchDraft({ compareValue: e.target.value })}
            placeholder={meta.compare.label}
            spellCheck={false}
            style={inputStyle}
          />
        )}
        <input
          value={draft.description}
          onChange={(e) => patchDraft({ description: e.target.value })}
          placeholder="What this rule means, in words"
          style={{ ...inputStyle, fontFamily: "inherit" }}
        />
        <Note>
          {ready
            ? "It will be created with no pillar impact, so it scores nothing until you give it one."
            : "A rule with no field to read cannot fire, and will not be saved without one."}
        </Note>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => void commitDraft()} disabled={!ready || state.busy === "saving"} style={primaryButton(!ready || state.busy === "saving")}>
          {state.busy === "saving" ? "Creating…" : "Create it"}
        </button>
        <button onClick={cancelDraft} style={ghostButton()}>
          Discard
        </button>
      </div>
    </div>
  );
}

function RuleEditor({ rule }: { rule: SignalRule }) {
  const meta = ruleTypeMeta(rule.ruleType);
  const faults = ruleFaults(rule);
  const [armed, setArmed] = useState(false);

  // Arming resets whenever a different rule is selected, the same way a peek's
  // confirm resets when the record changes (SHELL.md section 3).
  useEffect(() => setArmed(false), [rule.id]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 640 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <SectionLabel>Condition</SectionLabel>
        <ConditionLine text={conditionText(rule)} />
        <input
          value={rule.sourceKey}
          onChange={(e) => void patchRule(rule.id, { sourceKey: e.target.value })}
          placeholder={meta?.sourceLabel ?? "Profile field"}
          spellCheck={false}
          style={{ ...inputStyle, borderColor: rule.sourceKey ? LINE.control : "rgba(229,122,122,.4)" }}
        />
        <select
          value={rule.ruleType}
          onChange={(e) => void patchRule(rule.id, { ruleType: e.target.value })}
          style={{ ...inputStyle, fontFamily: "inherit" }}
        >
          {RULE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {needsCompareValue(rule.ruleType) && (
          <input
            value={rule.compareValue ?? ""}
            onChange={(e) => void patchRule(rule.id, { compareValue: e.target.value })}
            placeholder={meta?.compare?.label ?? "Value"}
            spellCheck={false}
            style={inputStyle}
          />
        )}
        <input
          value={rule.description ?? ""}
          onChange={(e) => void patchRule(rule.id, { description: e.target.value })}
          placeholder="What this rule means, in words"
          style={{ ...inputStyle, fontFamily: "inherit" }}
        />
        <Note>
          {faults.length
            ? faults.join(". ") + "."
            : meta?.compare?.hint
              ? `${meta.compare.hint}. Fields come from the tenant profile and from anything a customer-side script or monitor check collects.`
              : "Fields come from the tenant profile and from anything a customer-side script or monitor check collects."}
        </Note>
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <SectionLabel>Severity</SectionLabel>
          <select
            value={rule.severity}
            onChange={(e) => void patchRule(rule.id, { severity: e.target.value as SignalRule["severity"] })}
            style={{ ...inputStyle, width: 160, fontFamily: "inherit" }}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <SectionLabel>Weight</SectionLabel>
          <input
            type="number"
            value={rule.weight}
            onChange={(e) => void patchRule(rule.id, { weight: Number(e.target.value) })}
            style={{ ...inputStyle, width: 92 }}
          />
        </label>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <SectionLabel>Pillar impact</SectionLabel>
          <Note>What firing this rule does to each pillar score. A rule with none of these set scores nothing.</Note>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {IMPACT_FIELDS.map((field) => (
            <ImpactStepper key={field} rule={rule} field={field} />
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "12px 14px", borderRadius: 8, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: TEXT.soft }}>This is the only rule editor</span>
        <Note>
          The engine pages and the endpoint trace open this same rule set, locked to their own signal. There is no second copy to drift
          from, and nothing here is a draft — a saved value takes effect on live scoring immediately.
        </Note>
      </div>

      <div>
        <button
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            void deleteRule(rule.id);
          }}
          style={{
            ...ghostButton(),
            borderColor: "rgba(229,122,122,.42)",
            color: ACCENT_TEXT.danger,
          }}
        >
          {armed ? "Delete this rule — press again" : "Delete this rule"}
        </button>
      </div>
    </div>
  );
}

/**
 * Deliberately unclamped at the top — see this file's doc comment. The floor
 * stays at 0 because a negative impact is not something any engine here reads.
 */
function ImpactStepper({ rule, field }: { rule: SignalRule; field: ImpactField }) {
  const value = Number(rule[field]) || 0;
  const bump = (delta: number) => () => void patchRule(rule.id, { [field]: Math.max(0, value + delta) } as Partial<SignalRule>);

  return (
    <div
      style={{
        flex: "0 0 128px",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        padding: "9px 10px",
        borderRadius: 7,
        border: `1px solid ${LINE.base}`,
        background: SURFACE.card,
      }}
    >
      <span style={{ fontSize: 10.5, color: TEXT.caption }}>{IMPACT_LABELS[field]}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button onClick={bump(-1)} title="Less" style={stepStyle}>
          &minus;
        </button>
        <span style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 800, color: value ? TEXT.primary : "#5f5d5b" }}>{value}</span>
        <button onClick={bump(1)} title="More" style={stepStyle}>
          +
        </button>
      </div>
    </div>
  );
}

const stepStyle: React.CSSProperties = {
  flex: "none",
  width: 22,
  height: 22,
  borderRadius: 4,
  border: `1px solid ${LINE.strong}`,
  background: "transparent",
  color: TEXT.dim,
  fontFamily: "inherit",
  fontSize: 13,
  lineHeight: 1,
  cursor: "pointer",
};

// ─── Test view ───────────────────────────────────────────────────────────────

function TestView({ state }: { state: SignalsStoreState }) {
  const run = state.run;
  const hasProfile = state.selectedProfileId != null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 7,
          flexWrap: "wrap",
          padding: "9px 16px",
          borderBottom: `1px solid ${LINE.subtle}`,
          background: SURFACE.inset,
        }}
      >
        <SectionLabel>Profile</SectionLabel>
        {state.profiles.map((p) => (
          <button
            key={p.id}
            onClick={() => selectProfile(p.id)}
            title={p.description ?? undefined}
            style={{
              flex: "none",
              whiteSpace: "nowrap",
              padding: "3px 10px",
              borderRadius: 11,
              border: `1px solid ${state.selectedProfileId === p.id ? "rgba(255,255,255,.28)" : LINE.control}`,
              background: state.selectedProfileId === p.id ? "rgba(255,255,255,.12)" : "transparent",
              color: state.selectedProfileId === p.id ? TEXT.primary : TEXT.dimmer,
              fontFamily: "inherit",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {p.name}
          </button>
        ))}
        {state.profiles.length === 0 && (
          <span style={{ fontSize: 11.5, color: TEXT.meta }}>No saved profiles. Import a live client below to make one.</span>
        )}
        <div style={{ flex: 1, minWidth: 4 }} />
        <button
          onClick={() => void runProfile("test")}
          disabled={!hasProfile || state.busy != null}
          title="Fire every rule against this profile"
          style={primaryButton(!hasProfile || state.busy != null)}
        >
          {state.busy === "test" ? "Running…" : "Run the test"}
        </button>
        <button
          onClick={() => void runProfile("projects")}
          disabled={!hasProfile || state.busy != null}
          title="What this signal set would unlock"
          style={ghostButton(!hasProfile || state.busy != null)}
        >
          Preview projects
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px 20px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
        {!run && !state.busy && (
          <Note>Pick a profile and run. Nothing here touches a live tenant, and nothing is saved.</Note>
        )}
        {state.busy === "test" || state.busy === "projects" || state.busy === "sow" ? (
          <Note>Running the whole rule set…</Note>
        ) : null}

        {run && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <SectionLabel>What fired against {run.profileName}</SectionLabel>
              {run.firedSignals.length === 0 && <Note>Nothing fired. Every rule read its field and came back false.</Note>}
              {run.firedSignals.map((f) => (
                <div
                  key={f.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 12px",
                    borderRadius: 7,
                    border: `1px solid ${LINE.base}`,
                    background: SURFACE.card,
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    selectSignal(f.key);
                    setView("rules");
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: TEXT.primary }}>{f.label}</span>
                    <span style={{ display: "block", marginTop: 2, fontFamily: FONT.mono, fontSize: 11, color: TEXT.meta }}>{f.key}</span>
                  </div>
                  <span style={{ flex: "none", maxWidth: 300, fontSize: 11, color: TEXT.dim, textAlign: "right" }}>
                    {f.expectedImpact || "scores only"}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <SectionLabel>Projects this unlocks</SectionLabel>
              {run.includedProjects.length === 0 ? (
                <Note>Nothing. No visible project is triggered by the signals that fired.</Note>
              ) : (
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {run.includedProjects.map((p) => (
                    <span
                      key={p.id}
                      style={{
                        padding: "3px 10px",
                        borderRadius: 11,
                        border: `1px solid ${LINE.strong}`,
                        fontSize: 11.5,
                        color: ACCENT_TEXT.green,
                      }}
                    >
                      {p.title}
                      {p.priceRange ? ` · ${p.priceRange}` : ""}
                    </span>
                  ))}
                </div>
              )}
              {run.excludedProjects.length > 0 && (
                <Note>
                  {run.excludedProjects.length} other project{run.excludedProjects.length === 1 ? "" : "s"} stayed out — first reason:{" "}
                  {run.excludedProjects[0]!.reason}
                </Note>
              )}
            </div>

            {run.previousRunDiff && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <SectionLabel>Since the last run of this profile</SectionLabel>
                <Note>
                  {run.previousRunDiff.newlyFired.length} newly firing · {run.previousRunDiff.stoppedFiring.length} stopped ·{" "}
                  {run.previousRunDiff.newlyIncluded.length} project{run.previousRunDiff.newlyIncluded.length === 1 ? "" : "s"} newly
                  unlocked · {run.previousRunDiff.movedToExcluded.length} dropped out
                </Note>
              </div>
            )}

            {run.note && (
              <div style={{ paddingTop: 12, borderTop: `1px solid ${LINE.quiet}` }}>
                <Note>{run.note}</Note>
              </div>
            )}
          </>
        )}

        <LiveClients state={state} />
      </div>
    </div>
  );
}

/**
 * The two things on this screen that reach a real tenant, kept together and
 * labelled with what each one actually does. Importing writes a profile row;
 * the SOW dry run writes nothing but reads a different data source, so it is
 * stated rather than presented as equivalent to the profile run.
 */
function LiveClients({ state }: { state: SignalsStoreState }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 14, borderTop: `1px solid ${LINE.quiet}` }}>
      <SectionLabel>Against a live client</SectionLabel>
      {state.clients.length === 0 ? (
        <Note>No consented tenant with collected data to test against.</Note>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {state.clients.slice(0, 12).map((c) => (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "8px 12px",
                borderRadius: 7,
                border: `1px solid ${LINE.base}`,
                background: SURFACE.card,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, color: TEXT.primary }}>
                  {c.name}
                  {c.isTestbed ? " · testbed" : ""}
                </span>
                <span style={{ display: "block", marginTop: 2, fontFamily: FONT.mono, fontSize: 10.5, color: TEXT.meta }}>
                  {c.tenantId ?? "no tenant id"}
                </span>
              </div>
              <button
                onClick={() => void importClientProfile(c.id, c.name)}
                disabled={state.busy != null}
                title="Reads the tenant and saves what it found as a new simulation profile"
                style={ghostButton(state.busy != null)}
              >
                Import as a profile
              </button>
              <button
                onClick={() => void dryRunSow(c.id, c.name)}
                disabled={state.busy != null}
                title="Reads this client's completed script runs only — a tenant whose data arrives through Graph monitor checks will come back empty"
                style={ghostButton(state.busy != null)}
              >
                Dry-run the SOW
              </button>
            </div>
          ))}
        </div>
      )}
      <Note>
        Importing saves a new simulation profile from what the tenant really reports; the tenant itself is only read. The SOW dry run
        generates no document, and reads completed script runs only — a Graph-only tenant returns nothing.
      </Note>
    </div>
  );
}

// ─── Conflicts view ──────────────────────────────────────────────────────────

function HealthView({ state }: { state: SignalsStoreState }) {
  // Two different kinds of broken, deliberately kept apart: the server detects
  // contradictions BETWEEN rules; a rule that is individually inert (no field
  // to read, no pillar to score) is invisible to that check and is found here.
  const inert: Array<{ key: string; label: string; ruleId: number; text: string }> = [];
  for (const signal of state.signals) {
    if (!signal.enabled) continue;
    for (const rule of state.rulesBySignal[signal.key]?.rules ?? []) {
      for (const fault of ruleFaults(rule)) {
        inert.push({ key: signal.key, label: signal.label, ruleId: rule.id, text: `${rule.description || `Rule ${rule.id}`} ${fault}` });
      }
    }
  }
  const disabledWithRules = state.signals.filter((s) => !s.enabled && (state.rulesBySignal[s.key]?.rules.length ?? 0) > 0);
  const total = state.conflicts.length + inert.length + disabledWithRules.length;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px 20px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <SectionLabel>Conflicts and health</SectionLabel>
        <span
          style={{
            flex: "none",
            whiteSpace: "nowrap",
            padding: "2px 9px",
            borderRadius: 10,
            fontSize: 10.5,
            fontWeight: 700,
            background: total ? "rgba(233,185,73,.14)" : "rgba(108,203,150,.14)",
            border: `1px solid ${total ? "rgba(233,185,73,.32)" : "rgba(108,203,150,.32)"}`,
            color: total ? ACCENT.amber : ACCENT_TEXT.green,
          }}
        >
          {total ? `${total} to look at` : "clean"}
        </span>
      </div>

      {total === 0 && !state.loading && (
        <Note>Nothing conflicting. Every enabled signal has a rule that can fire and a pillar it affects.</Note>
      )}

      {state.conflicts.map((c, i) => (
        <ConflictRow key={`c${i}`} tone="bad" text={c.description} fix={`Rules ${c.ruleIds.join(", ")} contradict each other — one of them has to go.`} />
      ))}
      {inert.map((row, i) => (
        <ConflictRow
          key={`i${i}`}
          tone="warn"
          text={`${row.label}: ${row.text}`}
          fix="Open it and give it a condition and a pillar."
          onSelect={() => {
            selectSignal(row.key);
            selectRule(row.ruleId);
            setView("rules");
          }}
        />
      ))}
      {disabledWithRules.map((s) => {
        const count = state.rulesBySignal[s.key]?.rules.length ?? 0;
        return (
        <ConflictRow
          key={`d${s.key}`}
          tone="warn"
          text={`${s.label} is disabled but still has ${count} rule${count === 1 ? "" : "s"}`}
          fix="Enable it, or retire the rules."
          onSelect={() => {
            selectSignal(s.key);
            setView("rules");
          }}
        />
        );
      })}

      <SavePoints state={state} />
      <FleetHealth state={state} />
    </div>
  );
}

function ConflictRow({
  tone,
  text,
  fix,
  onSelect,
}: {
  tone: "bad" | "warn";
  text: string;
  fix: string;
  onSelect?: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        padding: "10px 13px",
        borderRadius: 7,
        cursor: onSelect ? "pointer" : "default",
        border: `1px solid ${tone === "bad" ? "rgba(229,122,122,.32)" : LINE.base}`,
        background: SURFACE.card,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span
          style={{
            flex: "none",
            width: 7,
            height: 7,
            borderRadius: "50%",
            marginTop: 5,
            background: tone === "bad" ? ACCENT.danger : ACCENT.amberDim,
          }}
        />
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: TEXT.soft, textWrap: "pretty" }}>{text}</span>
      </div>
      <span style={{ display: "block", marginTop: 4, marginLeft: 15, fontSize: 11.5, color: TEXT.meta }}>{fix}</span>
    </div>
  );
}

function SavePoints({ state }: { state: SignalsStoreState }) {
  const [name, setName] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 14, borderTop: `1px solid ${LINE.quiet}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <SectionLabel>Save points</SectionLabel>
        <Note>One history for the whole rule set — every screen that edits rules writes here.</Note>
      </div>
      <div style={{ display: "flex", gap: 7 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What this point is"
          style={{ ...inputStyle, maxWidth: 320, fontFamily: "inherit" }}
        />
        <button
          onClick={() => {
            void savePoint(name.trim() || "Save point");
            setName("");
          }}
          disabled={state.busy != null}
          style={ghostButton(state.busy != null)}
        >
          Save a point
        </button>
      </div>
      {state.versions.slice(0, 6).map((v) => (
        <div
          key={v.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "8px 12px",
            borderRadius: 7,
            border: `1px solid ${LINE.base}`,
            background: SURFACE.card,
          }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: TEXT.soft }}>
            {v.name}
          </span>
          <span style={{ flex: "none", fontSize: 11, color: TEXT.meta }}>{v.ruleCount} rules</span>
          <RestoreButton id={v.id} name={v.name} disabled={state.busy != null} />
        </div>
      ))}
      {state.versions.length === 0 && <Note>No save points yet.</Note>}
    </div>
  );
}

/** Restoring replaces every platform rule, so it arms in place first. */
function RestoreButton({ id, name, disabled }: { id: number; name: string; disabled: boolean }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        void restoreVersion(id, name);
      }}
      disabled={disabled}
      style={{ ...ghostButton(disabled), borderColor: armed ? "rgba(229,122,122,.42)" : LINE.strong, color: armed ? ACCENT_TEXT.danger : TEXT.soft }}
    >
      {armed ? "Restore — press again" : "Restore"}
    </button>
  );
}

/**
 * How many clients each signal fires for. This is `GET
 * /admin/signal-rules/health`, which is computed from completed
 * `script_run_results` only — a tenant whose data arrives through Graph
 * monitor checks contributes nothing to it. Said out loud rather than shown as
 * a fleet count it is not.
 */
function FleetHealth({ state }: { state: SignalsStoreState }) {
  const rows = state.signals
    .map((s) => ({ signal: s, health: state.health[s.key] }))
    .filter((r) => r.health && r.health.clientCount > 0)
    .sort((a, b) => b.health!.clientCount - a.health!.clientCount);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 14, borderTop: `1px solid ${LINE.quiet}` }}>
      <SectionLabel>Firing across clients</SectionLabel>
      {rows.length === 0 ? (
        <Note>Nothing is firing for any client with a completed script run.</Note>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.slice(0, 10).map(({ signal, health }) => (
            <div key={signal.key} style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: TEXT.soft }}>
                {signal.label}
              </span>
              <span style={{ flex: "none", fontFamily: FONT.mono, fontSize: 11.5, color: TEXT.dim }}>
                {health!.clientCount} of {health!.totalClients}
              </span>
            </div>
          ))}
        </div>
      )}
      <Note>
        Counted from completed script runs only. A tenant whose data arrives through Graph monitor checks does not appear here even when
        its signals really do fire.
      </Note>
    </div>
  );
}
