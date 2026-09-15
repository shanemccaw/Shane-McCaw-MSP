/**
 * Invoices — MSP-wide module page (Git #4109, wiring done by #2609),
 * Commercial "Billing" nav slot. Wires the real route surface in
 * `artifacts/api-server/src/routes/msp-invoices.ts` via `@/api/invoices-api`.
 *
 * Invoices are billed to `usersTable` rows (the legacy client-portal-user
 * axis) — not `tenantsTable`. There is no FK between the two, so this tab
 * carries its own client picker rather than inheriting the tenant currently
 * selected in the tree above it (see `invoices-api.ts`'s own header).
 *
 * A DRAFT invoice can be freely edited or deleted. Once sent (due/paid/
 * overdue) it locks — the only path forward is Revise, which requires a
 * reason and creates a new versioned row.
 *
 * No fixture module, no fabricated row — every value here is a real server
 * response or an honest loading/empty/error state.
 */
import { useState } from "react";
import { Icon } from "@/console/icons";
import { surface, text, signal, action, border } from "@/console/tokens";
import {
  InvoicesApiError,
  useCreateInvoice,
  useDeleteInvoice,
  useInvoices,
  useMspClients,
  useReviseInvoice,
  useUpdateInvoice,
  type Invoice,
  type InvoiceStatus,
} from "@/api/invoices-api";

type Tone = { strong: string; text: string; tint: string; border: string };
const GREEN: Tone = signal.ok;
const AMBER: Tone = signal.warning;
const RED: Tone = signal.critical;
const BLUE: Tone = signal.info;
const SLATE: Tone = { strong: signal.neutral.strong, text: text.muted, tint: signal.neutral.tint, border: signal.neutral.border };

function statusTone(status: InvoiceStatus): Tone {
  if (status === "paid") return GREEN;
  if (status === "due") return BLUE;
  if (status === "overdue") return RED;
  if (status === "superseded") return SLATE;
  return AMBER; // draft
}
function money(dollarString: string): string {
  const n = parseFloat(dollarString);
  return isNaN(n) ? dollarString : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2 });
}
function date(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function cardStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, ...extra };
}
function pill(t: Tone, extra?: React.CSSProperties): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999,
    background: t.tint, border: `1px solid ${t.border}`, fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: "nowrap",
    ...extra,
  };
}
function primaryBtn(disabled?: boolean, danger?: boolean): React.CSSProperties {
  const bg = danger ? "rgba(248,113,113,.14)" : action.base;
  const fg = danger ? "#fca5a5" : "#fff";
  const lineColor = danger ? signal.critical.border : action.base;
  return {
    display: "inline-flex", alignItems: "center", gap: 6, height: 29, padding: "0 11px", borderRadius: 7,
    border: `1px solid ${disabled ? border.card : lineColor}`, background: disabled ? "transparent" : bg,
    color: disabled ? text.faint : fg, fontSize: 11.5, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap",
  };
}
function ghostBtn(disabled?: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, height: 29, padding: "0 11px", borderRadius: 7,
    border: `1px solid ${border.card}`, background: "transparent",
    color: disabled ? text.faint : text.secondary, fontSize: 11.5, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
  };
}
function inputStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { height: 32, borderRadius: 7, border: `1px solid ${border.soft}`, background: "rgba(2,6,23,.4)", color: text.title, padding: "0 9px", fontSize: 12.5, ...extra };
}

function CreateInvoiceForm({ onCreate, pending, error }: { onCreate: (input: { invoiceNumber: string; description: string; amount: string; dueDate: string }) => void; pending: boolean; error: string | null }) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  return (
    <div style={cardStyle({ padding: 14, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 })}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>New draft invoice</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 9 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 10.5, color: text.faint }}>Invoice number</label>
          <input type="text" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} style={inputStyle()} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 10.5, color: text.faint }}>Amount ($)</label>
          <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle()} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 10.5, color: text.faint }}>Due date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={inputStyle()} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 10.5, color: text.faint }}>Description</label>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle()} />
      </div>
      <button
        style={primaryBtn(pending || !invoiceNumber.trim() || !amount)}
        disabled={pending || !invoiceNumber.trim() || !amount}
        onClick={() => onCreate({ invoiceNumber: invoiceNumber.trim(), description: description.trim(), amount, dueDate })}
      >
        <Icon name="file-plus" size={13} />
        {pending ? "Creating…" : "Create draft"}
      </button>
      {error && <span style={{ fontSize: 11, color: RED.text }}>{error}</span>}
    </div>
  );
}

