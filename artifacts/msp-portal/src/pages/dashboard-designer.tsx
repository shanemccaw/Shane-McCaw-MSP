/**
 * dashboard-designer.tsx
 *
 * MSP-facing Dashboard Designer — the msp-portal sibling of admin-panel's
 * PlatformAdmin Designer (artifacts/admin-panel/src/pages/dashboard-designer.tsx).
 * Both are thin wrappers around the shared <DashboardDesigner> from
 * @workspace/dashboard-canvas; this one has no MSP picker (an MSPAdmin/
 * MSPOperator session always operates on their own req.user.mspId — see
 * dashboard-templates.ts's header comment) and talks to the
 * /api/msp/dashboard-templates + /api/msp/services + /api/msp/monitoring-packages
 * routes instead of the /api/admin/* ones.
 *
 * Gated to MSPAdmin/MSPOperator by its route registration in App.tsx and by
 * the nav entry's `roles` list in app-shell.tsx — CustomerUser never sees
 * either.
 *
 * Passes this app's own shadcn (`@/components/ui/*`) primitives via the `ui`
 * prop — msp-portal and admin-panel carry byte-identical wrappers around the
 * same Radix components, so this renders identically to admin-panel's Designer.
 */
import { useAuth } from "@/lib/auth-context";
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

interface ServiceOption {
  id: number;
  slug: string | null;
  name: string;
}

interface MonitoringPackageOption {
  key: string;
  label: string;
  status: "active" | "archived";
}

export default function DashboardDesignerPage() {
  const { user, fetchWithAuth } = useAuth();

  async function fetchTargetKeyOptions(templateType: TemplateType): Promise<TargetKeyOption[]> {
    if (templateType === "assessment" || templateType === "project") {
      const res = await fetchWithAuth(`/api/msp/services?type=${templateType}`);
      if (!res.ok) return [];
      const data = (await res.json()) as { services: ServiceOption[] };
      return (data.services ?? []).map((s) => ({ value: s.slug ?? String(s.id), label: s.name }));
    }
    if (templateType === "monitoring_package") {
      const res = await fetchWithAuth("/api/msp/monitoring-packages");
      if (!res.ok) return [];
      const data = (await res.json()) as { packages: MonitoringPackageOption[] };
      return (data.packages ?? []).filter((p) => p.status === "active").map((p) => ({ value: p.key, label: p.label }));
    }
    return [];
  }

  const adapter: DashboardDesignerAdapter = {
    fetchWithAuth,
    basePath: "/api/msp/dashboard-templates",
    fetchTargetKeyOptions,
  };

  return (
    <DashboardDesigner
      adapter={adapter}
      ui={UI}
      targetSelector={{
        mspId: user?.mspId ?? null,
        render: () => null,
      }}
    />
  );
}
