using System.IO;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3012 — follow-up from #1990's retraction: "dispatch-time validation is still worth
    /// having, but scoped honestly: fail loudly and early on a `BUILD:` header the queue cannot
    /// satisfy, whatever the reason." #1990 deliberately did NOT build this, and explicitly
    /// retracted building a model allow-list (Shane runs every current model fine — model
    /// *availability* is not the problem this solves). This is scoped to structurally checkable,
    /// unsatisfiable header values only:
    ///   - a `--cwd` that names a directory which doesn't exist (the queue can never launch there);
    ///   - a `--model` / `--effort` value that is itself a stray/malformed flag token rather than a
    ///     real value — the tell-tale sign of two `--flag value` pairs in a hand-edited header
    ///     running together without a separating space, so the parser captured the next flag's
    ///     name as this flag's value instead of a real one.
    /// A present-but-blank `--model`/`--effort` is NOT an error here — <see cref="BuildQueuePostgresClient.QueueBuildAsync"/>
    /// already trims a whitespace-only value down to null, which launches with the queue's own
    /// default, and that degrade-to-default behavior is correct, not something to fail loudly on.
    /// </summary>
    public static class BuildHeaderValidation
    {
        /// <summary>
        /// Validates an already-parsed `BUILD:` header's launch-affecting fields, called at the
        /// moment a build is about to claim a queue slot (<see cref="BuildQueuePostgresClient.QueueBuildAsync"/>),
        /// before the row is written as 'queued'. Returns null when the header is satisfiable;
        /// otherwise a short, human-readable reason naming exactly which field failed and why, for
        /// the ActivityLog line and the row's forced 'parked' status.
        /// </summary>
        public static string? Validate(string? model, string? effort, string? cwd)
        {
            if (LooksLikeStrayFlag(model))
                return $"--model value \"{model}\" looks like a stray/malformed flag token, not a real model id";
            if (LooksLikeStrayFlag(effort))
                return $"--effort value \"{effort}\" looks like a stray/malformed flag token, not a real effort level";
            if (!string.IsNullOrWhiteSpace(cwd) && !Directory.Exists(cwd))
                return $"--cwd \"{cwd}\" does not exist";
            return null;
        }

        // A real model id or effort level never itself starts with "--" — that shape only occurs
        // when a hand-edited header's flags ran together without a separating space (e.g.
        // "--model--effort high"), and ExtractLeadingFlags' regex captured the next flag's own
        // name as this flag's value instead of a genuine one.
        private static bool LooksLikeStrayFlag(string? value) =>
            !string.IsNullOrWhiteSpace(value) && value.TrimStart().StartsWith("--");
    }
}
