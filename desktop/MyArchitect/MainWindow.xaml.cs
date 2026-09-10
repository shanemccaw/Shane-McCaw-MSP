using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Wpf;
using Wpf.Ui.Controls;
using MyArchitect.Models;
using MyArchitect.Services;
using MyArchitect.Shell;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;

namespace MyArchitect;

/// <summary>
/// Main window operator shell — UI Shell Redesign (#3493): a Fluent.Ribbon fixed/contextual tab
/// bar, a left reference panel, a right full-panel record workspace, a command palette, and the
/// title-bar QAT, all assembled from <see cref="ShellRegistry"/> per UI_RULES.md. Portal tab
/// management (WebView2 hosting, per-tenant isolation) is unchanged from the pre-shell version.
/// </summary>
public partial class MainWindow : FluentWindow
{
    private readonly ITenantService _tenantService;
    private readonly IWebViewProfileService _profileService;
    private readonly TrayIconManager _trayIconManager;
    private readonly ObservableCollection<PortalTabItem> _tabs = new();
    private PortalTabItem? _activeTab;

    private readonly IPowerShellConsoleService _consoleService;
    private readonly ITenantModuleConnectionService _tenantModuleConnectionService;
    private readonly IConsoleHistoryService _consoleHistoryService;
    private readonly IChangeRequestReplayService _changeRequestReplayService;
    private readonly IChangeControlService _changeControlService;
    private readonly ILaunchControlActionsService _launchControlActionsService;
    private readonly IVaultService _vaultService;

    private readonly ShellRegistry _shellRegistry = new();
    private FixedRibbonRenderer? _ribbonRenderer;
    private readonly DispatcherTimer _clockTimer = new() { Interval = TimeSpan.FromSeconds(1) };

    // Document views live in the center area; only one is visible at a time (WebView tabs are
    // themselves a "document" too, handled via WebViewsContainer/EmptyTabsOverlay below).
    private FrameworkElement[] DocumentOverlays => new FrameworkElement[]
    {
        SowAssessmentDashboardView, TelemetryDashboardView, ConsolePanel, VaultPanel, ScreenshotEvidenceDocument,
    };

    public MainWindow()
    {
        InitializeComponent();

        _tenantService = new TenantService();
        _profileService = new WebViewProfileService();

        _consoleService = new PowerShellConsoleService();
        _consoleHistoryService = new ConsoleHistoryService();
        _changeRequestReplayService = new ChangeRequestReplayService();
        _tenantModuleConnectionService = new TenantModuleConnectionService(_tenantService, _consoleService);
        _changeControlService = new ChangeControlService();
        _launchControlActionsService = new LaunchControlActionsService();
        _vaultService = new VaultService();
        _consoleService.CommandExecuted += (s, record) => _consoleHistoryService.Add(record);

        ShellTenantSwitcher.Initialize(_tenantService);
        _trayIconManager = new TrayIconManager(this, _tenantService);

        TabsItemsControl.ItemsSource = _tabs;

        _tenantService.CurrentTenantChanged += OnCurrentTenantChanged;

        EvidenceGalleryPanel.CloseRequested += (s, e) => HideDocument(ScreenshotEvidenceDocument);
        EvidenceGalleryPanel.CaptureRequested += (s, e) => TriggerScreenCapture();
        DesktopScreenClipService.CaptureCompleted += (s, item) => Dispatcher.Invoke(() => ShowDocument(ScreenshotEvidenceDocument));

        SowAssessmentDashboardView.Initialize(_tenantService);
        TelemetryDashboardView.Initialize(_tenantService);
        ConsolePanel.Initialize(_consoleService, _tenantModuleConnectionService, _tenantService, _consoleHistoryService);
        ConsolePanel.HistoryRequested += () => OpenConsoleHistoryRecord();
        VaultPanel.Initialize(_vaultService, _tenantService);

        LeftReferencePanelControl.BookmarkSelected += async portalType =>
        {
            if (_tenantService.CurrentTenant != null)
            {
                await OpenPortalTabAsync(_tenantService.CurrentTenant, portalType);
            }
        };

        InitializeShell();
        InitializeStatusBar();

        Loaded += MainWindow_Loaded;
        Closed += MainWindow_Closed;
    }

    // ---- Status bar (UI_RULES.md §1: current time, app version from the assembly) ----------

    private void InitializeStatusBar()
    {
        // App version — from the assembly, never hardcoded (UI_RULES.md §1). Falls back to the
        // informational version string if the file version isn't set.
        var asm = Assembly.GetExecutingAssembly();
        var version = asm.GetName().Version;
        StatusVersionTextBlock.Text = version != null ? $"MyArchitect v{version.Major}.{version.Minor}.{version.Build}" : "MyArchitect";

        _clockTimer.Tick += (_, _) => StatusClockTextBlock.Text = DateTime.Now.ToString("h:mm tt");
        StatusClockTextBlock.Text = DateTime.Now.ToString("h:mm tt");
        _clockTimer.Start();
    }

