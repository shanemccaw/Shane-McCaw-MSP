/**
 * webhooksData.ts — the Webhooks page fixture (Part 12).
 *
 * EXTRACTED from the prototype's `WEBHOOK_EVENTS` (Customer Portal Shell.dc.html
 * 15318-15330), `WEBHOOKS` (15331-15375), `whStateMeta` (15377-15382),
 * `whSamplePayload` (15445-15458), `whVerifySteps` (15459-15465) and
 * `whRetryFacts` (15466-15474). Every string is the design's, verbatim.
 *
 * ── Same taxonomy as Alert preferences ──────────────────────────────────────
 * The event `key`s here are the Alert preferences category keys (the prototype's
 * comment, 15316): one category list, two delivery surfaces. Event NAMES are the
 * wire format, so what is on screen is what lands in the payload.
 *
 * UI-only: design content. A later pass wires it to real delivery telemetry.
 */

export const WH_TITLE = "Webhooks";
export const WH_SUBTITLE =
  "Outbound event delivery to your own systems. Same event categories as your alert preferences — one taxonomy, two delivery surfaces. Event names below are the wire format, so what you see here is what arrives in the payload.";
export const WH_ENDPOINTS_KICKER = "Endpoints";
export const WH_CATALOGUE_KICKER = "Event catalogue";
export const WH_CATALOGUE_HEADERS = ["Event type", "Fires when", "Alert category", "Subscribed"] as const;

export const WH_VERIFY_KICKER = "Verify it came from us";
export const WH_VERIFY_SUB =
  "This is the one feature that reaches into your infrastructure. Treat an unverified payload as untrusted input.";
export const WH_VERIFY_COPY = "Copy verification snippet";
export const WH_VERIFY_DOCS = "Full API docs";
export const WH_SAMPLE_KICKER = "Sample payload";
export const WH_DOCS_KICKER = "Delivery behaviour";
export const WH_DOCS_SUB = "Timeouts, retries, ordering, and what happens when an endpoint stays down.";

/* Expanded-panel copy — proto 2578-2645 */
export const WH_SUBSCRIBED_EVENTS = "Subscribed events";
export const WH_EDIT_SUBSCRIPTION = "Edit subscription";
export const WH_SIGNING_SECRET = "Signing secret";
export const WH_REVEAL = "Reveal";
export const WH_ROTATE = "Rotate";
export const WH_TARGET_RETRIES = "Target & retries";
export const WH_RECENT_DELIVERIES = "Recent deliveries";
export const WH_VIEW_FULL_LOG = "View full delivery log →";
export const WH_SEND_TEST = "Send test event";
export const WH_EDIT_ENDPOINT = "Edit endpoint";
export const WH_DELETE = "Delete";
export const WH_TEST_SENT_KICKER = "Test event sent";
export const WH_TEST_SENT_BODY_PRE = "POST with type ";
export const WH_TEST_SENT_TYPE = "webhook.test";
export const WH_TEST_SENT_BODY_POST =
  " and a signed header set identical to a real event. Watch the delivery row above — a test appears in the log like any other delivery and is marked as a test in the payload.";

export type WhEventKey =
  | "findings"
  | "drift"
  | "drift-resolved"
  | "progress"
  | "score"
  | "reviews"
  | "review-due"
  | "remediation"
  | "gate"
  | "billing"
  | "support";

/** One catalogue event — prototype `WEBHOOK_EVENTS` (15318-15330). */
export interface WhEvent {
  key: WhEventKey;
  wire: string;
  label: string;
  from: string;
}

export const WEBHOOK_EVENTS: readonly WhEvent[] = [
  { key: "findings", wire: "finding.created", label: "New critical finding", from: "New critical findings" },
  { key: "drift", wire: "drift.detected", label: "Drift detected", from: "Drift" },
  { key: "drift-resolved", wire: "drift.resolved", label: "Drift resolved", from: "Drift" },
  { key: "progress", wire: "fix.verified", label: "Fix verified by re-scan", from: "Verified fixes and score moves" },
  { key: "score", wire: "score.changed", label: "Pillar score moved", from: "Verified fixes and score moves" },
  { key: "reviews", wire: "risk.accepted", label: "Risk accepted or decision recorded", from: "Risk acceptance and policy reviews" },
  { key: "review-due", wire: "risk.review_due", label: "Acceptance review date reached", from: "Risk acceptance and policy reviews" },
  { key: "remediation", wire: "scan.completed", label: "Scan completed", from: "Remediation and scan activity" },
  { key: "gate", wire: "phase.gate_verified", label: "Remediation phase gate verified", from: "Remediation and scan activity" },
  { key: "billing", wire: "billing.event", label: "Billing, purchase or renewal", from: "Billing, purchases and renewals" },
  { key: "support", wire: "ticket.updated", label: "Support ticket updated", from: "Support ticket updates" },
];

