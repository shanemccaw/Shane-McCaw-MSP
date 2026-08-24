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
    /// the editor panes): when collapsed it's parked 1x1 far OFF-screen (still laid
    /// out, still alive — see <see cref="ParkOffscreen"/>); when expanded it's grown
    /// back to full size at 0,0 over the panes. The size change on collapse is
    /// load-bearing: a WebView2's HwndHost surface only reliably repositions when its
    /// SIZE changes, so a bare off-screen Canvas translate can leave the live surface
    /// painted over the panes (that was the "collapsed LinkedIn covers the editor"
    /// bug). Nothing is ever reparented while pinned, so the session just keeps
    /// running the whole time — a collapse/expand only reflows the page, never reloads.
    ///
    /// Isolated in its own partial-class file to stay out of the way of the
    /// concurrently-edited MainWindow.xaml.cs (#893/#894/#921 pattern).
    /// </summary>
    public partial class MainWindow
    {
        private const string PinnedChannel = "tabs.pinned";

        // A collapsed host is parked far off-screen in BOTH axes AND shrunk to a
        // 1x1 footprint. The size change is the load-bearing part: a WebView2 is an
        // HwndHost whose hosted surface only reliably repositions when its SIZE
        // changes — a bare Canvas.SetLeft translate can leave the live surface
        // painted at its last on-screen spot (that was the "collapsed LinkedIn
        // covers the panes" bug). 1x1 is nonzero, so CoreWebView2 stays alive and
        // the session never reloads — the exact keep-alive trick ReplitWatcherWebView
        // / UsageMeterWebView (#902) rely on. z-order can't help here: an HwndHost
        // always paints over WPF content, so getting it out of view is the only lever.
        private const double PinnedOffscreenX = -20000d;
        private const double PinnedOffscreenY = -20000d;
        private const double PinnedCollapsedSize = 1d;

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
                Child = hostGrid
            };
            PinnedHostCanvas.Children.Add(entry.HostBorder);
            ParkOffscreen(entry.HostBorder); // start collapsed: 1x1, off-screen, alive

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

            // Park it 1x1 off-screen — the SIZE change (full -> 1x1) is what forces
            // the WebView2's HwndHost surface to actually leave view; a bare
            // Canvas.SetLeft translate would leave the live surface painted over the
            // panes (that was the covering bug). Still in the tree at nonzero size, so
            // CoreWebView2 keeps running and the session stays logged in (not reloaded).
            ParkOffscreen(entry.HostBorder);

            entry.Expanded = false;
            if (_expandedPinned == entry) _expandedPinned = null;
            if (_expandedPinned == null) PinnedHostCanvas.IsHitTestVisible = false;

            UpdateStripButtonState(entry);
            ActivityLog.Log(PinnedChannel,
                $"collapsed: {entry.Label} ({entry.Tag}) -> parked off-screen at " +
                $"({PinnedOffscreenX},{PinnedOffscreenY}) size {PinnedCollapsedSize}x{PinnedCollapsedSize}");
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
            closeBtn.Click += (s, e) => CloseTab(tab, pane);
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
            // Only the currently-expanded host tracks the canvas size. Collapsed
            // hosts must stay at their 1x1 off-screen park — re-inflating them to
            // full size (even off-screen) would resurrect the airspace covering
            // risk, and they don't need real extents while genuinely out of view.
            if (_expandedPinned != null) SizePinnedBorder(_expandedPinned.HostBorder);
        }

        // Fill the canvas (used when a host is expanded over the panes).
        private void SizePinnedBorder(Border host)
        {
            if (PinnedHostCanvas.ActualWidth > 0) host.Width = PinnedHostCanvas.ActualWidth;
            if (PinnedHostCanvas.ActualHeight > 0) host.Height = PinnedHostCanvas.ActualHeight;
        }

        // Park a host genuinely out of view but alive: shrink to 1x1 and move
        // off-screen in both axes. The size change forces the WebView2's HwndHost
        // surface to update its rendering bounds and follow us off-screen; 1x1 is
        // nonzero so CoreWebView2 is never torn down (session stays warm/logged in).
        private void ParkOffscreen(Border host)
        {
            host.Width = PinnedCollapsedSize;
            host.Height = PinnedCollapsedSize;
            Canvas.SetLeft(host, PinnedOffscreenX);
            Canvas.SetTop(host, PinnedOffscreenY);
            Panel.SetZIndex(host, 0);
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
