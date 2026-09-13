# Free Scan — Consent Gate & Lead Capture

Changes to the free diagnostic flow only. Everything here lives in
**`Marketing Free Scan.dc.html`** — no other page was touched.

Open the file in a browser to see the reference render. Inline-styled, no build step.

Target app: React + Vite + Tailwind v4 + shadcn/ui ("new-york") + lucide-react,
matching `artifacts/shane-mccaw-consulting` (dark marketing site).

## What changed

The flow was **Free Scan → Scan**. It is now **Free Scan → Consent → Scan**, with a
real permission-disclosure screen in the middle instead of a single checkbox.

Phase machine (`state.phase`):

```
start ──▶ consent ──▶ granting ──▶ scanning ──▶ results
  ▲          │
  └── Back ──┘
```

`granting` is a 1.5s "Waiting for Microsoft consent" interstitial standing in for the
real OAuth round-trip. In production, `grantRead()` redirects to Microsoft's consent
endpoint and the callback resumes at `scanning`.

### 1. Start form — lead capture

Replaced the old *domain + email* pair with:

| Field | Notes |
|-------|-------|
| Your name | `state.name` |
| Company | `state.company` |
| Work email address | `state.email` — the only required-for-function field |
| Checkbox | "I'm a Global Administrator (or can approve consent) and I agree to a read-only scan of this tenant." Gates the button. |

**The tenant domain is derived from the work email**, not asked for separately:

```js
const domain = ((s.email || '').split('@')[1] || '').trim() || 'yourcompany.com';
```

That derived value feeds the consent screen, the scan header ("Scanning acme.com") and
the results header. A one-line note under the email field explains it: *"We read the
tenant behind this address, so your results go to the domain we scan."* Keep that note
if you keep the derivation — otherwise the missing domain field looks like an omission.

Button is now **"Review access and continue"** (was "Connect and start the scan") and
goes to `consent`, not straight to the scan. Its helper text sets the expectation:
nothing is read until the next screen is approved.

Name and company are captured for the lead record; wire them to CRM on submit.

### 2. Consent screen — new

Deliberately built on the **same layout as the Write Access Consent screen** in
`Marketing Buy.dc.html` (`show.writeConsent`), so read consent and write consent read as
two instances of one pattern: 44px icon tile → eyebrow → H1 → body → scopes card →
action row. Only the accent differs — **read is blue `#60a5fa`, write is amber
`#fbbf24`**. Keep that pairing; it is how a user tells the two consents apart.

Content:

- Eyebrow "Step 1 of 2 · before anything is read", H1 *"This scan needs read access. It
  never asks for more."*
- Body names the derived domain and makes the key promise: there is no write scope in
  this registration to grant later — applying a fix is a **second, separate consent**.
- **Scopes card** — six scopes, each with a plain-English reason:
  `Organization.Read.All`, `Directory.Read.All`, `Policy.Read.All`, `Sites.Read.All`,
  `Reports.Read.All`, `AuditLog.Read.All`. Scope names are mono. These must match the
  app registration exactly; if the real registration differs, change this list, not the
  copy around it.
- **"Not requested, and not grantable here"** card (green) — the counter-list, which is
  what actually earns trust: no `Mail.Read`, no `Files.Read` (names and sharing state
  only, never contents), no `Chat.Read`, and no `.ReadWrite` scope of any kind — "this
  registration cannot change a single setting."
- Actions: **Grant read-only access** (primary) / **Back** (returns to `start` with the
  form intact) / footnote that revoking mid-run stops the scan.

### 3. Progress strip

The `Consent → Scan → Results → Review → Remediate` strip already existed but jumped
straight to Scan. It now marks **Consent** as the current step during `consent` and
`granting`:

```js
const at = s.phase === 'results' ? 2
  : (s.phase === 'consent' || s.phase === 'granting') ? 0 : 1;
```

## Wiring notes

- `grantRead()` is the only place that needs real work: swap the `setTimeout` for the
  redirect to Microsoft's consent screen, and resume at `scanning` on callback. Handle
  the decline path — the user lands back on `start`, not on an error page.
- Persist name / company / email before the redirect, or the round-trip loses the lead.
- The scopes list and the not-requested list should be generated from the app
  registration manifest rather than hand-maintained, so the page cannot drift from what
  is actually requested. If it drifts, the whole screen becomes a liability.
- `clearTimeout(this._grant)` is in `componentWillUnmount` alongside the existing scan
  interval cleanup — keep it, or leaving mid-consent fires a scan on an unmounted tree.
- `fsSpin` keyframe was added for the granting spinner; it respects
  `prefers-reduced-motion` via the existing `matchMedia` check.
- Icons are inline SVG matching Lucide. Consent screen uses `Eye` (tile and per-scope
  bullets); the not-requested list uses a plain `×` glyph, not an icon.

## Values used

Canvas `#020617`, cards `#0b1524` with `rgba(30,41,59,.9)` border, inputs `#020617`,
10–16px radii, primary CTA `linear-gradient(90deg,#3b82f6,#8b5cf6)`, read accent
`#60a5fa` on `rgba(59,130,246,.12)` fill / `.32` border, the not-requested card
`rgba(52,211,153,.05)` on `rgba(52,211,153,.24)`, mono scope names in Menlo.
