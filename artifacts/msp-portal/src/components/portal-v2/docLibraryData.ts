/**
 * docLibraryData.ts — the Document Library fixture.
 *
 * EXTRACTED MECHANICALLY from the prototype's own `DOC_LIB` (line 11489),
 * `DOC_CATALOG` (11673) and `OWNED_META` (11662) by
 * scripts-scratch/extract-docs.js, not retyped. 33 documents of dense final copy
 * is past the point where hand-transcription is safer than parsing, and every
 * transcription error caught earlier in this build was in a value that had been
 * retyped. The extractor asserts the three array lengths before emitting.
 *
 * ── What was dropped, and why ──────────────────────────────────────────────
 * `DOC_LIB` entries also carry `accent`, `icon`, `c`, `score`, `scoreTone` and
 * `pill`. The row builder (11834-11912) reads NONE of them — it colours the
 * spine and the cover from `PILC[d.pillar]`, so those six fields are dead in
 * the rendered page and are not carried here. `DOC_CATALOG` has one of its own:
 * DOC-32 alone carries an empty `modeNote`, defined once in the whole prototype
 * and read nowhere. Everything the page reads is present and verbatim.
 *
 * ── Design content, not tenant data ─────────────────────────────────────────
 * The prototype's fictional Halden Materials library.
 */

export interface DocFact {
  label: string;
  value: string;
  sub: string;
  /** Overrides the fact value's colour; #f1f5f9 when absent. */
  tone?: string;
}

export interface DocSection {
  h: string;
  p: string;
  points?: string[];
}

export interface DocLibEntry {
  id: number;
  group: string;
  num: string;
  title: string;
  kicker: string;
  headline: string;
  standfirst: string;
  facts: DocFact[];
  sections: DocSection[];
  links?: { label: string; to: string }[];
}

export interface DocCatalogEntry {
  num: string;
  title: string;
  type: string;
  pillar: string;
  audience: string;
  offering: string;
  price?: number;
  priceLabel?: string;
  priceSub?: string;
  blurbHead: string;
  blurb: string;
  contains: string[];
  builtFrom: string;
}

export interface DocOwnedMeta {
  type: string;
  pillar: string;
  audience: string;
  offering: string;
  fresh: string;
  freshNote?: string;
}

/** `PILC` (11661) — document spine and cover colour, keyed by pillar. */
export const DOC_PILLAR_COLOUR: Readonly<Record<string, string>> = {
  Governance: "#60a5fa",
  Security: "#a78bfa",
  Compliance: "#cbd5e1",
  Licensing: "#2dd4bf",
  Adoption: "#fb923c",
  Health: "#4ade80",
  "Cross-pillar": "#22d3ee",
};

/** `LIB_TOTAL` (11778) — the real catalogue size, of which 33 are written out. */
export const DOC_LIB_TOTAL = 84;

