/**
 * classify-scripts.ts
 *
 * Splits a list of script catalog rows into automated vs. manual groups.
 * Used by run-package to route scripts through either Azure Automation
 * or the manual download/upload flow.
 */

export interface ClassifiableScript {
  id: number;
  name: string;
  executionMode: "automated" | "manual";
  [key: string]: unknown;
}

export interface ClassifiedScripts<T extends ClassifiableScript> {
  automated: T[];
  manual: T[];
  requiresManualExecution: boolean;
}

export function classifyScripts<T extends ClassifiableScript>(scripts: T[]): ClassifiedScripts<T> {
  const automated = scripts.filter(s => s.executionMode !== "manual");
  const manual = scripts.filter(s => s.executionMode === "manual");
  return {
    automated,
    manual,
    requiresManualExecution: manual.length > 0,
  };
}
