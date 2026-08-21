/**
 * shaneBotData.ts — ShaneBot's fixture conversation, suggestion chips, canned
 * replies and Active Card definitions, ported from the prototype
 * (Customer Portal Shell.dc.html): initial thread 7328-7333, chips 7620-7624,
 * reply matcher 7495-7511, `sbCardFor` 17519-17592.
 *
 * README §"ShaneBot — selection-based, not always-on": replies carry an Active
 * Card (`finding` | `fix` | `datum` | `ticket` | `escalate`) — plus the weekly
 * `report` card the prototype also uses — and escalation opens a Zoho Desk
 * ticket with the conversation and tenant context attached. Grounding the
 * replies against real telemetry is explicitly a later architecture task; these
 * are the design's own scripted answers, kept verbatim.
 */

export type SbWho = "bot" | "you";

export type SbCardKind = "datum" | "fix" | "finding" | "ticket" | "escalate" | "report";

export interface SbCardRef {
  readonly kind: SbCardKind;
  /** For a `datum` card, the highlighted text becomes the title. */
  readonly label?: string;
}

export interface SbMessage {
  readonly who: SbWho;
  readonly text: string;
  readonly card?: SbCardRef;
}

export interface SbCardRow {
  readonly k: string;
  readonly v: string;
  readonly tone?: "red" | "amber" | "green";
}

export interface SbCardStep {
  readonly label: string;
  readonly state: "done" | "active" | "todo";
  readonly note: string;
}

export interface SbCard {
  readonly kind: SbCardKind;
  readonly title: string;
  readonly meta: string;
  readonly rows: readonly SbCardRow[];
  readonly steps?: readonly SbCardStep[];
  readonly price: string;
  readonly secondary?: string;
}

/** Bot bubble tones for a card row value — shell 17594. */
export const SB_ROW_TONE: Record<"red" | "amber" | "green", string> = {
  red: "#f87171",
  amber: "#c2a63d",
  green: "#34d399",
};

/** The thread ShaneBot opens with — shell 7328-7333. */
export const SB_INITIAL_MESSAGES: readonly SbMessage[] = [
  {
    who: "bot",
    text: "Afternoon Jordan. You came in from the legacy authentication finding, so I have that open — along with your tenant, scan 14, and the two changes already approved for Thursday. Ask me anything about it.",
  },
  { who: "bot", text: "Here is where that finding actually stands.", card: { kind: "fix" } },
  { who: "you", text: "What breaks if we run it?" },
  {
    who: "bot",
    text: "Four accounts stop connecting the way they do today. Two of them are already migrated, so in practice it is the floor-2 printer and one user on a third-party iOS mail client. The printer moves to direct send in the same window, and the user needs Outlook mobile set up first — five minutes with your service desk. Nothing else in the tenant is using a legacy protocol.",
  },
];

/** The context banner — shell 6663-6664. Where the conversation arrived from. */
export const SB_CONTEXT = {
  eyebrow: "You arrived from",
  line: "Security · Legacy Auth · finding SEC-014",
} as const;

/** Suggestion chips — shell 7620-7624. */
export const SB_CHIPS: readonly string[] = [
  "What changed since my last scan?",
  "What should I fix first?",
  "What would this cost to fix?",
  "Talk to us about migrating",
];

