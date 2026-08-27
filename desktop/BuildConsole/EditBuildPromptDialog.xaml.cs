using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole
{
    public enum EditBuildAction
    {
        None,
        SendToBuilder,
        QueueBuild
    }

    public partial class EditBuildPromptDialog : Window
    {
        public EditBuildAction ActionChosen { get; private set; } = EditBuildAction.None;

        public string FinalPrompt { get; private set; } = "";
        public string? FinalTitle { get; private set; }
        public string? FinalModel { get; private set; }
        public string? FinalCli { get; private set; }
        public string? FinalEffort { get; private set; }
        public string? FinalCwd { get; private set; }
        /// <summary>Build Sets — the optional `--buildSet &lt;name&gt;` header flag. When present,
        /// every build queued with this same name is grouped into one set whose dev-server
        /// restart is deferred until the whole set completes (see scripts/dev-server).</summary>
        public string? FinalBuildSet { get; private set; }
        /// <summary>Git #1416 — which Claude account this build runs against: "secondary" (Shane's
        /// overflow Pro account, launched with CLAUDE_CONFIG_DIR pointed at the secondary config dir)
        /// or null/"primary" (the default Max 20x account). Chosen via the footer Account selector,
        /// mirrored to an `--account secondary` build-prompt header flag.</summary>
        public string? FinalAccount { get; private set; }
        public string? FinalMode { get; private set; }
        /// <summary>Positive GitHub issue number, or null. A LOCAL (--notGit) build carries
        /// null here — its letter id (A, B, C…) is auto-allocated at queue time, not now.</summary>
        public int? FinalGithubNumber { get; private set; }
        /// <summary>True when the prompt carries a --notGit flag: this is a LOCAL build and
        /// gets the next unused letter id from the registry when queued.</summary>
        public bool FinalIsLocalBuild { get; private set; }
        /// <summary>Raw --blocked-by tokens (GitHub issue numbers). MainWindow resolves these.</summary>
        public List<string> FinalGitBlockers { get; private set; } = new();
        /// <summary>Raw --block-by tokens (LOCAL letter ids, e.g. "A","AB"; legacy numbers tolerated).</summary>
        public List<string> FinalLocalBlockers { get; private set; } = new();

        private Dictionary<string, string> _parsedFlags = new(StringComparer.OrdinalIgnoreCase);
        private string _bodyText = "";
        private bool _syncingPrompt;

        public EditBuildPromptDialog(
            string rawPrompt,
            int? referencedNumber,
            BuildTrackerApiClient? api,
            IReadOnlyList<GitBoardIssue>? candidateIssues = null)
        {
            InitializeComponent();

            ParseRawPrompt(rawPrompt, referencedNumber);

            // Populate Quick Blocker chips from candidate issues
            PopulateQuickBlockers(candidateIssues);

            UpdateCharCount();
        }

        private void ParseRawPrompt(string rawPrompt, int? referencedNumber)
        {
            var (flags, rest) = ExtractLeadingFlags(rawPrompt);
            _parsedFlags = flags;
            _bodyText = rest;

            // Is this a LOCAL (--notGit) build? The value after --notGit (if any) is now
            // ignored — a fresh letter id (A, B, C…) is auto-allocated at queue time.
            bool isLocal = _parsedFlags.ContainsKey("notGit");
            FinalIsLocalBuild = isLocal;

            // Set up initial blockers text. GitHub blockers (--blocked-by) show as numbers;
            // LOCAL blockers (--block-by) show as their letters — a legacy numeric --block-by
            // value is upgraded to its letter form for display.
            var blockerTokens = new List<string>();
            if (_parsedFlags.TryGetValue("blocked-by", out var bb) && !string.IsNullOrWhiteSpace(bb))
            {
                blockerTokens.AddRange(bb.Split(',').Select(s => s.Trim()).filterNonEmpty());
            }
            if (_parsedFlags.TryGetValue("block-by", out var localBb) && !string.IsNullOrWhiteSpace(localBb))
            {
                blockerTokens.AddRange(localBb.Split(',')
                    .Select(s => s.Trim().TrimStart('-'))
                    .filterNonEmpty()
                    .Select(NormalizeLocalToken));
            }
            BlockersBox.Text = string.Join(", ", blockerTokens);

            // Identity for the header. A local build's letter isn't known until it's queued,
            // so show a "new local build" prefix; a GitHub build shows #N.
            int? gitNum = null;
            if (!isLocal)
            {
                if (_parsedFlags.TryGetValue("title", out var tNum) && int.TryParse(tNum, out var tParsed))
                    gitNum = tParsed;
                else
                    gitNum = referencedNumber;
            }
            FinalGithubNumber = gitNum;

            // Title & Badges
            string title = _parsedFlags.GetValueOrDefault("title", "");
            string numPrefix = isLocal ? "New local build" : (gitNum.HasValue ? $"#{gitNum.Value}" : "");
            HeaderTitleText.Text = !string.IsNullOrEmpty(title)
                ? $"{numPrefix} {title}".Trim()
                : (!string.IsNullOrEmpty(numPrefix) ? $"Build for {numPrefix}" : "Edit Build Prompt");

            string model = _parsedFlags.GetValueOrDefault("model", "auto");
            ModelBadgeText.Text = $"model: {model}";

            string effort = _parsedFlags.GetValueOrDefault("effort", "high");
            EffortBadgeText.Text = $"effort: {effort}";

            // Git #1416 — reflect any `--account` header flag into the footer selector without
            // triggering a re-sync back into the prompt (that would fire before the body is set).
            bool secondary = string.Equals(_parsedFlags.GetValueOrDefault("account"), "secondary", StringComparison.OrdinalIgnoreCase);
            _syncingPrompt = true;
            AccountSelector.SelectedIndex = secondary ? 1 : 0;
            _syncingPrompt = false;

            // Populate Editor with the full raw prompt
            _syncingPrompt = true;
            PromptEditorBox.Text = rawPrompt;
            _syncingPrompt = false;
        }

        private void PopulateQuickBlockers(IReadOnlyList<GitBoardIssue>? candidateIssues)
        {
            QuickBlockerChips.Children.Clear();
            if (candidateIssues == null || candidateIssues.Count == 0)
            {
                QuickBlockerPanel.Visibility = Visibility.Collapsed;
                return;
            }

            int count = 0;
            foreach (var issue in candidateIssues.Where(i => !i.IsClosed).Take(8))
            {
                var chip = new Button
                {
                    Content = $"# {issue.Number} {Truncate(issue.Title, 24)}",
                    Style = (Style)FindResource("IconButton"),
                    FontSize = 10.5,
                    Padding = new Thickness(6, 3, 6, 3),
                    Margin = new Thickness(0, 0, 6, 4),
                    Tag = issue.Number.ToString()
                };

                chip.Click += (s, e) =>
                {
                    if (chip.Tag is string numStr)
                    {
                        AddBlockerToken(numStr);
                    }
                };

                QuickBlockerChips.Children.Add(chip);
                count++;
            }

            QuickBlockerPanel.Visibility = count > 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        private void AddBlockerToken(string token)
        {
            var current = BlockersBox.Text.Split(',')
                .Select(s => s.Trim())
                .Where(s => !string.IsNullOrEmpty(s))
                .ToList();

            if (!current.Contains(token, StringComparer.OrdinalIgnoreCase))
            {
                current.Add(token);
                BlockersBox.Text = string.Join(", ", current);
            }
        }

        private void BlockersBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            if (_syncingPrompt) return;

            // Update the --blocked-by / --block-by flag in PromptEditorBox
            SyncBlockersToPrompt();
        }

        private void BtnClearBlockers_Click(object sender, RoutedEventArgs e)
        {
            BlockersBox.Text = "";
        }

        private void SyncBlockersToPrompt()
        {
            string currentPrompt = PromptEditorBox.Text;
            var (flags, rest) = ExtractLeadingFlags(currentPrompt);

            var tokens = BlockersBox.Text.Split(',')
                .Select(s => s.Trim())
                .Where(s => !string.IsNullOrEmpty(s))
                .ToList();

            var gitNums = new List<string>();
            var localLetters = new List<string>();

            foreach (var raw in tokens)
            {
                var tok = raw.Trim();
                if (tok.StartsWith("-") && int.TryParse(tok.TrimStart('-'), out var legacyNeg) && legacyNeg > 0)
                    localLetters.Add(Services.LocalBuildId.ToLetters(legacyNeg)); // legacy -N -> letter
                else if (Services.LocalBuildId.IsLetterToken(tok))
                    localLetters.Add(tok.ToUpperInvariant());                     // letters -> LOCAL
                else if (int.TryParse(tok, out var _))
                    gitNums.Add(tok);                                             // plain number -> GitHub
            }

            if (gitNums.Count > 0)
                flags["blocked-by"] = string.Join(",", gitNums);
            else
                flags.Remove("blocked-by");

            if (localLetters.Count > 0)
                flags["block-by"] = string.Join(",", localLetters);
            else
                flags.Remove("block-by");

            string flagLine = string.Join(" ", flags.Select(kv => $"--{kv.Key} {kv.Value}"));
            string newPrompt = string.IsNullOrEmpty(flagLine) ? rest : flagLine + "\n\n" + rest;

            _syncingPrompt = true;
            PromptEditorBox.Text = newPrompt;
            _syncingPrompt = false;
        }

        private void PromptEditorBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            UpdateCharCount();
        }

        /// <summary>Git #1416 — footer Account selector changed: mirror the choice into the prompt's
        /// `--account` header flag (secondary adds it; primary removes it) so the flag line stays the
        /// single source of truth, exactly like the blockers box.</summary>
        private void AccountSelector_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_syncingPrompt) return;
            SyncAccountToPrompt();
        }

        /// <summary>Rewrites the prompt's leading flag line so its `--account` flag matches the
        /// footer selector. "secondary" sets `--account secondary`; "primary" (the default) removes
        /// the flag entirely so a primary build stays flag-free. Preserves every other header flag.</summary>
        private void SyncAccountToPrompt()
        {
            bool secondary = string.Equals(SelectedAccount(), "secondary", StringComparison.OrdinalIgnoreCase);

            string currentPrompt = PromptEditorBox.Text;
            var (flags, rest) = ExtractLeadingFlags(currentPrompt);

            if (secondary)
                flags["account"] = "secondary";
            else
                flags.Remove("account");

            string flagLine = string.Join(" ", flags.Select(kv => $"--{kv.Key} {kv.Value}"));
            string newPrompt = string.IsNullOrEmpty(flagLine) ? rest : flagLine + "\n\n" + rest;

            _syncingPrompt = true;
            PromptEditorBox.Text = newPrompt;
            _syncingPrompt = false;
        }

        /// <summary>The account currently chosen in the footer selector ("primary" or "secondary"); "primary" when unset.</summary>
        private string SelectedAccount() =>
            (AccountSelector?.SelectedItem as ComboBoxItem)?.Content?.ToString()?.Trim().ToLowerInvariant() ?? "primary";

        private void UpdateCharCount()
        {
            int chars = PromptEditorBox.Text.Length;
            int lines = PromptEditorBox.Text.Split('\n').Length;
            PromptCharCountText.Text = $"{lines} lines, {chars:N0} chars";
        }

        private void PrepareFinalPayload()
        {
            string fullText = PromptEditorBox.Text.Trim();
            var (flags, rest) = ExtractLeadingFlags(fullText);

            FinalPrompt = rest;
            FinalModel = flags.GetValueOrDefault("model");
            FinalCli = flags.GetValueOrDefault("cli");
            FinalEffort = flags.GetValueOrDefault("effort");
            FinalCwd = flags.GetValueOrDefault("cwd");
            FinalMode = flags.GetValueOrDefault("mode");
            FinalBuildSet = flags.GetValueOrDefault("buildSet");
            // Git #1416 — the footer selector is the source of truth (it's mirrored into the
            // `--account` flag on change); fall back to a hand-typed flag if for any reason the
            // selector wasn't touched. Only "secondary" is meaningful; primary → null.
            bool secondary = string.Equals(SelectedAccount(), "secondary", StringComparison.OrdinalIgnoreCase)
                             || string.Equals(flags.GetValueOrDefault("account"), "secondary", StringComparison.OrdinalIgnoreCase);
            FinalAccount = secondary ? "secondary" : null;

            // Title
            string? rawTitle = flags.GetValueOrDefault("title");
            FinalTitle = rawTitle ?? (rest.Split('\n').FirstOrDefault()?.Trim());

            // Blockers — raw tokens. MainWindow resolves --block-by letters through the
            // local-id registry and --blocked-by numbers as GitHub issues.
            FinalGitBlockers = SplitTokens(flags.GetValueOrDefault("blocked-by"));
            FinalLocalBlockers = SplitTokens(flags.GetValueOrDefault("block-by"));

            // Identity: --notGit => LOCAL (letter assigned at queue time; no github number
            // here). Otherwise a bare numeric title is a GitHub issue number.
            FinalIsLocalBuild = flags.ContainsKey("notGit");
            if (FinalIsLocalBuild)
                FinalGithubNumber = null;
            else if (FinalTitle != null && int.TryParse(FinalTitle, out var tNum))
                FinalGithubNumber = tNum;
            // else: keep whatever ParseRawPrompt resolved (the referenced GitHub number).
        }

        private void BtnSendToBuilder_Click(object sender, RoutedEventArgs e)
        {
            PrepareFinalPayload();
            ActionChosen = EditBuildAction.SendToBuilder;
            DialogResult = true;
            Close();
        }

        private void BtnQueueBuild_Click(object sender, RoutedEventArgs e)
        {
            PrepareFinalPayload();
            ActionChosen = EditBuildAction.QueueBuild;
            DialogResult = true;
            Close();
        }

        private void Cancel_Click(object sender, RoutedEventArgs e)
        {
            ActionChosen = EditBuildAction.None;
            DialogResult = false;
            Close();
        }

        /// <summary>Normalize a LOCAL blocker token for display: a legacy number becomes its
        /// letter form (3 -> "C"), a letter token is upper-cased, anything else is left as-is.</summary>
        private static string NormalizeLocalToken(string tok)
        {
            tok = tok.Trim();
            if (int.TryParse(tok, out var n) && n > 0) return Services.LocalBuildId.ToLetters(n);
            return tok.ToUpperInvariant();
        }

        private static List<string> SplitTokens(string? csv) =>
            string.IsNullOrWhiteSpace(csv)
                ? new List<string>()
                : csv.Split(',').Select(s => s.Trim()).Where(s => s.Length > 0).ToList();

        private static (Dictionary<string, string> flags, string rest) ExtractLeadingFlags(string text)
        {
            int newlineIdx = text.IndexOf('\n');
            string firstLine = newlineIdx == -1 ? text : text.Substring(0, newlineIdx);

            // Allow a valueless --notGit (the letter id is auto-allocated). Normalize a bare
            // "--notGit" (end of line, or immediately before another --flag) to "--notGit local"
            // so the flag/value regex below still recognizes it. "--notGit 109" is untouched
            // (its value is simply ignored downstream).
            firstLine = Regex.Replace(firstLine, @"--notGit(?=\s+--|\s*$)", "--notGit local");

            var flagRe = new Regex(@"--([\w-]+)\s+(\S+)", RegexOptions.Compiled);
            var flags = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            var matches = flagRe.Matches(firstLine);
            foreach (Match m in matches)
            {
                flags[m.Groups[1].Value] = m.Groups[2].Value;
            }

            if (flags.Count == 0 || flagRe.Replace(firstLine, "").Trim() != "")
            {
                return (new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase), text);
            }

            string rest = newlineIdx == -1 ? "" : text.Substring(newlineIdx + 1).TrimStart('\r', '\n');
            return (flags, rest);
        }

        private static string Truncate(string s, int max) => s.Length > max ? s.Substring(0, max - 1) + "…" : s;
    }

    internal static class EnumerableExtensions
    {
        public static IEnumerable<string> filterNonEmpty(this IEnumerable<string> src)
            => src.Where(s => !string.IsNullOrWhiteSpace(s));
    }
}
