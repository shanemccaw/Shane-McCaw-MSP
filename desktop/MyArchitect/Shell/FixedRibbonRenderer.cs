using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using Button = Fluent.Button;
using RibbonGroupBox = Fluent.RibbonGroupBox;
using RibbonTabItem = Fluent.RibbonTabItem;
using DropDownButton = Fluent.DropDownButton;
using RibbonControlSize = Fluent.RibbonControlSize;

namespace MyArchitect.Shell;

/// <summary>
/// Renders <see cref="ShellRegistry"/>'s fixed-tab groups and the active contextual tab onto a
/// real <c>Fluent:Ribbon</c> control (UI_RULES.md §1 — Fluent.Ribbon, not the built-in
/// <c>System.Windows.Controls.Ribbon</c>). The shell owns assembly here exactly as SHELL.md
/// describes: a Feature registers groups through <see cref="ShellRegistry"/>; this class is the
/// only thing that turns those specs into real Ribbon controls.
/// </summary>
public sealed class FixedRibbonRenderer
{
    private readonly Fluent.Ribbon _ribbon;
    private readonly ShellRegistry _registry;
    private readonly Dictionary<FixedTab, RibbonTabItem> _fixedTabs = new();
    private RibbonTabItem? _contextualTabItem;

    public FixedRibbonRenderer(Fluent.Ribbon ribbon, ShellRegistry registry)
    {
        _ribbon = ribbon;
        _registry = registry;

        foreach (FixedTab tab in Enum.GetValues<FixedTab>())
        {
            var item = new RibbonTabItem { Header = tab.ToString() };
            _fixedTabs[tab] = item;
            _ribbon.Tabs.Add(item);
        }

        _registry.Changed += RenderAllFixedTabs;
        _registry.ContextualTabChanged += RenderContextualTab;

        RenderAllFixedTabs();
        _ribbon.SelectedTabIndex = 0;
    }

    private void RenderAllFixedTabs()
    {
        foreach (var (tab, item) in _fixedTabs)
        {
            RenderFixedTab(tab, item);
        }
    }

    private void RenderFixedTab(FixedTab tab, RibbonTabItem item)
    {
        item.Groups.Clear();
        var groups = _registry.GetFixedTabGroups(tab);

        if (groups.Count == 0)
        {
            // SHELL.md §6: a stated empty state, never an empty box or fake content.
            var empty = new RibbonGroupBox { Header = "Nothing registered yet" };
            empty.Items.Add(new System.Windows.Controls.TextBlock
            {
                Text = "No Feature has contributed to this tab yet.",
                Foreground = System.Windows.Media.Brushes.Gray,
                FontSize = 11,
                Margin = new Thickness(6),
            });
            item.Groups.Add(empty);
            return;
        }

        foreach (var group in groups.OrderBy(g => g.Order))
        {
            item.Groups.Add(BuildGroupBox(group));
        }
    }

    private static RibbonGroupBox BuildGroupBox(RibbonGroupSpec spec)
    {
        var box = new RibbonGroupBox { Header = spec.Label };

        foreach (var cmd in spec.Large)
        {
            box.Items.Add(BuildCommand(cmd, RibbonControlSize.Large));
        }
        foreach (var cmd in spec.Small)
        {
            box.Items.Add(BuildCommand(cmd, RibbonControlSize.Small));
        }

        return box;
    }

    private static FrameworkElement BuildCommand(RibbonCommandSpec cmd, RibbonControlSize size)
    {
        if (cmd.Gallery is { } gallery)
        {
            return BuildGalleryButton(cmd, gallery, size);
        }

        var label = cmd.LiveCount is { } liveCount ? $"{cmd.Label} ({liveCount()})" : cmd.Label;
        var btn = new Button
        {
            Header = label,
            Size = size,
            ToolTip = cmd.ToolTip ?? cmd.Label,
        };
        if (cmd.LiveCountAsync is { } liveCountAsync)
        {
            PopulateLiveCountAsync(btn, cmd, liveCountAsync);
        }
        btn.Click += (_, _) => cmd.OnSelect();
        return btn;
    }

    // #3564 — async count source (a network-backed live-count badge) loads without a synchronous
    // .GetAwaiter().GetResult() freezing the UI thread on every ShellRegistry.RefreshLiveCounts
    // (fired on each real SSE push, plus every fixed-tab (re)registration). async void is
    // deliberate and safe here for the same reason as BuildGalleryButton's PopulateAsync below:
    // the whole body is guarded, nothing escapes as an unhandled async void crash. The underlying
    // count methods already catch-and-return-0 on failure (their own honest "couldn't reach it
    // right now" contract), so the catch here is a defensive backstop, not the primary guard.
    private static async void PopulateLiveCountAsync(Button btn, RibbonCommandSpec cmd, Func<System.Threading.Tasks.Task<int>> liveCountAsync)
    {
        try
        {
            var count = await liveCountAsync().ConfigureAwait(true);
            btn.Header = $"{cmd.Label} ({count})";
        }
        catch
        {
            // Leave the plain label — a transient failure here shouldn't relabel the button.
        }
    }

