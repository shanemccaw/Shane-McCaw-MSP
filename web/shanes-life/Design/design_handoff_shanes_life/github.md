repo: shanemccaw/Shane-McCaw-MSP
branch: main
path: web/shanes-life

## Last sync
date: 2026-09-08T03:44:00Z

### Updated in this project
- Settings (the attic) now carries the real app's sections: Account, Passkeys, Notifications, Health context, Places, Claude (MCP), Home Screen widget, Recent activity, with the copy from viewSettings
- Room order added as the first Settings card (not in the repo yet; house order is user state here)
- Widget page (Shanes Life 18) aligned with the repo's Home Screen widget tokens (Widget Web 26, migration 046)
- Money data now mirrors FinanceHome's real screens (Sep 7, 2026)

## Sync history
### 2026-09-07T01:55:34Z (path desktop/ShanesSurvival)
- Money v2 built on the real ShanesSurvival math (DashboardService top line, account roles, is_critical, expected events, pay-period forecast)
- Critter roster and style cues read from BuildConsole (CritterRegistry, BuildQueuePanel CreateCute*Vector)
- Architecture 2a redrawn as the cloud half of ShanesSurvival, WPF narrowed to automation
- Handoff package lists schema additions on top of migrations 001–012

## Screen map
| Screen | Repo files |
| --- | --- |
| Settings (attic) | web/shanes-life/public/app.js (viewSettings, renderPasskeys, renderPushSettings), migrations/036_push_subscriptions.sql, 037_user_display_name.sql, 040_places.sql, 046_widget_tokens.sql |
| Home Screen widget page | web/shanes-life/public/app.js (Home Screen widget section), migrations/046_widget_tokens.sql, bin/issue-widget-token.mjs |
| House (rooms, lamps) | web/shanes-life/public/app.js (ROOMS table, roomsCell, roomsHouseSection), public/critters-sprite.svg |
| Money (Now, Bills, Accounts) | web/shanes-life/public/app.js (Money views, Distribute Paycheck, Period Review, income rules), migrations/017_money_extras.sql, 044_income_rules.sql, 045_money_home_tab_decision_tools.sql; desktop/ShanesSurvival/src/ShanesSurvival.Core/Dashboard/DashboardService.cs |
| Money (Protected, critical debt) | desktop/ShanesSurvival/src/ShanesSurvival.Core/Accounts/AccountRole.cs, migrations/010_debt_is_critical.sql |
| Critters (all screens) | web/shanes-life/public/critters.js, public/critters-sprite.svg; desktop/BuildConsole/Controls/CritterRegistry.cs |
| Contract (all rooms) | web/shanes-life/docs/shanes-life-design-contract-pack.md |
