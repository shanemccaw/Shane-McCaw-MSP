repo: shanemccaw/Shane-McCaw-MSP
branch: main
path: web/shanes-life

## Last sync
date: 2026-09-08T21:05:00Z

### Updated in this project
- Vault Autofill add-on designed (Shanes Life 19): chip, toolbar popup, Face ID window, options page; a 30-day trusted-device model (vault_device_trust, /api/vault/:id/fill, vault.always_ask) replaces one-Face-ID-per-fill from extension/README.md
- Vault is its own room (logins, bill refs, documents, trusted browsers); Money is a five-cell segmented control: Now / Bills / Accounts / Bankruptcy / Cars
- Settings has four tabs (House, You, Connected, Activity); Banks (plaid_items health + Plaid Link reconnect, migration 041) lives under Connected and lights the attic vent when a bank needs a reconnect
- Bankruptcy tab (debts overlay, 042); Documents (053) and passwords (052, extension/) live in the Vault room
- Capture bar redrawn: multi-line textarea (Enter = newline), Camera / Mic / Send inside the pill; Today's fox bubble made translucent
- Thirteen rooms; an odd count gives the last room the whole ground floor

## Sync history
### 2026-09-08T19:58:00Z
- Wins pulled out of Money into its own room (Git #3241): rose tile, lit for 3 days after a win, dated rows, "I did it" capture; Money keeps Now / Bills / Accounts / Cars / Vault
- New Tesla room on the real Fleet API surface (tesla.mjs, heading-home.mjs, migrations 055–058): on-demand read, Heading home, Warm it up, trunk with confirm, checkout-to-trunk countdown, commute charge check, Heading Out webhook status; Tesla card in Settings
- House is twelve rooms on six floors (Money | Wins; Medicine | Tesla; …); stored room orders are reconciled with new keys
- Widget page gains headingHome and charge kinds, both deep-linking to #tesla

## Sync history
### 2026-09-08T03:44:00Z
- Settings (the attic) carries the real app's sections: Account, Passkeys, Notifications, Health context, Places, Claude (MCP), Home Screen widget, Recent activity, with the copy from viewSettings
- Room order added as the first Settings card (not in the repo yet; house order is user state here)
- Widget page (Shanes Life 18) aligned with the repo's Home Screen widget tokens (Widget Web 26, migration 046)
- Money data mirrors FinanceHome's real screens (Sep 7, 2026)

### 2026-09-07T01:55:34Z (path desktop/ShanesSurvival)
- Money v2 built on the real ShanesSurvival math (DashboardService top line, account roles, is_critical, expected events, pay-period forecast)
- Critter roster and style cues read from BuildConsole (CritterRegistry, BuildQueuePanel CreateCute*Vector)
- Architecture 2a redrawn as the cloud half of ShanesSurvival, WPF narrowed to automation
- Handoff package lists schema additions on top of migrations 001–012

## Screen map
| Screen | Repo files |
| --- | --- |
| Tesla room | web/shanes-life/src/core/tesla.mjs, src/core/heading-home.mjs, src/core/places.mjs (headingHomeSignal, presence), src/routes/api.mjs (/api/tesla/*), src/routes/tesla.mjs (/hooks/tesla/:token), public/app.js (renderTeslaSettings, headingHome Next card), migrations/055_tesla_integration.sql, 056_tesla_commute_charge_nudge.sql, 057_heading_home.sql, 058_tesla_vehicle_commands.sql |
| Wins room | web/shanes-life/src/core/wins.mjs, src/routes/api.mjs (roomsForToday wins rule, /api/money/wins), public/app.js (ROOM_DEFS wins, viewWins), public/critters-sprite.svg (c-wins, c-wins2, r-wins), migrations/017_money_extras.sql, 033_wins_watch_state.sql |
| House (rooms, lamps, order) | web/shanes-life/public/app.js (ROOM_DEFS, roomsHouseSection), src/core/room-order.mjs (ROOM_KEYS, reconcile), src/routes/api.mjs (roomsForToday), migrations/050_room_order.sql |
| Settings (attic) | web/shanes-life/public/app.js (viewSettings, renderPasskeys, renderPushSettings, renderTeslaSettings), migrations/036_push_subscriptions.sql, 037_user_display_name.sql, 040_places.sql, 046_widget_tokens.sql |
| Home Screen widget page | web/shanes-life/src/core/widget.mjs (computeNextCard, headingHome), public/app.js (Home Screen widget section), migrations/046_widget_tokens.sql, bin/issue-widget-token.mjs |
| Settings → Connected → Banks | web/shanes-life/public/app.js (bankRow, openPlaidReconnect, viewMoneyBanks), migrations/041_plaid_item_health.sql |
| Money (Bankruptcy) | web/shanes-life/public/app.js (viewMoneyBankruptcy), migrations/042_bankruptcy_overlay.sql |
| Vault Autofill add-on (Shanes Life 19) | web/shanes-life/extension/README.md, content-script.js, popup.html, options.html, background.js, bridge.js; public/app.js (extensionReveal); migrations/046_widget_tokens.sql (token shape reused) |
| Vault room (logins, bill refs, documents, add-on) | web/shanes-life/public/app.js (vault tabs Logins / Bill refs, documents view, LastPass import, extensionReveal bridge), migrations/017_money_extras.sql, 052_vault_password_entries.sql, 053_important_documents.sql, extension/README.md |
| Money (Now, Bills, Accounts) | web/shanes-life/public/app.js (Money views, Distribute Paycheck, Period Review, income rules), migrations/017_money_extras.sql, 044_income_rules.sql, 045_money_home_tab_decision_tools.sql; desktop/ShanesSurvival/src/ShanesSurvival.Core/Dashboard/DashboardService.cs |
| Money (Protected, critical debt) | desktop/ShanesSurvival/src/ShanesSurvival.Core/Accounts/AccountRole.cs, migrations/010_debt_is_critical.sql |
| Critters (all screens) | web/shanes-life/public/critters.js, public/critters-sprite.svg; desktop/BuildConsole/Controls/CritterRegistry.cs |
| Contract (all rooms) | web/shanes-life/docs/shanes-life-design-contract-pack.md |
