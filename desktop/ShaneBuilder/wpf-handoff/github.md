# GitHub

repo: shanemccaw/Shane-McCaw-Design-Gemini
branch: main
path: src

## Last sync
date: 2026-08-31T23:16:00Z
commit: 936e636d0b65

### Updated in this project
- Pulled BuildQueuePanel.tsx, RightDock.tsx, themeColors.ts in full (read-only, not copied as files — data model + real colors ported into Shell Skeleton's mock)
- Rebuilt Shell Skeleton's Build Queue with real Build Sets (BuildConsole/Portal/config-state-core), real epic colors, real toolbar buttons, real task titles/branches/blockers

## Screen map
| Screen | Repo files |
|---|---|
| Build Queue panel (right dock) | src/components/BuildQueuePanel.tsx, src/components/GitIssuesVelocityWidget.tsx, src/components/RightDock.tsx, src/utils/themeColors.ts, src/data/gitVelocityData.ts |
| Shell frame (top bar, rail, panels) | not yet ported from this repo — built from the BuildConsole Shell design plan + shanemccaw/Shane-McCaw-MSP desktop/BuildConsole source |
| Home page | not yet ported — src/components/HomeDocument.tsx available |
| Build stdout / live console | not yet ported — src/components/UnifiedStdoutPanel.tsx available |

## Reference repos
- shanemccaw/Shane-McCaw-MSP (main) — real BuildConsole WPF source at desktop/BuildConsole; used for authentic content (epics, labels, log channels)
