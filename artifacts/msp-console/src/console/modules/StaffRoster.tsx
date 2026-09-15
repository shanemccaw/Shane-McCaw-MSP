/**
 * Staff Roster — MSP Console module page (#2662, Feature #2574).
 * Mounts into the shell's `ScreenSlot` at `/ops/staff` (Operations, MSP-wide
 * — `console/nav.ts`), wiring the real nineteen-route surface from
 * `msp-settings.ts` + `msp-onboarding.ts` documented in full at
 * `docs/msp-console/msp-staff-roles-and-onboarding-contract-pack.md`
 * (`Design/MSP_Console/design_handoff_msp_console/Staff Roster.dc.html`,
 * README screen 65): roster, per-staff customer scoping, role, purchase
 * approval, credential-adjacent standing (suspend/reactivate/remove),
 * MSP-wide sessions, and invite create/list/revoke.
 *
 * **The roster route returns every account carrying this MSP's id with no
 * role filter of its own** (contract pack §1, §8.2) — the design's
 * "Staff only / Everyone with this MSP id" switch is drawn here for exactly
 * that reason, with both counts always stated. Zero assigned customers
 * means unrestricted (the whole book), never "no access" (§1, §8) — rendered
 * as "All customers", never an empty badge. Only `MSPAdmin`/`MSPOperator`
 * can ever be assigned or invited (§3, §5c, §6); every other role reachable
 * through this roster (PlatformAdmin, Customer, Free, …) is shown
 * as "Listed, but not staff" with scoping/role/approval hidden, matching the
 * server's own hard 400 guard rather than a client-side guess.
 *
 * The suspend/reactivate, remove-from-MSP, session-revoke and MSP-wide
 * session list actions are the exact same routes `account-security-api.ts`
 * already wires — reused verbatim here via `staff-roster-api.ts`'s
 * re-exports, per that file's own header ("A fix to one changes both.").
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { MspUserProfile } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { Icon } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import {
  ASSIGNABLE_ROLES,
  STAFF_ROLES,
  StaffRosterApiError,
  useCustomerScopes,
  useInvites,
  useMspSessions,
  useRemoveStaffMember,
  useRevokeAccountSessions,
  useRevokeInvite,
  useSendInvite,
  useSetAccountStatus,
  useSetApprovePurchases,
  useSetCustomerScopes,
  useSetStaffRole,
  useStaffRoster,
  type AssignableRole,
  type MspInvite,
  type StaffMember,
} from "@/api/staff-roster-api";

type Tone = { strong: string; text?: string; tint: string; border: string };
type Tab = "roster" | "invites" | "sessions";

const ROLE_TONE: Record<string, Tone> = {
  PlatformAdmin: signal.notice,
  MSPAdmin: signal.info,
  MSPOperator: signal.ok,
  Customer: signal.neutral,
  Free: signal.neutral,
  RetainerNoConsent: signal.neutral,
  RetainerConsented: signal.neutral,
  ServiceAccount: signal.neutral,
};

interface LastResult { text: string; tone: Tone }

/**
 * Git #4088 — the label was a two-way ternary (`PlatformAdmin` / `CustomerUser` /
 * else "an assessment sign-up") written when `Assessment` and `CustomerUser` were
 * still real roles. #3590 retired both, and the roster's "no role filter" (see
 * file header) can surface any of six non-staff roles here, not just two — this
 * covers all of them explicitly instead of falling every non-`PlatformAdmin`,
 * non-`Customer` row into the old catch-all.
 */
function nonStaffAccountLabel(role: string | null | undefined): string {
  switch (role) {
    case "PlatformAdmin":
      return "a platform administrator";
    case "Customer":
      return "a customer login";
    case "Free":
      return "a free-tier sign-up";
    case "RetainerNoConsent":
      return "a retainer client (not yet consented)";
    case "RetainerConsented":
      return "a retainer client";
    case "ServiceAccount":
      return "a service account";
    default:
      return "an account on another tier";
  }
}

