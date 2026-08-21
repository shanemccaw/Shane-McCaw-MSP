/**
 * sopHubData.ts — the SOPs & Runbooks hub fixtures and the design's own helpers.
 *
 * Part 6 of PORTAL_V2_PARALLEL_PLAN.md. The hub (`/portal-v2/sops`) and its three
 * sub-views — library / execution queue / execution history — are a direct port
 * of the prototype's `isSopHub` block (`Customer Portal Shell.dc.html` 1633-1978)
 * and its logic class (`SOP_LIBRARY` 16346, `SOP_META` 16611, `SOP_QUEUE` 16852,
 * `SOP_AUDIT` 16913, and the derivations around them).
 *
 * ── UI-only, fixtures are the design's own ─────────────────────────────────
 * Every value here is transcribed verbatim from the design's logic class. Copy
 * is final: nothing is reworded, shortened or "improved". A later pass wires the
 * hub to a live SOP source; until then this module is the single place a value
 * lives, so the wiring pass has one file to change rather than JSX to hunt
 * through. The pure derivations that turn these fixtures into what the page draws
 * live in `sopHubModel.ts` and are unit-tested.
 *
 * ── Why a css() string parser (as Change Control does) ─────────────────────
 * This design computes dozens of inline styles as CSS strings from tones and
 * state. Keeping the design's strings verbatim and parsing them once at render
 * time is the lower-defect choice at this scale than hand-converting each to a
 * camelCase object — the same call `ccPageData.ts` made. `css()` below is a
 * private copy so this module stays independent of Part 4's file.
 */

import type { CSSProperties } from "react";

/** The design's monospace stack (proto: 'SF Mono',Menlo,Consolas,monospace). */
export const MONO = "'SF Mono',Menlo,Consolas,monospace";

/**
 * Parse a design CSS string into a React style object. Splits declarations on
 * `;` and each on its FIRST `:` (values carry `:`-free content but do carry `/`,
 * commas and parentheses). Property names are kebab→camel; values stay strings,
 * which React accepts for every property.
 */
export function css(input: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const decl of input.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const rawKey = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!rawKey || !value) continue;
    const key = rawKey.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[key] = value;
  }
  return out as CSSProperties;
}

/* ── Types ──────────────────────────────────────────────────────────────── */

export type SopSource = "baseline" | "ours";

export interface SopRun {
  when: string;
  who: string;
  outcome: string;
  state: string;
}

export interface SopLibraryItem {
  id: string;
  title: string;
  source: SopSource;
  category: string;
  purpose: string;
  forWho: string;
  updated: string;
  author: string;
  reviewCadence: string;
  runnable: boolean;
  finding: string | null;
  steps: readonly string[];
  runs: readonly SopRun[];
}

export interface SopMeta {
  code: string;
  level: string;
  tags: readonly string[];
  avg: string;
  execs: number;
  /** Step-index → Graph/PowerShell endpoint, for the automated steps. */
  auto: Readonly<Record<number, string>>;
}

export interface SopQueueStep {
  t: string;
  s: "done" | "now" | "todo";
  by: string;
}

export interface SopQueueItem {
  code: string;
  title: string;
  mode: string;
  step: string;
  pct: number;
  started: string;
  who: string;
  state: "Running" | "Queued";
  owner: string;
  cr: string;
  svc: string;
  steps: readonly SopQueueStep[];
}

export interface SopAuditItem {
  when: string;
  code: string;
  action: string;
  actor: string;
  detail: string;
  result: "Success" | "Partial" | "Failure";
  hash: string;
}

/* ── The library — proto SOP_LIBRARY (16346) ────────────────────────────── */

