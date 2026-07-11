/**
 * Service Accounts (API Keys) settings sub-page.
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, Copy, Key, Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { Link } from "wouter";

interface ServiceAccount {
  id: number;
  name: string;
  keyPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export default function SettingsServiceAccountsPage() {
  const { fetchWithAuth } = useAuth();
  const [accounts, setAccounts] = useState<ServiceAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<{ name: string; rawKey: string } | null>(null);
  const [form, setForm] = useState({ name: "", expiresInDays: "" });

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/msp/settings/service-accounts");
      if (res.ok) {
        const data = (await res.json()) as ServiceAccount[];
        setAccounts(data);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setCreating(true);
    try {
      const body: Record<string, unknown> = { name: form.name.trim() };
      if (form.expiresInDays) body.expiresInDays = parseInt(form.expiresInDays, 10);

      const res = await fetchWithAuth("/api/msp/settings/service-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = (await res.json()) as ServiceAccount & { rawKey: string };
        setNewKey({ name: data.name, rawKey: data.rawKey });
        setShowCreate(false);
        setForm({ name: "", expiresInDays: "" });
        await loadAccounts();
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Create failed");
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: number, name: string) {
    if (!confirm(`Revoke API key "${name}"? This cannot be undone.`)) return;
    const res = await fetchWithAuth(`/api/msp/settings/service-accounts/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(`"${name}" revoked`);
      setAccounts((a) => a.filter((sa) => sa.id !== id));
    } else {
      toast.error("Revoke failed");
    }
  }

  function copyKey(key: string) {
    void navigator.clipboard.writeText(key);
    toast.success("API key copied to clipboard");
  }

  const actions = (
    <Link href="/settings">
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
        <ArrowLeft className="size-3.5" />
        Settings
      </Button>
    </Link>
  );

  return (
    <AppShell title="Service Accounts" actions={actions}>
      <div className="p-6 max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-muted/60 p-2">
              <Key className="size-4 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Service Accounts</h2>
              <p className="text-sm text-muted-foreground">Machine-to-machine API keys for automation.</p>
            </div>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus className="size-3.5" />
            New Key
          </Button>
        </div>

        {/* New key revealed modal */}
        {newKey && (
          <Card className="border-green-500/30 bg-green-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-green-700">New API key created: {newKey.name}</CardTitle>
              <CardDescription className="text-xs text-green-600">
                Copy this key now — it will not be shown again.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono break-all">
                  {newKey.rawKey}
                </code>
                <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => copyKey(newKey.rawKey)}>
                  <Copy className="size-3.5" />
                </Button>
              </div>
              <Button size="sm" variant="ghost" className="text-muted-foreground text-xs" onClick={() => setNewKey(null)}>
                I've copied the key — dismiss
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-4">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : accounts.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No service accounts yet. Create one to enable API access.
              </div>
            ) : (
              <div className="space-y-2">
                {accounts.map((sa) => (
                  <div
                    key={sa.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{sa.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <code className="text-[11px] text-muted-foreground font-mono">{sa.keyPrefix}…</code>
                        {sa.expiresAt && (
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${new Date(sa.expiresAt) < new Date() ? "text-destructive border-destructive/30" : ""}`}
                          >
                            Expires {new Date(sa.expiresAt).toLocaleDateString()}
                          </Badge>
                        )}
                        {sa.lastUsedAt && (
                          <span className="text-[11px] text-muted-foreground">
                            Last used {new Date(sa.lastUsedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-destructive hover:text-destructive shrink-0"
                      onClick={() => void handleRevoke(sa.id, sa.name)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldAlert className="size-3.5 shrink-0" />
          Key values are stored in Azure Key Vault and cannot be read back after creation.
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Create Service Account</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleCreate(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sa-name" className="text-xs">Name *</Label>
              <Input
                id="sa-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Automation Worker"
                required
                minLength={2}
                maxLength={100}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sa-expires" className="text-xs">Expires In (days, optional)</Label>
              <Input
                id="sa-expires"
                type="number"
                min={1}
                max={365}
                value={form.expiresInDays}
                onChange={(e) => setForm((f) => ({ ...f, expiresInDays: e.target.value }))}
                placeholder="90"
                className="h-8 text-sm"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={creating} className="gap-1.5">
                {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Key className="size-3.5" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