    // ---- Shell wiring (#3493) --------------------------------------------------------------

    private void InitializeShell()
    {
        _ribbonRenderer = new FixedRibbonRenderer(AppRibbon, _shellRegistry);
        PaletteOverlay.Initialize(_shellRegistry);

        _shellRegistry.RecordOpened += spec =>
        {
            RecordWorkspaceControl.Render(spec);
            RightPanelColumn.Width = new GridLength(spec == null ? 0 : 320);
        };

        RegisterHomeTab();
        RegisterConsoleTab();
        RegisterAdminTab();
        // Watch / Documents are intentionally left unregistered here — their real content is
        // #3483/#3487/#3490 (Watch) and #3486 (Documents), separate Features. FixedRibbonRenderer
        // renders a stated empty state for each until those land (SHELL.md §6) — never a
        // fabricated placeholder group. Admin now carries Vault (#3461); Audit Log (#3489),
        // Break-Glass (#3480) and consent status (#3485) attach here as they land.

        _shellRegistry.RegisterPaletteProvider(BuildPaletteCommands);
    }

    private void RegisterHomeTab()
    {
        _shellRegistry.RegisterFixedTabGroup(FixedTab.Home, new RibbonGroupSpec
        {
            Label = "Tenant",
            Order = 10,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Open All Portals",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Open every bookmarked Microsoft portal for the active tenant",
                    OnSelect = () => _ = OpenAllPortalsAsync(),
                },
            },
        });

        _shellRegistry.RegisterFixedTabGroup(FixedTab.Home, new RibbonGroupSpec
        {
            Label = "Views",
            Order = 20,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "SOW & Assessment",
                    Intent = RibbonIntent.Open,
                    OnSelect = () => ShowAssessmentView(),
                },
                new RibbonCommandSpec
                {
                    Label = "Live Telemetry",
                    Intent = RibbonIntent.Open,
                    OnSelect = () => ShowTelemetryView(),
                },
                new RibbonCommandSpec
                {
                    Label = "Screenshot Evidence",
                    Intent = RibbonIntent.Open,
                    OnSelect = () => ShowDocument(ScreenshotEvidenceDocument),
                },
            },
        });

        _shellRegistry.RegisterFixedTabGroup(FixedTab.Home, new RibbonGroupSpec
        {
            Label = "Change Requests",
            Order = 30,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Browse",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Real GET /api/msp/change-requests, filtered to the active tenant",
                    Gallery = new GallerySpec
                    {
                        Title = "Change Requests",
                        Searchable = true,
                        GetRows = BuildChangeRequestRows,
                    },
                    OnSelect = () => { },
                },
            },
        });
    }

    private void RegisterConsoleTab()
    {
        _shellRegistry.RegisterFixedTabGroup(FixedTab.Console, new RibbonGroupSpec
        {
            Label = "Console",
            Order = 10,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Open Console",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Hosted PowerShell runspace (#3459) — real stdout/stderr, no shelled-out process",
                    OnSelect = () => ShowDocument(ConsolePanel),
                },
                new RibbonCommandSpec
                {
                    Label = "History",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Local console run history (#3459) — command, tenant, duration, mark-for-report state",
                    OnSelect = () => OpenConsoleHistoryRecord(),
                },
            },
        });

        _shellRegistry.RegisterFixedTabGroup(FixedTab.Console, new RibbonGroupSpec
        {
            Label = "Script Library",
            Order = 20,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Browse",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Entitlement-resolved write_action_catalog (#3460)",
                    Gallery = new GallerySpec
                    {
                        Title = "Script Library",
                        Searchable = true,
                        GetRows = BuildScriptLibraryRows,
                    },
                    OnSelect = () => { },
                },
            },
        });
    }

    /// <summary>Admin tab (UI_RULES.md §2). Carries the Credential Vault (#3461) — an
    /// <see cref="RibbonIntent.Open"/> command (global-scope, no specific record) that opens the
    /// vault document. Audit Log (#3489), Break-Glass (#3480) and consent status (#3485) attach
    /// their own groups here as they land.</summary>
    private void RegisterAdminTab()
    {
        _shellRegistry.RegisterFixedTabGroup(FixedTab.Admin, new RibbonGroupSpec
        {
            Label = "Vault",
            Order = 10,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Credential Vault",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Per-tenant username/password store — local-only, DPAPI-encrypted, master-unlocked (#3461)",
                    OnSelect = () => ShowDocument(VaultPanel),
                },
            },
        });
    }

    /// <summary>Real rows from GET /api/msp/change-requests, filtered client-side to the active
    /// tenant. Selecting a row opens the contextual tab + right-panel workspace with a real,
    /// confirm-armed action calling <see cref="IChangeControlService.RecordHumanActionAsync"/> —
    /// the end-to-end proof of the shell's gallery → contextual tab → workspace contract.</summary>
    private System.Collections.Generic.IReadOnlyList<GalleryRowSpec> BuildChangeRequestRows()
    {
        var tenant = _tenantService.CurrentTenant;
        if (tenant == null) return Array.Empty<GalleryRowSpec>();

        System.Collections.Generic.IReadOnlyList<ChangeRequest> requests;
        try
        {
            requests = _changeControlService.GetChangeRequestsAsync(tenant.TenantGuid).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            // Real, honest failure — most likely #3501 (no auth/session mechanism yet), not a
            // bug in this client. Surfaced as a single disabled row rather than a fake row.
            return new[]
            {
                new GalleryRowSpec { Id = "error", Name = $"Could not load: {ex.Message}", OnSelect = () => { } },
            };
        }

        return requests.Select(cr => new GalleryRowSpec
        {
            Id = cr.Id,
            Tile = cr.RiskLevel.Length >= 2 ? cr.RiskLevel[..2].ToUpperInvariant() : cr.RiskLevel.ToUpperInvariant(),
            Name = cr.Title,
            Sub = $"{cr.Status} · {cr.Category}",
            OnSelect = () => OpenChangeRequestRecord(cr),
        }).ToList();
    }

    private void OpenChangeRequestRecord(ChangeRequest cr)
    {
        var spec = new RecordWorkspaceSpec
        {
            Kind = "change-request",
            Id = cr.Id,
            Eyebrow = "Change Request",
            Title = cr.Title,
            Sub = $"{cr.TenantName} · {cr.PrimaryDomain}",
            Facts =
            {
                new WorkspaceFact { Label = "Status", Value = cr.Status },
                new WorkspaceFact { Label = "Risk", Value = cr.RiskLevel },
                new WorkspaceFact { Label = "Class", Value = cr.ChangeClass },
                new WorkspaceFact { Label = "Impacted users", Value = cr.ImpactedUsersCount.ToString() },
            },
            Body = ("Description", string.IsNullOrEmpty(cr.Description) ? "(none)" : cr.Description),
            Actions =
            {
                new WorkspaceAction
                {
                    Label = "Record human action",
                    Confirm = true,
                    OnSelect = () =>
                    {
                        var numericId = cr.NumericId;
                        if (numericId == null) return;
                        _ = _changeControlService.RecordHumanActionAsync(numericId.Value);
                    },
                },
            },
        };

        _shellRegistry.OpenContextual(
            new TrailEntry("change-request", cr.Id, cr.Title, () => OpenChangeRequestRecord(cr)),
            new ContextualTabSpec
            {
                Id = "change-request",
                Label = "Change Request",
                Groups =
                {
                    new RibbonGroupSpec
                    {
                        Label = "Actions",
                        Large = { new RibbonCommandSpec
                        {
                            Label = "Record human action",
                            Intent = RibbonIntent.Record,
                            OnSelect = () => { },
                        } },
                    },
                },
            },
            onSearchEverything: () => PaletteOverlay.Open());

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>#3459's real console-history surface, rendered via the shell's own full-panel
    /// record workspace (UI_RULES.md §3) rather than a second list control invented inside
    /// <see cref="ConsolePanelView"/>. Local-only data — <see cref="IConsoleHistoryService"/>
    /// persists to disk, no backend involved (ad-hoc console runs have no catalog/backend
    /// equivalent, per the issue's own scope).</summary>
    private void OpenConsoleHistoryRecord()
    {
        var records = _consoleHistoryService.GetAll();

        var spec = new RecordWorkspaceSpec
        {
            Kind = "console-history",
            Id = "console-history",
            Eyebrow = "Console",
            Title = "Run History",
            Sub = records.Count == 0 ? "No commands run yet this session/device" : $"{records.Count} recorded run(s), most recent first",
            List = records.Count == 0
                ? null
                : ("Runs", records.Select(r => new WorkspaceListRow
                {
                    Id = r.ExecutionId.ToString(),
                    Name = (r.MarkedForReport ? "★ " : "") + (r.Command.Length > 60 ? r.Command[..60] + "…" : r.Command),
                    Sub = $"{(string.IsNullOrEmpty(r.TenantName) ? "(no tenant)" : r.TenantName)} · {r.StartedAtUtc.ToLocalTime():g}",
                    Right = $"{r.DurationMs}ms · {(r.Succeeded ? "ok" : "failed")}",
                    OnSelect = () => OpenConsoleExecutionDetail(r.ExecutionId),
                }).ToList()),
        };

        _shellRegistry.OpenRecord(spec);
    }

    private void OpenConsoleExecutionDetail(Guid executionId)
    {
        var record = _consoleHistoryService.GetAll().FirstOrDefault(r => r.ExecutionId == executionId);
        if (record == null) return;

        var spec = new RecordWorkspaceSpec
        {
            Kind = "console-execution",
            Id = record.ExecutionId.ToString(),
            Eyebrow = "Console Run",
            Title = record.Command,
            Sub = string.IsNullOrEmpty(record.TenantName) ? "(no tenant)" : record.TenantName,
            Facts =
            {
                new WorkspaceFact { Label = "Started", Value = record.StartedAtUtc.ToLocalTime().ToString("g") },
                new WorkspaceFact { Label = "Duration", Value = $"{record.DurationMs}ms" },
                new WorkspaceFact { Label = "Result", Value = record.Succeeded ? "OK" : "Failed" },
            },
            Body = record.Succeeded
                ? ("Output", string.IsNullOrEmpty(record.Output) ? "(no output)" : record.Output)
                : ("Error", string.IsNullOrEmpty(record.ErrorOutput) ? "(no error output)" : record.ErrorOutput),
            Edits =
            {
                new WorkspaceEdit
                {
                    Key = "markedForReport",
                    Label = "Mark for report",
                    Value = record.MarkedForReport ? "Yes" : "No",
                    Options = new() { "No", "Yes" },
                    OnChange = newValue =>
                    {
                        var wantMarked = newValue == "Yes";
                        if (wantMarked == record.MarkedForReport) return;
                        _consoleHistoryService.ToggleMarkedForReport(record.ExecutionId);
                        record.MarkedForReport = wantMarked;
                    },
                },
            },
        };

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>Real MSP+customer id resolution for every Launch Control call. Returns false
    /// today because MyArchitect has no auth/session mechanism anywhere to source either id
    /// from (#3501, also noted on <see cref="ILaunchControlActionsService"/> itself) — Tenant
    /// only ever carries a TenantGuid (string), never a numeric mspId/tenants.id. Kept as its
    /// own resolver, not inlined, so the one thing that changes once #3501 lands is this
    /// method's body — the gallery/record-workspace/execute wiring below it doesn't move.</summary>
    private bool TryResolveLaunchControlScope(out int mspId, out int customerId)
    {
        mspId = 0;
        customerId = 0;
        return false;
    }

    /// <summary>Real catalog rows, real mapping (tile/name/sub from
    /// <see cref="LaunchControlAction"/>'s own fields, grouped by the catalog's real Domain —
    /// UI_RULES.md §4) once a real MSP+customer id pair is resolvable. Today it never is
    /// (#3501) — this states that honestly instead of guessing an id, which would be inventing
    /// data.</summary>
    private System.Collections.Generic.IReadOnlyList<GalleryRowSpec> BuildScriptLibraryRows()
    {
        if (!TryResolveLaunchControlScope(out var mspId, out var customerId))
        {
            return new[]
            {
                new GalleryRowSpec
                {
                    Id = "blocked",
                    Name = "Script Library needs MSP/customer identity — not yet resolvable (#3501)",
                    OnSelect = () => { },
                },
            };
        }

        LaunchControlCatalog catalog;
        try
        {
            catalog = _launchControlActionsService.GetActionsAsync(mspId, customerId).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            // Real, honest failure — most likely 401/403 (auth still not wired), not a bug in
            // this client. Surfaced as a single disabled row rather than a fake row.
            return new[]
            {
                new GalleryRowSpec { Id = "error", Name = $"Could not load: {ex.Message}", OnSelect = () => { } },
            };
        }

        return catalog.Actions
            .OrderBy(a => a.Domain, StringComparer.OrdinalIgnoreCase)
            .ThenBy(a => a.SortOrder)
            .Select(a => new GalleryRowSpec
            {
                Id = a.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                Tile = TileForScriptLibraryRow(a),
                Name = a.ActionName,
                Sub = $"{a.Domain} · {SubForScriptLibraryRow(a)}",
                OnSelect = () => OpenScriptLibraryRecord(a, mspId, customerId),
            })
            .ToList();
    }

    /// <summary>Two-character code from the catalog's own safe/gated classification — the
    /// destructive-vs-read-only signal UI_RULES.md §4 asks a script's tile to carry. "—" for the
    /// catalog's blocked_no_workaround rows, which have no classification at all.</summary>
    private static string TileForScriptLibraryRow(LaunchControlAction action) => action.SafeOrGated switch
    {
        "gated" => "GA",
        "safe" => "SA",
        _ => "—",
    };

    private static string SubForScriptLibraryRow(LaunchControlAction action) =>
        action.TemplateId == null ? "not execution-ready" : $"{action.Availability} · {action.Status}";

    /// <summary>Opens the record workspace for one catalog action — real facts from the row,
    /// one write-through <see cref="WorkspaceEdit"/> per real
    /// <see cref="LaunchControlAction.RequiredVariables"/> entry, and a confirm-armed "Run"
    /// action that runs it for real via <see cref="RunScriptLibraryAction"/>. Same
    /// gallery → contextual tab → workspace contract #3493 proved with Change Requests.</summary>
    private void OpenScriptLibraryRecord(LaunchControlAction action, int mspId, int customerId)
    {
        var variableValues = action.RequiredVariables.ToDictionary(v => v, _ => string.Empty);

        var spec = new RecordWorkspaceSpec
        {
            Kind = "script-library-action",
            Id = action.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Eyebrow = "Script Library",
            Title = action.ActionName,
            Sub = $"{action.Domain} · {action.Surface}",
            Facts =
            {
                new WorkspaceFact { Label = "Status", Value = action.Status ?? "(none)" },
                new WorkspaceFact { Label = "Availability", Value = action.Availability },
                new WorkspaceFact { Label = "Safe/Gated", Value = action.SafeOrGated ?? "(unclassified)" },
                new WorkspaceFact { Label = "Min tier", Value = action.MinBundledTier ?? "(none)" },
                new WorkspaceFact { Label = "Required permission", Value = action.RequiredPermission ?? "(none)" },
            },
            Edits = action.RequiredVariables
                .Select(v => new WorkspaceEdit
                {
                    Key = v,
                    Label = v,
                    Value = string.Empty,
                    OnChange = value => variableValues[v] = value,
                })
                .ToList(),
            Body = !string.IsNullOrEmpty(action.SnapshotNotes) ? ("Notes", action.SnapshotNotes) : null,
            Actions =
            {
                new WorkspaceAction
                {
                    Label = "Run",
                    Confirm = true,
                    OnSelect = () => RunScriptLibraryAction(action, mspId, customerId, variableValues),
                },
            },
        };

        _shellRegistry.OpenContextual(
            new TrailEntry("script-library-action", action.Id.ToString(System.Globalization.CultureInfo.InvariantCulture), action.ActionName,
                () => OpenScriptLibraryRecord(action, mspId, customerId)),
            new ContextualTabSpec
            {
                Id = "script-library-action",
                Label = "Script",
                Groups =
                {
                    new RibbonGroupSpec
                    {
                        Label = "Actions",
                        Large = { new RibbonCommandSpec
                        {
                            Label = "Run",
                            Intent = RibbonIntent.Record,
                            OnSelect = () => { },
                        } },
                    },
                },
            },
            onSearchEverything: () => PaletteOverlay.Open());

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>Runs entries straight into the embedded Console (the issue's own words) — a
    /// real POST /launch-control/execute with the operator's pre-filled
    /// <see cref="LaunchControlAction.RequiredVariables"/> values, its real result (success,
    /// label, missing variables, audit log id) surfaced into the Console tab's output pane, the
    /// same place a typed command's output lands. The execute route runs server-side, not
    /// through the hosted runspace, so this reports via <see cref="ConsolePanelView.AppendExternal"/>
    /// rather than feeding PowerShell text into <see cref="IPowerShellConsoleService"/>.</summary>
    private void RunScriptLibraryAction(
        LaunchControlAction action,
        int mspId,
        int customerId,
        System.Collections.Generic.Dictionary<string, string> variableValues)
    {
        ShowDocument(ConsolePanel);
        ConsolePanel.AppendExternal($"[Script Library] Running \"{action.ActionName}\" against customer {customerId}…");

        try
        {
            var response = _launchControlActionsService
                .ExecuteAsync(mspId, action.Id, customerId, variableValues)
                .GetAwaiter().GetResult();

            var result = response.Result;
            ConsolePanel.AppendExternal(
                $"[Script Library] {(result.Success ? "Succeeded" : "Failed")} · {result.Label} · status {result.Status}");
            if (result.MissingVariables is { Count: > 0 })
            {
                ConsolePanel.AppendExternal($"[Script Library] Missing variables: {string.Join(", ", result.MissingVariables)}");
            }
            if (result.AuditLogId is { } auditLogId)
            {
                ConsolePanel.AppendExternal($"[Script Library] Audit log #{auditLogId}{(result.Reversible ? " (reversible)" : string.Empty)}");
            }
        }
        catch (LaunchControlActionsException ex)
        {
            // A real server-side rejection (402/403/404/409/500 — see msp-launch-control.ts),
            // surfaced with its own real message, not swallowed or faked into a success.
            ConsolePanel.AppendExternal($"[Script Library] Execute failed: {ex.Message}");
        }
        catch (Exception ex)
        {
            ConsolePanel.AppendExternal($"[Script Library] Exception: {ex.Message}");
        }
    }

    private System.Collections.Generic.IReadOnlyList<PaletteCommand> BuildPaletteCommands()
    {
        var commands = new System.Collections.Generic.List<PaletteCommand>
        {
            new() { Id = "dest:home", Type = PaletteType.Destination, Name = "Home", Run = () => AppRibbon.SelectedTabIndex = 0 },
            new() { Id = "dest:console", Type = PaletteType.Destination, Name = "Console", Run = () => ShowDocument(ConsolePanel) },
            new() { Id = "dest:sow", Type = PaletteType.Destination, Name = "SOW & Assessment", Sub = "Gate, SOW, Drift & Snapshot", Run = () => ShowAssessmentView() },
            new() { Id = "dest:telemetry", Type = PaletteType.Destination, Name = "Live Telemetry Console", Sub = "Engines, Drift, SOW & Feed", Run = () => ShowTelemetryView() },
            new() { Id = "dest:vault", Type = PaletteType.Destination, Name = "Credential Vault", Sub = "Per-tenant, local-only, DPAPI-encrypted (#3461)", Run = () => ShowDocument(VaultPanel) },
            new() { Id = "act:open-all", Type = PaletteType.Action, Name = "Open all portals", Run = () => _ = OpenAllPortalsAsync() },
            new() { Id = "ans:open-tabs", Type = PaletteType.Answer, Name = "Open portal tabs", Live = _tabs.Count.ToString(), Run = () => { } },
        };

        foreach (var tenant in _tenantService.Tenants)
        {
            commands.Add(new PaletteCommand
            {
                Id = $"rec:tenant:{tenant.Id}",
                Type = PaletteType.Record,
                Name = tenant.Name,
                Sub = tenant.TenantGuid,
                Run = () => _tenantService.SelectTenant(tenant.Id),
            });
        }

        return commands;
    }

    private async Task OpenAllPortalsAsync()
    {
        var tenant = _tenantService.CurrentTenant;
        if (tenant == null) return;

        foreach (PortalType portalType in Enum.GetValues<PortalType>())
        {
            if (portalType == PortalType.ClaudeChat) continue;
            if (_tabs.Any(t => t.Tenant == tenant && t.PortalType == portalType)) continue;
            await OpenPortalTabAsync(tenant, portalType);
        }
    }

    private void PaletteTriggerButton_Click(object sender, RoutedEventArgs e) => PaletteOverlay.Open();

    private void UndoButton_Click(object sender, RoutedEventArgs e)
    {
        // UI_RULES.md §7 — thin trigger over real backend rollback only, no client-side undo
        // stack. IChangeControlService has no rollback client method today (only
        // human-action/attest); the button stays disabled until that real endpoint is wired,
        // rather than faking an undo. See build-journal/3493.md for the filed follow-up.
    }

    // ---- Document toggling (SOW / Telemetry / Console / Screenshot Evidence) ---------------

    private void ShowDocument(FrameworkElement document)
    {
        WebViewsContainer.Visibility = Visibility.Collapsed;
        EmptyTabsOverlay.Visibility = Visibility.Collapsed;
        foreach (var d in DocumentOverlays) d.Visibility = d == document ? Visibility.Visible : Visibility.Collapsed;

        if (document == SowAssessmentDashboardView && _tenantService.CurrentTenant != null)
        {
            _ = SowAssessmentDashboardView.LoadForTenantAsync(_tenantService.CurrentTenant);
        }
        else if (document == TelemetryDashboardView && _tenantService.CurrentTenant != null)
        {
            _ = TelemetryDashboardView.LoadForTenantAsync(_tenantService.CurrentTenant);
        }
        else if (document == VaultPanel)
        {
            // Re-evaluate lock/unlock state and focus the right input each time it opens.
            VaultPanel.OnShown();
        }
    }

    private void HideDocument(FrameworkElement document)
    {
        document.Visibility = Visibility.Collapsed;
        if (DocumentOverlays.All(d => d.Visibility != Visibility.Visible))
        {
            UpdateTabsState();
        }
    }

    public void ShowAssessmentView() => ShowDocument(SowAssessmentDashboardView);
    public void ShowTelemetryView() => ShowDocument(TelemetryDashboardView);

    // ---- Portal tab management (unchanged from pre-shell version) --------------------------

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        if (_tenantService.CurrentTenant != null)
        {
            LeftReferencePanelControl.SetTenantName(_tenantService.CurrentTenant.Name);
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.M365Admin);
        }
    }

    private void MainWindow_Closed(object? sender, EventArgs e)
    {
        _clockTimer.Stop();
        _trayIconManager.Dispose();
        foreach (var tab in _tabs)
        {
            tab.WebView.Dispose();
        }
        _tenantModuleConnectionService.Dispose();
        _consoleService.Dispose();
    }

    public async Task<PortalTabItem> OpenPortalTabAsync(Tenant tenant, PortalType portalType, string? customUrl = null)
    {
        var (title, icon) = GetPortalMetadata(portalType);
        var url = customUrl ?? tenant.PortalUrls.GetUrl(portalType);

        var webView = new WebView2
        {
            HorizontalAlignment = System.Windows.HorizontalAlignment.Stretch,
            VerticalAlignment = System.Windows.VerticalAlignment.Stretch,
            Visibility = Visibility.Collapsed
        };

        WebViewsContainer.Children.Add(webView);

        var tab = new PortalTabItem
        {
            Tenant = tenant,
            PortalType = portalType,
            Title = title,
            IconSymbol = icon,
            Url = url,
            WebView = webView,
            IsLoading = true
        };

        webView.NavigationStarting += (s, e) =>
        {
            tab.IsLoading = true;
            if (tab == _activeTab)
            {
                UrlTextBox.Text = e.Uri;
            }
        };

        webView.NavigationCompleted += (s, e) =>
        {
            tab.IsLoading = false;
            if (webView.Source != null)
            {
                tab.Url = webView.Source.ToString();
                if (tab == _activeTab)
                {
                    UrlTextBox.Text = tab.Url;
                    UpdateNavigationButtonsState();
                }
            }
        };

        webView.SourceChanged += (s, e) =>
        {
            if (webView.Source != null)
            {
                tab.Url = webView.Source.ToString();
                if (tab == _activeTab)
                {
                    UrlTextBox.Text = tab.Url;
                    UpdateNavigationButtonsState();
                }
            }
        };

        _tabs.Add(tab);
        ActivateTab(tab);

        try
        {
            var env = await _profileService.GetEnvironmentForTenantAsync(tenant);
            await webView.EnsureCoreWebView2Async(env);

            if (!string.IsNullOrWhiteSpace(url))
            {
                webView.CoreWebView2.Navigate(url);
            }
        }
        catch (Exception ex)
        {
            tab.IsLoading = false;
            tab.Title = $"{title} (Offline)";
            if (tab == _activeTab)
            {
                UrlTextBox.Text = $"Notice: {ex.Message}";
            }
        }

        return tab;
    }

    public void ActivateTab(PortalTabItem tab)
    {
        foreach (var d in DocumentOverlays) d.Visibility = Visibility.Collapsed;

        if (_activeTab != null)
        {
            _activeTab.IsActive = false;
            _activeTab.WebView.Visibility = Visibility.Collapsed;
        }

        _activeTab = tab;
        tab.IsActive = true;
        tab.WebView.Visibility = Visibility.Visible;
        WebViewsContainer.Visibility = Visibility.Visible;

        UrlTextBox.Text = tab.Url;
        IsolatedProfileBadgeTextBlock.Text = tab.DisplayBadge;
        StatusProfileTextBlock.Text = tab.IsGlobal ? "Session: Global Claude Profile [claude.ai]" : $"Session Isolation: {tab.Tenant?.Name} [{tab.Tenant?.TenantGuid}]";

        UpdateTabsState();
        UpdateNavigationButtonsState();
    }

    public void CloseTab(PortalTabItem tab)
    {
        var wasActive = tab == _activeTab;
        WebViewsContainer.Children.Remove(tab.WebView);
        tab.WebView.Dispose();
        _tabs.Remove(tab);

        if (wasActive)
        {
            var nextTab = _tabs.LastOrDefault();
            if (nextTab != null)
            {
                ActivateTab(nextTab);
            }
            else
            {
                _activeTab = null;
                UrlTextBox.Text = string.Empty;
                IsolatedProfileBadgeTextBlock.Text = "No Active Tab";
                StatusProfileTextBlock.Text = "Session Isolation: Standby";
            }
        }

        UpdateTabsState();
    }

    private void UpdateTabsState()
    {
        var anyDocumentVisible = DocumentOverlays.Any(d => d.Visibility == Visibility.Visible);
        EmptyTabsOverlay.Visibility = (_tabs.Count == 0 && !anyDocumentVisible) ? Visibility.Visible : Visibility.Collapsed;
        StatusTabCountTextBlock.Text = $"{_tabs.Count} Open Tab{(_tabs.Count == 1 ? "" : "s")}";
    }

    private void UpdateNavigationButtonsState()
    {
        if (_activeTab?.WebView?.CoreWebView2 != null)
        {
            BackButton.IsEnabled = _activeTab.WebView.CanGoBack;
            ForwardButton.IsEnabled = _activeTab.WebView.CanGoForward;
        }
        else
        {
            BackButton.IsEnabled = false;
            ForwardButton.IsEnabled = false;
        }
    }

    private async void OnCurrentTenantChanged(object? sender, Tenant? tenant)
    {
        if (tenant == null) return;

        LeftReferencePanelControl.SetTenantName(tenant.Name);
        _trayIconManager.UpdateTenant(tenant);

        var existingTab = _tabs.FirstOrDefault(t => t.Tenant != null && t.Tenant.Id.Equals(tenant.Id, StringComparison.OrdinalIgnoreCase));
        if (existingTab != null)
        {
            ActivateTab(existingTab);
        }
        else
        {
            await OpenPortalTabAsync(tenant, PortalType.M365Admin);
        }
    }

    private static (string Title, SymbolRegular Icon) GetPortalMetadata(PortalType portalType) => portalType switch
    {
        PortalType.M365Admin => ("M365 Admin", SymbolRegular.Globe24),
        PortalType.AzurePortal => ("Azure Portal", SymbolRegular.Cloud24),
        PortalType.EntraAdmin => ("Entra ID", SymbolRegular.Shield24),
        PortalType.IntuneAdmin => ("Intune", SymbolRegular.Globe24),
        PortalType.ExchangeAdmin => ("Exchange", SymbolRegular.Mail24),
        PortalType.SecurityAdmin => ("Defender", SymbolRegular.Shield24),
        PortalType.ComplianceAdmin => ("Purview", SymbolRegular.Shield24),
        PortalType.TeamsAdmin => ("Teams Admin", SymbolRegular.Globe24),
        _ => ("Portal", SymbolRegular.Globe24)
    };

    private void TabItem_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (sender is FrameworkElement element && element.DataContext is PortalTabItem tab)
        {
            ActivateTab(tab);
        }
    }

    private void CloseTabButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement element && element.DataContext is PortalTabItem tab)
        {
            CloseTab(tab);
        }
    }

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if ((Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control && e.Key == Key.K)
        {
            PaletteOverlay.Open();
            e.Handled = true;
        }
        else if (e.Key == Key.PrintScreen ||
                 ((Keyboard.Modifiers & (ModifierKeys.Control | ModifierKeys.Shift)) == (ModifierKeys.Control | ModifierKeys.Shift) && e.Key == Key.S))
        {
            TriggerScreenCapture();
            e.Handled = true;
        }
        else if ((Keyboard.Modifiers & (ModifierKeys.Control | ModifierKeys.Shift)) == (ModifierKeys.Control | ModifierKeys.Shift) && e.Key == Key.A)
        {
            ShowAssessmentView();
            e.Handled = true;
        }
        else if ((Keyboard.Modifiers & (ModifierKeys.Control | ModifierKeys.Shift)) == (ModifierKeys.Control | ModifierKeys.Shift) && e.Key == Key.T)
        {
            ShowTelemetryView();
            e.Handled = true;
        }
    }

    public void TriggerScreenCapture()
    {
        DesktopScreenClipService.Capture(_tenantService.CurrentTenant, _activeTab?.Url, _activeTab?.Title);
    }

    private void ScreenClipButton_Click(object sender, RoutedEventArgs e)
    {
        TriggerScreenCapture();
    }

    private void NewTabButton_Click(object sender, RoutedEventArgs e)
    {
        // Bookmarks live permanently in the left panel now (UI_RULES.md §8) — nothing to pop
        // open here anymore; this button is a no-op placeholder kept for the tab-strip's own
        // "+" affordance until a blank-document picker exists.
    }

    private void BackButton_Click(object sender, RoutedEventArgs e)
    {
        if (_activeTab?.WebView?.CoreWebView2 != null && _activeTab.WebView.CanGoBack)
        {
            _activeTab.WebView.GoBack();
        }
    }

    private void ForwardButton_Click(object sender, RoutedEventArgs e)
    {
        if (_activeTab?.WebView?.CoreWebView2 != null && _activeTab.WebView.CanGoForward)
        {
            _activeTab.WebView.GoForward();
        }
    }

    private void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        if (_activeTab?.WebView?.CoreWebView2 != null)
        {
            try
            {
                _activeTab.WebView.Reload();
            }
            catch
            {
                if (!string.IsNullOrEmpty(_activeTab.Url))
                {
                    _activeTab.WebView.CoreWebView2.Navigate(_activeTab.Url);
                }
            }
        }
    }

    private void UpdateAvailableButton_Click(object sender, RoutedEventArgs e)
    {
        // Version-update mechanism (UI_RULES.md §6 — port of BuildConsole's VersionInfo.cs +
        // MainWindow.VersionUpdate.cs) is not built this session; button stays hidden
        // (Visibility="Collapsed" in XAML) until it lands. See build-journal/3493.md.
    }

    private void LaunchExternalButton_Click(object sender, RoutedEventArgs e)
    {
        var targetUrl = _activeTab?.Url;
        if (!string.IsNullOrWhiteSpace(targetUrl))
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = targetUrl,
                    UseShellExecute = true
                });
            }
            catch
            {
                // Ignore failure to launch external process
            }
        }
    }
}
