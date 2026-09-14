/**
 * Retainer Hours module page (Git #2618), mounted by `ConsoleShell` at
 * `/ops/retainer`. Design: `Design/MSP_Console/design_handoff_msp_console/
 * Retainer Hours.dc.html`. Backend contract:
 * `docs/msp-console/retainer-hours-msp-console-contract-pack.md`.
 *
 * MSP-wide (Operations) rather than per-tenant, because the page's own left
 * rail is a customer picker across the whole MSP — same "one page, internal
 * customer switch" shape the design's own logic class uses, not a tenant-tree
 * node per customer.
 *
 * All 7 base routes plus the `#4026` "adjust after close" route are wired.
 * Reopening a period and adjusting a CLOSED period both require
 * `ladder.msp-admin` server-side — `isAdmin` gates those two actions in the UI,
 * the same convention `Sales`/`Reports`/`PoamsPage` already use for their own
 * admin-only actions on this console.
 */
import { useMemo, useState } from "react";
import { border, signal, surface, text } from "@/console/tokens";
import {
  useAdjustClosedRetainerPeriod, useAdjustRetainerEntry, useCloseRetainerPeriod,
  useDeleteRetainerEntry, useLogRetainerHours, useReopenRetainerPeriod,
  useRetainerCustomers, useRetainerDetail,
  type EntryWithLock, type RetainerPeriod, type RetainerWorkState,
} from "@/api/retainer-api";
import {
  AMBER, BLUE, formatDate, formatDateTime, formatHours, formatRate,
  GREEN, GREY, RED, STATE_DISPLAY, STATE_OPTIONS, stateTone,
} from "./format";

function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0, ...style }}>
      {children}
    </div>
  );
}

function Fact({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color, textWrap: "pretty" as const }}>{value}</span>
    </span>
  );
}

function Badge({ label, tone }: { label: string; tone: readonly [string, string, string] }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 19, padding: "0 8px", borderRadius: 999, background: tone[0], border: `1px solid ${tone[1]}`, fontSize: 10, fontWeight: 600, color: tone[2] }}>
      {label}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "7px 9px", borderRadius: 6, border: "1px solid rgba(148,163,184,.2)", background: "rgba(2,6,23,.7)",
  color: text.title, fontSize: 12, fontFamily: "inherit", outline: "none", minWidth: 0,
};
const taStyle: React.CSSProperties = { ...inputStyle, resize: "vertical", lineHeight: 1.55 };

function btnStyle(color: string, background: string, borderColor: string): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
    height: 28, padding: "0 11px", borderRadius: 6, border: `1px solid ${borderColor}`, background, color,
    fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  };
}

interface EntryFormState {
  item: string;
  hours: string;
  state: RetainerWorkState;
}

const EMPTY_FORM: EntryFormState = { item: "", hours: "", state: "in_progress" };