function ReviseForm({ invoice, onRevise, pending, error, onCancel }: { invoice: Invoice; onRevise: (input: { reason: string; amount?: string; description?: string; dueDate?: string }) => void; pending: boolean; error: string | null; onCancel: () => void }) {
  const [amount, setAmount] = useState(invoice.amount);
  const [description, setDescription] = useState(invoice.description ?? "");
  const [dueDate, setDueDate] = useState(invoice.dueDate ? invoice.dueDate.slice(0, 10) : "");
  const [reason, setReason] = useState("");
  return (
    <div style={{ border: `1px solid ${AMBER.border}`, borderRadius: 10, background: AMBER.tint, padding: 13, display: "flex", flexDirection: "column", gap: 9 }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: AMBER.strong }}>Revise sent invoice {invoice.invoiceNumber}</span>
      <span style={{ fontSize: 11, color: text.secondary }}>Creates a new version (v{invoice.version + 1}), marks this one superseded, and notifies the customer with the reason below.</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8 }}>
        <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle()} placeholder="Amount ($)" />
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={inputStyle()} />
      </div>
      <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle()} placeholder="Description" />
      <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle()} placeholder="Reason for revision (required)" />
      <div style={{ display: "flex", gap: 8 }}>
        <button
          style={primaryBtn(pending || !reason.trim())}
          disabled={pending || !reason.trim()}
          onClick={() => onRevise({ reason: reason.trim(), amount, description, dueDate })}
        >
          <Icon name="history" size={13} />
          {pending ? "Revising…" : "Submit revision"}
        </button>
        <button style={ghostBtn(pending)} disabled={pending} onClick={onCancel}>Cancel</button>
      </div>
      {error && <span style={{ fontSize: 11, color: RED.text }}>{error}</span>}
    </div>
  );
}

function InvoiceRow({ invoice, mspId, clientUserId, supersededByNumber }: { invoice: Invoice; mspId: number; clientUserId: number; supersededByNumber: string | null }) {
  const update = useUpdateInvoice(mspId, clientUserId);
  const del = useDeleteInvoice(mspId, clientUserId);
  const revise = useReviseInvoice(mspId, clientUserId);
  const [revising, setRevising] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const isDraft = invoice.status === "draft";
  const isSent = invoice.status === "due" || invoice.status === "paid" || invoice.status === "overdue";

  function send() {
    setActionErr(null);
    update.mutate({ id: invoice.id, input: { status: "due" } }, { onError: (err) => setActionErr(err instanceof InvoicesApiError ? err.message : "Failed to send.") });
  }
  function markPaid() {
    setActionErr(null);
    update.mutate({ id: invoice.id, input: { status: "paid" } }, { onError: (err) => setActionErr(err instanceof InvoicesApiError ? err.message : "Failed to update.") });
  }
  function remove() {
    setActionErr(null);
    del.mutate(invoice.id, { onError: (err) => setActionErr(err instanceof InvoicesApiError ? err.message : "Failed to delete.") });
  }

  return (
    <div style={cardStyle({ padding: 13, display: "flex", flexDirection: "column", gap: 9, minWidth: 0 })}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: text.title }}>{invoice.invoiceNumber} <span style={{ color: text.faint, fontWeight: 500 }}>v{invoice.version}</span></span>
          <span style={{ fontSize: 11, color: text.muted }}>{invoice.description || "No description"} · due {date(invoice.dueDate)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: text.title }}>{money(invoice.amount)}</span>
          <span style={pill(statusTone(invoice.status))}>{invoice.status}</span>
        </div>
      </div>

      {invoice.status === "superseded" && (
        <span style={{ fontSize: 10.5, color: text.faint }}>Replaced by {supersededByNumber ?? "a newer version"}.</span>
      )}
      {invoice.revisionReason && (
        <span style={{ fontSize: 10.5, color: text.faint }}>Revision reason: {invoice.revisionReason}</span>
      )}

      {(isDraft || isSent) && !revising && (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {isDraft && (
            <>
              <button style={primaryBtn(update.isPending)} disabled={update.isPending} onClick={send}>
                <Icon name="circle-check-big" size={12} /> Send
              </button>
              <button style={ghostBtn(del.isPending)} disabled={del.isPending} onClick={remove}>
                <Icon name="trash-2" size={12} /> Delete
              </button>
            </>
          )}
          {invoice.status === "due" && (
            <button style={primaryBtn(update.isPending)} disabled={update.isPending} onClick={markPaid}>
              <Icon name="circle-check" size={12} /> Mark paid
            </button>
          )}
          {isSent && (
            <button style={ghostBtn(false)} onClick={() => setRevising(true)}>
              <Icon name="file-pen" size={12} /> Revise
            </button>
          )}
        </div>
      )}

      {revising && (
        <ReviseForm
          invoice={invoice}
          pending={revise.isPending}
          error={null}
          onCancel={() => setRevising(false)}
          onRevise={(input) => {
            setActionErr(null);
            revise.mutate(
              { id: invoice.id, input: { reason: input.reason, amount: input.amount ? parseFloat(input.amount) : undefined, description: input.description, dueDate: input.dueDate ? new Date(input.dueDate).toISOString() : null } },
              { onSuccess: () => setRevising(false), onError: (err) => setActionErr(err instanceof InvoicesApiError ? err.message : "Failed to revise.") },
            );
          }}
        />
      )}

      {actionErr && <span style={{ fontSize: 11, color: RED.text }}>{actionErr}</span>}
    </div>
  );
}

