// ⚠️ DEBUG-ONLY CODE — never reachable by a real customer ⚠️
//
// lib/debug-console/src/network-recorder.ts  (@workspace/debug-console)
//
// Records the real HTTP + SSE traffic the current page makes, for the floating
// debug panels: msp-portal's testbed-gated Copilot-assessment panel (#279) and
// admin-panel's requireAdmin-gated panel (#285).
//
// It works by patching window.fetch and window.EventSource while a panel is
// mounted. That is deliberate and it is the only way to see a page's *own* real
// traffic without rewriting every client module: pages talk to the server
// through many different call sites (polls, SSE streams, generation clients,
// react-query fetchers …), most going through some fetchWithAuth wrapper but
// some — every EventSource — not.
//
// Because it patches globals, a panel installs it ONLY behind that app's real
// server-side gate: `tenants.isTestbed` in msp-portal, the admin JWT role claim
// `requireAdmin` enforces in admin-panel. install() is reference-counted and
// fully restores the originals on the last uninstall, so React StrictMode's
// double-effect and a remount cannot leave a patch behind or double-record.
//
// Why this is a shared package rather than a copy per app (#285): the redaction
// key list and the body/entry caps below are the security-shaped part of the
// debug console. Two forks of them would silently drift — one app learning
// about a new credential-bearing query param while the other keeps logging it
// verbatim is a real leak, not a cosmetic difference. The panel *chrome* is
// deliberately NOT here: it is app-specific presentation (title, accent, gating
// source, which live state it shows) and each app owns its own.
//
// This module is DOM-only and framework-free — no React import, no app imports.

/** Bodies are truncated at this many characters — big report payloads must not
 *  turn the debug panel into a memory leak. Truncation is always visible in
 *  the recorded entry, never silent. */
const MAX_BODY_CHARS = 20_000;

/** Ring-buffer cap on recorded requests. */
const MAX_ENTRIES = 300;

/** Ring-buffer cap on events kept per SSE stream. */
const MAX_SSE_EVENTS = 200;

export type NetworkEntryState = "pending" | "ok" | "error" | "open" | "closed";

export type SseEvent = {
  at: number;
  type: string;
  /** Parsed JSON payload when the event data was JSON. */
  data?: unknown;
  /** Verbatim event data when it wasn't JSON (or alongside a parse failure). */
  raw?: string;
};

export type NetworkEntry = {
  id: number;
  kind: "fetch" | "sse";
  method: string;
  /** Query-string credentials redacted — see redactUrl. */
  url: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  state: NetworkEntryState;
  status: number | null;
  statusText: string | null;
  requestBody?: unknown;
  requestBodyText?: string;
  responseBody?: unknown;
  responseText?: string;
  truncated?: boolean;
  error?: string;
  /** SSE only. */
  events?: SseEvent[];
};

type Listener = (entries: NetworkEntry[]) => void;

let entries: NetworkEntry[] = [];
let listeners: Listener[] = [];
let nextId = 1;
let installCount = 0;
let recordingStartedAt: number | null = null;

let originalFetch: typeof window.fetch | null = null;
let OriginalEventSource: typeof EventSource | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

export function getNetworkLog(): NetworkEntry[] {
  return entries;
}

/** Epoch ms the recorder started, so the panel can say what window it covers
 *  instead of implying it captured traffic from before it was installed. */
export function getRecordingStartedAt(): number | null {
  return recordingStartedAt;
}

export function subscribeNetworkLog(listener: Listener): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function clearNetworkLog(): void {
  entries = [];
  emit();
}

/** Patches window.fetch/EventSource. Returns the uninstall function. */
export function installNetworkRecorder(): () => void {
  installCount += 1;
  if (installCount === 1) {
    recordingStartedAt = Date.now();
    patch();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    installCount -= 1;
    if (installCount === 0) unpatch();
  };
}

// ── Internals ─────────────────────────────────────────────────────────────────

function emit(): void {
  for (const l of listeners) l(entries);
}

function push(entry: NetworkEntry): NetworkEntry {
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  emit();
  return entry;
}

/** Replaces a live entry in place (by id) and re-emits. Entries are treated as
 *  immutable so React's useSyncExternalStore sees a new reference. */
function update(id: number, patchFields: Partial<NetworkEntry>): void {
  let changed = false;
  entries = entries.map((e) => {
    if (e.id !== id) return e;
    changed = true;
    return { ...e, ...patchFields };
  });
  if (changed) emit();
}

/** Strips credentials that ride in the query string — EventSource cannot set
 *  headers, so this page's SSE URLs carry `?jwt=<real access token>`. Testbed
 *  only or not, a live JWT should not be sitting in a panel someone may screenshot. */
function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, window.location.origin);
    for (const key of ["jwt", "token", "access_token", "accessToken", "apiKey", "api_key"]) {
      if (url.searchParams.has(key)) url.searchParams.set(key, "REDACTED");
    }
    return url.pathname + url.search + url.hash;
  } catch {
    return rawUrl;
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== "string" && !(input instanceof URL)) return input.method.toUpperCase();
  return "GET";
}

