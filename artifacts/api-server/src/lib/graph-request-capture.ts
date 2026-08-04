/**
 * graph-request-capture.ts
 *
 * Records the LITERAL outgoing HTTP request a Graph call makes — method, fully
 * resolved URL, and the complete header set as actually written to the socket —
 * for Simulator Studio test runs only (#393).
 *
 * WHY THIS EXISTS. `identity:pim-eligible-roles` kept failing with Microsoft's
 * `CultureNotFoundException: '*' is an invalid culture identifier` after every
 * plausible cause readable from source had been ruled out: the stored endpoint
 * verified clean of any literal `*`, the required scope verified granted, the
 * re-consent verified done. The only remaining question — "what is actually on
 * the wire?" — could not be answered by reading code, because the header set
 * that reaches Graph is NOT the header set this codebase writes. `undici` (the
 * engine behind Node's global `fetch`) injects its own defaults, and one of them
 * is `accept-language: *`. Reconstructing the request from the options object
 * would have shown a header list that never contained an asterisk at all.
 *
 * THREE PROPERTIES THIS MODULE HOLDS TO:
 *
 *   1. ZERO BEHAVIORAL CHANGE. Nothing here touches the request that gets sent.
 *      `recordOutgoingGraphRequest` reads the (url, init) pair `fetch` is about
 *      to be handed and builds a THROWAWAY `Request` object from it purely to
 *      read back the normalized header list; that object is never dispatched.
 *      Every entry point is wrapped so a fault in the capture can only lose the
 *      capture, never fail the Graph call.
 *
 *   2. SIMULATOR-ONLY. Capture is off unless the calling async context is inside
 *      `createGraphRequestCapture()`, which only admin-monitor-check-runs.ts's
 *      simulator run path enters. On a scheduled production package run
 *      `recordOutgoingGraphRequest` is one `AsyncLocalStorage.getStore()` and an
 *      early return, and the diagnostics-channel subscriber is not even
 *      subscribed (it attaches on the first active session and detaches on the
 *      last), so a production scan carries no listener at all.
 *
 *   3. NO SECRETS OUT. The Authorization header's bearer token is never
 *      returned — not from the Request object and not from the raw wire block.
 *      What IS returned is the token's decoded, unverified public claim set
 *      (`aud`/`iss`/`tid`/`appid`/`roles`/`exp`), because "is the granted app
 *      role actually in the token this request carried?" is the single most
 *      useful thing a permission diagnosis needs and it is not a secret.
 *
 * TWO HEADER VIEWS, DELIBERATELY BOTH. `headers` is what a `Request` built from
 * the exact (url, init) pair reports — this codebase's own headers, normalized.
 * `wireHeaders` is the raw header block undici wrote to the socket, taken from
 * the `undici:client:sendHeaders` diagnostics channel. The difference between
 * the two IS the answer to "does anything inject headers we never set?", so
 * collapsing them into one list would destroy the evidence. `wireHeaders` is
 * best-effort: if the channel shape ever changes, the record still carries the
 * Request-object view and says the wire view was unavailable.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import diagnosticsChannel from "node:diagnostics_channel";
import { logger } from "./logger";

const log = logger.child({ channel: "engine.monitor" });

/**
 * The undici channel that publishes the header block actually written to the
 * socket, AFTER undici has added its own defaults (host, connection, accept,
 * accept-language, sec-fetch-mode, user-agent, accept-encoding). Node's global
 * `fetch` is undici-backed, so no undici import is needed to subscribe.
 */
const UNDICI_SEND_HEADERS_CHANNEL = "undici:client:sendHeaders";

/**
 * Per-run cap on captured requests. A paginated check can issue up to
 * NEXT_LINK_MAX_PAGES (50) requests and a fan-out check far more; the panel only
 * ever needs the first few to answer "what went out". Truncation is recorded
 * explicitly on the session rather than silently dropping the tail.
 */