export function Invoices({ mspId }: { mspId: number }) {
  const clients = useMspClients(mspId);
  const [clientUserId, setClientUserId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const invoices = useInvoices(mspId, clientUserId);
  const create = useCreateInvoice(mspId, clientUserId);
  const [createErr, setCreateErr] = useState<string | null>(null);

  if (clients.isLoading) {
    return <span style={{ fontSize: 11.5, color: text.muted }}>Loading this MSP&apos;s client accounts…</span>;
  }
  if (clients.isError || !clients.data) {
    return <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load client accounts.</span>;
  }

  const selectedClient = clients.data.find((c) => c.id === clientUserId) ?? null;
  const rows = invoices.data ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={cardStyle({ padding: 14, display: "flex", flexDirection: "column", gap: 8 })}>
        <span style={{ fontSize: 12, fontWeight: 700, color: text.title }}>Invoices</span>
        <span style={{ fontSize: 11.5, color: text.muted, lineHeight: 1.55 }}>
          Billed to this MSP&apos;s client-portal accounts — a separate list from the tenant tree on the left,
          since invoicing has no link to a tenant record in the schema. Pick an account below.
        </span>
        <select
          value={clientUserId ?? ""}
          onChange={(e) => { setClientUserId(e.target.value ? Number(e.target.value) : null); setShowCreate(false); }}
          style={inputStyle({ width: "100%", maxWidth: 360 })}
        >
          <option value="">Select a client account…</option>
          {clients.data.map((c) => (
            <option key={c.id} value={c.id}>{c.name || c.email}{c.company ? ` — ${c.company}` : ""}</option>
          ))}
        </select>
        {clients.data.length === 0 && (
          <span style={{ fontSize: 11.5, color: text.muted }}>This MSP has no client-portal accounts yet.</span>
        )}
      </div>

      {selectedClient && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: text.secondary }}>
              {rows.length} invoice{rows.length === 1 ? "" : "s"} for {selectedClient.name || selectedClient.email}
            </span>
            <button style={primaryBtn(false)} onClick={() => setShowCreate((v) => !v)}>
              <Icon name="plus" size={13} /> {showCreate ? "Close" : "New invoice"}
            </button>
          </div>

          {showCreate && (
            <CreateInvoiceForm
              pending={create.isPending}
              error={createErr}
              onCreate={(input) => {
                setCreateErr(null);
                if (!input.invoiceNumber || !input.amount) return;
                create.mutate(
                  {
                    clientUserId: selectedClient.id,
                    invoiceNumber: input.invoiceNumber,
                    description: input.description || null,
                    amount: parseFloat(input.amount),
                    dueDate: input.dueDate ? new Date(input.dueDate).toISOString() : null,
                  },
                  { onSuccess: () => setShowCreate(false), onError: (err) => setCreateErr(err instanceof InvoicesApiError ? err.message : "Failed to create invoice.") },
                );
              }}
            />
          )}

          {invoices.isLoading ? (
            <span style={{ fontSize: 11.5, color: text.muted }}>Loading invoices…</span>
          ) : invoices.isError ? (
            <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load invoices for this client.</span>
          ) : rows.length === 0 ? (
            <div style={cardStyle({ padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" })}>
              <Icon name="receipt" size={20} color={text.muted} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>No invoices for this client yet</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {rows.map((inv) => {
                const supersededBy = rows.find((r) => r.supersedesInvoiceId === inv.id);
                return (
                  <InvoiceRow key={inv.id} invoice={inv} mspId={mspId} clientUserId={selectedClient.id} supersededByNumber={supersededBy ? `${supersededBy.invoiceNumber} v${supersededBy.version}` : null} />
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
