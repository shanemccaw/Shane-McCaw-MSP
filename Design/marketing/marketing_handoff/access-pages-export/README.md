# Access & Trust Pages — Handoff to Claude Code

Four pages built this session, all pre-authentication surfaces. The design source
is the `.dc.html` files in this folder; open any of them in a browser to see the
reference render. Everything is inline-styled, no build step needed to view.

Target app: **React + Vite + Tailwind v4 + shadcn/ui ("new-york") + lucide-react**,
matching `artifacts/shane-mccaw-consulting` (marketing, dark) and
`artifacts/msp-portal` (portal).

## The pages

| File | Route | Belongs to |
|------|-------|-----------|
| `Customer Portal Login.dc.html` | `/login` | Portal (pre-auth) |
| `Customer Portal Sign-in Help.dc.html` | `/login/help` | Portal (pre-auth) |
| `Marketing Service Status.dc.html` | `/status` | Marketing site, linked from the footer |
| `Marketing 404.dc.html` | `/*` catch-all | Marketing site |

Supporting files also in this folder: `Marketing Nav.dc.html`,
`Marketing Footer.dc.html` (the status page and 404 compose these — use the app's
existing `Header.tsx` / `Footer.tsx` instead of porting them), `support.js` (the
local DC runtime, not part of the production app), and `_ds/` (design tokens).

---

## 1. Login — `/login`

Split layout. Left column is the form, right column (`.lg-aside`, hidden below
1020px) is the "Behind this login" rail.

**Auth model — no SSO, no magic link.** Username + password, then MFA.

Steps are one state machine (`step`): `signin` → `mfa` → `done`, with a reset
branch `resetEmail` → `resetCode` → `resetNew` → `done`. Each step swaps eyebrow,
H1, subhead and a witty one-liner (`COPY` map in the logic class — keep these
verbatim, the tone is deliberate).

- **signin** — username, password with Show/Hide toggle, keep-me-signed-in,
  Forgot password. Inline error banner for bad input.
- **mfa** — six code boxes that ARE the input: a transparent `<input>` is
  absolutely positioned over the row, clicking anywhere focuses it, filled boxes
  take a blue border. Do not add a second visible code field.
