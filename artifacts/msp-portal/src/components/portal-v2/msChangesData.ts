/**
 * msChangesData.ts - the Microsoft Changes fixture.
 *
 * EXTRACTED MECHANICALLY from the prototype's own `POSTS` array
 * ('Microsoft Changes.dc.html' line 609) by evaluating the literal and
 * serialising it, NOT retyped. Ten posts carry thirty-three fields each,
 * several of them multi-paragraph prose that is final copy - the transcription
 * risk of hand-typing that is exactly the risk riskRegisterData.ts was
 * extracted to avoid.
 *
 * The extractor asserted that all ten posts carry all thirty-three keys, so
 * there are no optional fields on `MsPost` and no defaulting anywhere.
 *
 * -- What the module argues ------------------------------------------------
 * Microsoft tells you what changes; this page tells you what it changes FOR
 * YOU. Each post carries Microsoft's own words (`ms`, `msSays`) beside the
 * tenant's answer (`youSay`, `evidence`) and a written consequence of doing
 * nothing (`ignore`). The `score` is a per-tenant impact number, not
 * Microsoft's severity.
 *
 * -- Design content, not tenant data ---------------------------------------
 * The prototype's fictional Halden Materials tenant.
 */

/**
 * A workload's accent - 'Microsoft Changes.dc.html' 598.
 *
 * `M365` is not in the design. It is the residual row the LIVE Message Center
 * needs: Microsoft files posts against nineteen distinct service names in the
 * testbed tenant alone (Dynamics 365, Viva, Defender XDR, Power BI, Planner...),
 * and the six design rows cannot hold them. Dropping the remainder would make
 * every total on the page quietly wrong, so they land here instead. It is slate
 * rather than a new accent because it is a catch-all, not a workload.
 */
export const WORKLOAD_TONE: Readonly<Record<string, string>> = {
  Exchange: "#60a5fa",
  Teams: "#a78bfa",
  SharePoint: "#2dd4bf",
  Entra: "#fbbf24",
  Purview: "#f87171",
  Copilot: "#22d3ee",
  M365: "#94a3b8",
};

/** The twelve-month band the density grid is drawn over - 599-603. */
export const MSC_MONTHS: ReadonlyArray<{ l: string; y: string }> = [
  { l: "Sep", y: "26" }, { l: "Oct", y: "26" }, { l: "Nov", y: "26" }, { l: "Dec", y: "26" },
  { l: "Jan", y: "27" }, { l: "Feb", y: "27" }, { l: "Mar", y: "27" }, { l: "Apr", y: "27" },
  { l: "May", y: "27" }, { l: "Jun", y: "27" }, { l: "Jul", y: "27" }, { l: "Aug", y: "27" },
];

/** The tenant's own freeze windows, drawn as bands over the grid - 604-607. */
export const MSC_FREEZE_BANDS: ReadonlyArray<{
  from: number;
  span: number;
  label: string;
  title: string;
}> = [
  { from: 0, span: 1, label: "Quarter close", title: "Your freeze \u00b7 29\u201330 September" },
  { from: 3, span: 2, label: "Year end freeze", title: "Your freeze \u00b7 22 December \u2013 2 January" },
];

export interface MsEvidence { q: string; a: string; bad: boolean }
export interface MsPhase { name: string; when: string; note: string }
export interface MsHistory { at: string; what: string; detail: string }
export interface MsDecision { at: string; what: string }
/**
 * `mine` marks a message from the customer's own side, which the thread draws
 * differently. It is genuinely OPTIONAL in the fixture — three entries omit it
 * (Microsoft's and the MSP's replies), where the prototype reads it as falsy.
 * The extractor's key check ran per POST and so did not see this; `tsc` did.
 */
export interface MsThreadEntry { who: string; at: string; text: string; mine?: boolean }

export interface MsPost {
  id: string;
  title: string;
  /** Workload key into WORKLOAD_TONE. */
  wl: string;
  workload: string;
  kind: string;
  /** True when the change BREAKS something rather than merely altering it. */
  hard: boolean;
  /** Index into MSC_MONTHS. */
  month: number;
  when: string;
  countdown: string;
  /** Per-tenant impact, 0-100. NOT Microsoft's own severity. */
  score: number;
  impact: string;
  optOut: string;
  optOutNote: string;
  owned: string;
  seats: string;
  /** Microsoft's Message Center text, verbatim. */
  ms: string;
  /** The same change in Shane's words. */
  plain: string;
  msSays: string;
  youSay: string;
  evidence: readonly MsEvidence[];
  evidenceNote: string;
  /** What happens if nobody acts. */
  ignore: string;
  crCode: string;
  crState: string;
  crNote: string;
  phases: readonly MsPhase[];
  roadmapId: string;
  toldMs: string;
  toldYou: string;
  history: readonly MsHistory[];
  decisions: readonly MsDecision[];
  controls: readonly string[];
  thread: readonly MsThreadEntry[];
  /**
   * Which of the eleven buckets this post lands in.
   *
   * The FIXTURE posts do not carry it — their bucket comes from the hand-built
   * MSC_ITEM_BUCKET map, because a design fixture has no real dates to derive
   * one from. A post that arrives from the live Message Center DOES carry it,
   * computed server-side from Microsoft's own published date, and
   * `postsInWave` prefers it over the map. Optional for exactly that reason:
   * it is the seam between a fixture post and a real one.
   */
  bucket?: number;
}

