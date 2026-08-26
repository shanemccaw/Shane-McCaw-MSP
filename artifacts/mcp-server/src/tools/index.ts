import type { ToolDef } from "./registry.ts";
import { platformHealthTool } from "./platform-health.ts";
import { whoamiTool } from "./whoami.ts";

// Phase 2-5 (#1319): add your tool file next to these and append it here —
// that is the entire registration surface. See ../../README.md "Adding a tool".
export const ALL_TOOLS: ToolDef[] = [platformHealthTool, whoamiTool];
