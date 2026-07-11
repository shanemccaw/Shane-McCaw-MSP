import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Webhook,
  Plus,
  Trash2,
  RotateCcw,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Webhook {
  webhookId: string;
  label: string;
  url: string;
  secretPrefix: string;
  eventTypes: string[];
  isActive: boolean;
  ownerType: string;
  mspId: number | null;
  customerId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Delivery {
  deliveryId: string;
  webhookId: string;
  eventId: string | null;
  eventType: string;
  attempt: number;
  status: "pending" | "success" | "failed" | "retrying";
  statusCode: number | null;
  responseSnippet: string | null;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

const ALL_EVENT_TYPES = [
  "signal.fired",
  "fulfillment.item.created",
  "fulfillment.item.updated",
  "offer.accepted",
  "offer.rejected",
  "monitoring.run.completed",
  "service.activated",
  "service.deactivated",
  "project.created",
  "project.completed",
  "customer.created",
  "customer.updated",
  "customer.status.changed",
  "document.created",
  "document.status.changed",
  "auth.login",
  "user.invited",
  "user.activated",
  "msp.created",
  "msp.updated",
];

function StatusIcon({ status }: { status: Delivery["status"] }) {
  if (status === "success")
    return <CheckCircle2 className="size-4 text-green-500" />;
  if (status === "failed") return <XCircle className="size-4 text-red-500" />;
  if (status === "retrying")
    return <RefreshCw className="size-4 text-amber-500 animate-spin" />;
  return <Clock className="size-4 text-muted-foreground" />;
}

function DeliveryRow({ d }: { d: Delivery }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50 transition-colors text-left"
        onClick={() => setOpen(!open)}
      >
        <StatusIcon status={d.status} />
        <span className="font-mono text-xs truncate flex-1">{d.eventType}</span>
        <Badge
          variant="outline"
          className={
            d.status === "success"
              ? "text-green-600 border-green-300"
              : d.status === "failed"
              ? "text-red-600 border-red-300"
              : d.status === "retrying"
              ? "text-amber-600 border-amber-300"
              : "text-muted-foreground"
          }
        >
          {d.statusCode ? `${d.status} (${d.statusCode})` : d.status}
        </Badge>
        <span className="text-xs text-muted-foreground shrink-0">
          Attempt {d.attempt}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">
          {new Date(d.createdAt).toLocaleString()}
        </span>
        {open ? (
          <ChevronDown className="size-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-3 border-t bg-muted/30 space-y-2 text-xs text-muted-foreground font-mono">
          {d.eventId && (
            <div>
              <span className="font-semibold text-foreground">Event ID:</span>{" "}
              {d.eventId}
            </div>
          )}
          {d.deliveredAt && (
            <div>
              <span className="font-semibold text-foreground">Delivered:</span>{" "}
              {new Date(d.deliveredAt).toLocaleString()}
            </div>
          )}
          {d.nextRetryAt && (
            <div>
              <span className="font-semibold text-foreground">Next retry:</span>{" "}
              {new Date(d.nextRetryAt).toLocaleString()}
            </div>
          )}
          {d.responseSnippet && (
            <div>
              <div className="font-semibold text-foreground mb-1">
                Response:
              </div>
              <pre className="whitespace-pre-wrap break-all bg-background rounded p-2 border">
                {d.responseSnippet}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WebhooksPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [loadingDeliveries, setLoadingDeliveries] = useState<string | null>(
    null
  );
  const [rotateTarget, setRotateTarget] = useState<string | null>(null);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);

  // Form state
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [editTarget, setEditTarget] = useState<Webhook | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/portal/webhooks");
      if (!res.ok) throw new Error("Failed to load webhooks");
      const data = (await res.json()) as { webhooks: Webhook[] };
      setWebhooks(data.webhooks);
    } catch {
      toast({ title: "Error", description: "Could not load webhooks", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    if (!label.trim() || !url.trim()) {
      toast({ title: "Validation", description: "Label and URL are required", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const res = await fetchWithAuth("/api/portal/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), url: url.trim(), eventTypes: selectedTypes }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Failed");
      }
      const data = (await res.json()) as { webhook: Webhook & { secret: string } };
      setNewSecret(data.webhook.secret);
      setSecretVisible(true);
      await load();
      setLabel("");
      setUrl("");
      setSelectedTypes([]);
      setShowCreate(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create webhook";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    try {
      const res = await fetchWithAuth(`/api/portal/webhooks/${editTarget.webhookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          url: url.trim(),
          eventTypes: selectedTypes,
          isActive: editTarget.isActive,
        }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast({ title: "Saved", description: "Webhook updated" });
      await load();
      setEditTarget(null);
    } catch {
      toast({ title: "Error", description: "Could not update webhook", variant: "destructive" });
    }
  };

  const handleToggle = async (wh: Webhook) => {
    try {
      const res = await fetchWithAuth(`/api/portal/webhooks/${wh.webhookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !wh.isActive }),
      });
      if (!res.ok) throw new Error("Failed");
      await load();
    } catch {
      toast({ title: "Error", description: "Could not toggle webhook", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await fetchWithAuth(`/api/portal/webhooks/${deleteTarget}`, { method: "DELETE" });
      await load();
      setDeleteTarget(null);
      toast({ title: "Deleted", description: "Webhook removed" });
    } catch {
      toast({ title: "Error", description: "Could not delete webhook", variant: "destructive" });
    }
  };

  const handleRotate = async (webhookId: string) => {
    setRotateTarget(webhookId);
    try {
      const res = await fetchWithAuth(`/api/portal/webhooks/${webhookId}/rotate-secret`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as { secret: string };
      setRotatedSecret(data.secret);
      setSecretVisible(true);
      toast({ title: "Secret rotated", description: "Copy and store the new secret — it won't be shown again" });
    } catch {
      toast({ title: "Error", description: "Could not rotate secret", variant: "destructive" });
    } finally {
      setRotateTarget(null);
    }
  };

  const loadDeliveries = async (webhookId: string) => {
    if (expandedId === webhookId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(webhookId);
    if (deliveries[webhookId]) return;
    setLoadingDeliveries(webhookId);
    try {
      const res = await fetchWithAuth(`/api/portal/webhooks/${webhookId}/deliveries`);
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as { deliveries: Delivery[] };
      setDeliveries((prev) => ({ ...prev, [webhookId]: data.deliveries }));
    } catch {
      toast({ title: "Error", description: "Could not load deliveries", variant: "destructive" });
    } finally {
      setLoadingDeliveries(null);
    }
  };

  function openCreate() {
    setLabel("");
    setUrl("");
    setSelectedTypes([]);
    setShowCreate(true);
  }

  function openEdit(wh: Webhook) {
    setLabel(wh.label);
    setUrl(wh.url);
    setSelectedTypes(wh.eventTypes as string[]);
    setEditTarget(wh);
  }

  function toggleType(t: string) {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <main className="flex-1 p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Webhook className="size-6" />
              Outbound Webhooks
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Connect your external systems to platform events. Payloads are
              signed with HMAC-SHA256.
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="size-4 mr-2" />
            New Webhook
          </Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">
            Loading…
          </div>
        ) : webhooks.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Webhook className="size-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No webhooks registered yet</p>
              <p className="text-sm mt-1">
                Add your first webhook to start receiving platform events.
              </p>
              <Button className="mt-4" onClick={openCreate}>
                <Plus className="size-4 mr-2" />
                New Webhook
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {webhooks.map((wh) => (
              <Card key={wh.webhookId}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base">{wh.label}</CardTitle>
                        <Badge variant={wh.isActive ? "default" : "secondary"}>
                          {wh.isActive ? "Active" : "Disabled"}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {wh.ownerType}
                        </Badge>
                      </div>
                      <CardDescription className="mt-1 font-mono text-xs truncate">
                        {wh.url}
                      </CardDescription>
                      <p className="text-xs text-muted-foreground mt-1">
                        Secret: <span className="font-mono">{wh.secretPrefix}…</span>
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggle(wh)}
                      >
                        {wh.isActive ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(wh)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleRotate(wh.webhookId)}
                        disabled={rotateTarget === wh.webhookId}
                      >
                        <RotateCcw className="size-3 mr-1" />
                        Rotate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(wh.webhookId)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  {(wh.eventTypes as string[]).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(wh.eventTypes as string[]).map((t) => (
                        <Badge
                          key={t}
                          variant="secondary"
                          className="text-xs font-mono"
                        >
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {(wh.eventTypes as string[]).length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1 italic">
                      Subscribed to all events
                    </p>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  <button
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => void loadDeliveries(wh.webhookId)}
                  >
                    {expandedId === wh.webhookId ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    Delivery log
                    {loadingDeliveries === wh.webhookId && (
                      <RefreshCw className="size-3 animate-spin ml-1" />
                    )}
                  </button>
                  {expandedId === wh.webhookId && (
                    <div className="mt-3 space-y-2">
                      {(deliveries[wh.webhookId] ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">
                          No deliveries yet
                        </p>
                      ) : (
                        (deliveries[wh.webhookId] ?? []).map((d) => (
                          <DeliveryRow key={d.deliveryId} d={d} />
                        ))
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Webhook</DialogTitle>
            <DialogDescription>
              Register an HTTPS endpoint to receive signed platform events.
            </DialogDescription>
          </DialogHeader>
          <WebhookForm
            label={label}
            setLabel={setLabel}
            url={url}
            setUrl={setUrl}
            selectedTypes={selectedTypes}
            toggleType={toggleType}
          />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={creating}>
              {creating ? "Creating…" : "Create Webhook"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={() => setEditTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Webhook</DialogTitle>
          </DialogHeader>
          <WebhookForm
            label={label}
            setLabel={setLabel}
            url={url}
            setUrl={setUrl}
            selectedTypes={selectedTypes}
            toggleType={toggleType}
          />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void handleEdit()}>Save Changes</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Secret reveal dialog */}
      <Dialog
        open={!!newSecret || !!rotatedSecret}
        onOpenChange={() => {
          setNewSecret(null);
          setRotatedSecret(null);
          setSecretVisible(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {rotatedSecret ? "New Secret" : "Webhook Created"}
            </DialogTitle>
            <DialogDescription>
              Copy this secret and store it securely. It will not be shown
              again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Input
                readOnly
                type={secretVisible ? "text" : "password"}
                value={newSecret ?? rotatedSecret ?? ""}
                className="font-mono text-xs pr-10"
              />
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSecretVisible((v) => !v)}
              >
                {secretVisible ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Add this to your receiver as{" "}
              <code className="bg-muted rounded px-1">
                X-Webhook-Signature
              </code>{" "}
              verification using HMAC-SHA256.
            </p>
            <Button
              className="w-full"
              onClick={async () => {
                await navigator.clipboard.writeText(newSecret ?? rotatedSecret ?? "");
                toast({ title: "Copied", description: "Secret copied to clipboard" });
              }}
            >
              Copy to clipboard
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the webhook and all delivery history.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Shared form ───────────────────────────────────────────────────────────────

function WebhookForm({
  label,
  setLabel,
  url,
  setUrl,
  selectedTypes,
  toggleType,
}: {
  label: string;
  setLabel: (v: string) => void;
  url: string;
  setUrl: (v: string) => void;
  selectedTypes: string[];
  toggleType: (t: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="wh-label">Label</Label>
        <Input
          id="wh-label"
          placeholder="e.g. My PSA Integration"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wh-url">Endpoint URL</Label>
        <Input
          id="wh-url"
          placeholder="https://your-system.example.com/webhook"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Event subscriptions</Label>
        <p className="text-xs text-muted-foreground">
          Leave empty to receive all events, or select specific types.
        </p>
        <div className="border rounded-lg p-3 max-h-48 overflow-y-auto space-y-1">
          {ALL_EVENT_TYPES.map((t) => (
            <label
              key={t}
              className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
            >
              <input
                type="checkbox"
                className="rounded"
                checked={selectedTypes.includes(t)}
                onChange={() => toggleType(t)}
              />
              <span className="font-mono text-xs">{t}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