export const MS_POSTS: readonly MsPost[] = [
  {
    "id": "MC1042318",
    "title": "Basic authentication permanently disabled in Exchange Online",
    "wl": "Exchange",
    "workload": "Exchange Online",
    "kind": "Retirement",
    "hard": true,
    "month": 1,
    "when": "1 October 2026",
    "countdown": "in 6 weeks",
    "score": 92,
    "impact": "Hits you",
    "optOut": "None",
    "optOutNote": "There is no opt-out and no extension programme this time. The date is the date.",
    "owned": "Covered by your E3",
    "seats": "1,240 mailboxes · 11 with legacy-auth activity",
    "ms": "Beginning October 1, 2026, Microsoft will permanently disable Basic authentication for POP, IMAP, SMTP AUTH, and Exchange ActiveSync in all Exchange Online tenants. Clients and applications using Basic authentication will no longer be able to connect. Customers should migrate affected clients and service accounts to OAuth 2.0 before this date. This change is being made to reduce the risk of password spray and credential replay attacks.",
    "plain": "Anything still signing in to a mailbox with a username and a password stops working on 1 October. Not degraded — stops. Outlook and the mobile apps are fine because they already use modern auth. What breaks is the old stuff: a scanner that emails PDFs, a script that sends invoices, a phone with an IMAP profile someone set up in 2019.",
    "msSays": "A small number of tenants still use Basic authentication for legacy protocols and should migrate affected clients.",
    "youSay": "You have eleven accounts that authenticated over IMAP or SMTP AUTH in the last 30 days. Nine are the Bay 3 scanners, two are personal iOS Mail profiles, and one automation — the nightly invoice export — sends over SMTP AUTH from Finance.",
    "evidence": [
      {
        "q": "GET /reports/getEmailActivityUserDetail · legacy protocol sign-ins, 30 days",
        "a": "1,412 events across 11 accounts",
        "bad": true
      },
      {
        "q": "Get-CASMailbox | where {$_.ImapEnabled -eq $true}",
        "a": "11 mailboxes",
        "bad": true
      },
      {
        "q": "Transport rule / connector using SMTP AUTH",
        "a": "1 · Finance invoice export",
        "bad": true
      },
      {
        "q": "Conditional Access policy blocking legacy auth",
        "a": "CA-014 exists, report-only",
        "bad": false
      }
    ],
    "evidenceNote": "Read from your tenant 19 August at 08:04. Re-runs nightly, and the answer changes as you fix things.",
    "ignore": "On 1 October the Bay 3 scanners stop sending, the nightly invoice export fails silently at 23:00, and two people stop receiving mail on their phones. You find out from Finance on 2 October when a customer chases an invoice nobody sent. This is the shape of every Microsoft deprecation: it does not break the thing you were watching, it breaks the thing you forgot was connected to it.",
    "crCode": "CR-0142",
    "crState": "Awaiting approval",
    "crNote": "Already raised — legacy auth disabled deliberately in a 25 August window, six weeks before Microsoft does it for you. That is the whole difference between a change and an incident.",
    "phases": [
      {
        "name": "Announced",
        "when": "4 April 2026",
        "note": "Message Center post published, 180 days notice."
      },
      {
        "name": "Targeted release",
        "when": "August 2026",
        "note": "Reporting only. You are here."
      },
      {
        "name": "Standard release",
        "when": "1 October 2026",
        "note": "Enforced tenant-wide. No opt-out."
      }
    ],
    "roadmapId": "Roadmap 124981",
    "toldMs": "Global administrators only — two accounts. One is your break-glass account, which nobody signs into by design, so in practice Microsoft told one person.",
    "toldYou": "Priya Raman on 4 April by digest, Shane McCaw the same day, the eleven affected users on 12 August with instructions, and Facilities about the Bay 3 scanners on 13 August.",
    "history": [
      {
        "at": "4 Apr 2026",
        "what": "Published",
        "detail": "Original date: 1 September 2026."
      },
      {
        "at": "22 May 2026",
        "what": "Date moved",
        "detail": "Pushed to 1 October 2026 with no separate announcement. If you had planned to the original date you would never have been told it moved."
      },
      {
        "at": "30 Jun 2026",
        "what": "Scope widened",
        "detail": "Exchange ActiveSync added to the list of affected protocols. This is the edit that caught most tenants."
      },
      {
        "at": "11 Aug 2026",
        "what": "Clarified",
        "detail": "Microsoft confirmed no extension programme will be offered."
      }
    ],
    "decisions": [
      {
        "at": "4 Apr 2026 · Priya Raman",
        "what": "Acknowledged. Position: get ahead of it rather than wait."
      },
      {
        "at": "18 Aug 2026 · Shane McCaw",
        "what": "CR-0142 raised, report-only ring started, pilot enforced on 25 accounts."
      }
    ],
    "controls": [
      "Cyber Essentials Plus · authentication",
      "ISO 27001 A.9.4.2",
      "Copilot gate items 12, 19, 27, 33"
    ],
    "thread": [
      {
        "who": "Priya Raman",
        "at": "12 Aug",
        "text": "Can we just extend past October if the scanners are not ready?",
        "mine": true
      },
      {
        "who": "Shane McCaw",
        "at": "12 Aug",
        "text": "No. There is no extension this time — that is what the 11 August clarification says. The scanners are on firmware 4.2 and can do OAuth today; the real risk is the Finance invoice export, which has been rewritten but never dry-run. That dry run is the gate I would hold the change on."
      }
    ]
  },
  {
    "id": "MC1049877",
    "title": "Default sharing link changes to \"people with existing access\"",
    "wl": "SharePoint",
    "workload": "SharePoint · OneDrive",
    "kind": "Rollout",
    "hard": false,
    "month": 0,
    "when": "22 September 2026",
    "countdown": "in 5 weeks",
    "score": 74,
    "impact": "Hits you",
    "optOut": "Until 18 Sep",
    "optOutNote": "A tenant setting you can pin before the rollout reaches you. After that you are changing it back, not keeping it.",
    "owned": "Covered by your E3",
    "seats": "212 document libraries · 1,240 OneDrive accounts",
    "ms": "We are updating the default sharing link type for SharePoint and OneDrive to \"People with existing access\" for all tenants that have not explicitly configured a default. Users can still choose other link types where policy allows. Tenant administrators may set an explicit default before rollout reaches their tenant.",
    "plain": "When someone clicks Share, the link they get by default changes. Today your users get \"anyone with the link\" for tender documents; after this they get a link that only works for people who already have access — which, for an external customer, is nobody. Nothing is blocked. Links just quietly stop working for the people they were sent to.",
    "msSays": "Tenants that have not explicitly configured a default will receive the new default. Users can still choose other link types.",
    "youSay": "You have never set an explicit default, so you get the new one. Sales sent 84 anonymous links in the last 30 days, all tender documents, and 47 of the files they attached to CR-0136 still carry a Confidential label that already restricts anonymous sharing.",
    "evidence": [
      {
        "q": "Get-SPOTenant | Select DefaultSharingLinkType",
        "a": "None — never configured",
        "bad": true
      },
      {
        "q": "Anonymous links created, last 30 days",
        "a": "84 · 61 from the Sales tenders library",
        "bad": true
      },
      {
        "q": "Libraries with a label restricting anonymous links",
        "a": "3 · post-CR-0136 remnant",
        "bad": true
      },
      {
        "q": "External sharing enabled at tenant level",
        "a": "Yes, unchanged by this rollout",
        "bad": false
      }
    ],
    "evidenceNote": "The point is not that Microsoft is wrong. The new default is safer. The point is that it changes how 84 links a month behave, and nobody in Sales has been told.",
    "ignore": "Tender links start failing for customers, one at a time, with no error your side. Sales assumes the customer cannot open the file and re-sends it. You find out weeks later when someone loses a bid and asks why the link never worked.",
    "crCode": "",
    "crState": "",
    "crNote": "Nothing raised yet. Pinning your own default before 18 September makes this a change you control; after that it is a change you inherit and then have to argue about.",
    "phases": [
      {
        "name": "Announced",
        "when": "2 July 2026",
        "note": "82 days notice."
      },
      {
        "name": "Targeted release",
        "when": "22 September 2026",
        "note": "Reaches your tenant in this window."
      },
      {
        "name": "Standard release",
        "when": "October 2026",
        "note": "Everyone else."
      }
    ],
    "roadmapId": "Roadmap 131204",
    "toldMs": "Global and SharePoint administrators. Nobody in Sales, who are the only people this actually affects day to day.",
    "toldYou": "Priya Raman on 3 July by digest. Sales have not been told, because there is nothing to tell them until you decide what the default will be.",
    "history": [
      {
        "at": "2 Jul 2026",
        "what": "Published",
        "detail": "Rollout window: September to October."
      },
      {
        "at": "28 Jul 2026",
        "what": "Opt-out clarified",
        "detail": "Microsoft confirmed an explicit tenant default is honoured and will not be overwritten."
      }
    ],
    "decisions": [
      {
        "at": "3 Jul 2026 · Priya Raman",
        "what": "Acknowledged, deferred to the September review."
      }
    ],
    "controls": [
      "ISO 27001 A.13.2.1",
      "Compliance finding CMP-004"
    ],
    "thread": [
      {
        "who": "Shane McCaw",
        "at": "14 Aug",
        "text": "My recommendation is to set the default to \"specific people\" yourselves before the 18th, and give the tenders library an exception. That way Sales keeps working the way it works, and the rest of the tenant gets the safer default. Doing nothing is also a decision — it just gets made by Redmond."
      }
    ]
  },
  {
    "id": "MC1051144",
    "title": "Anonymous meeting join default flips to allowed",
    "wl": "Teams",
    "workload": "Microsoft Teams",
    "kind": "Rollout",
    "hard": false,
    "month": 0,
    "when": "26 September 2026",
    "countdown": "in 5 weeks",
    "score": 61,
    "impact": "Hits you",
    "optOut": "Set it explicitly",
    "optOutNote": "An explicit value on your meeting policy survives the rollout. A default does not.",
    "owned": "Covered by your E3",
    "seats": "1,240 users · 3 meeting policies",
    "ms": "The default value of the AllowAnonymousUsersToJoinMeeting setting will change to True for tenants using the default global meeting policy. Tenants with an explicitly configured value will not be affected.",
    "plain": "People will be able to join your meetings without signing in, unless you have set that value on purpose. You have not — you have the default, which means Microsoft is about to change a setting your compliance evidence describes as an external-access control.",
    "msSays": "Tenants with an explicitly configured value are unaffected.",
    "youSay": "Your global meeting policy has never had this value set, so it is the default and it will move. Two of your three policies inherit from global. Your compliance pack cites anonymous join being off as evidence for an external-access control.",
    "evidence": [
      {
        "q": "Get-CsTeamsMeetingPolicy Global | Select AllowAnonymousUsersToJoinMeeting",
        "a": "False — inherited default, not set",
        "bad": true
      },
      {
        "q": "Policies inheriting from Global",
        "a": "2 of 3",
        "bad": true
      },
      {
        "q": "Compliance control citing this setting",
        "a": "CMP-011 · external access",
        "bad": true
      }
    ],
    "evidenceNote": "This is the quiet kind. Nothing breaks — a control you are audited on simply changes value, during the week of your ERP go-live freeze.",
    "ignore": "The setting flips, your compliance evidence becomes untrue, and you find out at the next audit rather than at the change. Meanwhile anyone with a meeting link can join without identifying themselves.",
    "crCode": "",
    "crState": "",
    "crNote": "A one-line change request pins the value before the 26th. It is a ten-minute change that stops a control moving underneath you.",
    "phases": [
      {
        "name": "Announced",
        "when": "30 July 2026",
        "note": "58 days notice."
      },
      {
        "name": "Rollout begins",
        "when": "26 September 2026",
        "note": "Mid-freeze for you. Microsoft does not observe freezes."
      },
      {
        "name": "Complete",
        "when": "Mid October 2026",
        "note": "All tenants."
      }
    ],
    "roadmapId": "Roadmap 133907",
    "toldMs": "Teams administrators. Two accounts, both ours.",
    "toldYou": "Priya Raman on 31 July by digest, flagged as a freeze collision on 19 August.",
    "history": [
      {
        "at": "30 Jul 2026",
        "what": "Published",
        "detail": "Rollout from late September."
      },
      {
        "at": "15 Aug 2026",
        "what": "Date narrowed",
        "detail": "Rollout start moved from \"late September\" to 26 September."
      }
    ],
    "decisions": [],
    "controls": [
      "CMP-011 · external access",
      "ISO 27001 A.13.1.3"
    ],
    "thread": []
  },
  {
    "id": "MC1054920",
    "title": "Multifactor authentication required for all Microsoft admin portals",
    "wl": "Entra",
    "workload": "Entra ID",
    "kind": "Enforcement",
    "hard": true,
    "month": 2,
    "when": "15 November 2026",
    "countdown": "in 3 months",
    "score": 88,
    "impact": "Hits you",
    "optOut": "None",
    "optOutNote": "Enforced by Microsoft at the identity layer. No tenant setting turns it off.",
    "owned": "Covered by your E3",
    "seats": "14 admin accounts · 2 service principals",
    "ms": "Microsoft will require multifactor authentication for all users signing in to the Microsoft 365 admin center, Azure portal, and Microsoft Entra admin center. This requirement applies regardless of tenant Conditional Access configuration. Break-glass accounts are not exempt.",
    "plain": "Every admin sign-in needs a second factor from 15 November, including the emergency account you keep in a safe for the day everything else fails. If that account has no MFA method registered, you cannot use it — which is exactly when you would need it.",
    "msSays": "MFA will be required for all admin portal sign-ins. Break-glass accounts are not exempt.",
    "youSay": "Twelve of your fourteen admin accounts already enforce MFA through CA-007. The two that do not are the break-glass accounts, deliberately excluded from Conditional Access — and they have no MFA method registered at all.",
    "evidence": [
      {
        "q": "Admin accounts without a registered MFA method",
        "a": "2 · both break-glass",
        "bad": true
      },
      {
        "q": "Accounts excluded from CA-007",
        "a": "2 · same accounts",
        "bad": true
      },
      {
        "q": "Service principals using admin portals interactively",
        "a": "0",
        "bad": false
      },
      {
        "q": "Admin accounts already enforcing MFA",
        "a": "12 of 14",
        "bad": false
      }
    ],
    "evidenceNote": "The finding here is not the twelve accounts that are fine. It is the two that were excluded on purpose and will lock you out of your own tenant.",
    "ignore": "On 15 November your break-glass accounts stop being break-glass. The next time you genuinely need one — a Conditional Access mistake, a compromised admin, a failed identity provider — you cannot get in, and the recovery path is a support case with Microsoft.",
    "crCode": "",
    "crState": "",
    "crNote": "Register hardware keys on both break-glass accounts, store them the way you store the passwords, and record it in the risk register. Small change, and the one nobody does until it is too late.",
    "phases": [
      {
        "name": "Announced",
        "when": "20 May 2026",
        "note": "179 days notice."
      },
      {
        "name": "Gradual enforcement",
        "when": "September 2026",
        "note": "Random tenants, warning banners only."
      },
      {
        "name": "Full enforcement",
        "when": "15 November 2026",
        "note": "All tenants, no exemptions."
      }
    ],
    "roadmapId": "Roadmap 128840",
    "toldMs": "Global administrators. Including, ironically, the break-glass account that nobody reads mail on.",
    "toldYou": "Priya Raman on 21 May by digest. Raised again in the July architect session.",
    "history": [
      {
        "at": "20 May 2026",
        "what": "Published",
        "detail": "Original scope: Azure portal only."
      },
      {
        "at": "18 Jun 2026",
        "what": "Scope widened",
        "detail": "Microsoft 365 admin center and Entra admin center added."
      },
      {
        "at": "2 Aug 2026",
        "what": "Exemptions removed",
        "detail": "Earlier wording implied break-glass accounts could be excluded. That wording is gone."
      }
    ],
    "decisions": [
      {
        "at": "21 May 2026 · Priya Raman",
        "what": "Acknowledged. Deferred — revisit in the autumn."
      }
    ],
    "controls": [
      "Cyber Essentials Plus · admin access",
      "ISO 27001 A.9.2.3",
      "Risk register RSK-004"
    ],
    "thread": [
      {
        "who": "Shane McCaw",
        "at": "2 Aug",
        "text": "The exemption wording was removed on 2 August. Two hardware keys, one in each safe, and RSK-004 updated. Half an hour of work now, or a support case on the worst day of your year."
      }
    ]
  },
  {
    "id": "MC1066402",
    "title": "Classic Teams client removed from all devices",
    "wl": "Teams",
    "workload": "Microsoft Teams",
    "kind": "Retirement",
    "hard": true,
    "month": 5,
    "when": "10 February 2027",
    "countdown": "in 6 months",
    "score": 71,
    "impact": "Hits you",
    "optOut": "None",
    "optOutNote": "The client stops launching. There is no policy that keeps it alive.",
    "owned": "Covered by your E3",
    "seats": "34 devices still on the classic client",
    "ms": "The classic Microsoft Teams client will be removed from devices and will no longer launch after February 10, 2027. Users will be automatically transitioned to the new Teams client.",
    "plain": "Thirty-four of your machines still run the old Teams. On 10 February it stops opening. Most will update themselves; the ones that will not are the ones running an OS build too old for the new client, and those are hardware decisions, not software ones.",
    "msSays": "Users will be automatically transitioned to the new Teams client.",
    "youSay": "Thirty-four devices are on the classic client. Nine of them run a Windows build below the new client's minimum, and six of those nine are shop-floor terminals in Bay 3 that also came up in the legacy auth work.",
    "evidence": [
      {
        "q": "Devices reporting classic Teams, last 30 days",
        "a": "34",
        "bad": true
      },
      {
        "q": "Devices below the new client OS minimum",
        "a": "9",
        "bad": true
      },
      {
        "q": "Of those, shop-floor terminals",
        "a": "6 · Bay 3",
        "bad": true
      }
    ],
    "evidenceNote": "The same six machines keep appearing across unrelated Microsoft changes. That is usually the real finding.",
    "ignore": "Nine machines lose Teams entirely in February, six of them on the shop floor where the alternative is a phone call.",
    "crCode": "",
    "crState": "",
    "crNote": "This is a hardware refresh conversation with six months of warning, which is the only reason it is not an incident.",
    "phases": [
      {
        "name": "Announced",
        "when": "12 August 2026",
        "note": "182 days notice."
      },
      {
        "name": "Warning banners",
        "when": "November 2026",
        "note": "In-client notices to affected users."
      },
      {
        "name": "Removal",
        "when": "10 February 2027",
        "note": "Client no longer launches."
      }
    ],
    "roadmapId": "Roadmap 139022",
    "toldMs": "Teams administrators.",
    "toldYou": "Priya Raman on 13 August by digest. Not yet raised with Facilities, who own the Bay 3 terminals.",
    "history": [
      {
        "at": "12 Aug 2026",
        "what": "Published",
        "detail": "Removal date set for February 2027."
      }
    ],
    "decisions": [],
    "controls": [
      "Adoption pillar · client currency"
    ],
    "thread": []
  },
  {
    "id": "MC1061240",
    "title": "SharePoint 2013 workflows retired",
    "wl": "SharePoint",
    "workload": "SharePoint Online",
    "kind": "Retirement",
    "hard": true,
    "month": 4,
    "when": "31 January 2027",
    "countdown": "in 5 months",
    "score": 46,
    "impact": "Might hit you",
    "optOut": "None",
    "optOutNote": "Workflows stop executing. Existing instances are not migrated.",
    "owned": "Covered by your E3",
    "seats": "2 workflows found",
    "ms": "SharePoint 2013 workflows will be fully retired and will stop running in Microsoft 365 after January 31, 2027. Customers should migrate to Power Automate.",
    "plain": "Two old workflows in your tenant stop running at the end of January. One looks abandoned; the other is the purchase-order approval in the Procurement site, which is not abandoned at all.",
    "msSays": "Customers should migrate remaining workflows to Power Automate.",
    "youSay": "Two workflow definitions are still active. The purchase-order approval ran 61 times in the last 90 days. The other has not run since 2023 and can simply be deleted.",
    "evidence": [
      {
        "q": "Active SharePoint 2013 workflow definitions",
        "a": "2",
        "bad": true
      },
      {
        "q": "Runs in the last 90 days",
        "a": "61 · all purchase-order approval",
        "bad": true
      },
      {
        "q": "Power Automate licences available",
        "a": "Included in E3 for this scope",
        "bad": false
      }
    ],
    "evidenceNote": "The number that matters is 61. A workflow nobody remembers building is running the approval step for every purchase order in the company.",
    "ignore": "Purchase orders stop being approved on 1 February and nobody knows why, because the workflow was built by someone who left in 2021.",
    "crCode": "",
    "crState": "",
    "crNote": "One rebuild in Power Automate and one deletion. Five months of notice makes this routine; five weeks would not.",
    "phases": [
      {
        "name": "Announced",
        "when": "15 June 2026",
        "note": "230 days notice."
      },
      {
        "name": "Warning in site health",
        "when": "October 2026",
        "note": "Affected sites flagged."
      },
      {
        "name": "Retirement",
        "when": "31 January 2027",
        "note": "Workflows stop executing."
      }
    ],
    "roadmapId": "Roadmap 126601",
    "toldMs": "SharePoint administrators.",
    "toldYou": "Priya Raman on 16 June by digest. Procurement told on 20 August once the 61 runs were found.",
    "history": [
      {
        "at": "15 Jun 2026",
        "what": "Published",
        "detail": "Retirement date: 31 January 2027."
      },
      {
        "at": "9 Aug 2026",
        "what": "Guidance added",
        "detail": "Microsoft published a migration assessment tool. It does not migrate anything, it only lists what will break."
      }
    ],
    "decisions": [],
    "controls": [
      "Governance pillar · legacy platform"
    ],
    "thread": []
  },
  {
    "id": "MC1063118",
    "title": "Semantic index becomes a prerequisite for Microsoft 365 Copilot",
    "wl": "Copilot",
    "workload": "Microsoft 365 Copilot",
    "kind": "Rollout",
    "hard": false,
    "month": 3,
    "when": "December 2026",
    "countdown": "in 4 months",
    "score": 58,
    "impact": "Might hit you",
    "optOut": "None",
    "optOutNote": "A prerequisite, not a setting. It changes what you must fix before Copilot is worth buying.",
    "owned": "Not licensed yet",
    "seats": "41 open gate items",
    "ms": "The semantic index will become a prerequisite for Microsoft 365 Copilot. Tenants must have completed indexing before Copilot features become available to licensed users.",
    "plain": "Before Copilot works properly, your content has to be indexed — and indexing surfaces permissions problems rather than fixing them. Anything overshared becomes findable by everyone who was accidentally given access.",
    "msSays": "Tenants must complete indexing before Copilot features become available.",
    "youSay": "You are not licensed for Copilot yet, so nothing breaks. But your readiness gate stands at 41 of 82, and 19 of those items are oversharing findings — exactly the ones indexing turns from theoretical into searchable.",
    "evidence": [
      {
        "q": "Copilot licences assigned",
        "a": "0",
        "bad": false
      },
      {
        "q": "Open gate items relating to oversharing",
        "a": "19 of 41",
        "bad": true
      },
      {
        "q": "Sites with anonymous or org-wide access",
        "a": "23",
        "bad": true
      }
    ],
    "evidenceNote": "This one does not break anything today. It changes the order of your remediation plan, which is more useful to know now than in December.",
    "ignore": "Nothing, until the day you buy Copilot licences. Then every oversharing finding you deferred becomes a search result on somebody's desk.",
    "crCode": "",
    "crState": "",
    "crNote": "No change request needed. It moves the oversharing items up the remediation plan, ahead of the cosmetic ones.",
    "phases": [
      {
        "name": "Announced",
        "when": "5 August 2026",
        "note": "Rollout from December."
      },
      {
        "name": "Rollout",
        "when": "December 2026",
        "note": "Prerequisite applies to new Copilot deployments."
      }
    ],
    "roadmapId": "Roadmap 137115",
    "toldMs": "Global administrators.",
    "toldYou": "Priya Raman on 6 August by digest, with a note that it changes remediation order rather than adding work.",
    "history": [
      {
        "at": "5 Aug 2026",
        "what": "Published",
        "detail": "Prerequisite announced for December."
      }
    ],
    "decisions": [],
    "controls": [
      "Copilot readiness gate"
    ],
    "thread": []
  },
  {
    "id": "MC1069951",
    "title": "External recipient rate limits enforced in Exchange Online",
    "wl": "Exchange",
    "workload": "Exchange Online",
    "kind": "Enforcement",
    "hard": true,
    "month": 6,
    "when": "1 March 2027",
    "countdown": "in 6 months",
    "score": 39,
    "impact": "Might hit you",
    "optOut": "None",
    "optOutNote": "A platform limit. Bulk sending moves to a service built for it.",
    "owned": "Covered by your E3",
    "seats": "2,000 external recipients per day, per mailbox",
    "ms": "Exchange Online will enforce a limit of 2,000 external recipients per 24 hours per mailbox. Messages exceeding the limit will be rejected until the window resets.",
    "plain": "No mailbox can email more than 2,000 outside addresses a day. Normal people never come close. Your marketing mailbox sends about 1,100 on a campaign day, which is fine until someone decides to send to the whole list twice.",
    "msSays": "A limit of 2,000 external recipients per 24 hours will be enforced per mailbox.",
    "youSay": "One mailbox gets close: marketing@ peaks at 1,100 external recipients on campaign days. It is under the limit today, and it is the only thing in the tenant that would ever notice.",
    "evidence": [
      {
        "q": "Highest external recipient count, 90 days",
        "a": "1,100 · marketing@",
        "bad": false
      },
      {
        "q": "Mailboxes above 500 per day",
        "a": "1",
        "bad": false
      },
      {
        "q": "Bulk sending through a dedicated service",
        "a": "No — sent from a normal mailbox",
        "bad": true
      }
    ],
    "evidenceNote": "Low score, and worth knowing anyway: campaign mail should not run out of a user mailbox, and this is the argument that finally moves it.",
    "ignore": "Probably nothing. If marketing grows the list by 80 per cent, a campaign send silently half-delivers and nobody can tell which half.",
    "crCode": "",
    "crState": "",
    "crNote": "Not a change request. A note in the risk register and a conversation with marketing about where campaign mail belongs.",
    "phases": [
      {
        "name": "Announced",
        "when": "10 August 2026",
        "note": "203 days notice."
      },
      {
        "name": "Enforcement",
        "when": "1 March 2027",
        "note": "Applies to all tenants."
      }
    ],
    "roadmapId": "Roadmap 140558",
    "toldMs": "Exchange administrators.",
    "toldYou": "Priya Raman on 11 August by digest, marked low impact.",
    "history": [
      {
        "at": "10 Aug 2026",
        "what": "Published",
        "detail": "Limit set at 2,000 recipients per 24 hours."
      }
    ],
    "decisions": [],
    "controls": [
      "Health pillar · mail flow"
    ],
    "thread": []
  },
  {
    "id": "MC1057733",
    "title": "Retention label management moves to the new Purview portal",
    "wl": "Purview",
    "workload": "Microsoft Purview",
    "kind": "Feature",
    "hard": false,
    "month": 1,
    "when": "October 2026",
    "countdown": "in 2 months",
    "score": 12,
    "impact": "No impact",
    "optOut": "None",
    "optOutNote": "A portal move. The policies themselves do not change.",
    "owned": "Covered by your E3",
    "seats": "No configuration change",
    "ms": "Retention label and policy management will move to the new Microsoft Purview portal. Existing labels, policies, and their behaviour are unchanged.",
    "plain": "The buttons move. Your policies do not. The only cost is that the screenshots in your compliance evidence pack now show a portal that no longer exists.",
    "msSays": "Existing labels, policies and behaviour are unchanged.",
    "youSay": "Nothing in your tenant changes. Four screenshots in your compliance evidence pack are now out of date, which matters only at audit time.",
    "evidence": [
      {
        "q": "Retention policies affected",
        "a": "0 — presentation only",
        "bad": false
      },
      {
        "q": "Evidence pack screenshots showing the old portal",
        "a": "4",
        "bad": true
      }
    ],
    "evidenceNote": "Kept on the list precisely because it is harmless. A page that only shows scary things gets ignored just like the Message Center does.",
    "ignore": "Nothing breaks. An auditor asks why your evidence shows a portal that was retired eight months ago.",
    "crCode": "",
    "crState": "",
    "crNote": "No change request. Re-take four screenshots at the next evidence refresh.",
    "phases": [
      {
        "name": "Announced",
        "when": "1 August 2026",
        "note": "Rollout through October."
      },
      {
        "name": "Rollout",
        "when": "October 2026",
        "note": "Old portal redirects."
      }
    ],
    "roadmapId": "Roadmap 135880",
    "toldMs": "Compliance administrators.",
    "toldYou": "Not sent individually — appeared in the weekly digest under \"no action needed\".",
    "history": [
      {
        "at": "1 Aug 2026",
        "what": "Published",
        "detail": "Portal consolidation."
      }
    ],
    "decisions": [
      {
        "at": "4 Aug 2026 · Automated",
        "what": "Scored no impact. Filed without a decision, which is itself the decision."
      }
    ],
    "controls": [],
    "thread": []
  },
  {
    "id": "MC1072330",
    "title": "OneNote for Windows 10 reaches end of support",
    "wl": "Exchange",
    "workload": "Microsoft 365 Apps",
    "kind": "Retirement",
    "hard": true,
    "month": 7,
    "when": "30 April 2027",
    "countdown": "in 8 months",
    "score": 28,
    "impact": "Might hit you",
    "optOut": "None",
    "optOutNote": "End of support, not removal. It keeps working until it does not.",
    "owned": "Covered by your E3",
    "seats": "19 users on the Windows 10 app",
    "ms": "OneNote for Windows 10 will reach end of support on April 30, 2027. Users should move to OneNote for Microsoft 365.",
    "plain": "Nineteen people use the old OneNote app. It will keep opening after April but stops getting fixes, and notebooks stored only on those devices are the ones that get lost.",
    "msSays": "Users should move to OneNote for Microsoft 365.",
    "youSay": "Nineteen users, of whom three have notebooks that have never synced to SharePoint. Those three are the actual risk — not the app version.",
    "evidence": [
      {
        "q": "Users on OneNote for Windows 10",
        "a": "19",
        "bad": true
      },
      {
        "q": "Local-only notebooks detected",
        "a": "3",
        "bad": true
      }
    ],
    "evidenceNote": "The interesting number is three, not nineteen. Migration is easy; unsynced notebooks are how people lose four years of notes.",
    "ignore": "Three people lose their notebooks the next time a laptop is replaced, and it will not be connected to this notice at all.",
    "crCode": "",
    "crState": "",
    "crNote": "Sync those three notebooks first, then migrate the nineteen at leisure.",
    "phases": [
      {
        "name": "Announced",
        "when": "18 August 2026",
        "note": "255 days notice."
      },
      {
        "name": "End of support",
        "when": "30 April 2027",
        "note": "No further updates."
      }
    ],
    "roadmapId": "Roadmap 141902",
    "toldMs": "Global administrators.",
    "toldYou": "Priya Raman on 19 August by digest.",
    "history": [
      {
        "at": "18 Aug 2026",
        "what": "Published",
        "detail": "End of support date announced."
      }
    ],
    "decisions": [],
    "controls": [],
    "thread": []
  }
];

