/**
 * dashboard-designer.tsx
 *
 * Step 4b of the Dashboard / Web Part System — the PlatformAdmin design
 * surface for building a dashboard_templates canvas layout. Thin admin-panel
 * wrapper around the shared <DashboardDesigner> (from @workspace/dashboard-canvas)
 * supplying the MSP-picker slot (PlatformAdmin sessions have no mspId of their
 * own — see dashboard-templates.ts's header comment), the
 * /api/admin/dashboard-templates adapter, and this app's own shadcn
 * (`@/components/ui/*`) primitives via the `ui` prop — the shared component
 * has no UI-library dependency of its own, so each app supplies its real
 * components and both Designers render identically. msp-portal's Designer
 * (artifacts/msp-portal/src/pages/dashboard-designer.tsx) is the MSP-scoped
 * sibling of this page — always the caller's own mspId, no picker.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useServices, type ServiceRow } from "@/hooks/useServices";
import { detectProductType } from "@/lib/productTypeConfig";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DashboardDesigner,
  type DashboardDesignerAdapter,
  type DesignerUIKit,
  type TargetKeyOption,
  type TemplateType,
} from "@workspace/dashboard-canvas";

const UI: DesignerUIKit = {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
  Button, Label, Badge, Switch,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
};

interface Msp {
  id: number;
  name: string;
  slug: string;
}

interface MonitoringPackageOption {
  key: string;
  label: string;
  status: "active" | "archived";
}

export default function DashboardDesignerPage() {
  const { fetchWithAuth } = useAuth();
  const { data: services } = useServices();

  // ── MSP picker (PlatformAdmin-only concern) ──
  const [msps, setMsps] = useState<Msp[]>([]);
  const [mspId, setMspId] = useState<number | null>(null);
  const [loadingMsps, setLoadingMsps] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/msps?limit=100");
        if (!res.ok) return;
        const data = (await res.json()) as { msps: Msp[] };
        setMsps(data.msps ?? []);
        if (data.msps?.length === 1) setMspId(data.msps[0].id);
      } finally {
        setLoadingMsps(false);
      }
    })();
  }, [fetchWithAuth]);

  const assessmentServices = (services ?? []).filter(
    (s) => detectProductType(s.serviceClass, s.deliveryType, s.billingType, s.fulfillmentType) === "assessment",
  );
  const projectServices = (services ?? []).filter(
    (s) => detectProductType(s.serviceClass, s.deliveryType, s.billingType, s.fulfillmentType) === "project",
  );

  async function fetchTargetKeyOptions(templateType: TemplateType): Promise<TargetKeyOption[]> {
    if (templateType === "assessment") {
      return assessmentServices.map((s: ServiceRow) => ({ value: s.slug ?? String(s.id), label: s.name }));
    }
    if (templateType === "project") {
      return projectServices.map((s: ServiceRow) => ({ value: s.slug ?? String(s.id), label: s.name }));
    }
    if (templateType === "monitoring_package") {
      const res = await fetchWithAuth("/api/admin/monitoring-packages");
      if (!res.ok) return [];
      const data = (await res.json()) as { packages: MonitoringPackageOption[] };
      return (data.packages ?? []).filter((p) => p.status === "active").map((p) => ({ value: p.key, label: p.label }));
    }
    return [];
  }

  const adapter: DashboardDesignerAdapter = {
    fetchWithAuth,
    basePath: "/api/admin/dashboard-templates",
    fetchTargetKeyOptions,
  };

  return (
    <DashboardDesigner
      adapter={adapter}
      ui={UI}
      targetSelector={{
        mspId,
        render: () => (
          <div className="space-y-1.5">
            <Label className="text-xs">MSP</Label>
            <Select
              value={mspId != null ? String(mspId) : undefined}
              onValueChange={(v) => setMspId(Number(v))}
              disabled={loadingMsps}
            >
              <SelectTrigger className="h-8 text-xs w-56">
                <SelectValue placeholder={loadingMsps ? "Loading…" : "Select an MSP"} />
              </SelectTrigger>
              <SelectContent>
                {msps.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)} className="text-xs">
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ),
      }}
    />
  );
}
