// Real per-call tool-name propagation for the "what Claude wrote" audit trail (Git #3214's
// Recent activity: "Claude Desktop · set_medication · Vitamin D3, morning, auto-refill").
//
// tools.mjs has ~50 handlers, each calling audit.record() with its own hand-picked `action`
// string (e.g. "medication.create") -- a different, older vocabulary than the real MCP tool
// name a Claude conversation actually invoked (`set_medication`). Rather than touching every
// one of those call sites to also pass the tool name by hand, protocol.mjs's one real dispatch
// point wraps each handler call in this AsyncLocalStorage context, and audit.record() reads it
// back automatically -- the real tool name rides along with every record() call made during
// that handler's execution, with zero per-handler changes.

import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage();

export function runWithToolName(name, fn) {
  return store.run(name, fn);
}

export function currentToolName() {
  return store.getStore() ?? null;
}
