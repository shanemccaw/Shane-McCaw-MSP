import React, { useState } from "react";
import { Radio } from "lucide-react";
import { useLiveStream } from "@/hooks/useLiveStream";

// Mirrors the canonical EVENT_TYPES in artifacts/api-server/src/lib/event-bus.ts.
// The event bus is server-only (no shared package export), so the frontend
// duplicates the values it needs — same convention msp-portal/src/pages/webhooks.tsx
// already uses for its own event-type picker. Keep in sync with event-bus.ts if a
// new EVENT_TYPES entry is added.
//
// The admin-live-stream firehose bridge (lib/sse-hub-event-bridge.ts) keys the hub
// channel by the event's `eventType` field directly — so subscribing here with
// ?channel=<eventType> is exactly how a business event surfaces live.
const BUSINESS_EVENT_TYPES = [
  "auth.login",
  "auth.logout",
  "auth.token.refresh",
  "auth.token.revoked",
  "auth.role.changed",
  "auth.account.setup",
  "auth.password.reset",
  "msp.service_account.created",
  "msp.service_account.revoked",
  "msp.created",
  "msp.updated",
  "msp.suspended",
  "customer.created",
  "customer.updated",
  "customer.status.changed",
  "user.invited",
  "user.activated",
  "user.deactivated",
  "service_account.created",
  "service_account.revoked",
  "document.created",
  "document.version.added",
  "document.status.changed",
  "idempotency.hit",
  "dlq.item.enqueued",
  "dlq.item.resolved",
  "auth.impersonation.session_started",
  "auth.impersonation.token_issued",
] as const;

export function EventBusStreamTab() {
  const [eventType, setEventType] = useState<string>("customer.created");
  const { frames, connected } = useLiveStream(eventType);

  return (
    <div className="h-full flex flex-col font-mono text-[11px] text-amber-400">
      <div className="flex-shrink-0 flex items-center gap-3 px-2.5 py-1.5 border-b border-slate-900/80">
        <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Event Type:</span>
        <select
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          className="bg-slate-900 border border-slate-800 text-amber-300 text-[10px] rounded px-1.5 py-0.5 outline-none focus:border-amber-500 font-bold"
        >
          {BUSINESS_EVENT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <span
          className={`flex items-center gap-1 text-[9px] font-bold uppercase tracking-tight px-1.5 py-0.5 rounded border ml-auto ${
            connected
              ? "text-emerald-400 bg-emerald-950/40 border-emerald-800"
              : "text-slate-500 bg-slate-900 border-slate-800"
          }`}
        >
          <Radio className={`w-2.5 h-2.5 ${connected ? "animate-pulse" : ""}`} />
          {connected ? "LIVE" : "OFFLINE"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 scrollbar-thin scrollbar-thumb-slate-900">
        {frames.length === 0 ? (
          <>
            <div>{`[EVENT BUS] Awaiting "${eventType}" events...`}</div>
            <div className="text-slate-500">{"// Published fired signals will auto-buffer package and bundle metrics targets down here natively."}</div>
          </>
        ) : (
          frames.map((f) => {
            const eventId = typeof f.data.eventId === "string" ? f.data.eventId : "—";
            const occurredAt = typeof f.data.occurredAt === "string" ? f.data.occurredAt : new Date(f.receivedAt).toISOString();
            const payload = f.data.payload && typeof f.data.payload === "object" ? f.data.payload : {};
            return (
              <div key={f.id} className="mb-1.5 pb-1.5 border-b border-slate-900/60 last:border-0">
                <span className="text-slate-500">{occurredAt}</span>{" "}
                <span className="text-amber-300 font-bold">{eventType}</span>{" "}
                <span className="text-slate-600">eventId={eventId}</span>
                <div className="text-slate-400 break-all">{JSON.stringify(payload)}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
