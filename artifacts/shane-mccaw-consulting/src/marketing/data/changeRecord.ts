// The Quick-Start change record shown at /records/:id, recreated verbatim from
// Design/design_handoff_marketing/Quick-Start Change Record.dc.html.
//
// This is a real document, not a dashboard — every figure and sentence on it is the design's own
// authored example (one purchase, three packs, eleven changes), kept here as data rather than
// inline in ChangeRecord.tsx per the repo's "never hardcode a tenant number in a component"
// convention. Production reads this from the real execution log (README "Out of scope"); this
// fixture is what stands in for that until the write-back engine is real. Keyed by record id so
// the :id route has something real to look up — there is only one designed example today, so
// every id currently resolves to it via CHANGE_RECORDS[id] ?? DEFAULT_CHANGE_RECORD.

export type ChangeResult = "applied" | "declined" | "correct";

export interface ChangeRow {
  setting: string;
  before: string;
  after: string;
  result: ChangeResult;
  resultLabel: string;
}

export interface ChangeRecordPack {
  name: string;
  priceLabel: string;
  scopeNote: string;
  rows: ChangeRow[];
}

export interface ChangeRecordData {
  id: string;
  tenantName: string;
  tagline: string; // the header band's summary sentence, e.g. "Three packs, eleven changes applied..."
  generatedDateLong: string; // "21 August 2026"
  generatedAtUtc: string; // "21 August 2026, 14:22 UTC"
  summary: {
    packsPurchased: number;
    changesApplied: number;
    declinedByYou: number;
    alreadyCorrect: number;
  };
  authorisation: { label: string; value: string }[];
  packs: ChangeRecordPack[];
  verification: {
    intro: string;
    rows: { label: string; value: string }[];
  };
  whatWasNotDone: string;
  appendix: {
    heading: string;
    intro: string;
    accounts: string[];
  };
}

export const RESULT_COLOR: Record<ChangeResult, string> = {
  applied: "#0f766e",
  declined: "#b45309",
  correct: "#64748b",
};

