# Shane's Life MCP — How to Connect and Use It

A real, working reference for any Claude conversation (Desktop, web, mobile) that needs
to read or write Shane's Life data. Compiled 2026-09-08 from direct use tonight — every
tool listed under "Confirmed tools" below was actually called in this session, not
guessed at.

---

## 1. What this actually is

Shane's Life stores real data — shopping lists, recipes, money, meds, pets, dates, and
more — in its own hosted app. It has no live AI inside it. Instead, **Claude does the
thinking in a normal conversation, then writes the result straight into the app via
MCP** (Model Context Protocol). The app just stores, displays, and lets Shane check
things off — it never calls an AI model itself.

This means any Claude conversation with the MCP connected can act as a real interface
to Shane's Life: read what's there, add to it, or update it, just by calling tools.

---

## 2. Getting a real token

Every connection needs a bearer token, minted from inside the app itself:

**Settings → Claude (MCP) → "Mint a token for a new Claude."**

This shows the real token once — copy it immediately, it isn't shown again. Each
token is separately labeled and revocable, and every tool call made with it shows up
in Settings under **Recent Activity** ("what Claude wrote") — so a token is not just
an access key, it's a real audit trail of what that specific Claude connection has
actually done.

There is **no OAuth flow** — Shane's Life is a simple bearer-token MCP server, not an
OAuth server. Don't try to register an OAuth client against it.

---

## 3. Connecting — two real, different methods depending on the client

### Claude Desktop
Claude Desktop's config needs a bridge (`mcp-remote`) rather than a direct URL, in this
environment:

```json
"shanes-life": {
  "command": "npx",
  "args": ["-y", "mcp-remote@0.8.3", "https://<real-deployed-domain>/mcp",
            "--transport", "http-only", "--header", "Authorization:${MCP_TOKEN}"],
  "env": { "MCP_TOKEN": "Bearer <real token from Settings>" }
}
```

### Claude.ai (web/mobile connector directory)
Add a custom connector pointed at `https://<real-deployed-domain>/mcp`. Set
**Authentication to "None"** (not "Always required" — there's no OAuth server to
authenticate against), then under **Additional request headers**, add:

- Header name: `Authorization`
- Header value: `Bearer <real token from Settings>`

### Real, important note on the URL
Use the actual production domain (e.g. `https://shaneslife.replit.app`), not a
Replit preview/dev URL (`*.picard.replit.dev` or similar) — the dev URL can behave
inconsistently with the rest of the app, since things like WebAuthn are tied to the
real, exact production hostname.

---

## 4. Confirmed tools — actually used tonight, exact names and parameters

Tools are **deferred** — call `tool_search` with a relevant query first to load a
tool's real definition before calling it (e.g. `tool_search("shopping list")`). What
follows is what's actually confirmed to exist and work, not a guess:

### Shopping
- `get_list` — read the current running list (or a specific `listId`). Call before
  `push_list` to avoid duplicating what's already there.
- `push_list` — add/replace items. Supports `store`, `budget`, `replace`,
  and `share` (mints a no-login share link in the same call).
- `log_price` — records a real price observation (`item`, `priceCents`, `store`); also
  stamps the price onto that item if it's currently on the open run, so the running
  total actually reflects it.
- `create_share_link` — mint a no-login link for a list or a captured entity.
- `add_missing_ingredients` — pushes a recipe's missing ingredients onto the run.

### Recipes
- `get_recipes` — every saved recipe with real can-make status against the current run.
- `push_recipes` — pushes one or more recipes. **Call `get_health_context` first** and
  set `heartHealthy: true` where it genuinely applies. Set `cookMinutes` only for a
  dish meant to sync with a "Tonight" multi-dish meal.
- `get_meal_plan` — currently planned meals, optionally windowed by date.

### Health & food preferences
- `get_health_context` / `set_health_context` — a real, stated health fact in Shane's
  own words (e.g. a cardiac condition). Read before generating any recipe; the app
  does no filtering of its own, so factoring it in is Claude's own job.
- `get_food_preferences` / `set_food_preferences` — real dislikes (soft avoid) and
  allergies (hard exclusion, no exceptions). **Call `get_food_preferences` before
  generating any shopping list or recipe, every time** — skipping this step is what
  put a real allergen on a real list once already.

### Money
- `get_gate_status` — Shane's real, current money position: available to spend, each
  bill's target/balance/shortfall, the habit-modeling line, Budget Day, critical
  debts, pending one-time events. Call before answering anything about affordability.
  `warnings[]` names anything excluded from the math (missing target, no Plaid
  balance) rather than silently treating it as funded.
- `set_debt` / `list_debts` / `delete_debt` — create or update a real debt row.
- `set_vehicle` — create or update a real vehicle (Cars).

There are more real tools beyond this list — Meds, Dates, Pets, Things, Lists, Vault,
Wins, People & Patterns, and others all have their own real MCP surface. Run
`tool_search` with the relevant room name to load them; don't assume a tool's exact
name or parameters from memory alone.

---

## 5. How Shane actually talks to the app — natural language, not forms

There are **no forms anywhere in Shane's Life** — every action happens by Shane typing
naturally (in the app's own capture box) or by Claude interpreting a natural statement
and calling the right tool. Real, confirmed examples of the pattern:

- "chicken breasts are $3.49 now" → `log_price`
- "oil change on the Kia, $84" → `set_vehicle`-adjacent capture
- "I'm allergic to shellfish" → `set_food_preferences`
- "add a debt: pool service, $300, 3 months behind" → `set_debt`

When Claude is the one doing this (rather than the in-app capture box), the same
principle applies: state what Shane told you, call the right tool, don't invent a
form-like confirmation step he didn't ask for.

---

## 6. The right order for generating a real shopping list or recipe

Established the hard way tonight (an allergen briefly made it onto a real list before
this was locked in):

1. Read `get_food_preferences` (and `get_health_context` for recipes) **first**,
   every time — before generating anything.
2. If a budget applies, establish it conversationally before proposing a list.
3. Propose a real, honest list/recipe with a real running total if there's a budget —
   say plainly if the math doesn't hit the target, don't round down silently.
4. Only after the base list is real and settled, layer in store-specific pricing
   (`log_price` history, weekly-ad data) as a refinement, not the starting point.

---

## 7. A few honest limits worth knowing

- The MCP has no live AI of its own — everything "smart" happens in the Claude
  conversation itself, not inside the app.
- Every tool call is logged and visible to Shane (Settings → Recent Activity) — this
  is by design, not a side effect to work around.
- The Vault (password manager) and Important Documents rooms are **deliberately not
  exposed over MCP at all** — too sensitive for a bearer-token-authenticated
  conversation to touch, even though the rest of the app is.