export const MAX_CAPTURED_REQUESTS = 25;

/** Headers whose VALUE is never returned, whatever view it came from. */
const REDACTED_HEADERS = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization"]);

/** The only JWT claims copied out of a bearer token. Never the token itself. */
const SURFACED_TOKEN_CLAIMS = [
  "aud",
  "iss",
  "tid",
  "appid",
  "app_displayname",
  "azp",
  "roles",
  "scp",
  "iat",
  "nbf",
  "exp",
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CapturedHeader {
  name: string;
  value: string;
  /** True when the value was replaced by a redaction placeholder. */
  redacted?: boolean;
}

export interface CapturedTokenClaims {
  [claim: string]: unknown;
}

export interface CapturedGraphRequest {
  /** 1-based order within the run — a retry or a nextLink page is its own entry. */
  sequence: number;
  at: string;
  method: string;
  /** The fully resolved absolute URL, exactly as handed to fetch(). */
  url: string;
  /**
   * Headers as a `Request` built from the same (url, init) reports them: this
   * codebase's own headers, including the Authorization graphFetchForTenant
   * itself adds, after WHATWG normalization (lowercased names, combined values).
   */
  headers: CapturedHeader[];
  /**
   * The literal header block undici wrote to the socket, split per line, with
   * secret values redacted. Null when the diagnostics channel produced no match
   * for this request (see `wireHeadersNote`).
   */
  wireHeaders: string[] | null;
  wireHeadersNote?: string;
  /** Decoded, UNVERIFIED public claims of the bearer token this request carried. */
  tokenClaims: CapturedTokenClaims | null;
  /** First 2 KB of the request body, when there was one. */
  bodyPreview?: string;
  /** Response status, annotated after the fetch resolves. */
  responseStatus?: number;
}

export interface GraphRequestCapture {
  requests: CapturedGraphRequest[];
  /** Set when more requests were issued than MAX_CAPTURED_REQUESTS retained. */
  truncatedNote?: string;
}

interface CaptureSession {
  requests: CapturedGraphRequest[];
  issued: number;
}

// ── Session plumbing ──────────────────────────────────────────────────────────

const captureStore = new AsyncLocalStorage<CaptureSession>();

/**
 * Every session currently capturing. The diagnostics-channel subscriber matches
 * against this rather than against `captureStore.getStore()`: the socket write
 * that publishes `sendHeaders` can happen in a connection-management async
 * context that is not the caller's, so relying on ALS propagation there would
 * silently lose the wire view on exactly the requests that had to wait for a
 * connection.
 */
const activeSessions = new Set<CaptureSession>();

let wireSubscription: ((message: unknown) => void) | null = null;

function subscribeToWireHeaders(): void {
  if (wireSubscription) return;
  const handler = (message: unknown) => {
    try {
      attachWireHeaders(message as { headers?: unknown });
    } catch (err) {
      // A capture-side fault must never surface on the request path.
      log.debug({ err }, "graph-request-capture: wire-header attach failed");
    }
  };
  wireSubscription = handler;
  diagnosticsChannel.subscribe(UNDICI_SEND_HEADERS_CHANNEL, handler);
}

function unsubscribeFromWireHeaders(): void {
  if (!wireSubscription) return;
  diagnosticsChannel.unsubscribe(UNDICI_SEND_HEADERS_CHANNEL, wireSubscription);
  wireSubscription = null;
}

export interface GraphRequestCaptureHandle {
  /** Runs `fn` with capture on for its async context. Result and thrown errors pass through UNTOUCHED. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Everything captured so far — readable from a catch block, since a failed run is the interesting one. */
  snapshot(): GraphRequestCapture;
  /** Ends the session. Idempotent; call it in a `finally`. */
  close(): void;
}

/**
 * Opens a capture session. Deliberately NOT a wrapper that swallows and returns
 * the error: the simulator run path has real error handling of its own, and
 * capture must not sit between a Graph failure and the code that classifies it.
 * `run()` rethrows exactly what `fn` threw, and `snapshot()` still has the
 * requests that led up to it.
 */
export function createGraphRequestCapture(): GraphRequestCaptureHandle {
  const session: CaptureSession = { requests: [], issued: 0 };
  activeSessions.add(session);
  subscribeToWireHeaders();
  let closed = false;

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      return captureStore.run(session, fn);
    },
    snapshot(): GraphRequestCapture {
      return buildCapture(session);
    },
    close(): void {
      if (closed) return;
      closed = true;
      activeSessions.delete(session);
      if (activeSessions.size === 0) unsubscribeFromWireHeaders();
    },
  };
}

