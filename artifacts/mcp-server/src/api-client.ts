import { apiBaseUrl } from "./env.ts";
import { getAccessToken } from "./auth.ts";

/**
 * A non-2xx answer from the api-server, carrying the real status code and the
 * route's own error body. Tools surface this verbatim through the registry's
 * error path — the model sees the api-server's actual refusal (403 text, 400
 * validation message, …), never a paraphrase.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body: unknown;

  constructor(status: number, path: string, body: unknown) {
    const detail =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : typeof body === "string" && body.length > 0
          ? // Express's default error page is HTML with the real message in a
            // <pre>; surface that text, not the markup.
            (/<pre>([\s\S]*?)<\/pre>/.exec(body)?.[1] ?? body.replace(/<[^>]*>/g, " "))
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 300)
          : "(no error body)";
    super(`API ${status} on ${path}: ${detail}`);
    this.name = "ApiError";
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Query-string params; undefined values are skipped. */
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON body for mutating calls. */
  body?: unknown;
  /** Default true. The rare unauthenticated route (e.g. /healthz) opts out. */
  auth?: boolean;
}

/**
 * The single HTTP path every tool goes through to reach the platform: a real
 * request against the running api-server (never a direct DB read — tools see
 * exactly what the real routes answer, through the real middleware). `path`
 * is the route path as the codebase names it, e.g. "/admin/clients/enriched".
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { method = "GET", query, body, auth = true } = options;

  const url = new URL(apiBaseUrl() + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {};
  if (auth) headers["authorization"] = `Bearer ${await getAccessToken()}`;
  if (body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(
      `api-server unreachable at ${apiBaseUrl()} (${err instanceof Error ? err.message : String(err)}) — is the local dev api-server running?`,
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json")
    ? await res.json()
    : await res.text();

  if (!res.ok) throw new ApiError(res.status, path, payload);
  return payload as T;
}
