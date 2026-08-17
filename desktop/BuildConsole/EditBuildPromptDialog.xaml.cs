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
        public string? FinalEffort { get; private set; }
        public string? FinalCwd { get; private set; }
        public string? FinalMode { get; private set; }
        public int? FinalGithubNumber { get; private set; }
        public List<int>? FinalBlockedByNumbers { get; private set; }

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

            // Set up initial blockers text
            var blockerTokens = new List<string>();
            if (_parsedFlags.TryGetValue("blocked-by", out var bb) && !string.IsNullOrWhiteSpace(bb))
            {
                blockerTokens.AddRange(bb.Split(',').Select(s => s.Trim()).filterNonEmpty());
            }
            if (_parsedFlags.TryGetValue("block-by", out var localBb) && !string.IsNullOrWhiteSpace(localBb))
            {
                blockerTokens.AddRange(localBb.Split(',').Select(s => s.Trim().StartsWith("-") ? s.Trim() : "-" + s.Trim()).filterNonEmpty());
            }

            BlockersBox.Text = string.Join(", ", blockerTokens);

            // Effective issue number
            int? effectiveNum = referencedNumber;
            if (_parsedFlags.TryGetValue("notGit", out var ng) && int.TryParse(ng, out var ngNum))
            {
                effectiveNum = -ngNum;
            }
            else if (_parsedFlags.TryGetValue("title", out var tNum) && int.TryParse(tNum, out var tParsed))
            {
                effectiveNum = tParsed;
            }
            FinalGithubNumber = effectiveNum;

            // Title & Badges
            string title = _parsedFlags.GetValueOrDefault("title", "");
            string numPrefix = effectiveNum.HasValue ? (effectiveNum.Value < 0 ? $"Local #{ -effectiveNum.Value }" : $"#{effectiveNum.Value}") : "";
            HeaderTitleText.Text = !string.IsNullOrEmpty(title)
                ? $"{numPrefix} {title}".Trim()
                : (effectiveNum.HasValue ? $"Build for {numPrefix}" : "Edit Build Prompt");

            string model = _parsedFlags.GetValueOrDefault("model", "auto");
            ModelBadgeText.Text = $"model: {model}";

            string effort = _parsedFlags.GetValueOrDefault("effort", "high");
            EffortBadgeText.Text = $"effort: {effort}";

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
            var localNums = new List<string>();

            foreach (var tok in tokens)
            {
                if (tok.StartsWith("-") && int.TryParse(tok.TrimStart('-'), out var _))
                    localNums.Add(tok.TrimStart('-'));
                else if (int.TryParse(tok, out var _))
                    gitNums.Add(tok);
            }

            if (gitNums.Count > 0)
                flags["blocked-by"] = string.Join(",", gitNums);
            else
                flags.Remove("blocked-by");

            if (localNums.Count > 0)
                flags["block-by"] = string.Join(",", localNums);
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
            FinalEffort = flags.GetValueOrDefault("effort");
            FinalCwd = flags.GetValueOrDefault("cwd");
            FinalMode = flags.GetValueOrDefault("mode");

            // Title
            string? rawTitle = flags.GetValueOrDefault("title");
            FinalTitle = rawTitle ?? (rest.Split('\n').FirstOrDefault()?.Trim());

            // Blockers
            var blockedList = new List<int>();
            if (flags.TryGetValue("blocked-by", out var bb) && !string.IsNullOrWhiteSpace(bb))
            {
                foreach (var part in bb.Split(','))
                {
                    if (int.TryParse(part.Trim(), out var n)) blockedList.Add(n);
                }
            }
            if (flags.TryGetValue("block-by", out var localBb) && !string.IsNullOrWhiteSpace(localBb))
            {
                foreach (var part in localBb.Split(','))
                {
                    if (int.TryParse(part.Trim(), out var n)) blockedList.Add(-Math.Abs(n));
                }
            }
            FinalBlockedByNumbers = blockedList.Count > 0 ? blockedList : null;

            // GitHub Number
            if (flags.TryGetValue("notGit", out var ng) && int.TryParse(ng, out var ngNum))
            {
                FinalGithubNumber = -ngNum;
            }
            else if (FinalTitle != null && int.TryParse(FinalTitle, out var tNum))
            {
                FinalGithubNumber = tNum;
            }
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

        private static (Dictionary<string, string> flags, string rest) ExtractLeadingFlags(string text)
        {
            int newlineIdx = text.IndexOf('\n');
            string firstLine = newlineIdx == -1 ? text : text.Substring(0, newlineIdx);

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
