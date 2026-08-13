using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Editor Tab "Pinned" state (Epic #803) — Shane: pin a tab so it stops
    /// eating normal tab space and instead collapses to a small always-visible
    /// strip item (icon + short label), yet stays genuinely alive in the
    /// background (its WebView2 session keeps running, not suspended) and opens
    /// back to full view with one click.
    ///
    /// The keep-alive trick is the same HwndHost rule ReplitWatcherWebView (#902)
    /// already relies on: a WebView2 is an HwndHost, so Visibility=Hidden/Collapsed
    /// (or a zero size) tears down / never creates the CoreWebView2 controller.
    /// The ONLY way to keep the session truly loaded while it's off-view is to keep
    /// the control in the visual tree, visible, at a nonzero size. So each pinned
    /// tab's content lives permanently in <c>PinnedHostCanvas</c> (an overlay over
    /// the editor panes): when collapsed it's slid far OFF-screen at full size
    /// (still laid out, still alive); when expanded it's slid back to 0,0 over the
    /// panes. Nothing is ever reparented while pinned, so there is zero WebView2
    /// churn/reflow between collapse and expand — the LinkedIn session just keeps
    /// running the whole time.
    ///
    /// Isolated in its own partial-class file to stay out of the way of the
    /// concurrently-edited MainWindow.xaml.cs (#893/#894/#921 pattern).
    /// </summary>
    public partial class MainWindow
    {
        private const string PinnedChannel = "tabs.pinned";

        // Far enough left that the whole content Border is clipped away on every
        // realistic monitor arrangement, while the control stays in the tree at
        // full size so CoreWebView2 keeps running.
        private const double PinnedOffscreenX = -20000d;

        // Sensible default so a freshly-seeded pinned WebView2 has a nonzero size
        // (and therefore a live controller) before the first PinnedHostCanvas
        // layout pass runs; SizeChanged then keeps it matched to the real bounds.
        private const double PinnedDefaultWidth = 1280d;
        private const double PinnedDefaultHeight = 800d;

        private sealed class PinnedTabEntry
        {
            public string Tag = "";
            public string Label = "";
            public string Glyph = "";
            public FrameworkElement Content = null!;   // the tab's real content (e.g. OpenWebTab's webContainer)
            public Grid ContentSlot = null!;           // holds Content inside HostBorder
            public Border HostBorder = null!;          // parked in PinnedHostCanvas; top bar + ContentSlot
            public TextBlock TitleText = null!;        // the expanded top-bar title
            public Button StripButton = null!;         // the always-visible strip item (null when the entry is fronted only by a header chip)
            public Button? ChipButton;                 // the EDITOR PANES header-bar chip fronting this entry (Git #972 revised), if any
            public bool Expanded;
        }

        private readonly List<PinnedTabEntry> _pinnedEntries = new();
        private PinnedTabEntry? _expandedPinned;

        // ── Public / menu entry points ──────────────────────────────────────

        /// <summary>Pin an existing editor tab: pull it out of its pane, park its
        /// live content off-screen in the keep-alive canvas, and add a strip item.
        /// Called from the tab context menu ("Pin Tab").</summary>
        internal void PinTabFromMenu(TabItem tabItem)
        {
            if (tabItem == null) return;

            var (glyph, label) = ExtractHeaderText(tabItem);
            string tag = tabItem.Tag?.ToString() ?? label;

            // Already pinned under this tag? Just focus it.
            var existing = _pinnedEntries.FirstOrDefault(e => e.Tag == tag);
            if (existing != null)
            {
                var ownerDup = tabItem.Parent as TabControl;
                ownerDup?.Items.Remove(tabItem);
                ExpandPinned(existing);
                return;
            }

            if (tabItem.Content is not FrameworkElement content) return;

            // Detach the content from the TabItem, then drop the tab from its pane.
            tabItem.Content = null;
            var owner = tabItem.Parent as TabControl;
            owner?.Items.Remove(tabItem);

            RegisterPinnedEntry(content, tag, label, glyph, startExpanded: false);
            ActivityLog.Log(PinnedChannel, $"pinned: {label} ({tag})");
        }

        // ── Core registration (shared by menu-pin and the seeded LinkedIn) ──

        private PinnedTabEntry RegisterPinnedEntry(FrameworkElement content, string tag, string label, string glyph, bool startExpanded, bool addToStrip = true)
        {
            var entry = new PinnedTabEntry { Tag = tag, Label = label, Glyph = glyph, Content = content };

            // Content slot (fills below the top bar).
            entry.ContentSlot = new Grid();
            entry.ContentSlot.Children.Add(content);

            // Expanded top bar: title + collapse-to-strip + unpin.
            var titleText = new TextBlock
            {
                Text = string.IsNullOrEmpty(glyph) ? label : $"{glyph}  {label}",
                FontSize = 13,
                FontWeight = FontWeights.SemiBold,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(8, 0, 8, 0),
                Foreground = (Brush)FindResource("TextBrush")
            };
            entry.TitleText = titleText;

            var btnCollapse = new Button
            {
                Content = new TextBlock { Text = "", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12 }, // ChevronDown - collapse to strip
                Style = (Style)FindResource("IconButton"),
                Width = 28, Height = 26, Margin = new Thickness(2, 0, 2, 0),
                ToolTip = "Collapse to pinned strip (keeps running)"
            };
            btnCollapse.Click += (s, e) => CollapsePinned(entry);

            var btnUnpin = new Button
            {
                Content = new TextBlock { Text = "", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12 }, // Unpin glyph
                Style = (Style)FindResource("IconButton"),
                Width = 28, Height = 26, Margin = new Thickness(2, 0, 6, 0),
                ToolTip = "Unpin — restore as a normal tab"
            };
            btnUnpin.Click += (s, e) => UnpinEntry(entry);

            var topBarInner = new DockPanel { LastChildFill = true };
            var rightButtons = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            rightButtons.Children.Add(btnCollapse);
            rightButtons.Children.Add(btnUnpin);
            DockPanel.SetDock(rightButtons, Dock.Right);
            topBarInner.Children.Add(rightButtons);
            topBarInner.Children.Add(titleText);

            var topBar = new Border
            {
                Height = 30,
                Background = (Brush)FindResource("MantleBrush"),
                BorderBrush = (Brush)FindResource("Surface1Brush"),
                BorderThickness = new Thickness(0, 0, 0, 1),
                Child = topBarInner
            };

            var hostGrid = new Grid();
            hostGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            hostGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            Grid.SetRow(topBar, 0);
            Grid.SetRow(entry.ContentSlot, 1);
            hostGrid.Children.Add(topBar);
            hostGrid.Children.Add(entry.ContentSlot);

            entry.HostBorder = new Border
            {
                Background = (Brush)FindResource("BaseBrush"),
                Child = hostGrid,
                Width = PinnedHostCanvas.ActualWidth > 0 ? PinnedHostCanvas.ActualWidth : PinnedDefaultWidth,
                Height = PinnedHostCanvas.ActualHeight > 0 ? PinnedHostCanvas.ActualHeight : PinnedDefaultHeight
            };
            Canvas.SetTop(entry.HostBorder, 0);
            Canvas.SetLeft(entry.HostBorder, PinnedOffscreenX); // start parked off-screen (alive)
            PinnedHostCanvas.Children.Add(entry.HostBorder);

            // Strip item (always visible while pinned) — skipped for header-chip
            // entries (Git #972 revised), which surface via the EDITOR PANES bar
            // instead of the 📌 PINNED strip so they never double up.
            if (addToStrip)
            {
                entry.StripButton = BuildStripButton(entry);
                PinnedStrip.Children.Add(entry.StripButton);
                PinnedStripBar.Visibility = Visibility.Visible;
            }

            _pinnedEntries.Add(entry);

            if (startExpanded) ExpandPinned(entry);
            else UpdateStripButtonState(entry);

            return entry;
        }

        private Button BuildStripButton(PinnedTabEntry entry)
        {
            var panel = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            if (!string.IsNullOrEmpty(entry.Glyph))
            {
                panel.Children.Add(new TextBlock
                {
                    Text = entry.Glyph,
                    FontFamily = new FontFamily("Segoe MDL2 Assets"),
                    FontSize = 12,
                    Margin = new Thickness(0, 0, 5, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = (Brush)FindResource("BlueBrush")
                });
            }
            panel.Children.Add(new TextBlock
            {
                Text = ShortLabel(entry.Label),
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("TextBrush")
            });

            var btn = new Button
            {
                Content = panel,
                Style = (Style)FindResource("IconButton"),
                Padding = new Thickness(8, 3, 8, 3),
                Margin = new Thickness(0, 0, 6, 0),
                ToolTip = $"{entry.Label} — click to open (session stays alive in the background)"
            };
            btn.Click += (s, e) => TogglePinned(entry);

            // Right-click menu: explicit expand / collapse / unpin.
            var cm = new ContextMenu();
            var miOpen = new MenuItem { Header = "Open (Full View)" };
            miOpen.Click += (s, e) => ExpandPinned(entry);
            var miCollapse = new MenuItem { Header = "Collapse" };
            miCollapse.Click += (s, e) => CollapsePinned(entry);
            var miUnpin = new MenuItem { Header = "Unpin (restore as tab)" };
            miUnpin.Click += (s, e) => UnpinEntry(entry);
            cm.Items.Add(miOpen);
            cm.Items.Add(miCollapse);
            cm.Items.Add(new Separator());
            cm.Items.Add(miUnpin);
            btn.ContextMenu = cm;

            return btn;
        }

        // ── Expand / collapse / toggle ──────────────────────────────────────

        private void TogglePinned(PinnedTabEntry entry)
        {
            if (entry.Expanded) CollapsePinned(entry);
            else ExpandPinned(entry);
        }

        private void ExpandPinned(PinnedTabEntry entry)
        {
            if (entry.Expanded)
            {
                // Already open — nothing to do but keep it frontmost.
                Panel.SetZIndex(entry.HostBorder, 10);
                return;
            }

            // Only one pinned view is shown at a time; tuck any other away first.
            if (_expandedPinned != null && _expandedPinned != entry)
                CollapsePinned(_expandedPinned);

            SizePinnedBorder(entry.HostBorder);
            Canvas.SetLeft(entry.HostBorder, 0);
            Canvas.SetTop(entry.HostBorder, 0);
            Panel.SetZIndex(entry.HostBorder, 10);
            PinnedHostCanvas.IsHitTestVisible = true;

            entry.Expanded = true;
            _expandedPinned = entry;
            UpdateStripButtonState(entry);
            ActivityLog.Log(PinnedChannel, $"expanded: {entry.Label} ({entry.Tag})");
        }

        private void CollapsePinned(PinnedTabEntry entry)
        {
            if (!entry.Expanded) return;

            // Slide off-screen — stays in the tree at full size, so CoreWebView2
            // keeps running and the session stays loaded (not suspended).
            Canvas.SetLeft(entry.HostBorder, PinnedOffscreenX);
            Panel.SetZIndex(entry.HostBorder, 0);

            entry.Expanded = false;
            if (_expandedPinned == entry) _expandedPinned = null;
            if (_expandedPinned == null) PinnedHostCanvas.IsHitTestVisible = false;

            UpdateStripButtonState(entry);
            ActivityLog.Log(PinnedChannel, $"collapsed: {entry.Label} ({entry.Tag})");
        }

        // ── Unpin — restore as a normal editor tab ──────────────────────────

        private void UnpinEntry(PinnedTabEntry entry)
        {
            CollapsePinned(entry);

            // Reparent the still-live content back into a fresh editor tab.
            entry.ContentSlot.Children.Clear();
            var content = entry.Content;

            var pane = _activeEditorPane;
            if (pane == null || pane.Visibility != Visibility.Visible) pane = EditorTabs;

            var header = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            if (!string.IsNullOrEmpty(entry.Glyph))
            {
                header.Children.Add(new TextBlock
                {
                    Text = entry.Glyph,
                    FontFamily = new FontFamily("Segoe MDL2 Assets"),
                    FontSize = 12,
                    Margin = new Thickness(0, 0, 6, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = (Brush)FindResource("BlueBrush")
                });
            }
            header.Children.Add(new TextBlock
            {
                Text = entry.Label,
                FontSize = 13,
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("TextBrush")
            });
            var closeBtn = new Button
            {
                Content = "✕",
                Style = (Style)FindResource("IconButton"),
                FontSize = 10,
                Padding = new Thickness(3, 1, 3, 1),
                Margin = new Thickness(4, 0, 0, 0),
                ToolTip = "Close Tab",
                VerticalAlignment = VerticalAlignment.Center
            };
            header.Children.Add(closeBtn);

            var tab = new TabItem { Tag = entry.Tag, Header = header, Content = content };
            closeBtn.Click += (s, e) =>
            {
                var owner = tab.Parent as TabControl ?? pane;
                owner.Items.Remove(tab);
                if (owner.Items.Count > 0)
                    owner.SelectedIndex = Math.Max(0, owner.Items.Count - 1);
            };
            AttachTabContextMenu(tab, pane);
            AttachTabDragHandlers(tab);
            pane.Items.Add(tab);
            pane.SelectedItem = tab;

            // Tear down the pinned representation.
            PinnedHostCanvas.Children.Remove(entry.HostBorder);
            if (entry.StripButton != null) PinnedStrip.Children.Remove(entry.StripButton);
            if (entry.ChipButton != null) entry.ChipButton.Background = Brushes.Transparent;
            _pinnedEntries.Remove(entry);
            if (PinnedStrip.Children.Count == 0) PinnedStripBar.Visibility = Visibility.Collapsed;

            ActivityLog.Log(PinnedChannel, $"unpinned: {entry.Label} ({entry.Tag})");
        }

        // ── Layout / sizing ─────────────────────────────────────────────────

        private void PinnedHostCanvas_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            foreach (var entry in _pinnedEntries)
                SizePinnedBorder(entry.HostBorder);
        }

        private void SizePinnedBorder(Border host)
        {
            if (PinnedHostCanvas.ActualWidth > 0) host.Width = PinnedHostCanvas.ActualWidth;
            if (PinnedHostCanvas.ActualHeight > 0) host.Height = PinnedHostCanvas.ActualHeight;
        }

        private void UpdateStripButtonState(PinnedTabEntry entry)
        {
            // Subtle highlight so the currently-open pinned item reads as active —
            // on whichever surface fronts it: the 📌 strip item and/or the EDITOR
            // PANES header chip (Git #972 revised).
            var active = entry.Expanded
                ? (Brush)FindResource("Surface1Brush")
                : Brushes.Transparent;
            if (entry.StripButton != null) entry.StripButton.Background = active;
            if (entry.ChipButton != null) entry.ChipButton.Background = active;
        }

        // ── Persistent web chips (Git #972 revised): LinkedIn + Replit ──────
        // Shane, with a screenshot: the empty middle of the EDITOR PANES bar
        // should hold small icon+label chips for always-alive web pages —
        // LinkedIn AND Replit Workspace. Each is seeded at startup as a pinned
        // entry whose WebView2 session lives (off-screen, full size) in
        // PinnedHostCanvas — genuinely running, never suspended — but WITHOUT a
        // 📌 strip item: the header-bar chip is its one-click entry point, so it
        // never takes a tab slot or affects the current pane layout. Clicking the
        // chip expands that live session over the panes; clicking it again tucks
        // it back off-screen. Reuses the exact pinned-session machinery
        // (RegisterPinnedEntry / CreatePinnedWebContent / ExpandPinned) and just
        // relocates the entry point (LinkedIn's included) to this bar.

        /// <summary>Seed both persistent web chips at startup. Deferred to
        /// DispatcherPriority.Loaded by the caller so PinnedHostCanvas has real
        /// layout extents before content mounts. Idempotent per URL. Shares the
        /// app's WebView2 environment (cookies/session) so Shane stays logged in.</summary>
        public void SeedPinnedWebChips()
        {
            SeedPinnedWebChip("https://www.linkedin.com", "LinkedIn", "" /* People */, BtnChipLinkedIn);
            SeedPinnedWebChip("https://replit.com/~", "Replit Workspace", "" /* Code */, BtnChipReplit);
        }

        /// <summary>Seed one persistent web chip: build its live WebView2 content and
        /// register it as a strip-less pinned entry fronted by <paramref name="chip"/>.
        /// Idempotent per URL.</summary>
        private void SeedPinnedWebChip(string url, string label, string glyph, Button chip)
        {
            var existing = _pinnedEntries.FirstOrDefault(e => string.Equals(e.Tag, url, StringComparison.OrdinalIgnoreCase));
            if (existing != null)
            {
                existing.ChipButton = chip;
                UpdateStripButtonState(existing);
                return;
            }

            var content = CreatePinnedWebContent(url);
            var entry = RegisterPinnedEntry(content, url, label, glyph, startExpanded: false, addToStrip: false);
            entry.ChipButton = chip;
            UpdateStripButtonState(entry);
            ActivityLog.Log(PinnedChannel, $"pinned: {label} ({url}) [chip-seeded]");
        }

        // Header-bar chip clicks — open/focus the persistent session (toggle).
        private void PinnedChipLinkedIn_Click(object sender, RoutedEventArgs e)
            => FocusPinnedWebChip("https://www.linkedin.com", "LinkedIn", "", sender as Button);

        private void PinnedChipReplit_Click(object sender, RoutedEventArgs e)
            => FocusPinnedWebChip("https://replit.com/~", "Replit Workspace", "", sender as Button);

        /// <summary>Open/focus a chip's persistent session. Normally the entry was
        /// already seeded at startup (session warm in the background) and this just
        /// slides it over the panes; if it was unpinned/torn down, it is lazily
        /// recreated. Never consumes a tab slot. Clicking an already-open chip tucks
        /// it back off-screen (the session stays alive).</summary>
        private void FocusPinnedWebChip(string url, string label, string glyph, Button? chip)
        {
            var entry = _pinnedEntries.FirstOrDefault(e => string.Equals(e.Tag, url, StringComparison.OrdinalIgnoreCase));
            if (entry == null)
            {
                var content = CreatePinnedWebContent(url);
                entry = RegisterPinnedEntry(content, url, label, glyph, startExpanded: false, addToStrip: false);
                ActivityLog.Log(PinnedChannel, $"pinned: {label} ({url}) [chip]");
            }
            if (chip != null) entry.ChipButton = chip;

            if (entry.Expanded) CollapsePinned(entry);
            else ExpandPinned(entry);

            ActivityLog.Log(PinnedChannel, $"chip-focus: {label} ({url}) expanded={entry.Expanded}");
        }

        /// <summary>Build a self-contained web content panel (nav toolbar + WebView2)
        /// for a pinned entry, without ever creating a TabItem — so the session can
        /// live purely in the keep-alive canvas. Mirrors OpenWebTab's WebView2 setup
        /// (shared env, navigate-once #852 guard).</summary>
        private FrameworkElement CreatePinnedWebContent(string url)
        {
            var wv = new Microsoft.Web.WebView2.Wpf.WebView2();
            wv.NavigationStarting  += WebView_NavigationStarting;
            wv.NavigationCompleted += WebView_NavigationCompleted;
            wv.SourceChanged       += WebView_SourceChanged;

            // Git #852 — navigate exactly once; Loaded re-fires whenever the
            // control is (re)attached to the visual tree.
            bool navigated = false;
            wv.Loaded += async (s, e) =>
            {
                bool ready = await EnsureWebViewInitializedAsync(wv);
                if (ready && !navigated)
                {
                    navigated = true;
                    wv.CoreWebView2.Navigate(url);
                }
            };

            var navBar = new Grid { Background = (Brush)FindResource("MantleBrush"), Height = 34 };
            navBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            navBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            navBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            navBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var btnBack = new Button
            {
                Content = new TextBlock { Text = "", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12 },
                Style = (Style)FindResource("IconButton"),
                Width = 28, Height = 26, Margin = new Thickness(4, 4, 2, 4), ToolTip = "Back"
            };
            btnBack.Click += (s, e) => { if (wv.CanGoBack) wv.GoBack(); };

            var btnForward = new Button
            {
                Content = new TextBlock { Text = "", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12 },
                Style = (Style)FindResource("IconButton"),
                Width = 28, Height = 26, Margin = new Thickness(0, 4, 2, 4), ToolTip = "Forward"
            };
            btnForward.Click += (s, e) => { if (wv.CanGoForward) wv.GoForward(); };

            var btnRefresh = new Button
            {
                Content = new TextBlock { Text = "", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12 },
                Style = (Style)FindResource("IconButton"),
                Width = 28, Height = 26, Margin = new Thickness(0, 4, 6, 4), ToolTip = "Refresh"
            };
            btnRefresh.Click += (s, e) => { try { wv.Reload(); } catch { } };

            var urlBox = new TextBox
            {
                Text = url,
                FontSize = 12,
                Height = 24,
                Margin = new Thickness(0, 5, 6, 5),
                Padding = new Thickness(8, 1, 8, 1),
                VerticalContentAlignment = VerticalAlignment.Center,
                Background = (Brush)FindResource("BaseBrush"),
                Foreground = (Brush)FindResource("TextBrush"),
                BorderThickness = new Thickness(1),
                BorderBrush = (Brush)FindResource("Surface0Brush")
            };
            void Navigate()
            {
                string target = urlBox.Text.Trim();
                if (!target.StartsWith("http://") && !target.StartsWith("https://")) target = "https://" + target;
                try { wv.Source = new Uri(target); } catch { }
            }
            urlBox.KeyDown += (s, e) => { if (e.Key == Key.Enter) Navigate(); };
            wv.SourceChanged += (s, e) => urlBox.Text = wv.Source?.ToString() ?? string.Empty;

            Grid.SetColumn(btnBack, 0);
            Grid.SetColumn(btnForward, 1);
            Grid.SetColumn(btnRefresh, 2);
            Grid.SetColumn(urlBox, 3);
            navBar.Children.Add(btnBack);
            navBar.Children.Add(btnForward);
            navBar.Children.Add(btnRefresh);
            navBar.Children.Add(urlBox);

            var container = new Grid();
            container.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            container.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            Grid.SetRow(navBar, 0);
            Grid.SetRow(wv, 1);
            container.Children.Add(navBar);
            container.Children.Add(wv);
            return container;
        }

        // ── Helpers ─────────────────────────────────────────────────────────

        private static (string glyph, string label) ExtractHeaderText(TabItem tab)
        {
            string glyph = "", label = "";
            if (tab.Header is Panel p)
            {
                foreach (var child in p.Children)
                {
                    if (child is TextBlock tb)
                    {
                        bool isIcon = (tb.FontFamily?.ToString() ?? "").IndexOf("MDL2", StringComparison.OrdinalIgnoreCase) >= 0;
                        if (isIcon)
                        {
                            if (string.IsNullOrEmpty(glyph)) glyph = tb.Text;
                        }
                        else if (string.IsNullOrEmpty(label))
                        {
                            label = tb.Text;
                        }
                    }
                }
            }
            else if (tab.Header is string s)
            {
                label = s;
            }
            if (string.IsNullOrEmpty(label)) label = tab.Tag?.ToString() ?? "Pinned";
            return (glyph, label);
        }

        private static string ShortLabel(string label)
        {
            if (string.IsNullOrEmpty(label)) return "Pinned";
            label = label.Trim();
            return label.Length <= 16 ? label : label.Substring(0, 15) + "…";
        }
    }
}
