/**
 * remediationLiveGuide.ts — the real per-tenant content behind the Full
 * Remediation Guide (#472, document 8 of 9 in the #292 set).
 *
 * A pure `.ts` module, not inlined into `RemediationGuideBody.tsx`, for the same
 * reason `sowLiveContract.ts` is: `node --test` cannot load `.tsx`, so this is
 * what makes the honesty rules below testable.
 *
 * `previewRemediationGuide.ts` IS NOT TOUCHED BY THIS FILE. It stays the
 * design's Halden Materials worked example, byte-for-byte, behind
 * `?preview=design` — its own header is explicit that its scripts are
 * transcribed verbatim and must never be hand-edited. Everything here is the
 * LIVE variant that renders instead on a real tenant, built from the same step
 * ids, labels, pillars and structure so the two can never disagree about what
 * Step 14 is.
 *
 * ══ 1. THE CHECK MAPPING IS #472'S, CONFIRMED AGAINST LIVE DATA ═══════════════
 *
 * `STEP_CHECK_KEYS` is Shane's own final mapping table, closed on 2026-08-06
 * after a live query pass over the 101 real check keys in
 * `assess:copilot-readiness`. TWENTY-FOUR of the thirty steps map to a real
 * `monitor_checks.key`; two are genuine platform-wide gaps; four are process
 * steps that expect no check. Nothing here was re-derived and nothing was
 * guessed — a wrong check key in a paying customer's runbook is exactly the
 * #441 failure this journey is now built to make impossible.
 *
 * (#472's closing summary says "23/30 real". Its own final table lists steps
 * 1–17, 19–23, 26 and 29 — 24 rows — and 24 + 2 + 4 is the 30 the guide holds,
 * where 23 + 2 + 4 is 29. The table is the mapping; the 23 is an arithmetic slip
 * in the prose, and `remediationLiveGuide.test.ts` asserts the three sets add up
 * so it cannot be copied back in.)
 *
 * WHERE THIS MAPPING DELIBERATELY DOES *NOT* LIVE: `config_pack_templates`.
 * #472's proposal named that table plus `baseline_action_templates` as the
 * storage for this, and closer reading of both shows it is the wrong home:
 *
 *   • `baseline_action_templates` has no script column at all. It is
 *     `endpoint` / `method` / `body_template` / `required_variables` /
 *     `success_criteria` — a Microsoft Graph REST *execution* catalog, consumed
 *     by `runBaselineTemplateAgainstTenant()` from Launch Control and the
 *     config-pack orchestrator, which really does PATCH a customer tenant.
 *     There is nowhere in it to put a PowerShell string.
 *   • `config_pack_templates.check_key` does not mean "the check this step
 *     remediates". `buildConfigPackGraph()` turns a row carrying one into an
 *     `execute_monitor_check` node feeding an `execute_baseline_template` node
 *     — i.e. a real executable write workflow against the tenant.
 *   • This document's own contract is the opposite of that, and says so in
 *     `previewRemediationGuide.ts`: "NOTHING HERE RUNS ANYTHING … the platform
 *     holds no write consent for these operations on a customer tenant, and the
 *     viewer offers copy, never execute."
 *
 * So the mapping lives where every other live-rendered document in this journey
 * keeps its real check mapping — in a tested `.ts` module, guarded the same way
 * `registry-source-key-contract.test.ts` guards the registry's own claims.
 *
 * ══ 2. WHAT CAN AND CANNOT BE SUBSTITUTED INTO A SCRIPT ══════════════════════
 *
 * Seven of the 24 scripts carry a value from the design's fictional tenant: four
 * SharePoint site URLs, a notification mailbox, a rights-definition mailbox, a
 * Conditional Access policy id, a user object id, a Safe Links policy name and a
 * department name. #472 asked for those to be replaced with the tenant's real
 * values at render time.
 *
 * THEY CANNOT BE, AND THE REASON IS A MISSING READ PATH RATHER THAN A MISSING
 * IDEA. Nothing on this journey's wire carries an identifier of any kind:
 * `war-room-pillars` sends stats as `{ value: number | null }` and findings as
 * `{ severity, checkKey, title, rankWeight }`. The one place complete per-item
 * detail lands is `tenant_check_item_details` (#339) — and that table is
 * write-only today: `runItemDetailCollection()` inserts into it and no route in
 * api-server reads it back. Substituting a plausible-looking site URL or object
 * id from anywhere else would be fabrication of exactly the kind #441 is the
 * record of.
 *
 * What is done instead is what a real runbook does anyway, and what most of
 * these scripts already did: every fictional literal becomes a NAMED
 * placeholder, in Shane's own existing `<angle-bracket>` convention (see Step
 * 6's `<sg-team-requesters-id>` and Step 11's `<user-object-id>` in the design
 * itself), and each such step carries a `fillIn` line naming what the reader
 * must supply and the command that finds it. In most cases that command is
 * already the first half of the same script.
 *
 * The COMMAND LOGIC IS NEVER TOUCHED. Cmdlets, parameters, ordering, pipelines
 * and spacing are byte-identical to the design; only the literal changes.
 *
 * ══ 3. WHAT *IS* SUBSTITUTED: THE COUNTS THE SCAN REALLY MEASURED ════════════
 *
 * The guide's prose is dense with Halden's numbers — "208 org-wide sites",
 * "2,940 anonymous links", "11 admin accounts", "1,106 legacy sign-ins", "88
 * devices", "22 dormant Copilot seats", "148 inactive sites". Five of the 23
 * mapped checks are behind a real War Room stat, so those sentences state this
 * tenant's own figure. Every other sentence drops the count rather than quoting
 * Halden's — the same rule `resolveWhyMatters` follows in `sowLiveContract.ts`.
 *
 * A count is only ever substituted where the stat is EXACTLY what the sentence
 * says it is. `security.globalAdmins` is the Global Administrator count, so it
 * fills "reduce your N standing Global Admins"; it is never quietly reused as an
 * MFA coverage figure or a device count.
 *
 * ══ 4. EVIDENCE, AND WHY AN EMPTY JOIN NEVER READS AS A PASS ═════════════════
 *
 * `stepEvidence()` joins a step's mapped check keys against this tenant's real
 * findings. A hit is a genuine, quotable fact: this step is on your list because
 * this check recorded this finding. A miss is NOT the opposite. The wire's
 * findings are capped SERVER-SIDE at `WAR_ROOM_FINDINGS_PER_PILLAR` (3) — the
 * worst-first head of a pillar's findings, never its complete set — so absence
 * carries no information at all and says so in words. Rendering a miss as "clean"
 * would turn a display cap into a clean bill of health.
 *
 * ══ 5. STEPS 18 AND 28 ARE ABSENCES, NOT FAILURES ════════════════════════════
 *
 * Audit log retention above 90 days, and OneDrive sync errors. #472 confirmed
 * against live data that no check anywhere in this platform reads either one —
 * not unscanned for this tenant, not gated behind a licence, simply not built.
 * Both steps stay in the guide at their own numbers, in dependency order, with
 * their real generic action intact, and each carries a `gap` evidence line
 * saying the platform has no measurement of its own here. The bar is #472's own,
 * set for the pillar reports: this must not read as a check that looked and
 * disapproved.
 */