export const SOP_LIBRARY: readonly SopLibraryItem[] = [
  {
    id: "sop-legacy-auth",
    title: "Disable legacy authentication safely",
    source: "baseline",
    category: "Identity",
    purpose:
      "Retire IMAP, POP3 and SMTP AUTH without cutting off the accounts that still depend on them.",
    forWho: "Run by us, or by your service desk lead with an Exchange Administrator role.",
    updated: "Updated 4 August 2026 · v4",
    author: "Shane McCaw Consulting",
    reviewCadence: "Reviewed quarterly and whenever Microsoft changes protocol defaults",
    runnable: true,
    finding: "Security · Legacy Auth · CA001",
    steps: [
      "Pull 30 days of sign-in logs filtered on clientAppUsed to list every account still using a legacy protocol.",
      "For each account, identify what is actually connecting — a person, a device, or a service — before changing anything.",
      "Move each one to its replacement: modern-auth client for people, direct send for devices, app-only Graph for services.",
      "Verify the replacement works with a test send or a test poll, per account.",
      "Disable IMAP and POP per mailbox with Set-CASMailbox.",
      "Disable SMTP AUTH tenant-wide with Set-TransportConfig once no sender depends on it.",
      "Create CA001 in report-only, review for 7 days, then switch to On so new accounts inherit the block.",
      "Re-scan and file the before-and-after sign-in counts as evidence.",
    ],
    runs: [
      {
        when: "14 August 2026",
        who: "Priya Raman · architect",
        outcome:
          "Stages 1–4 complete. 3 of 4 accounts migrated; the scanner mailbox is waiting on firmware.",
        state: "Part-complete",
      },
      {
        when: "19 June 2026",
        who: "Automated via Graph",
        outcome: "Dry run only — produced the account inventory, no changes applied.",
        state: "Dry run",
      },
    ],
  },
  {
    id: "sop-sharing-reset",
    title: "Reset a site above the sharing baseline",
    source: "baseline",
    category: "Sharing",
    purpose:
      "Bring a SharePoint site whose sharing capability drifted above the tenant baseline back into line, without breaking live external collaboration.",
    forWho: "Run by us, or by a SharePoint Administrator.",
    updated: "Updated 11 July 2026 · v3",
    author: "Shane McCaw Consulting",
    reviewCadence: "Reviewed quarterly",
    runnable: true,
    finding: "Governance · External Sharing Drift",
    steps: [
      "Compare each site’s SharingCapability against the tenant value to confirm which sites are genuinely above baseline.",
      "For each drifted site, list active external users and live sharing links before touching the setting.",
      "Contact the site owner where external collaboration is active, and agree a date.",
      "Set the site back to the tenant baseline with Set-SPOSite.",
      "Re-run the comparison to confirm zero sites above baseline.",
      "Tell the site owners what changed and why, so it is not raised again next week.",
    ],
    runs: [
      {
        when: "2 August 2026",
        who: "Automated via Graph",
        outcome: "3 sites reset. Comparison now reports zero above baseline.",
        state: "Complete",
      },
    ],
  },
  {
    id: "sop-ownerless",
    title: "Recover an ownerless group or Team",
    source: "baseline",
    category: "Identity",
    purpose:
      "Get a working owner back onto a group or Team that has none, using contribution data rather than guesswork.",
    forWho: "Run by us, or by a Groups Administrator.",
    updated: "Updated 28 July 2026 · v2",
    author: "Shane McCaw Consulting",
    reviewCadence: "Reviewed twice a year",
    runnable: true,
    finding: "Governance · Group and Team ownership",
    steps: [
      "Resolve the real owner count by checking accountEnabled on every listed owner — a disabled owner is not an owner.",
      "Pull 90 days of contribution data to find the two most active members.",
      "Propose both to their manager rather than assigning unilaterally.",
      "Add the confirmed owners, then remove any disabled accounts from the owner list.",
      "Where nobody accepts, enable the ownerless-group notification and give members 30 days.",
      "Record the outcome, including groups that were archived rather than owned.",
    ],
    runs: [
      {
        when: "13 August 2026",
        who: "Priya Raman · architect",
        outcome: "19 of 26 groups given confirmed owners. 7 routed to the ownerless notification.",
        state: "Complete",
      },
    ],
  },
  {
    id: "sop-retention-scope",
    title: "Bring uncovered mailboxes into retention",
    source: "baseline",
    category: "Data lifecycle",
    purpose:
      "Close a retention coverage gap with an adaptive scope so the same gap cannot reopen after onboarding.",
    forWho: "Run by us, or by a Compliance Administrator.",
    updated: "Updated 14 August 2026 · v2",
    author: "Shane McCaw Consulting",
    reviewCadence: "Reviewed quarterly",
    runnable: true,
    finding: "Compliance · CMP-01",
    steps: [
      "Run Policy lookup across every mailbox to list what is genuinely uncovered.",
      "Build an adaptive scope rather than a static list, so membership re-evaluates.",
      "Set the retention period from the records schedule, not from a default.",
      "Apply and verify coverage per location before recording anything.",
      "Record the effective date — this is the field an auditor asks for.",
      "Note plainly that retention starts from the effective date and is not retroactive.",
    ],
    runs: [
      {
        when: "14 August 2026",
        who: "Automated via Graph",
        outcome: "All 1,240 mailboxes covered. Evidence exported with effective dates.",
        state: "Complete",
      },
    ],
  },
  {
    id: "sop-guest-review",
    title: "Quarterly guest access review",
    source: "baseline",
    category: "Identity",
    purpose: "Run a guest review that produces decisions rather than a spreadsheet nobody reads.",
    forWho: "Run by us with your sponsors as reviewers.",
    updated: "Updated 2 June 2026 · v5",
    author: "Shane McCaw Consulting",
    reviewCadence: "Reviewed twice a year",
    runnable: true,
    finding: "Governance · Guest Access",
    steps: [
      "Build the guest list with last sign-in, externalUserState and group memberships attached.",
      "Route each guest to the person who invited them, not to IT.",
      "Set the first cycle default to no change, so an unanswered review does not remove access unexpectedly.",
      "Remove never-accepted invitations older than 30 days without waiting for a reviewer.",
      "Reassign content owned by any guest being removed, before removal.",
      "Publish the outcome: how many kept, scoped, and removed.",
    ],
    runs: [],
  },
  {
    id: "sop-breakglass",
    title: "Break-glass account test",
    source: "baseline",
    category: "Incident response",
    purpose: "Prove the emergency accounts work, before the day you need them.",
    forWho: "Run jointly — you hold the credentials, we witness and document.",
    updated: "Updated 19 May 2026 · v3",
    author: "Shane McCaw Consulting",
    reviewCadence: "Quarterly, non-negotiable",
    runnable: false,
    finding: "Security · Break-glass coverage",
    steps: [
      "Confirm both accounts are excluded from every Conditional Access policy, including report-only ones.",
      "Sign in with each account from a clean browser session and record the timestamp.",
      "Confirm the sign-in alert fired to the security mailbox within 5 minutes.",
      "Confirm each account can still reach the Entra and Exchange admin centres.",
      "Rotate the credentials and re-seal them with the two custodians.",
      "File the test record with both custodian signatures and the date.",
    ],
    runs: [
      {
        when: "4 July 2026",
        who: "Joint · Jordan Diaz and Priya Raman",
        outcome:
          "Account 1 passed. Account 2 signed in but no alert fired — alert rule created, retested and passed.",
        state: "Complete",
      },
    ],
  },
  {
    id: "sop-dr-tenant-outage",
    title: "DR playbook · tenant-wide service outage",
    source: "baseline",
    category: "DR playbooks",
    purpose:
      "What to do in the first hour of a Microsoft 365 outage, and what not to do — most damage in an outage comes from changes made in a hurry.",
    forWho: "IT lead first, then service desk. We join within 4 business hours on Premier.",
    updated: "Updated 22 July 2026 · v6",
    author: "Shane McCaw Consulting",
    reviewCadence: "Reviewed twice a year and after any real invocation",
    runnable: false,
    finding: "Health · Service health",
    steps: [
      "Confirm it is Microsoft and not you: check the Service health dashboard and the Message Center before touching a single setting.",
      'Post the known state in your announcements channel within 15 minutes, even if the known state is "we are checking".',
      "Do not change Conditional Access, DNS, or licensing during an outage. Every one of those has caused a longer second outage.",
      "If authentication is affected, check whether EM001 or EM002 applies — those emergency policies exist for exactly this and are kept in an Off state.",
      "Record the start time, the affected services, and the user impact as you go, not afterwards.",
      "When Microsoft confirms resolution, verify independently with a test per affected service before you announce it.",
      "Within 5 working days, write the post-incident note: what broke, what you did, what you would do differently.",
    ],
    runs: [
      {
        when: "10 August 2026",
        who: "Jordan Diaz",
        outcome:
          "Exchange delayed delivery, 4h 12m. Playbook followed, no configuration changes made during the window.",
        state: "Complete",
      },
    ],
  },
  {
    id: "sop-dr-ransomware",
    title: "DR playbook · mass file encryption or deletion",
    source: "baseline",
    category: "DR playbooks",
    purpose:
      "Contain and recover from ransomware or a runaway process encrypting or deleting files at scale in SharePoint and OneDrive.",
    forWho: "Run jointly. Call us immediately — this is the one playbook where waiting costs the most.",
    updated: "Updated 5 August 2026 · v7",
    author: "Shane McCaw Consulting",
    reviewCadence: "Reviewed quarterly, tested annually",
    runnable: false,
    finding: "Security · Data protection",
    steps: [
      "Identify the account or app doing it, and disable it first. Containment before investigation.",
      "Revoke that identity’s sessions and refresh tokens — disabling the account alone leaves live tokens working.",
      "Check for a recently consented OAuth app with write access. This is the most common vector and the most missed.",
      "Do not delete anything and do not empty recycle bins. Both are recovery sources.",
      "Use SharePoint site restore to roll a whole library back to a point in time rather than restoring file by file.",
      "For OneDrive, trigger Files Restore per affected user from the admin centre.",
      "Preserve the audit log export for the window before it ages out — at 180 days retention this is time-limited.",
      "Only after recovery: re-enable the identity, or rebuild it if compromise is confirmed.",
    ],
    runs: [],
  },
  {
    id: "sop-dr-admin-compromise",
    title: "DR playbook · administrator account compromise",
    source: "baseline",
    category: "DR playbooks",
    purpose: "Regain control when a privileged account is believed to be compromised.",
    forWho: "Run jointly, with break-glass credentials to hand before you start.",
    updated: "Updated 5 August 2026 · v5",
    author: "Shane McCaw Consulting",
    reviewCadence: "Reviewed quarterly",
    runnable: false,
    finding: "Security · Privileged access",
    steps: [
      "Have both break-glass accounts available and verified before touching the compromised account.",
      "Revoke all sessions for the account, then reset the password, then re-register MFA. In that order.",
      "Check for added authentication methods, added app passwords, and new mailbox forwarding rules.",
      "Review directory audit for role assignments, app consents, and CA policy changes made by that account.",
      "Check for new app registrations or credentials added to existing ones — persistence usually lives there.",
      "Reverse everything the account changed in the exposure window, using the audit log as the list.",
      "Keep the account disabled until every reversal is verified, then decide whether to rebuild rather than restore.",
    ],
    runs: [],
  },
  {
    id: "sop-dr-mfa-outage",
    title: "DR playbook · MFA or identity provider disruption",
    source: "baseline",
    category: "DR playbooks",
    purpose:
      "Keep people working during an authentication provider failure without simply switching MFA off.",
    forWho: "IT lead, with a second administrator present. Never run alone.",
    updated: "Updated 22 July 2026 · v4",
    author: "Shane McCaw Consulting",
    reviewCadence: "Reviewed twice a year",
    runnable: false,
    finding: "Security · CA emergency policies",
    steps: [
      "Confirm the failure is provider-side, not a policy change made in the last 24 hours.",
      "Do not disable MFA tenant-wide. That is the decision people regret, and it takes weeks to unwind.",
      "Activate EM001 — it trades the MFA requirement for a hybrid-joined device requirement rather than removing the control.",
      "If the failure is the identity provider rather than MFA, activate EM002 instead, which falls back to trusted network location.",
      "Announce which policy is active and what it means for people working remotely.",
      "When the provider recovers, switch the emergency policy back to Off and confirm normal policies are enforcing again.",
      "Record the activation and deactivation times — this is an audit event, not just an operational one.",
    ],
    runs: [],
  },
  {
    id: "sop-onboarding-new",
    title: "New starter provisioning",
    source: "ours",
    category: "Onboarding",
    purpose: "Our internal joiner process, from the HR trigger to a working desk on day one.",
    forWho: "Service desk, triggered by HR from the new-starter form.",
    updated: "Edited 8 August 2026 by R. Delgado",
    author: "Written by your team",
    reviewCadence: "Reviewed when the HR process changes",
    runnable: false,
    finding: null,
    steps: [
      "HR submits the new-starter form at least 5 working days before the start date.",
      "Create the account from the department template so licences and group membership follow the role rather than being guessed.",
      "Assign licences through the department licence group, never directly.",
      "Enrol the device in Intune before it leaves the desk, and confirm compliance shows green.",
      "Register MFA with the person on day one, in person or on video. Passkey first, Authenticator as the backup.",
      "Confirm OneDrive Known Folder Move has applied before they start saving work anywhere.",
      'Add them to the department channel and send the one-page "how we work" note.',
      "Manager confirms access is correct at the end of week one — this catches over-provisioning early.",
    ],
    runs: [],
  },
  {
    id: "sop-offboarding",
    title: "Employee offboarding",
    source: "ours",
    category: "Onboarding",
    purpose:
      "Our internal leaver process, covering the HR steps and the tenant steps in the order we do them.",
    forWho: "Service desk, with HR triggering it from the leaver form.",
    updated: "Edited 12 August 2026 by Jordan Diaz",
    author: "Written by your team",
    reviewCadence: "Reviewed when the HR process changes",
    runnable: false,
    finding: null,
    steps: [
      "HR raises the leaver ticket at least 3 working days before the last day.",
      "Manager confirms the successor for anything the leaver owns — groups, Teams, app registrations.",
      "Service desk collects hardware on the last day and records the asset tags.",
      "Disable the account at 17:00 on the last day, do not delete it.",
      "Convert the mailbox to shared where the manager has asked for continued access, or apply an inactive-mailbox hold.",
      "Remove licences and return the seats to the pool.",
      "Reassign owned groups and Teams to the named successor.",
      "After 90 days, review whether the account can be deleted.",
    ],
    runs: [],
  },
  {
    id: "sop-change-window",
    title: "Change window and approval",
    source: "ours",
    category: "Incident response",
    purpose: "What counts as a change, who approves it, and when we are allowed to make it.",
    forWho: "Everyone with an administrative role, including our MSP.",
    updated: "Edited 3 July 2026 by Jordan Diaz",
    author: "Written by your team",
    reviewCadence: "Annual",
    runnable: false,
    finding: null,
    steps: [
      "Any change to a tenant-wide setting, a Conditional Access policy, or a retention policy is a change and needs a ticket.",
      "Changes are made Tuesday to Thursday, 09:00 to 16:00, outside month-end week.",
      "Two approvals for anything touching authentication: IT lead plus one other administrator.",
      "Emergency changes may be made immediately and must be ticketed within 24 hours with a reason.",
      "Every change records what was changed, from what, to what, and by whom.",
      "Post-change verification is part of the change, not a follow-up task.",
    ],
    runs: [],
  },
  {
    id: "sop-guest-request",
    title: "Requesting guest access for an external party",
    source: "ours",
    category: "Sharing",
    purpose: "How our staff get an external person access, now that invitations are restricted.",
    forWho: "Anyone. Written for people who do not work in IT.",
    updated: "Edited 13 August 2026 by Jordan Diaz",
    author: "Written by your team",
    reviewCadence: "Review after 3 months of use",
    runnable: false,
    finding: null,
    steps: [
      "Check whether the person already has access — most vendors already do.",
      "Raise a guest request with the person’s work email address, never a personal one.",
      'Name the sites or Teams they need. "Everything" will be sent back.',
      "Give an end date. Every guest gets one, and it can be extended.",
      "You are the sponsor for that guest until the end date, which means you get the review email.",
      "Tell the service desk when the work finishes early so access can be removed sooner.",
    ],
    runs: [],
  },
  {
    id: "sop-records-schedule",
    title: "Records retention schedule",
    source: "ours",
    category: "Data lifecycle",
    purpose: "What we keep, for how long, and the obligation behind each period.",
    forWho: "Finance, Legal and IT. Referenced by every retention policy in the tenant.",
    updated: "Edited 14 March 2026 by Controller",
    author: "Written by your team",
    reviewCadence: "Annual, with Legal",
    runnable: false,
    finding: null,
    steps: [
      "Financial records and anything relating to an audit: 7 years, under SOX §802.",
      "Contracts and signed statements of work: 7 years from expiry.",
      "HR records: 6 years from end of employment.",
      "Teams chat: 1 year — classified as transitory communication, decision recorded as RR-2026-011.",
      "Marketing and campaign material: 2 years.",
      "Anything under legal hold: indefinite, and the hold takes precedence over every line above.",
    ],
    runs: [],
  },
  {
    id: "sop-mfa-lockout",
    title: "Staff MFA lockout — first response",
    source: "ours",
    category: "Identity",
    purpose: "What the service desk does when someone cannot get past an MFA prompt.",
    forWho: "Service desk, first line.",
    updated: "Edited 29 July 2026 by R. Delgado",
    author: "Written by your team",
    reviewCadence: "Review after 6 months",
    runnable: false,
    finding: null,
    steps: [
      "Verify identity by video call or in person. Never by email alone, and never from a request in chat.",
      "Confirm whether the phone is lost, replaced, or just not receiving prompts — the three have different fixes.",
      "For a replaced device, walk them through re-registering Authenticator on the new one.",
      "For a lost device, revoke the old method before registering a new one.",
      "Never issue a temporary access pass without manager confirmation in writing.",
      "Record the reason, because a pattern of lockouts in one team usually means something else is wrong.",
    ],
    runs: [],
  },
  {
    id: "sop-suspected-phish",
    title: "Suspected phishing report",
    source: "ours",
    category: "Incident response",
    purpose: "What happens when someone reports a suspicious message.",
    forWho: "Service desk and anyone who reports a message.",
    updated: "Edited 21 June 2026 by R. Delgado",
    author: "Written by your team",
    reviewCadence: "Annual",
    runnable: false,
    finding: null,
    steps: [
      "The reporter uses the Report button in Outlook rather than forwarding the message.",
      "Service desk checks whether anyone else received it, and whether anyone clicked.",
      "If anyone clicked: reset their password, revoke sessions, and check for new mailbox rules.",
      "Check for a new OAuth consent from that account — this is the step most often missed.",
      "Block the sender and submit the message to Microsoft.",
      "If more than 5 recipients were targeted, tell us — it usually means a campaign rather than a one-off.",
    ],
    runs: [],
  },
];

