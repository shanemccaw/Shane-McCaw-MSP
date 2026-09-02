# BuildConsole shell — real content mined from repo (for prototype data)

## Rail order (user-provided, verbatim groups)
Chats, Sticky Notes | Batter Up, Build Watch, Git Board | Web, My Company | Source Control, Files | Visual Test Tracker, UI Automations | Settings
- Web = hover popout: Replit, LinkedIn, Google Analytics, Microsoft Clarity, GitHub, Claude Design, Azure, Microsoft Admin
- My Company = hover popout: Admin Panel, Portal, Marketing (placed after Web; confirm)
Density: VS Code-tight. Deliverable: interactive prototype (rail swaps panels, Ctrl+K opens, Focus Mode toggles). States: default Chats, Focus Mode, Ctrl+K, Git Board panel.
Build Queue: spec in GitHub issue #2031 (user to paste body). Constraint: NO saturated/neon colors, muted tones only.

## Real epics / issues (Milestone 5 = v1.1)
- #1096 EPIC: Application Core (engines, workflow, PowerShell, Graph, schema, auth, api-server)
- #1095 EPIC: Admin Panel (AdminV2, /api/admin/*)
- #1202 Epic: Build Console (BuildConsole WPF, build queue, dev-server scripts)
- #1485 EPIC: Portal (92 children; portal-v2 retired; Design/portal/ .dc.html exports)
- #1571 EPIC: Portal Admin (MSP operator surface)
- #1093 EPIC: Marketing Website
- #1281 GATE: v1.1 release (Shane-verify actions)
- #1630 standing manual-SQL-migrations checklist
- #1494 Microsoft Changes (page epic under #1485)
- Shell plan issues: #2013 epic_id FK (blocks #1787 #1788 #2016 #2017 #2018 #2019), #2014, #2015 bottom panel, #2018 Chats panel, #2019 Git Board rebuild, #2020/#2021 build queue scroll fixes, #2031 Build Queue panel spec
- History: #950 queue sort (numbered first, biggest GithubNumber first), #956 queue flicker, #971 Sessions tile, #984 manifest tree, #1206/#1251/#1799 progress reporting, #1371/#1372 worktree isolation, #1416 multi-account, #1447 branch-merged check, #1708 AI Batter Up status, #1913 prod gate, #1987 blocked_by edges

## Labels / statuses
- in-flight (yellow #fbca04), complete (green #0e8a16), blocked, Shane To-Do (red #b60205)
- Board statuses: Backlog, AI Batter Up (review queue), Batter Up (launch queue), + Verifying/Done implied
- Blocked builds render nested under blocker in red box; different color when dependency clears

## Build prompt flags (first line of queued build prompt)
--title <leaf issue #> --model claude-opus-5 --effort low|medium|high --cwd <path> --blocked-by n,n --buildSet <name> --account primary|secondary

## Build Watch
Per-slot progress bars, percentage, active phase card, heuristic ETA. Phases: Investigation -> Implementation -> Verification (step N of M via report-progress.mjs). Stale: "⚠ No progress update in Xm". Checklist-derived fallback.

## Dev services
API Server (always-on), Marketing, Admin, Portal, Website. Selective restarts per changed path (artifacts/api-server -> API, artifacts/msp-portal -> Portal, lib/ -> ALL). Worktrees at C:\wt\<id>, junctioned deps. Build Sets: one restart per set.

## Log channels (locked taxonomy, for bottom panel)
engine.*, workflow.*, billing, auth, comms.*, notification, tenant.*, admin.*, integration.azure, growth.*, crm, system.core, audit

## Timers (real polling cadence)
Git Board 20s, Home rollup 10s, deploy-status/chat-tab-build 3s, Build Watch 3s, Build Queue 15s

## Document tab types (center view)
IssueDetail, GitDetail, Chat (WebView2 claude.ai), SQL, ChatMappings. Pinned tabs + Shelf (ShelvedTabs).

## Real control names (desktop/BuildConsole/Controls/)
ActivityBar, LeftSidebar, BuildQueuePanel (+QueuePause, NewBuildPaste), HomeView, GitDetailView, IssueDetailView, SqlDocumentView, ChatMappingsDocumentView, SettingsTabView, TerminalView, ServiceLogView, BuildLogView, DiffView, DispatchPanel, BatterUpPanel, AiBatterUpPanel, ApiRunnerView, FocusModeBar, FocusImmersiveView (RETIRED), CritterLounge/SailorDuck (mascots, being removed), StartupLoadingView. Notifications: ToastEngine, ToastCard, ToastHostWindow, ToastKind. Windows: BuildWatchWindow, ManifestViewerWindow, DeviceCodeWindow, MissingVariableWindow. Dialogs: NewIssue, EditIssue, AssignEpic, AssignChatToEpic, AssignIssueEpic, NewChatEpic, EditBuildPrompt, NeedsAttentionDetail.
Services of note: ClaudeUsageMeterService (account cap), BuildQueuePostgresClient, GitHubIssuesService, FocusModeService, EpicChatUrlBuilder, ChatContextMeterScript/Store (per-chat context meter), ReplitSshService, DevServicesManager, BuildCompletionSoundService, EncouragementService.

## Misc authentic details
- SQL Runner is a "floaty" window; issue bodies referencing lib/db/migrations/manual/*.sql get one-click load
- shaneapp:// protocol (reportProgress, executeSql), scripts/report-progress.mjs
- 8 concurrent agent sessions typical; pnpm monorepo; Verizon capped bandwidth (downloads are a real cost)
- Chats live on claude.ai in WebView2; chat "Queue" button injected (ChatButtonInjector); context meter per chat
- Status bar strip today: port/spaces/UTF-8/branch style
- Top bar today: Account, Location, Conservation/Drain indicators (Claude usage meters)