export type WhState = "healthy" | "failing" | "degraded" | "paused";
export type WhDeliveryTone = "green" | "amber" | "red";

export interface WhDelivery {
  event: string;
  when: string;
  code: string;
  ms: string;
  tone: WhDeliveryTone;
}

export interface WhFailure {
  since: string;
  count: number;
  code: string;
  reason: string;
  next: string;
}

/** One configured endpoint — prototype `WEBHOOKS` (15331-15375). */
export interface Webhook {
  id: string;
  name: string;
  url: string;
  target: string;
  state: WhState;
  events: readonly WhEventKey[];
  lastDelivery: string;
  successRate: string;
  volume: string;
  created: string;
  secretHint: string;
  rotated: string;
  retries: string;
  failure?: WhFailure;
  recent: readonly WhDelivery[];
}

export const WEBHOOKS: readonly Webhook[] = [
  {
    id: "wh_7f2a91",
    name: "Sentinel ingestion",
    url: "https://ingest.tenant-siem.net/m365/events",
    target: "Microsoft Sentinel · HTTP Data Collector",
    state: "healthy",
    events: ["findings", "drift", "drift-resolved", "progress", "score", "reviews", "review-due", "remediation", "gate"],
    lastDelivery: "14 minutes ago · 200 OK · 412 ms",
    successRate: "100%",
    volume: "1,204 in 30 days",
    created: "11 January 2026",
    secretHint: "whsec_••••••••••••4f19",
    rotated: "Rotated 3 weeks ago",
    retries: "None in 30 days",
    recent: [
      { event: "drift.detected", when: "14 min ago", code: "200", ms: "412", tone: "green" },
      { event: "scan.completed", when: "2 hrs ago", code: "200", ms: "388", tone: "green" },
      { event: "finding.created", when: "2 hrs ago", code: "200", ms: "401", tone: "green" },
      { event: "fix.verified", when: "9 hrs ago", code: "200", ms: "377", tone: "green" },
    ],
  },
  {
    id: "wh_3c88de",
    name: "IT operations Slack",
    url: "https://hooks.slack.com/services/T04••••/B06••••/••••••••",
    target: "Slack incoming webhook · #it-operations",
    state: "failing",
    events: ["findings", "drift", "gate", "support"],
    lastDelivery: "3 hours ago · 404 Not Found · 118 ms",
    successRate: "61%",
    volume: "96 in 30 days",
    created: "2 March 2026",
    secretHint: "whsec_••••••••••••ba07",
    rotated: "Never rotated",
    retries: "37 retries, 14 permanent failures",
    failure: {
      since: "3 days ago",
      count: 14,
      code: "404 Not Found",
      reason: "Slack returns 404 when an incoming webhook has been revoked or the channel it posts to was archived. Nothing on our side will fix this — the endpoint URL has to be regenerated in Slack.",
      next: "Retries stopped after 6 attempts per event. 14 events were dropped rather than queued indefinitely; they are listed below and can be replayed once the URL is fixed.",
    },
    recent: [
      { event: "finding.created", when: "3 hrs ago", code: "404", ms: "118", tone: "red" },
      { event: "drift.detected", when: "1 day ago", code: "404", ms: "124", tone: "red" },
      { event: "ticket.updated", when: "2 days ago", code: "404", ms: "109", tone: "red" },
      { event: "finding.created", when: "4 days ago", code: "200", ms: "96", tone: "green" },
    ],
  },
  {
    id: "wh_9d41b0",
    name: "ServiceNow ticket creation",
    url: "https://tenant.service-now.com/api/x_smcc/m365/event",
    target: "ServiceNow scripted REST API",
    state: "degraded",
    events: ["findings", "gate", "review-due"],
    lastDelivery: "41 minutes ago · 200 OK · 3,910 ms",
    successRate: "94%",
    volume: "318 in 30 days",
    created: "19 February 2026",
    secretHint: "whsec_••••••••••••e2c5",
    rotated: "Rotated 6 days ago",
    retries: "19 retries, all eventually delivered",
    failure: {
      since: "Intermittent for 8 days",
      count: 19,
      code: "504 Gateway Timeout",
      reason: "The endpoint responds in 3.9 seconds on average and times out above 5. Deliveries succeed on retry, so nothing has been lost, but this is the shape of a problem that becomes data loss under load.",
      next: "Consider acknowledging the request immediately and processing asynchronously on your side. Our timeout is 10 seconds with 6 retries at exponential backoff.",
    },
    recent: [
      { event: "finding.created", when: "41 min ago", code: "200", ms: "3910", tone: "amber" },
      { event: "phase.gate_verified", when: "6 hrs ago", code: "504", ms: "10000", tone: "red" },
      { event: "finding.created", when: "6 hrs ago", code: "200", ms: "4120", tone: "amber" },
      { event: "risk.review_due", when: "1 day ago", code: "200", ms: "2870", tone: "green" },
    ],
  },
  {
    id: "wh_5a10c7",
    name: "Power Automate — exec digest",
    url: "https://prod-14.uksouth.logic.azure.com/workflows/••••/triggers/manual/paths/invoke",
    target: "Power Automate flow · weekly digest to leadership",
    state: "paused",
    events: ["score", "billing"],
    lastDelivery: "Paused 12 days ago · last delivery 200 OK",
    successRate: "100%",
    volume: "0 in 30 days",
    created: "4 December 2025",
    secretHint: "whsec_••••••••••••17aa",
    rotated: "Rotated 4 months ago",
    retries: "None",
    recent: [
      { event: "score.changed", when: "12 days ago", code: "200", ms: "640", tone: "green" },
      { event: "billing.event", when: "13 days ago", code: "200", ms: "588", tone: "green" },
    ],
  },
];