/* ────────────────────────────────────────────────────────────────────────────
   The density grid
   ──────────────────────────────────────────────────────────────────────── */

/**
 * The eleven time buckets the grid is drawn over - 'Microsoft Changes.dc.html'
 * 1105-1117.
 *
 * They are NOT evenly spaced, and that is the point: the first three are
 * fortnights and the last two are quarters, so the near term gets the
 * resolution and the far term gets compressed. A uniform month axis would give
 * equal width to "the next two weeks" and "next summer".
 */
export interface MscBucket {
  label: string;
  sub: string;
  /** Buckets are grouped into waves by this string; adjacent equal values merge. */
  wave: string;
}

export const MSC_BUCKETS: readonly MscBucket[] = [
  { label: "24 Aug", sub: "\u2013 6 Sep", wave: "Late August wave" },
  { label: "7 Sep", sub: "\u2013 20 Sep", wave: "September wave" },
  { label: "21 Sep", sub: "\u2013 4 Oct", wave: "September wave" },
  { label: "Oct", sub: "2026", wave: "Q2 \u00b7 Oct \u2013 Dec" },
  { label: "Nov", sub: "2026", wave: "Q2 \u00b7 Oct \u2013 Dec" },
  { label: "Dec", sub: "2026", wave: "Q2 \u00b7 Oct \u2013 Dec" },
  { label: "Jan", sub: "2027", wave: "Q3 \u00b7 Jan \u2013 Mar" },
  { label: "Feb", sub: "2027", wave: "Q3 \u00b7 Jan \u2013 Mar" },
  { label: "Mar", sub: "2027", wave: "Q3 \u00b7 Jan \u2013 Mar" },
  { label: "Apr \u2013 Jun", sub: "2027", wave: "Q4 and beyond" },
  { label: "Jul \u2013 Sep", sub: "2027", wave: "Q4 and beyond" },
];