/* ── Codes, compliance tags, automation level, execution stats — proto SOP_META (16611) ── */

export const SOP_META: Readonly<Record<string, SopMeta>> = {
  "sop-legacy-auth": {
    code: "SOP-IDN-004",
    level: "Partially automated",
    tags: ["ISO 27001 A.9", "HIPAA §164.312(d)"],
    avg: "11m 40s",
    execs: 6,
    auto: {
      0: "GET /beta/auditLogs/signIns?$filter=clientAppUsed eq 'IMAP4'",
      4: "Exchange Online · Set-CASMailbox -ImapEnabled $false",
      5: "Exchange Online · Set-TransportConfig -SmtpClientAuthenticationDisabled $true",
      6: "POST /v1.0/identity/conditionalAccess/policies",
      7: "POST /v1.0/security/auditLog/queries",
    },
  },
  "sop-sharing-reset": {
    code: "SOP-SHR-002",
    level: "Fully automated",
    tags: ["ISO 27001 A.9", "SOX §404"],
    avg: "4m 12s",
    execs: 9,
    auto: {
      0: "SharePoint · Get-SPOSite -Limit All",
      1: "GET /v1.0/sites/{id}/drive/items/{id}/permissions",
      3: "SharePoint · Set-SPOSite -SharingCapability",
      4: "SharePoint · Get-SPOSite -Limit All",
    },
  },
  "sop-ownerless": {
    code: "SOP-IDN-011",
    level: "Partially automated",
    tags: ["ISO 27001 A.9", "SOX §404"],
    avg: "9m 05s",
    execs: 4,
    auto: {
      0: "GET /v1.0/groups?$expand=owners($select=accountEnabled)",
      1: "GET /v1.0/reports/getOffice365GroupsActivityDetail(period='D90')",
      3: "POST /v1.0/groups/{id}/owners/$ref",
    },
  },
  "sop-retention-scope": {
    code: "SOP-DLM-001",
    level: "Fully automated",
    tags: ["SOX §802", "GDPR Art. 5(1)(e)"],
    avg: "6m 30s",
    execs: 3,
    auto: {
      0: "Purview · Get-RetentionCompliancePolicy -DistributionDetail",
      1: "Purview · New-AdaptiveScope",
      3: "Purview · Set-RetentionCompliancePolicy",
      4: "Purview · Get-RetentionComplianceRule",
    },
  },
  "sop-guest-review": {
    code: "SOP-IDN-018",
    level: "Partially automated",
    tags: ["GDPR Art. 5(1)(c)", "ISO 27001 A.9"],
    avg: "Not yet run",
    execs: 0,
    auto: {
      0: "GET /v1.0/users?$filter=userType eq 'Guest'&$select=signInActivity,externalUserState",
      1: "POST /v1.0/identityGovernance/accessReviews/definitions",
      3: "DELETE /v1.0/users/{id}",
    },
  },
  "sop-breakglass": {
    code: "SOP-IRP-003",
    level: "Manual with verification",
    tags: ["ISO 27001 A.9", "SOC 2 CC6.1"],
    avg: "22m 00s",
    execs: 2,
    auto: { 0: "GET /v1.0/identity/conditionalAccess/policies" },
  },
  "sop-dr-tenant-outage": {
    code: "RBK-DRP-001",
    level: "Manual with verification",
    tags: ["ISO 22301", "SOC 2 A1.2"],
    avg: "—",
    execs: 1,
    auto: { 0: "GET /v1.0/serviceAnnouncement/issues" },
  },
  "sop-dr-ransomware": {
    code: "RBK-DRP-004",
    level: "Manual with verification",
    tags: ["ISO 22301", "NIST IR-4"],
    avg: "—",
    execs: 0,
    auto: { 1: "POST /v1.0/users/{id}/revokeSignInSessions" },
  },
  "sop-dr-admin-compromise": {
    code: "RBK-DRP-006",
    level: "Manual with verification",
    tags: ["NIST IR-4", "SOC 2 CC7.3"],
    avg: "—",
    execs: 0,
    auto: {
      1: "POST /v1.0/users/{id}/revokeSignInSessions",
      3: "GET /v1.0/auditLogs/directoryAudits",
    },
  },
  "sop-dr-mfa-outage": {
    code: "RBK-DRP-008",
    level: "Manual with verification",
    tags: ["ISO 22301"],
    avg: "—",
    execs: 0,
    auto: { 2: "PATCH /v1.0/identity/conditionalAccess/policies/{id}" },
  },
  "sop-onboarding-new": {
    code: "SOP-HRP-001",
    level: "Reference only",
    tags: ["ISO 27001 A.7"],
    avg: "—",
    execs: 0,
    auto: {},
  },
  "sop-offboarding": {
    code: "SOP-HRP-002",
    level: "Reference only",
    tags: ["ISO 27001 A.7", "GDPR Art. 17"],
    avg: "—",
    execs: 0,
    auto: {},
  },
  "sop-change-window": {
    code: "SOP-OPS-001",
    level: "Reference only",
    tags: ["SOC 2 CC8.1"],
    avg: "—",
    execs: 0,
    auto: {},
  },
  "sop-guest-request": {
    code: "SOP-SHR-006",
    level: "Reference only",
    tags: ["ISO 27001 A.9"],
    avg: "—",
    execs: 0,
    auto: {},
  },
  "sop-records-schedule": {
    code: "SOP-DLM-004",
    level: "Reference only",
    tags: ["SOX §802", "GDPR Art. 5(1)(e)"],
    avg: "—",
    execs: 0,
    auto: {},
  },
  "sop-mfa-lockout": {
    code: "SOP-IDN-022",
    level: "Reference only",
    tags: ["ISO 27001 A.9"],
    avg: "—",
    execs: 0,
    auto: {},
  },
  "sop-suspected-phish": {
    code: "SOP-IRP-011",
    level: "Reference only",
    tags: ["NIST IR-4", "SOC 2 CC7.2"],
    avg: "—",
    execs: 0,
    auto: {},
  },
};

