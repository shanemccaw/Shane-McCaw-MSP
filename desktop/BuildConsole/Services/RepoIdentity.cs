namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3579 — the real (repo_owner, repo_name) default every issue/milestone-number-keyed
    /// local table (bt_issue_mirror, bt_build_queue, bt_dispatch_claims, bt_epics, bt_issues,
    /// bt_chat_issues, bt_chat_mentioned_issues, bt_milestone_mirror, build_dispatch_log — see
    /// lib/db/migrations/manual/2026-09-10-multi-repo-issue-key-dimension-3579.sql) now carries.
    ///
    /// Every DB write/lookup that used to key purely on an issue/milestone number now also
    /// threads this default explicitly, so today's single-repo behavior is completely
    /// unaffected while the schema is ready for a second real repo. Same literal values as
    /// <see cref="BuildConsoleSettings.GitHubOwner"/>/<see cref="BuildConsoleSettings.GitHubRepoName"/>'s
    /// own defaults — deliberately not sourced from Settings here: this is the DB-column
    /// default for the one repo BuildConsole talks to today, not yet a live per-item repo
    /// resolution (that's #3581's Settings repo registry + #3582's merged Batter Up +
    /// #3584's dispatch/worktree provisioning, all of which replace these hardcoded reads
    /// with the item's own real repo_owner/repo_name column).
    /// </summary>
    public static class RepoIdentity
    {
        public const string DefaultOwner = "shanemccaw";
        public const string DefaultName = "Shane-McCaw-MSP";
    }
}