/** Bucket indices covered by one of the tenant's freeze windows - 1118. */
export const MSC_FREEZE_BUCKETS: readonly number[] = [2, 5];

/**
 * The four item kinds, in the order the density dots stack - 1119-1124.
 * The order is load-bearing: 'b' first means a breaking change is the first
 * dot drawn in a cell, so a cell that contains one always shows red.
 */
export const MSC_KINDS: ReadonlyArray<{ k: "b" | "d" | "v" | "s"; label: string; tone: string }> = [
  { k: "b", label: "Breaks something", tone: "#f87171" },
  { k: "d", label: "Needs a decision", tone: "#fbbf24" },
  { k: "v", label: "Your people will see it", tone: "#a78bfa" },
  { k: "s", label: "Silent \u00b7 no action", tone: "#475569" },
];

/**
 * Counts per workload per bucket, each cell `[breaks, decides, visible, silent]`
 * - 1125-1132. Eleven cells a row, matching MSC_BUCKETS.
 */
export interface MscDensityRow {
  wl: string;
  name: string;
  cells: ReadonlyArray<readonly [number, number, number, number]>;
}

export const MSC_DENSITY: readonly MscDensityRow[] = [
  { wl: "Exchange", name: "Exchange Online & Apps", cells: [[0,0,1,6],[0,1,1,7],[1,1,1,8],[0,1,2,9],[0,0,2,7],[0,0,1,5],[0,0,1,4],[0,0,0,3],[0,0,0,3],[0,0,1,4],[0,0,0,2]] },
  { wl: "Teams", name: "Microsoft Teams", cells: [[0,0,2,7],[0,1,1,8],[0,1,2,6],[0,1,2,7],[0,0,1,5],[0,0,1,4],[0,0,1,3],[0,0,1,4],[0,0,0,2],[0,0,0,3],[0,0,0,1]] },
  { wl: "SharePoint", name: "SharePoint & OneDrive", cells: [[0,1,1,5],[0,1,1,6],[1,1,2,5],[0,0,1,6],[0,0,1,4],[0,0,0,3],[0,1,1,4],[0,0,0,2],[0,0,0,2],[0,0,1,2],[0,0,0,1]] },
  { wl: "Entra", name: "Entra ID", cells: [[0,0,0,4],[0,0,1,4],[0,0,0,3],[0,1,1,5],[1,1,1,4],[0,0,0,2],[0,0,0,2],[0,0,0,1],[0,0,0,1],[0,0,0,2],[0,0,0,1]] },
  { wl: "Purview", name: "Purview", cells: [[0,0,0,3],[0,0,0,2],[0,0,1,2],[0,0,0,3],[0,0,0,2],[0,0,1,2],[0,0,0,1],[0,0,0,1],[0,0,0,1],[0,0,0,1],[0,0,0,0]] },
  { wl: "Copilot", name: "Copilot", cells: [[0,0,1,4],[0,0,1,5],[0,0,1,4],[0,0,0,5],[0,0,1,4],[0,0,0,3],[0,0,0,2],[0,0,0,2],[0,0,1,1],[0,0,0,2],[0,0,0,1]] },
];