export const SOP_FALLBACK_META: SopMeta = {
  code: "—",
  level: "Reference only",
  tags: [],
  avg: "—",
  execs: 0,
  auto: {},
};

/** proto sopMetaFor (16630). */
export function sopMetaFor(id: string): SopMeta {
  return SOP_META[id] ?? SOP_FALLBACK_META;
}

/* ── Filter option lists — proto 16631-16644 ────────────────────────────── */

export const SOP_EXEC_TYPES: readonly { key: string; label: string }[] = [
  { key: "all", label: "All execution types" },
  { key: "Fully automated", label: "Fully automated" },
  { key: "Partially automated", label: "Partially automated" },
  { key: "Manual with verification", label: "Manual with verification" },
  { key: "Reference only", label: "Reference only" },
];

export const SOP_TAGS: readonly string[] = [
  "All tags",
  "SOX §802",
  "SOX §404",
  "GDPR Art. 5(1)(e)",
  "GDPR Art. 17",
  "ISO 27001 A.9",
  "ISO 22301",
  "NIST IR-4",
  "SOC 2 CC7.3",
  "HIPAA §164.312(d)",
];

/** The Category select's fixed list — proto sopCatOptions (16639). */
export const SOP_CAT_OPTIONS: readonly string[] = [
  "All",
  "Identity",
  "Sharing",
  "Data lifecycle",
  "DR playbooks",
  "Incident response",
  "Onboarding",
];