export const DOC_LIB: readonly DocLibEntry[] = [
  {
    "id": 0,
    "group": "Assessment reports",
    "num": "DOC-01",
    "title": "Copilot Readiness, Safety & Enablement Report",
    "kicker": "Copilot readiness assessment",
    "headline": "It is not yet safe to turn Copilot on at Halden Materials",
    "standfirst": "This report evaluates your tenant against the six pillars that decide whether Copilot answers accurately, safely and only to the people entitled to the answer. It scores 41 of 82. Every point of the gap is a finding with a named owner.",
    "facts": [
      {
        "label": "Copilot gate",
        "value": "41 / 82",
        "sub": "gate clears at 68",
        "tone": "#f87171"
      },
      {
        "label": "Findings",
        "value": "41",
        "sub": "14 blocking, 27 material"
      },
      {
        "label": "Assessed",
        "value": "3 Aug 2026",
        "sub": "full tenant, no sampling"
      }
    ],
    "sections": [
      {
        "h": "Why the gate exists",
        "p": "Copilot inherits your permissions, your labels and your retention. It does not add a security boundary of its own. Where sharing is loose, Copilot summarises content the reader was never meant to see, and it does so faster and more confidently than a human search would."
      },
      {
        "h": "What is blocking today",
        "p": "Fourteen findings block the gate. They cluster in three places rather than spreading evenly, which is what makes the plan tractable.",
        "points": [
          "Governance: 9 anonymous links with no expiry, and 3 sites sitting above the tenant sharing baseline.",
          "Security: 12 privileged accounts without phishing-resistant MFA, and no Conditional Access on legacy authentication.",
          "Compliance: 3,412 documents match a sensitive information type and none carries a label, so no label-scoped control can reach them."
        ]
      },
      {
        "h": "What clearing the gate is worth",
        "p": "The eight fixes in phase 0 move the gate from 41 to 68 in two weeks and cost $6,400. They are also the fixes that would be required by any credible audit, so none of the work is Copilot-specific spend."
      }
    ],
    "links": [
      {
        "label": "Open the tenant health overview",
        "to": "home"
      },
      {
        "label": "Governance findings",
        "to": "governance"
      },
      {
        "label": "Security findings",
        "to": "security"
      }
    ]
  },
  {
    "id": 1,
    "group": "Assessment reports",
    "num": "DOC-02",
    "title": "Microsoft 365 Security Posture & Blast Radius Report",
    "kicker": "Security posture",
    "headline": "Twelve privileged accounts can be phished today",
    "standfirst": "Blast radius is the question this report answers: if one account is taken, what does the attacker reach? At Halden Materials the answer is the whole tenant, because privileged accounts share the same authentication weakness as everyone else.",
    "facts": [
      {
        "label": "Security score",
        "value": "38 / 100",
        "sub": "was 34 at last scan",
        "tone": "#a78bfa"
      },
      {
        "label": "Privileged accounts",
        "value": "12",
        "sub": "no phishing-resistant MFA",
        "tone": "#f87171"
      },
      {
        "label": "CA policies missing",
        "value": "4",
        "sub": "of the 9 baseline set",
        "tone": "#fbbf24"
      }
    ],
    "sections": [
      {
        "h": "Identity is the perimeter",
        "p": "Every finding here reduces to one fact: authentication strength is not enforced where privilege is held. SMS and authenticator push both satisfy your current policy, and both are phishable."
      },
      {
        "h": "Legacy authentication",
        "p": "Basic authentication endpoints remain reachable and 340 sign-ins used them in the last 30 days. Legacy protocols bypass Conditional Access entirely, so every policy you write is optional until they are closed.",
        "points": [
          "Block legacy authentication tenant-wide after confirming the 6 service accounts still using it.",
          "Require phishing-resistant MFA for the 12 privileged accounts first — two weeks, no user-facing change for the other 380 people."
        ]
      },
      {
        "h": "What we did not find",
        "p": "No evidence of compromise in the audit window. The findings describe exposure, not an incident."
      }
    ],
    "links": [
      {
        "label": "Security findings",
        "to": "security"
      },
      {
        "label": "MFA coverage",
        "to": "security-mfa"
      },
      {
        "label": "Conditional Access",
        "to": "security-ca"
      }
    ]
  },
  {
    "id": 2,
    "group": "Assessment reports",
    "num": "DOC-03",
    "title": "Microsoft 365 Governance Posture Report",
    "kicker": "Governance posture",
    "headline": "Sharing drifted because one default changed and nobody was told",
    "standfirst": "Eighteen days before this assessment the tenant default sharing link type was changed to anonymous access. Twenty-three drift events followed. This report traces the chain from that single setting to the nine live anonymous links now carrying pricing and board material.",
    "facts": [
      {
        "label": "Governance score",
        "value": "34 / 100",
        "sub": "lowest of the six pillars",
        "tone": "#60a5fa"
      },
      {
        "label": "Anonymous links",
        "value": "9",
        "sub": "4 with edit permission",
        "tone": "#f87171"
      },
      {
        "label": "Detection time",
        "value": "11 hrs",
        "sub": "event to your dashboard"
      }
    ],
    "sections": [
      {
        "h": "The default did the damage",
        "p": "Users did not start choosing anonymous links. The share dialog started choosing it for them. That is why the volume rose without any change in behaviour, and why one setting reverses most of it."
      },
      {
        "h": "Where the tenant value does not hold",
        "p": "The tenant sharing capability is a ceiling for new sites, not an enforced floor for existing ones. Three site owners raised their own sites above the baseline and nothing prevented it.",
        "points": [
          "Set a 30-day expiry on anonymous links tenant-wide — the one change that ages out the existing exposure.",
          "Reset the 3 sites above baseline to inherit the tenant setting.",
          "Add an alert policy on AnonymousLinkCreated so detection stops depending on scan cadence."
        ]
      },
      {
        "h": "Private channels",
        "p": "Twelve private channels each carry their own site collection, and seven of those sites fall outside every retention policy. Retention is not inherited from the parent team, which is the most commonly missed consequence of private channels."
      }
    ],
    "links": [
      {
        "label": "Governance findings",
        "to": "governance"
      },
      {
        "label": "Sharing drift",
        "to": "governance-drift"
      },
      {
        "label": "Overshared SharePoint",
        "to": "governance-oversharing-full"
      }
    ]
  },
  {
    "id": 3,
    "group": "Assessment reports",
    "num": "DOC-04",
    "title": "Microsoft 365 Compliance & Regulatory Alignment Report",
    "kicker": "Compliance alignment",
    "headline": "Nothing is labelled, so no control can reach the data",
    "standfirst": "Sensitivity labels, DLP and auto-labelling all depend on classification existing first. At Halden Materials no label is published, so 3,412 documents matching a sensitive information type sit outside every label-scoped control you own.",
    "facts": [
      {
        "label": "Compliance score",
        "value": "29 / 100",
        "sub": "blocked on one dependency",
        "tone": "#e2e8f0"
      },
      {
        "label": "Sensitive documents",
        "value": "3,412",
        "sub": "up 232 this month",
        "tone": "#f87171"
      },
      {
        "label": "Labels published",
        "value": "0",
        "sub": "of 4 planned",
        "tone": "#f87171"
      }
    ],
    "sections": [
      {
        "h": "One dependency governs the pillar",
        "p": "Publishing a single Internal label unblocks auto-labelling, DLP scoping and record declaration in one move. Until it exists, five findings on this page cannot be worked at all."
      },
      {
        "h": "Retention is deleting too early",
        "p": "A one-year delete policy covers content that carries a statutory six-year obligation, including the finance shared library. This is the only finding in the pack where waiting has an irreversible cost.",
        "points": [
          "Simulate auto-labelling on the 2,140 high-confidence matches before enforcing anything.",
          "Scope the finance library out of the one-year delete policy this week.",
          "Enable preservation lock on the retention policy that covers statutory records."
        ]
      },
      {
        "h": "Audit retention",
        "p": "Audit log retention is set to 180 days. Any investigation that reaches back further than that has no evidence to work from."
      }
    ],
    "links": [
      {
        "label": "Compliance findings",
        "to": "compliance"
      },
      {
        "label": "Sensitivity labels",
        "to": "compliance-sensitivity-labels"
      },
      {
        "label": "Auto-labelling",
        "to": "compliance-autolabel"
      }
    ]
  },
  {
    "id": 4,
    "group": "Assessment reports",
    "num": "DOC-05",
    "title": "Copilot Licensing Alignment Report",
    "kicker": "Licensing alignment",
    "headline": "$2,280 a month is reclaimable before any Copilot spend",
    "standfirst": "This report reconciles what you pay for against what is used. Forty-one assigned licences show no activity in 90 days, and the Copilot pilot can be funded entirely from what they cost.",
    "facts": [
      {
        "label": "Licensing score",
        "value": "57 / 100",
        "sub": "highest-value quick win",
        "tone": "#2dd4bf"
      },
      {
        "label": "Reclaimable",
        "value": "$2,280",
        "sub": "per month",
        "tone": "#4ade80"
      },
      {
        "label": "Dormant licences",
        "value": "41",
        "sub": "no activity in 90 days",
        "tone": "#fbbf24"
      }
    ],
    "sections": [
      {
        "h": "Where the money is",
        "p": "Twenty-three E3 licences are assigned to accounts that have not signed in for 90 days, including 9 that belong to leavers whose accounts were never disabled. Those 9 are a security finding as much as a cost one."
      },
      {
        "h": "Copilot prerequisites",
        "p": "Copilot requires an eligible base licence per user. Your current mix covers the 24-person pilot without new base licences, so the only new cost is Copilot itself.",
        "points": [
          "Reclaim the 9 leaver licences immediately — they are also open accounts.",
          "Review the remaining 32 dormant licences with the department owners before reclaiming."
        ]
      }
    ],
    "links": [
      {
        "label": "Licensing & cost",
        "to": "licensing"
      },
      {
        "label": "Billing",
        "to": "billing"
      }
    ]
  },
  {
    "id": 5,
    "group": "Assessment reports",
    "num": "DOC-06",
    "title": "Copilot Adoption & Workflow Readiness Report",
    "kicker": "Adoption readiness",
    "headline": "The pilot group is right; the workflows are not documented",
    "standfirst": "Copilot value depends on people having a task to give it. This report maps the workflows most likely to produce measurable time saved, and finds that none of them are written down.",
    "facts": [
      {
        "label": "Adoption score",
        "value": "46 / 100",
        "sub": "people ready, process not",
        "tone": "#fb923c"
      },
      {
        "label": "Pilot group",
        "value": "24",
        "sub": "from a draft list of 31"
      },
      {
        "label": "Documented workflows",
        "value": "2",
        "sub": "of 11 candidates",
        "tone": "#fbbf24"
      }
    ],
    "sections": [
      {
        "h": "Where Copilot pays first",
        "p": "Bid response drafting, monthly board pack assembly and service desk triage are the three workflows with enough volume and enough repetition to show a measurable difference inside a two-week pilot."
      },
      {
        "h": "What the pilot needs from you",
        "p": "Two training sessions and a named owner per workflow. Without an owner the pilot produces anecdotes rather than a number.",
        "points": [
          "Confirm the 24-person pilot list and the two session dates.",
          "Name an owner for each of the three workflows."
        ]
      }
    ],
    "links": [
      {
        "label": "Adoption",
        "to": "adoption"
      },
      {
        "label": "Project plan",
        "to": "projects"
      }
    ]
  },
  {
    "id": 6,
    "group": "Assessment reports",
    "num": "DOC-07",
    "title": "Microsoft 365 Operational Health & Service Integrity Report",
    "kicker": "Operational health",
    "headline": "Thirty-seven tenant changes in 90 days, none reviewed",
    "standfirst": "Posture decays between assessments. This report measures how quickly that happens at Halden Materials and finds no mechanism that would catch it — 37 configuration changes were made in the audit window and none went through a review.",
    "facts": [
      {
        "label": "Health score",
        "value": "44 / 100",
        "sub": "no change control in place",
        "tone": "#4ade80"
      },
      {
        "label": "Unreviewed changes",
        "value": "37",
        "sub": "in 90 days",
        "tone": "#f87171"
      },
      {
        "label": "Alert policies",
        "value": "3",
        "sub": "of 14 recommended",
        "tone": "#fbbf24"
      }
    ],
    "sections": [
      {
        "h": "The finding behind the findings",
        "p": "The sharing default that caused 23 governance drift events was one of these 37 changes. Nothing about it was wrong procedurally, because there was no procedure. Change control is the control that keeps the other five pillars from drifting back."
      },
      {
        "h": "Service integrity",
        "p": "Two service advisories in the window affected your tenant and neither was actioned, because Microsoft message centre posts are not routed to anyone.",
        "points": [
          "Stand up change control with a CR gate on every tenant-level change.",
          "Route message centre posts with a tenant impact to a named owner."
        ]
      }
    ],
    "links": [
      {
        "label": "Health",
        "to": "health"
      },
      {
        "label": "Change control",
        "to": "change-control"
      },
      {
        "label": "Message centre",
        "to": "ms-changes"
      }
    ]
  },
  {
    "id": 7,
    "group": "Plan & contract",
    "num": "DOC-08",
    "title": "Full Remediation Guide — Copilot Gate Clearance Plan",
    "kicker": "Remediation plan",
    "headline": "Forty-one findings, sequenced so nothing is done twice",
    "standfirst": "Every finding in the pack, ordered by dependency rather than by severity. Where two findings share a fix, the guide says so once and names the finding it also closes.",
    "facts": [
      {
        "label": "Findings covered",
        "value": "41",
        "sub": "across six pillars"
      },
      {
        "label": "Phase 0",
        "value": "8 fixes",
        "sub": "2 weeks, gate 41 → 68",
        "tone": "#4ade80"
      },
      {
        "label": "Full plan",
        "value": "12 weeks",
        "sub": "6 phases, each optional"
      }
    ],
    "sections": [
      {
        "h": "How the sequence was built",
        "p": "Three rules: anything irreversible first, anything that unblocks other findings second, anything that only improves a score last. That is why the finance retention scope change precedes the label work, and why the label work precedes DLP."
      },
      {
        "h": "What each fix carries",
        "p": "Every fix in the guide has the same four parts, so nothing is a black box.",
        "points": [
          "What changes, in plain language, and what it does not change.",
          "The exact Graph or PowerShell call, and the manual steps for doing it yourself.",
          "The risk of doing it, and the risk of not doing it.",
          "The evidence we file afterwards, and where it lands in the portal."
        ]
      }
    ],
    "links": [
      {
        "label": "SOPs & Runbooks",
        "to": "sop-hub"
      },
      {
        "label": "Active runbooks",
        "to": "operate-runbooks"
      },
      {
        "label": "Risk register",
        "to": "risk-register"
      }
    ]
  },
  {
    "id": 8,
    "group": "Plan & contract",
    "num": "DOC-09",
    "title": "Statement of Work — Copilot Gate Clearance",
    "kicker": "SOW-2026-0114",
    "headline": "Phase 0 and phase 3, fixed fee, $14,800",
    "standfirst": "The signed scope. Phases are priced separately and each one states the findings it closes and the gate movement it is accountable for, so scope and outcome are the same document.",
    "facts": [
      {
        "label": "Fixed fee",
        "value": "$14,800",
        "sub": "2 of 4 milestones released"
      },
      {
        "label": "Contracted end",
        "value": "26 Sep 2026",
        "sub": "phase 5 at risk",
        "tone": "#fbbf24"
      },
      {
        "label": "Change requests",
        "value": "1",
        "sub": "CR-2026-0181 raised"
      }
    ],
    "sections": [
      {
        "h": "What is in scope",
        "p": "Phase 0 gate clearance and phase 3 compliance foundations. Remediation of findings outside those phases is not in this SOW; three were found during discovery and raised as a change request rather than absorbed, so the price and the dates stay honest."
      },
      {
        "h": "How progress is read",
        "p": "Against schedule 2 deliverables, not against a task count. A phase is complete when its findings are closed and the evidence is filed, which is why phase 5 shows at risk even though its task list is nearly done."
      }
    ],
    "links": [
      {
        "label": "Project plan",
        "to": "projects"
      },
      {
        "label": "Change control",
        "to": "change-control"
      },
      {
        "label": "Billing",
        "to": "billing"
      }
    ]
  }
];

