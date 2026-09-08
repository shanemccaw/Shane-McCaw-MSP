// Real matching logic (the second of #3243's explicitly-flagged open questions) --
// answered here rather than assumed, and kept in one place so it is the same function
// the content script filters with and the one this file's own node-runnable test asserts
// against (see bin/test-site-match.mjs).
//
// A vault "login" entry's `site` field is free text Shane typed when he created the row --
// sometimes a bare domain ("chase.com"), sometimes a service name ("Chase"), sometimes a
// full URL he pasted. The page being autofilled only ever offers a real hostname
// (`location.hostname`). This is deliberately a loose, case-insensitive, both-ways
// substring match on normalised text, not an exact-domain lookup -- the same real
// trade-off #3242's own weekly-ad-verdict matching already made for the same reason
// (one side is free text, the other is a fixed real value) and the same one #3242's own
// vault search already applies (label/site/username substring, both ways).
//
// Deliberately NOT attempted here: public-suffix-list-aware "registrable domain" parsing.
// That is real complexity (a whole datafile) this repo has never pulled in for a project
// that runs with zero UI dependencies by design (see the shanes-life README's own "no
// framework, no build step" section) -- and a plain substring match already gets the one
// case that actually matters (does "chase.com" get suggested on "chase.com" / "www.chase.com"
// / "secure.chase.com") without it.

/** Strips a leading "www." and any protocol, lower-cases, and trims -- the same shape
 *  whether the input came from `location.hostname` or a site field like "https://Chase.com". */
export function normaliseHost(raw) {
  if (!raw) return "";
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "") // strip a scheme if one was pasted into `site`
    .replace(/\/.*$/, "") // strip any path/query that came along with a pasted URL
    .replace(/^www\./, "")
    // A `label` like "American Express" has no real hostname equivalent with spaces in it --
    // stripping whitespace is what lets a plain-English label still substring-match
    // "americanexpress.com". A real hostname never had a space to begin with, so this is a
    // no-op on that side of every comparison.
    .replace(/\s+/g, "");
}

/**
 * True if `entrySite` (a vault entry's free-text site/label) plausibly refers to the same
 * real service as `pageHostname` (the tab's real, live hostname). Both directions are
 * checked because a short service name ("Chase") is a substring of the hostname
 * ("chase.com"), while a hostname with a subdomain ("secure.chase.com") needs the entry's
 * own text to be the substring instead.
 */
export function matchesSite(entrySite, pageHostname) {
  const site = normaliseHost(entrySite);
  const host = normaliseHost(pageHostname);
  if (!site || !host) return false;
  // A bare one/two-letter fragment ("co", "io") would substring-match almost anything --
  // real services are never that short, so this is a deliberate floor, not an arbitrary one.
  if (site.length < 3) return false;
  return host.includes(site) || site.includes(host);
}

/** Filters a masked vault entries list (as returned by GET /api/vault) down to the ones
 *  worth suggesting for this page. `label` is checked too -- Shane's own label ("Chase Visa")
 *  is at least as likely to name the real service as the `site` field is. */
export function findMatches(entries, pageHostname) {
  return entries.filter(
    (entry) =>
      entry.kind === "login" &&
      (matchesSite(entry.site, pageHostname) || matchesSite(entry.label, pageHostname)),
  );
}
