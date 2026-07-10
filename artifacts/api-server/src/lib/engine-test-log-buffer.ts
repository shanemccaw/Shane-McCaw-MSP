/**
 * engine-test-log-buffer.ts
 *
 * In-memory ring buffer capturing test/preview runs triggered from any of the
 * seven Intelligence Engine admin pages (priority, pricing, health, drift,
 * forecasting, crm, msp). Mirrors the SOW Generation Debug page's buffer
 * (`sow-debug-log-buffer.ts`) — not persisted, lost on server restart, which
 * is fine for a live debug/testing tool.
 */

export interface EngineTestLogEntry {
  id: string;
  engineKey: string;
  createdAt: string;
  mode: "tenant" | "payload";
  tenantId?: number;
  debug: boolean;
  output: unknown;
  error?: string;
}

const MAX_ENTRIES_PER_ENGINE = 30;
const buffers = new Map<string, EngineTestLogEntry[]>();

export function pushEngineTestLog(entry: EngineTestLogEntry): void {
  const list = buffers.get(entry.engineKey) ?? [];
  list.unshift(entry);
  if (list.length > MAX_ENTRIES_PER_ENGINE) list.length = MAX_ENTRIES_PER_ENGINE;
  buffers.set(entry.engineKey, list);
}

export function listEngineTestLogs(engineKey: string): EngineTestLogEntry[] {
  return buffers.get(engineKey) ?? [];
}