/** `sbCardFor` — shell 17519-17592, verbatim. */
export function sbCardFor(kind: SbCardKind, label?: string): SbCard {
  switch (kind) {
    case "datum":
      return {
        kind,
        title: (label || "This data point").slice(0, 90),
        meta: "Read from your tenant at scan 14 · 2 hours ago",
        rows: [
          { k: "Where from", v: "Graph and PowerShell inventory, not a survey answer" },
          { k: "Compared to", v: "Your approved baseline and the last three scans" },
          { k: "Trend", v: "Moving in the wrong direction since scan 12", tone: "amber" },
        ],
        price: "Open the finding behind it",
        secondary: "Show me the evidence",
      };
    case "fix":
      return {
        kind,
        title: "Disable legacy authentication safely",
        meta: "Security · SEC-014 · SOP-IDN-004 · avg 11m 40s",
        rows: [
          { k: "Affects", v: "4 accounts, 1,106 sign-ins in 30 days" },
          { k: "Reversible", v: "Yes — protocol state is restored from the change snapshot" },
          { k: "Score effect", v: "+9 to Security on verification" },
        ],
        price: "Fix this now — $180",
        secondary: "Read the runbook first",
      };
    case "finding":
      return {
        kind,
        title: "What moved since scan 13",
        meta: "Scan 14 · 2 hours ago",
        rows: [
          { k: "Governance", v: "2 anonymous links created · 1 with edit", tone: "red" },
          { k: "Health", v: "Sync errors 11 → 14", tone: "red" },
          { k: "Compliance", v: "Disposition backlog +330 items", tone: "amber" },
          { k: "Licensing", v: "$650/mo recovered and verified", tone: "green" },
        ],
        price: "Open the drift view",
      };
    case "ticket":
      return {
        kind,
        title: "Ticket #ZD-40118 raised with Shane McCaw Consulting",
        meta: "Zoho Desk · priority Normal · opened just now",
        rows: [],
        steps: [
          { label: "Received", state: "done", note: "Conversation and tenant context attached automatically" },
          { label: "Assigned", state: "active", note: "Routing to Priya Raman, your named architect" },
          { label: "First response", state: "todo", note: "Within 4 business hours — before 14:00 today" },
          { label: "Resolution", state: "todo", note: "Tracked here and in your email thread" },
        ],
        price: "View the ticket",
        secondary: "Add something to it",
      };
    case "escalate":
      return {
        kind,
        title: "This needs a person, not me",
        meta: "Scoping questions go to a human with your context attached",
        rows: [
          { k: "What I will send", v: "This conversation, your tenant profile, and the three findings that affect sequencing" },
          { k: "Who picks it up", v: "Priya Raman · your named architect" },
          { k: "Response", v: "Within 4 business hours on your Premier tier" },
        ],
        price: "Raise it with a human",
        secondary: "Not yet — keep asking me",
      };
    case "report":
      return {
        kind,
        title: "Weekly status report · W33",
        meta: "Priya Raman · published 15 August · 2.5 hours logged",
        rows: [
          { k: "Closed", v: "Retention coverage gap and guest invitation restriction" },
          { k: "In flight", v: "Entra Connect sync errors — 11 of 14 cleared" },
        ],
        price: "Open the full report",
      };
  }
}

