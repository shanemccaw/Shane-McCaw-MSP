// Shared Zoho CRM entity page (#83) — list, search, detail, create, edit.
//
// One component drives Leads / Deals / Contacts / Accounts because the four
// pages differ only in their field sets and their extra actions; the read/write
// mechanics are identical. Entity-specific behaviour arrives as config, not as
// four near-copies that drift.
//
// The single most important UI rule here: a write NEVER renders as done. Every
// mutation goes through useQueuedWrite and shows "Queued → Syncing → Synced",
// because the API answers 202 and the real Zoho write happens on the next
// 5-minute drain.

import { useEffect, useState, type ReactNode } from "react";
import { useZohoList, useZohoRecord, useQueuedWrite, type ZohoEntity, type ZohoRecord } from "./useZohoCrm";

export interface ZohoFieldDef {
  /** Zoho API field name, e.g. "Last_Name". */
  name: string;
  label: string;
  /** Shown in the list table. */
  inList?: boolean;
  /** Editable on the create/edit form. */
  editable?: boolean;
  required?: boolean;
  type?: "text" | "email" | "number" | "textarea";
}

export interface ZohoEntityConfig {
  entity: ZohoEntity;
  title: string;
  singular: string;
  description: string;
  fields: ZohoFieldDef[];
  /** Extra buttons on the detail panel (convert, stage, amount…). */
  extraActions?: (ctx: ExtraActionContext) => ReactNode;
  /** Whether this entity supports notes (Leads and Deals do). */
  supportsNotes?: boolean;
}

export interface ExtraActionContext {
  record: ZohoRecord;
  /** Runs a queued write and refreshes the detail panel. */
  runWrite: (path: string, method: string, body?: unknown) => Promise<boolean>;
  busy: boolean;
}

/** Zoho returns lookups as { id, name } objects — render the name, not "[object Object]". */
function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.name === "string") return obj.name;
    return JSON.stringify(value);
  }
  return String(value);
}

function SyncBanner({ state, message }: { state: string; message: string | null }) {
  if (state === "idle") return null;

  const tone =
    state === "failed" ? "bg-red-500/10 border-red-500/30 text-red-400"
    : state === "synced" ? "bg-green-500/10 border-green-500/30 text-green-400"
    : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400";

  const label =
    state === "queued" ? "Queued for Zoho"
    : state === "syncing" ? "Syncing to Zoho…"
    : state === "synced" ? "Synced to Zoho"
    : "Sync failed";

  return (
    <div className={`border rounded-lg px-4 py-3 text-sm ${tone}`} role="status">
      <p className="font-semibold">{label}</p>
      {message && <p className="mt-1 opacity-90">{message}</p>}
    </div>
  );
}

