/**
 * Organisation Profile settings sub-page.
 */

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useMspSlug } from "@/lib/slug-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Building2, Loader2, Save } from "lucide-react";
import { Link } from "wouter";

interface MspProfile {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  status: string;
  trialEndsAt: string | null;
  customCustomerAgreement: string | null;
}

export default function SettingsOrgProfilePage() {
  const { fetchWithAuth } = useAuth();
  const mspSlug = useMspSlug();
  const [profile, setProfile] = useState<MspProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", domain: "", logoUrl: "", primaryColor: "", customCustomerAgreement: "" });

  useEffect(() => {
    const params = mspSlug ? `?slug=${encodeURIComponent(mspSlug)}` : "";
    fetchWithAuth(`/api/msp/settings/profile${params}`)
      .then((r) => r.json())
      .then((data: MspProfile) => {
        setProfile(data);
        setForm({
          name: data.name ?? "",
          domain: data.domain ?? "",
          logoUrl: data.logoUrl ?? "",
          primaryColor: data.primaryColor ?? "#0078D4",
          customCustomerAgreement: data.customCustomerAgreement ?? "",
        });
      })
      .catch(() => toast.error("Failed to load profile"))
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, string | null> = { 
        name: form.name,
        customCustomerAgreement: form.customCustomerAgreement || null
      };
      if (form.domain) body.domain = form.domain;
      if (form.logoUrl) body.logoUrl = form.logoUrl;
      if (form.primaryColor) body.primaryColor = form.primaryColor;

      const slugParam = mspSlug ? `?slug=${encodeURIComponent(mspSlug)}` : "";
      const res = await fetchWithAuth(`/api/msp/settings/profile${slugParam}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success("Profile updated");
        const data = (await res.json()) as MspProfile;
        setProfile(data);
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Update failed");
      }
    } finally {
      setSaving(false);
    }
  }

  const actions = (
    <Link href="/settings">
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
        <ArrowLeft className="size-3.5" />
        Settings
      </Button>
    </Link>
  );

  if (loading) {
    return (
      <AppShell title="Organisation Profile" actions={actions}>
        <div className="p-6 flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Organisation Profile" actions={actions}>
      <div className="p-6 max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-muted/60 p-2">
            <Building2 className="size-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Organisation Profile</h2>
            <p className="text-sm text-muted-foreground">Update your MSP name, logo, and contact details.</p>
          </div>
        </div>

        {profile && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[11px]">{profile.status}</Badge>
            <span className="text-xs text-muted-foreground font-mono">{profile.slug}</span>
            {profile.trialEndsAt && (
              <span className="text-xs text-amber-600">
                Trial ends {new Date(profile.trialEndsAt).toLocaleDateString()}
              </span>
            )}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Profile Details</CardTitle>
            <CardDescription className="text-xs">These details are used in customer-facing communications.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs">Organisation Name *</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Contoso IT Solutions"
                  required
                  minLength={2}
                  maxLength={120}
                  className="h-8 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="domain" className="text-xs">Primary Domain</Label>
                <Input
                  id="domain"
                  value={form.domain}
                  onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
                  placeholder="contosoit.com"
                  className="h-8 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="logoUrl" className="text-xs">Logo URL</Label>
                <Input
                  id="logoUrl"
                  type="url"
                  value={form.logoUrl}
                  onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
                  placeholder="https://cdn.example.com/logo.svg"
                  className="h-8 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="primaryColor" className="text-xs">Brand Colour</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="primaryColor"
                    type="color"
                    value={form.primaryColor || "#0078D4"}
                    onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
                    className="h-8 w-12 rounded border border-border cursor-pointer"
                  />
                  <Input
                    value={form.primaryColor}
                    onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
                    placeholder="#0078D4"
                    className="h-8 text-sm font-mono w-32"
                    pattern="^#[0-9a-fA-F]{6}$"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="customCustomerAgreement" className="text-xs">Customer Purchase Agreement</Label>
                <Textarea
                  id="customCustomerAgreement"
                  value={form.customCustomerAgreement}
                  onChange={(e) => setForm((f) => ({ ...f, customCustomerAgreement: e.target.value }))}
                  placeholder="Enter custom agreement terms..."
                  className="min-h-[120px] text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  If left blank, the platform default billing disclosure will be presented to your clients upon purchase.
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Save Changes
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
