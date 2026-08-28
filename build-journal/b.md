# #b (local, follow-up to Git #1418) — Raise secondary-account cap from Sonnet Medium to Sonnet High

- **Status:** ⏳ IN FLIGHT
- **Scope:** buildconsole
- **Started:** 2026-08-27
- **Commit(s):** (fill at DONE)

## Log
- 2026-08-27 ⏳ IN FLIGHT — Shane asked directly (not via a GitHub issue) to raise the #1418 secondary-account cap so Sonnet High effort is allowed, not held. Editing `AccountCapPolicy.cs` (`IsHighOrAboveEffort` → `IsAboveHighEffort`, now only matches `xhigh`; `ExceedsSonnetMedium` → `ExceedsSonnetHigh`) and updating callers (`QueueWatcherService.cs`, `BuildQueuePanel.xaml`/`.xaml.cs`, `BuildQueuePostgresClient.cs` doc comments) + user-facing strings ("Sonnet Medium" → "Sonnet High"). Opus models are still always capped, at any effort — only the Sonnet effort threshold moved.
