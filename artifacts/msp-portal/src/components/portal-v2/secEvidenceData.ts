/**
 * secEvidenceData.ts — the three Security "evidence" drill-downs.
 *
 * Transcribed VERBATIM from the prototype's `EVIDENCE_PAGES` map
 * (`Customer Portal Shell.dc.html` 18199-18579): OAuth Apps & Consent Grants,
 * Legacy Authentication, and Email Security. All three share one template
 * (`isEvidencePage`, 5041-5202): purpose → sparkle/wrench stat cards → top-risks
 * toggle → "How we know this" provenance queries → expandable evidence rows
 * (facts / groups / wrench actions) → a secondary tenant-controls panel. This is
 * the same drill-down anatomy the handoff README describes.
 *
 * ── Design content, not tenant data ─────────────────────────────────────────
 * Every string, count, App ID, domain and record is the prototype's fictional
 * Halden Materials tenant. The fixture lives here — one module — so the wiring
 * pass swaps it for the real Graph / DNS / Exchange reads without touching the
 * page. Copy is verbatim; the handoff forbids rewriting or shortening it.
 *
 * Row and stat `fixKey`s open the shared FixPanel (`oauth-*`, `legacy-*`,
 * `email-*`, `ca-*`). No bespoke playbooks exist for them yet, so the panel
 * falls back to a complete generic CR flow — the same contract the reference
 * gov-detail drill-down relies on for its own keys.
 *
 * NO-BACKEND-TO-WIRE: every page's `topRisks` list and `secondaryRows` tenant-controls panel state fixture, per-tenant-sounding prose (e.g. "9 grants use consentType AllPrincipals") with no per-item check backing any of it — genuine backend gaps, not fixed in this pass (Git #1439 audit; flagged for a follow-up issue). `queries`/`sourceNote` are NOT tagged here: they describe the real Graph/DNS/Exchange query shapes a future wiring pass would run, not a tenant-specific claim.
 */

export type EvSrc = "graph" | "dns" | "exo";
export type EvTone = "red" | "amber" | "green" | "blue" | "slate";

export interface EvChip {
  tone: EvTone;
  label: string;
}
export interface EvStatCard {
  label: string;
  value: string;
  sub: string;
  tone: EvTone;
  fixKey?: string;
}
export interface EvQuery {
  src: EvSrc;
  method: string;
  url: string;
  note: string;
}
export interface EvFact {
  k: string;
  v: string;
}
export interface EvGroup {
  label: string;
  items: { primary: string; secondary: string }[];
}
export interface EvAction {
  label: string;
  sub: string;
  fixKey: string;
}
export interface EvRow {
  name: string;
  context: string;
  chips: EvChip[];
  facts: EvFact[];
  groups: EvGroup[];
  actions: EvAction[];
}
export interface EvSecondaryRow {
  name: string;
  detail: string;
  status: string;
  tone: EvTone;
  fixKey?: string;
}
export interface EvidencePage {
  heading: string;
  desc: string;
  sourceNote: string;
  queries: EvQuery[];
  statCards: EvStatCard[];
  topRisks: string[];
  listLabel: string;
  rows: EvRow[];
  secondaryLabel: string;
  secondaryNote: string;
  secondaryRows: EvSecondaryRow[];
}

/** `srcMeta` (18190). */
export const EV_SRC_META: Readonly<Record<EvSrc, { label: string; c: string }>> = {
  graph: { label: "Graph", c: "#60a5fa" },
  dns: { label: "DNS", c: "#22d3ee" },
  exo: { label: "Exchange / Defender", c: "#a78bfa" },
};

/** The `sevPill` tone → hex map (18196). */
export const EV_TONE_C: Readonly<Record<EvTone, string>> = {
  red: "#f87171",
  amber: "#fbbf24",
  green: "#34d399",
  blue: "#60a5fa",
  slate: "#94a3b8",
};

export const EV_MONO = "'SF Mono',Menlo,Consolas,monospace";

/**
 * Overlay real counts onto the OAuth evidence page's "Enterprise apps" and
 * "Tenant-wide consent" stat cards (Git #1233 — see
 * `useSecEvidenceOauthLive.ts` for which two of the five cards have a real,
 * semantically-matching check backing them, and why the other three don't).
 * A null/unresolved field leaves that card on its fixture value — same
 * partial-overlay contract `adpWorkloadsWithLive` uses.
 *
 * NO-BACKEND-TO-WIRE: "App-only permissions", "Unverified publisher" and "Dormant apps" stat cards have no per-tenant check backing them at all — they render this module's fixture numbers unconditionally (Git #1439 audit; not fixed in this pass, flagged for a follow-up issue rather than redesigned here).
 */
