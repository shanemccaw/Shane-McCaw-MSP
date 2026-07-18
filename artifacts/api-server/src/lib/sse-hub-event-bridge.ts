import { addEventListener } from "./event-bus.ts";
import { broadcastToHub } from "./sse-hub.ts";

// Bridges the canonical event bus into the generic SSE hub. Every event
// dispatched via dispatchEvent()/dispatchUnsafe() is mirrored to hub
// subscribers so live admin views can tail canonical activity in real time
// without polling the msp_event_store table.
//
// ── CHANNEL KEYING — read before changing ─────────────────────────────────────
// The original phase sketch proposed keying the hub channel by the event's
// `source` field and forwarding its `correlationId`, receiving both a
// dispatched event and an "envelope" as two listener arguments. All three of
// those assumptions are wrong against the real event-bus contract:
//
//   • `EventListener` (see event-bus.ts) is a SINGLE-argument callback. It
//     receives one enriched object shaped as
//       { eventId, eventType, occurredAt, mspId, customerId, payload }
//     — there is no second "envelope" argument.
//   • That object carries NEITHER `source` NOR `correlationId`. notifyListeners()
//     builds the enriched payload from `dispatched` + tenant fields only and
//     drops both. Surfacing them to listeners would require editing
//     event-bus.ts, which is explicitly out of scope for this phase.
//   • Even if `source` were available, the values actually dispatched today
//     ("auth.login", "auth.refresh", "purchase", "doc-pipeline",
//     "dunning-workflow", "msp-billing-webhook", …) are freeform module/action
//     names that do NOT line up 1:1 with the locked channel taxonomy, so they
//     would not be a safe channel key regardless.
//
// We therefore key the channel by `eventType` — a stable, well-defined value
// (see EVENT_TYPES in event-bus.ts, e.g. "auth.login", "customer.created") that
// IS delivered to listeners — and scope by mspId. Subscribers connect with
// ?channel=<eventType>. The hub and the /admin/live-stream route are both
// taxonomy-agnostic (they key on whatever string is passed), so only this
// bridge makes a keying choice. Migrating to true `source`/canonical-channel
// routing is a deliberate follow-up that must FIRST extend the event-bus
// listener payload to carry `source` (and, if wanted, `correlationId`).
addEventListener((event) => {
  broadcastToHub(event.eventType, event.mspId ?? null, {
    type: "event",
    eventType: event.eventType,
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    payload: event.payload ?? {},
  });
});