export const DOC_OWNED_META: readonly DocOwnedMeta[] = [
  {
    "type": "Report",
    "pillar": "Cross-pillar",
    "audience": "Board",
    "offering": "Copilot Readiness Assessment",
    "fresh": "stale",
    "freshNote": "Telemetry moved since 3 Aug"
  },
  {
    "type": "Report",
    "pillar": "Security",
    "audience": "IT",
    "offering": "Copilot Readiness Assessment",
    "fresh": "current"
  },
  {
    "type": "Report",
    "pillar": "Governance",
    "audience": "IT",
    "offering": "Copilot Readiness Assessment",
    "fresh": "stale",
    "freshNote": "2 new drift events since issue"
  },
  {
    "type": "Report",
    "pillar": "Compliance",
    "audience": "Auditor",
    "offering": "Copilot Readiness Assessment",
    "fresh": "current"
  },
  {
    "type": "Report",
    "pillar": "Licensing",
    "audience": "Board",
    "offering": "Copilot Readiness Assessment",
    "fresh": "current"
  },
  {
    "type": "Report",
    "pillar": "Adoption",
    "audience": "IT",
    "offering": "Copilot Readiness Assessment",
    "fresh": "current"
  },
  {
    "type": "Report",
    "pillar": "Health",
    "audience": "IT",
    "offering": "Copilot Readiness Assessment",
    "fresh": "current"
  },
  {
    "type": "Remediation plan",
    "pillar": "Cross-pillar",
    "audience": "IT",
    "offering": "Copilot Readiness Assessment",
    "fresh": "current"
  },
  {
    "type": "Contract",
    "pillar": "Cross-pillar",
    "audience": "Board",
    "offering": "Copilot Gate Clearance",
    "fresh": "signed"
  }
];

