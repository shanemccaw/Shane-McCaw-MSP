import pino from "pino";

// stdout is the MCP protocol channel — every log line MUST go to stderr
// (fd 2) or it corrupts the JSON-RPC stream the MCP client is reading.
const base = pino(
  { timestamp: pino.stdTimeFunctions.isoTime, base: undefined },
  pino.destination(2),
);

// Channel per the platform taxonomy: this is Shane's admin-side operating
// tool, so it logs under the admin.* family.
export const logger = base.child({ channel: "admin.mcp" });

// Audit-trail lines (audit.ts, Git #1325) log under the taxonomy's own
// `audit` channel — a child of the ROOT logger, not of `logger`, so each
// line carries exactly one channel binding.
export const auditLogger = base.child({ channel: "audit" });
