// Real federal holidays, refreshed monthly from OPM's own live source (Git #3136).
//
// OPM used to publish `https://www.opm.gov/json/FederalHolidays.json` -- that endpoint is dead
// (confirmed live 2026-09-07: a bare 404 "Page Not Found", not a network block). The real,
// currently-live source is the HTML schedule at
// https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/, which renders one
// `<table class="DataTable HolidayTable"><caption>YYYY Holiday Schedule</caption>...` per year
// (current, next, and historical back to 2011) with one `<tr><td>Weekday, Month DD</td>
// <td>Holiday Name</td></tr>` per holiday. This is a real scrape of that real page, not an
// invented list -- confirmed reachable with a browser user-agent (a bare curl UA gets an Akamai
// 403 on the OPM edge, so the fetch below sends one).

import { many, one } from "../db.mjs";

const OPM_URL = "https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&#8217;|&#39;|&rsquo;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse one `<table class="DataTable HolidayTable">` block into { year, holidays: [{name,
 * observedOn}] }. Pure string parsing (no DOM dependency in this single-`pg`-dependency app) --
 * deliberately tolerant of the footnote `<span>` OPM sometimes appends to the date cell.
 */
export function parseHolidayTable(tableHtml) {
  const captionMatch = tableHtml.match(/<caption>\s*(\d{4})\s*Holiday Schedule\s*<\/caption>/i);
  if (!captionMatch) return null;
  const year = Number(captionMatch[1]);

  const holidays = [];
  const rowRe = /<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(tableHtml))) {
    const dateText = stripTags(m[1]); // e.g. "Monday, January 02", "Monday, February 16 *" (a
    // footnote marker can trail the day number, so the "Month DD" match below is NOT anchored
    // to the string's end -- Git #3136 found this dropping Washington's Birthday/Independence
    // Day, both of which always carry a footnote, from every single year on the real page).
    const name = stripTags(m[2]);
    if (!dateText || !name) continue;
    const dm = dateText.match(/([A-Za-z]+)\s+(\d{1,2})\b/);
    if (!dm) continue;
    const parsed = new Date(`${dm[1]} ${dm[2]}, ${year} 00:00:00`);
    if (Number.isNaN(parsed.getTime())) continue;
    holidays.push({ name, observedOn: parsed.toISOString().slice(0, 10) });
  }
  return { year, holidays };
}

export function parseAllTables(html) {
  const tables = html.match(/<table class="DataTable HolidayTable">[\s\S]*?<\/table>/gi) || [];
  return tables.map(parseHolidayTable).filter(Boolean);
}

/**
 * Fetch and upsert the real current + next year's federal holidays. Re-running updates rows in
 * place (the year+name unique key from migration 014) rather than duplicating -- OPM does
 * occasionally correct an observed-date (the Saturday/Sunday "in lieu of" shift), so "refreshed"
 * has to mean "matches OPM right now," not "inserted once."
 */
export async function refreshFederalHolidays({ fetchImpl = fetch } = {}) {
  const res = await fetchImpl(OPM_URL, { headers: { "user-agent": BROWSER_UA, accept: "text/html" } });
  if (!res.ok) throw new Error(`OPM federal holidays page returned ${res.status}`);
  const html = await res.text();

  const parsed = parseAllTables(html);
  if (parsed.length === 0) throw new Error("OPM federal holidays page did not parse -- its markup may have changed");

  const currentYear = new Date().getFullYear();
  const relevant = parsed.filter((p) => p.year >= currentYear);
  if (relevant.length === 0) throw new Error(`OPM page parsed but had no table for ${currentYear} or later`);

  let written = 0;
  for (const { year, holidays } of relevant) {
    for (const h of holidays) {
      await one(
        `INSERT INTO federal_holidays (year, name, observed_on, source, refreshed_at)
         VALUES ($1, $2, $3, 'opm', now())
         ON CONFLICT (year, name)
         DO UPDATE SET observed_on = EXCLUDED.observed_on, refreshed_at = now()
         RETURNING id`,
        [year, h.name, h.observedOn],
      );
      written++;
    }
  }
  return { years: relevant.map((r) => r.year), count: written };
}

export async function listFederalHolidays({ fromYear = null } = {}) {
  const year = fromYear || new Date().getFullYear();
  return many(
    `SELECT id, year, name, observed_on, source, refreshed_at
       FROM federal_holidays
      WHERE year >= $1
      ORDER BY observed_on`,
    [year],
  );
}

/** True once this month's refresh has genuinely run -- what the monthly housekeeping job checks
 *  before re-fetching, so a redeploy mid-month doesn't hammer OPM on every restart. */
export async function needsMonthlyRefresh() {
  const row = await one(
    `SELECT max(refreshed_at) AS last FROM federal_holidays`,
  );
  if (!row?.last) return true;
  const last = new Date(row.last);
  const now = new Date();
  return last.getUTCFullYear() !== now.getUTCFullYear() || last.getUTCMonth() !== now.getUTCMonth();
}
