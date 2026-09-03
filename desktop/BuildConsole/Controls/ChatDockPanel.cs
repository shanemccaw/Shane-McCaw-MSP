using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #2195 — the Floating Chat Window's side dock: one synthesized "what's actually pending
    /// in this chat right now" view, built entirely in code the same way <see cref="GitDetailView"/>
    /// and <see cref="LeftSidebar"/>'s hover-popup relationship lists are (no separate .xaml — matches
    /// this codebase's existing pattern for a small, self-contained, data-driven panel).
    ///
    /// Two sections, per #2035's 2026-08-31 16:05/16:07 dock-direction comments: active pinned
    /// questions (#2104/#2105) on top, then the live-filtered mentioned-issue relationship map
    /// (#2066 joined with real GitHub state via <see cref="ChatDockService"/>) below. Rendering only
    /// — all data merge/filter/chain-walk logic lives in <see cref="ChatDockService"/>; this control
    /// never talks to the DB or GitHub itself, it just draws whatever <see cref="Render"/> is given.
    /// </summary>
    public class ChatDockPanel : UserControl
    {
        private readonly StackPanel _root;

        public ChatDockPanel()
        {
            _root = new StackPanel { Margin = new Thickness(8, 8, 8, 8) };
            Content = new ScrollViewer
            {
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
                Content = _root,
            };
        }

        /// <param name="data">The merged/filtered/chain-walked snapshot from <see cref="ChatDockService"/>.</param>
        /// <param name="dismissed">Git #2682 — the container's session-only dismissed set (raw
        /// <see cref="ChatDockItem.Number"/> strings). Filtered out here rather than upstream so a
        /// Dismiss click can re-render instantly against the same already-fetched <paramref name="data"/>,
        /// no new GitHub round-trip.</param>
        /// <param name="onOpenIssue">Real in-app "jump to" action — opens/focuses a real Git detail
        /// tab via <c>MainWindow.OpenGitDetailByNumberAsync</c> (Git #2682 — previously shelled out to
        /// a browser via Process.Start).</param>
        /// <param name="onResolvePin">Sends <c>text</c> into THIS chat (the one the dock is attached
        /// to) and, on a confirmed send, resolves the pin — reuses the exact #2059/#2072 insert+submit
        /// bridge already proven for the pin card in <c>LeftSidebar.BuildPinnedQuestionCard</c>, just
        /// targeting the active tab directly instead of resolving a chat by conversation id first.</param>
        /// <param name="onDispatch">Git #2682 — re-dispatches this item through the same real
        /// <c>IssueDispatchService</c> path <c>DispatchPanel</c> uses (extracted from it, not a second
        /// invented mechanism). Returns the human status string to show inline on the card.</param>
        /// <param name="onDismiss">Git #2682 — adds this item to the container's <c>_dismissed</c> set
        /// and re-renders; the item drops out of view immediately.</param>
        /// <param name="onSendToDiscuss">Git #2682 — drafts a real, useful message referencing this
        /// item into the chat's own composer via <c>MainWindow.SendToChatAsync</c> (never auto-sent,
        /// same draft convention every other tool here follows).</param>
        public void Render(
            ChatDockData data,
            ISet<string> dismissed,
            Action<int> onOpenIssue,
            Func<PinnedQuestion, string, Task<bool>> onResolvePin,
            Func<ChatDockItem, Task<string>> onDispatch,
            Action<ChatDockItem> onDismiss,
            Action<ChatDockItem> onSendToDiscuss)
        {
            _root.Children.Clear();
            data ??= ChatDockData.Empty;
            dismissed ??= new HashSet<string>();
            var visibleItems = data.Items.Where(i => !dismissed.Contains(i.Number.ToString())).ToList();

            _root.Children.Add(new TextBlock
            {
                Text = "Pending in this chat",
                FontSize = 12,
                FontWeight = FontWeights.Bold,
                Foreground = GetBrush("TextBrush"),
                Margin = new Thickness(2, 0, 0, 8),
            });

            if (!data.GitHubReachable)
            {
                _root.Children.Add(new Border
                {
                    Background = GetBrush("SurfaceMuted", "#332B2340"),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(8, 5, 8, 5),
                    Margin = new Thickness(0, 0, 0, 8),
                    Child = new TextBlock
                    {
                        Text = $"⚠ GitHub unreachable this pass ({data.GitHubError ?? "unknown error"}) — showing every mentioned issue as still-relevant rather than dropping any.",
                        FontSize = 10.5,
                        TextWrapping = TextWrapping.Wrap,
                        Foreground = GetBrush("PeachBrush"),
                    },
                });
            }

            if (data.PinnedQuestions.Count > 0)
            {
                _root.Children.Add(SectionHeader("📌 Outstanding questions"));
                foreach (var pq in data.PinnedQuestions)
                    _root.Children.Add(BuildPinnedQuestionCard(pq, onResolvePin));
            }

            _root.Children.Add(SectionHeader("🔗 Mentioned issues, still actionable"));
            if (visibleItems.Count == 0)
            {
                _root.Children.Add(new TextBlock
                {
                    Text = data.PinnedQuestions.Count == 0
                        ? "Nothing pending in this chat right now."
                        : "No still-open mentioned issues in this chat right now.",
                    FontSize = 11,
                    FontStyle = FontStyles.Italic,
                    Foreground = GetBrush("Subtext0Brush"),
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(2, 0, 0, 4),
                });
                return;
            }

            foreach (var item in visibleItems)
                _root.Children.Add(BuildItemCard(item, onOpenIssue, onDispatch, onDismiss, onSendToDiscuss));
        }

        private TextBlock SectionHeader(string text) => new TextBlock
        {
            Text = text,
            FontSize = 10.5,
            FontWeight = FontWeights.Bold,
            Foreground = GetBrush("Subtext1Brush"),
            Margin = new Thickness(2, 6, 0, 4),
        };

        private Border BuildItemCard(
            ChatDockItem item,
            Action<int> onOpenIssue,
            Func<ChatDockItem, Task<string>> onDispatch,
            Action<ChatDockItem> onDismiss,
            Action<ChatDockItem> onSendToDiscuss)
        {
            var card = new Border
            {
                Background = GetBrush("Surface0Brush"),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 0, 0, 6),
            };
            var content = new StackPanel();

            var headerRow = new Grid();
            headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var headerBtn = new Button
            {
                Content = $"#{item.Number} — {item.Title}",
                HorizontalContentAlignment = HorizontalAlignment.Left,
                Padding = new Thickness(0),
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = GetBrush("BlueBrush"),
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                Cursor = System.Windows.Input.Cursors.Hand,
                HorizontalAlignment = HorizontalAlignment.Left,
                ToolTip = "Open on GitHub",
            };
            headerBtn.Click += (s, e) => onOpenIssue(item.Number);
            Grid.SetColumn(headerBtn, 0);
            headerRow.Children.Add(headerBtn);

            if (item.StateUnknown)
            {
                var unknownBadge = new TextBlock
                {
                    Text = "state unknown",
                    FontSize = 9.5,
                    Foreground = GetBrush("PeachBrush"),
                    VerticalAlignment = VerticalAlignment.Center,
                };
                Grid.SetColumn(unknownBadge, 1);
                headerRow.Children.Add(unknownBadge);
            }
            content.Children.Add(headerRow);

            if (!string.IsNullOrWhiteSpace(item.BoardStatus))
            {
                content.Children.Add(new Border
                {
                    Background = GetBrush("Surface1Brush"),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(5, 1, 5, 1),
                    Margin = new Thickness(0, 3, 0, 0),
                    HorizontalAlignment = HorizontalAlignment.Left,
                    Child = new TextBlock
                    {
                        Text = item.BoardStatus,
                        FontSize = 9.5,
                        Foreground = GetBrush("Subtext1Brush"),
                    },
                });
            }

            if (item.HasChain)
            {
                var chainPanel = new StackPanel { Margin = new Thickness(0, 6, 0, 0) };
                AddChainDirection(chainPanel, "🔒 Blocked by", item.BlockedBy, onOpenIssue);
                AddChainDirection(chainPanel, "⛔ Blocks", item.Blocks, onOpenIssue);
                content.Children.Add(chainPanel);
            }

            var actionStatus = new TextBlock
            {
                FontSize = 9.5,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 4, 0, 0),
                Visibility = Visibility.Collapsed,
            };

            var actionRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 0) };

            var dispatchBtn = SmallActionButton("Dispatch", "Re-dispatch this issue through the real build queue (same path as the Dispatch panel)");
            dispatchBtn.Click += async (s, e) =>
            {
                dispatchBtn.IsEnabled = false;
                actionStatus.Text = "Dispatching…";
                actionStatus.Foreground = GetBrush("Subtext0Brush");
                actionStatus.Visibility = Visibility.Visible;
                try
                {
                    var status = await onDispatch(item);
                    actionStatus.Text = status;
                    actionStatus.Foreground = GetBrush(status.StartsWith("Dispatch failed", StringComparison.OrdinalIgnoreCase) ? "RedBrush" : "GreenBrush");
                }
                catch (Exception ex)
                {
                    actionStatus.Text = $"Dispatch failed: {ex.Message}";
                    actionStatus.Foreground = GetBrush("RedBrush");
                }
                finally
                {
                    dispatchBtn.IsEnabled = true;
                }
            };
            actionRow.Children.Add(dispatchBtn);

            var dismissBtn = SmallActionButton("Dismiss", "Hide this card for the rest of the session");
            dismissBtn.Click += (s, e) => onDismiss(item);
            actionRow.Children.Add(dismissBtn);

            var discussBtn = SmallActionButton("Send to discuss", "Draft a message referencing this issue into this chat's composer");
            discussBtn.Click += (s, e) => onSendToDiscuss(item);
            actionRow.Children.Add(discussBtn);

            content.Children.Add(actionRow);
            content.Children.Add(actionStatus);

            card.Child = content;
            return card;
        }

        private Button SmallActionButton(string label, string toolTip) => new Button
        {
            Content = label,
            FontSize = 10,
            Padding = new Thickness(6, 2, 6, 2),
            Margin = new Thickness(0, 0, 4, 0),
            Background = GetBrush("Surface1Brush"),
            Foreground = GetBrush("Subtext1Brush"),
            BorderThickness = new Thickness(0),
            Cursor = System.Windows.Input.Cursors.Hand,
            ToolTip = toolTip,
        };

        /// <summary>Renders one direction's chain as a real depth-indented map, not a flat list — each
        /// hop indents further from the root and carries its own connector bar, so a multi-hop chain
        /// (root → #2002 → #2005) reads as a genuine path instead of an unordered dump. A still-open
        /// edge gets the "jump to blocker" action per #2030's ask; a closed edge (which stopped the
        /// walk from going further through it) is shown muted with no action.</summary>
        private void AddChainDirection(StackPanel container, string label, List<ChatDockEdge> edges, Action<int> onOpenIssue)
        {
            if (edges == null || edges.Count == 0) return;

            container.Children.Add(new TextBlock
            {
                Text = label,
                FontSize = 10,
                FontWeight = FontWeights.Bold,
                Foreground = GetBrush("Subtext0Brush"),
                Margin = new Thickness(0, 4, 0, 2),
            });

            foreach (var edge in edges.OrderBy(e => e.Depth))
            {
                var row = new Grid { Margin = new Thickness(10 * edge.Depth, 0, 0, 2) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                row.Children.Add(new Border
                {
                    Width = 2,
                    Background = edge.IsClosed ? GetBrush("Subtext0Brush") : GetBrush("RedBrush"),
                    Margin = new Thickness(0, 1, 6, 1),
                    VerticalAlignment = VerticalAlignment.Stretch,
                });

                var text = new TextBlock
                {
                    Text = $"#{edge.Number} — {edge.Title}",
                    FontSize = 10.5,
                    TextWrapping = TextWrapping.Wrap,
                    Foreground = edge.IsClosed ? GetBrush("Subtext0Brush") : GetBrush("RedBrush"),
                    VerticalAlignment = VerticalAlignment.Center,
                };
                Grid.SetColumn(text, 1);
                row.Children.Add(text);

                if (!edge.IsClosed)
                {
                    var jumpBtn = new Button
                    {
                        Content = "↗",
                        FontSize = 10,
                        Padding = new Thickness(4, 0, 4, 0),
                        Margin = new Thickness(4, 0, 0, 0),
                        ToolTip = $"Open #{edge.Number} on GitHub",
                        Background = Brushes.Transparent,
                        BorderThickness = new Thickness(0),
                        Foreground = GetBrush("Subtext1Brush"),
                        Cursor = System.Windows.Input.Cursors.Hand,
                    };
                    int num = edge.Number;
                    jumpBtn.Click += (s, e) => onOpenIssue(num);
                    Grid.SetColumn(jumpBtn, 2);
                    row.Children.Add(jumpBtn);
                }

                container.Children.Add(row);
            }
        }

        private Border BuildPinnedQuestionCard(PinnedQuestion pq, Func<PinnedQuestion, string, Task<bool>> onResolvePin)
        {
            var card = new Border
            {
                Background = GetBrush("Surface0Brush"),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 0, 0, 6),
            };
            var content = new StackPanel();

            content.Children.Add(new TextBlock
            {
                Text = pq.QuestionText,
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Foreground = GetBrush("TextBrush"),
                Margin = new Thickness(0, 0, 0, 6),
            });

            var replyRow = new Grid();
            replyRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            replyRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var replyBox = new TextBox
            {
                Height = 26,
                FontSize = 11,
                Padding = new Thickness(6, 4, 6, 4),
                VerticalContentAlignment = VerticalAlignment.Center,
                Background = GetBrush("MantleBrush"),
                Foreground = GetBrush("TextBrush"),
                BorderBrush = GetBrush("Surface1Brush"),
            };
            Grid.SetColumn(replyBox, 0);
            replyRow.Children.Add(replyBox);

            var sendBtn = new Button
            {
                Content = "Reply",
                Style = TryFindResource("PrimaryButton") as Style,
                Padding = new Thickness(10, 3, 10, 3),
                Margin = new Thickness(4, 0, 0, 0),
            };
            Grid.SetColumn(sendBtn, 1);
            replyRow.Children.Add(sendBtn);
            content.Children.Add(replyRow);

            var inlineStatus = new TextBlock
            {
                FontSize = 10,
                Margin = new Thickness(0, 4, 0, 0),
                TextWrapping = TextWrapping.Wrap,
                Visibility = Visibility.Collapsed,
            };
            content.Children.Add(inlineStatus);

            sendBtn.Click += async (s, e) =>
            {
                var text = replyBox.Text?.Trim() ?? "";
                if (string.IsNullOrEmpty(text)) return;

                sendBtn.IsEnabled = false;
                replyBox.IsEnabled = false;
                try
                {
                    bool resolved = await onResolvePin(pq, text);
                    if (!resolved)
                    {
                        inlineStatus.Text = "Send failed — try again, or reply in the chat directly.";
                        inlineStatus.Foreground = GetBrush("RedBrush");
                        inlineStatus.Visibility = Visibility.Visible;
                        sendBtn.IsEnabled = true;
                        replyBox.IsEnabled = true;
                    }
                    // On success the caller re-renders the dock (the pin is gone), nothing more to do here.
                }
                catch (Exception ex)
                {
                    inlineStatus.Text = $"Send failed: {ex.Message}";
                    inlineStatus.Foreground = GetBrush("RedBrush");
                    inlineStatus.Visibility = Visibility.Visible;
                    sendBtn.IsEnabled = true;
                    replyBox.IsEnabled = true;
                }
            };

            card.Child = content;
            return card;
        }

        private Brush GetBrush(string key, string fallbackHex = "#FFFFFF")
        {
            try
            {
                if (TryFindResource(key) is Brush found) return found;
                if (Application.Current != null && Application.Current.TryFindResource(key) is Brush appB) return appB;
            }
            catch { }
            try { return (Brush)new BrushConverter().ConvertFromString(fallbackHex)!; }
            catch { return Brushes.White; }
        }
    }
}
