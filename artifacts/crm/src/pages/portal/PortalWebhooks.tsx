import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";
import { useToast } from "@/hooks/use-toast";

interface Webhook {
  webhookId: string;
  label: string;
  url: string;
  secretPrefix: string;
  eventTypes: string[];
  isActive: boolean;
  ownerType: string;
  createdAt: string;
  updatedAt: string;
}

interface Delivery {
  deliveryId: string;
  eventType: string;
  attempt: number;
  status: "pending" | "success" | "failed" | "retrying";
  statusCode: number | null;
  responseSnippet: string | null;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

const EVENT_TYPE_GROUPS: { label: string; types: string[] }[] = [
  {
    label: "Services & Projects",
    types: ["service.activated", "service.deactivated", "project.created", "project.completed"],
  },
  {
    label: "Signals & Monitoring",
    types: ["signal.fired", "monitoring.run.completed"],
  },
  {
    label: "Offers & Fulfillment",
    types: ["offer.accepted", "offer.rejected", "fulfillment.item.created", "fulfillment.item.updated"],
  },
  {
    label: "Documents & Billing",
    types: ["document.created", "document.status.changed", "invoice.created", "invoice.paid", "contract.signed"],
  },
];

type AlertState = { type: "success" | "error"; message: string } | null;

function AlertBox({ alert }: { alert: AlertState }) {
  if (!alert) return null;
  return (
    <div
      className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm border mb-4 ${
        alert.type === "success"
          ? "bg-green-50 border-green-200 text-green-800"
          : "bg-red-50 border-red-200 text-red-700"
      }`}
    >
      <span>{alert.message}</span>
    </div>
  );
}

function StatusDot({ status }: { status: Delivery["status"] }) {
  const colors = {
    success: "bg-green-500",
    failed: "bg-red-500",
    retrying: "bg-amber-400",
    pending: "bg-gray-400",
  };
  return <span className={`inline-block size-2 rounded-full ${colors[status]}`} />;
}

function DeliveryCard({ d }: { d: Delivery }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden text-sm">
      <button
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors text-left"
        onClick={() => setOpen(!open)}
      >
        <StatusDot status={d.status} />
        <span className="font-mono text-xs flex-1 truncate">{d.eventType}</span>
        <span
          className={`text-xs font-medium ${
            d.status === "success"
              ? "text-green-700"
              : d.status === "failed"
              ? "text-red-700"
              : d.status === "retrying"
              ? "text-amber-700"
              : "text-gray-500"
          }`}
        >
          {d.statusCode ? `${d.status} ${d.statusCode}` : d.status}
        </span>
        <span className="text-xs text-gray-400 shrink-0 ml-2">
          #{d.attempt} · {new Date(d.createdAt).toLocaleString()}
        </span>
      </button>
      {open && (d.responseSnippet || d.deliveredAt || d.nextRetryAt) && (
        <div className="border-t bg-gray-50 px-4 py-3 text-xs text-gray-600 font-mono space-y-1">
          {d.deliveredAt && (
            <div>Delivered: {new Date(d.deliveredAt).toLocaleString()}</div>
          )}
          {d.nextRetryAt && (
            <div>Next retry: {new Date(d.nextRetryAt).toLocaleString()}</div>
          )}
          {d.responseSnippet && (
            <pre className="whitespace-pre-wrap break-all bg-white rounded border p-2 mt-1">
              {d.responseSnippet}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function PortalWebhooks() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<AlertState>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [formLabel, setFormLabel] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formTypes, setFormTypes] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  // Delivery log
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deliveriesMap, setDeliveriesMap] = useState<Record<string, Delivery[]>>({});
  const [deliveriesLoading, setDeliveriesLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/portal/webhooks");
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as { webhooks: Webhook[] };
      setWebhooks(data.webhooks);
    } catch {
      setAlert({ type: "error", message: "Could not load webhooks." });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!formLabel.trim() || !formUrl.trim()) {
      setAlert({ type: "error", message: "Label and URL are required." });
      return;
    }
    setCreating(true);
    setAlert(null);
    try {
      const res = await fetchWithAuth("/api/portal/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: formLabel.trim(), url: formUrl.trim(), eventTypes: formTypes }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Failed");
      }
      const data = (await res.json()) as { webhook: Webhook & { secret: string } };
      setNewSecret(data.webhook.secret);
      setFormLabel("");
      setFormUrl("");
      setFormTypes([]);
      setShowCreate(false);
      await load();
    } catch (err: unknown) {
      setAlert({ type: "error", message: err instanceof Error ? err.message : "Failed to create." });
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (wh: Webhook) => {
    try {
      const res = await fetchWithAuth(`/api/portal/webhooks/${wh.webhookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !wh.isActive }),
      });
      if (!res.ok) throw new Error("Failed");
      await load();
    } catch {
      setAlert({ type: "error", message: "Could not update webhook." });
    }
  };

  const deleteWebhook = async (webhookId: string) => {
    if (!window.confirm("Delete this webhook and all its delivery history?")) return;
    try {
      await fetchWithAuth(`/api/portal/webhooks/${webhookId}`, { method: "DELETE" });
      setAlert({ type: "success", message: "Webhook deleted." });
      await load();
    } catch {
      setAlert({ type: "error", message: "Could not delete webhook." });
    }
  };

  const rotateSecret = async (webhookId: string) => {
    if (!window.confirm("Rotate the secret? The old secret will stop working immediately.")) return;
    try {
      const res = await fetchWithAuth(`/api/portal/webhooks/${webhookId}/rotate-secret`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as { secret: string };
      setNewSecret(data.secret);
    } catch {
      setAlert({ type: "error", message: "Could not rotate secret." });
    }
  };

  const loadDeliveries = async (webhookId: string) => {
    if (expanded === webhookId) {
      setExpanded(null);
      return;
    }
    setExpanded(webhookId);
    if (deliveriesMap[webhookId]) return;
    setDeliveriesLoading(webhookId);
    try {
      const res = await fetchWithAuth(`/api/portal/webhooks/${webhookId}/deliveries`);
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as { deliveries: Delivery[] };
      setDeliveriesMap((prev) => ({ ...prev, [webhookId]: data.deliveries }));
    } catch {
      toast({ title: "Error", description: "Could not load deliveries", variant: "destructive" });
    } finally {
      setDeliveriesLoading(null);
    }
  };

  const toggleType = (t: string) =>
    setFormTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  return (
    <PortalLayout>
      <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Outbound Webhooks</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Receive signed event notifications in your own systems (PSA, RMM, etc).
            </p>
          </div>
          <button
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            onClick={() => setShowCreate(true)}
          >
            <span className="text-lg leading-none">+</span>
            New Webhook
          </button>
        </div>

        <AlertBox alert={alert} />

        {/* New secret reveal */}
        {newSecret && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-amber-900">
              Copy your signing secret — it won't be shown again
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={newSecret}
                className="flex-1 font-mono text-xs bg-white border border-amber-200 rounded-lg px-3 py-2"
              />
              <button
                className="bg-amber-700 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-amber-800 transition-colors"
                onClick={() => {
                  void navigator.clipboard.writeText(newSecret);
                  toast({ title: "Copied!" });
                }}
              >
                Copy
              </button>
            </div>
            <p className="text-xs text-amber-700">
              Verify incoming webhooks by computing{" "}
              <code className="bg-amber-100 rounded px-1">HMAC-SHA256(secret, body)</code>{" "}
              and comparing with the{" "}
              <code className="bg-amber-100 rounded px-1">X-Webhook-Signature</code> header.
            </p>
            <button
              className="text-xs text-amber-700 underline"
              onClick={() => setNewSecret(null)}
            >
              I've saved the secret, close this
            </button>
          </div>
        )}

        {/* Webhooks list */}
        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : webhooks.length === 0 && !showCreate ? (
          <div className="border border-dashed border-gray-200 rounded-xl py-12 text-center text-gray-400">
            <p className="text-lg mb-1">No webhooks yet</p>
            <p className="text-sm">
              Add a webhook to receive platform events in your own system.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {webhooks.map((wh) => (
              <div key={wh.webhookId} className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex items-start justify-between gap-4 px-4 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{wh.label}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          wh.isActive
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {wh.isActive ? "Active" : "Disabled"}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-gray-500 mt-1 truncate">{wh.url}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Secret: <span className="font-mono">{wh.secretPrefix}…</span>
                    </p>
                    {(wh.eventTypes as string[]).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {(wh.eventTypes as string[]).map((t) => (
                          <span
                            key={t}
                            className="text-xs font-mono bg-gray-100 text-gray-600 rounded px-1.5 py-0.5"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {(wh.eventTypes as string[]).length === 0 && (
                      <p className="text-xs text-gray-400 mt-1 italic">All events</p>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                    <button
                      className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors"
                      onClick={() => void toggleActive(wh)}
                    >
                      {wh.isActive ? "Disable" : "Enable"}
                    </button>
                    <button
                      className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors"
                      onClick={() => void rotateSecret(wh.webhookId)}
                    >
                      Rotate secret
                    </button>
                    <button
                      className="text-xs border border-red-200 text-red-600 rounded-lg px-2.5 py-1.5 hover:bg-red-50 transition-colors"
                      onClick={() => void deleteWebhook(wh.webhookId)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="border-t border-gray-100 px-4 py-2.5 bg-gray-50">
                  <button
                    className="text-xs text-gray-500 hover:text-gray-800 transition-colors flex items-center gap-1"
                    onClick={() => void loadDeliveries(wh.webhookId)}
                  >
                    {expanded === wh.webhookId ? "▾" : "▸"}{" "}
                    {deliveriesLoading === wh.webhookId
                      ? "Loading…"
                      : "Delivery log"}
                  </button>
                  {expanded === wh.webhookId && (
                    <div className="mt-2 space-y-2">
                      {(deliveriesMap[wh.webhookId] ?? []).length === 0 ? (
                        <p className="text-xs text-gray-400 italic">No deliveries yet</p>
                      ) : (
                        (deliveriesMap[wh.webhookId] ?? []).map((d) => (
                          <DeliveryCard key={d.deliveryId} d={d} />
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create form */}
        {showCreate && (
          <div className="border border-gray-200 rounded-xl p-5 space-y-4 bg-white">
            <h2 className="font-semibold text-sm">New Webhook</h2>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Label</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="e.g. ConnectWise Alerts"
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Endpoint URL</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                placeholder="https://your-system.example.com/webhook"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Event subscriptions</label>
              <p className="text-xs text-gray-400">Leave empty to receive all events.</p>
              <div className="border border-gray-200 rounded-lg p-3 max-h-52 overflow-y-auto space-y-3">
                {EVENT_TYPE_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="text-xs font-semibold text-gray-500 mb-1">{group.label}</p>
                    {group.types.map((t) => (
                      <label
                        key={t}
                        className="flex items-center gap-2 text-xs py-0.5 cursor-pointer hover:bg-gray-50 rounded px-1"
                      >
                        <input
                          type="checkbox"
                          checked={formTypes.includes(t)}
                          onChange={() => toggleType(t)}
                          className="rounded"
                        />
                        <span className="font-mono">{t}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                className="text-sm border border-gray-200 rounded-lg px-4 py-2 hover:bg-gray-50 transition-colors"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button
                className="text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2 hover:bg-primary/90 transition-colors disabled:opacity-50"
                disabled={creating}
                onClick={() => void create()}
              >
                {creating ? "Creating…" : "Create Webhook"}
              </button>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