const DEFAULT_CHANGE_RECORD: ChangeRecordData = {
  id: "CR-QS-2026-0184",
  tenantName: "Halden Materials",
  tagline:
    "Three packs, eleven changes applied, two declined, two already correct. Generated from the execution log on 21 August 2026 and kept for as long as your tenant is with us.",
  generatedDateLong: "21 August 2026",
  generatedAtUtc: "21 August 2026, 14:22 UTC",
  summary: {
    packsPurchased: 3,
    changesApplied: 11,
    declinedByYou: 2,
    alreadyCorrect: 2,
  },
  authorisation: [
    { label: "Purchased by", value: "jordan.diaz@haldenmaterials.com" },
    {
      label: "Write consent granted",
      value: "21 August 2026, 13:58 UTC · scoped to these packs",
    },
    {
      label: "Scopes used",
      value:
        "Policy.ReadWrite.ConditionalAccess, RoleManagement.ReadWrite.Directory, User.ReadWrite.All, Organization.ReadWrite.All",
    },
    { label: "Dry run approved", value: "21 August 2026, 14:06 UTC" },
    { label: "Executed", value: "21 August 2026, 14:07–14:19 UTC" },
    { label: "Write access after execution", value: "Revoked automatically at 14:20 UTC" },
  ],
  packs: [
    {
      name: "Entra ID Quick-Start Pack",
      priceLabel: "$799",
      scopeNote: "5 changes in scope, 4 applied, 1 already correct",
      rows: [
        {
          setting: "Break-glass account",
          before: "None exists",
          after: "bg-admin@tenant.onmicrosoft.com, excluded from all CA policies",
          result: "applied",
          resultLabel: "Applied 14:07",
        },
        {
          setting: "Legacy authentication",
          before: "Allowed on 4 protocols",
          after: "Blocked tenant-wide, report-only until 28 August",
          result: "applied",
          resultLabel: "Applied 14:09",
        },
        {
          setting: "Guest invitations",
          before: "Anyone in the tenant can invite",
          after: "Admins and the guest-inviter role only",
          result: "applied",
          resultLabel: "Applied 14:10",
        },
        {
          setting: "Group naming policy",
          before: "Prefix by department, blocked-word list",
          after: "Unchanged",
          result: "correct",
          resultLabel: "Already correct",
        },
        {
          setting: "Self-service password reset",
          before: "Disabled",
          after: "Enabled for all users, 2 methods required",
          result: "applied",
          resultLabel: "Applied 14:11",
        },
      ],
    },
    {
      name: "Conditional Access Baseline Pack",
      priceLabel: "$199",
      scopeNote: "5 changes in scope, 4 applied, 1 declined",
      rows: [
        {
          setting: "MFA for administrators",
          before: "Not enforced on 8 directory roles",
          after: "Enforced, break-glass excluded",
          result: "applied",
          resultLabel: "Applied 14:12",
        },
        {
          setting: "Compliant device requirement",
          before: "Not enforced",
          after: "Report-only until 28 August, then enforced. 41 devices named in the report.",
          result: "applied",
          resultLabel: "Applied 14:13",
        },
        {
          setting: "Country allow-list",
          before: "No location policy",
          after: "No location policy",
          result: "declined",
          resultLabel: "Declined by you",
        },
        {
          setting: "MFA on risky sign-ins",
          before: "Not enforced",
          after: "Enforced at medium risk and above",
          result: "applied",
          resultLabel: "Applied 14:15",
        },
        {
          setting: "Legacy authentication (CA)",
          before: "Allowed",
          after: "Blocked",
          result: "applied",
          resultLabel: "Applied 14:16",
        },
      ],
    },
    {
      name: "Privileged Access Pack",
      priceLabel: "$299",
      scopeNote: "4 changes in scope, 3 applied, 1 declined",
      rows: [
        {
          setting: "Standing admin assignments",
          before: "12 permanently active",
          after: "12 eligible, activation required. Names listed in appendix A.",
          result: "applied",
          resultLabel: "Applied 14:17",
        },
        {
          setting: "Global Administrator activation",
          before: "No approval required",
          after: "2 named approvers, 8-hour maximum",
          result: "applied",
          resultLabel: "Applied 14:18",
        },
        {
          setting: "Justification and MFA on activation",
          before: "Not required",
          after: "Required on every activation",
          result: "applied",
          resultLabel: "Applied 14:19",
        },
        {
          setting: "Quarterly access review",
          before: "No review configured",
          after: "No review configured",
          result: "declined",
          resultLabel: "Declined by you",
        },
      ],
    },
  ],
  verification: {
    intro:
      "A read-only scan ran 20 minutes after execution and confirmed every applied value against Microsoft Graph. Two changes are in a report-only period and will be re-verified when they enforce.",
    rows: [
      { label: "Verification scan", value: "21 August 2026, 14:40 UTC" },
      { label: "Values confirmed", value: "11 of 11" },
      { label: "Pending enforcement", value: "2 · report-only until 28 August 2026" },
      {
        label: "Rollback available until",
        value: "20 September 2026 · every applied change has a stored prior value",
      },
    ],
  },
  whatWasNotDone:
    "Two changes were declined at the dry run and never sent: the Conditional Access country allow-list, and the quarterly privileged access review. Both remain available and can be applied later without repurchasing the pack. Nothing outside the packs listed above was read or written.",
  appendix: {
    heading: "Appendix A · accounts affected",
    intro:
      "The twelve accounts moved from standing privilege to eligible. Each keeps the same role and activates it on demand with justification and MFA.",
    accounts: [
      "a.okafor@haldenmaterials.com",
      "b.lindqvist@haldenmaterials.com",
      "c.moreau@haldenmaterials.com",
      "d.whitfield@haldenmaterials.com",
      "e.nakamura@haldenmaterials.com",
      "f.oyelaran@haldenmaterials.com",
      "g.petrov@haldenmaterials.com",
      "h.salazar@haldenmaterials.com",
      "i.thornton@haldenmaterials.com",
      "j.diaz@haldenmaterials.com",
      "k.ferreira@haldenmaterials.com",
      "l.hammond@haldenmaterials.com",
    ],
  },
};

export const CHANGE_RECORDS: Record<string, ChangeRecordData> = {
  [DEFAULT_CHANGE_RECORD.id]: DEFAULT_CHANGE_RECORD,
};

export function getChangeRecord(id: string): ChangeRecordData {
  return CHANGE_RECORDS[id] ?? DEFAULT_CHANGE_RECORD;
}