export const SOP_SOURCE_OPTIONS: readonly { key: string; label: string }[] = [
  { key: "all", label: "All procedures" },
  { key: "baseline", label: "Shane McCaw baseline" },
  { key: "ours", label: "Written by your team" },
];

/** proto sopSourceMeta (16657) — the source chip tone, label and note. */
export const SOP_SOURCE_META: Readonly<
  Record<SopSource, { c: string; label: string; note: string }>
> = {
  baseline: {
    c: "#60a5fa",
    label: "Shane McCaw baseline",
    note: "Maintained by us. Updated when Microsoft changes behaviour.",
  },
  ours: {
    c: "#22d3ee",
    label: "Written by your team",
    note: "Your internal policy. We read it, we do not edit it.",
  },
};

/* ── The live execution queue — proto SOP_QUEUE (16852) ─────────────────── */

export const SOP_QUEUE: readonly SopQueueItem[] = [
  {
    code: "SOP-IDN-004",
    title: "Disable legacy authentication safely",
    mode: "Automated steps only",
    step: "Step 5 of 8 · Disabling IMAP per mailbox",
    pct: 62,
    started: "Started 4 minutes ago",
    who: "Jordan Diaz",
    state: "Running",
    owner: "sm",
    cr: "CR-0117",
    svc: "Exchange Online",
    steps: [
      { t: "Export the legacy-auth sign-in report", s: "done", by: "Jordan Diaz · 09:11" },
      { t: "Confirm the 11 Bay 3 scanners are excluded", s: "done", by: "Jordan Diaz · 09:12" },
      { t: "Notify the mailbox owners", s: "done", by: "Automated · 09:12" },
      { t: "Disable POP per mailbox", s: "done", by: "Graph · 09:13" },
      { t: "Disable IMAP per mailbox", s: "now", by: "218 of 349 mailboxes" },
      { t: "Disable SMTP AUTH tenant-wide", s: "todo", by: "Waits on the step above" },
      { t: "Re-run the sign-in report", s: "todo", by: "" },
      { t: "Record the result against CR-0117", s: "todo", by: "" },
    ],
  },
  {
    code: "SOP-DLM-001",
    title: "Bring uncovered mailboxes into retention",
    mode: "Full execution",
    step: "Step 2 of 6 · Building adaptive scope",
    pct: 33,
    started: "Started 1 minute ago",
    who: "Automated · scheduled",
    state: "Running",
    owner: "ab",
    cr: "CR-0121",
    svc: "Purview",
    steps: [
      { t: "Read current retention coverage", s: "done", by: "Graph · 09:14" },
      { t: "Build the adaptive scope", s: "now", by: "Resolving matched mailboxes" },
      { t: "Review the resolved list", s: "todo", by: "Needs Aisha Bello" },
      { t: "Attach the scope to the policy", s: "todo", by: "" },
      { t: "Run policy lookup per mailbox", s: "todo", by: "" },
      { t: "File the evidence", s: "todo", by: "" },
    ],
  },
  {
    code: "SOP-IDN-011",
    title: "Recover an ownerless group or Team",
    mode: "Automated steps only",
    step: "Queued behind 2 running executions",
    pct: 0,
    started: "Queued 6 minutes ago",
    who: "Priya Raman",
    state: "Queued",
    owner: "pr",
    cr: "Standard change",
    svc: "Entra ID",
    steps: [
      { t: "Enumerate ownerless groups", s: "todo", by: "Starts when a slot frees" },
      { t: "Propose owners from usage", s: "todo", by: "" },
      { t: "Send confirmations", s: "todo", by: "" },
      { t: "Apply confirmed owners", s: "todo", by: "" },
    ],
  },
];

