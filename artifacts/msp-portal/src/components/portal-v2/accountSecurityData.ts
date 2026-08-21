/**
 * accountSecurityData.ts — the Account security page fixture (Part 12).
 *
 * EXTRACTED from the prototype's `SEC_POSTURE`, `SEC_MFA`, `SEC_SESSIONS`,
 * `SEC_DATA` and `SEC_DELETE_FACTS` (Customer Portal Shell.dc.html 15778-15847),
 * evaluated rather than retyped. Every string is the design's, verbatim.
 *
 * ── This is the customer's own login, not their tenant ──────────────────────
 * The prototype's own comment (15774-15777): this account is held to the same
 * bar the product holds a tenant to, and says so with the pillar pages' evidence
 * language — what is on, what is not, and when it was last verified.
 *
 * UI-only: design content for jordan.diaz@tenant.com. A later pass wires it to
 * real Entra sign-in / method / session data.
 */

export type SecTone = "green" | "amber" | "red";

/* ── The identity strip and header copy — shell 2208-2234 ──────────────────── */

export const SEC_TITLE = "Account security";
export const SEC_SUBTITLE =
  "Your login to this portal — not your Microsoft 365 tenant. Tenant findings live under the six pillars. This page is about the one account that can read all of them, which is why it is held to the same standard we hold your tenant to.";
export const SEC_IDENTITY_EMAIL = "jordan.diaz@tenant.com";
export const SEC_IDENTITY_ROLE = "IT Administrator · full portal access";

export const SEC_POSTURE_KICKER = "Your account, measured the same way we measure your tenant";
export const SEC_POSTURE_VERIFIED = "Last verified today at 08:41";
export const SEC_POSTURE_NOTE =
  "One gap: no passkey. We flag it on your account for the same reason we flag it on your tenant — phishing-resistant authentication is the single control that holds when everything else about a sign-in looks legitimate.";

/* ── Posture rows — shell 15778-15785 ──────────────────────────────────────── */

export interface SecPostureRow {
  k: string;
  v: string;
  tone: SecTone;
}

export const SEC_POSTURE: readonly SecPostureRow[] = [
  { k: "Multifactor", v: "Microsoft Authenticator · registered 11 January 2026", tone: "green" },
  { k: "Passkey", v: "Not registered — the strongest option available to you", tone: "amber" },
  { k: "Password age", v: "221 days · no expiry policy, changed when you choose", tone: "green" },
  { k: "Sessions", v: "3 active, oldest signed in 9 days ago", tone: "green" },
  { k: "Last sign-in", v: "Today at 08:41 from Manchester, UK · 82.14.x.x", tone: "green" },
  { k: "Failed attempts", v: "None in 90 days", tone: "green" },
];

/* ── Multifactor methods — shell 15790-15805 ───────────────────────────────── */

export type SecMfaTone = "green" | "blue" | "amber";

export interface SecMfaMethod {
  key: string;
  name: string;
  strength: string;
  tone: SecMfaTone;
  state: string;
  how: string;
  why: string;
  tradeoff: string;
  recommended: boolean;
  cta: string;
}

export const SEC_MFA_KICKER = "Multifactor methods";
export const SEC_MFA_SUB = "Two methods is the sensible minimum — one to use, one for when you cannot";

export const SEC_MFA: readonly SecMfaMethod[] = [
  {
    key: "passkey",
    name: "Passkey",
    strength: "Strongest",
    tone: "green",
    state: "Not set up",
    how: "Your device — Face ID, Windows Hello, or a hardware key — proves it is you. Nothing is typed and nothing can be read out over the phone.",
    why: "Phishing-resistant. A convincing fake sign-in page cannot capture a passkey, because the credential is bound to our domain and never leaves your device.",
    tradeoff: "The least familiar of the three, and tied to the devices you register. Register two so a lost phone is not a lockout.",
    recommended: true,
    cta: "Set up a passkey",
  },
  {
    key: "app",
    name: "Authenticator app",
    strength: "Strong",
    tone: "blue",
    state: "Active · Microsoft Authenticator",
    how: "A push approval with number matching, or a 6-digit code if you are offline.",
    why: "Resistant to SIM swapping and to interception, because the secret lives in the app rather than travelling over the mobile network.",
    tradeoff: "Approval fatigue is real. If a prompt arrives that you did not trigger, deny it and change your password — do not approve to make it stop.",
    recommended: false,
    cta: "Manage",
  },
  {
    key: "sms",
    name: "Text message",
    strength: "Weakest",
    tone: "amber",
    state: "Not set up",
    how: "A code sent to your phone number by SMS.",
    why: "Better than a password alone, and available on any phone with no app to install.",
    tradeoff: "A SIM swap or an intercepted message defeats it, which is why we do not recommend it as your only method. Keep it as a backup at most.",
    recommended: false,
    cta: "Add as backup",
  },
];

