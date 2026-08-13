---
name: SOW debug page pattern
description: How the admin SOW Generation Debug page reuses real generation logic safely
---

The debug page calls the exact same `generateConsolidatedSowDocument()` used for real
client SOWs, but with `testMode: true` (no DB writes) and a generated `correlationId`
passed through as `runId`. The generator pushes logs/signal snapshots into an in-memory
ring buffer (`sow-debug-log-buffer.ts`, max 30 runs) keyed by that correlationId, which
the debug UI polls via a separate read-only route.

**Why:** avoids duplicating SOW/signal-evaluation logic in a parallel "debug" code path
(a common source of drift), while still exposing internal signal/log detail that
production endpoints don't return.

**How to apply:** for any future "debug view into a generation pipeline" request, prefer
wiring a `correlationId`-keyed capture buffer around the real function call over building
a separate instrumented copy.