/* ── Audit history & verification logs — proto SOP_AUDIT (16913) ────────── */

export const SOP_AUDIT: readonly SopAuditItem[] = [
  {
    when: "19 Aug 2026 · 09:14:22",
    code: "SOP-IDN-004",
    action: "Step executed",
    actor: "Jordan Diaz",
    detail: "Set-CASMailbox -ImapEnabled $false on svc-scanner@tenant.com",
    result: "Success",
    hash: "a91f…7c02",
  },
  {
    when: "19 Aug 2026 · 09:11:04",
    code: "SOP-IDN-004",
    action: "Execution started",
    actor: "Jordan Diaz",
    detail: "Automated steps only · 5 of 8 steps in scope",
    result: "Success",
    hash: "4d17…be55",
  },
  {
    when: "18 Aug 2026 · 16:40:10",
    code: "SOP-DLM-001",
    action: "Verified by re-scan",
    actor: "Automated · scan 14",
    detail: "Policy lookup confirms 1,240 of 1,240 mailboxes covered",
    result: "Success",
    hash: "77c3…19aa",
  },
  {
    when: "15 Aug 2026 · 11:02:38",
    code: "SOP-SHR-002",
    action: "Version published",
    actor: "Shane McCaw Consulting",
    detail: "v3 published — step 2 added to check external users before reset",
    result: "Success",
    hash: "e0b8…4411",
  },
  {
    when: "14 Aug 2026 · 14:22:07",
    code: "SOP-IDN-011",
    action: "Execution completed",
    actor: "Priya Raman",
    detail: "19 of 26 groups given confirmed owners; 7 routed to notification",
    result: "Partial",
    hash: "c5aa…9f31",
  },
  {
    when: "13 Aug 2026 · 10:15:51",
    code: "SOP-SHR-006",
    action: "Customer SOP published",
    actor: "Jordan Diaz",
    detail: "Requesting guest access for an external party · v1",
    result: "Success",
    hash: "2b64…7d18",
  },
  {
    when: "10 Aug 2026 · 08:02:11",
    code: "RBK-DRP-001",
    action: "Runbook invoked",
    actor: "Jordan Diaz",
    detail: "Exchange delayed delivery incident · no configuration changes made",
    result: "Success",
    hash: "9a02…c7e4",
  },
  {
    when: "4 Jul 2026 · 15:48:29",
    code: "SOP-IRP-003",
    action: "Verification recorded",
    actor: "Joint · Diaz and Raman",
    detail: "Break-glass test — account 2 alert rule created and retested",
    result: "Success",
    hash: "ff31…0b90",
  },
];

