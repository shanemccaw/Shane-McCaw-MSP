/**
 * Security Plan module page (Git #2603, Feature #1689), mounted by `ConsoleShell` at
 * `/tenants/:id/sp`. **No Claude Design export exists for this screen** (#2602 never
 * landed) — Shane authorized building directly against the real endpoints rather than
 * waiting on a design pass (2026-09-15). See the visible banner below, not just this
 * comment — it must render, not just be documented.
 *
 * Wired per `docs/msp-console/security-plan-msp-console-contract-pack.md` (#4082) and
 * `docs/portal/security-plan-contract-pack.md` against the real
 * `/api/msp/security-plan/:customerId/*` routes (`msp-security-plan.ts`). The fixed
 * authoring sequence (#1566) is freeze -> author prose against the frozen state -> seal;
 * sealing consumes the draft. #1689/#3793 dual signature: this screen only ever signs
 * the MSP's own, independent slot — the customer signs their own slot in the portal,
 * and neither signature blocks or satisfies the other.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import type { DirectoryCustomer } from "@/api/console-api";
import {
  useAssembledSecurityPlan,
  useSecurityPlanDraft,
  useFreezeSecurityPlanDraft,
  useUpdateSecurityPlanDraftProse,
  useSealSecurityPlanVersion,
  useSecurityPlanVersions,
  useCurrentSecurityPlanVersion,
  useSignSecurityPlanVersionAsMsp,
  useSecurityPlanDrift,
  SECURITY_PLAN_PROSE_SECTIONS,
  type SecurityPlanContent,
  type SecurityPlanProseSection,
  type SecurityPlanVersion,
} from "@/api/security-plan-api";

type Tab = "draft" | "versions" | "drift";

const PROSE_LABELS: Record<SecurityPlanProseSection, string> = {
  scope: "Scope",
  methodology: "Methodology",
  exclusions: "Exclusions",
  executiveSummary: "Executive summary",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function apiStatus(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

function Pill({ label, tone }: { label: string; tone: { text?: string; strong: string; tint: string; border: string } }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", height: 21, padding: "0 9px",
      borderRadius: 999, background: tone.tint, border: `1px solid ${tone.border}`,
      fontSize: 10.5, fontWeight: 600, color: tone.text ?? tone.strong,
    }}>
      {label}
    </span>
  );
}

/** Dashed-border, non-intrusive agent-built marker (#2603 build requirement 2). Must
 * render visibly, not just document the fact in a comment. */
function AgentBuiltBanner() {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap",
      border: `1px dashed ${signal.warning.border}`, borderRadius: 9, background: signal.warning.tint,
      padding: "8px 13px",
    }}>
      <Icon name="triangle-alert" size={13} color={signal.warning.strong} />
      <span style={{ fontSize: 11.5, fontWeight: 700, color: signal.warning.strong, whiteSpace: "nowrap" }}>
        Agent-built UI — pending design review
      </span>
      <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
        No design export exists for this screen. Built directly against the real Security Plan
        endpoints; a design pass may reshape this layout later.
      </span>
    </div>
  );
}

function EmptyPanel({ icon, title, body, action }: { icon: string; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div style={{
      border: `1px solid ${border.card}`, borderRadius: 11, background: surface.card, padding: "30px 20px",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 9, textAlign: "center",
    }}>
      <span style={{
        width: 42, height: 42, borderRadius: 12, background: "rgba(96,165,250,.1)", border: "1px solid rgba(96,165,250,.22)",
        color: "#60a5fa", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon name={icon} size={19} />
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>{title}</span>
      <span style={{ fontSize: 12, color: text.muted, maxWidth: 460, textWrap: "pretty" }}>{body}</span>
      {action}
    </div>
  );
}

function AdvisoryPanel({ status, verb }: { status?: number; verb: string }) {
  const is403 = status === 403;
  return (
    <div style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 11, background: signal.warning.tint, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: signal.warning.strong }}>
        {is403 ? "Not scoped to this MSP session" : `Couldn't ${verb}`}
      </span>
      <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
        {is403
          ? "This route resolves scope from the session's MSP claim and this tenant's ownership — a session without an active MSP context, or a tenant belonging to another MSP, legitimately fails here."
          : `The request returned ${status ?? "an error"}.`}
      </span>
    </div>
  );
}

