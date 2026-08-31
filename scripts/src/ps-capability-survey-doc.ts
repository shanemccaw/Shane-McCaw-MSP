/**
 * ps-capability-survey-doc.ts — regenerates `docs/powershell-capability-survey.md`
 * from `ps_capability_survey_results` (Git #1793).
 *
 * The markdown is a RENDERING of the tables, never a second source of truth.
 * That is the whole reason #1793 asked for the survey to be persisted as well
 * as written up: a hand-maintained table goes stale the moment the container,
 * the tenant's licensing, or the app's role assignments change, and a stale
 * capability table is worse than none — it produces confident false negatives.
 * Re-run the survey, re-run this, and the document is current by construction.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run ps-capability-survey-doc
 *   pnpm --filter @workspace/scripts run ps-capability-survey-doc -- --run 3
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const OUT_FILE = path.join(REPO_ROOT, "docs", "powershell-capability-survey.md");

function loadEnvLocal(): void {
  const file = path.join(REPO_ROOT, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key]) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadEnvLocal();

interface RunRow {
  id: number;
  customer_id: number;
  organization: string;
  container_revision: string | null;
  container_image: string | null;
  status: string;
  notes: string | null;
  started_at: Date;
  completed_at: Date | null;
}

interface ResultRow {
  session_type: string;
  module_name: string | null;
  cmdlet_name: string;
  verb: string | null;
  status: string;
  reason: string | null;
  error_message: string | null;
  item_count: number | null;
  elapsed_ms: number | null;
  invoked_with: string | null;
  output_type_name: string | null;
  property_names: string[] | null;
  min_mandatory_param_count: number | null;
  mandatory_param_names: string[] | null;
  derived_property_names: string[] | null;
  derived_from_m365dsc_resources: string[] | null;
  shape_derivation: string | null;
  derivation_gap_reason: string | null;
}

/** Pipe and newline are the only characters that can break a GFM table cell. */
function cell(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const STATUS_ORDER = [
  "ok",
  "access_denied",
  "cmdlet_unavailable",
  "not_supported_app_only",
  "throttled",
  "error",
  "auth_failed",
  "not_attempted",
];

function sortStatuses(a: string, b: string): number {
  const ai = STATUS_ORDER.indexOf(a);
  const bi = STATUS_ORDER.indexOf(b);
  return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runArg = args.includes("--run") ? Number(args[args.indexOf("--run") + 1]) : null;

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Without an explicit --run, the newest COMPLETED run is used, never merely
    // the newest. A run that aborted part-way has a real, partial row set; if
    // this document rendered one it would report every unreached cmdlet as
    // absent, which reads as "doesn't work" — the false-negative table #1793
    // exists to prevent.
    const { rows: runs } = await pool.query<RunRow>(
      runArg
        ? `SELECT * FROM ps_capability_survey_runs WHERE id = $1`
        : `SELECT * FROM ps_capability_survey_runs WHERE status = 'completed' ORDER BY started_at DESC LIMIT 1`,
      runArg ? [runArg] : [],
    );
    if (runs.length === 0) {
      throw new Error(
        "no COMPLETED survey run found — run ps-capability-survey first, or pass --run <id> to render a specific (possibly incomplete) run",
      );
    }
    const run = runs[0];

    const { rows: results } = await pool.query<ResultRow>(
      `SELECT session_type, module_name, cmdlet_name, verb, status, reason, error_message,
              item_count, elapsed_ms, invoked_with, output_type_name, property_names,
              min_mandatory_param_count, mandatory_param_names,
              derived_property_names, derived_from_m365dsc_resources, shape_derivation,
              derivation_gap_reason
         FROM ps_capability_survey_results
        WHERE run_id = $1
        ORDER BY session_type, cmdlet_name`,
      [run.id],
    );

    const sessions = [...new Set(results.map((r) => r.session_type))].sort();
    const out: string[] = [];

    out.push("# PowerShell app-only capability survey");
    out.push("");
    out.push(
      "**Generated from the database, not written by hand.** Every row below is one live execution " +
        "against a real tenant through the `ps-execution` container. Regenerate with " +
        "`pnpm --filter @workspace/scripts run ps-capability-survey-doc` after any re-run; the source of " +
        "truth is `ps_capability_survey_results`, and this file is a rendering of it (Git #1793).",
    );
    out.push("");
    out.push("## Run provenance");
    out.push("");
    out.push("| | |");
    out.push("|---|---|");
    out.push(`| Survey run | \`#${run.id}\` (\`ps_capability_survey_runs.id\`) |`);
    out.push(`| Tenant | \`tenants.id = ${run.customer_id}\` — \`${cell(run.organization)}\` |`);
    out.push(`| Container revision | \`${cell(run.container_revision)}\` |`);
    out.push(`| Container image | \`${cell(run.container_image)}\` |`);
    out.push(`| Started | ${run.started_at.toISOString()} |`);
    out.push(`| Completed | ${run.completed_at ? run.completed_at.toISOString() : "— (run did not complete)"} |`);
    out.push(`| Run status | \`${run.status}\` |`);
    out.push("");
    out.push(
      "The surveyed tenant is Shane's real production Microsoft 365 tenant with write-back consent armed. " +
        "The survey therefore executes **`Get-*` only**, never passes a caller-supplied parameter to a probed " +
        "cmdlet, and records **property names only — never property values**. What it stores is a schema of " +
        "the execution surface, not an extract of tenant data.",
    );
    out.push("");

    // ── Totals ──────────────────────────────────────────────────────────────
    out.push("## Totals by session type");
    out.push("");
    const allStatuses = [...new Set(results.map((r) => r.status))].sort(sortStatuses);
    out.push(`| Session | Commands enumerated | ${allStatuses.map((s) => `\`${s}\``).join(" | ")} |`);
    out.push(`|---|---:|${allStatuses.map(() => "---:").join("|")}|`);
    for (const session of sessions) {
      const rows = results.filter((r) => r.session_type === session);
      const counts = allStatuses.map((s) => rows.filter((r) => r.status === s).length);
      out.push(`| \`${session}\` | ${rows.length} | ${counts.join(" | ")} |`);
    }
    const totalCounts = allStatuses.map((s) => results.filter((r) => r.status === s).length);
    out.push(`| **all** | **${results.length}** | ${totalCounts.map((c) => `**${c}**`).join(" | ")} |`);
    out.push("");
    out.push("Outcome vocabulary, as recorded:");
    out.push("");
    out.push("| Status | Means |");
    out.push("|---|---|");
    out.push("| `ok` | Executed successfully under app-only certificate auth. Its real output shape was captured. |");
    out.push("| `access_denied` | Ran, and the service refused it — a permission/RBAC gap, not an auth failure. |");
    out.push("| `cmdlet_unavailable` | A real `CommandNotFoundException`: never registered into this tenant's session at all (licensing **or** role-provisioning gap — the container cannot tell those apart, see #250). |");
    out.push("| `not_supported_app_only` | The service explicitly rejected the application context / certificate auth for this cmdlet. |");
    out.push("| `throttled` | Rejected by Microsoft's own throttling or cmdlet-budget limits. |");
    out.push("| `error` | Threw for some other reason. The verbatim message is in the table. |");
    out.push("| `auth_failed` | The session itself could not be established, so nothing under it was measured. |");
    out.push("| `not_attempted` | Deliberately never executed. The exact gate that rejected it is recorded per row. |");
    out.push("");

    // ── The working surface ─────────────────────────────────────────────────
    out.push("## Cmdlets that work app-only (`ok`)");
    out.push("");
    out.push(
      "`Items` is the count returned by this one probe against this one tenant — a property of the tenant, " +
        "not of the cmdlet, and it is **not** evidence that a cmdlet returning 0 is broken. `Output properties` " +
        "is the real shape, and is the column #1795's resource model reads.",
    );
    out.push("");
    for (const session of sessions) {
      const rows = results.filter((r) => r.session_type === session && r.status === "ok");
      out.push(`### \`${session}\` — ${rows.length} working`);
      out.push("");
      if (rows.length === 0) {
        out.push("_None._");
        out.push("");
        continue;
      }
      out.push("| Cmdlet | Items | ms | Invoked with | Output type | Output properties |");
      out.push("|---|---:|---:|---|---|---|");
      for (const r of rows) {
        const props = r.property_names ?? [];
        const propText = props.length === 0 ? "— (returned no items, so no shape observed)" : truncate(props.join(", "), 700);
        out.push(
          `| \`${cell(r.cmdlet_name)}\` | ${r.item_count ?? "—"} | ${r.elapsed_ms ?? "—"} | ${cell(r.invoked_with)} | ${cell(r.output_type_name ? r.output_type_name.replace(/^Deserialized\./, "") : null)} | ${cell(propText)} |`,
        );
      }
      out.push("");
    }

    // ── Git #1853: DSC-derived shapes for the shapeless `ok` cmdlets ─────────
    // A NEW section, appended rather than edited into the table above (Shane's
    // instruction on #1853: record corrected coverage as a new section, not by
    // editing prior reasoning). The "— (returned no items, so no shape observed)"
    // cells above are untouched and still literally true — this section adds a
    // second, clearly-labelled source of shape for the same rows.
    const okRows = results.filter((r) => r.status === "ok");
    const shapeless = okRows.filter((r) => (r.property_names ?? []).length === 0);
    const derived = shapeless.filter((r) => r.shape_derivation === "derived_from_dsc");
    const gapped = shapeless.filter((r) => r.derivation_gap_reason);

    out.push("## DSC-derived shapes for shapeless cmdlets (Git #1853)");
    out.push("");
    out.push(
      `Of the ${shapeless.length} \`ok\` cmdlets above with no live-observed shape (the tenant genuinely ` +
        "has zero instances of that resource), Shane's recorded decision on #1853 was to derive a property " +
        "set for as many as possible from Microsoft365DSC's own resource definitions — **matched, never " +
        "guessed**: only an exact cmdlet-name match against a DSC resource's declared read cmdlets counts, " +
        "never a similarly-named resource or a family resemblance. A DSC-derived shape is a DIFFERENT " +
        "epistemic state from an observed one and is labelled `derived_from_dsc` everywhere it is stored — " +
        "it is never written into `property_names` and never overrides a live observation.",
    );
    out.push("");
    out.push(
      "**Real match rate — not 130 of 130.** " +
        `${derived.length} of ${shapeless.length} (${((derived.length / (shapeless.length || 1)) * 100).toFixed(1)}%) ` +
        "matched a Microsoft365DSC resource with a real, non-connection property set. " +
        `${gapped.length} did not, and are recorded below with the exact reason rather than left silently unlabeled.`,
    );
    out.push("");
    out.push("| Session | Shapeless | DSC-derived | No match |");
    out.push("|---|---:|---:|---:|");
    for (const session of sessions) {
      const s = shapeless.filter((r) => r.session_type === session);
      const d = derived.filter((r) => r.session_type === session);
      const g = gapped.filter((r) => r.session_type === session);
      out.push(`| \`${session}\` | ${s.length} | ${d.length} | ${g.length} |`);
    }
    out.push(`| **all** | **${shapeless.length}** | **${derived.length}** | **${gapped.length}** |`);
    out.push("");

    out.push("### Cmdlets with a DSC-derived shape");
    out.push("");
    if (derived.length === 0) {
      out.push("_None._");
      out.push("");
    } else {
      out.push("| Session | Cmdlet | Source DSC resource(s) | Derived properties |");
      out.push("|---|---|---|---|");
      for (const r of derived) {
        const resources = (r.derived_from_m365dsc_resources ?? []).join(", ");
        const props = truncate((r.derived_property_names ?? []).join(", "), 700);
        out.push(`| \`${r.session_type}\` | \`${cell(r.cmdlet_name)}\` | ${cell(resources)} | ${cell(props)} |`);
      }
      out.push("");
    }

    out.push("### Cmdlets with no DSC match — the honest gap");
    out.push("");
    out.push(
      "Every row here was checked against Microsoft365DSC's full read-cmdlet catalog and genuinely has no " +
        "match. Not inferred, not left blank — recorded.",
    );
    out.push("");
    if (gapped.length === 0) {
      out.push("_None._");
      out.push("");
    } else {
      out.push("| Session | Cmdlet | Reason |");
      out.push("|---|---|---|");
      for (const r of gapped) {
        out.push(`| \`${r.session_type}\` | \`${cell(r.cmdlet_name)}\` | ${cell(truncate(r.derivation_gap_reason ?? "", 300))} |`);
      }
      out.push("");
    }

    // ── Executed but failed ─────────────────────────────────────────────────
    out.push("## Cmdlets that were executed and failed");
    out.push("");
    out.push("Verbatim service messages, truncated only for width. These are real observations, not inferences.");
    out.push("");
    for (const session of sessions) {
      const rows = results.filter(
        (r) => r.session_type === session && !["ok", "not_attempted"].includes(r.status),
      );
      out.push(`### \`${session}\` — ${rows.length} failed`);
      out.push("");
      if (rows.length === 0) {
        out.push("_None._");
        out.push("");
        continue;
      }
      out.push("| Cmdlet | Status | ms | Verbatim message |");
      out.push("|---|---|---:|---|");
      for (const r of [...rows].sort((a, b) => sortStatuses(a.status, b.status) || a.cmdlet_name.localeCompare(b.cmdlet_name))) {
        out.push(
          `| \`${cell(r.cmdlet_name)}\` | \`${r.status}\` | ${r.elapsed_ms ?? "—"} | ${cell(truncate(r.error_message ?? r.reason ?? "", 400))} |`,
        );
      }
      out.push("");
    }

    // ── Unknowns ────────────────────────────────────────────────────────────
    out.push("## Unknowns — what this survey did NOT establish");
    out.push("");
    out.push(
      "Every cmdlet in this section was **never executed**, so its app-only behaviour is genuinely unknown. " +
        "None of it should be read as \"does not work\" — that is exactly the false-negative failure #1793 warns " +
        "a careless survey produces.",
    );
    out.push("");

    const notAttempted = results.filter((r) => r.status === "not_attempted");
    const byReason = new Map<string, ResultRow[]>();
    for (const r of notAttempted) {
      const key = r.reason ?? "(no reason recorded — this is a defect)";
      // Collapse the per-cmdlet parameter list out of the mandatory-parameter
      // reason so the grouping stays legible; the names stay on the row.
      const normalized = key.replace(/\[[^\]]*\]/, "[…]");
      if (!byReason.has(normalized)) byReason.set(normalized, []);
      byReason.get(normalized)!.push(r);
    }

    out.push("| Not attempted because | Count |");
    out.push("|---|---:|");
    for (const [reason, rows] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
      out.push(`| ${cell(reason)} | ${rows.length} |`);
    }
    out.push("");

    out.push("### The one deliberate, load-bearing exclusion: `Test-*`");
    out.push("");
    out.push(
      "#1793 names `Test-*` a read verb. This survey excludes it anyway, and that is a judgement call worth " +
        "stating plainly rather than burying: several `ExchangeOnlineManagement` `Test-*` cmdlets are not reads. " +
        "`Test-Mailflow` sends a real probe message through the live transport pipeline. " +
        "`Test-MigrationServerAvailability` opens an outbound connection to a third-party host. " +
        "`Test-OAuthConnectivity` performs a live token exchange. Against Shane's real production tenant, the " +
        "verb alone cannot separate those from a genuine read, so the whole verb fails the issue's own " +
        "\"read-safety establishable from the cmdlet's own help output\" bar and is recorded `not_attempted`. " +
        "Establishing app-only support for individual `Test-*` cmdlets needs a per-cmdlet read of Microsoft's " +
        "documentation and is deliberately left as follow-up work.",
    );
    out.push("");

    const testRows = notAttempted.filter((r) => r.verb === "Test");
    out.push(`There are **${testRows.length}** such cmdlets across all session types:`);
    out.push("");
    for (const session of sessions) {
      const names = testRows.filter((r) => r.session_type === session).map((r) => `\`${r.cmdlet_name}\``);
      if (names.length === 0) continue;
      out.push(`- **\`${session}\`** (${names.length}): ${names.join(", ")}`);
    }
    out.push("");

    out.push("### Cmdlets requiring a mandatory parameter");
    out.push("");
    out.push(
      "These are read cmdlets that could not be probed without inventing a target value — and inventing input " +
        "is precisely the fabrication this project forbids. Their app-only behaviour is reachable, but only with " +
        "a real identity supplied from tenant data the survey deliberately does not read.",
    );
    out.push("");
    const mandatoryRows = notAttempted.filter((r) => (r.min_mandatory_param_count ?? 0) > 0 && r.verb === "Get");
    if (mandatoryRows.length === 0) {
      out.push("_None._");
    } else {
      out.push("| Session | Cmdlet | Mandatory parameters |");
      out.push("|---|---|---|");
      for (const r of mandatoryRows) {
        out.push(`| \`${r.session_type}\` | \`${cell(r.cmdlet_name)}\` | ${cell((r.mandatory_param_names ?? []).join(", "))} |`);
      }
    }
    out.push("");

    out.push("### Full `not_attempted` list");
    out.push("");
    out.push("| Session | Cmdlet | Reason |");
    out.push("|---|---|---|");
    for (const r of notAttempted) {
      out.push(`| \`${r.session_type}\` | \`${cell(r.cmdlet_name)}\` | ${cell(truncate(r.reason ?? "", 300))} |`);
    }
    out.push("");

    out.push("## How to re-run this");
    out.push("");
    out.push("```");
    out.push("# 1. Deploy the container (the survey code is in services/ps-execution/survey.ps1):");
    out.push("az acr build --registry acrsmccaw2184 --image ps-execution:dev services/ps-execution");
    out.push("az containerapp update -n ca-ps-execution-dev -g rg-smccaw-2184 \\");
    out.push("  --image acrsmccaw2184.azurecr.io/ps-execution:dev --revision-suffix <suffix>");
    out.push("");
    out.push("# 2. Run the survey (writes ps_capability_survey_runs / _results):");
    out.push("pnpm --filter @workspace/scripts run ps-capability-survey");
    out.push("");
    out.push("# 3. Regenerate this document from what landed in the database:");
    out.push("pnpm --filter @workspace/scripts run ps-capability-survey-doc");
    out.push("```");
    out.push("");
    out.push(
      "Read it back over HTTP with `GET /api/simulator/ps-execution/capability-survey` " +
        "(`?runId=`, `?session=`, `?status=`, `?cmdlet=`).",
    );
    out.push("");

    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, out.join("\n"), "utf8");
    console.log(`wrote ${OUT_FILE} from run #${run.id} (${results.length} rows)`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