import { COPILOT_GATE_TARGET, PILLARS, PILLAR_KEYS, type PillarKey } from "./journeyTokens.ts";
import type { JourneyPillarView, JourneyView } from "./journeyModel.ts";
import {
  REMEDIATION_GUIDE,
  REMEDIATION_PRELUDE,
  REMEDIATION_STEPS,
  type RemediationCode,
  type RemediationStep,
} from "./previewRemediationGuide.ts";

/* ------------------------------------------------------------------ *
 * 1 · The mapping
 * ------------------------------------------------------------------ */

/**
 * #472's final table: step id → the real `monitor_checks` key(s) behind it.
 *
 * Steps with more than one key are genuinely served by more than one check —
 * Step 8 by the CA policy inventory and its MFA coverage, Step 29 by the
 * inactive-site sweep and the two ownerless-container checks. Order is the
 * order #472 lists them; the first key that produces evidence wins, and the
 * rest are still named so the reader can see the whole basis.
 *
 * ABSENT BY DESIGN: s18 and s28 (see `STEP_CHECK_GAPS`) and s24, s25, s27, s30
 * (see `PROCESS_ONLY_STEP_IDS`). A step id missing from all three maps is a
 * mistake, and `remediationLiveGuide.test.ts` fails on it.
 */
export const STEP_CHECK_KEYS: Readonly<Record<string, readonly string[]>> = {
  s1: ["sharepoint:orgwide-links"],
  s2: ["sharepoint:orgwide-links"],
  s3: ["sharepoint:anonymous-links"],
  s4: ["sharepoint:anonymous-links"],
  s5: ["governance:group-expiration-policy"],
  // Step 6's gap was real and was CLOSED live during #472's research pass rather
  // than documented: `teams:inventory-count` already hit the Group resource and
  // simply never requested `visibility`. The field, a `countEquals` mapping, a
  // severity rule and a `profile_key_gt` signal rule were added, and
  // `publicTeamCount` is the named field this step now reads.
  s6: ["teams:inventory-count"],
  s7: ["identity:mfa-registration"],
  s8: ["identity:ca-policy-count", "identity:ca-mfa-coverage"],
  s9: ["identity:ca-policy-count", "identity:ca-report-only"],
  s10: ["identity:legacy-auth-usage"],
  s11: ["identity:global-admin-count"],
  s12: ["security:safe-links-coverage"],
  s13: ["identity:ca-device-compliance"],
  s14: ["compliance:missing-labels", "governance:sensitivity-label-adoption"],
  s15: ["governance:auto-labeling-coverage"],
  s16: ["compliance:weak-dlp-policies"],
  s17: ["governance:retention-policy-coverage"],
  s19: ["copilot:licensed-but-inactive"],
  s20: ["copilot:licensed-but-inactive"],
  s21: ["cost:entra-license-tier-distribution", "license:sku-utilization"],
  s22: ["cost:group-based-licensing-adoption"],
  s23: ["adoption:teams-activity-trend", "adoption:sharepoint-onedrive-trend"],
  s26: ["sharepoint:tenant-sharing-capability"],
  s29: ["sharepoint:inactive-sites", "teams:ownerless-teams", "governance:ownerless-groups"],
};