/**
 * Which bucket each named post lands in - 1133-1136.
 *
 * Note this is NOT derivable from the post's `month` field: `month` indexes
 * MSC_MONTHS (a twelve-month calendar) while this indexes MSC_BUCKETS (eleven
 * uneven periods). MC1042318 is `month: 1` and bucket 2. Deriving one from the
 * other would put items in the wrong column.
 */
export const MSC_ITEM_BUCKET: Readonly<Record<string, number>> = {
  MC1049877: 2, MC1051144: 2, MC1042318: 2, MC1054920: 4, MC1057733: 3, MC1061240: 6,
  MC1063118: 5, MC1066402: 7, MC1069951: 8, MC1072330: 9,
  MC1067201: 3, MC1059440: 2, MC1070855: 4, MC1073110: 5, MC1075402: 6,
};

/** The abbreviations a single-bucket wave header uses - 1484. */
export const MSC_WAVE_SHORT: Readonly<Record<string, string>> = {
  "Late August wave": "Late Aug",
  "September wave": "Sep wave",
  "Q2 \u00b7 Oct \u2013 Dec": "Q2 \u00b7 Oct\u2013Dec",
  "Q3 \u00b7 Jan \u2013 Mar": "Q3 \u00b7 Jan\u2013Mar",
  "Q4 and beyond": "Q4 +",
};