/* ── Stat cards — proto sopStatCards (16842). The two dynamic figures below
      are the design's own hardcodes; the other two derive in sopHubModel. ── */

/** proto: 'Average execution time' → '8m 22s'. */
export const SOP_AVG_EXEC_TIME = "8m 22s";
/** proto: 'Executions this month' → '11'. */
export const SOP_EXECS_THIS_MONTH = "11";

/* ── Hold banner — proto holdBanner* (20721-20725), a mirror of the Active
      Runbooks hold state. Fixed to the design's HOLD_NOW snapshot (4 windows:
      1 decision due, 1 closing within 24h, 1 clear to close early, 1 running),
      so the banner reads exactly as the prototype draws it for this tenant. A
      later pass points this at the real hold source (holds/*), which Active
      Runbooks already owns; UI-only here, so it is not imported live. ── */

export const SOP_HOLD_BANNER = {
  total: 4,
  due: 1,
  closing: 1,
  early: 1,
} as const;

/* ── Owner resolution — proto RACI_PEOPLE / RACI_OWN / raciKeyFor (7599) ──
      Ported so the library and queue owner avatars resolve to the same people
      the rest of the prototype does, rather than an invented set. Decorative,
      but real: initials and tone come straight from the design's own map. ── */

interface RaciPerson {
  name: string;
  tone: string;
}