/**
 * The two steps no check in this platform measures — confirmed platform-wide by
 * #472, not "not in this tenant's scan package".
 *
 * The wording is the load-bearing part. It states an absence in our own
 * measurement and says explicitly that nothing has been judged, because the one
 * way this can go wrong is reading as a silent fail. It does not apologise, and
 * it does not imply the step is optional: the action itself is real, standard
 * guidance and stays in the runbook.
 */
export const STEP_CHECK_GAPS: Readonly<Record<string, string>> = {
  s18:
    "No check this platform runs reads audit log retention, so this step carries no figure from your tenant. " +
    "That is a gap in what we measure, not a finding about your configuration — nothing here says your retention " +
    "is too short, and nothing says it is sufficient. The action below is standard guidance and is worth running " +
    "on its own merits; the command in the verify line is what tells you where you actually stand.",
  s28:
    "No check this platform runs reads OneDrive sync health, so this step carries no figure from your tenant. " +
    "Your sync error count is unmeasured by this assessment rather than found wanting — the script below is what " +
    "produces the real number, and it is yours to run.",
};

/**
 * The four steps that are decisions or process rather than configuration, and so
 * expect no check mapping. Listed rather than inferred from "has no `code`",
 * because Steps 27 and 30 do carry a script and are still meta.
 */
export const PROCESS_ONLY_STEP_IDS: readonly string[] = ["s24", "s25", "s27", "s30"];

/* ------------------------------------------------------------------ *
 * 2 · Evidence
 * ------------------------------------------------------------------ */

export type StepEvidence =
  /** A real finding on one of this step's own checks, quoted verbatim. */
  | {
      readonly kind: "finding";
      readonly checkKey: string;
      readonly title: string;
      readonly severity: "critical" | "warning";
      readonly pillar: PillarKey;
    }
  /** Steps 18 and 28 — see `STEP_CHECK_GAPS`. */
  | { readonly kind: "gap"; readonly detail: string }
  /** Steps 24, 25, 27 and 30 — a decision, not a measurement. */
  | { readonly kind: "process" }
  /**
   * Mapped to real checks, but nothing about them reached this document. NEVER
   * a pass: the wire's findings are the worst-first head of each pillar, capped
   * server-side at three, so this is genuinely uninformative.
   */
  | { readonly kind: "unconfirmed"; readonly checkKeys: readonly string[] };

/** The sentence an `unconfirmed` step shows. One constant, so no render site can soften it. */
export const UNCONFIRMED_EVIDENCE_DETAIL =
  "Your scan reports only the three most severe findings per pillar, so this step is neither confirmed nor ruled " +
  "out for your tenant from this document alone. It stays in the sequence because the steps around it depend on it.";

/**
 * The real finding behind a step, if this tenant has one on record for it.
 *
 * Findings are searched in `PILLAR_KEYS` order and, within a pillar, in the
 * order the wire sent them — which `buildPillarViews` has already ranked
 * criticals-first and then by real signal weight (#414). So a step served by two
 * checks quotes the more severe of the two findings rather than whichever check
 * key happens to sort first.
 */
export function stepEvidence(stepId: string, pillars: readonly JourneyPillarView[]): StepEvidence {
  const gap = STEP_CHECK_GAPS[stepId];
  if (gap) return { kind: "gap", detail: gap };
  if (PROCESS_ONLY_STEP_IDS.includes(stepId)) return { kind: "process" };

  const keys = STEP_CHECK_KEYS[stepId] ?? [];
  for (const pillar of pillars) {
    for (const finding of pillar.findings) {
      if (keys.includes(finding.checkKey)) {
        return {
          kind: "finding",
          checkKey: finding.checkKey,
          title: finding.title,
          severity: finding.severity,
          pillar: pillar.key,
        };
      }
    }
  }
  return { kind: "unconfirmed", checkKeys: keys };
}

/* ------------------------------------------------------------------ *
 * 3 · Real stats
 * ------------------------------------------------------------------ */

/**
 * One real stat value off the journey's own view, or `null`.
 *
 * `null` covers all three of "the pillar has no card", "the stat is not on this
 * pillar" and "the stat reported no value" — every caller below treats all three
 * identically, by omitting the clause rather than printing a zero.
 */
