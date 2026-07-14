/**
 * AssessmentModulePanel.tsx
 *
 * Generic shell — the direct customer-portal analogue of admin-panel's EnginePanel.tsx.
 *
 * Looks up moduleKey in ASSESSMENT_MODULE_DEFS and renders the registered component.
 * Zero per-module branching here; all module-specific logic lives in the individual
 * module files. Adding a new module never requires touching this file.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { ASSESSMENT_MODULE_DEFS, type AssessmentModuleProps } from "./module-registry";

interface AssessmentModulePanelProps extends AssessmentModuleProps {
  moduleKey: string;
}

function UnknownModuleCard({ moduleKey }: { moduleKey: string }) {
  return (
    <Card className="border-border/50 border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
          <AlertCircle className="size-4" />
          Unknown module
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground/70">
          No module is registered for key <code className="font-mono bg-muted px-1 rounded">{moduleKey}</code>.
          Check the <code className="font-mono bg-muted px-1 rounded">type_attributes.dashboardModules</code> value
          on the service row.
        </p>
      </CardContent>
    </Card>
  );
}

export default function AssessmentModulePanel({
  moduleKey,
  serviceSlug,
  results,
  loading,
  error,
}: AssessmentModulePanelProps) {
  const def = ASSESSMENT_MODULE_DEFS.find((m) => m.key === moduleKey);

  if (!def) {
    return <UnknownModuleCard moduleKey={moduleKey} />;
  }

  const ModuleComponent = def.component;
  return (
    <ModuleComponent
      serviceSlug={serviceSlug}
      results={results}
      loading={loading}
      error={error}
    />
  );
}