- **resetEmail** — email → "Email Me a Code".
- **resetCode** — six boxes again, plus a **live 15:00 countdown** (ticks every
  second, amber under 2 minutes, red and submission-blocked at zero, "Send
  another" restarts it). Wire to the real code TTL.
- **resetNew** — new password + confirm, with a 4-bar strength meter
  (length ≥ 12 plus character variety).
- **done** — spinner, three handshake lines, and a button into the portal.

**Visual treatment:** Security-pillar violet, because it is a security surface —
violet radial glow, a large low-opacity lock watermark (520px, 7% opacity) behind
the form, violet card border and eyebrow. The **Sign In button stays Electric
Blue `#0078D4`** (hover `#005A9E`) since that is the design system's primary
action colour everywhere. Do not recolour it.

**Right rail is deliberately generic.** Pre-auth we do not know the tenant, so it
shows no tenant data: the six engines with what each watches, an
"All engines operational" header, and four platform facts (158 checks per scan,
hourly, read-only by default, every write logged). Copy says so out loud. Never
render a tenant score, findings count or "since your last login" feed here.

**Secondary CTA:** a teal-bordered block above the footer links —
"No account yet? / 158 read-only checks on your tenant, free." → Run a Free
Diagnostic. Keep it visually secondary to Sign In.

---

## 2. Sign-in Help — `/login/help`

Same violet treatment, question-mark watermark. Five accordion items (first open
by default), each with a body paragraph, bullet steps and a CTA:

1. Password not accepted (portal password is separate from the M365 password)
2. MFA code rejected / lost authenticator (clock drift, one-use codes, recovery codes)
3. Locked out after five attempts (30-minute auto-unlock; reset clears it)
4. Reset code never arrived (sender address, 15-minute expiry, allowlisting)
5. No username / no account (it is the work email; admins add people)

Plus a service-status strip at the top, and two cards: **ShaneBot** and a
"what we will never ask for" anti-phishing note (password, MFA code, remote
control).

**ShaneBot** is the escalation path — a fixed bottom-right chat panel that raises
a ticket rather than opening a mail client:

- Bot greeting → user picks one of four issues (each carries a priority and an
  SLA note) → bot asks for the account email → **Raise the ticket**.
- Confirmation renders a reference (`SM-4xxxx`), the priority, the routing note
  and the email it confirmed to. "Raise another" resets.
- The message area is `max-height:52vh; overflow-y:auto` and is pinned to the
  bottom in `componentDidUpdate` (`el.scrollTop = el.scrollHeight`) — required,
  or the ticket confirmation renders below the fold. Do not use `scrollIntoView`.
- Wire to the real ticketing system; attach the last ten sign-in attempts for the
  address, which is what the bot promises.

There is intentionally **no "signed in but portal is empty"** item — a scan gate
holds the portal closed until the first scan completes, so that state does not exist.

---

## 3. Service Status — `/status`

A marketing page, not a login page: it renders the site nav and footer, and is
linked from the footer's Company column. Green Health-pillar accent, activity
watermark.

Two-column grid (`.st-grid`, engages above 820px; sidebar sticky at `top:78px` to
clear the sticky nav):

**Main column**
- **Our components** — six rows (portal, sign-in and MFA, scan engines, smart
  alerting, outbound email, approved writes), each with 90 daily bars, newest
  right. Hovering a bar shows a **custom tooltip** (not `title=`): full date,
  status pill, component name, and what happened that day. Incident days come
  from a fixed `EVENTS` map keyed by day offset so history is stable; replace
  with real daily rollups.
- **Our SLA, measured** — target vs actual vs Met/Missed for portal availability,
  sign-in availability, scan cycle completion, critical alert delivery, P1
  response, P2/P3 response. Footnote: missing an availability target in a
  calendar month gives retainer clients an automatic 10% service credit.
- **Incident history** — three resolved incidents, expandable to a summary, a
  timestamped timeline and a "What changed afterwards" block.

**Sidebar**
- **Microsoft 365 uptime** — six workloads (Graph, Entra ID, Exchange, SharePoint
  and OneDrive, Teams, Power Platform) with 90-day uptime and current state, read
  from the Service Health API for the tenant's region. One is intentionally shown
  degraded to prove the state renders. Below: Microsoft's 99.9% financially
  backed SLA against measured availability, labelled "Read hourly · EU West".
  There is deliberately **no outbound link** to a Microsoft status page.
- **Scheduled maintenance** — one planned window with impact spelled out.
- **Get told first** — email subscribe with a confirmed state.

Statement to preserve: the page is hosted away from the portal so it stays up
when the portal does not, and it refreshes every 60 seconds.

---

## 4. 404 — `/*`

Covered in full by `404_README.md` (also in this folder). Short version: the copy
in the hero is fixed and must not be reworded, the diagnostic readout card shows
six pillars Pass and "This page" 404, and the destination grid doubles as the
site's search index (`D` in the logic class, with a `keys` synonym list).

---

## Wiring notes across all four

- **Nothing here needs auth or an API call to be useful.** Search, navigation and
  the help accordion are client-side. Keep it that way: these are the pages people
  reach when something is broken.
- Set a real 404 HTTP status on the catch-all so it is not indexed.
- `/status` must be deployable independently of the portal (different host or
  region), or it defeats its own purpose.
- Icons throughout are inline SVG matching Lucide glyphs — use `lucide-react`
  rather than porting the paths. Login/help: `Lock`, `KeyRound`, `Smartphone`,
  `Mail`, `User`, `ShieldCheck`, `ChevronDown`. Status: `Monitor`, `Lock`,
  `Search`, `Bell`, `Mail`, `PenLine`, `Activity`, `Check`.
- Shared values: canvas `#020617`, cards `#0b1524` with `rgba(30,41,59,.9)`
  border, inputs `#071324`, 6px radius on controls and 12–16px on cards, primary
  `#0078D4` / hover `#005A9E`, Security violet `#a78bfa`, monitoring cyan
  `#22d3ee`, healthy green `#22c55e`, mono numerics in Menlo.
- Respect `prefers-reduced-motion` — every page already disables animation under it.
