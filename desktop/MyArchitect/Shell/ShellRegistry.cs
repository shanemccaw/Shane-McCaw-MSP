using System;
using System.Collections.Generic;
using System.Linq;

namespace MyArchitect.Shell;

/// <summary>
/// The one place a Feature registers ribbon groups, contextual tabs and command-palette entries
/// — the shell owns assembly (fixed-tab order, the Back-group splice, group merging); a Feature
/// only contributes. Mirrors AdminV2's <c>registerScreen</c>/<c>registry.ts</c>
/// (SHELL.md), adapted: this app has one long-lived window rather than per-screen route
/// registration, so registration here is additive and keyed by <see cref="FixedTab"/> rather than
/// by a route id.
///
/// Contract enforcement: <see cref="RegisterFixedTabGroup"/> throws <see cref="ShellContractException"/>
/// the moment a <see cref="RibbonIntent.Record"/> command is registered on a fixed tab — a
/// contract violation is a startup failure here, exactly as it is in AdminV2, not a silent
/// no-op.
/// </summary>
public sealed class ShellRegistry
{
    private readonly Dictionary<FixedTab, List<RibbonGroupSpec>> _fixedGroups = new();
    private readonly List<Func<IReadOnlyList<PaletteCommand>>> _paletteProviders = new();
    private List<TrailEntry> _trail = new();
    private ContextualTabSpec? _activeContextualTab;

    /// <summary>Registers a live command-palette source. Called on every palette open, never
    /// cached (UI_RULES.md §5) — an <see cref="PaletteType.Answer"/> reading must always be
    /// current.</summary>
    public void RegisterPaletteProvider(Func<IReadOnlyList<PaletteCommand>> provider)
    {
        _paletteProviders.Add(provider);
    }

    /// <summary>All palette commands, recomputed fresh from every registered provider.</summary>
    public IReadOnlyList<PaletteCommand> GetPaletteCommands()
    {
        var result = new List<PaletteCommand>();
        foreach (var provider in _paletteProviders)
        {
            result.AddRange(provider());
        }
        return result;
    }

    public event Action? Changed;
    public event Action<ContextualTabSpec?>? ContextualTabChanged;
    public event Action<RecordWorkspaceSpec?>? RecordOpened;

    public RecordWorkspaceSpec? CurrentRecord { get; private set; }

    /// <summary>Registers (or adds to) a group on a fixed tab. Throws if any command carries
    /// <see cref="RibbonIntent.Record"/> — that intent is contextual-tab only.</summary>
    public void RegisterFixedTabGroup(FixedTab tab, RibbonGroupSpec group)
    {
        foreach (var cmd in group.Large.Concat(group.Small))
        {
            if (cmd.Intent == RibbonIntent.Record)
            {
                throw new ShellContractException(
                    $"Fixed tab '{tab}' cannot carry a Record-intent command ('{cmd.Label}'). " +
                    "A command needing a specific record open belongs on a contextual tab " +
                    "(UI_RULES.md §2 / SHELL.md's intent contract).");
            }
        }

        if (!_fixedGroups.TryGetValue(tab, out var list))
        {
            list = new List<RibbonGroupSpec>();
            _fixedGroups[tab] = list;
        }
        list.Add(group);
        Changed?.Invoke();
    }

    /// <summary>The real, merged groups for a fixed tab (UI_RULES.md §2's merge rule applied),
    /// sorted by order. Empty when nothing has registered yet — the caller renders a stated
    /// empty state (SHELL.md §6), never a fake placeholder group.</summary>
    public IReadOnlyList<RibbonGroupSpec> GetFixedTabGroups(FixedTab tab)
    {
        if (!_fixedGroups.TryGetValue(tab, out var list) || list.Count == 0)
        {
            return Array.Empty<RibbonGroupSpec>();
        }
        return RibbonAssembly.MergeGroupsByLabel(list);
    }

    /// <summary>Pushes a trail entry (record or destination just left) and opens its contextual
    /// tab, if any, with the Back group spliced in.</summary>
    public void OpenContextual(TrailEntry entry, ContextualTabSpec? contextualTab, Action onSearchEverything)
    {
        _trail = RibbonAssembly.PushTrail(_trail, entry);

        if (contextualTab != null)
        {
            var assembled = new ContextualTabSpec
            {
                Id = contextualTab.Id,
                Label = contextualTab.Label,
                Groups = RibbonAssembly.AssembleContextualGroups(contextualTab, _trail, onSearchEverything),
            };
            _activeContextualTab = assembled;
            ContextualTabChanged?.Invoke(assembled);
        }
        else
        {
            _activeContextualTab = null;
            ContextualTabChanged?.Invoke(null);
        }
    }

    public ContextualTabSpec? ActiveContextualTab => _activeContextualTab;

    public IReadOnlyList<TrailEntry> Trail => _trail;

    /// <summary>Opens a record into the always-docked right-panel workspace (UI_RULES.md §3).
    /// Passing null closes whatever's currently open.</summary>
    public void OpenRecord(RecordWorkspaceSpec? spec)
    {
        CurrentRecord = spec;
        RecordOpened?.Invoke(spec);
    }

    public void CloseContextual()
    {
        _activeContextualTab = null;
        ContextualTabChanged?.Invoke(null);
    }
}
