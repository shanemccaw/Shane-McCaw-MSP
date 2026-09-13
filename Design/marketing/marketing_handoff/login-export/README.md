# Customer Portal Login — Handoff to Claude Code

The sign-in page for the Shane McCaw customer portal. Design source is
`Customer Portal Login.dc.html` in this folder — open it in a browser to see the
reference render. Inline-styled, no build step needed to view.

Target app: **React + Vite + Tailwind v4 + shadcn/ui ("new-york") + lucide-react**,
matching `artifacts/msp-portal`. Route: `/login`.

## What's in this folder

| File | Purpose |
|------|---------|
| `Customer Portal Login.dc.html` | The design — template markup plus a logic class holding the step machine and all copy. |
| `support.js` | Local runtime that renders the DC file. Not part of the production app. |
| `_ds/…` | Design-system tokens (colors, type, spacing, elevation). The app already has these in `src/index.css`; use as a value reference. |

Two pages this one links to are **not** in this package — build or stub the routes:
`/login/help` (Trouble signing in) and `/status` (Service status).

## Layout

Split screen. Left column is the form; right column (`.lg-aside`) is the
"Behind this login" rail and is hidden below 1020px. The form column stands alone
on mobile — do not stack the rail underneath it.

## Auth model

**Username + password, then MFA. No SSO button, no magic link.** Both were
considered and cut; do not reintroduce them.

One state machine (`state.step`):

```
signin ──▶ mfa ──▶ done
   │
   └─ Forgot ─▶ resetEmail ─▶ resetCode ─▶ resetNew ─▶ done
```

Each step swaps eyebrow, H1, subhead and a witty one-liner. All four strings per
step live in the `COPY` map in the logic class — **keep them verbatim**, the tone
is deliberate and was iterated on. Examples: sign-in reads "Your tenant score
doesn't improve while you're standing out here."; MFA reads "We flag tenants that
skip MFA. Would be awkward to skip our own."

### Steps

- **signin** — username, password with a Show/Hide toggle, keep-me-signed-in
  checkbox (30 days), Forgot password link. Inline error banner for bad input.
- **mfa** — six code boxes that **are** the input: a transparent `<input>` is
  absolutely positioned over the row, clicking anywhere focuses it, and filled
  boxes take a blue border. Do not add a second visible code field below them.
- **resetEmail** — email address → "Email Me a Code".
- **resetCode** — six boxes again, plus a **live 15:00 countdown**: ticks every
  second, turns amber under two minutes, turns red and blocks submission at zero
  ("Code expired"). "Send another" restarts it. Wire the duration to the real
  code TTL rather than hardcoding 15 minutes twice.
- **resetNew** — new password + confirm, with a four-bar strength meter
  (length ≥ 12 plus character variety).
- **done** — spinner, three handshake lines, and a button into the portal.

## Visual treatment

This is a security surface, so it wears the **Security pillar's violet**: violet
radial glow, a large low-opacity **lock watermark** (520px at 7% opacity) behind
the form, violet card border and violet eyebrow dot. The form sits in a
semi-transparent card with a violet glow rather than flat on the canvas — the
same treatment the marketing pillar pages use.

**The Sign In button stays Electric Blue `#0078D4`** (hover `#005A9E`). It is the
design system's primary action colour everywhere; do not recolour it violet to
match the accent.

## The right rail is deliberately generic

Pre-authentication we do not know who the visitor is, so the rail shows **no
tenant data** — no score, no findings count, no "since your last login" feed.
An earlier draft had those and they were cut for being fabricated.

What it shows instead:
- Heading: "Six engines have been watching your tenant while you were out."
- The six engines with what each watches (Drift, Security, Health, SLA, Scope
  Creep, Sales Offer), under an "All engines operational" status line.
- Four platform facts: 158 checks per scan, hourly cadence, read-only access
  model, every write logged.
- A closing line that says the quiet part: "Platform figures, not yours. Your
  score, findings and runbooks load after sign-in."

Keep that constraint when wiring real data. Tenant-specific numbers belong
after authentication, not here.

## Other elements

- **Back to site** — a plain `←` text link at the top of the card, above the
  violet eyebrow. Not a button, not in a header bar.
- **Secondary CTA** — a teal-bordered block above the footer links: "No account
  yet? / 158 read-only checks on your tenant, free." → Run a Free Diagnostic
  (`/free-scan`). Must stay visually secondary to Sign In.
- **Footer** — a shield line ("Read-only by default. Every write we make is
  logged in your change record.") with the links row indented 21px below it to
  sit flush with that text: Trouble signing in | Status | Privacy.

## Wiring notes

- Nothing on this page needs an API call to render. It must load even when the
  backend is down.
- Rate-limit and lock after five failed attempts, with a 30-minute auto-unlock —
  the help page documents that behaviour, so the two must agree.
- Reset codes: 15-minute expiry, single use, sent from `no-reply@shanemccaw.com`.
  Same values are quoted on the help page.
- After a successful sign-in the portal may hold the user at the **scan gate**
  until their first scan completes. That is a portal state, not a login error —
  do not surface it as a failed sign-in.
- Icons are inline SVG matching Lucide glyphs — use `lucide-react` rather than
  porting the paths: `Lock`, `KeyRound`, `Eye`/`EyeOff`, `ShieldCheck`,
  `ArrowLeft`, `Check`, `Loader2`.
- Respect `prefers-reduced-motion`; the page already disables all animation under it.

## Values used

Canvas `#020617`. Form card: `linear-gradient(160deg, rgba(139,92,246,.10),
rgba(11,21,36,.62) 55%, rgba(11,21,36,.44))`, border `rgba(139,92,246,.22)`,
16px radius, glow `0 0 70px rgba(139,92,246,.13)`, `backdrop-filter: blur(3px)`.
Inputs `#071324` with `rgba(148,163,184,.18)` border, 6px radius, focus ring
`0 0 0 3px rgba(0,180,216,.12)`. Rail cards `rgba(11,21,36,.6)` on
`rgba(30,41,59,.9)`. Security violet `#a78bfa`, teal `#2dd4bf`, muted text
`#94a3b8`, dim `#64748b`. Inter throughout; H1 27px/800 at `-.03em`, body
12–14px. Mono numerics in Menlo.