function buildCapture(session: CaptureSession): GraphRequestCapture {
  const capture: GraphRequestCapture = { requests: session.requests };
  if (session.issued > session.requests.length) {
    capture.truncatedNote =
      `This run issued ${session.issued} request(s); the first ${session.requests.length} are shown ` +
      `(cap: ${MAX_CAPTURED_REQUESTS}). Later pagination pages are omitted, not merged into these.`;
  }
  return capture;
}

/** True when the current async context is inside a capture session. */
export function isCapturingGraphRequests(): boolean {
  return captureStore.getStore() != null;
}

// ── The capture point ─────────────────────────────────────────────────────────

/**
 * Records the request `fetch` is about to be given. Called from graph.ts
 * immediately before the real `fetch()` — after auth and every other header this
 * codebase adds, so what is recorded is final, not a reconstruction.
 *
 * Returns the sequence number of the record (for a later `annotate…` call), or
 * null when capture is off — which is every production check run.
 */
export function recordOutgoingGraphRequest(url: string, init: RequestInit): number | null {
  const session = captureStore.getStore();
  if (!session) return null;

  try {
    session.issued += 1;
    if (session.requests.length >= MAX_CAPTURED_REQUESTS) return null;

    const headers = readHeaders(url, init);
    const authorization = findHeaderValue(init.headers, "authorization");

    const record: CapturedGraphRequest = {
      sequence: session.requests.length + 1,
      at: new Date().toISOString(),
      method: (init.method ?? "GET").toUpperCase(),
      url,
      headers,
      wireHeaders: null,
      wireHeadersNote:
        "No matching undici:client:sendHeaders event was seen for this request — the header block above is the Request-object view only.",
      tokenClaims: decodeBearerClaims(authorization),
    };
    if (typeof init.body === "string" && init.body.length > 0) {
      record.bodyPreview = init.body.slice(0, 2048);
    }
    session.requests.push(record);
    return record.sequence;
  } catch (err) {
    log.debug({ err }, "graph-request-capture: failed to record an outgoing request");
    return null;
  }
}

/** Stamps the real response status onto a record captured by this session. */
export function annotateCapturedResponse(sequence: number | null, status: number): void {
  if (sequence == null) return;
  const session = captureStore.getStore();
  if (!session) return;
  const record = session.requests.find((r) => r.sequence === sequence);
  if (record) record.responseStatus = status;
}

// ── Header reading ────────────────────────────────────────────────────────────

/**
 * The normalized header list for (url, init), read off a throwaway `Request`.
 *
 * Building a Request is what makes this the REAL header set rather than a
 * re-walk of the options object: it applies the same WHATWG normalization
 * `fetch` applies internally (name lowercasing, value trimming, duplicate
 * combining). The object is discarded — it is never dispatched, and constructing
 * it does not consume or mutate `init`.
 *
 * Falls back to walking `init.headers` directly if the Request constructor
 * rejects the pair (e.g. a body on a GET), so a capture is never lost outright.
 */
function readHeaders(url: string, init: RequestInit): CapturedHeader[] {
  try {
    const probe = new Request(url, init);
    return Array.from(probe.headers.entries()).map(([name, value]) => redactHeader(name, value));
  } catch {
    return headersToEntries(init.headers).map(([name, value]) => redactHeader(name, value));
  }
}