export function RetainerHours({ mspId, isAdmin }: { mspId: number | null; isAdmin: boolean }) {
  const customersQuery = useRetainerCustomers(mspId);
  const [selCustomerId, setSelCustomerId] = useState<number | null>(null);

  const customers = customersQuery.data?.customers ?? [];
  const effectiveSelId = selCustomerId ?? customers[0]?.customerId ?? null;

  const detailQuery = useRetainerDetail(mspId, effectiveSelId);
  const logHours = useLogRetainerHours(mspId, effectiveSelId);
  const adjustEntry = useAdjustRetainerEntry(mspId, effectiveSelId);
  const deleteEntry = useDeleteRetainerEntry(mspId, effectiveSelId);
  const closePeriod = useCloseRetainerPeriod(mspId, effectiveSelId);
  const reopenPeriod = useReopenRetainerPeriod(mspId, effectiveSelId);
  const adjustClosed = useAdjustClosedRetainerPeriod(mspId, effectiveSelId);

  const [addingEntry, setAddingEntry] = useState(false);
  const [newEntry, setNewEntry] = useState<EntryFormState>(EMPTY_FORM);
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EntryFormState>(EMPTY_FORM);
  const [overrideEntryId, setOverrideEntryId] = useState<number | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideDraft, setOverrideDraft] = useState<EntryFormState>(EMPTY_FORM);

  const selectCustomer = (id: number) => {
    setSelCustomerId(id);
    setAddingEntry(false);
    setEditingEntryId(null);
    setOverrideEntryId(null);
    logHours.reset(); adjustEntry.reset(); deleteEntry.reset();
    closePeriod.reset(); reopenPeriod.reset(); adjustClosed.reset();
  };

  const startEdit = (e: EntryWithLock) => {
    setEditingEntryId(e.id);
    setDraft({ item: e.item, hours: String(e.hours), state: e.stateStored });
  };
  const saveEdit = () => {
    if (editingEntryId == null) return;
    const hours = parseFloat(draft.hours);
    adjustEntry.mutate(
      { entryId: editingEntryId, item: draft.item.trim() || undefined, hours: Number.isNaN(hours) ? undefined : hours, state: draft.state },
      { onSuccess: () => setEditingEntryId(null) },
    );
  };

  const saveNewEntry = () => {
    const hours = parseFloat(newEntry.hours);
    if (!newEntry.item.trim() || Number.isNaN(hours)) return;
    logHours.mutate(
      { item: newEntry.item.trim(), hours, state: newEntry.state },
      { onSuccess: () => { setAddingEntry(false); setNewEntry(EMPTY_FORM); } },
    );
  };

  const startOverride = (e: EntryWithLock) => {
    setOverrideEntryId(e.id);
    setOverrideReason("");
    setOverrideDraft({ item: e.item, hours: String(e.hours), state: e.stateStored });
  };
  const saveOverride = (periodKey: string) => {
    if (overrideEntryId == null || !overrideReason.trim()) return;
    const hours = parseFloat(overrideDraft.hours);
    adjustClosed.mutate(
      {
        periodKey, entryId: overrideEntryId, action: "update", reason: overrideReason.trim(),
        item: overrideDraft.item.trim() || undefined, hours: Number.isNaN(hours) ? undefined : hours, state: overrideDraft.state,
      },
      { onSuccess: () => setOverrideEntryId(null) },
    );
  };
  const deleteOverride = (periodKey: string, entryId: number) => {
    if (!overrideReason.trim()) return;
    adjustClosed.mutate(
      { periodKey, entryId, action: "delete", reason: overrideReason.trim() },
      { onSuccess: () => setOverrideEntryId(null) },
    );
  };

  const selectedSummary = customers.find((c) => c.customerId === effectiveSelId);
  const detail = detailQuery.data;

  const notes = useMemo(() => ([
    { dot: RED[2], text: "overHours is the honest, uncapped over-allotment signal. remainingHours floors at zero and is also true for a customer who used exactly their allotment — over-month must be read from overHours, never inferred from remaining hitting zero." },
    { dot: AMBER[2], text: "Periods are anniversary-anchored to each customer's own subscription start day, not calendar months, and unused retained hours roll forward once before expiring. A customer whose anchor day shifts mid-history can end up with period keys that don't line up across the change — a known, documented edge case, not a bug." },
    { dot: AMBER[2], text: "A tracked, open gap: the tracker byproduct hook that logs closed-ticket hours automatically (change control / remediation tracker completions) does not check the period-close lock before inserting. Minutes are 0 at insert time so totals don't move immediately, but a later hours edit on that row could slip past a closed period. The AdminV2/console close-lock bypass this same finding (#4026) originally covered is already resolved — every normal writer on both AdminV2 and this console honors the lock." },
    { dot: BLUE[2], text: "Allotment, hourly rate and architect name are read-only here — they are written only from AdminV2. This screen can log, adjust, delete and move entries between open periods, close or reopen a period, and — as MSP admin only — make a reasoned override into an already-closed period." },
    { dot: BLUE[2], text: "Reopening a period hard-deletes its frozen snapshot rather than archiving it — there is no history table. Once reopened, the only surviving trace of who closed it and when lives in the audit log, not in the retainer data itself." },
    { dot: text.muted, text: "Moving an entry's date into a different period requires that target period to also be open — a move between two open periods succeeds, but nothing can be moved into a closed one, even from an open one, outside the admin override path." },
    { dot: text.muted, text: "The error envelope on every route here is a bare { error } string, with no error code field." },
  ]), []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>

        <Panel style={{ padding: 16 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Customers on retainer</span>
          {customersQuery.isLoading && <span style={{ fontSize: 12, color: text.muted }}>Loading customers…</span>}
          {customersQuery.isError && <span style={{ fontSize: 12, color: signal.warning.strong }}>Couldn't load: {customersQuery.error.message}</span>}
          {customersQuery.isSuccess && customers.length === 0 && (
            <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" as const }}>This MSP has no customers yet.</span>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            {customers.map((c) => {
              const on = c.customerId === effectiveSelId;
              const tone = !c.configured ? GREY : c.bucket.isOverMonth ? RED : GREEN;
              const tag = !c.configured ? "not configured" : c.bucket.isOverMonth ? "over" : "on retainer";
              const summary = !c.configured
                ? "Not configured — no retainer_settings row"
                : `${formatHours(c.bucket.usedHours)} used of ${formatHours(c.bucket.retainedHours)} · ${c.bucket.isOverMonth ? `${formatHours(c.bucket.overHours)} over` : `${formatHours(c.bucket.remainingHours)} left`}`;
              return (
                <button key={c.customerId} onClick={() => selectCustomer(c.customerId)}
                  style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left", border: `1px solid ${on ? "rgba(96,165,250,.4)" : "rgba(148,163,184,.14)"}`, borderRadius: 10, background: on ? "rgba(37,99,235,.1)" : "transparent", padding: 11, cursor: "pointer", fontFamily: "inherit", minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title, flex: 1, minWidth: 100 }}>{c.name}</span>
                    <Badge label={tag} tone={tone} />
                  </span>
                  <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" as const }}>{summary}</span>
                </button>
              );
            })}
          </div>
        </Panel>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {detailQuery.isLoading && <Panel><span style={{ fontSize: 12.5, color: text.muted }}>Loading retainer…</span></Panel>}
          {detailQuery.isError && (
            <Panel>
              <span style={{ fontSize: 13, fontWeight: 700, color: signal.warning.strong }}>Couldn't load this customer's retainer</span>
              <span style={{ fontSize: 12, color: text.muted }}>{detailQuery.error.message}</span>
            </Panel>
          )}

          {detail && !detail.settings.configured && (
            <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 14, padding: 26, display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>No retainer configured for {detail.customer.name}</span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" as const, maxWidth: 380 }}>
                There is no retainer_settings row for this customer, so there is no allotment, rate or period to show — and, per the route's own rule, no period could ever be closed here either: a close attempt against an unconfigured customer is refused outright rather than snapshotting a default allotment nobody bought.
              </span>
            </div>
          )}

          {detail && detail.settings.configured && (
            <>
              <Panel>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: text.title, flex: 1, minWidth: 160 }}>{detail.customer.name}</span>
                  <span style={{ fontSize: 11, color: text.muted }}>Anchor day {detail.anchorDay} · current period {detail.currentPeriod}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 12 }}>
                  <Fact label="RETAINED HOURS" value={`${formatHours(detail.settings.retainedHours)} / period`} color={text.title} />
                  <Fact label="RATE" value={formatRate(detail.settings.hourlyRateCents)} color={text.title} />
                  <Fact label="ARCHITECT" value={detail.settings.architectName ?? "—"} color={text.title} />
                  <Fact label="ACTIVE" value={detail.settings.active ? "yes" : "no"} color={detail.settings.active ? GREEN[2] : RED[2]} />
                </div>
                <span style={{ fontSize: 10.5, color: text.muted, borderTop: "1px solid rgba(148,163,184,.12)", paddingTop: 10 }}>
                  Allotment, rate and architect are written only from AdminV2 — this screen reads them but cannot change them.
                </span>
              </Panel>

              <Panel style={{ border: `1px solid ${detail.bucket.isOverMonth ? RED[1] : border.card}`, background: detail.bucket.isOverMonth ? RED[0] : surface.card }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>This period's bucket</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 12 }}>
                  <Fact label="RETAINED" value={formatHours(detail.bucket.retainedHours)} color={text.title} />
                  <Fact label="ROLLED IN" value={formatHours(detail.bucket.rolledHours)} color={text.title} />
                  <Fact label="USED" value={formatHours(detail.bucket.usedHours)} color={text.title} />
                  <Fact label="REMAINING" value={formatHours(detail.bucket.remainingHours)} color={detail.bucket.remainingHours === 0 ? text.muted : GREEN[2]} />
                  <Fact label="OVER" value={formatHours(detail.bucket.overHours)} color={detail.bucket.overHours > 0 ? RED[2] : text.muted} />
                </div>
                {detail.bucket.isOverMonth && (
                  <span style={{ fontSize: 11.5, color: RED[2], textWrap: "pretty" as const, borderTop: "1px solid rgba(248,113,113,.18)", paddingTop: 10 }}>
                    Over this month's allotment. Remaining hours floor at zero — this over figure is the only honest signal of how far past the line the customer is; it is never inferred from remaining hitting zero.
                  </span>
                )}
              </Panel>

              <Panel>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Periods</span>
                {detail.periods.map((p) => (
                  <PeriodCard
                    key={p.periodKey} period={p} isAdmin={isAdmin}
                    onClose={() => closePeriod.mutate({ periodKey: p.periodKey })}
                    onReopen={() => reopenPeriod.mutate(p.periodKey)}
                    closePending={closePeriod.isPending} reopenPending={reopenPeriod.isPending}
                  />
                ))}
              </Panel>

              <Panel>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title, flex: 1 }}>Ledger</span>
                  <button onClick={() => { setAddingEntry((v) => !v); setNewEntry(EMPTY_FORM); }} style={btnStyle(BLUE[2], BLUE[0], "rgba(96,165,250,.3)")}>
                    {addingEntry ? "Cancel" : "Log hours"}
                  </button>
                </div>

                {addingEntry && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid rgba(96,165,250,.25)", borderRadius: 10, background: "rgba(96,165,250,.05)", padding: 12, minWidth: 0 }}>
                    <input value={newEntry.item} onChange={(e) => setNewEntry((s) => ({ ...s, item: e.target.value }))} placeholder="Item (what was done)" style={inputStyle} />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input value={newEntry.hours} onChange={(e) => setNewEntry((s) => ({ ...s, hours: e.target.value }))} placeholder="Hours" style={{ ...inputStyle, width: 100 }} />
                      <select value={newEntry.state} onChange={(e) => setNewEntry((s) => ({ ...s, state: e.target.value as RetainerWorkState }))} style={inputStyle}>
                        {STATE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <span style={{ fontSize: 10.5, color: text.muted, textWrap: "pretty" as const }}>Logged with source "unscoped" and today's date, straight into the current open period.</span>
                    {logHours.isError && <span style={{ fontSize: 11.5, color: RED[2] }}>{logHours.error.message}</span>}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={saveNewEntry} disabled={logHours.isPending} style={btnStyle("#fff", "#2563eb", "#2563eb")}>{logHours.isPending ? "Saving…" : "Log hours"}</button>
                      <button onClick={() => setAddingEntry(false)} style={btnStyle(text.muted, "transparent", "rgba(148,163,184,.2)")}>Cancel</button>
                    </div>
                  </div>
                )}

                {detail.entries.length === 0 && (
                  <span style={{ fontSize: 11.5, color: text.muted, textAlign: "center", padding: "14px 0" }}>No entries logged this customer, on any period.</span>
                )}

                {detail.entries.map((e) => {
                  const editing = editingEntryId === e.id;
                  const overriding = overrideEntryId === e.id;
                  const tone = stateTone(e.stateStored);
                  return (
                    <div key={e.id} style={{ border: `1px solid ${editing || overriding ? "rgba(96,165,250,.4)" : "rgba(148,163,184,.14)"}`, borderRadius: 10, background: editing || overriding ? "rgba(96,165,250,.05)" : "rgba(2,6,23,.4)", padding: 11, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                      {editing ? (
                        <>
                          <input value={draft.item} onChange={(ev) => setDraft((s) => ({ ...s, item: ev.target.value }))} style={inputStyle} />
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <input value={draft.hours} onChange={(ev) => setDraft((s) => ({ ...s, hours: ev.target.value }))} style={{ ...inputStyle, width: 100 }} />
                            <select value={draft.state} onChange={(ev) => setDraft((s) => ({ ...s, state: ev.target.value as RetainerWorkState }))} style={inputStyle}>
                              {STATE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </div>
                          {adjustEntry.isError && <span style={{ fontSize: 11, color: RED[2] }}>{adjustEntry.error.message}</span>}
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button onClick={saveEdit} disabled={adjustEntry.isPending} style={btnStyle("#fff", "#2563eb", "#2563eb")}>Save</button>
                            <button onClick={() => setEditingEntryId(null)} style={btnStyle(text.muted, "transparent", "rgba(148,163,184,.2)")}>Cancel</button>
                            <button onClick={() => deleteEntry.mutate(e.id)} disabled={deleteEntry.isPending} style={btnStyle(RED[2], "rgba(248,113,113,.08)", "rgba(248,113,113,.24)")}>Delete</button>
                          </div>
                        </>
                      ) : overriding ? (
                        <>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: AMBER[2] }}>MSP-admin override — this period is closed</span>
                          <input value={overrideDraft.item} onChange={(ev) => setOverrideDraft((s) => ({ ...s, item: ev.target.value }))} style={inputStyle} />
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <input value={overrideDraft.hours} onChange={(ev) => setOverrideDraft((s) => ({ ...s, hours: ev.target.value }))} style={{ ...inputStyle, width: 100 }} />
                            <select value={overrideDraft.state} onChange={(ev) => setOverrideDraft((s) => ({ ...s, state: ev.target.value as RetainerWorkState }))} style={inputStyle}>
                              {STATE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </div>
                          <textarea value={overrideReason} onChange={(ev) => setOverrideReason(ev.target.value)} rows={2} placeholder="Reason (required)" style={taStyle} />
                          {adjustClosed.isError && <span style={{ fontSize: 11, color: RED[2] }}>{adjustClosed.error.message}</span>}
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button onClick={() => saveOverride(e.periodMonth)} disabled={adjustClosed.isPending || !overrideReason.trim()} style={btnStyle("#fff", "#2563eb", "#2563eb")}>Save override</button>
                            <button onClick={() => setOverrideEntryId(null)} style={btnStyle(text.muted, "transparent", "rgba(148,163,184,.2)")}>Cancel</button>
                            <button onClick={() => deleteOverride(e.periodMonth, e.id)} disabled={adjustClosed.isPending || !overrideReason.trim()} style={btnStyle(RED[2], "rgba(248,113,113,.08)", "rgba(248,113,113,.24)")}>Delete override</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: text.title, flex: 1, minWidth: 140, textWrap: "pretty" as const }}>{e.item}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: text.title }}>{formatHours(e.hours)}</span>
                            <Badge label={STATE_DISPLAY[e.stateStored] ?? e.state} tone={tone} />
                          </div>
                          <span style={{ fontSize: 10.5, color: text.muted }}>{formatDate(e.occurredAt)} · source: {e.source}</span>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            {e.periodClosed ? (
                              <>
                                <span style={{ fontSize: 10.5, color: AMBER[2] }}>Period closed — this row is frozen; reopen the period to change it.</span>
                                {isAdmin && (
                                  <button onClick={() => startOverride(e)} style={btnStyle(AMBER[2], AMBER[0], "rgba(251,191,36,.3)")}>Override (admin)</button>
                                )}
                              </>
                            ) : (
                              <button onClick={() => startEdit(e)} style={btnStyle(text.secondary, "rgba(148,163,184,.06)", "rgba(148,163,184,.2)")}>Adjust</button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </Panel>
            </>
          )}

          {!detailQuery.isLoading && !detail && customersQuery.isSuccess && customers.length > 0 && !effectiveSelId && (
            <span style={{ fontSize: 12, color: text.muted }}>Select a customer.</span>
          )}
        </div>
      </div>

      <Panel>
        <span style={{ fontSize: 12, fontWeight: 700, color: text.title }}>What this router does and doesn't give this screen</span>
        {notes.map((n, i) => (
          <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", minWidth: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: n.dot, marginTop: 6, flex: "none" }} />
            <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55, textWrap: "pretty" as const, minWidth: 0 }}>{n.text}</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function PeriodCard({
  period, isAdmin, onClose, onReopen, closePending, reopenPending,
}: {
  period: RetainerPeriod;
  isAdmin: boolean;
  onClose: () => void;
  onReopen: () => void;
  closePending: boolean;
  reopenPending: boolean;
}) {
  const canClose = !period.closed && period.hasEnded;
  const canReopen = period.closed && isAdmin;
  const tone = period.closed ? GREY : period.hasEnded ? AMBER : BLUE;
  const tag = period.closed ? "closed" : period.hasEnded ? "ended, open" : "open";
  const bucketLine = `${formatHours(period.bucket.usedHours)} used of ${formatHours(period.bucket.retainedHours)}`
    + (period.bucket.isOverMonth ? ` · ${formatHours(period.bucket.overHours)} over` : "")
    + (period.closed ? " · frozen at close" : " · live, recomputed from the ledger");

  return (
    <div style={{ border: "1px solid rgba(148,163,184,.14)", borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 11, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: text.title, fontFamily: "Menlo, monospace" }}>{period.periodKey}</span>
        <span style={{ fontSize: 10.5, color: text.muted, flex: 1, minWidth: 100 }}>ends {formatDate(period.endsAt)} · {period.entryCount} entries</span>
        {period.isCurrent && <Badge label="CURRENT" tone={BLUE} />}
        <Badge label={tag} tone={tone} />
      </div>
      <span style={{ fontSize: 11, color: text.secondary }}>{bucketLine}</span>
      {period.close && (
        <span style={{ fontSize: 10.5, color: text.muted }}>Closed {formatDateTime(period.close.closedAt)}{period.close.note ? ` — "${period.close.note}"` : ""}</span>
      )}
      {period.adjustmentNotes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid rgba(148,163,184,.1)", paddingTop: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: text.muted }}>ADMIN OVERRIDES AFTER CLOSE</span>
          {period.adjustmentNotes.map((n) => (
            <span key={n.id} style={{ fontSize: 10.5, color: text.secondary, textWrap: "pretty" as const }}>
              {n.action} · {n.item} · {formatDateTime(n.createdAt)} — "{n.reason}"
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {canClose && <button onClick={onClose} disabled={closePending} style={btnStyle(BLUE[2], BLUE[0], "rgba(96,165,250,.3)")}>{closePending ? "Closing…" : "Close period"}</button>}
        {canReopen && <button onClick={onReopen} disabled={reopenPending} style={btnStyle(AMBER[2], AMBER[0], "rgba(251,191,36,.3)")}>{reopenPending ? "Reopening…" : "Reopen (MSPAdmin)"}</button>}
        {period.closed && !isAdmin && <span style={{ fontSize: 10.5, color: text.muted }}>Reopening requires MSPAdmin.</span>}
        {!period.closed && !period.hasEnded && <span style={{ fontSize: 10.5, color: text.muted }}>Cannot close before the period ends.</span>}
      </div>
    </div>
  );
}
