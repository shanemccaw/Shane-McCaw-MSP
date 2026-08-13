// artifacts/admin-panel/src/components/SimulatorRequestPanel.tsx
//
// #393 — "Request" panel for the Simulator Studio endpoint view: the LITERAL
// outgoing HTTP request a run made, not a reconstruction of it.
//
// Everything here comes from api-server's graph-request-capture.ts, which
// records the (url, init) pair at the last point before `fetch` inside
// graphFetchForTenant — after auth and after every header the platform adds —
// plus the raw header block undici actually wrote to the socket. Nothing on this
// page is derived from the check's stored config, and nothing is inferred: if a
// header is listed, it was sent.
//
// THE POINT OF THE TWO HEADER LISTS. "Sent by the platform" is what this
// codebase's own code put on the request. "Added by the HTTP client" is the
// difference between that and the wire block — headers no line of this codebase
// sets, injected by Node's fetch implementation (undici) on the way out. That
// difference is the whole reason the panel exists: a header the platform never
// wrote can still be the one Graph rejects the request over.
//
// The bearer token is never shown. Its decoded public claims are, because
// "which app roles did this exact request actually carry?" is the first question
// any permission failure raises and it is answerable from them.

import { useState } from "react";
import { ChevronDown, ChevronRight, Radio } from "lucide-react";

export interface CapturedHeader {
  name: string;
  value: string;
  redacted?: boolean;
}

export interface CapturedGraphRequest {
  sequence: number;
  at: string;
  method: string;
  url: string;
  headers: CapturedHeader[];
  wireHeaders: string[] | null;
  wireHeadersNote?: string;
  tokenClaims: Record<string, unknown> | null;
  bodyPreview?: string;
  responseStatus?: number;
}

/** Header names on the wire block, lowercased. The first line is the request line. */
function wireHeaderNames(wireHeaders: string[]): string[] {
  return wireHeaders
    .slice(1)
    .map((line) => line.slice(0, line.indexOf(":")).trim().toLowerCase())
    .filter((n) => n.length > 0);
}

/**
 * Header names present on the wire that the platform never set. `host` and
 * `connection` are excluded: they are HTTP/1.1 framing, not application headers,
 * and listing them as "injected" would bury the ones that matter.
 */
const FRAMING_HEADERS = new Set(["host", "connection", "content-length", "transfer-encoding"]);

function injectedHeaderNames(req: CapturedGraphRequest): string[] {
  if (!req.wireHeaders) return [];
  const ours = new Set(req.headers.map((h) => h.name.toLowerCase()));
  return wireHeaderNames(req.wireHeaders).filter((n) => !ours.has(n) && !FRAMING_HEADERS.has(n));
}

function wireLineFor(req: CapturedGraphRequest, name: string): string | null {
  if (!req.wireHeaders) return null;
  const match = req.wireHeaders.slice(1).find((l) => l.slice(0, l.indexOf(":")).trim().toLowerCase() === name);
  return match ?? null;
}

function statusTone(status: number | undefined): string {
  if (status == null) return "text-muted-foreground";
  if (status < 300) return "text-emerald-400";
  if (status < 400) return "text-amber-400";
  return "text-destructive";
}

export function SimulatorRequestPanel({
  requests,
  note,
  runStatus,
}: {
  requests: CapturedGraphRequest[] | undefined;
  note?: string;
  runStatus: string | null;
}) {
  const [open, setOpen] = useState(true);

  // The capture is written when the run reaches a terminal state, so an
  // in-flight run legitimately has nothing yet — say which of the two it is
  // rather than showing an empty panel that reads like "no headers were sent".
  const pending = runStatus === "pending" || runStatus === "running";

  return (
    <div className="mt-3 rounded border border-border bg-card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Radio className="h-3 w-3" />
        Request — what actually went out
        {requests && requests.length > 1 && (
          <span className="ml-1 rounded-sm border border-border px-1 font-mono text-[9px] normal-case tracking-normal">
            {requests.length} requests
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-border p-2">
          {!requests || requests.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {pending
                ? "Captured when the run finishes."
                : runStatus == null
                  ? "Run this endpoint to capture the real outgoing request."
                  : "No outgoing request was captured for this run — either it never reached the Graph fetch (a script-backed check, or a failure before the request was built), or the run predates this capture."}
            </p>
          ) : (
            <div className="space-y-3">
              {requests.map((req) => (
                <RequestEntry key={req.sequence} req={req} multiple={requests.length > 1} />
              ))}
              {note && <p className="text-[10px] text-amber-400">{note}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RequestEntry({ req, multiple }: { req: CapturedGraphRequest; multiple: boolean }) {
  const injected = injectedHeaderNames(req);

  return (
    <div className="rounded border border-border bg-background p-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px]">
        {multiple && (
          <span className="rounded-sm border border-border px-1 font-mono text-muted-foreground">#{req.sequence}</span>
        )}
        <span className="font-mono font-semibold text-foreground">{req.method}</span>
        <span className={`font-mono ${statusTone(req.responseStatus)}`}>
          {req.responseStatus != null ? `→ ${req.responseStatus}` : "→ no response"}
        </span>
        <span className="text-muted-foreground">{req.at}</span>
      </div>

      <div className="mb-2 break-all rounded border border-border bg-card px-2 py-1 font-mono text-[10px] text-foreground">
        {req.url}
      </div>

      {/* Headers this codebase set, as normalized by fetch. */}
      <HeaderBlock title="Sent by the platform">
        {req.headers.map((h) => (
          <div key={h.name} className="break-all">
            <span className="text-primary">{h.name}</span>
            <span className="text-muted-foreground">: </span>
            <span className={h.redacted ? "italic text-muted-foreground" : "text-foreground"}>{h.value}</span>
          </div>
        ))}
      </HeaderBlock>

      {/* The difference between the two lists — the answer to "does anything add
          headers we never set?". Called out first because it is what a request
          nobody can explain from the source usually turns on. */}
      {injected.length > 0 && (
        <div className="mt-2 rounded border border-amber-600/40 bg-amber-600/5 p-1.5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
            Added by the HTTP client — not set anywhere in this codebase
          </div>
          <div className="space-y-0.5 font-mono text-[10px]">
            {injected.map((name) => (
              <div key={name} className="break-all text-amber-300">
                {wireLineFor(req, name) ?? name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The literal bytes. */}
      {req.wireHeaders ? (
        <HeaderBlock title="Raw header block written to the socket">
          {req.wireHeaders.map((line, i) => (
            <div key={i} className="break-all text-muted-foreground">
              {line}
            </div>
          ))}
        </HeaderBlock>
      ) : (
        req.wireHeadersNote && <p className="mt-2 text-[10px] text-muted-foreground">{req.wireHeadersNote}</p>
      )}

      {req.tokenClaims && (
        <HeaderBlock title="Bearer token claims (decoded, not verified — the token itself is never shown)">
          {Object.entries(req.tokenClaims).map(([claim, value]) => (
            <div key={claim} className="break-all">
              <span className="text-primary">{claim}</span>
              <span className="text-muted-foreground">: </span>
              <span className="text-foreground">
                {Array.isArray(value) ? value.join(", ") : String(value)}
              </span>
            </div>
          ))}
        </HeaderBlock>
      )}

      {req.bodyPreview && (
        <HeaderBlock title="Request body">
          <div className="whitespace-pre-wrap break-all text-foreground">{req.bodyPreview}</div>
        </HeaderBlock>
      )}
    </div>
  );
}

function HeaderBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="space-y-0.5 rounded border border-border bg-card px-2 py-1 font-mono text-[10px]">{children}</div>
    </div>
  );
}
