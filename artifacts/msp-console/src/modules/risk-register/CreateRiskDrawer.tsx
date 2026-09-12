/**
 * "Accept a risk" drawer — `POST /api/msp/rbd`. Fields follow the design's
 * create drawer (`Risk Register.dc.html`'s `createOpen` panel) with one
 * necessary difference: `createRbdSchema` requires several real, non-optional
 * columns (`controlViolated`, `clientApprover.email`, `expirationDate`) the
 * design's own minimal mock form never pictured a widget for. Those are added
 * here as real inputs rather than sent as fabricated/empty values — see the
 * per-field comments below for which fields are design-verbatim and which are
 * additive.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { border, text } from "@/console/tokens";
import type { DirectoryCustomer } from "@/api/console-api";
import {
  useCreateRbd, type AvailableCheck, type AvailableObligation,
  type RawRiskLevel, type ResidualRiskLevel,
} from "@/api/rbd-api";
import { generateRbdId, representativeScore } from "./format";

const RAW_CHOICES: RawRiskLevel[] = ["critical", "high", "medium"];
const RESIDUAL_CHOICES: ResidualRiskLevel[] = ["high", "medium", "low"];
const FRAMEWORK_CHOICES = ["CIS v8", "HIPAA Security Rule", "SOC 2 CC6.1", "customer authority"];

const inputStyle: React.CSSProperties = {
  height: 36, padding: "0 11px", borderRadius: 8, border: `1px solid ${border.card}`,
  background: "rgba(2,6,23,.6)", color: "#f1f5f9", fontSize: 13, outline: "none", width: "100%",
};

/** "Dana Whitfield, Operations Director" → { name, title }. No delimiter found
 * (a bare name) → title is left blank rather than guessed. */
function splitNameAndTitle(value: string): { name: string; title: string } {
  const trimmed = value.trim();
  const idx = trimmed.search(/[,–-]/);
  if (idx === -1) return { name: trimmed, title: "" };
  return { name: trimmed.slice(0, idx).trim(), title: trimmed.slice(idx + 1).trim() };
}