function FootprintSummary({ content }: { content: SecurityPlanContent }) {
  const rowCount = content.modules.reduce((n, m) => n + m.total, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ borderLeft: `2px solid ${signal.info.border}`, paddingLeft: 12 }}>
        <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, letterSpacing: ".08em", color: text.label }}>
          SCOPE STATEMENT
        </span>
        <span style={{ fontSize: 12.5, color: text.body, textWrap: "pretty" }}>{content.footprint.scope.statement}</span>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Fact label="ASSEMBLED" value={formatDateTime(content.assembledAt)} />
        <Fact label="ROWS" value={`${rowCount} across ${content.modules.length} registers`} />
        <Fact label="VIEW" value={content.footprint.isHonestView ? "Honest — unfiltered" : `Scoped — ${content.footprint.totalExcluded} excluded`} />
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", color: text.label }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: text.body }}>{value}</span>
    </div>
  );
}

function ModuleList({ content }: { content: SecurityPlanContent }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {content.modules.map((m) => {
        const open = openKey === m.key;
        return (
          <div key={m.key} style={{ border: `1px solid ${border.card}`, borderRadius: 10, background: surface.card, overflow: "hidden" }}>
            <button
              onClick={() => setOpenKey(open ? null : m.key)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 13px",
                background: "transparent", border: "none", cursor: "pointer", textAlign: "left", font: "inherit",
              }}
            >
              <Icon name={open ? "chevron-down" : "chevron-right"} size={13} color={text.muted} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title, flex: 1, minWidth: 0 }}>{m.label}</span>
              <span style={{ fontSize: 10.5, color: text.faint, fontFamily: "Menlo,monospace" }}>{m.sourceIssue}</span>
              <span style={{ fontSize: 11, color: text.muted, whiteSpace: "nowrap" }}>
                {m.total} row{m.total === 1 ? "" : "s"}{m.excludedCount > 0 ? ` · ${m.excludedCount} excluded` : ""}
              </span>
            </button>
            {open && (
              <div style={{ borderTop: `1px solid ${border.faint}`, padding: "4px 0" }}>
                {m.items.length === 0 ? (
                  <span style={{ display: "block", padding: "10px 13px", fontSize: 11.5, color: text.faint }}>No in-scope rows.</span>
                ) : (
                  m.items.map((item) => (
                    <div key={item.id} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "8px 13px", borderBottom: `1px solid ${border.faint}` }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: text.body, textWrap: "pretty" }}>{item.title}</span>
                      <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
                        {item.state ?? "—"}{item.detail ? ` · ${item.detail}` : ""}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProseSectionEditor({
  section, text: value, editedInThisVersion, saving, onSave,
}: {
  section: SecurityPlanProseSection;
  text: string;
  editedInThisVersion: boolean;
  saving: boolean;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = draft !== value;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>{PROSE_LABELS[section]}</span>
        <Pill label={editedInThisVersion ? "edited in this draft" : "carried forward"} tone={editedInThisVersion ? signal.info : signal.neutral} />
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        placeholder={`Write ${PROSE_LABELS[section].toLowerCase()}…`}
        style={{
          width: "100%", resize: "vertical", borderRadius: 8, border: `1px solid ${border.card}`,
          background: "rgba(2,6,23,.6)", color: text.body, fontSize: 12.5, lineHeight: 1.6, padding: "9px 11px",
          fontFamily: "inherit", outline: "none",
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={() => onSave(draft)}
          disabled={!dirty || saving}
          style={{
            height: 27, padding: "0 12px", borderRadius: 7, border: `1px solid ${dirty ? "#2563eb" : border.card}`,
            background: dirty ? "#2563eb" : "transparent", color: dirty ? "#fff" : text.faint,
            fontSize: 11.5, fontWeight: 600, cursor: dirty && !saving ? "pointer" : "not-allowed",
          }}
        >
          {saving ? "Saving…" : "Save section"}
        </button>
      </div>
    </div>
  );
}

function DraftTab({ customerId }: { customerId: number }) {
  const draftQuery = useSecurityPlanDraft(customerId);
  const liveQuery = useAssembledSecurityPlan(customerId);
  const freeze = useFreezeSecurityPlanDraft(customerId);
  const updateProse = useUpdateSecurityPlanDraftProse(customerId);
  const seal = useSealSecurityPlanVersion(customerId);
  const [savingSection, setSavingSection] = useState<SecurityPlanProseSection | null>(null);

  const noDraftYet = draftQuery.isError && apiStatus(draftQuery.error) === 404;

  const doFreeze = () => {
    freeze.mutate(undefined, {
      onSuccess: () => toast.success("Live state frozen — author the prose against it, then seal."),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Could not freeze the current state."),
    });
  };

  const doSaveProse = (section: SecurityPlanProseSection, sectionText: string) => {
    setSavingSection(section);
    updateProse.mutate(
      { section, text: sectionText },
      {
        onSettled: () => setSavingSection(null),
        onSuccess: () => toast.success(`${PROSE_LABELS[section]} saved.`),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save that section."),
      },
    );
  };

  const doSeal = () => {
    seal.mutate(undefined, {
      onSuccess: (version) => toast.success(`Sealed as version ${version.versionNumber}. Sign it from Sealed versions.`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Could not seal this draft."),
    });
  };

  if (draftQuery.isLoading || (noDraftYet && liveQuery.isLoading)) {
    return (
      <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {[0, 1, 2].map((i) => <div key={i} style={{ height: 44, borderRadius: 8, background: "rgba(148,163,184,.06)" }} />)}
      </div>
    );
  }

  if (draftQuery.isError && !noDraftYet) {
    return <AdvisoryPanel status={apiStatus(draftQuery.error)} verb="read the draft" />;
  }

  if (noDraftYet) {
    if (liveQuery.isError) return <AdvisoryPanel status={apiStatus(liveQuery.error)} verb="read the live state" />;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <EmptyPanel
          icon="file-clock"
          title="No draft in progress"
          body="Freeze the current, live-assembled state to start authoring a new Security Plan version against it. Freezing does not seal anything — the draft can be revised or re-frozen any number of times before you seal."
          action={
            <button
              onClick={doFreeze}
              disabled={freeze.isPending}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 14px", borderRadius: 8,
                border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 12.5, fontWeight: 600,
                cursor: freeze.isPending ? "wait" : "pointer",
              }}
            >
              <Icon name="camera" size={13} />
              {freeze.isPending ? "Freezing…" : "Freeze the current state"}
            </button>
          }
        />
        {liveQuery.data && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: text.label }}>LIVE STATE — PREVIEW BEFORE FREEZING</span>
            <FootprintSummary content={liveQuery.data} />
            <ModuleList content={liveQuery.data} />
          </div>
        )}
      </div>
    );
  }

  const draft = draftQuery.data;
  if (!draft) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Pill label="draft in progress" tone={signal.warning} />
          <span style={{ fontSize: 11, color: text.muted }}>Frozen {formatDateTime(draft.frozenAt)} · last edited {formatDateTime(draft.updatedAt)}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={doFreeze}
            disabled={freeze.isPending}
            style={{
              height: 29, padding: "0 12px", borderRadius: 7, border: `1px solid ${border.card}`, background: "transparent",
              color: text.muted, fontSize: 11.5, fontWeight: 600, cursor: freeze.isPending ? "wait" : "pointer",
            }}
          >
            {freeze.isPending ? "Refreshing…" : "Refresh frozen state"}
          </button>
          <button
            onClick={doSeal}
            disabled={seal.isPending}
            style={{
              display: "flex", alignItems: "center", gap: 6, height: 29, padding: "0 13px", borderRadius: 7,
              border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 11.5, fontWeight: 600,
              cursor: seal.isPending ? "wait" : "pointer",
            }}
          >
            <Icon name="stamp" size={12} />
            {seal.isPending ? "Sealing…" : "Seal as a new version"}
          </button>
        </div>
      </div>

      <FootprintSummary content={draft.frozenContent} />

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: text.label }}>AUTHORED PROSE</span>
        {SECURITY_PLAN_PROSE_SECTIONS.map((section) => (
          <ProseSectionEditor
            key={section}
            section={section}
            text={draft.prose[section]?.text ?? ""}
            editedInThisVersion={draft.prose[section]?.editedInThisVersion ?? false}
            saving={savingSection === section}
            onSave={(t) => doSaveProse(section, t)}
          />
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: text.label }}>FROZEN REGISTERS</span>
        <ModuleList content={draft.frozenContent} />
      </div>
    </div>
  );
}