const RACI_PEOPLE: Readonly<Record<string, RaciPerson>> = {
  pr: { name: "Priya Raman", tone: "#f472b6" },
  dw: { name: "Dan Whitlock", tone: "#fbbf24" },
  ml: { name: "Marcus Lee", tone: "#60a5fa" },
  ab: { name: "Aisha Bello", tone: "#34d399" },
  ro: { name: "Ruth Okafor", tone: "#a78bfa" },
  jf: { name: "Jo Feltham", tone: "#22d3ee" },
  sm: { name: "Shane McCaw", tone: "#38bdf8" },
  rc: { name: "R. Court", tone: "#f87171" },
  sd: { name: "Service desk", tone: "#94a3b8" },
};

/** Only the responsible (`r`) owner is needed for the avatar. proto RACI_OWN. */
const RACI_OWN_R: Readonly<Record<string, string | null>> = {
  governance: "sm",
  security: "rc",
  compliance: "ab",
  licensing: "pr",
  adoption: "ml",
  health: "jf",
  exchange: "pr",
  sharepoint: "ml",
  teams: "ml",
  entra: "sm",
  purview: "ab",
  intune: "jf",
  copilot: null,
};

/** proto raciKeyFor (7631) — maps an arbitrary label to a service/pillar key. */
export function raciKeyFor(k: string): string {
  const key = String(k || "").toLowerCase();
  if (key in RACI_OWN_R) return key;
  const hit = [
    "exchange",
    "sharepoint",
    "teams",
    "entra",
    "purview",
    "intune",
    "copilot",
    "security",
    "governance",
    "compliance",
    "licensing",
    "adoption",
    "health",
  ].filter((x) => key.indexOf(x) >= 0)[0];
  if (hit) return hit;
  if (/mailbox|mail|transport|phish/.test(key)) return "exchange";
  if (/sharing|site|onedrive/.test(key)) return "sharepoint";
  if (/mfa|admin|conditional|sign-in|ca\b|oauth|app/.test(key)) return "entra";
  if (/retention|label|record|dlp/.test(key)) return "purview";
  if (/device|intune|compliance policy/.test(key)) return "intune";
  return "governance";
}

/** proto initialsOf (7643). */
export function initialsOf(name: string): string {
  return String(name || "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export interface SopOwner {
  init: string;
  name: string;
  tone: string;
  unassigned: boolean;
}

/** proto raciChip (7668), reduced to the avatar's own fields. */
export function sopOwner(key: string): SopOwner {
  const r = RACI_OWN_R[raciKeyFor(key)];
  const p = r ? RACI_PEOPLE[r] : null;
  return {
    init: p ? initialsOf(p.name) : "—",
    name: p ? p.name : "Unassigned",
    tone: p ? p.tone : "rgba(248,113,113,.14)",
    unassigned: !p,
  };
}