export function CreateRiskDrawer({
  customer, checks, obligations, onClose, onCreated,
}: {
  customer: DirectoryCustomer;
  scopedCount: number;
  checks: AvailableCheck[];
  obligations: AvailableObligation[];
  onClose: () => void;
  onCreated: (rbdId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [controlViolated, setControlViolated] = useState("");
  const [raw, setRaw] = useState<RawRiskLevel>("high");
  const [residual, setResidual] = useState<ResidualRiskLevel>("medium");
  const [framework, setFramework] = useState("CIS v8");
  const [liability, setLiability] = useState("");
  const [approverNameRole, setApproverNameRole] = useState("");
  const [approverEmail, setApproverEmail] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [checkKey, setCheckKey] = useState("");
  const [obligationId, setObligationId] = useState("");

  const createRbd = useCreateRbd();

  const canSubmit =
    title.trim().length > 0 &&
    controlViolated.trim().length > 0 &&
    approverNameRole.trim().length > 0 &&
    approverEmail.trim().length > 0 &&
    expirationDate.trim().length > 0 &&
    !createRbd.isPending;

  const submit = () => {
    if (!canSubmit || !customer.tenantId) return;
    const { name, title: approverTitle } = splitNameAndTitle(approverNameRole);
    const liabilityValueUsd = Math.max(0, Math.round(Number(liability.replace(/[^0-9.]/g, "")) || 0));
    createRbd.mutate(
      {
        rbdId: generateRbdId(),
        tenantId: customer.tenantId,
        tenantName: customer.name,
        primaryDomain: customer.domain ?? "",
        title: title.trim(),
        controlViolated: controlViolated.trim(),
        framework,
        rawRiskLevel: raw,
        residualRiskLevel: residual,
        // The design's chooser collects only the qualitative level; the score
        // is a documented representative band (format.ts) rather than a
        // hand-typed number the design never asked for.
        rawRiskScore: representativeScore(raw),
        residualRiskScore: representativeScore(residual),
        liabilityValueUsd,
        // No separate hazard-narrative field in the design's create drawer —
        // the same real, user-authored text is reused for both columns.
        hazardDescription: title.trim(),
        graphEndpoint: "",
        compensatingControls: [],
        clientApprover: { name, title: approverTitle, email: approverEmail.trim() },
        expirationDate,
        status: "pending_signature",
        checkKey: checkKey || null,
        obligationId: obligationId ? Number(obligationId) : null,
      },
      {
        onSuccess: (result) => {
          toast.success(`${result.registerRef} recorded — awaiting the customer's signature.`);
          onCreated(result.rbdId);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Could not save the decision.");
        },
      },
    );
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(470px,94%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "#93c5fd" }}>ACCEPT A RISK · POST /api/msp/rbd</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: "#f8fafc", letterSpacing: "-.01em" }}>New risk decision</span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <Field label="What is being accepted">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Legacy authentication left enabled for one mailbox" style={inputStyle} />
        </Field>

        <Field label="Control or requirement being violated">
          <input value={controlViolated} onChange={(e) => setControlViolated(e.target.value)} placeholder="e.g. IA-2 · multifactor authentication" style={inputStyle} />
        </Field>

        <Chooser label="Risk before controls" hint="How bad this is with nothing in place." options={RAW_CHOICES} value={raw} onPick={(v) => setRaw(v as RawRiskLevel)} />
        <Chooser label="Risk after controls" hint="What is left once the compensating controls are counted." options={RESIDUAL_CHOICES} value={residual} onPick={(v) => setResidual(v as ResidualRiskLevel)} />
        <Chooser label="Authority" hint="Which standard this decision is measured against." options={FRAMEWORK_CHOICES} value={framework} onPick={setFramework} />

        <Field label="What it would cost if it went wrong">
          <input value={liability} onChange={(e) => setLiability(e.target.value)} placeholder="e.g. 120000" style={inputStyle} />
          <Hint>Entered by hand and recorded as typed. Nothing in the platform derives or checks this figure.</Hint>
        </Field>

        <Field label="Who signs for the customer">
          <input value={approverNameRole} onChange={(e) => setApproverNameRole(e.target.value)} placeholder="Name and role" style={inputStyle} />
          <Hint>Saved unsigned. It stays pending until their signature is captured, and only an admin can record that.</Hint>
        </Field>

        <Field label="Their email">
          <input type="email" value={approverEmail} onChange={(e) => setApproverEmail(e.target.value)} placeholder="name@customerdomain.com" style={inputStyle} />
        </Field>

        <Field label="When this acceptance expires">
          <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} style={inputStyle} />
        </Field>

        {checks.length > 0 && (
          <Field label="Link to a monitor check (optional)">
            <select value={checkKey} onChange={(e) => setCheckKey(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
              <option value="">Not linked to an automated check</option>
              {checks.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <Hint>Populating this suppresses the finding from re-firing while this decision is active.</Hint>
          </Field>
        )}

        {obligations.length > 0 && (
          <Field label="Cite an authority (optional)">
            <select value={obligationId} onChange={(e) => setObligationId(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
              <option value="">No specific citation</option>
              {obligations.map((o) => <option key={o.obligationId} value={o.obligationId}>{o.citation} — {o.requires}</option>)}
            </select>
          </Field>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
          <button
            onClick={submit}
            disabled={!canSubmit}
            title={canSubmit ? "" : "A title, control, approver name, email and expiration date are all needed"}
            style={{
              flex: 1, height: 38, borderRadius: 8, border: `1px solid ${canSubmit ? "#2563eb" : border.card}`,
              background: canSubmit ? "#2563eb" : "transparent", color: canSubmit ? "#fff" : text.label,
              fontSize: 13, fontWeight: 600, cursor: canSubmit ? "pointer" : "not-allowed", opacity: canSubmit ? 1 : 0.6,
            }}
          >
            {createRbd.isPending ? "Saving…" : "Save for signature"}
          </button>
          <button onClick={onClose} style={{ height: 38, padding: "0 15px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>{label}</span>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>{children}</span>;
}

function Chooser<T extends string>({
  label, hint, options, value, onPick,
}: { label: string; hint: string; options: T[]; value: T; onPick: (v: T) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>{label}</span>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {options.map((o) => {
          const active = value === o;
          return (
            <button
              key={o}
              onClick={() => onPick(o)}
              style={{
                height: 30, padding: "0 11px", borderRadius: 7,
                border: `1px solid ${active ? "rgba(96,165,250,.32)" : border.card}`,
                background: active ? "rgba(37,99,235,.18)" : "transparent",
                color: active ? "#bfdbfe" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {o}
            </button>
          );
        })}
      </div>
      <Hint>{hint}</Hint>
    </div>
  );
}
