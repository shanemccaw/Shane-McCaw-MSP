import type { ToolDef } from "./registry.ts";
import { platformHealthTool } from "./platform-health.ts";
import { whoamiTool } from "./whoami.ts";
// Phase 3 (#1322): read/query tools over real existing endpoints.
import { queryCustomersTool } from "./query-customers.ts";
import { getCustomerFindingsTool } from "./get-customer-findings.ts";
import { getRunningSopsTool } from "./get-running-sops.ts";
import { getChangeControlsTool } from "./get-change-controls.ts";
import { getAlertsTool } from "./get-alerts.ts";
import { getAuditLogsTool } from "./get-audit-logs.ts";
import { getInvoicesTool } from "./get-invoices.ts";
import { getRiskRegisterTool } from "./get-risk-register.ts";
import { getMicrosoftDriftTool } from "./get-microsoft-drift.ts";
// Phase 4 (#1323): single micro-remediation execution (write tool, #1325 audited).
import { executeActionTool } from "./execute-action.ts";
// Phase 5 (#1324): full config-pack execution (write tool, #1325 audited).
import { executeWritePackTool } from "./execute-write-pack.ts";

// Phase 2-5 (#1319): add your tool file next to these and append it here —
// that is the entire registration surface. See ../../README.md "Adding a tool".
export const ALL_TOOLS: ToolDef[] = [
  platformHealthTool,
  whoamiTool,
  queryCustomersTool,
  getCustomerFindingsTool,
  getRunningSopsTool,
  getChangeControlsTool,
  getAlertsTool,
  getAuditLogsTool,
  getInvoicesTool,
  getRiskRegisterTool,
  getMicrosoftDriftTool,
  executeActionTool,
  executeWritePackTool,
];