function VersionRow({
  version, expanded, onToggle, isMspAdmin, onSign, signing,
}: {
  version: SecurityPlanVersion;
  expanded: boolean;
  onToggle: () => void;
  isMspAdmin: boolean;
  onSign: (versionUid: string) => void;
  signing: boolean;
}) {
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 11, background: surface.card, overflow: "hidden" }}>
      <button
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "11px 14px",
          background: "transparent", border: "none", cursor: "pointer", textAlign: "left", font: "inherit", flexWrap: "wrap",
        }}
      >
        <Icon name={expanded ? "chevron-down" : "chevron-right"} size={13} color={text.muted} />
        <span style={{ fontSize: 13, fontWeight: 700, color: text.title }}>Version {version.versionNumber}</span>
        {version.isCurrent && <Pill label="current" tone={signal.info} />}
        {version.fullyExecuted && <Pill label="fully executed" tone={signal.ok} />}
        <Pill label={version.customerSigned ? "customer signed" : "customer unsigned"} tone={version.customerSigned ? signal.ok : signal.neutral} />
        <Pill label={version.mspSigned ? "MSP signed" : "MSP unsigned"} tone={version.mspSigned ? signal.ok : signal.warning} />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: text.faint, whiteSpace: "nowrap" }}>sealed {formatDate(version.createdAt)}</span>
      </button>
      {expanded && (
        <div style={{ borderTop: `1px solid ${border.faint}`, padding: "14px", display: "flex", flexDirection: "column", gap: 14 }}>
          {version.isCurrent && !version.mspSigned && (
            <div style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 9, background: signal.warning.tint, padding: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: text.body, flex: 1, minWidth: 220, textWrap: "pretty" }}>
                {isMspAdmin
                  ? "Sign this version as the MSP's own, independent party. This never blocks on, and is never satisfied by, the customer's own signature in the portal."
                  : "Signing as the MSP requires the MSPAdmin capability (ladder.msp-admin) — an MSPOperator can freeze, author and seal, but cannot sign as the MSP's own party."}
              </span>
              {isMspAdmin && (
                <button
                  onClick={() => onSign(version.versionUid)}
                  disabled={signing}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, height: 29, padding: "0 13px", borderRadius: 7,
                    border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 11.5, fontWeight: 600,
                    cursor: signing ? "wait" : "pointer", whiteSpace: "nowrap",
                  }}
                >
                  <Icon name="signature" size={12} />
                  {signing ? "Signing…" : "Sign as the MSP"}
                </button>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Fact label="SEALED BY" value={(version.createdBy as { name?: string } | null)?.name ?? "—"} />
            <Fact label="CUSTOMER SIGNED" value={version.customerSignedAt ? formatDateTime(version.customerSignedAt) : "not yet"} />
            <Fact label="MSP SIGNED" value={version.mspSignedAt ? formatDateTime(version.mspSignedAt) : "not yet"} />
          </div>

          <FootprintSummary content={version.content} />

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: text.label }}>AUTHORED PROSE</span>
            {SECURITY_PLAN_PROSE_SECTIONS.map((section) => {
              const p = version.content.prose?.[section];
              return (
                <div key={section} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: text.title }}>{PROSE_LABELS[section]}</span>
                  <span style={{ fontSize: 12, color: text.body, textWrap: "pretty", whiteSpace: "pre-wrap" }}>
                    {p?.text || "—"}
                  </span>
                </div>
              );
            })}
          </div>

          <ModuleList content={version.content} />
        </div>
      )}
    </div>
  );
}