export function securityOauthPageWithLive(
  page: EvidencePage,
  live: { enterpriseAppCount: number | null; riskyPermissionGrantCount: number | null },
): EvidencePage {
  if (live.enterpriseAppCount == null && live.riskyPermissionGrantCount == null) return page;
  return {
    ...page,
    statCards: page.statCards.map((s) => {
      if (s.label === "Enterprise apps" && live.enterpriseAppCount != null) {
        return { ...s, value: live.enterpriseAppCount.toLocaleString() };
      }
      if (s.label === "Tenant-wide consent" && live.riskyPermissionGrantCount != null) {
        return { ...s, value: live.riskyPermissionGrantCount.toLocaleString() };
      }
      return s;
    }),
  };
}

/**
 * Overlay the real `security.emailAuthFindingCount` count onto the Email
 * Security evidence page (Git #1430, follow-up to #1414's audit — see
 * `useSecEvidenceEmailLive.ts` for the full seam writeup).
 *
 * The metric is a single aggregate count with no per-domain breakdown, so it
 * can only honestly back one new "Open findings" stat card, prepended when
 * the count resolves — the existing five per-record stat cards have no
 * matching live producer and are left as-is, same partial-overlay contract
 * `securityOauthPageWithLive` uses for its own non-matching cards.
 *
 * The "Domains" evidence-row list (a fabricated `tenant.com` and invented
 * per-domain SPF/DKIM/DMARC records) has no per-domain producer at all —
 * `rows` is unconditionally cleared, live metric or not, so the page never
 * presents fabricated tenant detail as fact. `EvidenceBody` renders an
 * honest empty-state message when `rows.length === 0`.
 *
 * NO-BACKEND-TO-WIRE: the five per-record stat cards (Domains sending mail, SPF, SPF lookups, DKIM signing, DMARC) have no per-domain check backing them — they render this module's fixture numbers unconditionally (Git #1439 audit; not fixed in this pass, flagged for a follow-up issue rather than redesigned here).
 */
export function securityEmailPageWithLive(
  page: EvidencePage,
  live: { emailAuthFindingCount: number | null },
): EvidencePage {
  const honestRows: EvidencePage = { ...page, rows: [] };
  if (live.emailAuthFindingCount == null) return honestRows;
  const findingsCard: EvStatCard = {
    label: "Open findings",
    value: live.emailAuthFindingCount.toLocaleString(),
    sub: "SPF, DKIM, DMARC checks failing tenant-wide",
    tone: live.emailAuthFindingCount > 0 ? "red" : "green",
  };
  return { ...honestRows, statCards: [findingsCard, ...page.statCards] };
}

/**
 * Overlay the real `identity.legacyAuthCount` count onto the Legacy
 * Authentication evidence page's "Legacy sign-ins" stat card (Git #1429 —
 * follow-up from #1414's audit), and unconditionally strip the fabricated
 * evidence-row list.
 *
 * `identity.legacyAuthCount` (`identity:legacy-auth-usage`) is a real, already
 * live-reachable 30-day legacy-protocol sign-in count (proven via
 * `useSecAreaLinksLive` on the Security overview page, #1258/#1337) — it
 * matches exactly what "Legacy sign-ins" claims, so that's the only stat card
 * safe to overlay; the other four (Protocols reachable, Accounts using legacy,
 * CA block policy, Legacy from odd geos) have no real per-tenant producer and
 * stay on their fixture values, same documented-gap treatment
 * `securityOauthPageWithLive` uses for its three unbacked OAuth cards.
 *
 * The evidence-row list (fictional accounts like `svc-scanner@tenant.com`
 * with invented sign-in counts) has no per-account producer at all — this is
 * always stripped, live or not, rather than presented as fact (CLAUDE.md's
 * hard rule against fixture-as-real content). The page renders an honest
 * `NoScanDataState` in its place (see `portal-v2-security-evidence.tsx`).
 */
export function securityLegacyAuthPageWithLive(
  page: EvidencePage,
  live: { legacyAuthCount: number | null },
): EvidencePage {
  return {
    ...page,
    statCards: page.statCards.map((s) =>
      s.label === "Legacy sign-ins" && live.legacyAuthCount != null
        ? { ...s, value: live.legacyAuthCount.toLocaleString() }
        : s,
    ),
    rows: [],
  };
}

