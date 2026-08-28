# #b (local, follow-up to Git #1418) — Raise secondary-account cap from Sonnet Medium to Sonnet High

- **Status:** ✅ DONE
- **Scope:** buildconsole
- **Started:** 2026-08-27
- **Commit(s):** f105ef377

## Log
- 2026-08-27 ⏳ IN FLIGHT — Shane asked directly (not via a GitHub issue) to raise the #1418 secondary-account cap so Sonnet High effort is allowed, not held. Editing `AccountCapPolicy.cs` (`IsHighOrAboveEffort` → `IsAboveHighEffort`, now only matches `xhigh`; `ExceedsSonnetMedium` → `ExceedsSonnetHigh`) and updating callers (`QueueWatcherService.cs`, `BuildQueuePanel.xaml`/`.xaml.cs`, `BuildQueuePostgresClient.cs` doc comments) + user-facing strings ("Sonnet Medium" → "Sonnet High"). Opus models are still always capped, at any effort — only the Sonnet effort threshold moved.
- 2026-08-27 ✅ DONE — Shipped in `f105ef377`. `AccountCapPolicy.ExceedsSonnetHigh` now trips only for any Opus model or `xhigh` effort; plain Sonnet at High effort launches normally on the secondary account instead of being held. All caller sites (`QueueWatcherService.LaunchItem`/`HoldForSonnetOverflowAsync`, `BuildQueuePanel` banner/tooltip/status-pill text, `BuildQueuePostgresClient` doc comments) updated to match — no remaining "Sonnet Medium" wording outside the historical direct quotes of Shane's original #1418 request, kept as-is for provenance. Verification (real): `dotnet build` on `desktop/BuildConsole/BuildConsole.csproj` → 0 errors, same pre-existing warning set, no new warnings. No live BuildConsole app run / DB round-trip in this session — this is a pure threshold/label change with no new SQL or schema surface, so the #1418 session's already-verified hold/resume SQL path is unaffected.