function VersionsTab({ customerId, isMspAdmin }: { customerId: number; isMspAdmin: boolean }) {
  const versionsQuery = useSecurityPlanVersions(customerId);
  const currentQuery = useCurrentSecurityPlanVersion(customerId);
  const sign = useSignSecurityPlanVersionAsMsp(customerId);
  const [expandedUid, setExpandedUid] = useState<string | null>(null);

  const doSign = (versionUid: string) => {
    sign.mutate(versionUid, {
      onSuccess: () => toast.success("Signed as the MSP."),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Could not sign this version."),
    });
  };

  if (versionsQuery.isLoading) {
    return (
      <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {[0, 1].map((i) => <div key={i} style={{ height: 44, borderRadius: 8, background: "rgba(148,163,184,.06)" }} />)}
      </div>
    );
  }
  if (versionsQuery.isError) return <AdvisoryPanel status={apiStatus(versionsQuery.error)} verb="read the sealed versions" />;

  const versions = versionsQuery.data ?? [];
  if (versions.length === 0) {
    const neverSealed = currentQuery.isError && apiStatus(currentQuery.error) === 404;
    return (
      <EmptyPanel
        icon="file-check"
        title="No version has ever been sealed"
        body={
          neverSealed
            ? "Freeze the live state and seal it from the Draft & authoring tab to create the first version."
            : "Nothing has been sealed for this customer yet."
        }
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ fontSize: 11.5, color: text.muted }}>{versions.length} sealed version{versions.length === 1 ? "" : "s"}, newest first.</span>
      {versions.map((v) => (
        <VersionRow
          key={v.versionUid}
          version={v}
          expanded={expandedUid === v.versionUid}
          onToggle={() => setExpandedUid(expandedUid === v.versionUid ? null : v.versionUid)}
          isMspAdmin={isMspAdmin}
          onSign={doSign}
          signing={sign.isPending}
        />
      ))}
    </div>
  );
}