/** Per-state colour + label — prototype `whStateMeta` (15377-15382). */
export const WH_STATE_META: Readonly<Record<WhState, { c: string; label: string }>> = {
  healthy: { c: "#34d399", label: "Healthy" },
  failing: { c: "#f87171", label: "Failing" },
  degraded: { c: "#c2a63d", label: "Degraded" },
  paused: { c: "#64748b", label: "Paused" },
};

/** Delivery tone → colour — prototype 15410. */
export const WH_TONE_COLOR: Readonly<Record<WhDeliveryTone, string>> = {
  green: "#34d399",
  amber: "#c2a63d",
  red: "#f87171",
};

/** The number of events dropped by the failing endpoint — prototype 15440. */
export const WH_DROPPED_COUNT = 14;

/** The sample event payload — prototype `whSamplePayload` (15445-15458). */
export const WH_SAMPLE_PAYLOAD = `{
  "id": "evt_01J9F2K7M3QX",
  "type": "finding.created",
  "created": "2026-08-19T09:14:22Z",
  "tenant": { "id": "8f4c1a…", "name": "tenant.com" },
  "data": {
    "findingId": "SEC-014",
    "pillar": "security",
    "severity": "critical",
    "title": "Legacy authentication enabled tenant-wide",
    "scanNumber": 14,
    "portalUrl": "https://portal.shanemccaw.com/f/SEC-014"
  }
}`;

export interface WhKv {
  k: string;
  v: string;
}

/** How to verify a payload came from us — prototype `whVerifySteps` (15459-15465). */
export const WH_VERIFY_STEPS: readonly WhKv[] = [
  { k: "1 · Read the headers", v: "Every request carries X-SMC-Signature (hex HMAC-SHA256), X-SMC-Timestamp (Unix seconds) and X-SMC-Event-Id. The event ID is stable across retries, so use it for idempotency." },
  { k: "2 · Rebuild the signed string", v: "Concatenate the timestamp, a full stop, and the raw request body exactly as received — before any JSON parsing or re-serialisation, which would change the bytes." },
  { k: "3 · Compute and compare", v: "HMAC-SHA256 the signed string with your endpoint secret, hex-encode it, and compare against X-SMC-Signature using a constant-time comparison." },
  { k: "4 · Reject old timestamps", v: "Discard anything with a timestamp more than 5 minutes old. That is what stops a captured request being replayed at you later." },
  { k: "5 · Respond fast", v: "Return 2xx within 10 seconds. Acknowledge first and process asynchronously — the ServiceNow endpoint on this page is a live example of what happens when you do not." },
];

/** Delivery-behaviour facts — prototype `whRetryFacts` (15466-15474). */
export const WH_RETRY_FACTS: readonly WhKv[] = [
  { k: "Timeout", v: "10 seconds per attempt" },
  { k: "Retries", v: "6 attempts, exponential backoff from 30 seconds to 6 hours" },
  { k: "Retry on", v: "Connection failures, timeouts, and any 5xx or 429 response" },
  { k: "No retry on", v: "4xx other than 429 — a 404 or 401 is treated as a configuration error, not a transient one" },
  { k: "After exhaustion", v: "The event is marked dropped and listed on the endpoint. Dropped events can be replayed for 30 days." },
  { k: "Ordering", v: "Not guaranteed. Use the created timestamp rather than arrival order." },
  { k: "Source addresses", v: "20.26.14.0/24 — allow-list these if your endpoint is behind a firewall" },
];
