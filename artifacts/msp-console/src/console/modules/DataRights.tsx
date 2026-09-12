/**
 * DataRights — MSP Console module page (Git #2633, Feature #2565). Mounts into
 * the shell's `ScreenSlot` at `/tenants/:id/dr`
 * (`Design/MSP_Console/design_handoff_msp_console/Data Rights.dc.html`, README
 * screen 16), wiring the real, previously-orphaned backend documented in full
 * at `docs/msp-console/data-rights-and-privacy-msp-console-contract-pack.md`.
 *
 * Two tabs, faithful to the design's own logic class where the real backend
 * covers it:
 *
 *   Activity — this tenant's slice of the MSP-wide `GET /msp/data-rights` feed
 *              (deletion requests + data exports), filtered client-side —
 *              there is no server-side per-customer filter on that route.
 *   People   — this customer's linked portal users
 *              (`GET .../customers/:id/users`), each with a "File a deletion
 *              request" action.
 *
 * Real, honest departures from the design's fixture-driven mock:
 *   - The design's activity rows and "REQUESTS ON FILE" people column identify
 *     the SPECIFIC target person per request. The real `GET /msp/data-rights`
 *     response never returns the target user's id, name or email on a
 *     row — only the acting admin's name (`submittedByName`) and the bridged
 *     customer. There is genuinely no way to attribute a filed request to one
 *     row in the People roster from this backend, so the People tab does not
 *     claim a per-person request count; the Activity tab is the true record.
 *   - The design's picker drawer shows a "WHAT THEY HOLD TODAY" schema
 *     preview before a request is filed, from a client-side fixture. No real
 *     endpoint computes a schema footprint ahead of filing — the real
 *     `CurrentSchemaSummary` only comes back in the POST response, and in
 *     each Activity row once filed. This drawer does not fabricate a
 *     pre-submission preview; the real summary is shown in the confirmation
 *     that follows a successful filing instead.
 *   - Schema tags use the real `CurrentSchemaSummary` fields (diagnostic runs
 *     and findings, SOWs, MSP documents, engine snapshots), never the
 *     design's placeholder categories ("assessments" / "support threads" /
 *     "invoices"), which are not real columns.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon, type IconName } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import {
  DataRightsApiError,
  useCustomerLinkedUsers,
  useDataRightsActivity,
  useFileDeletionRequest,
  type CurrentSchemaSummary,
  type CustomerLinkedUser,
  type DataRightsActivityRow,
} from "@/api/data-rights-api";

type Tab = "activity" | "people";
type ActivityFilter = "all" | "deletion_request_submitted" | "data_export_downloaded";

const SCHEMA_LABELS: { key: keyof CurrentSchemaSummary; label: string }[] = [
  { key: "diagnosticRuns", label: "diagnostic runs" },
  { key: "diagnosticFindings", label: "diagnostic findings" },
  { key: "sows", label: "SOWs" },
  { key: "mspDocuments", label: "MSP documents" },
  { key: "engineSnapshots", label: "engine snapshots" },
];

function SchemaTags({ schema }: { schema: CurrentSchemaSummary }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {SCHEMA_LABELS.map(({ key, label }) => (
        <span
          key={key}
          style={{
            display: "inline-flex", alignItems: "baseline", gap: 5, padding: "3px 9px", borderRadius: 7,
            background: "rgba(2,6,23,.5)", border: "1px solid rgba(148,163,184,.16)", fontSize: 11, color: text.muted, whiteSpace: "nowrap",
          }}
        >
          {label}
          <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.secondary }}>{schema[key]}</span>
        </span>
      ))}
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatePanel({
  icon, tone, title, body, wire,
}: {
  icon: IconName;
  tone: { strong: string; text: string; tint: string; border: string };
  title: string;
  body: string;
  wire: string;
}) {
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 22, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 13, background: tone.tint, border: `1px solid ${tone.border}` }}>
        <Icon name={icon} size={20} color={tone.text} />
      </span>
      <span style={{ fontSize: 16, fontWeight: 700, color: text.title }}>{title}</span>
      <span style={{ fontSize: 13, color: text.muted, textWrap: "pretty", lineHeight: 1.5 }}>{body}</span>
      <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.faint, wordBreak: "break-all" }}>{wire}</span>
    </div>
  );
}

export function DataRights({ customerId }: { customerId: number }) {
  const [tab, setTab] = useState<Tab>("activity");
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [pickOpen, setPickOpen] = useState(false);
  const [pickedUserId, setPickedUserId] = useState<number | null>(null);
  const [filedFor, setFiledFor] = useState<{ name: string; schema: CurrentSchemaSummary | null } | null>(null);

  const activityQuery = useDataRightsActivity();
  const usersQuery = useCustomerLinkedUsers(customerId);
  const fileRequest = useFileDeletionRequest(customerId);

  const rows = useMemo(
    () => (activityQuery.data?.requests ?? []).filter((r) => r.customerId === customerId),
    [activityQuery.data, customerId],
  );
  const users = usersQuery.data?.users ?? [];
  const picked = pickedUserId != null ? users.find((u) => u.userId === pickedUserId) ?? null : null;

  const filterDefs: { id: ActivityFilter; label: string }[] = [
    { id: "all", label: "Everything" },
    { id: "deletion_request_submitted", label: "Deletion requests" },
    { id: "data_export_downloaded", label: "Data exports" },
  ];
  const visible = rows.filter((r) => filter === "all" || r.actionType === filter);

  const closePick = () => { setPickOpen(false); setPickedUserId(null); };

  const submit = () => {
    if (picked == null) return;
    fileRequest.mutate(picked.userId, {
      onSuccess: (res) => {
        setPickOpen(false);
        setPickedUserId(null);
        setFiledFor({ name: picked.name ?? picked.email, schema: res.currentSchemaSummary });
      },
      onError: (err) => {
        toast.error(err instanceof DataRightsApiError ? err.message : "Failed to submit the deletion request.");
      },
    });
  };

  // The MSP-admin-role gate (requireCapability("ladder.msp-admin")) applies to
  // the activity feed; assertCustomerAccess applies to the users/deletion-
  // request endpoints. Both surface as 403 but mean different things — show
  // the real server message either way rather than guessing which applies.
  if (activityQuery.isError) {
    const status = activityQuery.error instanceof DataRightsApiError ? activityQuery.error.status : null;
    return (
      <StatePanel
        icon={status === 403 ? "shield-alert" : "triangle-alert"}
        tone={status === 403 ? signal.critical : signal.warning}
        title={status === 403 ? "MSPAdmin required" : "Data rights activity could not be loaded"}
        body={activityQuery.error.message}
        wire={`GET /api/msp/data-rights · ${status ?? "error"}`}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {(
          [
            { id: "activity" as const, label: "Activity", count: rows.length },
            { id: "people" as const, label: "People", count: users.length },
          ]
        ).map((t) => {
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
        <button
          onClick={() => { setPickedUserId(null); setPickOpen(true); }}
          style={{
            display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: 7,
            border: `1px solid ${signal.critical.border}`, background: signal.critical.tint, color: signal.critical.text,
            fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          <Icon name="user-x" size={13} />
          File a deletion request
        </button>
      </div>

      {tab === "activity" && (
        <ActivityTab
          rows={rows}
          visible={visible}
          filterDefs={filterDefs}
          filter={filter}
          onFilter={setFilter}
          loading={activityQuery.isLoading}
        />
      )}

      {tab === "people" && (
        <PeopleTab
          users={users}
          loading={usersQuery.isLoading}
          error={usersQuery.isError}
          errorStatus={usersQuery.error instanceof DataRightsApiError ? usersQuery.error.status : null}
          errorMessage={usersQuery.error?.message}
          onFile={(userId) => { setPickedUserId(userId); setPickOpen(true); }}
        />
      )}

      {pickOpen && (
        <PickDrawer
          users={users}
          usersLoading={usersQuery.isLoading}
          picked={picked}
          onPick={setPickedUserId}
          onClose={closePick}
          onSubmit={submit}
          submitting={fileRequest.isPending}
        />
      )}

      {filedFor && (
        <FiledModal filedFor={filedFor} onClose={() => setFiledFor(null)} />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 2 }}>
        <Icon name="info" size={13} color={text.faint} />
        <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
          A filed request has no status to track — the activity row above is the whole record. The work itself is done
          by hand within the 30-day retention window.
        </span>
      </div>
    </div>
  );
}

// ── Activity tab ──────────────────────────────────────────────────────────────

function ActivityTab({
  rows, visible, filterDefs, filter, onFilter, loading,
}: {
  rows: DataRightsActivityRow[];
  visible: DataRightsActivityRow[];
  filterDefs: { id: ActivityFilter; label: string }[];
  filter: ActivityFilter;
  onFilter: (f: ActivityFilter) => void;
  loading: boolean;
}) {
  if (loading) return <div style={{ fontSize: 11.5, color: text.muted }}>Loading this tenant's data-rights activity…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        {filterDefs.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => onFilter(f.id)}
              style={{
                height: 28, padding: "0 10px", borderRadius: 7,
                border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
                background: active ? "rgba(37,99,235,.18)" : "transparent",
                color: active ? "#bfdbfe" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {f.label}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: text.label, whiteSpace: "nowrap" }}>{visible.length} of {rows.length} entries</span>
      </div>

      {visible.length === 0 ? (
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <span style={{ width: 42, height: 42, borderRadius: 13, background: signal.ok.tint, border: `1px solid ${signal.ok.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="shield-check" size={20} color={signal.ok.strong} />
          </span>
          <span style={{ fontSize: 15.5, fontWeight: 700, color: text.title }}>
            {rows.length === 0 ? "Nothing has been requested" : "Nothing of that kind"}
          </span>
          <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 440, textWrap: "pretty" }}>
            {rows.length === 0
              ? "Every data export and every deletion request for this tenant shows up here, whether the customer asked for it themselves or we filed it for them."
              : "Nothing matches that filter. Widen it to see the rest of the activity."}
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map((row) => {
            const isDeletion = row.actionType === "deletion_request_submitted";
            const tone = isDeletion ? signal.critical : signal.info;
            return (
              <div key={row.id} style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: "14px 15px", display: "flex", gap: 13, alignItems: "flex-start", minWidth: 0 }}>
                <span style={{ width: 30, height: 30, flex: "0 0 30px", borderRadius: 9, background: tone.tint, border: `1px solid ${tone.border}`, color: tone.strong, padding: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name={isDeletion ? "user-x" : "download"} size={16} />
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: text.title, textWrap: "pretty" }}>
                      {isDeletion ? "Deletion requested" : "Data export downloaded"}
                    </span>
                    <span style={{
                      display: "inline-flex", padding: "2px 9px", borderRadius: 999, fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap",
                      background: row.submittedByAdmin ? signal.notice.tint : signal.neutral.tint,
                      border: `1px solid ${row.submittedByAdmin ? signal.notice.border : signal.neutral.border}`,
                      color: row.submittedByAdmin ? "#c4b5fd" : text.muted,
                    }}>
                      {row.submittedByAdmin ? "filed by us" : "by the customer"}
                    </span>
                  </div>
                  <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
                    {row.submittedByAdmin && row.submittedByName ? `Recorded by ${row.submittedByName}` : "Submitted via self-service"}
                  </span>
                  {row.currentSchema && (
                    <div style={{ marginTop: 3 }}>
                      <SchemaTags schema={row.currentSchema} />
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 11.5, color: text.muted, whiteSpace: "nowrap", flex: "0 0 auto" }}>{formatWhen(row.createdAt)}</span>
              </div>
            );
          })}
          <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
            {rows.length >= 200
              ? "Showing the most recent 200 across the whole MSP. There is no way to page further back than that."
              : "Everything on record for this tenant, newest first."}
          </span>
        </div>
      )}
    </div>
  );
}

// ── People tab ────────────────────────────────────────────────────────────────

function PeopleTab({
  users, loading, error, errorStatus, errorMessage, onFile,
}: {
  users: CustomerLinkedUser[];
  loading: boolean;
  error: boolean;
  errorStatus: number | null;
  errorMessage: string | undefined;
  onFile: (userId: number) => void;
}) {
  if (loading) return <div style={{ fontSize: 11.5, color: text.muted }}>Loading this tenant's linked users…</div>;
  if (error) {
    return (
      <StatePanel
        icon={errorStatus === 403 ? "shield-alert" : "triangle-alert"}
        tone={errorStatus === 403 ? signal.critical : signal.warning}
        title={errorStatus === 403 ? "Not authorized for this customer" : "Linked users could not be loaded"}
        body={errorMessage ?? "The request failed. Try again shortly."}
        wire={`GET /api/msp/data-rights/customers/:id/users · ${errorStatus ?? "error"}`}
      />
    );
  }
  if (users.length === 0) {
    return (
      <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
        <span style={{ fontSize: 15.5, fontWeight: 700, color: text.title }}>No linked portal accounts</span>
        <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 430, textWrap: "pretty" }}>
          This customer has no user accounts on the portal yet, so there is no one to file a data-rights request for.
        </span>
      </div>
    );
  }

  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflowX: "auto" }}>
      <div style={{ minWidth: 640 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 2fr 1fr 150px", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.soft}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
          <span>PERSON</span><span>SIGN-IN</span><span>ACCOUNT</span><span style={{ textAlign: "right" }}>ACTION</span>
        </div>
        {users.map((u) => {
          const displayName = u.name ?? u.email;
          const initials = displayName.split(/\s+/).filter(Boolean).map((p) => p.charAt(0)).join("").slice(0, 2).toUpperCase();
          return (
            <div key={u.userId} style={{ display: "grid", gridTemplateColumns: "1.6fr 2fr 1fr 150px", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${border.faint}`, opacity: u.isActive ? 1 : 0.72 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, background: "rgba(96,165,250,.14)", border: "1px solid rgba(96,165,250,.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, color: "#93c5fd" }}>
                  {initials || "?"}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: text.title, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayName}</span>
              </span>
              <span style={{ fontSize: 12, color: text.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</span>
              <span style={{
                display: "inline-flex", justifySelf: "start", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
                background: u.isActive ? signal.ok.tint : signal.neutral.tint,
                border: `1px solid ${u.isActive ? signal.ok.border : signal.neutral.border}`,
                color: u.isActive ? signal.ok.text : text.muted,
              }}>
                {u.isActive ? "active" : "inactive"}
              </span>
              <button
                onClick={() => onFile(u.userId)}
                style={{ justifySelf: "end", height: 30, padding: "0 11px", borderRadius: 7, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint, color: signal.critical.text, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                File a request
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Deletion-request drawer ───────────────────────────────────────────────────

function PickDrawer({
  users, usersLoading, picked, onPick, onClose, onSubmit, submitting,
}: {
  users: CustomerLinkedUser[];
  usersLoading: boolean;
  picked: CustomerLinkedUser | null;
  onPick: (userId: number) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(460px,94%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.critical.text }}>DELETION REQUEST</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>Delete someone's data</span>
            <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>
              One person per request, chosen from this tenant's portal accounts. There is no way to file for a whole customer at once.
            </span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "none", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>Who is it for</span>
          {usersLoading ? (
            <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span>
          ) : users.length === 0 ? (
            <span style={{ fontSize: 11.5, color: text.muted }}>This customer has no linked portal accounts.</span>
          ) : (
            users.map((u) => {
              const isPicked = picked?.userId === u.userId;
              return (
                <button
                  key={u.userId}
                  onClick={() => onPick(u.userId)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 11px", borderRadius: 9,
                    border: `1px solid ${isPicked ? "rgba(96,165,250,.34)" : border.card}`,
                    background: isPicked ? "rgba(37,99,235,.16)" : "rgba(2,6,23,.4)",
                    cursor: "pointer", textAlign: "left", minWidth: 0,
                  }}
                >
                  <Icon name={isPicked ? "circle-check-big" : "circle"} size={14} color={isPicked ? signal.info.strong : text.faint} />
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: text.title, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name ?? u.email}</span>
                    <span style={{ fontSize: 11, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</span>
                  </span>
                  <span style={{ fontSize: 11, color: u.isActive ? signal.ok.text : text.muted, whiteSpace: "nowrap" }}>{u.isActive ? "active" : "inactive"}</span>
                </button>
              );
            })
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: 13, borderRadius: 11, border: `1px solid ${signal.warning.border}`, background: signal.warning.tint }}>
          <div style={{ display: "flex", gap: 10 }}>
            <Icon name="triangle-alert" size={15} color={signal.warning.strong} />
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: text.title, textWrap: "pretty" }}>Filing this records the request — it does not erase anything</span>
              <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>
                The work is done by hand within 30 days. Signed contracts and invoices are kept for seven years because the law requires it.
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
          <button
            onClick={onSubmit}
            disabled={picked == null || submitting}
            title={picked == null ? "Choose which person the request is for" : ""}
            style={{
              flex: 1, height: 38, borderRadius: 8,
              border: `1px solid ${picked ? signal.critical.border : border.card}`,
              background: picked ? signal.critical.tint : "transparent",
              color: picked ? signal.critical.text : text.muted,
              fontSize: 13, fontWeight: 600, cursor: picked == null || submitting ? "not-allowed" : "pointer",
              opacity: picked == null ? 0.6 : 1,
            }}
          >
            {submitting ? "Filing…" : picked ? `File the request for ${(picked.name ?? picked.email).split(" ")[0]}` : "Pick someone first"}
          </button>
          <button onClick={onClose} style={{ height: 38, padding: "0 15px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Filed confirmation ────────────────────────────────────────────────────────

function FiledModal({
  filedFor, onClose,
}: {
  filedFor: { name: string; schema: CurrentSchemaSummary | null };
  onClose: () => void;
}) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.7)", backdropFilter: "blur(3px)", zIndex: 92, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px,100%)", background: "#0b1728", border: `1px solid ${signal.ok.border}`, borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", gap: 13, minWidth: 0 }}>
        <span style={{ width: 34, height: 34, borderRadius: 11, background: signal.ok.tint, border: `1px solid ${signal.ok.border}`, color: signal.ok.strong, padding: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="circle-check-big" size={18} />
        </span>
        <span style={{ fontSize: 16, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>
          Deletion request filed for {filedFor.name}
        </span>
        <span style={{ fontSize: 12.5, color: text.secondary, textWrap: "pretty" }}>
          Recorded on the customer's behalf. It will be handled within 30 days under the standard retention policy. Signed contracts and invoices are kept for seven years as required by law.
        </span>
        {filedFor.schema && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>WHAT THEY HOLD TODAY, CAPTURED WITH THE REQUEST</span>
            <SchemaTags schema={filedFor.schema} />
          </div>
        )}
        <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
          This is the whole record. There is no status to follow and nothing to mark as done — the request sits in the activity list from here on.
        </span>
        <button onClick={onClose} style={{ alignSelf: "flex-start", height: 34, padding: "0 14px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
          Close
        </button>
      </div>
    </div>
  );
}