/** The "today" pin on bucket 0 - 1508. */
export const MSC_TODAY_LABEL = "Today \u00b7 20 Aug";

/** The two freeze buckets, WITH their labels - 'Microsoft Changes.dc.html' 1118. */
export const MSC_FREEZE_BUCKET_DEFS: ReadonlyArray<{ i: number; label: string }> = [
  { i: 2, label: "Quarter close" },
  { i: 5, label: "Year end" },
];

/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   Part 10 \u2014 the wave page's deferred surfaces
   \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

/** When your tenant was last read - 'Microsoft Changes.dc.html' 1190. */
export const MSC_SCAN_AT = "19 August, 08:04";

/**
 * The stat cards under "Next 12 months" - 1395-1402. `statFilter` keys them, so
 * a card can filter everything below it; the fixture holds the numbers and copy.
 */
export interface MscStatDef {
  key: string;
  label: string;
  value: string;
  sub: string;
  tone: string;
}

export const MSC_STAT_DEFS: readonly MscStatDef[] = [
  { key: "decisions", label: "Need a decision", value: "12", sub: "4 written up \u00b7 two inside five weeks", tone: "#f87171" },
  { key: "hits", label: "Will break something", value: "3", sub: "Named systems, named dates", tone: "#fbbf24" },
  { key: "soon", label: "Landing in 60 days", value: "34", sub: "3 written up \u00b7 22 Sep \u00b7 26 Sep \u00b7 1 Oct", tone: "#60a5fa" },
  { key: "reversed", label: "Edited after publishing", value: "61", sub: "3 written up \u00b7 dates moved or withdrawn", tone: "#a78bfa" },
  { key: "seen", label: "Needs an announcement", value: "39", sub: "6 written up \u00b7 drafts ready to send", tone: "#a78bfa" },
  { key: "none", label: "No action at all", value: "352", sub: "1 written up \u00b7 dismissed with a reason each", tone: "#34d399" },
];

/**
 * The status label per wave, in band order - 1752. Beyond the list it falls
 * back to the wave's own date range.
 */
export const MSC_WAVE_STATUS: readonly string[] = [
  "Landing now",
  "Lands in 3 weeks",
  "Lands from October",
  "Lands from January",
  "From April 2027",
];

/** Notice given / days left, per wave band - 1199-1202. */
export interface MscWaveNotice {
  given: number;
  left: number;
}

export const MSC_WAVE_NOTICE: readonly MscWaveNotice[] = [
  { given: 138, left: 4 },
  { given: 82, left: 18 },
  { given: 150, left: 42 },
  { given: 210, left: 134 },
  { given: 260, left: 224 },
];

/** The per-workload four names the changes inherit - 1191-1198. */
export interface MscRaci {
  r: string;
  a: string;
  c: string;
  i: string;
}

export const MSC_RACI: Readonly<Record<string, MscRaci>> = {
  Exchange: { r: "Priya Raman", a: "Dan Whitlock", c: "Shane McCaw", i: "Service desk" },
  Teams: { r: "Priya Raman", a: "Dan Whitlock", c: "Comms \u00b7 Jo Feltham", i: "All staff" },
  SharePoint: { r: "Marcus Lee", a: "Dan Whitlock", c: "Sales \u00b7 Ruth Okafor", i: "All staff" },
  Entra: { r: "Shane McCaw", a: "Dan Whitlock", c: "Priya Raman", i: "Audit" },
  Purview: { r: "Aisha Bello", a: "Legal \u00b7 R. Court", c: "Shane McCaw", i: "Audit" },
  Copilot: { r: "Unassigned", a: "Dan Whitlock", c: "Shane McCaw", i: "Pilot group" },
};

/** The services in use, and what the last scan found - 1223-1230. Drives the filter. */
export interface MscScan {
  wl: string;
  name: string;
  found: string;
}

export const MSC_SCANS: readonly MscScan[] = [
  { wl: "Exchange", name: "Exchange Online & Apps", found: "1,240 mailboxes \u00b7 11 accounts still using legacy authentication" },
  { wl: "Teams", name: "Microsoft Teams", found: "1,240 licensed users \u00b7 3 meeting policies \u00b7 classic client on 9 machines" },
  { wl: "SharePoint", name: "SharePoint & OneDrive", found: "212 libraries \u00b7 84 anonymous links in the last 30 days" },
  { wl: "Entra", name: "Entra ID", found: "2 admin accounts with no registered MFA method" },
  { wl: "Purview", name: "Purview", found: "6 retention labels in use \u00b7 3 libraries with restricting labels" },
  { wl: "Copilot", name: "Copilot", found: "No licences assigned yet \u00b7 semantic index not enabled" },
];

/** The decision queue - "Decide before it lands" - 1729-1734. */
export interface MscQueueItem {
  id: string;
  due: string;
  kind: string;
  tone: string;
  decision: string;
  ifNot: string;
}

export const MSC_QUEUE: readonly MscQueueItem[] = [
  { id: "MC1049877", due: "18 September", kind: "Opt-out closes", tone: "#f87171", decision: "Set your own default sharing link type, or accept the one Microsoft picks.", ifNot: "After the 18th you are not choosing a default, you are reversing one \u2014 and the 84 anonymous links Sales sends each month behave differently in the meantime." },
  { id: "MC1051144", due: "26 September", kind: "Rollout date", tone: "#fbbf24", decision: "Pin the anonymous-join value on your Teams meeting policy before the rollout reaches you.", ifNot: "A control your compliance pack cites changes value on its own, during your ERP go-live freeze, and you find out at audit." },
  { id: "MC1042318", due: "1 October", kind: "Enforced", tone: "#f87171", decision: "Approve CR-0142 for a window that leaves room to roll back and retry.", ifNot: "Microsoft disables legacy auth for you on 1 October with no window, no rollback and no warning to the eleven accounts still using it." },
  { id: "MC1054920", due: "15 November", kind: "Enforced", tone: "#fbbf24", decision: "Register MFA methods on both break-glass accounts and update RSK-004.", ifNot: "Your emergency accounts stop working on the day you need them, and the recovery path is a Microsoft support case." },
];

