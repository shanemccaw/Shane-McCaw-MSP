import pino from "pino";

// stdout is the MCP protocol channel — every log line MUST go to stderr
// (fd 2) or it corrupts the JSON-RPC stream the MCP client is reading.
// Channel per the platform taxonomy: this is Shane's admin-side operating
// tool, so it logs under the admin.* family.
export const logger = pino(
  { timestamp: pino.stdTimeFunctions.isoTime, base: undefined },
  pino.destination(2),
).child({ channel: "admin.mcp" });
