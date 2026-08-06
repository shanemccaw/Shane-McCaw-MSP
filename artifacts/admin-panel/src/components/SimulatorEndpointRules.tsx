// artifacts/admin-panel/src/components/SimulatorEndpointRules.tsx
//
// #507 (epic #508) — "Endpoint Rules" right-panel tab for Simulator Studio.
// Full rule/group CRUD for the currently selected M365 Endpoint, reusing the
// mature EngineRuleEditor with its #507 `lockedSignalKey` prop rather than a
// second, thinner editor. A monitor check's `key` IS its `signal_key`, so the
// selected check scopes the editor directly — no signal picker.
//
// Selection is tracked the same way SimulatorCenterCanvas tracks it: by
// listening for the `simulator-select-endpoint` window event SimulatorLeftTree
// (and the #379 deep link, and SimulatorBatchCanvas) dispatches with the full
// monitor_checks row as `detail`. Selection state lives in the center canvas,
// not on the page, so an event listener is the only non-invasive way to know
// which endpoint is open.

import { useEffect, useState } from "react";
import EngineRuleEditor from "./EngineRuleEditor";

interface SelectedCheck {
  key: string;
  label: string;
}

export function SimulatorEndpointRules() {
  const [selectedCheck, setSelectedCheck] = useState<SelectedCheck | null>(null);

  useEffect(() => {
    const handleSelect = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key?: string; label?: string } | undefined;
      if (detail?.key) setSelectedCheck({ key: detail.key, label: detail.label ?? detail.key });
    };
    window.addEventListener("simulator-select-endpoint", handleSelect);
    return () => window.removeEventListener("simulator-select-endpoint", handleSelect);
  }, []);

  if (!selectedCheck) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground/60 italic">
        Select an endpoint to manage its rules
      </div>
    );
  }

  // categoryPrefix feeds only the default category on new rules/groups
  // (`${prefix}:general`) in the locked path — the check key's own domain
  // segment ("identity" from "identity:risky-signins") is the honest value.
  // engineKey is unused when lockedSignalKey is set (data comes from
  // /api/admin/signal-rules); "health" just avoids a meaningless empty string.
  // `key` remounts the editor per endpoint so edit-form state never leaks
  // between selections.
  return (
    <div className="h-full overflow-y-auto p-2">
      <EngineRuleEditor
        key={selectedCheck.key}
        engineKey="health"
        categoryPrefix={selectedCheck.key.split(":")[0] ?? "endpoint"}
        engineLabel={selectedCheck.label}
        lockedSignalKey={selectedCheck.key}
      />
    </div>
  );
}
