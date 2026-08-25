// The fifteen Quick-Start Pack definitions for /quick-start (Marketing Quick-Start Packs.dc.html).
// Fixture, kept in one place per the repo's "swap for real data" convention: prices verified
// live 2026-08-21 via shaneapp://executeSql against `services` (service_type = 'config_pack').
// Five of the fifteen packs already exist as live catalog rows — entra/onboard/offboard/
// incident/recovery — and matched these figures exactly. The other ten are not yet live catalog
// rows, so there is nothing to check them against; these are the figures as given.
//
// Which of these are actually purchasable is NOT tracked here as a static list (Git #1304: a
// prior static count of "3 not-yet-real" had already drifted from what a live query found). Both
// /quick-start and /buy instead call useQuickStartPackAvailability() at render time, which matches
// each pack's `name` against the real `services` table and gates the UI accordingly.
export type PackIcon =
  | "shieldCheck"
  | "key"
  | "shield"
  | "badge"
  | "lock"
  | "broom"
  | "user"
  | "userMinus"
  | "alert"
  | "laptop"
  | "mail"
  | "share"
  | "card"
  | "brain";

export interface QuickStartPack {
  key: string;
  name: string;
  price: number;
  icon: PackIcon;
  desc: string;
  note?: string;
}

export const PACKS: QuickStartPack[] = [
  {
    key: "entra",
    name: "Entra ID Quick-Start Pack",
    price: 799,
    icon: "shieldCheck",
    desc: "A new or half-configured tenant taken to a real identity baseline in one pass — the setup every other pack assumes you already have.",
  },
  {
    key: "breakglass",
    name: "Break-Glass Access Pack",
    price: 249,
    icon: "key",
    desc: "An emergency admin credential issued on demand. Several recipients verify, an eligible directory role is proven, and the release is logged before anything is revealed.",
    note: "Included with every other pack. Buy it alone if this is all you need.",
  },
  {
    key: "ca",
    name: "Conditional Access Baseline Pack",
    price: 199,
    icon: "shield",
    desc: "Conditional Access policies configured and enforced, rather than a report naming the ones you do not have.",
  },
  {
    key: "pim",
    name: "Privileged Access Pack",
    price: 299,
    icon: "badge",
    desc: "Admin roles put under PIM: eligible instead of standing, approval before elevation, and a record of who used what.",
  },
  {
    key: "mfa",
    name: "MFA Enforcement Pack",
    price: 299,
    icon: "lock",
    desc: "Every user genuinely enrolled and enforced, including the accounts that quietly sit outside the policy today.",
  },
  {
    key: "hygiene",
    name: "Identity Hygiene Pack",
    price: 249,
    icon: "broom",
    desc: "The sprawl a tenant accumulates — stale access, unverified security info, accounts nobody closed — cleared out.",
  },
  {
    key: "onboard",
    name: "New Employee Onboarding Pack",
    price: 149,
    icon: "user",
    desc: "A new hire's first day set up in one run.",
  },
  {
    key: "offboard",
    name: "Employee Offboarding Pack",
    price: 199,
    icon: "userMinus",
    desc: "A leaver closed out properly, with nothing left behind.",
  },
  {
    key: "incident",
    name: "Security Incident Response Pack",
    price: 299,
    icon: "alert",
    desc: "Containment for something happening right now. A pack that runs, not a checklist to read while the clock is going.",
  },
  {
    key: "recovery",
    name: "Compromised Account Recovery Pack",
    price: 149,
    icon: "shield",
    desc: "One account taken back quickly: sessions revoked, credentials reset, access locked down.",
  },
  {
    key: "device",
    name: "Device Compliance Pack",
    price: 249,
    icon: "laptop",
    desc: "Intune devices brought into line with the compliance policies they were meant to be enforcing, gaps remediated rather than reported.",
  },
  {
    key: "email",
    name: "Email Security Pack",
    price: 249,
    icon: "mail",
    desc: "The paths mail leaves by — forwarding rules, delegate access, transport rules — reviewed and closed across Exchange Online.",
  },
  {
    key: "oversharing",
    name: "SharePoint & OneDrive Oversharing Pack",
    price: 349,
    icon: "share",
    desc: "Sharing brought back under control: links reviewed, exposure removed, and sharing policy enforced tenant-wide.",
  },
  {
    key: "licensing",
    name: "Baseline Licensing Pack",
    price: 199,
    icon: "card",
    desc: "Unused licences reclaimed and reassigned, so what you pay for matches who is actually working.",
  },
  {
    key: "copilot",
    name: "Copilot Readiness Pack",
    price: 499,
    icon: "brain",
    desc: "The tenant configured before Copilot reaches anyone, so what it surfaces on day one is what you intended it to.",
  },
];

export const PACKS_BY_KEY: Record<string, QuickStartPack> = Object.fromEntries(
  PACKS.map((p) => [p.key, p]),
);

export const PACK_GROUPS: { label: string; note: string; keys: string[] }[] = [
  {
    label: "Identity foundations",
    note: "The baseline everything else assumes you already have.",
    keys: ["entra", "breakglass", "ca", "pim", "mfa", "hygiene"],
  },
  {
    label: "People moving in and out",
    note: "The two runs that happen every month.",
    keys: ["onboard", "offboard"],
  },
  {
    label: "When something is already wrong",
    note: "Containment, not commentary.",
    keys: ["incident", "recovery"],
  },
  {
    label: "Data, devices and spend",
    note: "Where exposure and waste accumulate quietly.",
    keys: ["device", "email", "oversharing", "licensing", "copilot"],
  },
];

// Packs whose scope already fully includes another pack's outcome — surfaced as an "overlap"
// warning when both are selected together, same reasoning as the design's dry-run mock.
export const COVERS: Record<string, string[]> = {
  entra: ["ca", "pim", "mfa", "hygiene"],
  copilot: ["oversharing"],
  incident: ["recovery"],
};
