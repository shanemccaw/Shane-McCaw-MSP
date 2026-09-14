/**
 * Fetch helpers for the 3 public, unauthenticated Public Share Pages routes
 * (#4001, Feature #1663). Plain `fetch` — no `fetchWithAuth` — these pages
 * have no session and no auth context by design; the share token itself is
 * the only credential (contract pack §1–§4).
 */
import type {
  ApiErrorBody,
  LiveDocumentShareSet,
  PublicMspSow,
  PublicSharedDocument,
} from "./public-share-types";

export type ShareFetchErrorKind = "not_found" | "expired" | "revoked" | "unknown";

export class ShareFetchError extends Error {
  readonly kind: ShareFetchErrorKind;
  readonly serverMessage: string | undefined;

  constructor(kind: ShareFetchErrorKind, serverMessage?: string) {
    super(serverMessage ?? kind);
    this.kind = kind;
    this.serverMessage = serverMessage;
  }
}

async function readErrorMessage(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as ApiErrorBody;
    return body?.error;
  } catch {
    return undefined;
  }
}

export async function fetchPublicDocument(shareToken: string): Promise<PublicSharedDocument> {
  const res = await fetch(`/api/public/documents/${encodeURIComponent(shareToken)}`);
  if (res.status === 410) throw new ShareFetchError("expired", await readErrorMessage(res));
  if (!res.ok) throw new ShareFetchError("not_found", await readErrorMessage(res));
  return (await res.json()) as PublicSharedDocument;
}

export function recordDocumentDwell(shareToken: string, dwellSeconds: number): void {
  const body = JSON.stringify({ dwellSeconds });
  const url = `/api/public/documents/${encodeURIComponent(shareToken)}/doc-views`;
  if (navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
  } else {
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(
      () => {},
    );
  }
}

export async function fetchLiveDocumentShare(token: string): Promise<LiveDocumentShareSet> {
  const res = await fetch(`/api/public/live-document-shares/${encodeURIComponent(token)}`);
  if (res.status === 410) throw new ShareFetchError("revoked", await readErrorMessage(res));
  if (!res.ok) throw new ShareFetchError("not_found", await readErrorMessage(res));
  return (await res.json()) as LiveDocumentShareSet;
}

export async function fetchPublicSow(shareToken: string): Promise<PublicMspSow> {
  const res = await fetch(`/api/public/sows/${encodeURIComponent(shareToken)}`);
  if (res.status === 410) throw new ShareFetchError("expired", await readErrorMessage(res));
  if (!res.ok) throw new ShareFetchError("not_found", await readErrorMessage(res));
  return (await res.json()) as PublicMspSow;
}

export async function signPublicSow(
  shareToken: string,
  signerName: string,
  signatureData: string,
): Promise<{ ok: true; status: "signed" }> {
  const res = await fetch(`/api/public/sows/${encodeURIComponent(shareToken)}/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signerName, signatureData }),
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(message ?? `Failed to sign (${res.status})`);
  }
  return (await res.json()) as { ok: true; status: "signed" };
}