export function statValue(
  pillars: readonly JourneyPillarView[],
  pillar: PillarKey,
  statId: string,
): number | null {
  const stat = pillars.find((p) => p.key === pillar)?.stats.find((s) => s.id === statId);
  if (!stat || typeof stat.value !== "number" || !Number.isFinite(stat.value)) return null;
  return stat.value;
}

function num(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/* ------------------------------------------------------------------ *
 * 4 · The parameterised scripts
 *
 * Structure, cmdlets, parameters, ordering and spacing are byte-identical to
 * `previewRemediationGuide.ts`. ONLY the fictional literal changes, and only
 * ever to a named placeholder — never to an invented real-looking value.
 * ------------------------------------------------------------------ */

/** What the reader must supply for a placeholder, and how to find it. */
export const STEP_FILL_INS: Readonly<Record<string, string>> = {
  s1:
    "Replace the site list with your own. Step 2's export is what produces it — run that first if you have not " +
    "already, and take the sites your owners flag as holding regulated or restricted content.",
  s5:
    "Replace <m365-governance@your-domain> with a monitored mailbox in your tenant. Renewal notices go there, and " +
    "a policy pointing at an unmonitored address expires groups nobody was warned about.",
  s9:
    "Replace <ca-policy-id> with the id of the policy the first command lists as disabled or carrying an exclusion. " +
    "The Select block above prints both, so run it before the Update.",
  s11:
    "Replace <user-object-id> with one administrator's object id, and run the block once per administrator you are " +
    "moving to eligible. Step 7's script lists them with their object ids.",
  s12:
    "Replace <your-safe-links-policy> with the policy name the first command returns. Get-SafeLinksPolicy prints " +
    "every policy with its IsEnabled state and when it last changed.",
  s14:
    "Replace <all-staff@your-domain> with the mail-enabled group that should retain rights over Confidential " +
    "content. Everyone outside it loses access to anything carrying the label.",
  s22:
    "Replace <Department> with one real department value from your directory, in both places it appears, and " +
    "<department> in the mail nickname with the same value in lower case and without spaces — a mail nickname that " +
    "is not is rejected outright. Step 21's export lists every department Entra actually holds, spelt the way the " +
    "membership rule has to match it.",
};

/**
 * The live script for a step, or `null` where the design's own script is already
 * fully generic and is used unchanged.
 *
 * A `null` here is a positive statement, not a hole: 18 of the 24 mapped scripts
 * are used unchanged, including the ones that only LOOK hardcoded —
 * Step 8's three role GUIDs are Microsoft's universal built-in role template ids,
 * Step 15's sensitive-information-type names are Microsoft's own built-ins, and
 * Step 19's Copilot SKU GUID is a Microsoft-universal constant.
 */
export const LIVE_STEP_SCRIPTS: Readonly<Record<string, RemediationCode>> = {
  s1: {
    language: "PowerShell · SharePoint Online",
    script:
      '$sites = @(\n  "https://<your-tenant>.sharepoint.com/sites/<site-1>",\n  "https://<your-tenant>.sharepoint.com/sites/<site-2>",\n  "https://<your-tenant>.sharepoint.com/sites/<site-3>",\n  "https://<your-tenant>.sharepoint.com/sites/<site-4>"\n)\n\nforeach ($s in $sites) {\n    Set-SPOSite -Identity $s -SharingCapability Disabled\n    Write-Host "Closed: $s" -ForegroundColor Green\n}',
  },
  s5: {
    language: "PowerShell · Microsoft Graph",
    script:
      'New-MgGroupLifecyclePolicy -GroupLifetimeInDays 365 -ManagedGroupTypes All\n    -AlternateNotificationEmails "<m365-governance@your-domain>"',
  },
  s9: {
    language: "PowerShell · Microsoft Graph",
    script:
      'Get-MgIdentityConditionalAccessPolicy |\n    Select-Object DisplayName, State,\n        @{ N="Excluded"; E={ $_.Conditions.Users.ExcludeGroups -join "," } } |\n    Format-Table -AutoSize\n\n# on the policy holding the exclusion:\nUpdate-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId <ca-policy-id>\n    -Conditions @{ users = @{ excludeGroups = @() } }',
  },
  s12: {
    language: "PowerShell · Exchange Online",
    script:
      'Get-SafeLinksPolicy | Select-Object Name, IsEnabled, WhenChangedUTC\n\nSet-SafeLinksPolicy -Identity "<your-safe-links-policy>" -IsEnabled $true\nGet-SafeLinksRule  -Identity "<your-safe-links-policy>" | Enable-SafeLinksRule',
  },
  s14: {
    language: "PowerShell · Purview (Connect-IPPSSession)",
    script:
      'New-Label -Name "Internal" -DisplayName "Internal"\n    -Tooltip "Standard business content. Not for external sharing."\n\nNew-Label -Name "Confidential" -DisplayName "Confidential"\n    -Tooltip "Financial, HR or contractual content."\n    -EncryptionEnabled $true -EncryptionProtectionType Template\n    -EncryptionRightsDefinitions "<all-staff@your-domain>:VIEW,EDIT,PRINT"\n\nNew-LabelPolicy -Name "Baseline" -Labels "Internal","Confidential"\n    -ExchangeLocation All -SharePointLocation All -OneDriveLocation All\n    -AdvancedSettings @{ MandatoryLabel = "true"; DefaultLabelId = "Internal" }',
  },
  s22: {
    language: "PowerShell · Microsoft Graph",
    script:
      'New-MgGroup -DisplayName "LIC-E5-<Department>" -MailEnabled:$false\n    -SecurityEnabled -MailNickname "lic-e5-<department>"\n    -GroupTypes "DynamicMembership" -MembershipRuleProcessingState "On"\n    -MembershipRule (\n        "(user.department -eq " + [char]34 + "<Department>" + [char]34 + ")" +\n        " -and (user.accountEnabled -eq true)"\n    )',
  },
  // Step 11's script already used `<user-object-id>`: the design itself wrote it
  // as a placeholder, so there is nothing to change and it is deliberately not
  // re-listed here. `STEP_FILL_INS.s11` still names what to put in it.
};

/**
 * The one-off connect block, with the design's own admin URL made a placeholder.
 *
 * The footnote also corrects a real defect in the design's copy rather than
 * carrying it forward: it read "Step 12 removes most of yours", but Step 12 is
 * the Safe Links reinstatement — the step that removes standing Global
 * Administrator is Step 11. Preview keeps the original verbatim; a live reader
 * following the pointer would land on the wrong step.
 */
export const LIVE_PRELUDE = {
  // Heading and blurb carry no fixture data, so they are read from the design's
  // own block rather than retyped — one definition, no drift.
  heading: REMEDIATION_PRELUDE.heading,
  blurb: REMEDIATION_PRELUDE.blurb,
  code: {
    language: "PowerShell 7 · run once",
    script: `Install-Module Microsoft.Graph -Scope CurrentUser -Force
Install-Module Microsoft.Online.SharePoint.PowerShell -Scope CurrentUser -Force
Install-Module ExchangeOnlineManagement -Scope CurrentUser -Force
Install-Module PnP.PowerShell -Scope CurrentUser -Force

Connect-MgGraph -Scopes "Directory.Read.All","Policy.Read.All",
  "Policy.ReadWrite.ConditionalAccess","RoleManagement.ReadWrite.Directory",
  "User.Read.All","Reports.Read.All"
Connect-SPOService -Url https://<your-tenant>-admin.sharepoint.com
Connect-IPPSSession   # Purview: labels, DLP, retention
Connect-ExchangeOnline`,
  },
  footnote:
    "Use an account with Global Reader plus the specific role each step names. Nothing here requires standing Global Administrator — and Step 11 removes most of yours.",
} as const;

/* ------------------------------------------------------------------ *
 * 5 · The live copy that carried Halden's numbers
 * ------------------------------------------------------------------ */

/**
 * A step's live title. `null` means the design's own title is already free of
 * fixture data and is used unchanged.
 *
 * Every entry either states this tenant's real figure or drops the figure
 * entirely. None of them keeps Halden's.
 */
export function liveTitle(stepId: string, view: JourneyView): string | null {
  const admins = statValue(view.pillars, "security", "security.globalAdmins");
  const seats = view.tenant.seatCount;

  switch (stepId) {
    case "s1":
      return "Close org-wide sharing on your most sensitive sites";
    case "s2":
      return "Export your remaining org-wide sites and route them to owners";
    case "s4":
      return "Revoke your existing anonymous links";
    case "s7":
      return admins === null
        ? "Audit and fix MFA on your administrator accounts"
        : `Audit and fix MFA on your ${num(admins)} Global Administrator accounts`;
    case "s9":
      return "Re-enable any disabled Conditional Access policy and clear its exclusions";
    case "s11":
      return admins === null
        ? "Reduce standing Global Admins to 2 break-glass accounts"
        : `Reduce ${num(admins)} standing Global Admins to 2 break-glass accounts`;
    case "s12":
      return "Reinstate any Safe Links policy that has been switched off";
    case "s15":
      return seats === null
        ? "Auto-label regulated content instead of asking every user"
        : `Auto-label regulated content instead of asking ${num(seats)} people`;
    case "s17":
      return "Extend retention to every uncovered workload";
    case "s19":
      return "Identify your dormant Copilot seats";
    case "s21":
      return "Reconcile your mismatched SKU assignments";
    case "s22":
      return "Move to group-based licensing and retire the legacy licensing groups";
    case "s28":
      return "Resolve your OneDrive sync errors";
    case "s29":
      return "Attest and dispose of your inactive sites and orphaned channels";
    default:
      return null;
  }
}

/** A step's live `where` line, where the design's names Halden-specific detail. */
export function liveWhere(stepId: string): string | null {
  // Step 25's "Finance Analyst · Legal Counsel · Executive Assistant" is the
  // design's persona data, which #292 dropped from this journey and which #472
  // is explicit should stay dropped. It is replaced with what the step actually
  // asks the reader to decide, not with three invented roles.
  if (stepId === "s25") return "Not a setting — pick three roles with the clearest repeatable document work";
  return null;
}

/** A step's live caution. `null` keeps the design's, which carries no fixture data. */
export function liveCaution(stepId: string, view: JourneyView): string | null {
  switch (stepId) {
    case "s2":
      return (
        "Do not bulk-close these. Sites closed without warning generate one access ticket each, all on the same " +
        "morning. Send the CSV to owners with a 10-working-day attestation deadline, then close whatever comes back " +
        "unclaimed."
      );
    case "s3":
      return "This governs links created from now on. Links that already exist keep working until Step 4 revokes them.";
    case "s4":
      return (
        "Pilot this on one site first. Anonymous links are often embedded in supplier email threads — revoking them " +
        "all is correct, but Communications should know the day it happens."
      );
    case "s10": {
      const legacy = statValue(view.pillars, "security", "security.legacyAuth");
      const lead =
        legacy === null
          ? "If legacy sign-ins are still reaching your tenant, something real is still using them."
          : `${num(legacy)} legacy sign-ins were recorded on your last scan, which means something real still uses it.`;
      return `${lead} Find and migrate those clients first — disabling this cold will break them.`;
    }
    case "s13": {
      const failing = statValue(view.pillars, "health", "health.nonCompliantDevices");
      const unencrypted = statValue(view.pillars, "health", "health.unencrypted");
      const outdated = statValue(view.pillars, "health", "health.outdated");
      const lead =
        failing === null
          ? "Promote the policy and every device currently failing the baseline loses access."
          : `${num(failing)} of your devices currently fail the baseline. Promote the policy and those ${num(failing)} users lose access.`;
      const parts: string[] = [];
      if (unencrypted !== null) parts.push(`${num(unencrypted)} report no disk encryption`);
      if (outdated !== null) parts.push(`${num(outdated)} are behind on their OS build`);
      // "and most overlap" is Halden's observation; that a device can appear in
      // more than one count is structurally true of every tenant, so only that
      // is stated.
      const detail = parts.length
        ? ` Triage first — ${parts.join(" and ")}, and a device can appear in both counts.`
        : " Triage first.";
      return `${lead}${detail}`;
    }
    case "s28":
      return (
        "Most sync errors are a stale client rather than a service fault. Push the current OneDrive build to any " +
        "out-of-date devices before investigating individually."
      );
    default:
      return null;
  }
}

/** A step's live verify line. `null` keeps the design's. */
export function liveVerify(stepId: string, view: JourneyView): string | null {
  const admins = statValue(view.pillars, "security", "security.globalAdmins");

  switch (stepId) {
    case "s1":
      return "Get-SPOSite -Identity $s | Select Url,SharingCapability returns Disabled for every site in the list.";
    case "s2":
      return "The CSV holds every org-wide site except the ones you closed in Step 1.";
    case "s5":
      return "Owners of your inactive sites receive a renewal notice within 24 hours.";
    case "s11":
      // 2 permanent and N-2 eligible follows from the real admin count. Below
      // three admins the arithmetic stops being meaningful, so it is dropped
      // rather than printed as a zero or a negative.
      return admins !== null && admins > 2
        ? `PIM → Global Administrator shows 2 permanent and ${num(admins - 2)} eligible.`
        : "PIM → Global Administrator shows 2 permanent, and every other administrator eligible rather than standing.";
    case "s19":
      return "The CSV lists every user holding a Copilot seat with no sign-in activity in 30 days.";
    case "s20":
      return "Billing → Licenses shows the reclaimed Copilot seats as available.";
    case "s23":
      return "The three exports give you a per-user activity baseline to plan training against.";
    case "s24":
      return "Channel post share rises toward parity with chat over one quarter.";
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * 6 · The assembled live steps
 * ------------------------------------------------------------------ */

export interface LiveRemediationStep extends RemediationStep {
  /** What the reader must supply where a placeholder stands. */
  readonly fillIn?: string;
  /** Why this step is on this tenant's list — or an honest statement that nothing can be said. */
  readonly evidence: StepEvidence;
}

/**
 * Every step, in the design's own order, resolved against this tenant.
 *
 * The array is `REMEDIATION_STEPS` mapped one-to-one: same ids, same labels,
 * same pillars, same count. Nothing is added, dropped, reordered or renumbered —
 * the guide's phase structure and its own "Steps 1–13 / 14–22 / 23–30" sequence
 * table depend on all thirty existing at their own numbers, and #472 is explicit
 * that the two gap steps stay in place.
 */
export function buildLiveRemediationSteps(view: JourneyView): readonly LiveRemediationStep[] {
  return REMEDIATION_STEPS.map((step) => {
    const title = liveTitle(step.id, view);
    const where = liveWhere(step.id);
    const caution = liveCaution(step.id, view);
    const verify = liveVerify(step.id, view);
    const code = LIVE_STEP_SCRIPTS[step.id];
    const fillIn = STEP_FILL_INS[step.id];

    return {
      ...step,
      title: title ?? step.title,
      ...(where ? { where } : {}),
      ...(code ? { code } : {}),
      ...(caution ? { caution } : {}),
      ...(verify ? { verify } : {}),
      ...(fillIn ? { fillIn } : {}),
      evidence: stepEvidence(step.id, view.pillars),
    };
  });
}

/* ------------------------------------------------------------------ *
 * 7 · The guide's own numbers
 * ------------------------------------------------------------------ */

/**
 * This tenant's real total finding count, or `null`.
 *
 * `criticalCount` / `warningCount` are the pillar's REAL totals off
 * `findingCounts` — not the length of the capped `findings` array — so this is a
 * true total rather than a display artefact.
 */
export function totalFindings(pillars: readonly JourneyPillarView[]): number | null {
  const total = pillars.reduce((n, p) => n + p.criticalCount + p.warningCount, 0);
  return total > 0 ? total : null;
}

/** This tenant's real critical count per pillar, in `PILLAR_KEYS` order, worst first. */
export function criticalsByPillar(
  pillars: readonly JourneyPillarView[],
): readonly { readonly pillar: PillarKey; readonly count: number }[] {
  return pillars.filter((p) => p.criticalCount > 0).map((p) => ({ pillar: p.key, count: p.criticalCount }));
}

export function resolveTotalFindings(isPreview: boolean, pillars: readonly JourneyPillarView[]): string {
  if (isPreview) return "41 across six pillars";
  const total = totalFindings(pillars);
  if (total === null) return "No findings are recorded for this tenant's last scan";
  const scored = pillars.filter((p) => p.score !== null).length;
  return scored > 0 ? `${num(total)} across ${scored} scored ${scored === 1 ? "pillar" : "pillars"}` : `${num(total)}`;
}

export function resolveBlockers(isPreview: boolean, pillars: readonly JourneyPillarView[]): string {
  if (isPreview) return "6 — Governance 2 · Security 2 · Compliance 2";
  const rows = criticalsByPillar(pillars);
  if (rows.length === 0) {
    // Zero criticals is a real, positive result for a scan that ran — and an
    // empty statement for one that did not. The two are told apart by whether
    // any pillar has a score at all (#399), exactly as `findingsBlocks` does.
    return pillars.some((p) => p.score !== null)
      ? "None — your last scan recorded no critical findings"
      : "Not established — no pillar on this tenant has an evaluated score";
  }
  const total = rows.reduce((n, r) => n + r.count, 0);
  return `${num(total)} — ${rows.map((r) => `${PILLARS[r.pillar].label} ${r.count}`).join(" · ")}`;
}

/**
 * "Expected improvement". The design states 41 → 68, a projection off a priced
 * scope. This document runs no scope fetch and the platform computes no
 * projected score outside one, so a live tenant gets its real score against the
 * real Gate and no invented destination — the same discipline `resolveNetYear`
 * applies in `sowLiveContract.ts`.
 */
export function resolveExpectedImprovement(isPreview: boolean, score: number | null): string {
  if (isPreview) return "41 to 68 (+27) on the scoped programme";
  return score === null
    ? `No readiness score is recorded for this tenant, so no improvement is projected against the ${COPILOT_GATE_TARGET} Gate`
    : `${score} today against a Gate of ${COPILOT_GATE_TARGET}. The projected figure is priced per phase on the statement of work, not asserted here`;
}

/** The scope band's headline. Step count derived; the programme length is the design's plan, not a measurement. */
export function resolveScopeHeadline(isPreview: boolean, stepCount: number, pillars: readonly JourneyPillarView[]): string {
  if (isPreview) return REMEDIATION_GUIDE.scope.headline;
  const rows = criticalsByPillar(pillars);
  const blockers = rows.reduce((n, r) => n + r.count, 0);
  const blockerClause = blockers > 0 ? ` ${blockers} ${blockers === 1 ? "finding" : "findings"} holding it below the threshold.` : "";
  return `${stepCount} steps. 14 weeks.${blockerClause}`;
}

/**
 * The standfirst. The design's reads "Thirty steps, twenty-two of them
 * scripted" while the guide beneath it holds thirty steps of which twenty-eight
 * carry a command — a contradiction the overview row already refuses to
 * reproduce by deriving its own figure. The live standfirst derives too, so the
 * two halves of the same page cannot disagree.
 */
export function resolveStandfirst(isPreview: boolean, stepCount: number, scriptedCount: number): string {
  if (isPreview) return REMEDIATION_GUIDE.standfirst;
  return (
    `This is a runbook. ${stepCount} steps, ${scriptedCount} of them scripted, with the exact console path, the ` +
    "PowerShell to run, what to watch for, and how to confirm each one worked. Tick them off as you go — your " +
    "progress is kept while this page is open."
  );
}

/** The closing paragraphs. Same derived counts as the standfirst, for the same reason. */
export function resolveClosing(
  isPreview: boolean,
  stepCount: number,
  scriptedCount: number,
): readonly string[] {
  if (isPreview) return REMEDIATION_GUIDE.closing;
  return [
    "Clearing the Copilot Gate requires coordinated remediation across governance, security, compliance, licensing, " +
      `adoption and health. This guide is the whole of it: ${stepCount} steps, ${scriptedCount} of them scripted, on a ` +
      "14-week critical path.",
    "Phase 1 is the identity and sharing work that must land before Copilot is enabled for anyone. Any licensing " +
      "waste your assessment identified funds a meaningful share of the programme. Drift telemetry in Step 30 is what " +
      "keeps the result once it is earned — without it, this guide is something you run again in two quarters.",
  ];
}

/** The handoff blurb, which restates the step count. */
export function resolveHandoffBlurb(isPreview: boolean, stepCount: number): string {
  if (isPreview) return REMEDIATION_GUIDE.handoff.blurb;
  return (
    "Every step here is yours to keep and run at your own pace. The proposal covers the same " +
    `${stepCount} steps delivered by Shane McCaw, with the gate validation and signed baseline included.`
  );
}

/* ------------------------------------------------------------------ *
 * 8 · Gate Validation Checklist
 * ------------------------------------------------------------------ */

/**
 * The checklist rows, on this tenant's real critical counts.
 *
 * The design's rows name which steps are open ("2 open (Steps 1, 4)"). Nothing
 * on the wire says which finding a step would close — that is the mapping's
 * inverse and the platform does not compute it — so the live rows state the real
 * count and stop, rather than attaching step numbers on a guess.
 */
export function resolveChecklistRows(
  isPreview: boolean,
  view: JourneyView,
): readonly string[] {
  if (isPreview) return REMEDIATION_GUIDE.checklist.rows;

  const rows: string[] = [];
  for (const key of PILLAR_KEYS) {
    const pillar = view.pillars.find((p) => p.key === key);
    const label = PILLARS[key].label;
    if (!pillar || pillar.score === null) {
      rows.push(`All ${label.toLowerCase()} blockers resolved — not evaluated on this tenant's last scan`);
      continue;
    }
    rows.push(
      pillar.criticalCount > 0
        ? `All ${label.toLowerCase()} blockers resolved — ${pillar.criticalCount} open`
        : `All ${label.toLowerCase()} blockers resolved — none open`,
    );
  }

  // The blast-radius row. The design says "212 sites currently reachable"; the
  // real check (`copilot:overshare-exposure`) counts over-exposed ITEMS, not
  // sites, so the live row says items — the same relabel-don't-approximate rule
  // `WAR_ROOM_PILLAR_STAT_SPECS` applies to the stat itself.
  const exposure = statValue(view.pillars, "governance", "governance.exposure");
  rows.push(
    exposure === null
      ? "Copilot blast radius reduced to safe threshold — your over-exposure count was not measured on this scan"
      : `Copilot blast radius reduced to safe threshold — ${num(exposure)} items currently over-exposed`,
  );

  rows.push(
    view.readinessScore === null
      ? `Readiness score at or above ${COPILOT_GATE_TARGET} — no readiness score is recorded for this tenant`
      : `Readiness score at or above ${COPILOT_GATE_TARGET} — currently ${view.readinessScore}`,
  );

  return rows;
}

/**
 * The checklist's closing note. The design's quotes a projected 68 and an
 * estimated Adoption 46 → 61; neither is a figure this platform computes outside
 * a priced scope, and the Adoption pillar in particular carries no real stats at
 * all (`WAR_ROOM_PILLAR_STAT_SPECS.adoption` is deliberately empty since #441).
 */
export function resolveChecklistNote(isPreview: boolean, view: JourneyView): string {
  if (isPreview) return REMEDIATION_GUIDE.checklist.note;
  const lead =
    view.readinessScore === null
      ? `The steps above are what move a tenant toward the ${COPILOT_GATE_TARGET} Gate.`
      : `The steps above are what move you from ${view.readinessScore} toward the ${COPILOT_GATE_TARGET} Gate.`;
  return (
    `${lead} How far they carry you is priced phase by phase on the statement of work rather than projected here — ` +
    "and the last stretch is adoption enablement, which is training rather than configuration and is not something " +
    "any script in this guide performs."
  );
}
