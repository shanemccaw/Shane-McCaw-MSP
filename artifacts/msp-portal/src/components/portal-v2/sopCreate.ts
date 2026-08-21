/**
 * sopCreate.ts — the one place the customer portal authors a new SOP.
 *
 * The New menu's "Procedure · Write an SOP or runbook for your team" opens the
 * shared FormDrawer; on submit this maps the drawer's values to the body
 * `POST /api/portal/sops` accepts (api-server `routes/portal-sops.ts`) and posts
 * it. The mirror of `ccCreateChangeRequest.ts` for the SOP side.
 *
 * ── A DEFINITION, never an execution ────────────────────────────────────────
 * The route writes a manual, non-runnable procedure definition — `automationType`
 * is forced `"manual"` server-side and no step carries a `graphEndpoint`, so the
 * SOP can never start anything against the tenant (that path stays behind the
 * change-control gate). The success copy the caller shows reflects that: the
 * procedure is saved to the library as the customer's own reference, not queued
 * to run. Nothing authority-bearing is sent — `sopId`/`code`/`version`/author are
 * all assigned by the server from the caller's own identity.
 */

/** Exactly the fields `authorSopSchema` in `routes/portal-sops.ts` accepts. */
export interface AuthorSopInput {
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly estimatedMinutes?: number;
  readonly steps: ReadonlyArray<{ readonly title: string; readonly description?: string }>;
}

/** The route's 201 body. */
export interface SopCreated {
  readonly id: number;
  readonly sopId: string;
  readonly code: string;
}

export type AuthorSopResult =
  | { readonly ok: true; readonly created: SopCreated }
  | { readonly ok: false; readonly error: string };

/**
 * The FormDrawer's field values → the create body. Steps are one-per-line free
 * text (the drawer is a single textarea, mirroring the design's own "steps" field
 * on the SOP author form), each line becoming a manual step title. Blank lines are
 * dropped so a trailing newline does not create an empty step the route rejects.
 */
export function sopBodyFromNewMenu(values: Record<string, string>): AuthorSopInput {
  const stepLines = (values.steps ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const minutes = Number.parseInt((values.estimatedMinutes ?? "").trim(), 10);

  return {
    title: (values.title ?? "").trim(),
    description: (values.description ?? "").trim(),
    category: (values.category ?? "").trim(),
    estimatedMinutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : undefined,
    steps: stepLines.map((line) => ({ title: line })),
  };
}

type FetchWithAuth = (
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: { silent?: boolean },
) => Promise<Response>;

const SOPS_URL = "/api/portal/sops";

/**
 * POST a create body through the real route and return a discriminated result.
 * `{ silent: true }` for the same reason `postChangeRequest` uses it — the caller
 * renders the outcome in the drawer, not a toast that outlives it.
 */
export async function postSop(
  fetchWithAuth: FetchWithAuth,
  input: AuthorSopInput,
): Promise<AuthorSopResult> {
  try {
    const res = await fetchWithAuth(
      SOPS_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      { silent: true },
    );
    if (res.status === 201) {
      const created = (await res.json()) as SopCreated;
      return { ok: true, created };
    }
    let error = `The procedure could not be saved (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body && typeof body.error === "string" && body.error.trim()) error = body.error;
    } catch {
      /* non-JSON body — keep the status-coded message */
    }
    return { ok: false, error };
  } catch {
    return {
      ok: false,
      error: "The procedure could not be saved. Check your connection and try again.",
    };
  }
}
