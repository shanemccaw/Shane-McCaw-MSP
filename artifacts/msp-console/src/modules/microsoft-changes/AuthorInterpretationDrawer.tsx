/**
 * Author a new interpretation — either starting from a picked candidate (with
 * an optional AI-proposed reading to review and edit) or authoring by hand.
 * `POST /admin/m365/interpretations/propose` then `POST /admin/m365/interpretations`
 * (#1532's "Shane authors, AI proposes" model — the AI call is a convenience
 * that pre-fills this same form; nothing is ever saved unreviewed).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { border, signal, text } from "@/console/tokens";
import { useAvailableChecks } from "@/api/rbd-api";
import {
  useCreateInterpretation, useProposeInterpretation,
  type MessageCenterCandidate, type RoadmapCandidate,
} from "@/api/m365-changes-api";
import { emptyFields, fieldsToProbe, fieldsToTouches, InterpretationFields, type FieldsState } from "./InterpretationFields";

export type CandidateSource =
  | { kind: "roadmap"; candidate: RoadmapCandidate }
  | { kind: "message_center"; candidate: MessageCenterCandidate }
  | { kind: "manual" };

export function AuthorInterpretationDrawer({
  source, onClose, onCreated,
}: {
  source: CandidateSource;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const title = source.kind === "manual" ? "" : source.candidate.title;
  const [fields, setFields] = useState<FieldsState>(emptyFields({ title }));
  const [proposedBy, setProposedBy] = useState<"ai" | "human">("human");
  const [aiModel, setAiModel] = useState<string | null>(null);
  const [aiRationale, setAiRationale] = useState<string | null>(null);
  const [confirmNow, setConfirmNow] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);

  const checksQuery = useAvailableChecks();
  const propose = useProposeInterpretation();
  const create = useCreateInterpretation();

  const canPropose = source.kind === "roadmap" || source.kind === "message_center";

  const runPropose = () => {
    if (!canPropose) return;
    setProposeError(null);
    const body = source.kind === "roadmap" ? { featureId: source.candidate.featureId } : { graphMessageId: source.candidate.graphMessageId };
    propose.mutate(body, {
      onSuccess: (res) => {
        const p = res.proposal;
        setFields((f) => ({
          ...f,
          title: res.title,
          summary: p.summary ?? "",
          changeClass: p.changeClass,
          whoActs: p.whoActs,
          controllable: p.controllable,
          controlMethod: p.controlMethod ?? "",
          services: (p.touches?.services ?? []).join(", "),
          protocols: (p.touches?.protocols ?? []).join(", "),
          skus: (p.touches?.skus ?? []).join(", "),
          settings: (p.touches?.settings ?? []).join(", "),
          probeDescription: p.probe?.description ?? "",
          monitorCheckKey: p.probe?.monitorCheckKey ?? "",
          powershell: p.probe?.powershell ?? "",
          graphEndpoint: p.probe?.graphEndpoint ?? "",
        }));
        setProposedBy("ai");
        setAiModel(p.aiModel ?? null);
        setAiRationale(p.aiRationale ?? null);
      },
      onError: (err) => setProposeError(err instanceof Error ? err.message : "The AI reading could not be produced. Author it by hand below instead."),
    });
  };

  const canSubmit = fields.title.trim().length > 0 && fields.probeDescription.trim().length > 0 && !create.isPending;

  const submit = () => {
    if (!canSubmit) return;
    create.mutate(
      {
        featureId: source.kind === "roadmap" ? source.candidate.featureId : null,
        graphMessageId: source.kind === "message_center" ? source.candidate.graphMessageId : null,
        sourceKind: source.kind,
        title: fields.title.trim(),
        summary: fields.summary.trim() || null,
        changeClass: fields.changeClass,
        touches: fieldsToTouches(fields),
        whoActs: fields.whoActs,
        controllable: fields.controllable,
        controlMethod: fields.controllable === "yes" ? fields.controlMethod.trim() || null : null,
        probe: fieldsToProbe(fields),
        proposedBy,
        aiModel,
        aiRationale,
        notes: fields.notes.trim() || null,
        status: confirmNow ? "confirmed" : "proposed",
      },
      {
        onSuccess: (res) => {
          toast.success(confirmNow ? "Interpretation authored and confirmed." : "Interpretation saved — confirm it when ready to apply it to tenants.");
          onCreated(res.interpretation.id);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save the interpretation."),
      },
    );
  };

  const sourceLabel =
    source.kind === "roadmap" ? "Microsoft 365 Roadmap"
    : source.kind === "message_center" ? "Message Center"
    : "Authored by hand — no source announcement";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px,96%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "#93c5fd" }}>AUTHOR AN INTERPRETATION</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: "#f8fafc", letterSpacing: "-.01em", textWrap: "pretty" }}>{sourceLabel}</span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        {canPropose && (
          <div style={{ border: `1px solid ${signal.info.border}`, borderRadius: 10, background: signal.info.tint, padding: 13, display: "flex", flexDirection: "column", gap: 9 }}>
            <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>
              An AI reading can pre-fill this form from the source's own text — review and edit everything before saving. Nothing is applied to a tenant until you confirm it below.
            </span>
            <button
              type="button"
              onClick={runPropose}
              disabled={propose.isPending}
              style={{ alignSelf: "flex-start", height: 30, padding: "0 12px", borderRadius: 7, border: "1px solid rgba(96,165,250,.35)", background: "rgba(37,99,235,.18)", color: "#bfdbfe", fontSize: 12, fontWeight: 600, cursor: propose.isPending ? "wait" : "pointer" }}
            >
              {propose.isPending ? "Reading…" : "Propose a reading with AI"}
            </button>
            {proposeError && <span style={{ fontSize: 11.5, color: signal.warning.strong, textWrap: "pretty" }}>{proposeError}</span>}
            {proposedBy === "ai" && aiRationale && (
              <div style={{ borderTop: `1px solid ${border.soft}`, paddingTop: 9, display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", color: text.label }}>WHY THE AI READ IT THIS WAY</span>
                <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{aiRationale}</span>
              </div>
            )}
          </div>
        )}

        <InterpretationFields
          state={fields}
          checks={checksQuery.data ?? []}
          onChange={(key, value) => setFields((f) => ({ ...f, [key]: value }))}
        />

        <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer" }}>
          <input type="checkbox" checked={confirmNow} onChange={(e) => setConfirmNow(e.target.checked)} style={{ marginTop: 3 }} />
          <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
            Confirm this immediately. Leave unchecked to save it for review first — only a confirmed interpretation can be resolved against tenants or routed.
          </span>
        </label>

        <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
          <button
            onClick={submit}
            disabled={!canSubmit}
            title={canSubmit ? "" : "A title and a probe (what to count) are both required"}
            style={{
              flex: 1, height: 38, borderRadius: 8, border: `1px solid ${canSubmit ? "#2563eb" : border.card}`,
              background: canSubmit ? "#2563eb" : "transparent", color: canSubmit ? "#fff" : text.label,
              fontSize: 13, fontWeight: 600, cursor: canSubmit ? "pointer" : "not-allowed", opacity: canSubmit ? 1 : 0.6,
            }}
          >
            {create.isPending ? "Saving…" : confirmNow ? "Save and confirm" : "Save for review"}
          </button>
          <button onClick={onClose} style={{ height: 38, padding: "0 15px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
