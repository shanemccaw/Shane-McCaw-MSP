/**
 * Every network call the Services screen makes.
 *
 * No new backend was written for this screen — `admin-services.ts` already is
 * the Products Catalog `CLAUDE.md` points at. Each wrapper names the route and
 * surfaces the server's own error text (a slug collision, a delete blocked by
 * a live contract) rather than a generic one, the same reasoning as
 * `endpointsApi.ts`.
 */

import { parseService, toUpdatePayload, type Service } from "./servicesTypes";

export type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : fallback;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

function json(adminFetch: AdminFetch, path: string, method: string, payload?: unknown): Promise<Response> {
  return adminFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
}

/** `GET /api/admin/services` — every product in the catalog. */
export async function listServices(adminFetch: AdminFetch): Promise<Service[]> {
  const res = await adminFetch("/api/admin/services");
  const data = await readJson<unknown[]>(res, "Failed to load the catalog");
  return Array.isArray(data) ? data.map((r) => parseService(r as Record<string, unknown>)) : [];
}

/** `POST /api/admin/services` — `name` and `slug` are the only required fields; everything else defaults. */
export async function createService(
  adminFetch: AdminFetch,
  input: { name: string; slug: string },
): Promise<Service> {
  const res = await json(adminFetch, "/api/admin/services", "POST", input);
  const data = await readJson<Record<string, unknown>>(res, "Failed to create the service");
  return parseService(data);
}

/**
 * `PUT /api/admin/services/:id` — always the FULL record via `toUpdatePayload`.
 * See that function's doc comment for why a partial patch is unsafe here.
 */
export async function updateService(adminFetch: AdminFetch, service: Service): Promise<Service> {
  const res = await json(adminFetch, `/api/admin/services/${service.id}`, "PUT", toUpdatePayload(service));
  const data = await readJson<Record<string, unknown>>(res, "Failed to save the service");
  return parseService(data);
}

/**
 * `DELETE /api/admin/services/:id`. 409s with a real explanation when the
 * service is referenced by a client assignment, contract or workflow template
 * — surfaced verbatim by `readJson`, not replaced with a generic refusal.
 */
export async function deleteService(adminFetch: AdminFetch, id: number): Promise<void> {
  const res = await adminFetch(`/api/admin/services/${id}`, { method: "DELETE" });
  if (res.status === 204) return;
  await readJson<unknown>(res, "Failed to delete the service");
}

/** `POST /api/admin/services/:id/generate-pdf`. */
export async function generateServicePdf(adminFetch: AdminFetch, id: number): Promise<{ pdfUrl: string }> {
  const res = await json(adminFetch, `/api/admin/services/${id}/generate-pdf`, "POST");
  return readJson<{ pdfUrl: string }>(res, "Failed to generate the PDF");
}

/** `GET /api/admin/catalog/export` — the whole catalog as JSON, for "Export the catalog". */
export async function exportCatalog(adminFetch: AdminFetch): Promise<unknown> {
  const res = await adminFetch("/api/admin/catalog/export");
  return readJson<unknown>(res, "Failed to export the catalog");
}