export const DOC_CATALOG: readonly DocCatalogEntry[] = [
  {
    "num": "DOC-10",
    "title": "Conditional Access Baseline — Configuration Guide",
    "type": "Configuration guide",
    "pillar": "Security",
    "audience": "IT",
    "offering": "Security Hardening",
    "price": 340,
    "blurbHead": "Nine policies, written against the 4 you are missing",
    "blurb": "The baseline Conditional Access set, with each policy written out as the exact portal steps and the Graph call, named for the accounts in your tenant that it will affect on the day it is switched on.",
    "contains": [
      "Policy-by-policy configuration for all nine baseline policies, in the order they must be enabled",
      "Your 6 service accounts and 12 privileged accounts named in the exclusion and scoping tables",
      "Report-only rollout schedule, with the sign-in log queries to check before each policy is enforced"
    ],
    "builtFrom": "Your current 5 Conditional Access policies, 30 days of sign-in logs, and the 340 legacy authentication sign-ins already found in the assessment."
  },
  {
    "num": "DOC-11",
    "title": "Privileged Access & PIM Rollout Runbook",
    "type": "SOP & runbook",
    "pillar": "Security",
    "audience": "IT",
    "offering": "Security Hardening",
    "price": 290,
    "blurbHead": "Move 12 standing admins to eligible, without locking yourself out",
    "blurb": "A step-by-step runbook for putting your privileged roles behind Privileged Identity Management, including the break-glass accounts and the order that keeps a route in if a policy goes wrong.",
    "contains": [
      "Per-role activation settings, approval routing and justification requirements for your 8 assigned roles",
      "Break-glass account creation and the exclusions that must exist before PIM is enabled",
      "A rollback step at every stage, and the audit evidence filed against each one"
    ],
    "builtFrom": "Your directory role assignments, the 12 accounts holding standing privilege, and the MFA methods registered against each."
  },
  {
    "num": "DOC-12",
    "title": "Phishing-Resistant MFA Migration Plan",
    "type": "Remediation plan",
    "pillar": "Security",
    "audience": "IT",
    "offering": "Security Hardening",
    "price": 290,
    "blurbHead": "Privileged accounts first, 380 users second",
    "blurb": "A sequenced plan to move from phishable authenticator push to FIDO2 and Windows Hello, priced and scheduled so the 12 privileged accounts are done in two weeks with no user-facing change elsewhere.",
    "contains": [
      "Method inventory per user, with the 12 accounts that must move first named",
      "Hardware key procurement quantities and the registration campaign wording",
      "Communications and helpdesk script for the wider rollout"
    ],
    "builtFrom": "Registered authentication methods for all 392 accounts and your current authentication methods policy."
  },
  {
    "num": "DOC-13",
    "title": "Legacy Authentication Shutdown Runbook",
    "type": "SOP & runbook",
    "pillar": "Security",
    "audience": "IT",
    "offering": "Security Hardening",
    "price": 240,
    "blurbHead": "Close basic auth without breaking the 6 things using it",
    "blurb": "Every policy you write is optional until legacy authentication is closed. This runbook names what is still using it in your tenant and gives the migration step for each before the block goes on.",
    "contains": [
      "The 6 service accounts and 2 devices still authenticating with basic auth, with owner and last use",
      "A per-workload migration step, including the SMTP relay alternative",
      "The block policy, the report-only window, and the sign-in queries that confirm nothing broke"
    ],
    "builtFrom": "340 legacy authentication sign-ins in the last 30 days, grouped by protocol, account and application."
  },
  {
    "num": "DOC-14",
    "title": "External Sharing & Guest Access Policy",
    "type": "Policy",
    "pillar": "Governance",
    "audience": "Board",
    "offering": "Governance Baseline",
    "price": 260,
    "blurbHead": "The policy that would have stopped the nine anonymous links",
    "blurb": "A board-approvable sharing policy stating what may be shared with whom, how long links live, and who is accountable when a site is raised above the baseline.",
    "contains": [
      "Sharing tiers by content class, mapped to your existing sites",
      "Link expiry, permission defaults and the review cadence for exceptions",
      "An accountability table naming the roles that approve each exception"
    ],
    "builtFrom": "Your tenant sharing capability, the 3 sites above baseline, and the 9 live anonymous links found in the assessment."
  },
  {
    "num": "DOC-15",
    "title": "SharePoint & Teams Site Lifecycle Guide",
    "type": "Configuration guide",
    "pillar": "Governance",
    "audience": "IT",
    "offering": "Governance Baseline",
    "price": 310,
    "blurbHead": "Creation, ownership, review and archive, configured",
    "blurb": "How sites and teams get created, who owns them, when ownership is re-checked and what happens at end of life — written as the settings to apply rather than principles to agree with.",
    "contains": [
      "Creation controls, naming policy and templates as configured values",
      "Ownerless group policy and the access review schedule",
      "Archive and deletion paths, with the retention consequence of each stated"
    ],
    "builtFrom": "Your 214 sites and 96 teams, including the 11 with no owner and the 34 with no activity in 180 days."
  },
  {
    "num": "DOC-16",
    "title": "Teams Channel & Private Channel Governance Standard",
    "type": "Policy",
    "pillar": "Governance",
    "audience": "IT",
    "offering": "Governance Baseline",
    "price": 260,
    "blurbHead": "Twelve private channels, seven outside retention",
    "blurb": "A standard for private and shared channels that closes the retention gap they create, with the specific channels in your tenant that are currently uncovered.",
    "contains": [
      "When a private channel is permitted, and what must be true before it is created",
      "The retention and eDiscovery consequence of each channel type, in plain terms",
      "Remediation for the 7 private channel sites currently outside every retention policy"
    ],
    "builtFrom": "Channel inventory across 96 teams and the retention policy scope for each backing site collection."
  },
  {
    "num": "DOC-17",
    "title": "Sensitivity Label Taxonomy & Rollout Plan",
    "type": "Remediation plan",
    "pillar": "Compliance",
    "audience": "IT",
    "offering": "Compliance Foundations",
    "price": 380,
    "blurbHead": "Four labels, published in an order that does not break the board pack",
    "blurb": "The label taxonomy for your content, with the encryption decision made per label and the external advisers who must be in the permitted set before Highly Confidential is published.",
    "contains": [
      "Four label definitions with marking, encryption and downgrade settings",
      "Publication order, pilot group and the two-week gap before defaulting",
      "The 3,412 matching documents grouped by label they should receive"
    ],
    "builtFrom": "Content explorer matches by sensitive information type, and the 8,000 documents estimated to qualify for Confidential."
  },
  {
    "num": "DOC-18",
    "title": "DLP Policy Set — Configuration Guide",
    "type": "Configuration guide",
    "pillar": "Compliance",
    "audience": "IT",
    "offering": "Compliance Foundations",
    "price": 360,
    "blurbHead": "DLP rules scoped to labels that exist",
    "blurb": "The DLP policy set for your workloads, with rule conditions, actions and the simulation results to review before any policy moves out of test.",
    "contains": [
      "Policy per workload with conditions written against your sensitive information types",
      "Simulation-first rollout, with the expected match volume per rule",
      "Incident routing, and the false-positive tuning steps for your part-number collision"
    ],
    "builtFrom": "Sensitive information type matches across SharePoint, OneDrive and Exchange, including the 800 known false positives."
  },
  {
    "num": "DOC-19",
    "title": "Retention & Records Schedule",
    "type": "Policy",
    "pillar": "Compliance",
    "audience": "Auditor",
    "offering": "Compliance Foundations",
    "price": 340,
    "blurbHead": "The schedule that stops finance being deleted six years early",
    "blurb": "A records schedule mapping each content class to its statutory obligation and the retention setting that delivers it, starting with the library your current one-year policy is deleting too soon.",
    "contains": [
      "Content class to obligation mapping, with the legal basis stated per row",
      "The retention label and policy configuration for each class",
      "Preservation lock decisions, and what becomes irreversible once applied"
    ],
    "builtFrom": "Your 4 retention policies, the libraries in scope of each, and the finance library found under a one-year delete."
  },
  {
    "num": "DOC-20",
    "title": "Audit Log Retention & Evidence Pack Procedure",
    "type": "SOP & runbook",
    "pillar": "Compliance",
    "audience": "Auditor",
    "offering": "Compliance Foundations",
    "price": 220,
    "blurbHead": "180 days is not an audit window",
    "blurb": "How to extend audit retention and how to assemble an evidence pack an auditor accepts, with the exact searches and exports for each of your six pillars.",
    "contains": [
      "Audit retention configuration and the licensing prerequisite for each tier",
      "Standing searches per pillar, saved and scheduled",
      "Evidence pack structure, naming and where copies are filed in the portal"
    ],
    "builtFrom": "Your current 180-day audit retention setting and the audit search activity in the assessment window."
  },
  {
    "num": "DOC-21",
    "title": "eDiscovery & Legal Hold Runbook",
    "type": "SOP & runbook",
    "pillar": "Compliance",
    "audience": "Auditor",
    "offering": "Compliance Foundations",
    "price": 270,
    "blurbHead": "A hold you can defend, placed in under an hour",
    "blurb": "The runbook for a legal hold or eDiscovery request in your tenant, including the private channel sites and the Teams content that a naive custodian search misses.",
    "contains": [
      "Custodian identification, including the mailbox and site locations behind each person",
      "Hold placement steps, with the private channel sites named explicitly",
      "Chain of custody records and the export format for each content type"
    ],
    "builtFrom": "Your case inventory, existing holds, and the 7 private channel sites outside retention scope."
  },
  {
    "num": "DOC-22",
    "title": "Licence Reclamation Runbook",
    "type": "SOP & runbook",
    "pillar": "Licensing",
    "audience": "IT",
    "offering": "Operate & Monitor",
    "price": 190,
    "blurbHead": "$2,280 a month, reclaimed in a defensible order",
    "blurb": "The runbook for reclaiming your 41 dormant licences, separating the 9 leaver accounts that are also a security finding from the 32 that need a department conversation first.",
    "contains": [
      "The 41 accounts, grouped by reason, with last sign-in and owning department",
      "Leaver offboarding steps for the 9 accounts that were never disabled",
      "A monthly cadence so the count does not rebuild"
    ],
    "builtFrom": "Licence assignment and sign-in activity for all 392 accounts over 90 days."
  },
  {
    "num": "DOC-23",
    "title": "Copilot Licence Business Case",
    "type": "Report",
    "pillar": "Licensing",
    "audience": "Board",
    "offering": "Adoption & Enablement",
    "price": 280,
    "blurbHead": "The pilot funded entirely from dormant licences",
    "blurb": "A board-facing case for Copilot seats built on your own numbers: what the pilot costs, what it displaces, and the three workflows that will produce the measurement.",
    "contains": [
      "Cost model for 24 pilot seats against the $2,280 monthly reclaim",
      "Prerequisite check showing no new base licences are required",
      "The measurement plan the board should hold the pilot to"
    ],
    "builtFrom": "Your licence mix, dormant licence cost, and the pilot list from the adoption assessment."
  },
  {
    "num": "DOC-24",
    "title": "Copilot Pilot Enablement Playbook",
    "type": "SOP & runbook",
    "pillar": "Adoption",
    "audience": "IT",
    "offering": "Adoption & Enablement",
    "price": 300,
    "blurbHead": "Two sessions, three workflows, one owner each",
    "blurb": "The playbook for running the 24-person pilot, with session content, the workflow documentation the pilot needs written before it starts, and the weekly measures.",
    "contains": [
      "Session plans and the pre-work each attendee completes",
      "Workflow documentation templates for the three named candidate workflows",
      "Weekly measurement sheet and the exit criteria for going wider"
    ],
    "builtFrom": "The 24-person pilot list, the 11 candidate workflows, and the 2 already documented."
  },
  {
    "num": "DOC-25",
    "title": "Copilot Acceptable Use Policy",
    "type": "Policy",
    "pillar": "Adoption",
    "audience": "Board",
    "offering": "Adoption & Enablement",
    "price": 240,
    "blurbHead": "What people may put in a prompt, and what they may not",
    "blurb": "A short acceptable use policy for Copilot written for staff rather than lawyers, covering prompt content, output review and the classes of data that are out of scope.",
    "contains": [
      "Permitted and prohibited use, with examples drawn from your workflows",
      "Output review expectations before anything Copilot drafts is sent externally",
      "The link between labels and Copilot scope, in language staff understand"
    ],
    "builtFrom": "Your label taxonomy, sharing posture, and the workflows in the adoption assessment."
  },
  {
    "num": "DOC-26",
    "title": "Copilot Prompt Library by Workflow",
    "type": "Configuration guide",
    "pillar": "Adoption",
    "audience": "IT",
    "offering": "Adoption & Enablement",
    "price": 200,
    "blurbHead": "Prompts written for bid response, board pack and triage",
    "blurb": "A prompt library for your three highest-value workflows, with the exact prompts, the files they expect to be able to reach, and what a good output looks like.",
    "contains": [
      "12 prompts per workflow, tested against your document structures",
      "The permissions each prompt assumes, so a failure is diagnosable",
      "A short guide to why a prompt returns nothing, aimed at the workflow owner"
    ],
    "builtFrom": "The three workflows named in the adoption report and the sites their content lives in."
  },
  {
    "num": "DOC-27",
    "title": "Change Control Procedure & CR Templates",
    "type": "SOP & runbook",
    "pillar": "Health",
    "audience": "IT",
    "offering": "Operate & Monitor",
    "price": 230,
    "blurbHead": "The control that keeps the other five pillars from drifting back",
    "blurb": "A change control procedure sized for your tenant, with the CR template, the approval routing, and the classes of change that may proceed without one.",
    "contains": [
      "Change classes, approval routing and the emergency path",
      "CR template with the evidence each field requires",
      "The tenant-level settings that must never change without a CR, listed"
    ],
    "builtFrom": "The 37 unreviewed configuration changes in the audit window, classified by risk."
  },
  {
    "num": "DOC-28",
    "title": "Tenant Configuration Baseline & Drift Standard",
    "type": "Policy",
    "pillar": "Health",
    "audience": "IT",
    "offering": "Operate & Monitor",
    "price": 320,
    "blurbHead": "The state your tenant should be in, written down",
    "blurb": "A signed baseline of every tenant-level setting that matters, so drift becomes a comparison rather than an opinion. This is the document the Drift Engine measures against.",
    "contains": [
      "Setting-by-setting baseline across all six pillars, with current and target values",
      "Drift severity classification and the alert that should fire per class",
      "Re-baselining procedure for when a target legitimately changes"
    ],
    "builtFrom": "A full configuration read of your tenant on 3 Aug 2026, with no sampling."
  },
  {
    "num": "DOC-29",
    "title": "Message Centre Triage Runbook",
    "type": "SOP & runbook",
    "pillar": "Health",
    "audience": "IT",
    "offering": "Operate & Monitor",
    "price": 180,
    "blurbHead": "Two advisories affected you and nobody read them",
    "blurb": "A triage runbook for Microsoft message centre posts, routing the ones with tenant impact to a named owner and closing them with a recorded decision.",
    "contains": [
      "Routing rules by service and impact class, with named owners",
      "Assessment template so a post closes with a decision, not a shrug",
      "Backlog triage for the posts already sitting unread"
    ],
    "builtFrom": "Message centre posts in your tenant over 90 days, filtered for the services you actually use."
  },
  {
    "num": "DOC-30",
    "title": "Backup & Recovery Assurance Report",
    "type": "Report",
    "pillar": "Health",
    "audience": "Auditor",
    "offering": "Operate & Monitor",
    "price": 290,
    "blurbHead": "What Microsoft retains, and what you assume it does",
    "blurb": "An assurance report separating Microsoft native retention from actual backup, and stating your real recovery position per workload against the recovery point you believe you have.",
    "contains": [
      "Per-workload retention and recovery reality, against your stated RPO and RTO",
      "The gaps that only appear in a restore test, and the test procedure",
      "Recommendations sized against the value of the content at risk"
    ],
    "builtFrom": "Recycle bin and version settings per site, retention policy scope, and any third-party backup coverage detected."
  },
  {
    "num": "DOC-31",
    "title": "Statement of Work — Security Hardening Programme",
    "type": "Contract",
    "pillar": "Security",
    "audience": "Board",
    "offering": "Security Hardening",
    "price": 0,
    "priceLabel": "Included when scoped",
    "priceSub": "Issued with a fixed-fee proposal, not sold separately",
    "blurbHead": "Scope, price and the findings each phase closes",
    "blurb": "The contractual scope for the security hardening programme, priced by phase, with each phase stating the findings it closes and the score movement it is accountable for.",
    "contains": [
      "Phase scope, price and duration, with the findings closed by each listed by ID",
      "Acceptance criteria expressed as evidence rather than task completion",
      "Change request terms, so discovery findings do not silently become scope"
    ],
    "builtFrom": "The security findings in your assessment, sequenced and grouped into deliverable phases."
  },
  {
    "num": "DOC-32",
    "title": "Cyber Essentials Plus — Evidence Mapping",
    "type": "Report",
    "pillar": "Compliance",
    "audience": "Auditor",
    "offering": "Compliance Foundations",
    "price": 420,
    "blurbHead": "Every control mapped to the evidence in your tenant",
    "blurb": "Your tenant configuration mapped control by control against Cyber Essentials Plus, marking what already passes, what fails, and the exact export that proves each passing control.",
    "contains": [
      "Control-by-control status with the Graph query or portal export that evidences it",
      "The failing controls, with the remediation that closes each and its effort",
      "An assessor-ready pack structure, so the evidence is not reassembled at audit"
    ],
    "builtFrom": "Your full configuration read, device compliance state, and patch and MFA coverage data."
  },
  {
    "num": "DOC-33",
    "title": "Board Briefing Pack — Tenant Risk in Plain English",
    "type": "Report",
    "pillar": "Cross-pillar",
    "audience": "Board",
    "offering": "Operate & Monitor",
    "price": 260,
    "blurbHead": "Six pillars, one page each, no jargon",
    "blurb": "A board pack that states your tenant risk without technical vocabulary: what could happen, how likely it is, what it would cost, and what is being done about it this quarter.",
    "contains": [
      "One page per pillar, each ending in a decision the board actually has to make",
      "Risk expressed in operational and financial terms, not scores",
      "A quarter-on-quarter comparison once monitoring has two data points"
    ],
    "builtFrom": "The same telemetry as your assessment reports, restated for a non-technical reader."
  }
];