    private static FrameworkElement BuildGalleryButton(RibbonCommandSpec cmd, GallerySpec gallery, RibbonControlSize size)
    {
        var dropDown = new DropDownButton
        {
            Header = cmd.Label,
            Size = size,
            ToolTip = gallery.Title,
        };

        void RenderRows(IReadOnlyList<GalleryRowSpec> rows)
        {
            dropDown.Items.Clear();
            if (rows.Count == 0)
            {
                dropDown.Items.Add(new System.Windows.Controls.MenuItem
                {
                    Header = "Nothing here yet",
                    IsEnabled = false,
                });
                return;
            }

            foreach (var row in rows)
            {
                var header = new System.Windows.Controls.StackPanel();
                header.Children.Add(new System.Windows.Controls.TextBlock
                {
                    Text = row.Tile != null ? $"[{row.Tile}] {row.Name}" : row.Name,
                    FontWeight = row.IsCurrent ? System.Windows.FontWeights.Bold : System.Windows.FontWeights.Normal,
                });
                if (!string.IsNullOrEmpty(row.Sub))
                {
                    header.Children.Add(new System.Windows.Controls.TextBlock
                    {
                        Text = row.Sub,
                        FontSize = 10,
                        Foreground = System.Windows.Media.Brushes.Gray,
                    });
                }

                var menuItem = new System.Windows.Controls.MenuItem { Header = header };
                var onSelect = row.OnSelect;
                menuItem.Click += (_, _) => onSelect();
                dropDown.Items.Add(menuItem);
            }
        }

        // #3554 — async row source (a network-backed gallery) loads without a synchronous
        // .GetAwaiter().GetResult() freezing the UI thread. Show a transient "Loading…" row, then
        // swap in real rows. async void is deliberate and safe here: this is a UI event handler and
        // the whole body is guarded — anything it could throw is caught and rendered as an error
        // row, never escaping to become an unhandled async void crash (the class of bug #3554 exists
        // to close). It also composes with App.xaml.cs's global handler as a second line of defence.
        async void PopulateAsync()
        {
            dropDown.Items.Clear();
            dropDown.Items.Add(new System.Windows.Controls.MenuItem { Header = "Loading…", IsEnabled = false });
            IReadOnlyList<GalleryRowSpec> rows;
            try
            {
                rows = await gallery.GetRowsAsync!().ConfigureAwait(true);
            }
            catch (Exception ex)
            {
                dropDown.Items.Clear();
                dropDown.Items.Add(new System.Windows.Controls.MenuItem
                {
                    Header = $"Could not load: {ex.Message}",
                    IsEnabled = false,
                });
                return;
            }
            RenderRows(rows);
        }

        void Populate()
        {
            if (gallery.GetRowsAsync != null)
            {
                PopulateAsync();
                return;
            }

            // real data rows, not labels (UI_RULES.md §4)
            var rows = gallery.GetRows?.Invoke() ?? (IReadOnlyList<GalleryRowSpec>)Array.Empty<GalleryRowSpec>();
            RenderRows(rows);
        }

        // #3564 — deferred to first real dropdown-open, not fetched here at button-construction
        // time. RenderAllFixedTabs rebuilds every fixed-tab button on every ShellRegistry.Changed
        // (every RegisterFixedTabGroup call at startup, plus every real SSE push, #3490) — eagerly
        // calling Populate() here fired one real HTTP request per registered gallery on every one
        // of those rebuilds, whether or not the operator ever opened the dropdown. Populate() is
        // still synchronous-safe to call from DropDownOpened (a real user action) — it now just
        // isn't called until then.
        dropDown.DropDownOpened += (_, _) => Populate();
        return dropDown;
    }

    /// <summary>Splices the shell-owned Back group into the active contextual tab and selects
    /// it. Passing null removes whatever contextual tab is currently showing.</summary>
    private void RenderContextualTab(ContextualTabSpec? spec)
    {
        if (_contextualTabItem != null)
        {
            _ribbon.Tabs.Remove(_contextualTabItem);
            _contextualTabItem = null;
        }

        if (spec == null) return;

        // IsContextual is read-only on RibbonTabItem (computed from membership in a
        // RibbonContextualTabGroup); the shell's own contextual-tab identity is the Back-group
        // splice + trail mechanism, not that visual grouping, so this is a plain tab.
        var item = new RibbonTabItem { Header = spec.Label };
        foreach (var group in spec.Groups)
        {
            item.Groups.Add(BuildGroupBox(group));
        }

        _ribbon.Tabs.Add(item);
        _contextualTabItem = item;
        _ribbon.SelectedTabItem = item;
    }
}
