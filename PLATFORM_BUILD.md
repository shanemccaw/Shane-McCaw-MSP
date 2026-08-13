# Platform Build Log

Append-only log of work sessions. Each session adds exactly one row, in two edits:

1. **At session start** (before any real work): append a row with status `⏳ IN FLIGHT — {step name}`, commit it immediately as its own standalone commit.
2. **At session end** (after the real work is done, tested, and typechecked): update that same row to `✅ DONE — {step name}`, filling in the real commit hash of the work, then commit the update (either folded into the final commit or immediately after it).

If a session dies, crashes, or is abandoned mid-way, its row stays `⏳ IN FLIGHT`, which is itself the record that an attempt was made and didn't finish.

See [CLAUDE.md](CLAUDE.md) for the exact instructions.

History before 2026-08-12 lives in [PLATFORM_BUILD_ARCHIVE_2026-08-12.md](PLATFORM_BUILD_ARCHIVE_2026-08-12.md) (Git #948). Pull that file for prior sessions' landed implementations, gotchas, and decisions.

| Date | Status | Step | Commit |
|------|--------|------|--------|
| 2026-08-12 | ✅ DONE | BuildConsole (WPF) repo hygiene: removed accidentally-committed temp `wpftmp.csproj`. Shane: "Oh no there are multiple .csproj files." A stray MSBuild-generated temp project file (auto-created and normally auto-deleted, but left behind when a build gets killed mid-flight — happened during tonight's #935 crash-diagnosis rebuild cycle) had been accidentally swept into an unrelated concurrent session's #937 bookend commit, causing "multiple project files, specify which one" ambiguity for any plain `dotnet build` in the directory (confirmed: it was genuinely `git ls-files`-tracked, not just a local leftover, so it would recur on every pull). Untracked + deleted via `git rm --cached`, added a `*_wpftmp.csproj` rule to `desktop/BuildConsole/.gitignore` so a future one can't get committed again. Verified: plain `dotnet build` (no explicit project arg) now resolves to the single real `BuildConsole.csproj` with no ambiguity error. Flagged separately, not fixed here (not mine to touch - another session's active in-progress work): `BuildConsole.csproj` currently pins `ICSharpCode.AvalonEdit` to `Version="6.3.0.90"`, which doesn't exist on nuget.org (`NU1102`, nearest real version found is `4.3.0-alpha-00000000`) - the build still won't fully succeed until that session corrects its own version pin. | `677da270` |
