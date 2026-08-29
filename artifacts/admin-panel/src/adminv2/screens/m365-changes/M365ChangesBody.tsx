/**
 * Microsoft Changes — interpretation authoring body (Git #1532, part of #1494).
 *
 * The PlatformAdmin surface where Shane authors the UNIVERSAL reading of a class
 * of Microsoft 365 change — authored once per MSP, reused by every tenant's
 * resolution layer. Fields (#1494): change class, what it touches, who acts,
 * controllability + how, and the probe (what to count in a tenant to know if it
 * applies).
 *
 * Authoring model (#1532): Shane authors, AI proposes. "Interpret a change" opens
 * the candidate picker (roadmap items + Message Center posts with no interpretation
 * yet); picking one runs the model and shows its structured reading for review;
 * Shane edits and saves it as `proposed`, or saves-and-confirms. Confirming is the
 * only path to `confirmed` — the gate the resolution layer reads. No unverified
 * interpretation ever reaches a tenant.
 *
 * Every value shown is served by routes/admin-m365-interpretations.ts; nothing is
 * computed or hardcoded here, and an unread library renders an honest empty state
 * rather than any fixture content (the standing hard rule).
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { CalendarClock, Check, Plus, Sparkles, X } from "lucide-react";
import { SURFACE, LINE, TEXT, ACCENT, ACCENT_TEXT, FONT } from "../../theme";
import { useShell } from "../../shell/ShellContext";
import {
  subscribe,
  getSnapshot,
  loadCandidates,
  propose,
  clearProposal,
  createInterpretation,
  confirmInterpretation,
  type Interpretation,
  type M365ChangeClass,
  type M365Actor,
  type M365Controllability,
  type M365Touches,
  type M365Probe,
  type M365SourceKind,
  type ProposalResult,
} from "./m365ChangesStore";

// ── Labels & tones ────────────────────────────────────────────────────────────

export const CHANGE_CLASS_LABEL: Record<M365ChangeClass, string> = {
  retirement: "Retirement",
  default_flip: "Default flip",
  new_feature: "New feature",
  breaking_change: "Breaking change",
  licensing: "Licensing",
};
const CHANGE_CLASSES = Object.keys(CHANGE_CLASS_LABEL) as M365ChangeClass[];

export const STATUS_LABEL: Record<string, string> = {
  proposed: "Proposed",
  confirmed: "Confirmed",
  rejected: "Rejected",
};
export function statusTone(status: string): string {
  if (status === "confirmed") return ACCENT_TEXT.green;
  if (status === "proposed") return ACCENT_TEXT.amber;
  return ACCENT_TEXT.neutral;
}

const ACTOR_LABEL: Record<M365Actor, string> = {
  microsoft: "Microsoft acts automatically",
  admin: "An admin must act",
};
const CONTROLLABLE_LABEL: Record<M365Controllability, string> = {
  yes: "Can be turned off",
  no: "Cannot be turned off",
  unknown: "Unknown",
};

// ── Shared styles ─────────────────────────────────────────────────────────────

const card: React.CSSProperties = { background: SURFACE.card, border: `1px solid ${LINE.base}`, borderRadius: 8, padding: 16 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: TEXT.caption };
const inputStyle: React.CSSProperties = { background: SURFACE.well, border: `1px solid ${LINE.control}`, borderRadius: 6, padding: "7px 9px", color: TEXT.primary, fontSize: 13, fontFamily: FONT.sans, width: "100%" };
const btn: React.CSSProperties = { border: `1px solid ${LINE.control}`, background: SURFACE.well, color: TEXT.primary, borderRadius: 6, padding: "7px 12px", fontSize: 12.5, cursor: "pointer" };

function Stated({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "18px 20px", fontSize: 12.5, lineHeight: 1.6, color: TEXT.faint, textWrap: "pretty" }}>{children}</div>;
}

// ── Body ───────────────────────────────────────────────────────────────────────

type View = "library" | "candidates" | "editor";

interface EditorSeed {
  mode: "new" | "review";
  sourceKind: M365SourceKind;
  featureId: string | null;
  graphMessageId: string | null;
  title: string;
  proposal?: ProposalResult["proposal"];
}

export function M365ChangesBody() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const shell = useShell();
  const [view, setView] = useState<View>("library");
  const [editorSeed, setEditorSeed] = useState<EditorSeed | null>(null);

  // Ribbon actions open the flows via window events (same pattern as risk-decisions).
  useEffect(() => {
    const interpret = () => { void loadCandidates(); setView("candidates"); };
    const blank = () => {
      setEditorSeed({ mode: "new", sourceKind: "manual", featureId: null, graphMessageId: null, title: "" });
      setView("editor");
    };
    window.addEventListener("m365:interpret", interpret);
    window.addEventListener("m365:new-blank", blank);
    return () => {
      window.removeEventListener("m365:interpret", interpret);
      window.removeEventListener("m365:new-blank", blank);
    };
  }, []);

  async function runPropose(source: { featureId?: string; graphMessageId?: string; title: string; sourceKind: M365SourceKind }) {
    const result = await propose({ featureId: source.featureId, graphMessageId: source.graphMessageId });
    if (result) {
      setEditorSeed({
        mode: "review",
        sourceKind: result.sourceKind,
        featureId: result.featureId,
        graphMessageId: result.graphMessageId,
        title: result.title,
        proposal: result.proposal,
      });
      setView("editor");
    }
  }

  if (view === "candidates") {
    return <CandidatePicker onBack={() => setView("library")} onInterpret={runPropose} proposing={state.proposing} proposalError={state.proposalError} />;
  }
  if (view === "editor" && editorSeed) {
    return (
      <InterpretationEditor
        seed={editorSeed}
        onCancel={() => { clearProposal(); setEditorSeed(null); setView("library"); }}
        onSaved={() => { clearProposal(); setEditorSeed(null); setView("library"); }}
      />
    );
  }

  // ── Library ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: "100%", overflow: "auto", padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <CalendarClock size={18} color={ACCENT.info} />
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: TEXT.bright }}>Microsoft Changes — interpretations</h2>
      </div>
      <p style={{ margin: "0 0 16px", fontSize: 12.5, color: TEXT.dim, maxWidth: 720, lineHeight: 1.6 }}>
        A reading of a class of Microsoft 365 change &mdash; authored once and reused for every tenant. The AI proposes a
        structured reading from Microsoft&rsquo;s prose; you confirm it before it can ever reach a customer. Nothing here is
        tenant-specific &mdash; the affected-object count is the resolution layer&rsquo;s job.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button data-testid="m365-interpret" onClick={() => { void loadCandidates(); setView("candidates"); }} style={{ ...btn, display: "flex", alignItems: "center", gap: 6, borderColor: ACCENT.info, color: ACCENT.info }}>
          <Sparkles size={14} /> Interpret a change
        </button>
        <button
          data-testid="m365-new-blank"
          onClick={() => { setEditorSeed({ mode: "new", sourceKind: "manual", featureId: null, graphMessageId: null, title: "" }); setView("editor"); }}
          style={{ ...btn, display: "flex", alignItems: "center", gap: 6 }}
        >
          <Plus size={14} /> New by hand
        </button>
      </div>

      <CountsRow />

      {state.loading && !state.loaded && <Stated>Loading interpretations&hellip;</Stated>}
      {state.error && <Stated>Could not load interpretations: {state.error}</Stated>}
      {state.noMsp && (
        <Stated>
          No MSP is configured to author interpretations for yet. The interpretation library is per-MSP; once an MSP exists,
          this is where its readings live.
        </Stated>
      )}
      {state.loaded && !state.noMsp && state.interpretations.length === 0 && (
        <Stated>
          No interpretations authored yet. Use &ldquo;Interpret a change&rdquo; to read a roadmap item or Message Center post
          into a structured reading, or &ldquo;New by hand&rdquo; to author one directly.
        </Stated>
      )}

      {state.interpretations.length > 0 && (
        <InterpretationList
          items={state.interpretations}
          onOpen={(id) => shell.openPeek("interpretation", String(id))}
        />
      )}
    </div>
  );
}

function CountsRow() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  if (!state.loaded || state.noMsp) return null;
  const { proposed, confirmed, total } = state.counts;
  const cell = (n: number, text: string, color: string): React.ReactNode => (
    <div style={{ ...card, padding: "10px 14px", flex: "0 0 auto" }}>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{n}</div>
      <div style={{ fontSize: 11, color: TEXT.faint, marginTop: 2 }}>{text}</div>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }} data-testid="m365-counts">
      {cell(proposed, "proposed, awaiting you", proposed > 0 ? ACCENT_TEXT.amber : TEXT.dim)}
      {cell(confirmed, "confirmed & live for resolution", confirmed > 0 ? ACCENT_TEXT.green : TEXT.dim)}
      {cell(total, "total in the library", TEXT.primary)}
    </div>
  );
}

function InterpretationList({ items, onOpen }: { items: Interpretation[]; onOpen: (id: number) => void }) {
  return (
    <div style={{ border: `1px solid ${LINE.base}`, borderRadius: 8, overflow: "hidden" }} data-testid="m365-list">
      {items.map((it, i) => (
        <button
          key={it.id}
          data-testid={`m365-interpretation-${it.id}`}
          onClick={() => onOpen(it.id)}
          style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "11px 12px", background: SURFACE.card, cursor: "pointer", borderTop: i === 0 ? "none" : `1px solid ${LINE.subtle}` }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</div>
            <div style={{ fontSize: 11, color: TEXT.faint, marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ color: ACCENT_TEXT.neutral }}>{CHANGE_CLASS_LABEL[it.changeClass]}</span>
              <span>&middot;</span>
              <span>{ACTOR_LABEL[it.whoActs]}</span>
              {it.featureId && (<><span>&middot;</span><span style={{ fontFamily: FONT.mono }}>{it.featureId}</span></>)}
            </div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: statusTone(it.status), flexShrink: 0, whiteSpace: "nowrap" }}>
            {STATUS_LABEL[it.status] ?? it.status}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Candidate picker ──────────────────────────────────────────────────────────

function CandidatePicker({
  onBack,
  onInterpret,
  proposing,
  proposalError,
}: {
  onBack: () => void;
  onInterpret: (s: { featureId?: string; graphMessageId?: string; title: string; sourceKind: M365SourceKind }) => void;
  proposing: boolean;
  proposalError: string | null;
}) {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [tab, setTab] = useState<"roadmap" | "message_center">("roadmap");
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const roadmap = state.roadmapCandidates.filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()) || c.featureId.includes(filter));
  const mc = state.messageCenterCandidates.filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()) || c.graphMessageId.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 20 }}>
      <button onClick={onBack} style={{ ...btn, marginBottom: 14, background: "transparent" }}>&larr; Library</button>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <Sparkles size={18} color={ACCENT.info} />
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: TEXT.bright }}>Interpret a change</h2>
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 12.5, color: TEXT.dim, maxWidth: 700, lineHeight: 1.6 }}>
        Pick a source with no interpretation yet. The AI reads its prose and proposes a structured reading for you to review
        and confirm.
      </p>

      {proposalError && <Stated>The reading could not be produced: {proposalError}</Stated>}

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["roadmap", "message_center"] as const).map((t) => (
          <button
            key={t}
            data-testid={`m365-tab-${t}`}
            onClick={() => setTab(t)}
            style={{ ...btn, background: tab === t ? SURFACE.wellHover : "transparent", borderColor: tab === t ? ACCENT.info : LINE.control, color: tab === t ? TEXT.bright : TEXT.dim }}
          >
            {t === "roadmap" ? `Roadmap (${state.roadmapCandidates.length})` : `Message Center (${state.messageCenterCandidates.length})`}
          </button>
        ))}
      </div>

      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by title or id" style={{ ...inputStyle, marginBottom: 12 }} />

      {state.candidatesLoading && !state.candidatesLoaded && <Stated>Loading candidates&hellip;</Stated>}
      {state.candidatesLoaded && tab === "roadmap" && roadmap.length === 0 && (
        <Stated>No roadmap items without an interpretation. Every roadmap item on file has already been read, or the roadmap has not been synced yet (#1530).</Stated>
      )}
      {state.candidatesLoaded && tab === "message_center" && mc.length === 0 && (
        <Stated>No Message Center posts without an interpretation for this MSP.</Stated>
      )}

      <div style={{ border: `1px solid ${LINE.base}`, borderRadius: 8, overflow: "hidden" }} data-testid="m365-candidates">
        {tab === "roadmap" && roadmap.map((c, i) => {
          const busy = proposing && pending === c.featureId;
          return (
            <button
              key={c.featureId}
              data-testid={`m365-candidate-roadmap-${c.featureId}`}
              disabled={proposing}
              onClick={() => { setPending(c.featureId); onInterpret({ featureId: c.featureId, title: c.title, sourceKind: "roadmap" }); }}
              style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "11px 12px", background: SURFACE.card, cursor: proposing ? "wait" : "pointer", borderTop: i === 0 ? "none" : `1px solid ${LINE.subtle}`, opacity: proposing && !busy ? 0.5 : 1 }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
                <div style={{ fontSize: 11, color: TEXT.faint, marginTop: 2, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: FONT.mono }}>{c.featureId}</span>
                  {c.status && (<><span>&middot;</span><span>{c.status}</span></>)}
                  {c.products.length > 0 && (<><span>&middot;</span><span>{c.products.slice(0, 3).join(", ")}</span></>)}
                </div>
              </div>
              <span style={{ fontSize: 11, color: ACCENT.info, flexShrink: 0 }}>{busy ? "Reading&hellip;" : "Interpret"}</span>
            </button>
          );
        })}
        {tab === "message_center" && mc.map((c, i) => {
          const busy = proposing && pending === c.graphMessageId;
          return (
            <button
              key={c.graphMessageId}
              data-testid={`m365-candidate-mc-${c.graphMessageId}`}
              disabled={proposing}
              onClick={() => { setPending(c.graphMessageId); onInterpret({ graphMessageId: c.graphMessageId, title: c.title, sourceKind: "message_center" }); }}
              style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "11px 12px", background: SURFACE.card, cursor: proposing ? "wait" : "pointer", borderTop: i === 0 ? "none" : `1px solid ${LINE.subtle}`, opacity: proposing && !busy ? 0.5 : 1 }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
                <div style={{ fontSize: 11, color: TEXT.faint, marginTop: 2, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: FONT.mono }}>{c.graphMessageId}</span>
                  {c.category && (<><span>&middot;</span><span>{c.category}</span></>)}
                  {c.isMajorChange && (<><span>&middot;</span><span style={{ color: ACCENT_TEXT.amber }}>major</span></>)}
                </div>
              </div>
              <span style={{ fontSize: 11, color: ACCENT.info, flexShrink: 0 }}>{busy ? "Reading&hellip;" : "Interpret"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Editor (review a proposal / author by hand / edit) ─────────────────────────

function chips(values: string[], onChange: (next: string[]) => void, placeholder: string, testid: string) {
  return (
    <div>
      <input
        data-testid={testid}
        defaultValue={values.join(", ")}
        onBlur={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );
}

function InterpretationEditor({ seed, onCancel, onSaved }: { seed: EditorSeed; onCancel: () => void; onSaved: () => void }) {
  const p = seed.proposal;
  const [title, setTitle] = useState(seed.title);
  const [summary, setSummary] = useState(p?.summary ?? "");
  const [changeClass, setChangeClass] = useState<M365ChangeClass>(p?.changeClass ?? "new_feature");
  const [whoActs, setWhoActs] = useState<M365Actor>(p?.whoActs ?? "microsoft");
  const [controllable, setControllable] = useState<M365Controllability>(p?.controllable ?? "unknown");
  const [controlMethod, setControlMethod] = useState(p?.controlMethod ?? "");
  const [touches, setTouches] = useState<M365Touches>(p?.touches ?? { services: [], protocols: [], skus: [], settings: [] });
  const [probe, setProbe] = useState<M365Probe>(p?.probe ?? { description: "", graphEndpoint: null });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = title.trim().length > 0;

  async function save(confirm: boolean) {
    if (!valid) return;
    setBusy(true);
    const created = await createInterpretation({
      featureId: seed.featureId,
      graphMessageId: seed.graphMessageId,
      sourceKind: seed.sourceKind,
      title: title.trim(),
      summary: summary.trim() || null,
      changeClass,
      touches,
      whoActs,
      controllable,
      controlMethod: controllable === "yes" ? (controlMethod.trim() || null) : null,
      probe: { ...probe, description: probe.description.trim() },
      proposedBy: seed.mode === "review" ? "ai" : "human",
      aiModel: seed.mode === "review" ? p?.model ?? null : null,
      aiRationale: seed.mode === "review" ? p?.rationale ?? null : null,
      notes: notes.trim() || null,
      // A hand-authored review can be born confirmed only through the explicit
      // "Save & confirm"; the default persists as 'proposed'.
      status: confirm ? "confirmed" : "proposed",
    });
    if (created && confirm && created.status !== "confirmed") {
      // Defensive: if the create path did not confirm, confirm explicitly.
      await confirmInterpretation(created.id);
    }
    setBusy(false);
    if (created) onSaved();
  }

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 20 }}>
      <button onClick={onCancel} style={{ ...btn, marginBottom: 14, background: "transparent" }}>&larr; Library</button>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        {seed.mode === "review" ? <Sparkles size={18} color={ACCENT.info} /> : <Plus size={18} color={TEXT.dim} />}
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: TEXT.bright }}>
          {seed.mode === "review" ? "Review the proposed reading" : "New interpretation"}
        </h2>
      </div>

      {seed.mode === "review" && p && (
        <div style={{ ...card, borderColor: ACCENT.info, marginBottom: 14 }} data-testid="m365-rationale">
          <div style={{ ...label, color: ACCENT.info, marginBottom: 6 }}>Why the AI read it this way &mdash; {p.model}</div>
          <div style={{ fontSize: 12.5, color: TEXT.soft, lineHeight: 1.6 }}>{p.rationale || "No rationale returned."}</div>
          <div style={{ fontSize: 11, color: TEXT.faint, marginTop: 8 }}>
            This reading is unverified. Nothing reaches a tenant until you confirm it &mdash; check especially the opt-out
            method, which an AI can invent.
          </div>
        </div>
      )}

      <div style={{ display: "grid", gap: 12, maxWidth: 720 }}>
        <Field lbl="Title">
          <input data-testid="m365-editor-title" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
        </Field>
        <Field lbl="Summary — what is changing, in plain terms">
          <textarea data-testid="m365-editor-summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </Field>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field lbl="Change class" flex="1 1 180px">
            <select data-testid="m365-editor-class" value={changeClass} onChange={(e) => setChangeClass(e.target.value as M365ChangeClass)} style={inputStyle}>
              {CHANGE_CLASSES.map((c) => <option key={c} value={c}>{CHANGE_CLASS_LABEL[c]}</option>)}
            </select>
          </Field>
          <Field lbl="Who acts" flex="1 1 180px">
            <select data-testid="m365-editor-who" value={whoActs} onChange={(e) => setWhoActs(e.target.value as M365Actor)} style={inputStyle}>
              {(["microsoft", "admin"] as M365Actor[]).map((a) => <option key={a} value={a}>{ACTOR_LABEL[a]}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field lbl="Controllable?" flex="1 1 180px">
            <select data-testid="m365-editor-controllable" value={controllable} onChange={(e) => setControllable(e.target.value as M365Controllability)} style={inputStyle}>
              {(["yes", "no", "unknown"] as M365Controllability[]).map((c) => <option key={c} value={c}>{CONTROLLABLE_LABEL[c]}</option>)}
            </select>
          </Field>
          {controllable === "yes" && (
            <Field lbl="How to turn it off" flex="2 1 300px">
              <input data-testid="m365-editor-control-method" value={controlMethod} onChange={(e) => setControlMethod(e.target.value)} placeholder="The exact opt-out — leave blank if you cannot cite one" style={inputStyle} />
            </Field>
          )}
        </div>

        <div style={{ ...card }}>
          <div style={{ ...label, marginBottom: 8 }}>What it touches</div>
          <div style={{ display: "grid", gap: 8 }}>
            <div><div style={{ ...label, fontWeight: 600, marginBottom: 4 }}>Services</div>{chips(touches.services, (v) => setTouches({ ...touches, services: v }), "e.g. Exchange Online, Purview", "m365-editor-services")}</div>
            <div><div style={{ ...label, fontWeight: 600, marginBottom: 4 }}>Protocols</div>{chips(touches.protocols, (v) => setTouches({ ...touches, protocols: v }), "e.g. EWS, Basic Authentication", "m365-editor-protocols")}</div>
            <div><div style={{ ...label, fontWeight: 600, marginBottom: 4 }}>SKUs</div>{chips(touches.skus, (v) => setTouches({ ...touches, skus: v }), "e.g. Project Online, Microsoft 365 E5", "m365-editor-skus")}</div>
            <div><div style={{ ...label, fontWeight: 600, marginBottom: 4 }}>Settings</div>{chips(touches.settings, (v) => setTouches({ ...touches, settings: v }), "e.g. External sharing", "m365-editor-settings")}</div>
          </div>
        </div>

        <div style={{ ...card }}>
          <div style={{ ...label, marginBottom: 8 }}>The probe &mdash; what to count in a tenant to know if it applies</div>
          <textarea data-testid="m365-editor-probe" value={probe.description} onChange={(e) => setProbe({ ...probe, description: e.target.value })} rows={2} placeholder="e.g. mailboxes with EWS enabled" style={{ ...inputStyle, resize: "vertical" }} />
          <div style={{ marginTop: 8 }}>
            <div style={{ ...label, fontWeight: 600, marginBottom: 4 }}>Graph endpoint (optional)</div>
            <input data-testid="m365-editor-probe-graph" value={probe.graphEndpoint ?? ""} onChange={(e) => setProbe({ ...probe, graphEndpoint: e.target.value.trim() || null })} placeholder="A Graph endpoint that could count it, if one applies" style={{ ...inputStyle, fontFamily: FONT.mono }} />
          </div>
        </div>

        <Field lbl="Notes (optional)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </Field>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button data-testid="m365-editor-save-proposed" onClick={() => void save(false)} disabled={!valid || busy} style={{ ...btn, opacity: valid ? 1 : 0.5 }}>
            {busy ? "Saving…" : "Save as proposed"}
          </button>
          <button data-testid="m365-editor-save-confirm" onClick={() => void save(true)} disabled={!valid || busy} style={{ ...btn, display: "flex", alignItems: "center", gap: 6, borderColor: ACCENT.green, color: ACCENT_TEXT.green, opacity: valid ? 1 : 0.5 }}>
            <Check size={14} /> {busy ? "Saving…" : "Save & confirm"}
          </button>
          <button onClick={onCancel} style={{ ...btn, display: "flex", alignItems: "center", gap: 6, background: "transparent" }}>
            <X size={14} /> Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ lbl, children, flex }: { lbl: string; children: React.ReactNode; flex?: string }) {
  return (
    <div style={{ flex }}>
      <div style={{ ...label, marginBottom: 5 }}>{lbl}</div>
      {children}
    </div>
  );
}
