/**
 * #1865 — Reconcile powershell-transport `config_resources` against #1793's real
 * PowerShell capability survey (`ps_capability_survey_results`).
 *
 * #1794 shipped the resource model with `ps_capability_survey_results` empty, and
 * said so honestly: the 211 powershell-transport resources carried an availability
 * verdict derived only from Microsoft365DSC's declared RBAC roles (`resolveAvailability`
 * in build-resource-model.mjs) — never checked against a cmdlet that actually ran
 * app-only through `ca-ps-execution-dev`. This reconciles the model against the real
 * run #1793 produced.
 *
 * Evidence discipline, per resource:
 *   - At least one read cmdlet surveyed `ok`  -> LIVE evidence the app-only read path
 *     genuinely works. This is stronger than the derived RBAC-role heuristic, so it
 *     overrides `unknown` / `needs_additional_scope` UP to `available_now`. It never
 *     downgrades an existing `available_now` — it just adds live confirmation.
 *   - A read cmdlet the survey ran but got `error` / `not_attempted`, with no `ok`
 *     cmdlet on the same resource -> inconclusive. Availability is left exactly as
 *     derived (inconclusive is not a verdict), but the resource is labelled with what
 *     the survey actually returned rather than left silently unlabeled.
 *   - None of the resource's read cmdlets appear anywhere in the survey's cmdlet
 *     catalog at all -> labelled as unreconciled rather than left looking reconciled.
 *     (In practice this catches Microsoft365DSC-internal helper calls like
 *     `Get-MSCloudLoginConnectionProfile` that parse-m365dsc.mjs picked up from a
 *     resource's .psm1 body but that are not real exported session cmdlets.)
 *
 * Never invents a cmdlet result and never downgrades on absence of evidence — only a
 * real `ok` result changes availability, and only upward.
 */

/** The 5 statuses #1793's survey.ps1 can record that mean "the cmdlet genuinely doesn't/can't work app-only". */
const NEGATIVE_STATUSES = new Set(["access_denied", "not_supported_app_only", "cmdlet_unavailable"]);

export async function reconcilePowershellAgainstSurvey(client) {
  const run = await client.query(
    `SELECT id, container_revision, completed_at FROM ps_capability_survey_runs
       WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1`,
  );
  if (run.rows.length === 0) {
    return { ranAgainstRunId: null, total: 0, upgraded: 0, confirmed: 0, inconclusive: 0, unmatched: 0, negative: 0 };
  }
  const runRow = run.rows[0];

  const results = await client.query(
    `SELECT cmdlet_name, status, reason, error_message FROM ps_capability_survey_results WHERE run_id = $1`,
    [runRow.id],
  );
  const byCmdlet = new Map();
  const cmdletCatalogSize = new Set();
  for (const r of results.rows) {
    byCmdlet.set(r.cmdlet_name.toLowerCase(), r);
    cmdletCatalogSize.add(r.cmdlet_name.toLowerCase());
  }

  const resources = (await client.query(
    `SELECT id, resource_key, read_cmdlets, availability FROM config_resources WHERE read_transport = 'powershell'`,
  )).rows;

  let upgraded = 0;
  let confirmed = 0;
  let inconclusive = 0;
  let unmatched = 0;
  let negative = 0;

  for (const r of resources) {
    const cmdlets = r.read_cmdlets ?? [];
    const matches = cmdlets
      .map((c) => byCmdlet.get(String(c).toLowerCase()))
      .filter(Boolean);
    const ok = matches.filter((m) => m.status === "ok");
    const bad = matches.filter((m) => NEGATIVE_STATUSES.has(m.status));

    if (ok.length > 0) {
      const evidence = ok.map((m) => m.cmdlet_name).join(", ");
      const note = `#1865: confirmed app-only via #1793 PS capability survey run ${runRow.id} (${runRow.container_revision}) — ${evidence} returned ok.`;
      if (r.availability !== "available_now") {
        upgraded++;
        await client.query(
          `UPDATE config_resources
              SET availability = 'available_now',
                  availability_reason = $2,
                  missing_permissions = '[]',
                  verification_status = 'verified_live',
                  notes = $3,
                  updated_at = now()
            WHERE id = $1`,
          [r.id, `confirmed available app-only by #1793 PS capability survey (${evidence} = ok)`, note],
        );
      } else {
        confirmed++;
        await client.query(
          `UPDATE config_resources SET verification_status = 'verified_live', notes = $2, updated_at = now() WHERE id = $1`,
          [r.id, note],
        );
      }
      continue;
    }

    // No `ok` cmdlet. A genuine negative (access_denied / not_supported_app_only /
    // cmdlet_unavailable) contradicts the derived availability outright — but no
    // resource in the model currently hits this path (checked live against run #4);
    // recorded here so a future run with different survey results does not silently
    // keep asserting an availability the live evidence has since disproved.
    if (bad.length > 0) {
      negative++;
      const detail = bad.map((m) => `${m.cmdlet_name}=${m.status}${m.reason ? ` (${m.reason})` : ""}`).join("; ");
      await client.query(
        `UPDATE config_resources
            SET availability = 'unavailable',
                availability_reason = $2,
                verification_status = 'failed_live',
                notes = $3,
                updated_at = now()
          WHERE id = $1`,
        [r.id, `#1793 PS capability survey run ${runRow.id} found this does not work app-only: ${detail}`,
          `#1865: downgraded — #1793 survey run ${runRow.id} — ${detail}`],
      );
      continue;
    }

    if (matches.length > 0) {
      inconclusive++;
      const detail = matches.map((m) => `${m.cmdlet_name}=${m.status}${m.reason ? ` (${m.reason})` : ""}`).join("; ");
      await client.query(
        `UPDATE config_resources SET notes = $2, updated_at = now() WHERE id = $1`,
        [r.id, `#1865: #1793 survey run ${runRow.id} attempted but inconclusive — ${detail}. Availability left as derived (not a verdict).`],
      );
      continue;
    }

    unmatched++;
    await client.query(
      `UPDATE config_resources SET notes = $2, updated_at = now() WHERE id = $1`,
      [r.id, `#1865: cmdlet(s) [${cmdlets.join(", ")}] do not appear in #1793's ${cmdletCatalogSize.size}-cmdlet survey catalog (run ${runRow.id}) — not reconciled. Likely a Microsoft365DSC-internal helper call, not a real session cmdlet.`],
    );
  }

  return {
    ranAgainstRunId: runRow.id,
    containerRevision: runRow.container_revision,
    cmdletCatalogSize: cmdletCatalogSize.size,
    total: resources.length,
    upgraded,
    confirmed,
    inconclusive,
    unmatched,
    negative,
  };
}
