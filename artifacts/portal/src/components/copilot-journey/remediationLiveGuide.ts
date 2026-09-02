/**
 * remediationLiveGuide.ts — the real per-tenant content behind the Full
 * Remediation Guide (#472, document 8 of 9 in the #292 set).
 *
 * RESTORED, TRIMMED, AT THE NEW `artifacts/portal` PATH (Git #1956). The
 * `artifacts/msp-portal` → `artifacts/portal` restructuring (`f40438cd`)
 * deleted this file along with the rest of `copilot-journey` — RemediationGuideBody.tsx,
 * journeyModel.ts, sowLiveScope.ts and everything else that rendered the guide —
 * and preserved the pre-deletion tree at tag `portal-archive-2026-08-29`. Three
 * api-server drift-guard tests (`remediation-tracker-catalogue.test.ts`,
 * `remediation-tracker-verification.test.ts`, `portal-remediation-tracker.test.ts`)
 * read this file and `previewRemediationGuide.ts` directly off disk to guard
 * their own hand-duplicated copies of the step catalogue and `STEP_CHECK_KEYS`
 * against drift, and had been silently ENOENT-ing instead of comparing.
 *
 * `previewRemediationGuide.ts` was restored verbatim — its only dependency
 * (`PillarKey` from `./journeyTokens.ts`) still resolves, since that file is a
 * live re-export shim to the surviving `@workspace/copilot-scan-scene` package.
 * THIS file is restored DATA-ONLY: `STEP_CHECK_KEYS` / `STEP_CHECK_GAPS` /
 * `PROCESS_ONLY_STEP_IDS` / `StepEvidence` / `UNCONFIRMED_EVIDENCE_DETAIL` /
 * `STEP_FILL_INS` / `LIVE_STEP_SCRIPTS` / `LIVE_PRELUDE` are all real, verbatim
 * off the archive tag. The rendering functions that consumed a live
 * `JourneyView`/`JourneyPillarView` (`stepEvidence`, `statValue`, `liveTitle`,
 * `liveCaution`, `liveVerify`, `liveBlastRadius`, `buildLiveRemediationSteps`,
 * `totalFindings`, the `resolve*` prose builders) are NOT restored here — their
 * view-model types lived in `journeyModel.ts`, which itself imports
 * `sowLiveScope.ts` and more, i.e. restoring them cascades into resurrecting
 * most of the deliberately-retired copilot-journey UI. That conflicts with the
 * #1485 architected rebuild order (architect → endpoints → contract pack →
 * Design → wire) and is out of #1956's scope, which is the three drift guards —
 * none of which call these functions, only regex-read the data exports above.
 * The full originals, functions included, are still on `portal-archive-2026-08-29`
 * for whoever rebuilds this guide's UI under #1485.
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
 * `assess:copilot-readiness`. TWENTY-FOUR of the twenty-eight steps map to a
 * real `monitor_checks.key`; two are genuine platform-wide gaps; two are process
 * steps that expect no check. Nothing here was re-derived and nothing was
 * guessed — a wrong check key in a paying customer's runbook is exactly the
 * #441 failure this journey is now built to make impossible.
 *
 * (Steps 24 and 25 — the two adoption/rollout process steps — were removed
 * entirely in #757, since they belong to White-Glove Copilot Adoption
 * (#350/#668) rather than this remediation runbook. The remaining ids are NOT
 * renumbered: s26–s30 keep their own numbers, leaving a deliberate gap.)
 *
 * (#472's closing summary says "23/30 real". Its own final table lists steps
 * 1–17, 19–23, 26 and 29 — 24 rows — and 24 + 2 + 2 is the 28 the guide now
 * holds. The table is the mapping; the 23 is an arithmetic slip in the prose,
 * and `remediationLiveGuide.test.ts` asserts the three sets add up so it cannot
 * be copied back in.)
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
 * this check recorded this finding. A miss is NOT the opposite: the wire only
 * ever carries critical/warning findings, so a check that came back clean, or
 * was never scanned, or was scanned and simply isn't in this list yet, all look
 * identical from here — absence carries no information at all and says so in
 * words. Rendering a miss as "clean" would turn silence into a clean bill of
 * health.
 *
 * ══ 5. STEP 18 IS AN ABSENCE, AND IS EXCLUDED FOR NOW (#658) ═════════════════
 *
 * Audit log retention above 90 days. #472 confirmed against live data that no
 * check anywhere in this platform reads it — not unscanned for this tenant,
 * not gated behind a licence, simply not built. (Step 28, OneDrive sync
 * errors, was the other confirmed absence; #753 built `onedrive:sync-errors`
 * in the same session this comment was last touched, so s28 now lives in
 * `STEP_CHECK_KEYS` and is no longer part of this section.)
 *
 * Because the guide is now built DYNAMICALLY from the tenant's real findings
 * (#658), a step with no check backing it cannot be honestly confirmed OR ruled
 * out per tenant, so it is HARD-EXCLUDED from the live guide for now — it
 * renders for no tenant. This is TEMPORARY: #754 builds the audit-log-retention
 * check (s18); once it lands, the step rejoins as an ordinary mapped step and
 * this exclusion comes out. Its `gap` evidence and honest "the platform
 * measures nothing here" wording (`STEP_CHECK_GAPS`) are kept intact so the
 * moment it can be shown again, it reads as an absence rather than a check
 * that looked and disapproved.
 */