/** The 11 post-detail sections the rail navigates - 1169-1181. */
export interface MscSec {
  key: string;
  num: string;
  label: string;
  intro: string;
}

export const MSC_SECS: readonly MscSec[] = [
  { key: "ms", num: "01", label: "Microsoft\u2019s words", intro: "The post as published, unedited. Kept verbatim because the wording is what changes, and the change is usually the story." },
  { key: "plain", num: "02", label: "What it actually means", intro: "The same thing in language you can forward to someone who does not administer Microsoft 365 for a living." },
  { key: "tenant", num: "03", label: "Does it hit you", intro: "What Microsoft says about tenants in general, against what your tenant actually reports. Every answer here is a query result, not an opinion." },
  { key: "blast", num: "04", label: "Blast radius", intro: "How many users, mailboxes, sites or devices this touches in your tenant." },
  { key: "opt", num: "05", label: "Opt-out and deadline", intro: "Whether you have a choice, and the date after which the choice is made for you." },
  { key: "ignore", num: "06", label: "If you do nothing", intro: "The version of events where this notice is never read. This is the section that exists because of the ones that were not." },
  { key: "cr", num: "07", label: "The change request", intro: "What gets raised, or what is already raised, to get in front of this on your terms." },
  { key: "phases", num: "08", label: "Rollout phases", intro: "Announced, targeted, standard, enforced \u2014 and where your tenant sits in that sequence." },
  { key: "told", num: "09", label: "Who was told", intro: "Who Microsoft notified, against who in your organisation actually needs to know." },
  { key: "history", num: "10", label: "Post history", intro: "Every edit Microsoft made after publication. Dates move, scope widens, exemptions disappear \u2014 and none of it generates a new notice." },
  { key: "log", num: "11", label: "Decisions and controls", intro: "What you decided, when, and which of your compliance controls this notice is tied to." },
];

/** What each named group actually feels, and whether they have been told - 1148-1167. */
export interface MscGroup {
  name: string;
  heads: string;
  items: readonly string[];
  first: string;
  tone: string;
  told: boolean;
  what: string;
  who: string;
}

export const MSC_GROUPS: readonly MscGroup[] = [
  { name: "Bay 3 \u00b7 shop floor", heads: "18 people \u00b7 34 devices", items: ["MC1042318", "MC1066402"], first: "1 October", tone: "#f87171", told: false, what: "Scanners stop emailing when legacy auth goes, and nine of their terminals cannot run the new Teams client in February. The same six machines keep appearing in unrelated Microsoft changes.", who: "Facilities own the hardware. Nobody in Bay 3 has been told about either date." },
  { name: "Finance", heads: "26 people", items: ["MC1042318", "MC1061240"], first: "1 October", tone: "#f87171", told: false, what: "The nightly invoice export sends over SMTP AUTH and fails silently on 1 October. The purchase-order approval workflow stops running on 31 January.", who: "Finance own both. They know about the invoice export rewrite; they have not been told the workflow is retiring." },
  { name: "Sales", heads: "41 people", items: ["MC1049877"], first: "22 September", tone: "#f87171", told: false, what: "Tender links stop working for customers, one at a time, with no error on your side. 84 anonymous links a month.", who: "Not told. There is nothing to tell them until you decide what the default will be \u2014 which is why the 18 September date matters." },
  { name: "Administrators", heads: "14 accounts", items: ["MC1054920"], first: "15 November", tone: "#fbbf24", told: true, what: "MFA required on every admin portal sign-in. Twelve accounts are already fine; the two break-glass accounts have no method registered.", who: "Priya Raman and Shane McCaw. Told in May, told again in August when the exemption wording disappeared." },
  { name: "Procurement", heads: "12 people", items: ["MC1061240", "MC1051144"], first: "26 September", tone: "#fbbf24", told: true, what: "Anonymous meeting join changes on their supplier calls, and the purchase-order workflow retires in January.", who: "Marcus Bell, told on 20 August once the 61 workflow runs were traced." },
  { name: "Everyone with a mailbox", heads: "1,240 people", items: ["MC1051144", "MC1057733"], first: "26 September", tone: "#94a3b8", told: false, what: "Meeting join behaviour changes, and the Purview portal moves. Neither needs an announcement \u2014 but both are cited in compliance evidence.", who: "No announcement planned. Correct, as long as somebody decided that rather than forgot." },
];

/** What your people will actually see, per app - the seen-in-the-wild list - 1048-1103. */
export interface MscSeen {
  id: string;
  app: string;
  appFull?: string;
  title: string;
  when: string;
  ring: string;
  who: string;
  heads: number;
  tone: string;
  tickets: string;
  told: boolean;
  sees: string;
  why: string;
  helpdesk: string;
  ignore: string;
}

export const MSC_SEEN: readonly MscSeen[] = [
  { id: "MC1067201", app: "Teams", title: "A Copilot button appears in every chat and channel", when: "6 October 2026", ring: "Standard release \u00b7 reaches everyone within two weeks", who: "All 1,240 users", heads: 1240, tone: "#f87171", tickets: "40 \u2013 80 tickets in the first week if nobody is told", told: false, sees: "A Copilot icon appears at the top of every chat, channel and meeting. Clicking it opens a panel that explains Copilot is not included in their licence and offers a trial.", why: "You do not licence Copilot, so nobody in the company can use it. The button appears anyway. Users will read it as \"we have AI now\" and either ask why it does not work, or assume Microsoft is reading their chats.", helpdesk: "The Copilot button is new from Microsoft. We do not have Copilot licences, so it will not do anything \u2014 it is not reading your messages. There is nothing wrong with your Teams and nothing you need to do.", ignore: "Two waves of tickets: the first asking how to use it, the second asking whether it has been listening. The second wave reaches your privacy officer before it reaches IT." },
  { id: "MC1059440", app: "Teams", title: "Meeting toolbar buttons move and the recap tab is renamed", when: "21 September 2026", ring: "Targeted release first \u00b7 a fortnight of mixed versions", who: "Anyone who runs meetings \u00b7 about 400 people", heads: 400, tone: "#fbbf24", tickets: "10 \u2013 20 tickets, mostly \"where has mute gone\"", told: false, sees: "Mute, camera and share move position in the meeting bar. \"Meeting notes\" becomes \"Recap\". Raise hand moves under a menu.", why: "Nothing functional changes. It is muscle memory, and it lands during two weeks where half your people have the new layout and half do not, so nobody can help each other over a call.", helpdesk: "Microsoft moved the meeting buttons around this week. Mute is still on the toolbar, raise hand is now under the three dots, and Meeting notes is called Recap. Nothing is missing.", ignore: "A fortnight of low-grade confusion in meetings, and at least one executive convinced their Teams is broken." },
  { id: "MC1070855", app: "Outlook", title: "New Outlook becomes the default on Windows", when: "9 November 2026", ring: "Staged \u00b7 classic Outlook still available until April", who: "All 1,240 users", heads: 1240, tone: "#f87171", tickets: "60 \u2013 120 tickets over three weeks", told: false, sees: "Outlook opens looking different. Some add-ins are gone, PST files are not there, signatures need setting up again, and offline behaviour changes.", why: "This is the biggest visible change of the year for your people, and the toggle back to classic exists only until April. Finance use two COM add-ins that the new client does not support.", helpdesk: "Outlook has been updated to the new version. If an add-in you rely on is missing, or you cannot find an old archive file, contact IT \u2014 do not spend an hour looking. You can switch back to classic Outlook using the toggle at the top right while we work through it.", ignore: "The single largest ticket spike of the year, landing in the same month as the admin MFA enforcement, with Finance unable to run month-end reconciliation." },
  { id: "MC1049877", app: "OneDrive", title: "The Share dialog looks different and picks a different link", when: "22 September 2026", ring: "Standard release", who: "Anyone who shares files \u00b7 about 700 people", heads: 700, tone: "#f87171", tickets: "15 \u2013 30 tickets, plus customer complaints that links do not work", told: false, sees: "The Share dialog is rearranged, and the link it creates by default is no longer \"anyone with the link\".", why: "This is the user-facing half of MC1049877. The admin decision is which default to set; the visible change is that Sales send a link, the customer cannot open it, and neither of them sees an error.", helpdesk: "The Share window has changed. Check the link type before sending to someone outside the company \u2014 if they cannot open it, that is why. Ask IT for the tenders library exception if you share with customers regularly.", ignore: "Sales quietly lose tender submissions and blame the customer\u2019s email filter." },
  { id: "MC1073110", app: "Office apps", appFull: "Word, Excel and PowerPoint", title: "AutoSave defaults to on for files stored in SharePoint", when: "2 December 2026", ring: "Standard release", who: "About 900 people", heads: 900, tone: "#fbbf24", tickets: "20 \u2013 40 tickets, mostly about overwritten files", told: false, sees: "AutoSave is on by default. Edits to a shared file save as you type, and \"Save As at the end\" stops being a way to keep the original intact.", why: "Harmless for most people and genuinely dangerous for anyone who works by opening last month\u2019s file, editing it and saving a copy. Finance and Procurement both work that way.", helpdesk: "AutoSave is now on by default. If you work from a copy of last month\u2019s file, use File then Save a Copy before you start editing \u2014 otherwise you will be editing the original.", ignore: "Somebody overwrites a signed contract or a prior-month workbook, and version history becomes an emergency lesson rather than a feature." },
  { id: "MC1075402", app: "SharePoint", title: "Site navigation moves to the left rail on all sites", when: "18 January 2027", ring: "Staged over six weeks", who: "Everyone who uses an intranet site \u00b7 about 1,100 people", heads: 1100, tone: "#94a3b8", tickets: "5 \u2013 15 tickets", told: false, sees: "The top navigation on every SharePoint site moves to a left-hand rail. Custom headers are re-laid out.", why: "Cosmetic, but your intranet homepage was built around the top nav and three of your quick links land badly in the new layout.", helpdesk: "SharePoint site menus have moved to the left-hand side. All the same links are there. If a link on the intranet homepage looks wrong, tell IT and we will fix the page.", ignore: "A slightly broken-looking intranet for six weeks, which is a credibility cost rather than a technical one." },
];