function DriftTab({ customerId }: { customerId: number }) {
  const driftQuery = useSecurityPlanDrift(customerId);

  if (driftQuery.isLoading) {
    return (
      <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {[0, 1].map((i) => <div key={i} style={{ height: 44, borderRadius: 8, background: "rgba(148,163,184,.06)" }} />)}
      </div>
    );
  }
  if (driftQuery.isError) return <AdvisoryPanel status={apiStatus(driftQuery.error)} verb="read the drift" />;

  const { drift } = driftQuery.data!;

  if (!drift.hasLastSignedVersion) {
    return (
      <EmptyPanel
        icon="waypoints"
        title="No fully executed version to drift against"
        body="Drift compares today's live state against the last version BOTH the customer and the MSP have signed. Nothing has reached that state yet, so there is no baseline to diff."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <Fact label="BASELINE" value={`Version ${drift.lastSignedVersionNumber} · executed ${formatDate(drift.lastSignedAt)}`} />
        <Fact label="ADDED" value={String(drift.totalAdded)} />
        <Fact label="REMOVED" value={String(drift.totalRemoved)} />
        <Fact label="CHANGED" value={String(drift.totalChanged)} />
      </div>
      <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
        Mechanical data drift only — added/removed/changed rows across the source registers. This
        never compares the authored prose; whether a sealed sentence still reads true is a human
        judgment, not something a diff can assert.
      </span>

      {drift.modules.length === 0 ? (
        <EmptyPanel icon="circle-check" title="Nothing has drifted" body="The live state matches the last fully executed version across every register." />
      ) : (
        drift.modules.map((m) => (
          <div key={m.moduleKey} style={{ border: `1px solid ${border.card}`, borderRadius: 10, background: surface.card, padding: 13, display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>{m.label}</span>
            {m.added.map((item) => (
              <div key={`a-${item.id}`} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <Pill label="added" tone={signal.ok} />
                <span style={{ fontSize: 12, color: text.body, textWrap: "pretty" }}>{item.title}</span>
              </div>
            ))}
            {m.removed.map((item) => (
              <div key={`r-${item.id}`} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <Pill label="removed" tone={signal.critical} />
                <span style={{ fontSize: 12, color: text.body, textWrap: "pretty" }}>{item.title}</span>
              </div>
            ))}
            {m.changed.map((c) => (
              <div key={`c-${c.id}`} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <Pill label="changed" tone={signal.warning} />
                  <span style={{ fontSize: 12, color: text.body, textWrap: "pretty" }}>{c.title}</span>
                </div>
                <span style={{ fontSize: 11, color: text.muted, paddingLeft: 66 }}>
                  {c.from.state ?? "—"} → {c.to.state ?? "—"}
                </span>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

export function SecurityPlan({ customer, isMspAdmin }: { customer: DirectoryCustomer; isMspAdmin: boolean }) {
  const [tab, setTab] = useState<Tab>("draft");
  const versionsQuery = useSecurityPlanVersions(customer.id);
  const driftQuery = useSecurityPlanDrift(customer.id);

  const versionCount = versionsQuery.data?.length ?? 0;
  const driftTotal = useMemo(() => {
    if (!driftQuery.data) return 0;
    const d = driftQuery.data.drift;
    return d.totalAdded + d.totalRemoved + d.totalChanged;
  }, [driftQuery.data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <AgentBuiltBanner />

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {([
          { id: "draft" as const, label: "Draft & authoring" },
          { id: "versions" as const, label: "Sealed versions", count: versionCount },
          { id: "drift" as const, label: "Drift since last executed", count: driftTotal || undefined },
        ]).map((t) => {
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
              {t.count !== undefined && <span style={{ fontSize: 10.5, color: active ? "#60a5fa" : text.faint }}>{t.count}</span>}
            </button>
          );
        })}
      </div>

      {tab === "draft" && <DraftTab customerId={customer.id} />}
      {tab === "versions" && <VersionsTab customerId={customer.id} isMspAdmin={isMspAdmin} />}
      {tab === "drift" && <DriftTab customerId={customer.id} />}

      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 2 }}>
        <Icon name="info" size={13} color={text.faint} />
        <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
          Freeze, prose, seal, drift and the MSP's own signature all run on live endpoints
          (<code>msp-security-plan.ts</code>). The customer's own signature is a separate, independent
          action in the portal — neither party's signing blocks or is satisfied by the other's.
        </span>
      </div>
    </div>
  );
}