export const EVIDENCE_PAGES: Readonly<Record<string, EvidencePage>> = {
  "security-oauth": {
    heading: "OAuth Apps & Consent Grants",
    desc: "Every application with a presence in your tenant, what it was granted, who granted it, and whether it has been used since.",
    sourceNote:
      "Enterprise applications and their grants come straight from Graph. Delegated consent, application permissions, and sign-in activity are three separate queries — the Entra portal never shows them in one view, which is why over-privileged apps sit unnoticed.",
    queries: [
      { src: "graph", method: "GET", url: "/v1.0/servicePrincipals?$select=id,appId,displayName,appOwnerOrganizationId,verifiedPublisher,accountEnabled,createdDateTime", note: "Inventory of every app with a presence in the tenant." },
      { src: "graph", method: "GET", url: "/v1.0/oauth2PermissionGrants?$filter=consentType eq 'AllPrincipals'", note: "Delegated grants that apply to every user at once." },
      { src: "graph", method: "GET", url: "/v1.0/servicePrincipals/{id}/appRoleAssignments", note: "Application permissions — access with no user context behind it." },
      { src: "graph", method: "GET", url: "/beta/auditLogs/signIns?$filter=appId eq '{appId}'", note: "Last actual use, and whether the app is dormant." },
      { src: "graph", method: "GET", url: "/v1.0/auditLogs/directoryAudits?$filter=activityDisplayName eq 'Consent to application'", note: "Who consented, when, and from where." },
    ],
    statCards: [
      { label: "Enterprise apps", value: "148", sub: "service principals in tenant", tone: "slate" },
      { label: "Tenant-wide consent", value: "9", sub: "consentType AllPrincipals", tone: "red", fixKey: "oauth-allprincipals" },
      { label: "App-only permissions", value: "4", sub: "apps acting without a user", tone: "red", fixKey: "oauth-app-roles" },
      { label: "Unverified publisher", value: "23", sub: "no Microsoft publisher check", tone: "amber", fixKey: "oauth-unverified" },
      { label: "Dormant apps", value: "61", sub: "no sign-in in 90 days", tone: "amber", fixKey: "oauth-dormant" },
    ],
    topRisks: [
      "One app holds Mail.ReadWrite and Mail.Send as application permissions — it can read and send as any mailbox in the tenant with no user signed in",
      "Nine grants use consentType AllPrincipals, so a single consent decision applied to all 1,240 users",
      "User consent is unrestricted, so any employee can grant a third-party app access to their mail and files",
      "A service principal secret expired 8 days ago and the app is still retrying 44 times a day — nobody owns it",
      "23 apps come from publishers that never completed Microsoft publisher verification",
    ],
    listLabel: "Flagged Applications",
    rows: [
      {
        name: "Unnamed app",
        context: "a83f2c19-6b4d-47ce-9f31-0d5c88e1a7b2 · no publisher · admin-consented tenant-wide",
        chips: [{ tone: "red", label: "Critical" }, { tone: "red", label: "App-only" }, { tone: "slate", label: "Dormant" }],
        facts: [
          { k: "App ID", v: "a83f2c19-6b4d-47ce-9f31-0d5c88e1a7b2" },
          { k: "Home tenant", v: "Outside your organisation (appOwnerOrganizationId differs)" },
          { k: "Publisher", v: "verifiedPublisher: null" },
          { k: "Consent", v: "Admin consent, tenant-wide, 14 months ago by a former Global Admin" },
          { k: "Last sign-in", v: "No interactive sign-in on record. Two app-only token requests in the last 24 hours." },
          { k: "Credentials", v: "2 client secrets. One expires in 12 days, one has no expiry recorded." },
        ],
        groups: [
          {
            label: "Application permissions (4)",
            items: [
              { primary: "Mail.ReadWrite", secondary: "Read and write mail in every mailbox" },
              { primary: "Mail.Send", secondary: "Send mail as any user, no signed-in user required" },
              { primary: "User.Read.All", secondary: "Read every user profile in the directory" },
              { primary: "Directory.Read.All", secondary: "Read groups, roles, and directory objects" },
            ],
          },
          {
            label: "Consent trail",
            items: [
              { primary: "Admin consent granted", secondary: "d.cho@tenant.com (account since disabled) · 14 months ago" },
              { primary: "No business owner recorded", secondary: "No renewal date, no ticket reference, no approval record" },
            ],
          },
        ],
        actions: [{ label: "Revoke consent and disable this service principal", sub: "Removes all four app role assignments and blocks sign-in", fixKey: "oauth-revoke-unnamed" }],
      },
      {
        name: "Legacy Reporting Service",
        context: "svc-reporting@tenant.com · secret expired 8 days ago · still retrying",
        chips: [{ tone: "red", label: "High" }, { tone: "red", label: "Expired secret" }],
        facts: [
          { k: "App ID", v: "5f1e8d33-90ab-4c17-8e22-77cbb410de95" },
          { k: "Publisher", v: "In-house registration, owner field empty" },
          { k: "Credentials", v: "Client secret expired 8 days ago. 44 failed token requests per day since." },
          { k: "Last successful use", v: "8 days ago" },
        ],
        groups: [
          {
            label: "Application permissions (2)",
            items: [
              { primary: "Directory.Read.All", secondary: "Full directory read" },
              { primary: "Sites.FullControl.All", secondary: "Full control of every SharePoint site" },
            ],
          },
          {
            label: "What it is used for",
            items: [{ primary: "Nightly licensing and site-usage export", secondary: "Feeds a report nobody has opened in 4 months, per the SharePoint access log" }],
          },
        ],
        actions: [{ label: "Retire the app, or re-issue a scoped credential", sub: "Sites.Selected replaces Sites.FullControl.All if the report is still needed", fixKey: "oauth-retire-reporting" }],
      },
      {
        name: "Smart Meetings Notetaker",
        context: "34 individual user consents · unverified publisher · delegated",
        chips: [{ tone: "amber", label: "Medium" }, { tone: "amber", label: "Unverified" }],
        facts: [
          { k: "App ID", v: "c7b2f440-31de-4a08-b6e5-2c9a17f0e3d1" },
          { k: "Publisher", v: "verifiedPublisher: null · multi-tenant app" },
          { k: "Consent", v: "34 separate user consents over 5 months, none reviewed" },
          { k: "Last sign-in", v: "2 hours ago" },
        ],
        groups: [
          {
            label: "Delegated permissions (3)",
            items: [
              { primary: "OnlineMeetingRecording.Read.All", secondary: "Read every meeting recording the signed-in user can reach" },
              { primary: "Calendars.ReadWrite", secondary: "Read and write the user’s calendar" },
              { primary: "Files.Read.All", secondary: "Read all files the user can access, including shared sites" },
            ],
          },
          {
            label: "Consented by (34 users)",
            items: [{ primary: "R. Delgado, K. Osei, J. Park, M. Alvarez", secondary: "and 30 more — full list in the CSV export" }],
          },
        ],
        actions: [{ label: "Restrict user consent so this cannot repeat", sub: "Moves the tenant to admin-consent-workflow for unverified publishers", fixKey: "oauth-user-consent-policy" }],
      },
      {
        name: "Invoice Sync Connector",
        context: "Verified publisher · in active use · over-privileged",
        chips: [{ tone: "amber", label: "Medium" }, { tone: "green", label: "Verified" }],
        facts: [
          { k: "App ID", v: "9d40aa71-52bc-4e6f-b1a3-6ff08c92be14" },
          { k: "Publisher", v: "Verified publisher · MPN ID on record" },
          { k: "Consent", v: "Admin consent, tenant-wide, 7 months ago, with a ticket reference" },
          { k: "Last sign-in", v: "3 days ago · 1,410 calls in 30 days" },
        ],
        groups: [
          {
            label: "Application permissions (1)",
            items: [{ primary: "Files.Read.All", secondary: "Reads every file in the tenant. It only needs one finance site." }],
          },
          {
            label: "Actual access pattern",
            items: [{ primary: "99.4% of calls target /sites/finance-ap", secondary: "Nothing outside that site was read in 30 days" }],
          },
        ],
        actions: [{ label: "Narrow Files.Read.All to Sites.Selected on the finance site", sub: "Keeps the integration working with a fraction of the reach", fixKey: "oauth-narrow-invoice" }],
      },
      {
        name: "PDF Merge Tool (free tier)",
        context: "3 user consents · publisher unverified · home tenant outside your org",
        chips: [{ tone: "amber", label: "Medium" }, { tone: "amber", label: "Unverified" }],
        facts: [
          { k: "App ID", v: "e10c7b98-24fa-4d5e-8ab7-c3d90f21e6b8" },
          { k: "Publisher", v: "verifiedPublisher: null · free consumer tool" },
          { k: "Consent", v: "3 user consents in the last 6 weeks" },
          { k: "Last sign-in", v: "11 days ago" },
        ],
        groups: [
          {
            label: "Delegated permissions (2)",
            items: [
              { primary: "Files.ReadWrite.All", secondary: "Read and write every file those three users can reach" },
              { primary: "offline_access", secondary: "Holds a refresh token, so access continues without the user present" },
            ],
          },
        ],
        actions: [{ label: "Revoke the three grants and notify the users", sub: "Includes a one-line explanation and an approved alternative", fixKey: "oauth-revoke-pdf" }],
      },
      {
        name: "Graph Explorer",
        context: "Microsoft first-party · 6 delegated consents · expected",
        chips: [{ tone: "green", label: "Expected" }, { tone: "blue", label: "First-party" }],
        facts: [
          { k: "App ID", v: "de8bc8b5-d9f9-48b1-a8ad-b748da725064" },
          { k: "Publisher", v: "Microsoft Corporation · verified" },
          { k: "Consent", v: "6 developer accounts, delegated only" },
          { k: "Assessment", v: "Normal for tenants with developers. Noted, not flagged." },
        ],
        groups: [
          {
            label: "Why it shows here",
            items: [{ primary: "Broad delegated scopes, narrow blast radius", secondary: "Every call is bounded by what the signed-in developer can already do" }],
          },
        ],
        actions: [],
      },
    ],
    secondaryLabel: "Tenant consent controls",
    secondaryNote: "The settings that decide whether this list grows again next month.",
    secondaryRows: [
      { name: "User consent for applications", detail: "Users can consent to any app for any permission that does not require admin consent.", tone: "red", status: "Unrestricted", fixKey: "oauth-user-consent-policy" },
      { name: "Admin consent workflow", detail: "Not configured. Users have no route to request an app, so they consent themselves.", tone: "red", status: "Off", fixKey: "oauth-admin-consent-workflow" },
      { name: "Group owner consent", detail: "Group and Teams owners can grant apps access to the group’s data.", tone: "amber", status: "Allowed", fixKey: "oauth-group-owner-consent" },
      { name: "Risk-based step-up consent", detail: "Enabled. Consent is blocked when Microsoft flags the app as risky.", tone: "green", status: "On" },
      { name: "App ownership records", detail: "61 registrations have no owner assigned, so nothing points at a person when a secret expires.", tone: "amber", status: "61 unowned", fixKey: "oauth-assign-owners" },
    ],
  },

  "security-legacy-auth": {
    heading: "Legacy Authentication",
    desc: "Which legacy protocols are still reachable, which accounts are using them, and what is blocking the tenant-wide switch-off.",
    sourceNote:
      "Sign-in telemetry comes from Graph, filtered on clientAppUsed. Per-mailbox protocol state is Exchange Online, not Graph — we read it through Exchange and label it as such rather than pretending it is one API.",
    queries: [
      { src: "graph", method: "GET", url: "/beta/auditLogs/signIns?$filter=clientAppUsed eq 'IMAP4' or clientAppUsed eq 'POP3' or clientAppUsed eq 'Authenticated SMTP'", note: "30-day legacy sign-in history, per account and per IP." },
      { src: "graph", method: "GET", url: "/v1.0/identity/conditionalAccess/policies", note: "Checks whether a legacy-auth block policy exists and is enabled." },
      { src: "graph", method: "GET", url: "/v1.0/reports/authenticationMethods/userRegistrationDetails", note: "Whether the accounts using legacy could satisfy MFA at all." },
      { src: "exo", method: "Get-CASMailbox", url: "-ResultSize Unlimited | ? { $_.ImapEnabled -or $_.PopEnabled -or -not $_.SmtpClientAuthenticationDisabled }", note: "Per-mailbox protocol state. Exchange Online only — Graph does not expose this." },
      { src: "exo", method: "Get-TransportConfig", url: "| fl SmtpClientAuthenticationDisabled", note: "The tenant-wide SMTP AUTH switch." },
    ],
    statCards: [
      { label: "Legacy sign-ins", value: "1,106", sub: "last 30 days", tone: "red" },
      { label: "Protocols reachable", value: "2", sub: "IMAP4 and SMTP AUTH", tone: "red", fixKey: "legacy-disable-protocols" },
      { label: "Accounts using legacy", value: "4", sub: "1 shared, 2 service, 1 user", tone: "red" },
      { label: "CA block policy", value: "Missing", sub: "CA001 not present", tone: "red", fixKey: "ca-CA001-AllUsers-AllApps-BlockLegacyAuth" },
      { label: "Legacy from odd geos", value: "37", sub: "failed attempts, 6 countries", tone: "red" },
    ],
    topRisks: [
      "Legacy protocols cannot present an MFA prompt, so every one of these 1,106 sign-ins bypassed multifactor entirely",
      "A shared mailbox is doing 812 IMAP sign-ins a month with a password that has not rotated in 3 years",
      "37 failed legacy attempts came from countries you do not operate in — someone is password-spraying the protocol",
      "CA001 does not exist, so nothing stops a new account from using legacy tomorrow",
      "SMTP AUTH is enabled tenant-wide, not per mailbox, so the switch-off is currently all-or-nothing",
    ],
    listLabel: "Accounts Using Legacy Protocols",
    rows: [
      {
        name: "svc-scanner@tenant.com",
        context: "IMAP4 · 812 sign-ins in 30 days · shared mailbox",
        chips: [{ tone: "red", label: "Critical" }, { tone: "red", label: "No MFA possible" }],
        facts: [
          { k: "Protocol", v: "IMAP4 (clientAppUsed: IMAP4)" },
          { k: "Volume", v: "812 successful sign-ins in 30 days, roughly every 50 minutes" },
          { k: "Source", v: "Single static IP on the office network. No other geography." },
          { k: "MFA state", v: "No method registered. A shared mailbox cannot complete an MFA prompt." },
          { k: "Password age", v: "Last changed 3 years 2 months ago" },
          { k: "What it does", v: "A document scanner polls the mailbox and files attachments to SharePoint" },
        ],
        groups: [
          {
            label: "Replacement path",
            items: [
              { primary: "Move to an app-only Graph integration", secondary: "Mail.Read scoped to this one mailbox with ApplicationAccessPolicy, no password involved" },
              { primary: "Or move to OAuth IMAP", secondary: "The scanner vendor supports modern auth from firmware 4.2 — yours is on 3.9" },
            ],
          },
        ],
        actions: [{ label: "Disable IMAP4 on this mailbox and cut over to Graph app-only", sub: "Sequenced so the scanner keeps working through the switch", fixKey: "legacy-scanner" }],
      },
      {
        name: "a.reyes@tenant.com",
        context: "Authenticated SMTP · 147 sign-ins · admin account",
        chips: [{ tone: "red", label: "High" }, { tone: "red", label: "Admin" }],
        facts: [
          { k: "Protocol", v: "Authenticated SMTP (clientAppUsed: Authenticated SMTP)" },
          { k: "Volume", v: "147 sign-ins in 30 days from one workstation" },
          { k: "Client", v: "Outlook 2016, build 16.0.4266 — pre-modern-auth" },
          { k: "Role", v: "Holds Exchange Administrator. Also one of the 2 admins excluded from CA101." },
          { k: "MFA state", v: "Registered, but the SMTP path never prompts for it" },
        ],
        groups: [
          {
            label: "Why this one matters most",
            items: [
              { primary: "A privileged account with an MFA-free path", secondary: "The account has MFA registered, and legacy SMTP walks straight past it" },
              { primary: "Fix is a client upgrade, not a policy exception", secondary: "Current Outlook supports modern auth with no workflow change for the user" },
            ],
          },
        ],
        actions: [{ label: "Upgrade the client, then disable SMTP AUTH for this mailbox", sub: "Do this one first — it is the highest-privilege legacy path you have", fixKey: "legacy-admin-smtp" }],
      },
      {
        name: "billing-copier@tenant.com",
        context: "Authenticated SMTP · 121 sign-ins · multifunction printer",
        chips: [{ tone: "amber", label: "Medium" }, { tone: "amber", label: "Device account" }],
        facts: [
          { k: "Protocol", v: "Authenticated SMTP, send-only" },
          { k: "Volume", v: "121 sign-ins in 30 days" },
          { k: "Source", v: "Floor-2 multifunction device, static internal IP" },
          { k: "Mailbox contents", v: "Empty. Send-only account, no stored mail." },
        ],
        groups: [
          {
            label: "Replacement path",
            items: [{ primary: "Use a direct send connector instead of an account", secondary: "Scan-to-email works over the tenant smart host with no credential at all" }],
          },
        ],
        actions: [{ label: "Move the device to direct send and retire the account", sub: "Removes a password from a device nobody patches", fixKey: "legacy-printer" }],
      },
      {
        name: "k.osei@tenant.com",
        context: "IMAP4 · 26 sign-ins · personal mail client",
        chips: [{ tone: "amber", label: "Medium" }, { tone: "red", label: "Spray target" }],
        facts: [
          { k: "Protocol", v: "IMAP4 from a third-party iOS mail client" },
          { k: "Volume", v: "26 successful sign-ins, plus 37 failed attempts from 6 other countries" },
          { k: "Assessment", v: "The failures are not this user. The account is being sprayed over IMAP." },
          { k: "MFA state", v: "Not registered. This user is also in the 8-account MFA gap." },
        ],
        groups: [
          {
            label: "Failed attempts by country",
            items: [
              { primary: "Nigeria (14), Brazil (9), Vietnam (6)", secondary: "All against IMAP4, all password-only" },
              { primary: "Russia (4), India (3), Türkiye (1)", secondary: "Same 30-day window" },
            ],
          },
        ],
        actions: [{ label: "Disable IMAP4, move the user to Outlook mobile, force a password reset", sub: "Three steps in one run, in that order", fixKey: "legacy-user-imap" }],
      },
    ],
    secondaryLabel: "Protocol state",
    secondaryNote: "Read from Exchange Online. Each one is a switch we can throw for you.",
    secondaryRows: [
      { name: "IMAP4", detail: "Enabled tenant-wide. 2 mailboxes actively connecting, 838 sign-ins in 30 days.", tone: "red", status: "Enabled", fixKey: "legacy-imap-off" },
      { name: "Authenticated SMTP", detail: "Enabled tenant-wide via TransportConfig, so the block cannot be scoped per mailbox until that flips.", tone: "red", status: "Enabled", fixKey: "legacy-smtp-off" },
      { name: "POP3", detail: "Disabled. No sign-ins on record in the last 12 months.", tone: "green", status: "Disabled" },
      { name: "Exchange ActiveSync (basic)", detail: "Basic authentication is retired by Microsoft. Modern-auth EAS remains in use by 41 devices.", tone: "green", status: "Modern only" },
      { name: "Conditional Access block (CA001)", detail: "No policy blocks legacy client apps, so protocol switches are the only control in place.", tone: "red", status: "Missing", fixKey: "ca-CA001-AllUsers-AllApps-BlockLegacyAuth" },
    ],
  },

  "security-email": {
    heading: "Email Security",
    desc: "Authentication records for every domain you send from, checked against what Microsoft 365 publishes and what receivers actually require.",
    sourceNote:
      "Graph tells us which domains are verified and what Microsoft expects their records to be. The live records are read from public DNS, and DKIM signing and Defender policies come from Exchange Online. Three sources, labelled so you can verify any line yourself.",
    queries: [
      { src: "graph", method: "GET", url: "/v1.0/domains?$select=id,isVerified,isDefault,authenticationType,supportedServices", note: "Every domain attached to the tenant, including parked ones." },
      { src: "graph", method: "GET", url: "/v1.0/domains/{domain}/serviceConfigurationRecords", note: "The SPF and MX records Microsoft expects for each domain." },
      { src: "dns", method: "TXT", url: "dig +short TXT {domain} · TXT _dmarc.{domain} · CNAME selector1._domainkey.{domain}", note: "What is actually published right now, resolved live." },
      { src: "exo", method: "Get-DkimSigningConfig", url: "| fl Domain,Enabled,Selector1CNAME,LastChecked", note: "Whether DKIM signing is switched on per domain." },
      { src: "exo", method: "Get-AntiPhishPolicy", url: "| fl Name,EnableMailboxIntelligence,EnableSpoofIntelligence,TargetedUserProtection", note: "Defender for Office 365 impersonation and spoof settings." },
    ],
    statCards: [
      { label: "Domains sending mail", value: "4", sub: "1 primary, 2 sub, 1 parked", tone: "slate" },
      { label: "SPF", value: "+all", sub: "permissive — authorises anyone", tone: "red", fixKey: "email-spf" },
      { label: "SPF lookups", value: "11 / 10", sub: "over the RFC limit, PermError", tone: "red", fixKey: "email-spf-lookups" },
      { label: "DKIM signing", value: "1 of 4", sub: "domains signing outbound", tone: "red", fixKey: "email-dkim" },
      { label: "DMARC", value: "p=none", sub: "no enforcement, no reports", tone: "red", fixKey: "email-dmarc" },
    ],
    topRisks: [
      "The SPF record ends in +all, which tells every receiving server that any host on the internet is authorised to send as your domain",
      "SPF resolves 11 DNS lookups against a hard limit of 10, so receivers return PermError and DMARC reads it as a failure",
      "DKIM is signing on one domain out of four, so mail from three domains has no cryptographic signature to fall back on",
      "DMARC sits at p=none with no rua address, so nothing is enforced and no reports are being collected",
      "A parked domain with a valid MX and no SPF is the easiest brand to spoof you have",
      "Since 5 May 2025 Microsoft requires SPF, DKIM and DMARC from senders doing 5,000+ messages a day to Outlook.com — you exceed that on the primary domain",
    ],
    listLabel: "Domains",
    rows: [
      {
        name: "tenant.com",
        context: "Primary · 41,200 outbound messages in 30 days · SPF +all, DKIM on, DMARC p=none",
        chips: [{ tone: "red", label: "Critical" }, { tone: "slate", label: "Primary" }],
        facts: [
          { k: "SPF published", v: "v=spf1 include:spf.protection.outlook.com include:_spf.salesforce.com include:sendgrid.net include:mail.zendesk.com +all" },
          { k: "SPF should be", v: "v=spf1 include:spf.protection.outlook.com include:_spf.salesforce.com include:sendgrid.net include:mail.zendesk.com -all" },
          { k: "SPF lookups", v: "11 of a permitted 10 — receivers return PermError" },
          { k: "DKIM", v: "Enabled. selector1 and selector2 CNAMEs resolve, last rotated 14 months ago." },
          { k: "DMARC published", v: "v=DMARC1; p=none" },
          { k: "DMARC should be", v: "v=DMARC1; p=quarantine; pct=25; rua=mailto:dmarc@tenant.com; fo=1 — then step to reject" },
          { k: "Volume", v: "41,200 messages in 30 days, above Microsoft’s 5,000/day sender authentication threshold" },
        ],
        groups: [
          {
            label: "Sending sources found in DNS",
            items: [
              { primary: "Exchange Online", secondary: "spf.protection.outlook.com · 2 lookups" },
              { primary: "Salesforce", secondary: "_spf.salesforce.com · 4 lookups — the main contributor to the overrun" },
              { primary: "SendGrid", secondary: "sendgrid.net · 3 lookups" },
              { primary: "Zendesk", secondary: "mail.zendesk.com · 2 lookups" },
            ],
          },
          {
            label: "Order of operations",
            items: [
              { primary: "1. Flatten SPF to get under 10 lookups", secondary: "Nothing else can pass reliably until PermError stops" },
              { primary: "2. Change +all to -all", secondary: "Only after the source list is confirmed complete" },
              { primary: "3. Move DMARC to p=quarantine at pct=25", secondary: "With rua reporting on, so you can watch before going to reject" },
            ],
          },
        ],
        actions: [
          { label: "Flatten SPF and switch +all to -all", sub: "One change window, verified against 30 days of sending sources", fixKey: "email-spf" },
          { label: "Move DMARC to p=quarantine with reporting", sub: "Staged 25% → 100% → reject over 6 weeks", fixKey: "email-dmarc" },
        ],
      },
      {
        name: "marketing.tenant.com",
        context: "Subdomain · 8,900 messages in 30 days · DKIM missing",
        chips: [{ tone: "red", label: "High" }, { tone: "red", label: "No DKIM" }],
        facts: [
          { k: "SPF published", v: "v=spf1 include:sendgrid.net ~all" },
          { k: "DKIM", v: "Not enabled. Get-DkimSigningConfig returns Enabled: False." },
          { k: "DKIM CNAMEs", v: "selector1 and selector2 do not resolve — the CNAMEs were never published" },
          { k: "DMARC", v: "Inherits p=none from the parent domain" },
          { k: "Alignment", v: "SPF passes on the envelope domain but does not align with the visible From address" },
        ],
        groups: [
          {
            label: "Why this fails DMARC even though SPF passes",
            items: [
              { primary: "SendGrid returns its own envelope domain", secondary: "SPF passes for SendGrid, not for marketing.tenant.com, so alignment fails" },
              { primary: "DKIM is the only fix that aligns", secondary: "A signature on the From domain is what makes DMARC pass here" },
            ],
          },
        ],
        actions: [{ label: "Publish the DKIM CNAMEs and enable signing", sub: "Two CNAMEs, then the Enabled toggle once they resolve", fixKey: "email-dkim" }],
      },
      {
        name: "mail.tenant.com",
        context: "Subdomain · transactional only · SPF and DKIM correct",
        chips: [{ tone: "green", label: "Healthy" }],
        facts: [
          { k: "SPF published", v: "v=spf1 include:spf.protection.outlook.com -all" },
          { k: "DKIM", v: "Enabled, both selectors resolving, rotated 2 months ago" },
          { k: "DMARC", v: "Inherits from parent. Will tighten automatically when the parent moves to quarantine." },
        ],
        groups: [
          {
            label: "Assessment",
            items: [{ primary: "Nothing to do here", secondary: "This is the configuration the other three domains should end up matching" }],
          },
        ],
        actions: [],
      },
      {
        name: "tenant-legacy.com",
        context: "Parked · no legitimate mail · valid MX, no SPF",
        chips: [{ tone: "red", label: "High" }, { tone: "amber", label: "Parked" }],
        facts: [
          { k: "SPF published", v: "None" },
          { k: "MX", v: "Still points at Exchange Online — the domain can receive and be spoofed" },
          { k: "DKIM", v: "Not enabled" },
          { k: "DMARC", v: "None" },
          { k: "Outbound volume", v: "0 messages in 12 months" },
        ],
        groups: [
          {
            label: "Parked-domain hardening",
            items: [
              { primary: "SPF should be v=spf1 -all", secondary: "States plainly that no host may send as this domain" },
              { primary: "DMARC should be v=DMARC1; p=reject;", secondary: "A parked domain can go straight to reject — there is no legitimate mail to break" },
            ],
          },
        ],
        actions: [{ label: "Publish parked-domain records: v=spf1 -all and p=reject", sub: "The cheapest spoofing fix available to you", fixKey: "email-parked" }],
      },
    ],
    secondaryLabel: "Defender for Office 365 controls",
    secondaryNote: "Read from Exchange Online. These decide what happens to inbound mail that fails the checks above.",
    secondaryRows: [
      { name: "Anti-phishing policy", detail: "Default policy only. Mailbox intelligence is on, but impersonation protection covers no users or domains.", tone: "red", status: "Default only", fixKey: "email-antiphish" },
      { name: "Defender for Office 365 Plan 2", detail: "Not enabled. No attachment detonation, no automated investigation, no campaign views.", tone: "red", status: "Not licensed", fixKey: "email-defender-p2" },
      { name: "Safe Links", detail: "Enabled for email, not for Teams or Office apps.", tone: "amber", status: "Partial", fixKey: "email-safelinks" },
      { name: "Safe Attachments", detail: "Enabled in Block mode across all recipients.", tone: "green", status: "On" },
      { name: "Spoof intelligence", detail: "On, with 12 unreviewed entries in the allow list — 4 of them added over 6 months ago.", tone: "amber", status: "12 to review", fixKey: "email-spoof-review" },
      { name: "DMARC quarantine handling", detail: "Honour DMARC policy is off, so inbound mail failing a p=reject DMARC is still delivered.", tone: "red", status: "Off", fixKey: "email-honour-dmarc" },
    ],
  },
};