/** What actually arrived, and what it cost - the retrospective - 1203-1222. */
export interface MscLandedRow {
  id: string;
  title: string;
  outcome: string;
  tone: string;
  tickets: string;
  told: boolean;
}

export interface MscLanded {
  name: string;
  range: string;
  items: number;
  moved: number;
  tickets: number;
  incidents: number;
  verdict: string;
  tone: string;
  rows: readonly MscLandedRow[];
}

export const MSC_LANDED: readonly MscLanded[] = [
  {
    name: "August wave", range: "27 Jul \u2013 9 Aug", items: 31, moved: 2, tickets: 6, incidents: 0,
    verdict: "Landed as announced", tone: "#34d399",
    rows: [
      { id: "MC1039204", title: "Outlook pinned folders move to the top of the list", outcome: "Landed on the day", tone: "#34d399", tickets: "2 tickets, both in Bay 3", told: true },
      { id: "MC1040118", title: "Teams recap tab renamed to Recap", outcome: "Landed on the day", tone: "#34d399", tickets: "4 tickets in the first two days", told: false },
      { id: "MC1037755", title: "OneDrive sync icon set redrawn", outcome: "Landed 4 days late", tone: "#fbbf24", tickets: "No tickets", told: true },
    ],
  },
  {
    name: "July wave", range: "29 Jun \u2013 12 Jul", items: 26, moved: 1, tickets: 19, incidents: 1,
    verdict: "One incident \u00b7 nobody was told", tone: "#f87171",
    rows: [
      { id: "MC1031882", title: "Meeting chat permissions default changed", outcome: "Landed on the day", tone: "#34d399", tickets: "14 tickets in three days", told: false },
      { id: "MC1033017", title: "SharePoint search results page redesigned", outcome: "Landed on the day", tone: "#34d399", tickets: "5 tickets", told: false },
      { id: "MC1029440", title: "Legacy Exchange Web Services throttling tightened", outcome: "Incident INC-2291 \u00b7 invoice export failed for 2 days", tone: "#f87171", tickets: "Escalated", told: false },
    ],
  },
];

/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   The dataset seam \u2014 where the design fixture stops and the tenant's own
   Microsoft 365 Message Center starts
   \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

/**
 * Everything the page and `msChangesModel.ts` read, in one object.
 *
 * Before this existed the model reached straight for the module constants above,
 * so the page could only ever draw the design's fictional Halden Materials
 * tenant. Every derivation now takes a `MscDataset` that DEFAULTS to
 * `FIXTURE_DATASET` \u2014 which is why the existing model tests still pass
 * unchanged \u2014 and `useMessageCenter()` swaps in a real one built from
 * `GET /api/portal/message-center`.
 *
 * -- What is real in the live dataset -------------------------------------
 * From the customer's own Message Center, synced from Graph
 * `/admin/serviceAnnouncement/messages` by `message-center-sync.ts`:
 *
 *   posts . density . buckets . stats . scans . scanAt . waveShort . itemCount
 *
 * -- What stays fixture, and why ------------------------------------------
 * These need a read of the customer's own CONFIGURATION, their staff list, or a
 * human write-up. Nothing in this build produces any of them for Message Center
 * posts, so they are left as the design's own rather than fabricated against a
 * real customer's name:
 *
 *   queue (the decision write-ups) . seen (the seen-in-the-wild briefings) .
 *   groups (which department feels it) . landed (the retrospective) .
 *   raci (named owners) . freezeBuckets (the tenant's change freezes) .
 *   waveNotice (notice given / days left)
 *
 * `live` tells the page which dataset it is holding, so it can say so on screen.
 * Nothing is silently blended: a fixture surface stays whole rather than being
 * half-populated from real data, which would be the one genuinely misleading
 * outcome.
 */
export interface MscDataset {
  readonly live: boolean;
  readonly posts: readonly MsPost[];
  readonly density: readonly MscDensityRow[];
  readonly buckets: readonly MscBucket[];
  readonly stats: readonly MscStatDef[];
  readonly scans: readonly MscScan[];
  readonly scanAt: string;
  readonly waveShort: Readonly<Record<string, string>>;
  /** Fixture-only: the hand-built post-to-bucket map. Live posts carry `bucket`. */
  readonly itemBucket: Readonly<Record<string, number>>;
  readonly freezeBuckets: readonly number[];
  readonly freezeBucketDefs: ReadonlyArray<{ i: number; label: string }>;
  readonly waveStatus: readonly string[];
  readonly waveNotice: readonly MscWaveNotice[];
  readonly queue: readonly MscQueueItem[];
  readonly seen: readonly MscSeen[];
  readonly groups: readonly MscGroup[];
  readonly landed: readonly MscLanded[];
  readonly raci: Readonly<Record<string, MscRaci>>;
  /** How many Message Center items the tenant holds. 0 on the fixture. */
  readonly itemCount: number;
}

/** The design's own tenant, unchanged. What the page draws before the fetch lands. */
export const FIXTURE_DATASET: MscDataset = {
  live: false,
  posts: MS_POSTS,
  density: MSC_DENSITY,
  buckets: MSC_BUCKETS,
  stats: MSC_STAT_DEFS,
  scans: MSC_SCANS,
  scanAt: MSC_SCAN_AT,
  waveShort: MSC_WAVE_SHORT,
  itemBucket: MSC_ITEM_BUCKET,
  freezeBuckets: MSC_FREEZE_BUCKETS,
  freezeBucketDefs: MSC_FREEZE_BUCKET_DEFS,
  waveStatus: MSC_WAVE_STATUS,
  waveNotice: MSC_WAVE_NOTICE,
  queue: MSC_QUEUE,
  seen: MSC_SEEN,
  groups: MSC_GROUPS,
  landed: MSC_LANDED,
  raci: MSC_RACI,
  itemCount: 0,
};
