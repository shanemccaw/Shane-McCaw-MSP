import { useState } from "react";

/**
 * Real, pre-filled edit form for an outbound webhook (#3546).
 *
 * Replaces the inert "Editing is wired, this prototype is not" confirm
 * dialog that previously sat behind the "Edit label, URL and events" button
 * in `pages/webhooks.tsx`. The PATCH route this calls
 * (`PATCH /api/portal/webhooks/:webhookId`,
 * `artifacts/api-server/src/routes/webhooks.ts:274-338`) was already real and
 * unchanged — label/url/eventTypes/isActive are all optional and independently
 * patchable. This dialog is the surface that was missing, not new backend.
 *
 * Owner, secret and delivery history are still not editable by any code
 * path — this form does not attempt them, matching the ledger note the old
 * stub carried.
 */

export interface EditableWebhook {
  webhookId: string;
  label: string;
  url: string;
  eventTypes: string[];
  isActive: boolean;
}

interface EditWebhookDialogProps {
  webhook: EditableWebhook;
  eventCatalog: string[] | null;
  deadEvent: string;
  fetchWithAuth: (input: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onSaved: (patch: { label: string; url: string; eventTypes: string[]; isActive: boolean; updatedAt: string }) => void;
}

const ACCENT = "#0078D4";
const CAUTION = "#c2a63d";

export function EditWebhookDialog({ webhook, eventCatalog, deadEvent, fetchWithAuth, onClose, onSaved }: EditWebhookDialogProps) {
  const [label, setLabel] = useState(webhook.label);
  const [url, setUrl] = useState(webhook.url);
  const [eventTypes, setEventTypes] = useState<string[]>(webhook.eventTypes);
  const [isActive, setIsActive] = useState(webhook.isActive);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedLabel = label.trim();
  const urlOk = /^https?:\/\/.+/.test(url.trim());
  const labelOk = trimmedLabel.length > 0 && trimmedLabel.length <= 120;
  const dirty =
    trimmedLabel !== webhook.label ||
    url.trim() !== webhook.url ||
    isActive !== webhook.isActive ||
    eventTypes.length !== webhook.eventTypes.length ||
    eventTypes.some((t) => !webhook.eventTypes.includes(t));
  const canSubmit = labelOk && urlOk && dirty && !saving;

  const toggleEvent = (t: string) => {
    setEventTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : prev.concat([t])));
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {};
    if (trimmedLabel !== webhook.label) body["label"] = trimmedLabel;
    if (url.trim() !== webhook.url) body["url"] = url.trim();
    if (isActive !== webhook.isActive) body["isActive"] = isActive;
    if (eventTypes.length !== webhook.eventTypes.length || eventTypes.some((t) => !webhook.eventTypes.includes(t))) {
      body["eventTypes"] = eventTypes;
    }
    try {
      const res = await fetchWithAuth(`/api/portal/webhooks/${webhook.webhookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`update failed (${res.status})`);
      const data = (await res.json()) as {
        webhook: { label: string; url: string; eventTypes: string[]; isActive: boolean; updatedAt: string };
      };
      onSaved({
        label: data.webhook.label,
        url: data.webhook.url,
        eventTypes: data.webhook.eventTypes,
        isActive: data.webhook.isActive,
        updatedAt: data.webhook.updatedAt,
      });
    } catch {
      setError("Could not save these changes. Nothing was updated — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ background: "rgba(2,6,23,.72)" }}
      data-testid="webhook-edit-modal"
    >
      <div
        className="flex w-[560px] max-w-full flex-col gap-3.5 rounded-2xl border p-6"
        style={{ background: "#0b1120", borderColor: "rgba(255,255,255,.12)", boxShadow: "0 24px 64px rgba(0,0,0,.6)" }}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[14.5px] font-bold text-foreground">Edit {webhook.label}</span>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="ml-auto text-[11.5px]"
            style={{ color: "#64748b" }}
            data-testid="webhook-edit-cancel"
          >
            Cancel
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold" style={{ color: "#94a3b8" }}>Label</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="rounded-md border bg-transparent px-2.5 py-2 text-[12.5px] text-foreground outline-none"
            style={{ borderColor: "rgba(255,255,255,.12)", background: "rgba(255,255,255,.04)" }}
            data-testid="webhook-edit-label"
          />
          <span className="text-[10.5px]" style={{ color: labelOk ? "#475569" : "#f87171" }}>
            {labelOk ? "1–120 characters." : "Required, 1–120 characters."}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold" style={{ color: "#94a3b8" }}>Destination URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="rounded-md border bg-transparent px-2.5 py-2 font-mono text-[12.5px] text-foreground outline-none"
            style={{ borderColor: "rgba(255,255,255,.12)", background: "rgba(255,255,255,.04)" }}
            data-testid="webhook-edit-url"
          />
          <span className="text-[10.5px]" style={{ color: urlOk ? "#34d399" : "#f87171" }}>
            {urlOk ? "Accepted." : "Rejected — the URL must start with http:// or https://."}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] font-semibold" style={{ color: "#94a3b8" }}>Events</span>
            <span className="text-[10.5px]" style={{ color: "#64748b" }}>
              {eventTypes.length === 0 ? "None picked — this endpoint will receive nothing" : `${eventTypes.length} picked`}
            </span>
          </div>
          <div className="flex max-h-[180px] flex-wrap gap-1.5 overflow-y-auto">
            {(eventCatalog ?? webhook.eventTypes).map((t) => {
              const on = eventTypes.includes(t);
              const dead = t === deadEvent;
              return (
                <span
                  key={t}
                  onClick={() => toggleEvent(t)}
                  className="cursor-pointer rounded-full border px-2.5 py-1 font-mono text-[10.5px]"
                  style={{
                    color: on ? "#f8fafc" : dead ? CAUTION : "#94a3b8",
                    background: on ? "rgba(0,120,212,.22)" : "transparent",
                    borderColor: on ? "rgba(0,120,212,.55)" : dead ? "rgba(194,166,61,.35)" : "rgba(255,255,255,.10)",
                  }}
                  data-testid={`webhook-edit-event-${t}`}
                >
                  {t}
                </span>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold" style={{ color: "#94a3b8" }}>Delivering</span>
          <div
            onClick={() => setIsActive((v) => !v)}
            className="flex h-[21px] w-[38px] cursor-pointer items-center rounded-full border p-[2px]"
            style={{
              background: isActive ? ACCENT : "rgba(255,255,255,.07)",
              borderColor: isActive ? ACCENT : "rgba(255,255,255,.14)",
              justifyContent: isActive ? "flex-end" : "flex-start",
            }}
            data-testid="webhook-edit-active-toggle"
          >
            <span className="size-[15px] flex-none rounded-full" style={{ background: isActive ? "#fff" : "#64748b" }} />
          </div>
          <span className="text-[10.5px]" style={{ color: "#64748b" }}>
            {isActive ? "Events are sent" : "Nothing is sent"}
          </span>
        </div>

        <span className="text-[11.5px] leading-relaxed" style={{ color: CAUTION }}>
          Owner, secret and delivery history are not editable by any code path.
        </span>

        <div className="flex items-center gap-2.5 border-t pt-3.5" style={{ borderColor: "rgba(255,255,255,.08)" }}>
          <span className="max-w-[300px] text-[10.5px]" style={{ color: error ? "#f87171" : "#475569" }}>
            {error ?? "Only the fields you change are sent."}
          </span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="ml-auto flex-none rounded-md px-4 py-2 text-xs font-semibold"
            style={{
              color: canSubmit ? "#fff" : "#475569",
              background: canSubmit ? ACCENT : "rgba(255,255,255,.06)",
              cursor: canSubmit ? "pointer" : "default",
            }}
            data-testid="webhook-edit-save"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