/** The scripted reply for a message — shell 7495-7511, verbatim matcher. */
export function sbReplyFor(text: string): { text: string; card: SbCardRef } {
  const q = text.toLowerCase();
  if (/migrat|tenant to tenant|acquisition/.test(q))
    return {
      text: "Tenant-to-tenant migration is a project rather than a change, so it goes through a statement of work — but I can tell you what yours would involve before anyone talks to you. Your tenant has 1,240 mailboxes, 41 GB of orphaned group storage and an on-premises Exchange server that is already past end of support, which usually decides the sequencing. Shall I put the scoping question to Shane with that context attached?",
      card: { kind: "escalate" },
    };
  if (/ticket|human|person|escalat/.test(q))
    return {
      text: "That is a fair thing to want a person for. I will raise it in Zoho Desk with this conversation and your tenant context attached, so nobody asks you to explain it again.",
      card: { kind: "ticket" },
    };
  if (/chang|since|scan/.test(q))
    return {
      text: "Since scan 13, three things moved. Two anonymous sharing links were created on Client Deliverables, one of them with edit permission. The Entra Connect sync error count went from 11 to 14. And the disposition backlog grew by 330 items, which is the quiet one — it has been climbing every scan this quarter.",
      card: { kind: "finding" },
    };
  if (/worst|priorit|first/.test(q))
    return {
      text: "Legacy authentication, without much competition. It carries 1,106 MFA-free sign-ins in 30 days and it is the reason three other findings cannot be closed properly. It is also nearly done — two of the four dependent accounts are already migrated.",
      card: { kind: "fix" },
    };
  if (/cost|price|how much/.test(q))
    return {
      text: "The write action for this one is $180, which covers the change, the verification re-scan and the evidence entry. If you would rather your own team ran it, the runbook is free and in the library — I would still re-scan afterwards so the evidence is recorded either way.",
      card: { kind: "fix" },
    };
  if (/site admin|owner|admins \(/.test(q))
    return {
      text: "Site admins are the ones who can change a site’s own sharing policy, which is how sites end up above your tenant baseline. On the site you are looking at, most of that number is inherited from a group membership rather than named individuals — which is why nobody thinks of themselves as an admin. I would reduce it to two named owners and move the rest to members.",
      card: { kind: "datum", label: text },
    };
  if (/guest|external/.test(q))
    return {
      text: "You have 34 guests, up from 21 last quarter. Eleven have never signed in and seven never accepted the invitation, so a third of that number is not access — it is clutter that still counts as external identity. The count is on the risk register as an accepted risk with a trigger at 40.",
      card: { kind: "datum", label: text },
    };
  if (/link|sharing|anonymous/.test(q))
    return {
      text: 'Anonymous links are the ones that work for anyone who has the URL, with no sign-in and no expiry in your tenant. Twelve exist right now and four carry edit permission. The reason they keep appearing is the tenant default, not user behaviour — the share dialog opens on "Anyone with the link" because someone changed DefaultSharingLinkType 18 days ago without a change record.',
      card: { kind: "fix" },
    };
  if (/mfa|legacy|authenticat/.test(q))
    return {
      text: "That number is sign-ins that completed without a second factor, and it is almost entirely legacy protocols — IMAP and SMTP AUTH cannot present an MFA prompt at all, so the policy never gets a chance to apply. Four accounts, 1,106 sign-ins in 30 days, and two of the four are already migrated.",
      card: { kind: "fix" },
    };
  if (/retention|label|disposition|records/.test(q))
    return {
      text: "Retention coverage is now 1,240 of 1,240 mailboxes, held by an adaptive scope so onboarding cannot reopen the gap. The number that should worry you is the disposition backlog: 1,847 items waiting on a reviewer who has not signed in for 40 days. Retention without disposition is just storage with a promise attached.",
      card: { kind: "finding" },
    };
  if (/licen|seat|spend|copilot|\$/.test(q))
    return {
      text: "That figure is committed spend we can prove is not being used: 27 idle Copilot seats, 12 duplicate Power BI licences bought through self-service, and 19 seats still assigned to leavers. $2,280 a month, and 34 people are on the Copilot waiting list while those 27 seats sit still.",
      card: { kind: "finding" },
    };
  if (/device|intune|complian/.test(q))
    return {
      text: "187 of 212 devices are enrolled and compliant. The 25 that are not break into two groups: 14 that never completed enrolment and 11 that fell out of compliance on encryption. Nothing enforces device state at sign-in yet, so all 25 can still reach Microsoft 365 — that is CA202, which does not exist in your tenant.",
      card: { kind: "fix" },
    };
  if (/score|pillar|point/.test(q))
    return {
      text: "The score is only ever built from what we actually assessed, and every point deducted traces to a finding you can open. Accepted risks are suppressed rather than deleted — 17 points are currently not being deducted because you accepted them, and they come straight back if an acceptance expires.",
      card: { kind: "datum", label: text },
    };
  return {
    text: "I have your tenant open while we talk, so let me take that one from what is actually there rather than in general terms. Here is where that figure comes from and what I would do about it.",
    card: { kind: "datum", label: text },
  };
}
