/** Copilot Readiness quiz content — verbatim from the Claude Design mockup
 * ("Copilot Readiness Marketing Site.dc.html"). Purely illustrative/estimate
 * copy; not derived from any real tenant scan. */

export interface Pillar {
  name: string;
  color: string;
}

export const PILLARS: Pillar[] = [
  { name: "Governance", color: "#60A5FA" },
  { name: "Security", color: "#A78BFA" },
  { name: "Compliance", color: "#D1D5DB" },
  { name: "Licensing", color: "#2DD4BF" },
  { name: "Adoption", color: "#FB923C" },
  { name: "Health", color: "#4ADE80" },
];

export const SEATS = ["fewer than 100 seats", "100–500 seats", "500–2,000 seats", "more than 2,000 seats"];

export interface Question {
  tag: string;
  color: string;
  pillar: number;
  q: string;
  opts: string[];
}

export const QUESTIONS: Question[] = [
  {
    tag: "Context",
    color: "#94a3b8",
    pillar: -1,
    q: "How many people are in your tenant?",
    opts: ["Fewer than 100", "100 – 500", "500 – 2,000", "More than 2,000"],
  },
  {
    tag: "Governance",
    color: "#60a5fa",
    pillar: 0,
    q: "Who owns Microsoft 365 governance day to day?",
    opts: [
      "Nobody in particular",
      "IT, part-time, when something breaks",
      "A named owner with time allocated",
      "A governance board with a review cadence",
    ],
  },
  {
    tag: "Security",
    color: "#a78bfa",
    pillar: 1,
    q: "How far has Conditional Access gone in your tenant?",
    opts: [
      "Security defaults only",
      "MFA enforced for admins",
      "Baseline policies for every user",
      "Risk-based, device-aware policies",
    ],
  },
  {
    tag: "Compliance",
    color: "#D1D5DB",
    pillar: 2,
    q: "When did you last review external sharing and guest access?",
    opts: ["Never", "More than a year ago", "Within the last six months", "Reviewed continuously"],
  },
  {
    tag: "Licensing",
    color: "#2dd4bf",
    pillar: 3,
    q: "Where are you with Copilot licensing?",
    opts: ["No licences yet", "A small pilot group", "One or two departments", "Org-wide"],
  },
  {
    tag: "Adoption",
    color: "#fb923c",
    pillar: 4,
    q: "Has anyone been shown how to prompt against your own content?",
    opts: [
      "No training at all",
      "A launch email went out",
      "Optional sessions ran once",
      "Role-specific enablement, ongoing",
    ],
  },
  {
    tag: "Health",
    color: "#4ADE80",
    pillar: 5,
    q: "How would you find out if a tenant setting changed overnight?",
    opts: [
      "We would not",
      "Someone would notice eventually",
      "A monthly or quarterly review",
      "Alerting on change, within the hour",
    ],
  },
];

/** [headline, body] pairs. `none` shows when that pillar's question is unanswered. */
export interface VariantPillar {
  none: [string, string];
  a: [string, string][];
}

