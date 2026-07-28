// Zoho read/list passthrough (Zoho Integration Foundation, #82).
//
// Synchronous, paginated list/search reads against Zoho CRM's record APIs for
// live in-app browsing (the Admin Panel CRUD tables land in #83). Per the
// "never leave the platform" principle these reads back page loads directly —
// they are deliberately NOT routed through msp_job_queue: a page waiting on a
// Zoho GET is fine, only writes get deferred to the 5-minute drain.

import { zohoGet } from "./zoho-client.ts";
import { logger } from "./logger";

const log = logger.child({ channel: "integration.zoho" });

export interface ZohoListParams {
  page?: number;
  perPage?: number;
  search?: string;
  mspId?: number;
}

export interface ZohoListResult {
  records: Array<Record<string, unknown>>;
  page: number;
  perPage: number;
  /** Whether Zoho reports more records beyond this page. */
  more: boolean;
}

// Zoho CRM v8 list endpoints require an explicit `fields` param. These are the
// default column sets the Admin Panel tables need; callers wanting more use
// listModuleRecords directly with their own fields.
const MODULE_DEFAULT_FIELDS: Record<string, string> = {
  Leads: "First_Name,Last_Name,Full_Name,Company,Email,Phone,Lead_Status,Lead_Source,Owner,Created_Time,Modified_Time",
  Deals: "Deal_Name,Stage,Amount,Closing_Date,Account_Name,Contact_Name,Pipeline,Owner,Created_Time,Modified_Time",
  Contacts: "First_Name,Last_Name,Full_Name,Email,Phone,Account_Name,Title,Owner,Created_Time,Modified_Time",
  Accounts: "Account_Name,Website,Phone,Industry,Billing_City,Billing_State,Owner,Created_Time,Modified_Time",
};

/** Clamps caller paging input to Zoho's supported ranges (per_page max 200). */
export function normalizeZohoPaging(page?: number, perPage?: number): { page: number; perPage: number } {
  const p = Number.isFinite(page) && (page as number) >= 1 ? Math.floor(page as number) : 1;
  const ppRaw = Number.isFinite(perPage) && (perPage as number) >= 1 ? Math.floor(perPage as number) : 50;
  return { page: p, perPage: Math.min(ppRaw, 200) };
}

/**
 * Generic paginated list/search over one Zoho CRM module. With `search` set it
 * uses Zoho's word search endpoint (`/search?word=`), otherwise the plain
 * record list. Both honour page/per_page; `more` mirrors info.more_records.
 */
export async function listModuleRecords(
  module: string,
  params: ZohoListParams = {},
  fields?: string,
): Promise<ZohoListResult> {
  const { page, perPage } = normalizeZohoPaging(params.page, params.perPage);
  const search = params.search?.trim();

  const path = search
    ? `/crm/v8/${module}/search`
    : `/crm/v8/${module}`;
  const query: Record<string, string | number | undefined> = {
    page,
    per_page: perPage,
    ...(search
      ? { word: search }
      : { fields: fields ?? MODULE_DEFAULT_FIELDS[module] }),
  };

  const body = await zohoGet(path, query, params.mspId);

  const records = Array.isArray(body.data) ? (body.data as Array<Record<string, unknown>>) : [];
  const info = (body.info ?? {}) as Record<string, unknown>;
  const more = info.more_records === true;

  log.debug({ module, page, perPage, search: Boolean(search), count: records.length }, "zoho-read: listed records");
  return { records, page, perPage, more };
}

export async function listLeads(params: ZohoListParams = {}): Promise<ZohoListResult> {
  return listModuleRecords("Leads", params);
}

export async function listDeals(params: ZohoListParams = {}): Promise<ZohoListResult> {
  return listModuleRecords("Deals", params);
}

export async function listContacts(params: ZohoListParams = {}): Promise<ZohoListResult> {
  return listModuleRecords("Contacts", params);
}

export async function listAccounts(params: ZohoListParams = {}): Promise<ZohoListResult> {
  return listModuleRecords("Accounts", params);
}