function headersToEntries(headers: RequestInit["headers"]): Array<[string, string]> {
  if (!headers) return [];
  if (headers instanceof Headers) return Array.from(headers.entries());
  if (Array.isArray(headers)) return headers.map(([k, v]) => [String(k), String(v)]);
  return Object.entries(headers).map(([k, v]) => [k, String(v)]);
}

function findHeaderValue(headers: RequestInit["headers"], name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [k, v] of headersToEntries(headers)) {
    if (k.toLowerCase() === wanted) return v;
  }
  return null;
}

function redactHeader(name: string, value: string): CapturedHeader {
  if (!REDACTED_HEADERS.has(name.toLowerCase())) return { name, value };
  return { name, value: describeRedactedValue(value), redacted: true };
}

/**
 * Describes a secret header value without revealing it. The SHAPE is kept —
 * scheme and length — because "the Authorization header was present and was a
 * 1487-character bearer JWT" is diagnostically different from "it was missing".
 */
function describeRedactedValue(value: string): string {
  const scheme = value.split(" ")[0] ?? "";
  const isBearer = scheme.toLowerCase() === "bearer";
  return isBearer
    ? `Bearer <redacted — ${value.length - scheme.length - 1} char token; see tokenClaims>`
    : `<redacted — ${value.length} chars>`;
}

// ── Wire headers (undici diagnostics channel) ─────────────────────────────────

/**
 * Matches one `sendHeaders` event to a pending captured record and attaches the
 * raw block.
 *
 * Matched on method + path rather than on async context (see `activeSessions`).
 * The first still-unattached record with the same method and path wins. A
 * simulator bulk run has up to three sessions open at once, but each is a
 * DIFFERENT check hitting a different endpoint, so method+path still identifies
 * one record. The only way to mis-attach is two concurrent sessions issuing the
 * identical method+URL — and since the wire block is then identical too, the
 * attached value is the same either way.
 */
function attachWireHeaders(message: { headers?: unknown }): void {
  if (activeSessions.size === 0) return;
  const raw = typeof message?.headers === "string" ? message.headers : null;
  if (!raw) return;

  const lines = raw.split("\r\n").filter((l) => l.length > 0);
  const requestLine = lines[0];
  if (!requestLine) return;
  const [method, path] = requestLine.split(" ");
  if (!method || !path) return;

  for (const session of activeSessions) {
    for (const record of session.requests) {
      if (record.wireHeaders != null) continue;
      if (record.method !== method.toUpperCase()) continue;
      if (pathOf(record.url) !== path) continue;
      record.wireHeaders = lines.map(redactWireLine);
      delete record.wireHeadersNote;
      return;
    }
  }
}

function pathOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

function redactWireLine(line: string): string {
  const idx = line.indexOf(":");
  if (idx <= 0) return line;
  const name = line.slice(0, idx).trim();
  if (!REDACTED_HEADERS.has(name.toLowerCase())) return line;
  return `${name}: ${describeRedactedValue(line.slice(idx + 1).trim())}`;
}

// ── Token claims ──────────────────────────────────────────────────────────────

/**
 * Decodes the public claim set of a bearer JWT. NO signature verification and
 * none intended — this is a diagnostic view of a token this process just
 * obtained from AAD itself, not a trust decision. Only allowlisted claims are
 * copied out, so a future token shape can't leak something unexpected.
 */
function decodeBearerClaims(authorization: string | null): CapturedTokenClaims | null {
  if (!authorization) return null;
  const token = authorization.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const claims: CapturedTokenClaims = {};
    for (const claim of SURFACED_TOKEN_CLAIMS) {
      if (payload[claim] !== undefined) claims[claim] = payload[claim];
    }
    return Object.keys(claims).length > 0 ? claims : null;
  } catch {
    return null;
  }
}
