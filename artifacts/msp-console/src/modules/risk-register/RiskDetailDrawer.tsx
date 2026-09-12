/**
 * The RBD detail drawer — Decision / Affected objects / Documents / Changes.
 * Each write action's eyebrow names the exact route it calls (README
 * "Drawers": "keep those visible; operators use them to reason about what a
 * button actually does").
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import {
  useAcceptRiskInstance, useAddRiskInstance, useCaptureRbdVersion,
  useRbdInstances, useRbdNarrativeAudit, useRbdVersions, useResolveRiskInstance,
  useRevokeRbd, useShareRbdVersion, useSignRbd,
  type RbdRow, type RiskInstance,
} from "@/api/rbd-api";
import {
  controlToneAndIcon, formatDate, formatDateTime, instanceIcon, instanceStatusLabel,
  instanceTone, levelTone, money, sha256Hex, statusLabel, statusTone, tone,
} from "./format";

type Panel = "decision" | "items" | "versions" | "audit";

export function RiskDetailDrawer({ row, onClose }: { row: RbdRow; onClose: () => void }) {
  const [panel, setPanel] = useState<Panel>("decision");
  const instancesQuery = useRbdInstances(row.rbdId);
  const versionsQuery = useRbdVersions(row.rbdId);
  const auditQuery = useRbdNarrativeAudit(row.rbdId);

  // Every overlay resets when the selection changes (README "State").
  useEffect(() => { setPanel("decision"); }, [row.rbdId]);

  const itemCount = instancesQuery.data?.length ?? 0;
  const versionCount = versionsQuery.data?.length ?? 0;
  const auditCount = auditQuery.data?.length ?? 0;

  const tabs: { id: Panel; label: string; count: number }[] = [
    { id: "decision", label: "Decision", count: -1 },
    { id: "items", label: "Affected objects", count: itemCount },
    { id: "versions", label: "Documents", count: versionCount },
    { id: "audit", label: "Changes", count: auditCount },
  ];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(540px,95%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
            <span style={{ fontFamily: "Menlo,monospace", fontSize: 10.5, color: text.label }}>{row.registerRef ?? row.rbdId} · {row.tenantName}</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: "#f8fafc", letterSpacing: "-.01em", textWrap: "pretty" }}>{row.title}</span>
            <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>{row.hazardDescription}</span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {tabs.map((t) => {
            const active = panel === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setPanel(t.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 7,
                  border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
                  background: active ? "rgba(37,99,235,.18)" : "transparent",
                  color: active ? "#bfdbfe" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {t.label}
                {t.count >= 0 && <span style={{ fontSize: 10, color: active ? "#60a5fa" : text.faint }}>{t.count}</span>}
              </button>
            );
          })}
        </div>

        {panel === "decision" && <DecisionPanel row={row} />}
        {panel === "items" && <ItemsPanel row={row} query={instancesQuery} />}
        {panel === "versions" && <VersionsPanel row={row} query={versionsQuery} />}
        {panel === "audit" && <AuditPanel query={auditQuery} versionCount={versionCount} />}
      </div>
    </div>
  );
}

// ── Decision ─────────────────────────────────────────────────────────────────

function DecisionPanel({ row }: { row: RbdRow }) {
  const [signOpen, setSignOpen] = useState(false);
  const [armedRevoke, setArmedRevoke] = useState(false);
  const revokeRbd = useRevokeRbd();

  useEffect(() => {
    if (!armedRevoke) return;
    const t = setTimeout(() => setArmedRevoke(false), 4000);
    return () => clearTimeout(t);
  }, [armedRevoke]);

  const rawT = levelTone(row.rawRiskLevel);
  const resT = levelTone(row.residualRiskLevel);
  const stT = statusTone(row.status);
  const signT = row.status === "active" ? tone("green") : row.status === "revoked" ? tone("slate") : tone("amber");
  const signIcon = row.status === "active" ? "file-check" : row.status === "revoked" ? "file-x" : "file-clock";

  const facts: { label: string; value: string; color: string; mono?: boolean }[] = [
    { label: "RAW RISK", value: `${row.rawRiskLevel} · ${row.rawRiskScore}`, color: rawT[0] },
    { label: "AFTER CONTROLS", value: `${row.residualRiskLevel} · ${row.residualRiskScore}`, color: resT[0] },
    { label: "EXPOSURE", value: money(row.liabilityValueUsd), color: text.body },
    { label: "CONTROL", value: row.controlViolated, color: text.secondary },
    { label: "AUTHORITY", value: row.framework, color: text.secondary },
    { label: "MONITORED BY", value: row.checkKey ?? "not linked to a check", color: row.checkKey ? "#93c5fd" : text.faint, mono: !!row.checkKey },
    { label: "STATUS", value: statusLabel(row.status), color: stT[0] },
    { label: "ACCEPTED UNTIL", value: formatDate(row.expirationDate), color: text.muted },
    { label: "NEXT REVIEW", value: row.reviewDate ?? "not scheduled", color: row.reviewState === "overdue" ? "#fcd34d" : text.muted },
  ];

  const revoke = () => {
    if (!armedRevoke) { setArmedRevoke(true); return; }
    revokeRbd.mutate(row.rbdId, {
      onSuccess: () => { toast.success("Acceptance revoked. The risk is open again."); setArmedRevoke(false); },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Revoke failed."),
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 11 }}>
        {facts.map((f) => (
          <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{f.label}</span>
            <span style={{ fontSize: 12.5, color: f.color, fontFamily: f.mono ? "Menlo,monospace" : "inherit", textWrap: "pretty" }}>{f.value}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>WHAT KEEPS THIS SURVIVABLE</span>
        {row.compensatingControls.length === 0 && (
          <span style={{ fontSize: 12, color: text.label }}>No compensating controls recorded.</span>
        )}
        {row.compensatingControls.map((c, i) => {
          const [color, icon] = controlToneAndIcon(c.type);
          return (
            <div key={i} style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 9, border: `1px solid ${border.soft}`, background: "rgba(2,6,23,.4)", minWidth: 0 }}>
              <Icon name={icon} size={14} color={color} style={{ flex: "0 0 14px", marginTop: 2 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color }}>{c.type}</span>
                <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{c.description}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>WHO SIGNED IT</span>
        <div style={{ display: "flex", gap: 11, padding: 12, borderRadius: 10, border: `1px solid ${signT[2]}`, background: signT[1], minWidth: 0 }}>
          <span style={{ width: 26, height: 26, flex: "0 0 26px", borderRadius: 8, background: signT[1], border: `1px solid ${signT[2]}`, color: signT[0], display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name={signIcon} size={14} />
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: text.title, textWrap: "pretty" }}>{row.clientApprover.name}{row.clientApprover.title ? ` · ${row.clientApprover.title}` : ""}</span>
            <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
              {row.status === "revoked"
                ? `Signed ${row.clientApprover.signedAt ?? "—"}, later revoked`
                : row.clientApprover.signedAt
                  ? `Signed ${row.clientApprover.signedAt}`
                  : "Recorded as the approver, not yet signed"}
            </span>
            <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>Assessed by {row.mspAssessor.name} · {formatDate(row.mspAssessor.timestamp)}</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {row.status === "pending_signature" && (
            <>
              <ActionButton icon="signature" label="Record their signature" primary title="PATCH /api/msp/rbd/:rbdId/sign" onClick={() => setSignOpen(true)} />
              <ActionButton icon="ban" label={armedRevoke ? "Click again to withdraw" : "Withdraw"} danger title="PATCH /api/msp/rbd/:rbdId/revoke" onClick={revoke} busy={revokeRbd.isPending} />
            </>
          )}
          {row.status === "active" && (
            <>
              <ActionButton icon="ban" label={armedRevoke ? "Click again to confirm" : "Revoke this acceptance"} danger title="PATCH /api/msp/rbd/:rbdId/revoke" onClick={revoke} busy={revokeRbd.isPending} />
            </>
          )}
          {row.status === "revoked" && (
            <ActionButton icon="lock" label="Revoked" disabled title="A revoked decision is closed for good — raise a new one instead" onClick={() => {}} />
          )}
          {row.status === "converted_to_poam" && (
            <ActionButton icon="lock" label="Converted to a POA&M" disabled title="This acceptance was converted to a remediation plan and is closed for good." onClick={() => {}} />
          )}
        </div>
        <span style={{ fontSize: 11.5, color: row.status === "active" ? "#fcd34d" : text.label, textWrap: "pretty" }}>
          {row.status === "pending_signature"
            ? "The signature recorded here is the customer's, captured by whoever is sitting with them. Nothing is accepted until it lands."
            : row.status === "active"
              ? "Revoking is permanent. The risk goes back to open and unaccepted — it does not become remediated."
              : "This record stays on the register as history."}
        </span>
      </div>

      {signOpen && <SignRbdModal row={row} onClose={() => setSignOpen(false)} />}
    </div>
  );
}

function ActionButton({
  icon, label, title, onClick, primary, danger, disabled, busy,
}: { icon: string; label: string; title: string; onClick: () => void; primary?: boolean; danger?: boolean; disabled?: boolean; busy?: boolean }) {
  const isDisabled = disabled || busy;
  const line = primary ? "#2563eb" : danger ? "rgba(248,113,113,.3)" : "rgba(148,163,184,.2)";
  const bg = primary ? "#2563eb" : danger ? "rgba(248,113,113,.1)" : "transparent";
  const fg = primary ? "#fff" : danger ? "#fca5a5" : "#64748b";
  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      title={title}
      style={{
        display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 12px", borderRadius: 8,
        border: `1px solid ${line}`, background: bg, color: fg, fontSize: 12.5, fontWeight: 600,
        cursor: isDisabled ? "not-allowed" : "pointer", opacity: isDisabled ? 0.6 : 1, whiteSpace: "nowrap",
      }}
    >
      <Icon name={icon} size={13} />
      {busy ? "Working…" : label}
    </button>
  );
}

function SignRbdModal({ row, onClose }: { row: RbdRow; onClose: () => void }) {
  const [name, setName] = useState(row.clientApprover.name);
  const [title, setTitle] = useState(row.clientApprover.title);
  const [email, setEmail] = useState(row.clientApprover.email);
  const [ipAddress, setIpAddress] = useState("");
  const signRbd = useSignRbd();

  const canSubmit = name.trim().length > 0 && email.trim().length > 0 && !signRbd.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    // No live in-browser signing ceremony on this route (`msp-rbd.ts`'s own
    // comment: an operator attesting to a signature captured off-platform) —
    // `signatureHash` is a real sha256 of what was actually typed, computed
    // client-side because this route's contract puts that burden on the
    // caller, matching `portal-rbd-document.ts`'s server-side formula shape.
    const signatureHash = await sha256Hex([row.rbdId, name.trim(), new Date().toISOString()].join("\x00"));
    signRbd.mutate(
      { rbdId: row.rbdId, name: name.trim(), title: title.trim(), email: email.trim(), ipAddress: ipAddress.trim(), signatureHash },
      {
        onSuccess: () => { toast.success("Signature recorded. The decision is now active."); onClose(); },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Sign failed."),
      },
    );
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.75)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px,90%)", background: "#0f172a", border: `1px solid ${border.card}`, borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "#93c5fd" }}>RECORD THEIR SIGNATURE · PATCH /api/msp/rbd/{row.rbdId}/sign</span>
        <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>
          Record the customer's signature exactly as captured off-platform — a wet-signature page, a phone confirmation, an emailed reply. This does not draw a new signature; it attests to one already given.
        </span>
        <LabeledInput label="Name" value={name} onChange={setName} />
        <LabeledInput label="Title" value={title} onChange={setTitle} />
        <LabeledInput label="Email" value={email} onChange={setEmail} type="email" />
        <LabeledInput label="IP address (if known)" value={ipAddress} onChange={setIpAddress} placeholder="optional" />
        <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
          <button onClick={() => void submit()} disabled={!canSubmit} style={{ flex: 1, height: 36, borderRadius: 8, border: `1px solid ${canSubmit ? "#2563eb" : border.card}`, background: canSubmit ? "#2563eb" : "transparent", color: canSubmit ? "#fff" : text.label, fontSize: 12.5, fontWeight: 600, cursor: canSubmit ? "pointer" : "not-allowed" }}>
            {signRbd.isPending ? "Recording…" : "Record signature"}
          </button>
          <button onClick={onClose} style={{ height: 36, padding: "0 14px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function LabeledInput({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: text.secondary }}>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ height: 32, padding: "0 10px", borderRadius: 7, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: "#f1f5f9", fontSize: 12.5, outline: "none" }} />
    </div>
  );
}

// ── Affected objects ─────────────────────────────────────────────────────────

function ItemsPanel({ row, query }: { row: RbdRow; query: ReturnType<typeof useRbdInstances> }) {
  const [newItem, setNewItem] = useState("");
  const addInstance = useAddRiskInstance();
  const acceptInstance = useAcceptRiskInstance();
  const resolveInstance = useResolveRiskInstance();

  if (query.isLoading) return <span style={{ fontSize: 12, color: text.label }}>Loading affected objects…</span>;
  if (query.isError) return <span style={{ fontSize: 12, color: signal.warning.text }}>GET .../instances failed.</span>;

  const items = query.data ?? [];

  const addNow = () => {
    if (!newItem.trim()) return;
    addInstance.mutate({ rbdId: row.rbdId, label: newItem.trim() }, {
      onSuccess: () => setNewItem(""),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Could not add the object."),
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.length === 0 && <span style={{ fontSize: 12, color: text.label }}>No affected objects recorded yet.</span>}
      {items.map((i) => (
        <InstanceRow key={i.id} rbdId={row.rbdId} instance={i} onAccept={acceptInstance} onResolve={resolveInstance} />
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addNow(); }}
          placeholder="Add another affected object"
          style={{ flex: 1, minWidth: 0, height: 32, padding: "0 11px", borderRadius: 8, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.5)", color: text.body, fontSize: 12.5, outline: "none" }}
        />
        <button onClick={addNow} disabled={addInstance.isPending} style={{ height: 32, padding: "0 12px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          {addInstance.isPending ? "Adding…" : "Add"}
        </button>
      </div>
      <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
        Accepting an object is final — it can be resolved later, but never un-accepted. Adding an object after the current document was signed needs a fresh signature.
      </span>
    </div>
  );
}

function InstanceRow({
  rbdId, instance, onAccept, onResolve,
}: { rbdId: string; instance: RiskInstance; onAccept: ReturnType<typeof useAcceptRiskInstance>; onResolve: ReturnType<typeof useResolveRiskInstance> }) {
  const t = instanceTone(instance.status);
  const meta = `Found ${formatDate(instance.foundAt)}${instance.acceptedAt ? ` · accepted ${formatDate(instance.acceptedAt)}` : " · not yet accepted"}`;

  return (
    <div style={{ display: "flex", gap: 11, padding: 12, borderRadius: 10, border: `1px solid ${border.soft}`, background: "rgba(2,6,23,.4)", minWidth: 0, alignItems: "flex-start" }}>
      <span style={{ width: 26, height: 26, flex: "0 0 26px", borderRadius: 8, background: t[1], border: `1px solid ${t[2]}`, color: t[0], display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={instanceIcon(instance.status)} size={13} />
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: text.title, textWrap: "pretty" }}>{instance.label}</span>
        {instance.objectId && <span style={{ fontFamily: "Menlo,monospace", fontSize: 10.5, color: text.label, wordBreak: "break-all" }}>{instance.objectId}</span>}
        <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{meta}</span>
        {instance.resolutionNote && <span style={{ fontSize: 11.5, color: "#6ee7b7", textWrap: "pretty" }}>{instance.resolutionNote}</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "0 0 auto", alignItems: "flex-end" }}>
        <span style={{ display: "inline-flex", padding: "3px 9px", borderRadius: 999, background: t[1], border: `1px solid ${t[2]}`, fontSize: 10.5, fontWeight: 600, color: t[0], whiteSpace: "nowrap" }}>
          {instanceStatusLabel(instance.status)}
        </span>
        {instance.status === "active" && !instance.acceptedAt && (
          <button
            onClick={() => onAccept.mutate({ rbdId, instanceId: instance.id }, { onError: (err) => toast.error(err instanceof Error ? err.message : "Accept failed.") })}
            title="Final — an accepted object cannot be un-accepted"
            style={{ height: 27, padding: "0 10px", borderRadius: 7, border: "1px solid rgba(96,165,250,.3)", background: "rgba(37,99,235,.14)", color: "#bfdbfe", fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Accept
          </button>
        )}
        {instance.status === "active" && instance.acceptedAt && (
          <button
            onClick={() => onResolve.mutate({ rbdId, instanceId: instance.id, reason: "remediated" }, { onError: (err) => toast.error(err instanceof Error ? err.message : "Resolve failed.") })}
            title="Records that this object no longer carries the risk"
            style={{ height: 27, padding: "0 10px", borderRadius: 7, border: "1px solid rgba(52,211,153,.3)", background: "rgba(52,211,153,.12)", color: "#6ee7b7", fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Resolve
          </button>
        )}
      </div>
    </div>
  );
}

// ── Documents (versions) ─────────────────────────────────────────────────────

function VersionsPanel({ row, query }: { row: RbdRow; query: ReturnType<typeof useRbdVersions> }) {
  const captureVersion = useCaptureRbdVersion();
  const shareVersion = useShareRbdVersion();
  const [shareTokens, setShareTokens] = useState<Record<string, string>>({});

  if (query.isLoading) return <span style={{ fontSize: 12, color: text.label }}>Loading document history…</span>;
  if (query.isError) return <span style={{ fontSize: 12, color: signal.warning.text }}>GET .../versions failed.</span>;

  const versions = query.data ?? [];

  const capture = () => {
    captureVersion.mutate({ rbdId: row.rbdId, tenantId: row.tenantId, tenantName: row.tenantName }, {
      onSuccess: (v) => toast.success(`Version ${v.versionNumber} captured.`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Capture failed."),
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      <button
        onClick={capture}
        disabled={captureVersion.isPending}
        title="POST /api/msp/rbd/:rbdId/versions"
        style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 12px", borderRadius: 8, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: captureVersion.isPending ? "wait" : "pointer" }}
      >
        <Icon name="camera" size={13} />
        {captureVersion.isPending ? "Capturing…" : "Capture the document as it stands"}
      </button>

      {versions.length === 0 && <span style={{ fontSize: 12, color: text.label }}>No version has been captured for this decision yet.</span>}

      {versions.map((v) => {
        const t = tone(v.signed ? "green" : v.requiresSignature ? "amber" : "slate");
        const token = shareTokens[v.versionUid];
        const canShare = v.isCurrent && !v.signed;
        return (
          <div key={v.versionUid} style={{ border: `1px solid ${v.isCurrent ? "rgba(96,165,250,.24)" : border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 13, display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: text.title }}>Version {v.versionNumber}</span>
              {v.isCurrent && <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 999, background: "rgba(96,165,250,.12)", border: "1px solid rgba(96,165,250,.28)", fontSize: 10.5, fontWeight: 600, color: "#93c5fd" }}>current</span>}
              <div style={{ flex: 1 }} />
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 999, background: t[1], border: `1px solid ${t[2]}`, fontSize: 10.5, fontWeight: 600, color: t[0], whiteSpace: "nowrap" }}>
                <Icon name={v.signed ? "file-check" : "file-clock"} size={11} />
                {v.signed ? (v.signatureInherited ? `signature carried over from ${v.signatureInheritedFromVersionUid ?? "a prior version"}` : "signed") : v.requiresSignature ? "needs a signature" : "no signature needed"}
              </span>
            </div>
            <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
              {v.scopeInstanceIds.length} object{v.scopeInstanceIds.length === 1 ? "" : "s"} in scope
              {v.scopeAddedInstanceIds.length > 0 ? ` · ${v.scopeAddedInstanceIds.length} added` : ""}
              {v.scopeRemovedInstanceIds.length > 0 ? ` · ${v.scopeRemovedInstanceIds.length} removed` : ""}
            </span>
            <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>Captured {formatDateTime(v.createdAt)}</span>
            {canShare && (
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                <button
                  onClick={() => shareVersion.mutate({ rbdId: row.rbdId, versionUid: v.versionUid }, {
                    onSuccess: (r) => setShareTokens((prev) => ({ ...prev, [v.versionUid]: r.shareToken })),
                    onError: (err) => toast.error(err instanceof Error ? err.message : "Share failed."),
                  })}
                  disabled={shareVersion.isPending}
                  title="POST /api/msp/rbd/:rbdId/versions/:versionUid/share"
                  style={{ display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 7, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  <Icon name="link" size={12} />
                  {token ? "Link created" : "Send for signature"}
                </button>
              </div>
            )}
            {token && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 10, borderRadius: 9, border: "1px solid rgba(96,165,250,.22)", background: "rgba(37,99,235,.08)" }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "#93c5fd" }}>SHARE LINK · EXPIRES IN 30 DAYS</span>
                <span style={{ fontFamily: "Menlo,monospace", fontSize: 11, color: text.secondary, wordBreak: "break-all" }}>{token}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Changes (narrative audit) ────────────────────────────────────────────────

function AuditPanel({ query, versionCount }: { query: ReturnType<typeof useRbdNarrativeAudit>; versionCount: number }) {
  if (query.isLoading) return <span style={{ fontSize: 12, color: text.label }}>Loading change history…</span>;
  if (query.isError) return <span style={{ fontSize: 12, color: signal.warning.text }}>GET .../narrative-audit failed.</span>;

  const audit = query.data ?? [];
  if (audit.length === 0) {
    return (
      <div style={{ border: `1px solid ${border.card}`, borderRadius: 11, background: surface.card, padding: "34px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 9, textAlign: "center" }}>
        <span style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(96,165,250,.1)", border: "1px solid rgba(96,165,250,.22)", color: "#60a5fa", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="file-clock" size={18} />
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>No wording changes recorded</span>
        <span style={{ fontSize: 12, color: text.muted, maxWidth: 380, textWrap: "pretty" }}>
          {versionCount < 2
            ? "There is only one version of this document, so there is nothing to compare it against yet."
            : "Later versions changed what was in scope, but not the wording, the controls or the scores."}
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {audit.map((a) => (
        <div key={a.toVersionUid} style={{ border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 13, display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: text.title }}>
            {a.fromVersionUid ? `${a.fromVersionUid.slice(0, 8)} → ${a.toVersionUid.slice(0, 8)}` : `→ ${a.toVersionUid.slice(0, 8)}`}
          </span>
          {Object.entries(a.changedFields).map(([field, change]) => (
            <div key={field} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{field.toUpperCase()}</span>
              <div style={{ display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "#fca5a5", textDecoration: "line-through", textWrap: "pretty" }}>{String(change.from)}</span>
                <Icon name="arrow-right" size={12} color={text.faint} />
                <span style={{ fontSize: 12, color: "#6ee7b7", textWrap: "pretty" }}>{String(change.to)}</span>
              </div>
            </div>
          ))}
          <span style={{ fontSize: 11, color: text.label }}>{formatDateTime(a.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}
