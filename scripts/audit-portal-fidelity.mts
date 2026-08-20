/**
 * audit-portal-fidelity.mts — how much of the Customer Portal design is actually built.
 *
 * Run from the REPO ROOT:  npx tsx scripts/audit-portal-fidelity.mts
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The portal-v2 test manifests assert that a testid exists and that some text
 * appears inside it. A page can be 49/49 green and still be missing half its
 * sections, because nothing in that suite compares the page to the design.
 * That gap is not theoretical: three manifests ran fully green against pages
 * carrying as little as 5% of their design copy.
 *
 * ── How it measures ────────────────────────────────────────────────────────
 * Copy in this handoff is FINAL and must not be rewritten, which makes a design
 * string a reliable probe: if a section's text appears nowhere in
 * artifacts/msp-portal/src, that section is not built. For each page section it
 * extracts the visible text nodes and checks each against the whole tree.
 *
 * ── How to read it — the percentage is a FLOOR, not a score ────────────────
 *  • It searches ALL of src concatenated, so a string counts as present even
 *    when it renders on a different page. Real fidelity is therefore <= this.
 *  • It says nothing about LAYOUT. A page can score 100% and still be laid out
 *    wrongly — Overview did, before its six-across row was corrected.
 *  • Text split across JSX elements can read as absent. Spot-check a single
 *    line before acting on it; act on the shape of the whole column.
 *
 * It is a triage instrument for "what has not been rebuilt since the design
 * moved" — the question the manifests cannot answer.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DESIGN = "Design/design_handoff_customer_portal";
const SRC = "artifacts/msp-portal/src";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(e)) out.push(p);
  }
  return out;
}

const HAY = walk(SRC).map((f) => readFileSync(f, "utf8")).join("\n");

/** Collapse whitespace and unescape the entities the design markup uses. */
const norm = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const HAY_N = norm(HAY);

/** Visible text nodes in a slice of design markup. */
function copyStrings(text: string): string[] {
  const out = new Set<string>();
  const re = />([^<>]{12,})</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = norm(m[1]);
    if (!s) continue;
    if (s.includes("{{")) continue; // template expression, not copy
    if (s.includes("font-family:") || s.includes("margin:0")) continue; // inline <style>
    if (!/[a-z]/.test(s)) continue; // not prose
    if (/^[\d\s.,%+\-/]+$/.test(s)) continue; // pure numbers
    out.add(s);
  }
  return [...out];
}

function audit(label: string, designText: string) {
  const strings = copyStrings(designText);
  const missing = strings.filter((s) => !HAY_N.includes(s));
  const pct = strings.length ? Math.round((1 - missing.length / strings.length) * 100) : 100;
  return { label, total: strings.length, missing, pct };
}

const shell = readFileSync(join(DESIGN, "Customer Portal Shell.dc.html"), "utf8").split("\n");
const slice = (a: number, b: number) => shell.slice(a - 1, b - 1).join("\n");

/** Page sections of the shell, by the `sc-if` line each one opens on. */
const SECTIONS: ReadonlyArray<readonly [string, number, number]> = [
  ["Overview", 381, 551],
  ["Governance pillar", 551, 769],
  ["Security pillar", 769, 1001],
  ["Risk Register", 1007, 1231],
  ["Projects", 1231, 1495],
  ["SOPs & Runbooks", 1633, 1981],
  ["My Architect", 1981, 2199],
  ["Account security", 2199, 2371],
  ["Billing", 2371, 2520],
  ["Webhooks", 2520, 2722],
  ["Alert preferences", 2722, 2875],
  ["Health pillar", 2875, 3227],
  ["Adoption pillar", 3227, 3558],
  ["Licensing pillar", 3558, 3864],
  ["Compliance pillar", 3864, 4106],
  ["PII Governance", 4106, 4258],
  ["Security Plan", 4258, 4345],
  ["Settings", 4345, 4578],
  ["Policy Decisions", 4578, 4659],
  ["Compliance gaps", 4659, 4732],
  ["Compliance decisions", 4732, 4783],
  ["Compliance obligations", 4783, 4816],
  ["Security MFA", 4816, 4975],
  ["Security CA", 4975, 5041],
  ["Evidence", 5041, 5204],
  ["Governance drill-down", 5204, 5440],
  ["Overshared SharePoint", 5440, 5508],
  ["Governance list/drift/inventory", 5871, 5961],
  ["Remediation Tracker", 5961, 6013],
  ["Receipt", 6013, 6093],
  ["Copilot", 6093, 6203],
  ["Documents", 6203, 6415],
  ["Active Runbooks", 6415, 6500],
];

const rows = SECTIONS.map(([l, a, b]) => audit(l, slice(a, b)));
for (const f of ["Ownership", "Change Control", "Microsoft Changes"]) {
  rows.push(audit(`${f} (module)`, readFileSync(join(DESIGN, `${f}.dc.html`), "utf8")));
}

rows.sort((x, y) => x.pct - y.pct);

console.log("PAGE".padEnd(34), "COPY".padStart(6), "PRESENT".padStart(8), "MISSING".padStart(8));
console.log("-".repeat(60));
for (const r of rows) {
  console.log(
    r.label.padEnd(34),
    String(r.total).padStart(6),
    `${r.pct}%`.padStart(8),
    String(r.missing.length).padStart(8),
  );
}

const built = rows.filter((r) => r.pct >= 60).length;
console.log(
  `\n${rows.length} design sections · ${built} at 60%+ · ${rows.length - built} substantially unbuilt`,
);

console.log("\n=== MISSING COPY, worst first ===");
for (const r of rows.filter((r) => r.missing.length)) {
  console.log(`\n## ${r.label}  (${r.missing.length} of ${r.total} absent)`);
  for (const s of r.missing.slice(0, 10)) {
    console.log(`   - ${s.length > 140 ? `${s.slice(0, 140)}…` : s}`);
  }
  if (r.missing.length > 10) console.log(`   … and ${r.missing.length - 10} more`);
}