function Pill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
      height: 22, padding: "0 9px", borderRadius: 999, background: tone.tint, border: `1px solid ${tone.border}`,
      fontSize: 10.5, fontWeight: 600, color: tone.text ?? tone.strong,
    }}>
      {label}
    </span>
  );
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", height: 26, padding: "0 10px",
        borderRadius: 999, background: on ? "rgba(37,99,235,.18)" : "rgba(148,163,184,.06)",
        border: `1px solid ${on ? "rgba(96,165,250,.45)" : "rgba(148,163,184,.16)"}`,
        fontSize: 11, fontWeight: 600, color: on ? text.strong : text.muted, cursor: "pointer", font: "inherit",
      }}
    >
      {label}
    </button>
  );
}

function ResultPanel({ text: body, tone }: LastResult) {
  return (
    <div style={{ border: `1px solid ${tone.border}`, borderRadius: 12, background: tone.tint, padding: 13, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{body}</span>
    </div>
  );
}

function errorResult(err: unknown): LastResult {
  const apiErr = err instanceof StaffRosterApiError ? err : null;
  const tone = apiErr?.status === 403 || apiErr?.status === 400 ? signal.warning : signal.critical;
  return { text: apiErr?.message ?? "Request failed", tone };
}

function formatWhen(iso: string | null): string {
  if (!iso) return "never signed in";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return "last sign-in " + d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function StaffRoster({ profile }: { profile: MspUserProfile }) {
  const { fetchWithAuth } = useAuth();
  const meId = profile.id;

  const [tab, setTab] = useState<Tab>("roster");
  const [staffOnly, setStaffOnly] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const [draftScopes, setDraftScopes] = useState<number[] | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AssignableRole>("MSPOperator");
  const [inviteResult, setInviteResult] = useState<LastResult | null>(null);
  const [sessionQ, setSessionQ] = useState("");
  const [sessionResult, setSessionResult] = useState<LastResult | null>(null);
  const [justCreatedInvite, setJustCreatedInvite] = useState<MspInvite | null>(null);

  const rosterQuery = useStaffRoster();
  const sessionsQuery = useMspSessions();
  const invitesQuery = useInvites();
  const scopesQuery = useCustomerScopes(selectedId);

  const setRoleMutation = useSetStaffRole();
  const setScopesMutation = useSetCustomerScopes();
  const setApproveMutation = useSetApprovePurchases();
  const setStatusMutation = useSetAccountStatus();
  const removeMutation = useRemoveStaffMember();
  const revokeSessionsMutation = useRevokeAccountSessions();
  const sendInviteMutation = useSendInvite();
  const revokeInviteMutation = useRevokeInvite();

  const everyone = rosterQuery.data ?? [];
  const staff = useMemo(() => everyone.filter((p) => p.mspRole != null && STAFF_ROLES.has(p.mspRole)), [everyone]);
  const shown = staffOnly ? staff : everyone;
  const selected = selectedId != null ? shown.find((p) => p.id === selectedId) ?? everyone.find((p) => p.id === selectedId) ?? null : null;
  const scopable = !!selected && selected.mspRole != null && STAFF_ROLES.has(selected.mspRole);
  const draft = draftScopes ?? scopesQuery.data?.assignedCustomerIds ?? [];
  const isSelf = !!selected && meId != null && selected.id === meId;

  const sessions = (sessionsQuery.data ?? []).filter(
    (s) => !sessionQ.trim() || (s.name + " " + s.email).toLowerCase().includes(sessionQ.trim().toLowerCase()),
  );
  const selectedSessions = selected ? (sessionsQuery.data ?? []).filter((s) => s.userId === selected.id) : [];
  const invites = invitesQuery.data ?? [];

  const selectPerson = (id: number) => {
    setSelectedId(id);
    setDraftScopes(null);
    setLastResult(null);
  };

  const doSetRole = (mspRole: AssignableRole) => {
    if (!selected || selected.mspRole === mspRole) return;
    setRoleMutation.mutate(
      { userId: selected.id, mspRole },
      {
        onSuccess: () => {
          setLastResult({ text: "Role written with a fresh updated stamp. The response does not say what the role now is — this screen re-reads the roster to show it.", tone: signal.info });
          toast.success(`Role set to ${mspRole}.`);
        },
        onError: (err) => { const r = errorResult(err); setLastResult(r); toast.error(r.text); },
      },
    );
  };

  const doSaveScopes = () => {
    if (!selected) return;
    const ids = [...draft].sort((a, b) => a - b);
    setScopesMutation.mutate(
      { userId: selected.id, customerIds: ids },
      {
        onSuccess: (data) => {
          setDraftScopes(null);
          setLastResult({
            text: data.unrestricted
              ? "Every scope row for this person was deleted and none written back — they now see the whole book again."
              : `Every existing scope row was deleted and these ${data.assignedCustomerIds.length} written in one transaction — a full replace, not a merge.`,
            tone: signal.ok,
          });
          toast.success(data.unrestricted ? "Scope cleared — unrestricted." : `Scope saved — ${data.assignedCustomerIds.length} customer(s).`);
        },
        onError: (err) => { const r = errorResult(err); setLastResult(r); toast.error(r.text); },
      },
    );
  };

  const doToggleApprove = () => {
    if (!selected) return;
    setApproveMutation.mutate(
      { userId: selected.id, canApprovePurchases: !selected.canApprovePurchases },
      {
        onSuccess: () => {
          setLastResult({ text: "Flag written. This is the one route that touches it; the approval gate on SOW charges reads it live.", tone: signal.info });
          toast.success(selected.canApprovePurchases ? "Approval right withdrawn." : "Approval right granted.");
        },
        onError: (err) => { const r = errorResult(err); setLastResult(r); toast.error(r.text); },
      },
    );
  };

  const doToggleStatus = () => {
    if (!selected) return;
    setStatusMutation.mutate(
      { userId: selected.id, isActive: !selected.isActive },
      {
        onSuccess: (data) => {
          setLastResult({
            text: data.isActive
              ? "Reactivated. The same flag removal set; nothing else about the account changed."
              : "Marked inactive. Their live sessions are not closed by this call — use the sessions action for that.",
            tone: data.isActive ? signal.ok : signal.warning,
          });
          toast.success(data.isActive ? "Reactivated." : "Suspended.");
        },
        onError: (err) => { const r = errorResult(err); setLastResult(r); toast.error(r.text); },
      },
    );
  };

  const doRemove = () => {
    if (!selected) return;
    removeMutation.mutate(selected.id, {
      onSuccess: () => {
        setLastResult({ text: "Not a delete: the account is set inactive and stays in the roster route's output. Reactivate undoes it.", tone: signal.critical });
        toast.success("Removed from this MSP.");
      },
      onError: (err) => { const r = errorResult(err); setLastResult(r); toast.error(r.text); },
    });
  };

  const doRevokeAllSessions = () => {
    if (!selected) return;
    revokeSessionsMutation.mutate(selected.id, {
      onSuccess: (data) => {
        setLastResult({ text: `Revoked ${data.revokedCount} session${data.revokedCount === 1 ? "" : "s"} — a real count from a real revoke.`, tone: signal.critical });
        toast.success(`Revoked ${data.revokedCount} session${data.revokedCount === 1 ? "" : "s"}.`);
      },
      onError: (err) => { const r = errorResult(err); setLastResult(r); toast.error(r.text); },
    });
  };

  const doSendInvite = () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      setInviteResult({ text: "An email and one of the two roles are required.", tone: signal.warning });
      return;
    }
    sendInviteMutation.mutate(
      { email, mspRole: inviteRole },
      {
        onSuccess: (invite) => {
          setInviteEmail("");
          setJustCreatedInvite(invite);
          setInviteResult({ text: "The raw token comes back to you in full so you can confirm the send; the email itself goes out fire-and-forget. Valid 72 hours.", tone: signal.ok });
          toast.success(`Invite sent to ${email}.`);
        },
        onError: (err) => { const r = errorResult(err); setInviteResult(r); toast.error(r.text); },
      },
    );
  };

  const doRevokeInvite = (invite: MspInvite) => {
    revokeInviteMutation.mutate(invite.id, {
      onSuccess: () => {
        if (justCreatedInvite?.id === invite.id) setJustCreatedInvite(null);
        setInviteResult({ text: "A hard delete, scoped to pending invites only. An already-accepted invite answers not-found here and is kept.", tone: signal.neutral });
        toast.success("Invite revoked.");
      },
      onError: (err) => { const r = errorResult(err); setInviteResult(r); toast.error(r.text); },
    });
  };

  const doRevokeSession = (session: { id: number; tokenHash: string }) => {
    fetchWithAuth(`/api/msp/settings/sessions/${session.tokenHash}`, { method: "DELETE" })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        setSessionResult({ text: "That one refresh token is stamped revoked.", tone: signal.critical });
        void sessionsQuery.refetch();
        toast.success("Session revoked.");
      })
      .catch(() => {
        setSessionResult({ text: "Could not revoke that session.", tone: signal.critical });
        toast.error("Could not revoke that session.");
      });
  };

  if (rosterQuery.isError) {
    const status = rosterQuery.error instanceof StaffRosterApiError ? rosterQuery.error.status : null;
    return (
      <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 22, display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: text.title }}>{status === 403 ? "MSPAdmin or above is required" : "The roster could not be loaded"}</span>
        <span style={{ fontSize: 13, color: text.muted }}>{rosterQuery.error.message}</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }} />
        <Pill label="MSPAdmin or above · every route" tone={signal.warning} />
        <Pill label={`Acting as ${profile.name ?? profile.email}`} tone={signal.info} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {([
          ["roster", "Roster", shown.length],
          ["invites", "Invites", invites.length],
          ["sessions", "Sessions", sessions.length],
        ] as const).map(([k, label, count]) => (
          <button
            key={k}
            onClick={() => { setTab(k); setLastResult(null); }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: 7,
              border: `1px solid ${tab === k ? "rgba(96,165,250,.45)" : "rgba(148,163,184,.16)"}`,
              background: tab === k ? "rgba(37,99,235,.18)" : "transparent",
              color: tab === k ? text.strong : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", font: "inherit", whiteSpace: "nowrap",
            }}
          >
            {label}<span style={{ fontSize: 10.5, color: tab === k ? signal.info.strong : text.muted }}>{count}</span>
          </button>
        ))}
      </div>

      {tab === "roster" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
          {/* Roster list */}
          <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Chip label="Staff only" on={staffOnly} onClick={() => setStaffOnly(true)} />
              <Chip label="Everyone with this MSP id" on={!staffOnly} onClick={() => setStaffOnly(false)} />
              <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", flex: 1, minWidth: 160 }}>
                {everyone.length} account{everyone.length === 1 ? "" : "s"} carry this MSP's id · {staff.length} {staff.length === 1 ? "is" : "are"} staff
              </span>
            </div>

            {rosterQuery.isLoading ? (
              <div style={{ fontSize: 11.5, color: text.muted }}>Loading the roster…</div>
            ) : shown.length === 0 ? (
              <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 10, padding: 22, display: "flex", flexDirection: "column", gap: 6, alignItems: "center", textAlign: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: text.secondary }}>No staff yet</span>
                <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty", maxWidth: 380 }}>
                  {everyone.length} account{everyone.length === 1 ? "" : "s"} carry this MSP's id and none is an MSPAdmin or MSPOperator. That is the live state: no staff member has ever been invited or accepted. Switch the filter to see the accounts the route actually returns.
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                {shown.map((p) => {
                  const tone = ROLE_TONE[p.mspRole ?? "Customer"] ?? signal.neutral;
                  const isStaff = p.mspRole != null && STAFF_ROLES.has(p.mspRole);
                  const on = p.id === selectedId;
                  return (
                    <button
                      key={p.id}
                      onClick={() => selectPerson(p.id)}
                      style={{
                        display: "flex", flexDirection: "column", gap: 7, textAlign: "left",
                        border: `1px solid ${on ? border.hover : border.soft}`, borderRadius: 10,
                        background: on ? "rgba(96,165,250,.09)" : "rgba(2,6,23,.4)", padding: 12, cursor: "pointer",
                        font: "inherit", minWidth: 0, opacity: p.isActive ? 1 : 0.7,
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", width: "100%" }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong, flex: 1, minWidth: 120 }}>{p.name || "No name on the account"}</span>
                        <Pill label={p.mspRole ?? "unknown"} tone={tone} />
                      </span>
                      <span style={{ fontSize: 11, color: text.muted, wordBreak: "break-all" }}>{p.email}</span>
                      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {isStaff && (
                          <Pill
                            label={p.assignedCustomersCount === 0 ? "All customers" : `${p.assignedCustomersCount} of the book`}
                            tone={p.assignedCustomersCount === 0 ? signal.ok : signal.warning}
                          />
                        )}
                        {p.canApprovePurchases && <Pill label="approves purchases" tone={signal.info} />}
                        <Pill label={p.isActive ? formatWhen(p.lastLoginAt) : "suspended"} tone={p.isActive ? signal.neutral : signal.critical} />
                        {meId != null && p.id === meId && <Pill label="you" tone={signal.notice} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", borderTop: `1px solid ${border.faint}`, paddingTop: 10 }}>
              Newest account first. The roster route returns every account carrying this MSP's id and applies no role filter of its own, so the staff-only view is drawn here.
            </span>
          </div>

          {/* Detail */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            {selected ? (
              <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 170, flex: 1 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: text.title }}>{selected.name || "No name on the account"}</span>
                    <span style={{ fontSize: 11, color: text.muted, wordBreak: "break-all" }}>{selected.email}</span>
                    <span style={{ fontSize: 11, color: text.label }}>user #{selected.id} · created {new Date(selected.createdAt).toLocaleDateString()} · {formatWhen(selected.lastLoginAt)}</span>
                  </span>
                  <Pill label={selected.mspRole ?? "unknown"} tone={ROLE_TONE[selected.mspRole ?? "Customer"] ?? signal.neutral} />
                </div>

                {scopable ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                    <div style={{ border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>ROLE · ONLY TWO CAN BE GIVEN HERE</span>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {ASSIGNABLE_ROLES.map((r) => (
                          <Chip key={r} label={r} on={selected.mspRole === r} onClick={() => doSetRole(r)} />
                        ))}
                      </div>
                      <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>Anything else — PlatformAdmin included — fails validation before the route runs. The response is a bare ok; the new role is not echoed back.</span>
                    </div>

                    <div style={{ border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted, flex: 1 }}>CUSTOMER SCOPE</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: draft.length === 0 ? signal.ok.strong : signal.warning.strong }}>
                          {draft.length === 0 ? "unrestricted — the whole book" : `${draft.length} of ${scopesQuery.data?.allCustomers.length ?? 0} selected`}
                        </span>
                      </div>
                      {scopesQuery.isLoading ? (
                        <span style={{ fontSize: 11.5, color: text.muted }}>Loading scope…</span>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 6 }}>
                          {(scopesQuery.data?.allCustomers ?? []).map((c) => {
                            const on = draft.includes(c.id);
                            return (
                              <button
                                key={c.id}
                                onClick={() => setDraftScopes(on ? draft.filter((x) => x !== c.id) : draft.concat([c.id]))}
                                style={{
                                  display: "flex", alignItems: "center", gap: 8, textAlign: "left", height: 32, padding: "0 10px",
                                  borderRadius: 6, background: on ? "rgba(37,99,235,.14)" : "rgba(2,6,23,.4)",
                                  border: `1px solid ${on ? "rgba(96,165,250,.4)" : border.soft}`, cursor: "pointer", font: "inherit", minWidth: 0,
                                }}
                              >
                                <span style={{ width: 14, height: 14, flex: "none", borderRadius: 3, border: `1px solid ${on ? "#2563eb" : "rgba(148,163,184,.4)"}`, background: on ? "#2563eb" : "transparent" }} />
                                <span style={{ fontSize: 11.5, color: text.strong, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{c.name}</span>
                                <span style={{ fontSize: 10, color: text.label, whiteSpace: "nowrap" }}>{c.status}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <button
                          onClick={doSaveScopes}
                          disabled={setScopesMutation.isPending}
                          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 30, padding: "0 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 12, fontWeight: 600, cursor: setScopesMutation.isPending ? "not-allowed" : "pointer", font: "inherit" }}
                        >
                          {setScopesMutation.isPending ? "Saving…" : "Save scope"}
                        </button>
                        <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", flex: 1, minWidth: 160 }}>Saving replaces the whole set. Nothing ticked means unrestricted — the entire book — and that is what an empty save does.</span>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                      <div style={{ border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>PURCHASE APPROVAL</span>
                        <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>
                          {selected.canApprovePurchases ? "Counts as an eligible approver for SOW charges, alongside every MSPAdmin." : "Cannot approve SOW charges unless they are an MSPAdmin."}
                        </span>
                        <button
                          onClick={doToggleApprove}
                          disabled={setApproveMutation.isPending}
                          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", alignSelf: "flex-start", height: 30, padding: "0 12px", borderRadius: 6, border: `1px solid ${border.soft}`, background: "rgba(148,163,184,.06)", color: text.secondary, fontSize: 12, fontWeight: 600, cursor: "pointer", font: "inherit" }}
                        >
                          {selected.canApprovePurchases ? "Withdraw approval right" : "Grant approval right"}
                        </button>
                      </div>
                      <div style={{ border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>SESSIONS</span>
                        <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>
                          {selectedSessions.length} live refresh token{selectedSessions.length === 1 ? "" : "s"} in the MSP-wide list. Revoking closes every one and reports the count.
                        </span>
                        <button
                          onClick={doRevokeAllSessions}
                          disabled={revokeSessionsMutation.isPending}
                          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", alignSelf: "flex-start", height: 30, padding: "0 12px", borderRadius: 6, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint, color: signal.critical.strong, fontSize: 12, fontWeight: 600, cursor: revokeSessionsMutation.isPending ? "not-allowed" : "pointer", font: "inherit" }}
                        >
                          {revokeSessionsMutation.isPending ? "Working…" : "Sign them out everywhere"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 10, background: signal.warning.tint, padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: signal.warning.strong }}>Listed, but not staff</span>
                    <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>
                      This account is {nonStaffAccountLabel(selected.mspRole)} that happens to carry this MSP's id. The roster route returns it, but the role, scope and approval routes refuse it: only MSPAdmin and MSPOperator can be set or scoped here, and nothing on this surface can promote or demote anyone else.
                    </span>
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${border.faint}`, paddingTop: 12 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>STANDING</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      onClick={doToggleStatus}
                      disabled={setStatusMutation.isPending}
                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 30, padding: "0 12px", borderRadius: 6, border: `1px solid ${signal.warning.border}`, background: signal.warning.tint, color: signal.warning.strong, fontSize: 12, fontWeight: 600, cursor: "pointer", font: "inherit" }}
                    >
                      {selected.isActive ? "Suspend" : "Reactivate"}
                    </button>
                    <button
                      onClick={doRemove}
                      disabled={removeMutation.isPending}
                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 30, padding: "0 12px", borderRadius: 6, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint, color: signal.critical.strong, fontSize: 12, fontWeight: 600, cursor: "pointer", font: "inherit" }}
                    >
                      Remove from this MSP
                    </button>
                    <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", flex: 1, minWidth: 180 }}>
                      Both set the same inactive flag; neither deletes anything.{isSelf ? " Both refuse your own account." : ""}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
                    Password reset, one-time temporary password, MFA reset and MFA enforcement act on this same account from Account security — the five credential routes are shared between the two surfaces and are not repeated here.
                  </span>
                </div>

                {lastResult && <ResultPanel {...lastResult} />}
              </div>
            ) : (
              <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 14, padding: 26, display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>Pick a person</span>
                <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty", maxWidth: 320 }}>Role, customer scope, purchase approval, sessions and standing are all set here. Credentials are on Account security.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "invites" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
          <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong }}>Invite someone</span>
              <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>One email, one of two roles. Valid 72 hours.</span>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Email</span>
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@shanemccaw.com"
                style={{ height: 34, padding: "0 11px", borderRadius: 6, border: `1px solid ${border.soft}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12.5, font: "inherit", outline: "none", minWidth: 0 }}
              />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ASSIGNABLE_ROLES.map((r) => (
                <Chip key={r} label={r} on={inviteRole === r} onClick={() => setInviteRole(r)} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={doSendInvite}
                disabled={sendInviteMutation.isPending}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 32, padding: "0 13px", borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 12, fontWeight: 600, cursor: sendInviteMutation.isPending ? "not-allowed" : "pointer", font: "inherit" }}
              >
                <Icon name="send" size={13} style={{ marginRight: 6 }} />
                {sendInviteMutation.isPending ? "Sending…" : "Send invite"}
              </button>
            </div>
            {inviteResult && <ResultPanel {...inviteResult} />}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${border.faint}`, paddingTop: 12 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>WHAT THE INVITED PERSON GOES THROUGH</span>
              {[
                "They open the link. The public page shows the MSP's name and colours and the role they were offered; no sign-in yet. A used or expired token is refused, and so is any invite from a suspended MSP — a trial MSP's works.",
                "If the address already has an account, they must sign in as exactly that address first. Holding the invite link is never enough to move an existing account into your MSP.",
                "If it does not, name and a password of eight characters or more are required — accepting is also account creation.",
                "The token is burned inside the same transaction, so two people accepting at once cannot both succeed. They are then signed in, and if MFA is enforced on the account they land in enrolment rather than an open session.",
              ].map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", minWidth: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: signal.info.strong, marginTop: 2, flex: "none", width: 14 }}>{i + 1}</span>
                  <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.5, textWrap: "pretty", minWidth: 0 }}>{t}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong }}>Waiting to be accepted</span>
              <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>{invites.length} pending · newest first</span>
            </div>
            {invitesQuery.isLoading ? (
              <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span>
            ) : invites.length === 0 ? (
              <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 10, padding: 22, display: "flex", flexDirection: "column", gap: 6, alignItems: "center", textAlign: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: text.secondary }}>No pending invites</span>
                <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty", maxWidth: 360 }}>A real empty array. No invite has ever been sent from this MSP, so this is also the live state.</span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                {invites.map((i) => (
                  <div key={i.id} style={{ display: "flex", flexDirection: "column", gap: 7, border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong, flex: 1, minWidth: 140, wordBreak: "break-all" }}>{i.invitedEmail}</span>
                      <Pill label={i.mspRole} tone={signal.info} />
                    </span>
                    <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
                      expires {new Date(i.expiresAt).toLocaleString()} · invited by {i.inviterEmail ?? "unknown"}
                    </span>
                    {justCreatedInvite?.id === i.id && justCreatedInvite.token && (
                      <span style={{ fontSize: 10.5, fontFamily: "Menlo, monospace", color: signal.ok.strong, wordBreak: "break-all" }}>token: {justCreatedInvite.token}</span>
                    )}
                    <button
                      onClick={() => doRevokeInvite(i)}
                      disabled={revokeInviteMutation.isPending}
                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", alignSelf: "flex-start", height: 28, padding: "0 11px", borderRadius: 6, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint, color: signal.critical.strong, fontSize: 11.5, fontWeight: 600, cursor: "pointer", font: "inherit" }}
                    >
                      Revoke invite
                    </button>
                  </div>
                ))}
              </div>
            )}
            <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", borderTop: `1px solid ${border.faint}`, paddingTop: 10 }}>
              Only pending invites are listed. One that was accepted or that expired drops off this list but is never deleted, and an accepted one cannot be revoked — history is kept by omission rather than by a status.
            </span>
          </div>
        </div>
      )}

      {tab === "sessions" && (
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong }}>Active sessions across the MSP</span>
            <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", flex: 1, minWidth: 160 }}>{sessions.length} live · newest first · 100 at most</span>
            <input
              value={sessionQ}
              onChange={(e) => setSessionQ(e.target.value)}
              placeholder="filter by person — done here, not on the server"
              style={{ height: 30, width: 280, maxWidth: "100%", padding: "0 11px", borderRadius: 6, border: `1px solid ${border.soft}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12, font: "inherit", outline: "none" }}
            />
          </div>
          {sessionsQuery.isLoading ? (
            <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span>
          ) : sessions.length === 0 ? (
            <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 10, padding: 22, display: "flex", flexDirection: "column", gap: 6, alignItems: "center", textAlign: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: text.secondary }}>No live sessions</span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty", maxWidth: 360 }}>Every refresh token for every active account in this MSP is either revoked or expired.</span>
            </div>
          ) : (
            <div style={{ overflowX: "auto", minWidth: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 700 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1.2fr 1.2fr 1.4fr 110px", gap: 12, padding: "0 12px 6px", borderBottom: `1px solid ${border.faint}` }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>WHO</span>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>ISSUED</span>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>EXPIRES</span>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>TOKEN</span>
                  <span />
                </div>
                {sessions.map((s) => (
                  <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1.6fr 1.2fr 1.2fr 1.4fr 110px", gap: 12, alignItems: "center", border: `1px solid ${border.faint}`, borderRadius: 9, background: "rgba(2,6,23,.4)", padding: "10px 12px", minWidth: 0 }}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: text.strong, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                      <span style={{ fontSize: 10.5, color: text.label, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.email}</span>
                    </span>
                    <span style={{ fontSize: 11.5, color: text.secondary, whiteSpace: "nowrap" }}>{new Date(s.issuedAt).toLocaleString()}</span>
                    <span style={{ fontSize: 11.5, color: text.secondary, whiteSpace: "nowrap" }}>{new Date(s.expiresAt).toLocaleString()}</span>
                    <span style={{ fontSize: 11, fontFamily: "Menlo, monospace", color: signal.info.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.tokenHash}</span>
                    <button
                      onClick={() => doRevokeSession(s)}
                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 28, padding: "0 10px", borderRadius: 6, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint, color: signal.critical.strong, fontSize: 11.5, fontWeight: 600, cursor: "pointer", font: "inherit" }}
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {sessionResult && <ResultPanel {...sessionResult} />}
          <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", borderTop: `1px solid ${border.faint}`, paddingTop: 10 }}>
            One MSP-wide list, newest first, one hundred at most, active accounts only. There is no per-person session read — the name filter above runs in this screen — while the per-person revoke on the roster is real and returns how many it closed.
          </span>
        </div>
      )}
    </div>
  );
}