export const VARIANTS: VariantPillar[] = [
  {
    // Governance
    none: [
      "Copilot inherits every permission mistake you have ever made.",
      "It does not read a site the way a person reads a site. It reads everything the signed-in user could technically reach, then summarises it in a sentence. Ownership gaps that were harmless while nobody was looking become an answer in a chat window.",
    ],
    a: [
      [
        "With no owner, nothing stops permissions drifting open.",
        "No named owner means nobody enforces change management, so sharing settings, guest access and site permissions widen one request at a time and nothing pulls them back. Copilot knows none of that history. It reads what the signed-in user can reach right now and treats it as fair game.",
      ],
      [
        "Reactive ownership only ever catches the things that break.",
        "When governance is picked up between outages, review happens after failure. A permission opening too wide never fails — it just sits there, correct on paper and wrong in practice. By the time Copilot is asked a question, that accumulated state is the answer it gives.",
      ],
      [
        "A named owner turns drift into a caught exception.",
        "Changes get reviewed while they are still one site rather than forty, which is the difference between a finding and an incident. What remains is the content that predates the owner: inherited sites, old project spaces, and the guests still attached to them.",
      ],
      [
        "You already run the control most tenants are missing.",
        "Recorded ownership with a review cadence is the only mechanism that reliably stops permissions accumulating quietly, and it is rare at any size. The residual risk is whatever never reaches the agenda — dormant sites, orphaned groups, and the sharing done inside them.",
      ],
    ],
  },
  {
    // Security
    none: [
      "The gap is almost never the policy. It is the exclusion.",
      "Break-glass accounts, a service principal added during a migration, one group excluded for a project that ended two years ago. Each was reasonable on the day. Together they are the route in, and no quarterly review is scoped to find them.",
    ],
    a: [
      [
        "Defaults authenticate the user. They never ask where from.",
        "Security defaults enforce MFA and block legacy authentication, and stop there. Nothing conditions access on device, location or risk, so a valid credential is a valid session from anywhere — and the service accounts and break-glass identities below never come under a policy at all.",
      ],
      [
        "Admin MFA protects the accounts. It does not cover the tenant.",
        "The identities most attacked are closed off, which matters more than it is given credit for. Everyone else still signs in on the older path, and that is where exclusions accumulate: a service principal added during a migration, a group excluded for a project that ended, each reasonable on the day.",
      ],
      [
        "Once every user is covered, the risk moves into the exclusion list.",
        "Conditioned access for all users is a real position, and it arrives with a list of exemptions that grows by one entry per migration and is almost never pruned. Nobody owns removing an exclusion, because nothing breaks when it stays.",
      ],
      [
        "Re-evaluated per sign-in is the strongest posture available.",
        "Access is judged on device state and risk each time rather than granted once, which is what the top quartile below is actually made of. Even here the exclusions exist — the difference is whether anyone can still explain why each one is on the list.",
      ],
    ],
  },
  {
    // Compliance
    none: [
      "Labels that exist and labels that are applied are different numbers.",
      "Most tenants have a sensitivity taxonomy. Far fewer have it enforced on the content that matters, and fewer still have retention that survives a departing employee. Copilot does not distinguish between a defined label and an applied one.",
    ],
    a: [
      [
        "Every link ever created is still live.",
        "Without a review, sharing links made for projects that closed years ago are still resolving, and the content behind them was never labelled because nobody looked at it. Unlabelled, over-shared content is precisely what Copilot is free to read and summarise on request.",
      ],
      [
        "The review you did predates most of what is now shared.",
        "Everything created since has never been checked for labelling or guest exposure, and that is the last year of work — the most current, most sensitive material in the tenant. The taxonomy still says the right things. It is just not applied to any of it.",
      ],
      [
        "The links are mostly known. The labels are the open question.",
        "A recent review means sharing is roughly understood, which puts you ahead of the median. Content can be correctly shared and still unlabelled, and Copilot treats an unlabelled file as ordinary content regardless of what is inside it.",
      ],
      [
        "Sharing and labelling staying in step is the whole point.",
        "Continuous review is the only state where the taxonomy means something, because the label follows the content instead of trailing it. What is left is auto-labelling coverage: the sites nobody classifies because nobody visits them.",
      ],
    ],
  },
  {
    // Licensing
    none: [
      "Seats get bought by headcount and used by habit.",
      "The allocation that made sense at purchase rarely matches where the work actually is three months later. Nobody reclaims a licence, because nobody is measuring one. The renewal arrives priced on the original number.",
    ],
    a: [
      [
        "Nothing is committed yet. That is the cheapest place to be.",
        "Every allocation decision ahead of you is still unmade, so seats can be set from where the work actually is rather than from an org chart. The waste below is what happens when that order gets reversed: bought first, measured later, renewed on the original number.",
      ],
      [
        "A pilot is only worth what you measure out of it.",
        "The right people in a pilot tell you which roles get real value and which were curious for a fortnight. Pilot seats that go quiet are the first appearance of the pattern below — caught now they shape the next purchase instead of repeating inside it.",
      ],
      [
        "This is the point where allocation stops matching the work.",
        "Seats were assigned to a team structure that has since moved, nobody owns reclaiming them, and the renewal quotes the original count. Dormant seats start appearing here and are rarely noticed until somebody asks for a utilisation number.",
      ],
      [
        "The spend is committed. Utilisation is the only lever left.",
        "At org-wide scale, every seat that goes ninety days without meaningful use renews at full price on the strength of nobody checking. The figures below are money already out the door, and measuring who actually uses what is the only way to get any of it back.",
      ],
    ],
  },
  {
    // Adoption
    none: [
      "Usage concentrates in Teams, Outlook and Word — and stops.",
      "Summarising a meeting is discoverable. Grounding a proposal in last quarter's actual numbers is not, unless someone shows you. The difference between a licence that renews and one that gets cut is usually a two-hour session nobody scheduled.",
    ],
    a: [
      [
        "People find the summarise button, and stop there.",
        "Summarising a meeting is self-evident. Grounding a prompt in last quarter's actual numbers has to be shown once, by someone, against real content. Without that, usage plateaus in three apps and the renewal conversation starts from a low number.",
      ],
      [
        "An email tells people the licence exists. Nothing more.",
        "It does not demonstrate a second prompt, so usage settles at whatever was discoverable on day one. That is the concentration below: the same three apps, the same shallow tasks, month after month.",
      ],
      [
        "Optional sessions reach the people who did not need them.",
        "The attendees were going to work it out anyway. The gap below is everyone who did not sign up, and they hold the majority of your seats — the ones that quietly decide whether the renewal is defensible.",
      ],
      [
        "Repeated, role-specific enablement is what the top quartile is made of.",
        "People are shown Copilot against their own content, in their own workflow, more than once — which is the mechanism behind the numbers below rather than a nice-to-have alongside them. What is worth watching now is whether new joiners get the same treatment.",
      ],
    ],
  },
  {
    // Health
    none: [
      "A tenant does not stay where you left it.",
      "Admins change settings, vendors consent to OAuth apps, guests get added, defaults shift underneath you when Microsoft ships. An assessment tells you what is wrong today. Drift is what happens on every day after that.",
    ],
    a: [
      [
        "Undetected is not the same as absent.",
        "Admins change settings, vendors consent to OAuth apps, guests get added, and defaults shift underneath you when Microsoft ships. None of it announces itself. Every remediation you pay for starts decaying the day after it lands.",
      ],
      [
        "You find out because something broke, not because something changed.",
        "Changes that break things get attention within the day. Changes that quietly open exposure never break anything, so they wait — and those are exactly the ones the figures below are counting.",
      ],
      [
        "A quarterly review catches it a quarter after it mattered.",
        "Between reviews the tenant runs in a state nobody has verified, and the reconstruction afterwards is guesswork about when a setting actually moved. Better than nothing, and still after the fact.",
      ],
      [
        "Catching change within the hour is the argument this chapter makes.",
        "A change caught while it happens is a decision; the same change found later is an archaeology exercise. You already run the control the rest of this page is arguing for — the figures below are your benchmark.",
      ],
    ],
  },
];

export const VALUES = [0.18, 0.45, 0.7, 0.95];
export const LETTERS = ["A", "B", "C", "D"];