function RecordForm({
  config,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  busy,
}: {
  config: ZohoEntityConfig;
  initial: ZohoRecord | null;
  submitLabel: string;
  onSubmit: (fields: Record<string, unknown>) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const editable = config.fields.filter((f) => f.editable !== false);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of editable) {
      const raw = initial?.[f.name];
      seed[f.name] = raw === null || raw === undefined ? "" : typeof raw === "object" ? displayValue(raw) : String(raw);
    }
    return seed;
  });

  const missingRequired = editable.filter((f) => f.required && !values[f.name]?.trim());

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (missingRequired.length > 0) return;
        // Only send fields the operator actually filled in. Sending "" would
        // clear the value in Zoho, which is not what leaving a box empty means.
        const fields: Record<string, unknown> = {};
        for (const f of editable) {
          const v = values[f.name]?.trim();
          if (!v) continue;
          fields[f.name] = f.type === "number" ? Number(v) : v;
        }
        onSubmit(fields);
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {editable.map((f) => (
          <label key={f.name} className={f.type === "textarea" ? "md:col-span-2 block" : "block"}>
            <span className="text-xs font-medium text-muted-foreground">
              {f.label}{f.required && <span className="text-red-400"> *</span>}
            </span>
            {f.type === "textarea" ? (
              <textarea
                className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                rows={3}
                value={values[f.name] ?? ""}
                onChange={(e) => setValues((p) => ({ ...p, [f.name]: e.target.value }))}
              />
            ) : (
              <input
                type={f.type === "number" ? "number" : f.type === "email" ? "email" : "text"}
                className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                value={values[f.name] ?? ""}
                onChange={(e) => setValues((p) => ({ ...p, [f.name]: e.target.value }))}
              />
            )}
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || missingRequired.length > 0}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
        >
          {busy ? "Queueing…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground">
          Cancel
        </button>
        {missingRequired.length > 0 && (
          <span className="text-xs text-muted-foreground">
            Required: {missingRequired.map((f) => f.label).join(", ")}
          </span>
        )}
      </div>
    </form>
  );
}

export default function ZohoEntityPage({ config }: { config: ZohoEntityConfig }) {
  const list = useZohoList(config.entity);
  const detail = useZohoRecord(config.entity);
  const write = useQueuedWrite();

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "create" | "edit">("none");
  const [noteText, setNoteText] = useState("");

  useEffect(() => { void list.load(1, ""); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [config.entity]);

  const listFields = config.fields.filter((f) => f.inList !== false).slice(0, 5);

  const openDetail = (id: string) => {
    setSelectedId(id);
    setMode("none");
    write.reset();
    void detail.load(id);
  };

  const runWrite = async (path: string, method: string, body?: unknown): Promise<boolean> => {
    const ok = await write.submit(path, { method, body });
    if (ok) setMode("none");
    return ok;
  };

  const busy = write.state === "queued" || write.state === "syncing";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground">{config.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{config.description}</p>
        </div>
        <button
          onClick={() => { setMode("create"); setSelectedId(null); detail.clear(); write.reset(); }}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
        >
          New {config.singular}
        </button>
      </div>

      <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        Lists read live from Zoho. Changes you make here are <strong className="text-foreground">queued</strong> and
        applied by the Zoho sync, which runs every 5 minutes — they will not appear in the list immediately.
      </div>

      <SyncBanner state={write.state} message={write.message} />

      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); void list.load(1, search); }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${config.title.toLowerCase()} in Zoho…`}
          className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
        />
        <button type="submit" className="px-4 py-2 rounded-lg border border-border text-sm text-foreground">Search</button>
        {search && (
          <button
            type="button"
            onClick={() => { setSearch(""); void list.load(1, ""); }}
            className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground"
          >
            Clear
          </button>
        )}
      </form>

      {mode === "create" && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h2 className="text-lg font-bold text-foreground">New {config.singular}</h2>
          <RecordForm
            config={config}
            initial={null}
            submitLabel={`Queue new ${config.singular}`}
            busy={busy}
            onCancel={() => setMode("none")}
            onSubmit={(fields) => { void runWrite(`/api/zoho/crm/${config.entity}`, "POST", { fields }); }}
          />
        </div>
      )}

      {list.error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">{list.error}</div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-background/50">
              <tr>
                {listFields.map((f) => (
                  <th key={f.name} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr><td colSpan={listFields.length} className="px-4 py-8 text-center text-muted-foreground">Loading from Zoho…</td></tr>
              )}
              {!list.loading && list.records.length === 0 && !list.error && (
                <tr><td colSpan={listFields.length} className="px-4 py-8 text-center text-muted-foreground">
                  No {config.title.toLowerCase()} found in Zoho.
                </td></tr>
              )}
              {!list.loading && list.records.map((rec) => (
                <tr
                  key={String(rec.id)}
                  onClick={() => openDetail(String(rec.id))}
                  className={`border-t border-border cursor-pointer hover:bg-background/40 ${selectedId === String(rec.id) ? "bg-background/60" : ""}`}
                >
                  {listFields.map((f) => (
                    <td key={f.name} className="px-4 py-3 text-foreground">{displayValue(rec[f.name])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <span className="text-xs text-muted-foreground">Page {list.page}</span>
          <div className="flex gap-2">
            <button
              disabled={list.page <= 1 || list.loading}
              onClick={() => void list.load(list.page - 1, search)}
              className="px-3 py-1.5 rounded-lg border border-border text-xs text-foreground disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={!list.more || list.loading}
              onClick={() => void list.load(list.page + 1, search)}
              className="px-3 py-1.5 rounded-lg border border-border text-xs text-foreground disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {selectedId && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-bold text-foreground">{config.singular} detail</h2>
            <button
              onClick={() => { setSelectedId(null); detail.clear(); setMode("none"); }}
              className="text-sm text-muted-foreground"
            >
              Close
            </button>
          </div>

          {detail.loading && <p className="text-sm text-muted-foreground">Loading from Zoho…</p>}
          {detail.error && <p className="text-sm text-red-400">{detail.error}</p>}

          {detail.record && mode !== "edit" && (
            <>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                {config.fields.map((f) => (
                  <div key={f.name}>
                    <dt className="text-xs text-muted-foreground">{f.label}</dt>
                    <dd className="text-sm text-foreground">{displayValue(detail.record?.[f.name])}</dd>
                  </div>
                ))}
              </dl>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => setMode("edit")}
                  className="px-4 py-2 rounded-lg border border-border text-sm text-foreground"
                >
                  Edit
                </button>
                {config.extraActions?.({ record: detail.record, runWrite, busy })}
              </div>

              {config.supportsNotes && (
                <div className="border-t border-border pt-4 space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Add a note</h3>
                  <textarea
                    rows={3}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                    placeholder="Note content…"
                  />
                  <button
                    disabled={busy || !noteText.trim()}
                    onClick={() => {
                      void runWrite(`/api/zoho/crm/${config.entity}/${encodeURIComponent(selectedId)}/notes`, "POST", { content: noteText.trim() })
                        .then((ok) => { if (ok) setNoteText(""); });
                    }}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
                  >
                    Queue note
                  </button>
                </div>
              )}
            </>
          )}

          {detail.record && mode === "edit" && (
            <RecordForm
              config={config}
              initial={detail.record}
              submitLabel="Queue changes"
              busy={busy}
              onCancel={() => setMode("none")}
              onSubmit={(fields) => {
                void runWrite(`/api/zoho/crm/${config.entity}/${encodeURIComponent(selectedId)}`, "PATCH", { fields });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