import { type PillarKey } from "./journeyTokens.ts";
import {
  REMEDIATION_GUIDE,
  REMEDIATION_PRELUDE,
  REMEDIATION_STEPS,
  type RemediationBlastRadius,
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
 * ABSENT BY DESIGN: s18 (see `STEP_CHECK_GAPS`) and s27, s30
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
  s28: ["onedrive:sync-errors"],
  s29: ["sharepoint:inactive-sites", "teams:ownerless-teams", "governance:ownerless-groups"],
};

/**
 * The one step no check in this platform measures — confirmed platform-wide by
 * #472, not "not in this tenant's scan package".
 *
 * The wording is the load-bearing part. It states an absence in our own
 * measurement and says explicitly that nothing has been judged, because the one
 * way this can go wrong is reading as a silent fail. It does not apologise, and
 * it does not imply the step is optional.
 *
 * NOTE (#658): this step is currently EXCLUDED from the live guide entirely
 * (see `rendersInLiveGuide`) — a dynamic guide cannot honestly include a step
 * it can neither confirm nor rule out. This wording is kept ready for the
 * moment #754 lands a real check and it can be shown again. (s28's own gap
 * closed here in the same session #753 built `onedrive:sync-errors` — it now
 * lives in `STEP_CHECK_KEYS` above and resolves to `finding`/`unconfirmed`
 * like any other mapped step.)
 */
export const STEP_CHECK_GAPS: Readonly<Record<string, string>> = {
  s18:
    "No check this platform runs reads audit log retention, so this step carries no figure from your tenant. " +
    "That is a gap in what we measure, not a finding about your configuration — nothing here says your retention " +
    "is too short, and nothing says it is sufficient. The action below is standard guidance and is worth running " +
    "on its own merits; the command in the verify line is what tells you where you actually stand.",
};

/**
 * The two steps that are decisions or process rather than configuration, and so
 * expect no check mapping. Listed rather than inferred from "has no `code`",
 * because Steps 27 and 30 do carry a script and are still meta.
 *
 * (Steps 24 and 25 used to be here too; #757 removed them from the catalogue
 * entirely — they were adoption/rollout guidance for White-Glove Copilot
 * Adoption (#350/#668), not remediation.)
 */
export const PROCESS_ONLY_STEP_IDS: readonly string[] = ["s27", "s30"];

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
  /** Steps 27 and 30 — a decision, not a measurement. */
  | { readonly kind: "process" }
  /**
   * Mapped to real checks, but no matching finding reached this document. NEVER
   * a pass. `pillar.findings` is UNCAPPED — journeyModel's own contract is
   * "every real critical/warning finding, worst-first, no cap, here or
   * server-side" — so a miss does NOT mean "only the worst three were shown and
   * this fell off the list". It means this tenant has no recorded critical or
   * warning finding on any of these checks, which is genuinely uninformative:
   * the wire only ever carries critical/warning findings, so a check that came
   * back with nothing to report, one never scanned, and one scanned but not yet
   * in the results all look identical from here.
   *
   * (The old "capped at three" wording confused this `unconfirmed` state with a
   * SEPARATE, unrelated `findingChips` list, which IS sliced to three for the
   * dashboard summary cards — #534. That cap never touched `pillar.findings`.)
   *
   * On a live tenant this state now means the step is DROPPED from the dynamic
   * guide (#658) rather than rendered — see `rendersInLiveGuide`. The constant
   * below is retained as the canonical, non-softenable explanation of what an
   * unconfirmed step is, for the type's contract and its tests.
   */
  | { readonly kind: "unconfirmed"; readonly checkKeys: readonly string[] };

/** The sentence an `unconfirmed` step shows. One constant, so no render site can soften it. */
export const UNCONFIRMED_EVIDENCE_DETAIL =
  "No finding from your last scan matched this step's checks, so it is neither confirmed nor ruled out for your " +
  "tenant — you may or may not have this issue. This document only ever shows a real match as evidence, and the " +
  "absence of one carries no verdict either way: a check with nothing to report, one never scanned, and one simply " +
  "not in your results all look identical from here.";

/**
 * The real finding behind a step, if this tenant has one on record for it.
 *
 * Findings are searched in `PILLAR_KEYS` order and, within a pillar, in the
 * order the wire sent them — which `buildPillarViews` has already ranked
 * criticals-first and then by real signal weight (#414). So a step served by two
 * checks quotes the more severe of the two findings rather than whichever check
 * key happens to sort first.

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
 * A `null` here is a positive statement, not a hole: 19 of the 25 mapped scripts
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