/** Parses when it can, keeps the text either way. */
function decodeBody(text: string): { body?: unknown; text: string; truncated: boolean } {
  const truncated = text.length > MAX_BODY_CHARS;
  const kept = truncated ? `${text.slice(0, MAX_BODY_CHARS)}\n…[truncated]` : text;
  try {
    return { body: JSON.parse(text) as unknown, text: kept, truncated };
  } catch {
    return { text: kept, truncated };
  }
}

function patch(): void {
  originalFetch = window.fetch.bind(window);
  OriginalEventSource = window.EventSource;

  const realFetch = originalFetch;

  window.fetch = function recordedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const id = nextId++;
    const startedAt = Date.now();
    const entry: NetworkEntry = {
      id,
      kind: "fetch",
      method: methodOf(input, init),
      url: redactUrl(urlOf(input)),
      startedAt,
      endedAt: null,
      durationMs: null,
      state: "pending",
      status: null,
      statusText: null,
    };
    if (typeof init?.body === "string") {
      const decoded = decodeBody(init.body);
      entry.requestBody = decoded.body;
      entry.requestBodyText = decoded.text;
    }
    push(entry);

    return realFetch(input, init).then(
      (res) => {
        const endedAt = Date.now();
        update(id, {
          endedAt,
          durationMs: endedAt - startedAt,
          state: res.ok ? "ok" : "error",
          status: res.status,
          statusText: res.statusText,
        });

        // Read a clone so the real caller's body stays untouched. Never awaited
        // before returning — recording must not delay the page's own request.
        // Streams (SSE over fetch) are skipped: cloning one would buffer it.
        const contentType = res.headers.get("content-type") ?? "";
        if (res.body && !contentType.includes("text/event-stream")) {
          try {
            void res
              .clone()
              .text()
              .then((text) => {
                const decoded = decodeBody(text);
                update(id, {
                  responseBody: decoded.body,
                  responseText: decoded.text,
                  truncated: decoded.truncated,
                });
              })
              .catch(() => {
                /* body already consumed or unreadable — leave the entry bodiless */
              });
          } catch {
            /* clone() can throw on an already-disturbed body */
          }
        }
        return res;
      },
      (err: unknown) => {
        const endedAt = Date.now();
        update(id, {
          endedAt,
          durationMs: endedAt - startedAt,
          state: "error",
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      },
    );
  } as typeof window.fetch;

  const RealEventSource = OriginalEventSource;

  class RecordedEventSource extends RealEventSource {
    private __entryId: number;
    private __spied = new Set<string>();

    constructor(url: string | URL, init?: EventSourceInit) {
      super(url, init);
      const id = nextId++;
      this.__entryId = id;
      const startedAt = Date.now();
      push({
        id,
        kind: "sse",
        method: "SSE",
        url: redactUrl(typeof url === "string" ? url : url.toString()),
        startedAt,
        endedAt: null,
        durationMs: null,
        state: "pending",
        status: null,
        statusText: null,
        events: [],
      });

      // Spy via the real prototype method so overriding addEventListener below
      // (which is what catches caller-registered custom event names) can't
      // recurse into itself.
      for (const type of ["open", "message", "error"]) this.__spy(type);
    }

    private __spy(type: string): void {
      if (this.__spied.has(type)) return;
      this.__spied.add(type);
      RealEventSource.prototype.addEventListener.call(this, type, (event: Event) => {
        this.__record(type, event);
      });
    }

    private __record(type: string, event: Event): void {
      const at = Date.now();
      const entry = entries.find((e) => e.id === this.__entryId);
      const prior = entry?.events ?? [];
      const data = (event as MessageEvent).data;
      const next: SseEvent = { at, type };
      if (typeof data === "string") {
        try {
          next.data = JSON.parse(data) as unknown;
        } catch {
          next.raw = data.length > MAX_BODY_CHARS ? `${data.slice(0, MAX_BODY_CHARS)}…[truncated]` : data;
        }
      }
      const state: NetworkEntryState = type === "open" ? "open" : type === "error" ? "error" : entry?.state === "closed" ? "closed" : "open";
      update(this.__entryId, {
        events: [...prior, next].slice(-MAX_SSE_EVENTS),
        state,
        ...(type === "open" && entry?.durationMs == null ? { durationMs: at - (entry?.startedAt ?? at) } : {}),
      });
    }

    // Catches custom SSE event names the caller subscribes to (`es.addEventListener("progress", …)`).
    // `es.onmessage = …` / `es.onerror = …` dispatch "message"/"error", already spied above.
    override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
      this.__spy(type);
      if (!listener) return;
      RealEventSource.prototype.addEventListener.call(this, type, listener, options);
    }

    override close(): void {
      const at = Date.now();
      const entry = entries.find((e) => e.id === this.__entryId);
      update(this.__entryId, {
        state: "closed",
        endedAt: at,
        durationMs: at - (entry?.startedAt ?? at),
      });
      super.close();
    }
  }

  window.EventSource = RecordedEventSource as unknown as typeof EventSource;
}

function unpatch(): void {
  if (originalFetch) window.fetch = originalFetch;
  if (OriginalEventSource) window.EventSource = OriginalEventSource;
  originalFetch = null;
  OriginalEventSource = null;
  recordingStartedAt = null;
}
