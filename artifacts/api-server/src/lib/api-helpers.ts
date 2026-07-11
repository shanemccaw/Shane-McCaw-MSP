/**
 * MSP API Helpers
 *
 * Standard error shape, pagination helpers, and response factories for the
 * versioned MSP API surface (`/api/msp/v1/`).
 *
 * Every error response from the MSP API follows this shape:
 *   { error: { code: string; message: string; details?: unknown } }
 *
 * Every success response is the raw payload (or wrapped in { data, meta } for lists).
 */

import type { Request, Response } from "express";

// ── Standard error codes ──────────────────────────────────────────────────────

export const ApiErrorCode = {
  VALIDATION: "VALIDATION_ERROR",
  AUTH: "AUTHENTICATION_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_KEY_CONFLICT",
  INTERNAL: "INTERNAL_SERVER_ERROR",
  WEBHOOK_INVALID_SIGNATURE: "WEBHOOK_INVALID_SIGNATURE",
} as const;

export type ApiErrorCode = typeof ApiErrorCode[keyof typeof ApiErrorCode];

// ── Error response factory ────────────────────────────────────────────────────

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
    traceId?: string;
  };
}

export function apiError(
  res: Response,
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): void {
  const traceId = (res as unknown as { locals?: { traceId?: string } }).locals?.traceId;
  const body: ApiError = { error: { code, message, ...(details !== undefined ? { details } : {}), ...(traceId ? { traceId } : {}) } };
  res.status(status).json(body);
}

// ── Pagination helpers ────────────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  pageSize: number;
  offset: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Parse `page` and `pageSize` from query parameters with safe defaults.
 * Returns validated values; clamps pageSize to [1, 100].
 */
export function parsePagination(query: Request["query"]): PaginationParams {
  const page = Math.max(1, parseInt(String(query["page"] ?? "1"), 10) || 1);
  const rawSize = parseInt(String(query["pageSize"] ?? String(DEFAULT_PAGE_SIZE)), 10) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/**
 * Build a pagination meta block given total record count and the current params.
 */
export function buildPaginationMeta(total: number, params: PaginationParams): PaginationMeta {
  return {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}

/**
 * Wrap a data array in the standard paginated envelope.
 */
export function paginatedResponse<T>(data: T[], total: number, params: PaginationParams): PaginatedResponse<T> {
  return { data, meta: buildPaginationMeta(total, params) };
}

// ── Sorting helpers ───────────────────────────────────────────────────────────

export interface SortParams {
  sortBy: string;
  sortDir: "asc" | "desc";
}

/**
 * Parse `sortBy` and `sortDir` from query parameters.
 * `allowedFields` enforces a whitelist to prevent SQL injection via column names.
 */
export function parseSort(
  query: Request["query"],
  allowedFields: string[],
  defaultField: string,
  defaultDir: "asc" | "desc" = "desc",
): SortParams {
  const rawField = String(query["sortBy"] ?? defaultField);
  const sortBy = allowedFields.includes(rawField) ? rawField : defaultField;
  const rawDir = String(query["sortDir"] ?? defaultDir).toLowerCase();
  const sortDir: "asc" | "desc" = rawDir === "asc" ? "asc" : "desc";
  return { sortBy, sortDir };
}

// ── Filter helpers ────────────────────────────────────────────────────────────

/**
 * Extract a string filter from query params, returning undefined when absent or empty.
 */
export function parseStringFilter(query: Request["query"], key: string): string | undefined {
  const v = String(query[key] ?? "").trim();
  return v.length > 0 ? v : undefined;
}

/**
 * Extract an integer filter from query params, returning undefined when absent or invalid.
 */
export function parseIntFilter(query: Request["query"], key: string): number | undefined {
  const n = parseInt(String(query[key] ?? ""), 10);
  return isNaN(n) ? undefined : n;
}