/* ── Sessions — shell 15820-15823 ──────────────────────────────────────────── */

export interface SecSession {
  device: string;
  where: string;
  when: string;
  current: boolean;
  since: string;
  compliant: string;
}

export const SEC_SESSIONS_KICKER = "Where you are signed in";
export const SEC_SESSIONS_SIGNOUT = "Sign out everywhere else";
export const SEC_SESSIONS_NOTE =
  "The Leeds session is on an unmanaged device. If that is not you, revoke it and change your password — in that order.";

export const SEC_SESSIONS: readonly SecSession[] = [
  { device: "Windows 11 · Edge 128", where: "Manchester, UK · 82.14.x.x", when: "Active now", current: true, since: "Signed in today at 08:41", compliant: "Compliant device · hybrid joined" },
  { device: "iPhone 15 · Safari", where: "Manchester, UK · 82.14.x.x", when: "2 hours ago", current: false, since: "Signed in 4 days ago", compliant: "Compliant device · Intune enrolled" },
  { device: "macOS 15 · Chrome 129", where: "Leeds, UK · 195.62.x.x", when: "9 days ago", current: false, since: "Signed in 9 days ago", compliant: "Unmanaged device" },
];

/* ── Password card — shell 2300-2312 ───────────────────────────────────────── */

export const SEC_PASSWORD_KICKER = "Password";
export const SEC_PASSWORD_BODY =
  "Last changed 221 days ago. We do not force rotation — forced expiry pushes people towards weaker, more predictable passwords, which is why the guidance moved away from it.";
export const SEC_PASSWORD_SUB =
  "Change it when you have reason to: a shared credential, a device you no longer control, or a session above you do not recognise.";
export const SEC_PASSWORD_CHANGE = "Change password";
export const SEC_PASSWORD_HISTORY = "View sign-in history";

/* ── Your data — shell 15832-15835 ─────────────────────────────────────────── */

export interface SecDataRow {
  name: string;
  detail: string;
  wait: string;
  cta: string;
  primary: boolean;
}

export const SEC_DATA_KICKER = "Your data";
export const SEC_DATA_SUB = "Yours to take and yours to remove — no forms to chase, no reason required";

export const SEC_DATA: readonly SecDataRow[] = [
  { name: "Export your data", detail: "Everything tied to your account: profile, alert preferences, notes you have written on findings, risk acceptances you approved, and your sign-in history. Machine-readable JSON plus a PDF summary.", wait: "Ready within 1 hour, download link valid 7 days", cta: "Request export", primary: true },
  { name: "Export tenant evidence", detail: "Separate from your personal data: the evidence pack, disposition records and accepted-risk register for the tenant. Available on the Billing page as well, since it survives account changes.", wait: "Immediate", cta: "Go to evidence export", primary: false },
  { name: "Request deletion", detail: "Deletes your personal account data. Tenant records we are contractually or legally required to keep — invoices, signed statements of work, audit evidence — are retained and listed explicitly in the response, not quietly kept.", wait: "Confirmed within 30 days, usually within 5", cta: "Start a deletion request", primary: false },
];

/* ── Delete-your-account section — shell 2333-2364, facts 15841-15847 ──────── */

export const SEC_DELETE_TITLE = "Delete your account";
export const SEC_DELETE_SUB =
  "Export first — it takes about an hour and cannot be done afterwards. Everything that is kept, and the obligation that requires it, is listed before you confirm.";
export const SEC_DELETE_CONFIRM_KICKER = "Confirm deletion request";
export const SEC_DELETE_PHRASE = "DELETE MY ACCOUNT";
export const SEC_DELETE_SUBMIT = "Submit deletion request";
export const SEC_DELETE_EXPORT_FIRST = "Export my data first";
export const SEC_DELETE_WITHDRAW =
  "You can withdraw the request at any point before it completes by replying to the confirmation email.";

export interface SecDeleteFact {
  k: string;
  v: string;
}

export const SEC_DELETE_FACTS: readonly SecDeleteFact[] = [
  { k: "Export first", v: "Deletion cannot be undone, and your notes, approvals and sign-in history go with it. The export takes about an hour — there is no good reason to skip it." },
  { k: "What is deleted", v: "Your profile, alert preferences, personal notes, session history, and your association with this tenant." },
  { k: "What is retained, and why", v: "Invoices and signed statements of work for 7 years under SOX §802. Audit evidence referencing your approvals stays in the tenant record — your name is retained on decisions you approved, because removing it would falsify an audit trail." },
  { k: "Tenant access", v: "If you are the only administrator on this tenant, the account cannot be deleted until another administrator is named. There are currently 2 others." },
  { k: "Timing", v: "Confirmed within 30 days, usually within 5. You get a written confirmation listing exactly what was deleted and what was retained." },
];
