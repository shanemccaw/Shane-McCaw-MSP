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
    private readonly IRemediationTrackerService _remediationTrackerService;
    private readonly IVipClassificationsService _vipClassificationsService;
    private readonly ILaunchControlActionsService _launchControlActionsService;
    private readonly IAdminRetainerService _adminRetainerService;
    private readonly IRunbooksService _runbooksService;
    private readonly IDocumentHubService _documentHubService;
    private readonly IVaultService _vaultService;
    private readonly IBreakGlassService _breakGlassService;
    private readonly IAuthService _authService;
    private readonly IRetainerService _retainerService;
    private readonly IPoamsService _poamsService;
    private readonly IActivityContextService _activityContextService;
    private readonly IForegroundAppWatcher _foregroundAppWatcher;

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
        _remediationTrackerService = new RemediationTrackerService();
        _vipClassificationsService = new VipClassificationsService();
        _launchControlActionsService = new LaunchControlActionsService();
        _adminRetainerService = new AdminRetainerService();
        _runbooksService = new RunbooksService();
        _documentHubService = new DocumentHubService();
        _vaultService = new VaultService();
        _breakGlassService = new BreakGlassService();
        _authService = new AuthService();
        _retainerService = new RetainerService();
        _poamsService = new PoamsService();
        _authService.SessionChanged += OnAuthSessionChanged;
        _consoleService.CommandExecuted += (s, record) => _consoleHistoryService.Add(record);

        // Activity Layer (#3463) — local, in-app "current context" tracking. Local-only, no
        // backend sync (see the type's own doc comment for why).
        _activityContextService = new ActivityContextService();
        _tenantService.CurrentTenantChanged += (s, tenant) => _activityContextService.RecordTenantSwitch(tenant);
        _consoleService.CommandExecuted += (s, record) => _activityContextService.RecordConsoleCommand(record);
        _foregroundAppWatcher = new ForegroundAppWatcher();
        _foregroundAppWatcher.ForegroundAppChanged += appLabel => _activityContextService.RecordExternalApp(appLabel);
        _foregroundAppWatcher.Start();

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
        LeftReferencePanelControl.VipLookupRequested += upn => RunVipLookup(upn);

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

            // Activity Layer (#3463) — a record opening is the "active step" signal (a
            // remediation step, a change request, a runbook, ...). Excludes the Activity
            // Timeline's own records so reviewing your own timeline doesn't spam itself.
            if (spec != null && spec.Kind != "activity-timeline" && spec.Kind != "activity-event")
            {
                _activityContextService.RecordOpen(spec.Kind, spec.Id, spec.Title);
            }
        };

        RegisterHomeTab();
        RegisterConsoleTab();
        RegisterDocumentsTab();
        RegisterAdminTab();
        // Watch is intentionally left unregistered here — its real content is #3483/#3487/#3490,
        // separate Features. FixedRibbonRenderer renders a stated empty state until those land
        // (SHELL.md §6) — never a fabricated placeholder group. Admin now carries Vault (#3461);
        // Audit Log (#3489), Break-Glass (#3480) and consent status (#3485) attach here as they
        // land. Documents now carries Document Hub (#3486).

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
                new RibbonCommandSpec
                {
                    Label = "Activity Timeline",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Local daily timeline (#3463) — tenant switches, console commands, records opened, external apps",
                    OnSelect = () => OpenActivityTimelineRecord(),
                },
            },
        });

        _shellRegistry.RegisterFixedTabGroup(FixedTab.Home, new RibbonGroupSpec
        {
            Label = "Remediation Plan",
            Order = 30,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Browse",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Unified item browser (#3471) — real remediation tracker steps + change-control queue, one view",
                    Gallery = new GallerySpec
                    {
                        Title = "Remediation Plan",
                        Searchable = true,
                        GetRows = BuildRemediationPlanRows,
                    },
                    OnSelect = () => { },
                },
            },
        });

        _shellRegistry.RegisterFixedTabGroup(FixedTab.Home, new RibbonGroupSpec
        {
            Label = "POA&Ms",
            Order = 35,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Browse",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Real GET /api/msp/poams, filtered to the active tenant",
                    Gallery = new GallerySpec
                    {
                        Title = "POA&Ms",
                        Searchable = true,
                        GetRows = BuildPoamRows,
                    },
                    OnSelect = () => { },
                },
                new RibbonCommandSpec
                {
                    Label = "New POA&M",
                    Intent = RibbonIntent.Create,
                    ToolTip = "POST /api/msp/poams — author a new plan for the active tenant",
                    OnSelect = () => OpenCreatePoamRecord(),
                },
            },
        });

        _shellRegistry.RegisterFixedTabGroup(FixedTab.Home, new RibbonGroupSpec
        {
            Label = "Retainer Hours",
            Order = 40,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Log Ad-Hoc Hours",
                    Intent = RibbonIntent.Create,
                    ToolTip = "POST /api/admin/retainer/:customerId/unscoped — work not tied to a tracker step or change request (#3464)",
                    OnSelect = () => OpenLogAdHocHoursRecord(),
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

        _shellRegistry.RegisterFixedTabGroup(FixedTab.Console, new RibbonGroupSpec
        {
            Label = "Runbooks",
            Order = 30,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Browse",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Real GET /api/msp/runbooks (#3479) — a customer's active runbooks + run history",
                    Gallery = new GallerySpec
                    {
                        Title = "Runbooks",
                        Searchable = true,
                        GetRows = BuildRunbookRows,
                    },
                    OnSelect = () => { },
                },
                new RibbonCommandSpec
                {
                    Label = "Hold Windows",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Real GET /api/msp/runbooks (#3479) — the same payload's top-level hold windows",
                    Gallery = new GallerySpec
                    {
                        Title = "Hold Windows",
                        Searchable = true,
                        GetRows = BuildHoldWindowRows,
                    },
                    OnSelect = () => { },
                },
            },
        });
    }

    /// <summary>Documents tab (UI_RULES.md §2 / §4). Carries Document Hub (#3486) — the real
    /// GET /api/msp/documents-hub aggregated browse across the caller's whole book (see
    /// <see cref="BuildDocumentHubRows"/> for why it isn't filtered to one tenant yet). A gallery
    /// command, same shape as Script Library/Runbooks: selecting a row opens its full-panel
    /// record workspace (§3), never navigates away.</summary>
    private void RegisterDocumentsTab()
    {
        _shellRegistry.RegisterFixedTabGroup(FixedTab.Documents, new RibbonGroupSpec
        {
            Label = "Document Hub",
            Order = 10,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Browse",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Real GET /api/msp/documents-hub (#3486) — customer-generated reports, SOWs and consulting docs across the whole book",
                    Gallery = new GallerySpec
                    {
                        Title = "Document Hub",
                        Searchable = true,
                        GetRows = BuildDocumentHubRows,
                    },
                    OnSelect = () => { },
                },
            },
        });
    }

    /// <summary>Admin tab (UI_RULES.md §2). Carries the Credential Vault (#3461) and Break-Glass
    /// Access (#3480) — both <see cref="RibbonIntent.Open"/> commands (global-scope, no specific
    /// record). Audit Log (#3489) and consent status (#3485) attach their own groups here as they
    /// land.</summary>
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

        // Break-Glass Access (#3480) — cross-tenant pending list opens as a full-panel record
        // workspace (UI_RULES.md §3); rows drill into a per-secret detail with the verification
        // attempts, a confirm-armed admin-override, and the per-customer override audit trail. An
        // Open-intent command (nothing tenant-specific to select yet), so it is fixed-tab legal.
        _shellRegistry.RegisterFixedTabGroup(FixedTab.Admin, new RibbonGroupSpec
        {
            Label = "Break-Glass",
            Order = 20,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Pending Requests",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Cross-tenant pending break-glass credential deliveries (GET /api/msp/break-glass, #3480)",
                    OnSelect = () => OpenBreakGlassPendingList(),
                },
            },
        });
    }

    // ---- Break-Glass Access (#3480) — real msp-break-glass.ts client, full-panel workspaces ----

    /// <summary>Opens the cross-tenant pending list (GET /api/msp/break-glass) as a full-panel record
    /// workspace. Each row is a real pending_delivery secret carrying its own numeric customerId, so a
    /// drill-down into detail/override/audit never depends on a locally-resolved tenant id. On an auth
    /// or transport failure the record states the honest reason (a 401/403 means the operator session
    /// isn't attached, not a bug here) rather than showing a fabricated list.</summary>
    private void OpenBreakGlassPendingList()
    {
        System.Collections.Generic.IReadOnlyList<Models.BreakGlassPendingItem> pending;
        try
        {
            pending = _breakGlassService.GetPendingAsync().GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "break-glass-pending",
                Id = "break-glass-pending",
                Eyebrow = "Break-Glass",
                Title = "Pending Requests",
                Sub = "Could not load",
                Body = ("Error", DescribeBreakGlassError(ex)),
            });
            return;
        }

        var spec = new RecordWorkspaceSpec
        {
            Kind = "break-glass-pending",
            Id = "break-glass-pending",
            Eyebrow = "Break-Glass",
            Title = "Pending Requests",
            Sub = pending.Count == 0
                ? "No break-glass credentials are awaiting delivery across your customers"
                : $"{pending.Count} pending across your customers, most recent first",
            List = pending.Count == 0
                ? null
                : ("Pending", pending.Select(p => new WorkspaceListRow
                {
                    Id = p.PendingSecretId.ToString(),
                    Name = p.CustomerName ?? $"Customer #{p.CustomerId}",
                    Sub = $"Secret #{p.PendingSecretId} · {p.Status} · {p.CreatedAt.ToLocalTime():g}",
                    Right = p.LiveInviteCount > 0 ? $"{p.LiveInviteCount} live invite(s)" : $"{p.TotalInviteCount} invite(s)",
                    OnSelect = () => OpenBreakGlassSecretRecord(p.CustomerId, p.PendingSecretId, p.CustomerName),
                }).ToList()),
        };

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>Opens one pending secret (GET .../break-glass/:pendingSecretId) as a full-panel record
    /// with its verification attempts, a confirm-armed admin-override (only when the secret is still
    /// awaiting delivery — the server enforces this too), and links to the customer's override audit
    /// trail and full break-glass history. Reason/emails for the override are collected via
    /// write-through <see cref="WorkspaceEdit"/> fields, the same local-capture pattern the Script
    /// Library record uses for its required variables.</summary>
    private void OpenBreakGlassSecretRecord(int customerId, int pendingSecretId, string? customerName)
    {
        Models.BreakGlassSecretDetail detail;
        try
        {
            detail = _breakGlassService.GetSecretDetailAsync(customerId, pendingSecretId).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "break-glass-secret",
                Id = $"break-glass-secret-{pendingSecretId}",
                Eyebrow = "Break-Glass",
                Title = $"Pending secret #{pendingSecretId}",
                Sub = customerName ?? $"Customer #{customerId}",
                Body = ("Error", DescribeBreakGlassError(ex)),
            });
            return;
        }

        var liveInvites = detail.Attempts.Count(a => a.LinkStatus == "pending");

        // Local write-through capture for the override inputs (no dirty state, no save step — same
        // as the Script Library record's RequiredVariables capture).
        var overrideReason = string.Empty;
        var overrideEmails = string.Empty;

        var spec = new RecordWorkspaceSpec
        {
            Kind = "break-glass-secret",
            Id = $"break-glass-secret-{pendingSecretId}",
            Eyebrow = "Break-Glass",
            Title = $"Pending secret #{detail.PendingSecretId}",
            Sub = $"{customerName ?? $"Customer #{customerId}"} · {detail.Status}",
            Facts =
            {
                new WorkspaceFact { Label = "Status", Value = detail.Status },
                new WorkspaceFact { Label = "Attempts", Value = detail.Attempts.Count.ToString() },
                new WorkspaceFact { Label = "Live invites", Value = liveInvites.ToString() },
                new WorkspaceFact { Label = "Created", Value = detail.CreatedAt.ToLocalTime().ToString("g"), Prose = true },
                new WorkspaceFact
                {
                    Label = "Delivered",
                    Value = detail.DeliveredAt.HasValue
                        ? $"{detail.DeliveredAt.Value.ToLocalTime():g}{(string.IsNullOrEmpty(detail.DeliveredToEmail) ? "" : $" · {detail.DeliveredToEmail}")}"
                        : "not yet",
                    Prose = true,
                },
            },
            List = detail.Attempts.Count == 0
                ? null
                : ("Verification attempts", detail.Attempts.Select(a => new WorkspaceListRow
                {
                    Id = a.Id.ToString(),
                    Name = string.IsNullOrEmpty(a.InvitedEmail) ? "(no invited email)" : a.InvitedEmail!,
                    Sub = $"{a.LinkStatus ?? "?"}{(string.IsNullOrEmpty(a.VerificationOutcome) ? "" : $" · {a.VerificationOutcome}")}"
                          + (a.FailedAttemptCount > 0 ? $" · {a.FailedAttemptCount} failed" : ""),
                    Right = a.AttemptedAt.HasValue ? a.AttemptedAt.Value.ToLocalTime().ToString("g") : a.CreatedAt.ToLocalTime().ToString("g"),
                    OnSelect = () => { }, // attempts have no deeper record — display only
                }).ToList()),
        };

        var isPending = detail.Status == "pending_delivery";
        if (isPending)
        {
            spec.Edits.Add(new WorkspaceEdit
            {
                Key = "override-reason",
                Label = "Override reason (required)",
                Value = string.Empty,
                OnChange = v => overrideReason = v,
            });
            spec.Edits.Add(new WorkspaceEdit
            {
                Key = "override-emails",
                Label = "Reissue to emails (optional, comma-separated — blank reuses original recipients)",
                Value = string.Empty,
                OnChange = v => overrideEmails = v,
            });
            spec.Actions.Add(new WorkspaceAction
            {
                Label = "Force reset & reissue",
                Confirm = true,
                Danger = true,
                OnSelect = () => RunBreakGlassOverride(customerId, pendingSecretId, customerName, () => overrideReason, () => overrideEmails),
            });
        }

        spec.Actions.Add(new WorkspaceAction
        {
            Label = "View override audit trail",
            OnSelect = () => OpenBreakGlassAuditRecord(customerId, customerName),
        });
        spec.Actions.Add(new WorkspaceAction
        {
            Label = "View customer break-glass history",
            OnSelect = () => OpenBreakGlassHistoryRecord(customerId, customerName),
        });

        _shellRegistry.OpenContextual(
            new TrailEntry("break-glass-secret", pendingSecretId.ToString(), $"Break-Glass #{pendingSecretId}",
                () => OpenBreakGlassSecretRecord(customerId, pendingSecretId, customerName)),
            new ContextualTabSpec
            {
                Id = "break-glass-secret",
                Label = "Break-Glass",
                Groups =
                {
                    new RibbonGroupSpec
                    {
                        Label = "Actions",
                        Large = { new RibbonCommandSpec
                        {
                            Label = isPending ? "Force reset & reissue" : "View audit trail",
                            Intent = RibbonIntent.Record,
                            OnSelect = () => { },
                        } },
                    },
                },
            },
            onSearchEverything: () => PaletteOverlay.Open());

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>Performs the real POST .../admin-override with the operator-supplied reason and
    /// optional reissue recipients, then opens a result record stating the honest outcome — the new
    /// pending-secret id and reissue count on success, or the server's own refusal message (409
    /// still-live links / not awaiting delivery / write-back-gate block, 5xx) on failure. Reason is
    /// validated client-side first to avoid a guaranteed 400.</summary>
    private void RunBreakGlassOverride(int customerId, int pendingSecretId, string? customerName, Func<string> reasonGetter, Func<string> emailsGetter)
    {
        var reason = (reasonGetter() ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(reason))
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "break-glass-override-result",
                Id = $"break-glass-override-{pendingSecretId}",
                Eyebrow = "Break-Glass Override",
                Title = "Reason required",
                Sub = customerName ?? $"Customer #{customerId}",
                Body = ("Not submitted", "An override reason is required. Enter one on the pending secret, then arm the action again."),
            });
            return;
        }

        var emails = (emailsGetter() ?? string.Empty)
            .Split(new[] { ',', ';', '\n' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(e => e.Trim())
            .Where(e => e.Length > 0)
            .ToList();

        try
        {
            var result = _breakGlassService
                .AdminOverrideAsync(customerId, pendingSecretId, reason, emails.Count > 0 ? emails : null)
                .GetAwaiter().GetResult();

            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "break-glass-override-result",
                Id = $"break-glass-override-{pendingSecretId}",
                Eyebrow = "Break-Glass Override",
                Title = "Override complete",
                Sub = customerName ?? $"Customer #{customerId}",
                Facts =
                {
                    new WorkspaceFact { Label = "New secret", Value = $"#{result.NewPendingSecretId}" },
                    new WorkspaceFact { Label = "Reissued", Value = result.Reissued.ToString() },
                    new WorkspaceFact { Label = "Sent", Value = result.Sent.ToString() },
                },
                Body = ("What happened",
                    $"The old pending secret #{pendingSecretId} was force-reset and a replacement (#{result.NewPendingSecretId}) "
                    + $"was issued and sent to {result.Sent} recipient(s). The override is recorded in this customer's audit trail."),
                Actions =
                {
                    new WorkspaceAction { Label = "View override audit trail", OnSelect = () => OpenBreakGlassAuditRecord(customerId, customerName) },
                    new WorkspaceAction { Label = "Back to pending requests", OnSelect = () => OpenBreakGlassPendingList() },
                },
            });
        }
        catch (Exception ex)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "break-glass-override-result",
                Id = $"break-glass-override-{pendingSecretId}",
                Eyebrow = "Break-Glass Override",
                Title = "Override refused",
                Sub = customerName ?? $"Customer #{customerId}",
                Body = ("Server response", DescribeBreakGlassError(ex)),
                Actions =
                {
                    new WorkspaceAction { Label = "Back to secret", OnSelect = () => OpenBreakGlassSecretRecord(customerId, pendingSecretId, customerName) },
                },
            });
        }
    }

    /// <summary>Opens the per-customer override audit trail (GET .../break-glass/audit) — #3480's
    /// "audit trail view" checklist item — as a full-panel record workspace list.</summary>
    private void OpenBreakGlassAuditRecord(int customerId, string? customerName)
    {
        System.Collections.Generic.IReadOnlyList<Models.BreakGlassAuditEntry> audit;
        try
        {
            audit = _breakGlassService.GetAuditAsync(customerId).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "break-glass-audit",
                Id = $"break-glass-audit-{customerId}",
                Eyebrow = "Break-Glass Audit",
                Title = customerName ?? $"Customer #{customerId}",
                Sub = "Could not load",
                Body = ("Error", DescribeBreakGlassError(ex)),
            });
            return;
        }

        _shellRegistry.OpenRecord(new RecordWorkspaceSpec
        {
            Kind = "break-glass-audit",
            Id = $"break-glass-audit-{customerId}",
            Eyebrow = "Break-Glass Audit",
            Title = $"Override audit — {customerName ?? $"Customer #{customerId}"}",
            Sub = audit.Count == 0 ? "No admin overrides recorded for this customer" : $"{audit.Count} override(s), most recent first",
            List = audit.Count == 0
                ? null
                : ("Overrides", audit.Select(a => new WorkspaceListRow
                {
                    Id = a.Id.ToString(),
                    Name = a.AdminName,
                    Sub = string.IsNullOrEmpty(a.Reason) ? "(no reason recorded)" : a.Reason!,
                    Right = a.CreatedAt.ToLocalTime().ToString("g"),
                    OnSelect = () => { }, // audit rows are terminal display
                }).ToList()),
        });
    }

    /// <summary>Opens the full per-customer break-glass history (GET .../customers/:id/break-glass —
    /// any status), the "per-tenant list" half of #3480's first checklist item. Rows drill back into
    /// the same per-secret detail record.</summary>
    private void OpenBreakGlassHistoryRecord(int customerId, string? customerName)
    {
        System.Collections.Generic.IReadOnlyList<Models.BreakGlassSecretHistoryItem> history;
        try
        {
            history = _breakGlassService.GetCustomerHistoryAsync(customerId).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "break-glass-history",
                Id = $"break-glass-history-{customerId}",
                Eyebrow = "Break-Glass",
                Title = customerName ?? $"Customer #{customerId}",
                Sub = "Could not load",
                Body = ("Error", DescribeBreakGlassError(ex)),
            });
            return;
        }

        _shellRegistry.OpenRecord(new RecordWorkspaceSpec
        {
            Kind = "break-glass-history",
            Id = $"break-glass-history-{customerId}",
            Eyebrow = "Break-Glass",
            Title = $"Break-Glass history — {customerName ?? $"Customer #{customerId}"}",
            Sub = history.Count == 0 ? "No break-glass secrets on record for this customer" : $"{history.Count} secret(s), most recent first",
            List = history.Count == 0
                ? null
                : ("Secrets", history.Select(h => new WorkspaceListRow
                {
                    Id = h.PendingSecretId.ToString(),
                    Name = $"Secret #{h.PendingSecretId}",
                    Sub = $"{h.Status} · {h.CreatedAt.ToLocalTime():g}"
                          + (string.IsNullOrEmpty(h.DeliveredToEmail) ? "" : $" · {h.DeliveredToEmail}"),
                    Right = h.DeliveredAt.HasValue ? "delivered" : h.Status,
                    OnSelect = () => OpenBreakGlassSecretRecord(customerId, h.PendingSecretId, customerName),
                }).ToList()),
        });
    }

    /// <summary>Best-effort human message from a <see cref="BreakGlassServiceException"/> (which
    /// already parses the route's <c>{ error, detail, blockedBy }</c>) or any other transport error.</summary>
    private static string DescribeBreakGlassError(Exception ex) => ex switch
    {
        BreakGlassServiceException bge => bge.Message,
        _ => ex.Message,
    };

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
        // Session Notes (#3472) — the change-control-linked half. attestationNote already
        // exists, real, on the server's own POST .../human-action route; the only gap was
        // this client never collecting one. Captured here (write-through, no save step) and
        // threaded into RecordHumanActionAsync's real attestationNote parameter below.
        var attestationNote = string.Empty;

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
            Edits =
            {
                new WorkspaceEdit
                {
                    Key = "attestationNote",
                    Label = "Session Note",
                    Value = string.Empty,
                    OnChange = v => attestationNote = v,
                },
            },
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
                        _ = _changeControlService.RecordHumanActionAsync(
                            numericId.Value,
                            attestationNote: string.IsNullOrWhiteSpace(attestationNote) ? null : attestationNote);
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

    // ---- POA&Ms (#3481) --------------------------------------------------------------------

    /// <summary>Real rows from GET /api/msp/poams, filtered client-side to the active tenant —
    /// same approach <see cref="BuildChangeRequestRows"/> already takes against
    /// GET /api/msp/change-requests (msp-poams.ts's list route has no per-tenant filter either).
    /// Selecting a row opens the full-panel workspace with real milestone CRUD + a confirm-armed
    /// cancel action — the same gallery → contextual tab → workspace contract #3493 proved.</summary>
    private System.Collections.Generic.IReadOnlyList<GalleryRowSpec> BuildPoamRows()
    {
        var tenant = _tenantService.CurrentTenant;
        if (tenant == null) return Array.Empty<GalleryRowSpec>();

        System.Collections.Generic.IReadOnlyList<Poam> poams;
        try
        {
            poams = _poamsService.GetPoamsAsync().GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            // Real, honest failure — most likely #3501 (no auth/session mechanism yet) or a
            // 403 (signed in without the ladder.msp-operator role), not a bug in this client.
            return new[]
            {
                new GalleryRowSpec { Id = "error", Name = $"Could not load: {ex.Message}", OnSelect = () => { } },
            };
        }

        return poams
            .Where(p => string.Equals(p.TenantId, tenant.TenantGuid, StringComparison.OrdinalIgnoreCase))
            .Select(p => new GalleryRowSpec
            {
                Id = p.PoamId,
                Tile = PoamStatusTile(p.Status),
                Name = p.Title,
                Sub = $"{PoamStatusLabel(p.Status)} · due {p.ScheduledCompletionDate}",
                OnSelect = () => OpenPoamRecord(p.PoamId),
            })
            .ToList();
    }

    private static string PoamStatusTile(string status) => status switch
    {
        "draft" => "DR",
        "pending_signature" => "PS",
        "active" => "AC",
        "completed" => "CO",
        "cancelled" => "CX",
        "converted_to_risk_acceptance" => "CV",
        _ => "—",
    };

    private static string PoamStatusLabel(string status) => status switch
    {
        "draft" => "Draft",
        "pending_signature" => "Pending signature",
        "active" => "Active",
        "completed" => "Completed",
        "cancelled" => "Cancelled",
        "converted_to_risk_acceptance" => "Converted to risk acceptance",
        _ => status,
    };

    /// <summary>Real GET /api/msp/poams/:poamId (includes milestones) rendered as the full-panel
    /// workspace: write-through Edits for the narrative/schedule fields the route allows editing,
    /// a confirm-armed Cancel action, and the real milestone list. "Add Milestone" is a
    /// Record-intent contextual-tab command (UI_RULES.md §2) — milestone CRUD is a specific
    /// record's action, never fixed-tab legal. A terminal plan (cancelled/completed/converted)
    /// renders read-only — msp-poams.ts's own route refuses further edits on one anyway.</summary>
    private void OpenPoamRecord(string poamId)
    {
        Poam poam;
        try
        {
            poam = _poamsService.GetPoamAsync(poamId).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] Could not load {poamId}: {ex.Message}");
            return;
        }

        var isTerminal = poam.Status is "cancelled" or "completed" or "converted_to_risk_acceptance";
        var milestones = poam.Milestones ?? new System.Collections.Generic.List<PoamMilestone>();

        var spec = new RecordWorkspaceSpec
        {
            Kind = "poam",
            Id = poam.PoamId,
            Eyebrow = "POA&M",
            Title = poam.Title,
            Sub = $"{poam.TenantName} · {poam.PrimaryDomain}",
            Facts =
            {
                new WorkspaceFact { Label = "Status", Value = PoamStatusLabel(poam.Status) },
                new WorkspaceFact { Label = "Original due", Value = poam.OriginalScheduledCompletionDate },
                new WorkspaceFact { Label = "Check", Value = poam.CheckKey ?? "(none)" },
            },
            Edits = isTerminal
                ? new System.Collections.Generic.List<WorkspaceEdit>()
                : new System.Collections.Generic.List<WorkspaceEdit>
                {
                    new WorkspaceEdit
                    {
                        Key = "scheduledCompletionDate",
                        Label = "Scheduled completion (YYYY-MM-DD)",
                        Value = poam.ScheduledCompletionDate,
                        OnChange = v => UpdatePoamField(poamId, "scheduledCompletionDate", v),
                    },
                    new WorkspaceEdit
                    {
                        Key = "interimCompensatingControl",
                        Label = "Interim compensating control",
                        Value = poam.InterimCompensatingControl,
                        OnChange = v => UpdatePoamField(poamId, "interimCompensatingControl", v),
                    },
                    new WorkspaceEdit
                    {
                        Key = "resourcesRequired",
                        Label = "Resources required",
                        Value = poam.ResourcesRequired,
                        OnChange = v => UpdatePoamField(poamId, "resourcesRequired", v),
                    },
                },
            Body = ("Weakness", poam.WeaknessDescription),
            List = ("Milestones", milestones
                .OrderBy(m => m.SortOrder)
                .ThenBy(m => m.Id)
                .Select(m => new WorkspaceListRow
                {
                    Id = m.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    Name = m.Title,
                    Sub = $"due {m.DueDate}",
                    Right = m.Status == "completed" ? "Completed" : "Pending",
                    OnSelect = () => OpenMilestoneRecord(poamId, m),
                })
                .ToList()),
            Actions = isTerminal
                ? new System.Collections.Generic.List<WorkspaceAction>()
                : new System.Collections.Generic.List<WorkspaceAction>
                {
                    new WorkspaceAction
                    {
                        Label = "Cancel POA&M",
                        Confirm = true,
                        Danger = true,
                        OnSelect = () => CancelPoam(poamId),
                    },
                },
        };

        _shellRegistry.OpenContextual(
            new TrailEntry("poam", poam.PoamId, poam.Title, () => OpenPoamRecord(poamId)),
            new ContextualTabSpec
            {
                Id = "poam",
                Label = "POA&M",
                Groups =
                {
                    new RibbonGroupSpec
                    {
                        Label = "Milestones",
                        Large = { new RibbonCommandSpec
                        {
                            Label = "Add Milestone",
                            Intent = RibbonIntent.Record,
                            OnSelect = () => OpenCreateMilestoneRecord(poamId),
                        } },
                    },
                },
            },
            onSearchEverything: () => PaletteOverlay.Open());

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>One write-through field on an open POA&amp;M — PATCH just that key, then
    /// re-open the record from the server's real, current state (never an optimistic local
    /// mutation) so a 409 (already cancelled/completed underneath the operator) surfaces
    /// honestly instead of silently "succeeding" in the UI.</summary>
    private void UpdatePoamField(string poamId, string key, string value)
    {
        try
        {
            _poamsService.UpdatePoamAsync(poamId, new System.Collections.Generic.Dictionary<string, object?> { [key] = value }).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] Update failed: {ex.Message}");
        }
        OpenPoamRecord(poamId);
    }

    private void CancelPoam(string poamId)
    {
        try
        {
            var result = _poamsService.CancelPoamAsync(poamId).GetAwaiter().GetResult();
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] {result.Message}");
        }
        catch (Exception ex)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] Cancel failed: {ex.Message}");
        }
        OpenPoamRecord(poamId);
    }

    /// <summary>Home-tab "New POA&amp;M" — real POST against the active tenant. Same gallery-less
    /// "workspace with locally-collected Edits + a confirm-armed Create Action" shape
    /// <see cref="OpenLogAdHocHoursRecord"/> already uses, since there is no id to PATCH against
    /// until the POST actually returns one.</summary>
    private void OpenCreatePoamRecord()
    {
        var tenant = _tenantService.CurrentTenant;
        if (tenant == null)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "poam-new",
                Id = "blocked",
                Eyebrow = "POA&M",
                Title = "New POA&M",
                Sub = "Select a tenant first",
            });
            return;
        }

        var fields = new System.Collections.Generic.Dictionary<string, string>
        {
            ["title"] = string.Empty,
            ["weaknessDescription"] = string.Empty,
            ["primaryDomain"] = string.Empty,
            ["scheduledCompletionDate"] = string.Empty,
            ["interimCompensatingControl"] = string.Empty,
            ["resourcesRequired"] = string.Empty,
            ["status"] = "draft",
        };

        var spec = new RecordWorkspaceSpec
        {
            Kind = "poam-new",
            Id = "new",
            Eyebrow = "POA&M",
            Title = "New POA&M",
            Sub = tenant.Name,
            Edits =
            {
                new WorkspaceEdit { Key = "title", Label = "Title", Value = string.Empty, OnChange = v => fields["title"] = v },
                new WorkspaceEdit { Key = "weaknessDescription", Label = "Weakness description", Value = string.Empty, OnChange = v => fields["weaknessDescription"] = v },
                new WorkspaceEdit { Key = "primaryDomain", Label = "Primary domain", Value = string.Empty, OnChange = v => fields["primaryDomain"] = v },
                new WorkspaceEdit { Key = "scheduledCompletionDate", Label = "Scheduled completion (YYYY-MM-DD)", Value = string.Empty, OnChange = v => fields["scheduledCompletionDate"] = v },
                new WorkspaceEdit { Key = "interimCompensatingControl", Label = "Interim compensating control", Value = string.Empty, OnChange = v => fields["interimCompensatingControl"] = v },
                new WorkspaceEdit { Key = "resourcesRequired", Label = "Resources required", Value = string.Empty, OnChange = v => fields["resourcesRequired"] = v },
                new WorkspaceEdit
                {
                    Key = "status",
                    Label = "Status",
                    Value = "draft",
                    Options = new() { "draft", "pending_signature" },
                    OnChange = v => fields["status"] = v,
                },
            },
            Actions =
            {
                new WorkspaceAction
                {
                    Label = "Create POA&M",
                    Confirm = true,
                    OnSelect = () => SubmitCreatePoam(tenant, fields),
                },
            },
        };

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>Real POST — validates the fields the server's own <c>createPoamSchema</c>
    /// requires non-empty (title, weaknessDescription, a valid YYYY-MM-DD
    /// scheduledCompletionDate, interimCompensatingControl, resourcesRequired) client-side
    /// before sending, same discipline <see cref="SubmitAdHocHours"/> already applies.</summary>
    private void SubmitCreatePoam(Tenant tenant, System.Collections.Generic.Dictionary<string, string> fields)
    {
        var dateOk = System.Text.RegularExpressions.Regex.IsMatch(fields["scheduledCompletionDate"], @"^\d{4}-\d{2}-\d{2}$");
        string? missing = string.IsNullOrWhiteSpace(fields["title"]) ? "Title"
            : string.IsNullOrWhiteSpace(fields["weaknessDescription"]) ? "Weakness description"
            : !dateOk ? "Scheduled completion (must be YYYY-MM-DD)"
            : string.IsNullOrWhiteSpace(fields["interimCompensatingControl"]) ? "Interim compensating control"
            : string.IsNullOrWhiteSpace(fields["resourcesRequired"]) ? "Resources required"
            : null;

        if (missing != null)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] {missing} is required — nothing created.");
            return;
        }

        ShowDocument(ConsolePanel);
        ConsolePanel.AppendExternal($"[POA&M] Creating \"{fields["title"]}\" for {tenant.Name}…");

        try
        {
            var result = _poamsService.CreatePoamAsync(
                tenant.TenantGuid,
                tenant.Name,
                fields["primaryDomain"],
                fields["title"],
                fields["weaknessDescription"],
                fields["scheduledCompletionDate"],
                fields["interimCompensatingControl"],
                fields["resourcesRequired"],
                fields["status"]).GetAwaiter().GetResult();

            ConsolePanel.AppendExternal($"[POA&M] {result.Message} · {result.PoamId}");
            OpenPoamRecord(result.PoamId);
        }
        catch (Exception ex)
        {
            ConsolePanel.AppendExternal($"[POA&M] Create failed: {ex.Message}");
        }
    }

    /// <summary>Contextual-tab "Add Milestone" (Record intent — UI_RULES.md §2). Real POST
    /// against the open POA&amp;M; on success reopens the parent record so the new milestone
    /// shows in the real, server-returned list rather than an optimistically-inserted local row.</summary>
    private void OpenCreateMilestoneRecord(string poamId)
    {
        var fields = new System.Collections.Generic.Dictionary<string, string>
        {
            ["title"] = string.Empty,
            ["description"] = string.Empty,
            ["dueDate"] = string.Empty,
        };

        var spec = new RecordWorkspaceSpec
        {
            Kind = "poam-milestone-new",
            Id = "new",
            Eyebrow = "POA&M Milestone",
            Title = "New Milestone",
            Sub = poamId,
            Edits =
            {
                new WorkspaceEdit { Key = "title", Label = "Title", Value = string.Empty, OnChange = v => fields["title"] = v },
                new WorkspaceEdit { Key = "description", Label = "Description", Value = string.Empty, OnChange = v => fields["description"] = v },
                new WorkspaceEdit { Key = "dueDate", Label = "Due (YYYY-MM-DD)", Value = string.Empty, OnChange = v => fields["dueDate"] = v },
            },
            Actions =
            {
                new WorkspaceAction
                {
                    Label = "Add Milestone",
                    Confirm = true,
                    OnSelect = () => SubmitCreateMilestone(poamId, fields),
                },
            },
        };

        _shellRegistry.OpenRecord(spec);
    }

    private void SubmitCreateMilestone(string poamId, System.Collections.Generic.Dictionary<string, string> fields)
    {
        var dateOk = System.Text.RegularExpressions.Regex.IsMatch(fields["dueDate"], @"^\d{4}-\d{2}-\d{2}$");
        string? missing = string.IsNullOrWhiteSpace(fields["title"]) ? "Title"
            : !dateOk ? "Due date (must be YYYY-MM-DD)"
            : null;

        if (missing != null)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] {missing} is required — milestone not added.");
            return;
        }

        try
        {
            var result = _poamsService.CreateMilestoneAsync(poamId, fields["title"], Nullify(fields["description"]), fields["dueDate"]).GetAwaiter().GetResult();
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] {result.Message} · milestone #{result.Id}");
        }
        catch (Exception ex)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] Add milestone failed: {ex.Message}");
        }

        OpenPoamRecord(poamId);
    }

    /// <summary>Real milestone detail — write-through Edits + Mark Complete while
    /// <c>pending</c> (msp-poams.ts refuses any further edit once <c>completed</c> — see the
    /// route's own write-once discipline), Delete always available. Every mutation reopens the
    /// parent POA&amp;M record rather than the milestone itself, since that's where the real,
    /// current milestone list lives.</summary>
    private void OpenMilestoneRecord(string poamId, PoamMilestone milestone)
    {
        var isPending = milestone.Status == "pending";

        var spec = new RecordWorkspaceSpec
        {
            Kind = "poam-milestone",
            Id = milestone.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Eyebrow = "POA&M Milestone",
            Title = milestone.Title,
            Sub = poamId,
            Facts =
            {
                new WorkspaceFact { Label = "Status", Value = milestone.Status == "completed" ? "Completed" : "Pending" },
                new WorkspaceFact { Label = "Due", Value = milestone.DueDate },
            },
            Edits = isPending
                ? new System.Collections.Generic.List<WorkspaceEdit>
                {
                    new WorkspaceEdit
                    {
                        Key = "title",
                        Label = "Title",
                        Value = milestone.Title,
                        OnChange = v => UpdateMilestoneField(poamId, milestone.Id, "title", v),
                    },
                    new WorkspaceEdit
                    {
                        Key = "description",
                        Label = "Description",
                        Value = milestone.Description ?? string.Empty,
                        OnChange = v => UpdateMilestoneField(poamId, milestone.Id, "description", v),
                    },
                    new WorkspaceEdit
                    {
                        Key = "dueDate",
                        Label = "Due (YYYY-MM-DD)",
                        Value = milestone.DueDate,
                        OnChange = v => UpdateMilestoneField(poamId, milestone.Id, "dueDate", v),
                    },
                }
                : new System.Collections.Generic.List<WorkspaceEdit>(),
            Body = !string.IsNullOrEmpty(milestone.Description) ? ("Description", milestone.Description) : null,
            Actions =
            {
                new WorkspaceAction
                {
                    Label = "Delete",
                    Confirm = true,
                    Danger = true,
                    OnSelect = () => DeleteMilestone(poamId, milestone.Id),
                },
            },
        };

        if (isPending)
        {
            spec.Actions.Insert(0, new WorkspaceAction
            {
                Label = "Mark Complete",
                Confirm = true,
                OnSelect = () => MarkMilestoneComplete(poamId, milestone.Id),
            });
        }

        _shellRegistry.OpenRecord(spec);
    }

    private void UpdateMilestoneField(string poamId, int milestoneId, string key, string value)
    {
        try
        {
            _poamsService.UpdateMilestoneAsync(poamId, milestoneId, new System.Collections.Generic.Dictionary<string, object?> { [key] = value }).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] Milestone update failed: {ex.Message}");
        }
        OpenPoamRecord(poamId);
    }

    private void MarkMilestoneComplete(string poamId, int milestoneId)
    {
        try
        {
            var result = _poamsService.UpdateMilestoneAsync(poamId, milestoneId, new System.Collections.Generic.Dictionary<string, object?> { ["status"] = "completed" }).GetAwaiter().GetResult();
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] {result.Message}");
        }
        catch (Exception ex)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] Mark complete failed: {ex.Message}");
        }
        OpenPoamRecord(poamId);
    }

    private void DeleteMilestone(string poamId, int milestoneId)
    {
        try
        {
            var result = _poamsService.DeleteMilestoneAsync(poamId, milestoneId).GetAwaiter().GetResult();
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] {result.Message}");
        }
        catch (Exception ex)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] Delete failed: {ex.Message}");
        }
        OpenPoamRecord(poamId);
    }

    /// <summary>The ad-hoc half of #3464's real hour-logging scope — work not tied to a
    /// remediation-tracker step or a change request. Same gallery-less
    /// "open a workspace with write-through Edits + a confirm-armed Action" shape as
    /// <see cref="OpenScriptLibraryRecord"/>, targeting
    /// <see cref="IAdminRetainerService.LogUnscopedHoursAsync"/> instead. Real customerId
    /// resolution is the same remaining gap <see cref="TryResolveLaunchControlScope"/> already
    /// documents honestly (TenantService is fixture data — #3502/#3505/#3540) — this opens a
    /// stated-blocked workspace rather than guessing a customer id.</summary>
    private void OpenLogAdHocHoursRecord()
    {
        if (!TryResolveLaunchControlScope(out _, out var customerId))
        {
            var reason = !_authService.IsAuthenticated
                ? "Sign in to log retainer hours"
                : "Logging hours needs a real customer id — TenantService is fixture data (#3502/#3505/#3540)";
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "retainer-unscoped-entry",
                Id = "blocked",
                Eyebrow = "Retainer Hours",
                Title = "Log Ad-Hoc Hours",
                Sub = reason,
            });
            return;
        }

        var fields = new System.Collections.Generic.Dictionary<string, string>
        {
            ["item"] = string.Empty,
            ["hours"] = string.Empty,
            ["pillar"] = string.Empty,
            ["finding"] = string.Empty,
            ["outcome"] = string.Empty,
        };

        var spec = new RecordWorkspaceSpec
        {
            Kind = "retainer-unscoped-entry",
            Id = "new",
            Eyebrow = "Retainer Hours",
            Title = "Log Ad-Hoc Hours",
            Sub = "Work not tied to a tracker step or change request",
            Edits =
            {
                new WorkspaceEdit { Key = "item", Label = "Item", Value = string.Empty, OnChange = v => fields["item"] = v },
                new WorkspaceEdit { Key = "hours", Label = "Hours", Value = string.Empty, OnChange = v => fields["hours"] = v },
                new WorkspaceEdit { Key = "pillar", Label = "Pillar", Value = string.Empty, OnChange = v => fields["pillar"] = v },
                new WorkspaceEdit { Key = "finding", Label = "Finding", Value = string.Empty, OnChange = v => fields["finding"] = v },
                new WorkspaceEdit { Key = "outcome", Label = "Outcome", Value = string.Empty, OnChange = v => fields["outcome"] = v },
            },
            Actions =
            {
                new WorkspaceAction
                {
                    Label = "Log Hours",
                    Confirm = true,
                    OnSelect = () => SubmitAdHocHours(customerId, fields),
                },
            },
        };

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>Real POST — validates the two required fields client-side (matching the server's
    /// own `unscopedSchema`: non-empty item, non-negative hours) and reports the real result to
    /// the Console pane, the same feedback channel <see cref="RunScriptLibraryAction"/> already
    /// uses for a real POST's outcome.</summary>
    private void SubmitAdHocHours(int customerId, System.Collections.Generic.Dictionary<string, string> fields)
    {
        var item = fields["item"];
        if (string.IsNullOrWhiteSpace(item))
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal("[Retainer Hours] Item is required — nothing logged.");
            return;
        }

        if (!double.TryParse(fields["hours"], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var hours) || hours < 0)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[Retainer Hours] \"{fields["hours"]}\" is not a valid non-negative hours value — nothing logged.");
            return;
        }

        ShowDocument(ConsolePanel);
        ConsolePanel.AppendExternal($"[Retainer Hours] Logging {hours}h — \"{item}\"…");

        try
        {
            var entry = _adminRetainerService
                .LogUnscopedHoursAsync(
                    customerId,
                    item,
                    hours,
                    Nullify(fields["pillar"]),
                    Nullify(fields["finding"]),
                    Nullify(fields["outcome"]))
                .GetAwaiter().GetResult();

            ConsolePanel.AppendExternal($"[Retainer Hours] Logged entry #{entry.Id} · {entry.Hours}h · {entry.State}");
        }
        catch (AdminRetainerException ex)
        {
            // Real, honest failure — most likely a 403 (signed in without the `admin` role this
            // route requires, see IAdminRetainerService's own doc comment), not a bug in this
            // client.
            ConsolePanel.AppendExternal($"[Retainer Hours] Log failed: {ex.Message}");
        }
        catch (Exception ex)
        {
            ConsolePanel.AppendExternal($"[Retainer Hours] Exception: {ex.Message}");
        }
    }

    private static string? Nullify(string value) => string.IsNullOrWhiteSpace(value) ? null : value;

    /// <summary>#3471's unified item browser — both real sources (checklist-style remediation
    /// tracker steps and catalog-backed change requests) in one gallery, real instruction/action
    /// text per item (the issue's own words), instead of the two separate galleries the shell's
    /// own #3493 proof-of-concept session first added for Change Requests alone.</summary>
    private System.Collections.Generic.IReadOnlyList<GalleryRowSpec> BuildRemediationPlanRows()
    {
        var rows = new System.Collections.Generic.List<GalleryRowSpec>();
        rows.AddRange(BuildTrackerStepRows());
        rows.AddRange(BuildChangeRequestRows());
        return rows;
    }

    /// <summary>Real numeric `tenants.id` resolution for the remediation tracker's
    /// customer-keyed endpoints. Returns false today: <see cref="ITenantService"/> is fixture
    /// data (fake tenant guids, no numeric id at all) — filed as #3540, the same underlying gap
    /// <see cref="TryResolveLaunchControlScope"/> already documents for Script Library. Never
    /// guesses an id; once #3540 gives this app a real customer source, this is the one place to
    /// wire it in.</summary>
    private bool TryResolveTrackerCustomerId(out int customerId)
    {
        customerId = 0;
        return false;
    }

    /// <summary>Checklist-style half of #3471's two sources. Real rows from
    /// GET /api/msp/customers/:customerId/remediation-tracker/catalogue — all 28 real steps with
    /// their real title/pillar text, joined server-side with this customer's real state. Today
    /// there is no real customer id to scope the call to (#3540), so this states that honestly as
    /// a single disabled row — same pattern <see cref="BuildScriptLibraryRows"/> already uses for
    /// the identical underlying gap — rather than guessing one.</summary>
    private System.Collections.Generic.IReadOnlyList<GalleryRowSpec> BuildTrackerStepRows()
    {
        if (!TryResolveTrackerCustomerId(out var customerId))
        {
            return new[]
            {
                new GalleryRowSpec
                {
                    Id = "tracker-blocked",
                    Name = "Remediation tracker needs a real customer id — TenantService is fixture data (#3540)",
                    OnSelect = () => { },
                },
            };
        }

        RemediationTrackerCatalogueResponse catalogue;
        try
        {
            catalogue = _remediationTrackerService.GetCatalogueAsync(customerId).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            // Real, honest failure — most likely 401/403 (auth still not wired) or a customer
            // outside the caller's book, not a bug in this client. One disabled row, not a fake one.
            return new[]
            {
                new GalleryRowSpec { Id = "tracker-error", Name = $"Could not load remediation tracker: {ex.Message}", OnSelect = () => { } },
            };
        }

        return catalogue.Steps.Select(step => new GalleryRowSpec
        {
            Id = $"tracker:{step.StepId}",
            Tile = step.Pillar.Length >= 2 ? step.Pillar[..2].ToUpperInvariant() : step.Pillar.ToUpperInvariant(),
            Name = step.Title,
            Sub = $"Tracker · {step.StatusLabel}",
            OnSelect = () => OpenTrackerStepRecord(step, catalogue, customerId),
        }).ToList();
    }

    /// <summary>Opens the record workspace for one remediation tracker step. Real facts from the
    /// step's own state; a write-through status cycle-button sourced from the endpoint's own real
    /// <see cref="RemediationTrackerCatalogueResponse.AssignableStatuses"/> (never a client-invented
    /// display list) that calls <see cref="IRemediationTrackerService.SetStepStatusAsync"/> for
    /// real, then re-opens itself with the server's own returned state so the workspace never
    /// shows a stale value after a write. "accepted_risk" is not offered — same rule the server's
    /// own PUT enforces, since it is the customer's own signed decline-to-risk fact, never an MSP
    /// operator's to set. Same gallery → contextual tab → workspace contract #3493 proved with
    /// Change Requests.</summary>
    private void OpenTrackerStepRecord(RemediationTrackerCatalogueStep step, RemediationTrackerCatalogueResponse catalogue, int customerId)
    {
        var spec = new RecordWorkspaceSpec
        {
            Kind = "remediation-tracker-step",
            Id = step.StepId,
            Eyebrow = "Remediation Tracker",
            Title = step.Title,
            Sub = $"{step.StepLabel} · {step.Pillar}",
            Facts =
            {
                new WorkspaceFact { Label = "Status", Value = step.StatusLabel },
                new WorkspaceFact { Label = "Verification", Value = step.VerificationState },
                new WorkspaceFact { Label = "Terminal state", Value = step.TerminalState },
                new WorkspaceFact { Label = "Updated", Value = step.UpdatedAt?.ToLocalTime().ToString("g") ?? "(never)" },
            },
        };

        if (step.Status == "accepted_risk")
        {
            spec.Facts.Add(new WorkspaceFact
            {
                Label = "Note",
                Value = "accepted_risk is a signed customer fact — not settable by an MSP operator",
                Prose = true,
            });
        }
        else
        {
            var currentLabel = catalogue.AssignableStatuses.FirstOrDefault(s => s.Status == step.Status)?.Label ?? step.StatusLabel;
            spec.Edits.Add(new WorkspaceEdit
            {
                Key = "status",
                Label = "Status",
                Value = currentLabel,
                Options = catalogue.AssignableStatuses.Select(s => s.Label).ToList(),
                OnChange = newLabel =>
                {
                    var target = catalogue.AssignableStatuses.FirstOrDefault(s => s.Label == newLabel);
                    if (target == null) return;

                    try
                    {
                        var updated = _remediationTrackerService.SetStepStatusAsync(customerId, step.StepId, target.Status).GetAwaiter().GetResult();
                        step.Status = updated.Status;
                        step.StatusLabel = catalogue.StatusLabels.TryGetValue(updated.Status, out var lbl) ? lbl : updated.Status;
                        step.CompletedAt = updated.CompletedAt;
                        step.UpdatedAt = updated.UpdatedAt;
                        step.VerificationState = updated.VerificationState;
                        step.VerifiedAt = updated.VerifiedAt;
                        step.TerminalState = updated.TerminalState;
                        OpenTrackerStepRecord(step, catalogue, customerId);
                    }
                    catch (RemediationTrackerException ex)
                    {
                        // Real, honest failure (e.g. the server's own "accepted_risk cannot be set
                        // directly" 400) surfaced in place rather than swallowed.
                        _shellRegistry.OpenRecord(new RecordWorkspaceSpec
                        {
                            Kind = "remediation-tracker-step",
                            Id = step.StepId,
                            Eyebrow = "Remediation Tracker",
                            Title = step.Title,
                            Sub = $"Update failed: {ex.Message}",
                        });
                    }
                },
            });
        }

        // Session Notes (#3472) — a free-text write-through note, independent of the status
        // edit above and calling its own SetStepNoteAsync endpoint so writing a note never
        // resets verificationState the way a status change deliberately does. Available
        // regardless of status, including accepted_risk (the signed fact itself is not
        // settable by an MSP operator, but a note about it is). Auto-tagged with this
        // record's context (tenant/step) for free — ShellRegistry.RecordOpened already
        // calls ActivityContextService.RecordOpen for every workspace this opens.
        spec.Edits.Add(new WorkspaceEdit
        {
            Key = "note",
            Label = "Session Note",
            Value = step.Note ?? string.Empty,
            OnChange = newValue =>
            {
                try
                {
                    var updated = _remediationTrackerService.SetStepNoteAsync(customerId, step.StepId, newValue).GetAwaiter().GetResult();
                    step.Note = updated.Note;
                }
                catch (RemediationTrackerException)
                {
                    // Real, honest failure surfaced via the Console pane rather than swallowed —
                    // same pattern SubmitAdHocHours uses for a failed write.
                    ShowDocument(ConsolePanel);
                    ConsolePanel.AppendExternal($"[Session Notes] Could not save note for {step.StepId} — try again.");
                }
            },
        });

        _shellRegistry.OpenContextual(
            new TrailEntry("remediation-tracker-step", step.StepId, step.Title, () => OpenTrackerStepRecord(step, catalogue, customerId)),
            new ContextualTabSpec
            {
                Id = "remediation-tracker-step",
                Label = "Remediation Step",
                Groups =
                {
                    new RibbonGroupSpec
                    {
                        Label = "Actions",
                        Large = { new RibbonCommandSpec
                        {
                            Label = "Update status",
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

    /// <summary>Activity Layer (#3463)'s own review/tagging UI — a daily local timeline of
    /// tenant switches, console commands, records opened, and external-app foreground switches.
    /// Same full-panel record-workspace pattern as <see cref="OpenConsoleHistoryRecord"/>; for
    /// Shane's own reference, local-only, never synced anywhere.</summary>
    private void OpenActivityTimelineRecord()
    {
        var today = DateOnly.FromDateTime(DateTime.Now);
        var events = _activityContextService.GetForDay(today);

        var spec = new RecordWorkspaceSpec
        {
            Kind = "activity-timeline",
            Id = $"activity-timeline-{today:yyyy-MM-dd}",
            Eyebrow = "Activity",
            Title = $"Today — {today:MMM d}",
            Sub = events.Count == 0 ? "No activity recorded yet today" : $"{events.Count} event(s), most recent first",
            List = events.Count == 0
                ? null
                : ("Events", events.Select(e => new WorkspaceListRow
                {
                    Id = e.Id.ToString(),
                    Name = (string.IsNullOrEmpty(e.Tag) ? "" : $"[{e.Tag}] ") + e.Detail,
                    Sub = $"{KindLabel(e.Kind)} · {(string.IsNullOrEmpty(e.TenantName) ? "(no tenant)" : e.TenantName)}",
                    Right = e.TimestampUtc.ToLocalTime().ToString("h:mm tt"),
                    OnSelect = () => OpenActivityEventDetail(e.Id),
                }).ToList()),
        };

        _shellRegistry.OpenRecord(spec);
    }

    private static string KindLabel(string kind) => kind switch
    {
        "tenant-switch" => "Tenant switch",
        "console-command" => "Console command",
        "record-open" => "Record opened",
        "external-app" => "External app",
        _ => kind,
    };

    private void OpenActivityEventDetail(Guid eventId)
    {
        var ev = _activityContextService.GetAll().FirstOrDefault(e => e.Id == eventId);
        if (ev == null) return;

        var spec = new RecordWorkspaceSpec
        {
            Kind = "activity-event",
            Id = ev.Id.ToString(),
            Eyebrow = KindLabel(ev.Kind),
            Title = ev.Detail,
            Sub = string.IsNullOrEmpty(ev.TenantName) ? "(no tenant)" : ev.TenantName,
            Facts =
            {
                new WorkspaceFact { Label = "When", Value = ev.TimestampUtc.ToLocalTime().ToString("g") },
                new WorkspaceFact { Label = "Kind", Value = KindLabel(ev.Kind) },
            },
            Edits =
            {
                new WorkspaceEdit
                {
                    Key = "tag",
                    Label = "Tag",
                    Value = ev.Tag ?? "(none)",
                    OnChange = newValue =>
                    {
                        _activityContextService.SetTag(ev.Id, newValue == "(none)" ? null : newValue);
                        ev.Tag = string.IsNullOrWhiteSpace(newValue) || newValue == "(none)" ? null : newValue;
                    },
                },
            },
        };

        _shellRegistry.OpenRecord(spec);
    }

    // ---- VIP classification lookup (#3484) — real safety check surfaced in the left panel and
    // inline before the Script Library "Run" action fires (same shared path Console (#3459) and
    // Remediation execution (#3471) both run catalog-backed items through). -------------------

    /// <summary>Left panel's "Check" button — resolves the real customer scope (same gap
    /// <see cref="TryResolveLaunchControlScope"/> already documents honestly) and reports the
    /// real classification back, or the real reason none could be checked.</summary>
    private void RunVipLookup(string upn)
    {
        if (!TryResolveLaunchControlScope(out _, out var customerId))
        {
            var reason = !_authService.IsAuthenticated
                ? "Sign in to check VIP status"
                : "VIP lookup needs a real customer id — TenantService is fixture data (#3540)";
            LeftReferencePanelControl.ShowVipLookupResult(upn, null, reason);
            return;
        }

        try
        {
            var classification = FindVipClassification(customerId, upn);
            if (classification == null)
            {
                LeftReferencePanelControl.ShowVipLookupResult(upn, null, "No classification on record.");
                return;
            }

            var detail = classification.IsVip
                ? $"classified by {classification.ClassifiedByName ?? classification.Source} on {classification.ClassifiedAt:d}"
                : $"de-classified ({classification.Source}) on {classification.ClassifiedAt:d}";
            LeftReferencePanelControl.ShowVipLookupResult(upn, classification.IsVip, detail);
        }
        catch (VipClassificationsException ex)
        {
            LeftReferencePanelControl.ShowVipLookupResult(upn, null, $"Lookup failed: {ex.Message}");
        }
        catch (Exception ex)
        {
            LeftReferencePanelControl.ShowVipLookupResult(upn, null, $"Lookup failed: {ex.Message}");
        }
    }

    /// <summary>Real GET against `msp-vip-classifications`, matched by UPN case-insensitively —
    /// the endpoint has no by-UPN filter, so this fetches the customer's real list and finds the
    /// row client-side rather than inventing a query param the route doesn't support.</summary>
    private VipClassification? FindVipClassification(int customerId, string upn)
    {
        var classifications = _vipClassificationsService.GetClassificationsAsync(customerId).GetAwaiter().GetResult();
        return classifications.FirstOrDefault(c => string.Equals(c.PrincipalUpn, upn, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Real MSP+customer id resolution shared by every real MSP-console call that needs
    /// one — Launch Control (#3460), ad-hoc retainer hours (#3464), and now Runbooks (#3479). As
    /// of #3501 the <paramref name="mspId"/> comes from the real signed-in session (users.msp_id
    /// claim). The <paramref name="customerId"/> — the target customer being operated on — still
    /// cannot be resolved: MyArchitect's <see cref="TenantService"/> is fixture data (fake
    /// tenant GUIDs, no numeric tenants.id). That remaining gap is filed and tracked at
    /// #3502/#3505/#3540 (owned by #3457, the Feature that actually owns TenantService) — not
    /// re-filed here. Returns true only when BOTH ids are real.</summary>
    private bool TryResolveLaunchControlScope(out int mspId, out int customerId)
    {
        mspId = _authService.MspId ?? 0;
        customerId = 0; // no real customer list yet — TenantService is fixture (separate finding)
        return mspId > 0 && customerId > 0;
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
            // Distinguish the two real remaining reasons, honestly (#3501): not signed in vs.
            // signed in but with no real customer to scope to (fixture TenantService).
            var reason = !_authService.IsAuthenticated
                ? "Sign in to load the Script Library"
                : "Script Library needs a real customer list — TenantService is fixture data";
            return new[]
            {
                new GalleryRowSpec { Id = "blocked", Name = reason, OnSelect = () => { } },
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
        SurfaceVipStatusBeforeExecute(customerId, variableValues);

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

    /// <summary>#3484's own scope: "surface whether a user is VIP-classified before executing
    /// anything against them," in the Console (#3459) and Remediation execution (#3471) flows —
    /// both of which run catalog-backed items through this same <see cref="RunScriptLibraryAction"/>
    /// path. A required variable is treated as a target-user field when its filled-in value looks
    /// like a UPN (contains '@') — the catalog carries no structured "this variable is a
    /// principal" flag, so this is the same real signal a human reads off the value itself. This
    /// surfaces information; it does not block the run — the issue's own wording is "surface,"
    /// not "gate."</summary>
    private void SurfaceVipStatusBeforeExecute(int customerId, System.Collections.Generic.Dictionary<string, string> variableValues)
    {
        var candidateUpns = variableValues.Values
            .Where(v => !string.IsNullOrWhiteSpace(v) && v.Contains('@'))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (candidateUpns.Count == 0)
        {
            return;
        }

        if (customerId <= 0)
        {
            ConsolePanel.AppendExternal("[VIP Check] Skipped — no real customer id yet (#3540).");
            return;
        }

        foreach (var upn in candidateUpns)
        {
            try
            {
                var classification = FindVipClassification(customerId, upn);
                if (classification == null)
                {
                    ConsolePanel.AppendExternal($"[VIP Check] {upn}: no classification on record.");
                }
                else if (classification.IsVip)
                {
                    ConsolePanel.AppendExternal($"[VIP Check] {upn} is VIP-classified — proceed with caution.");
                }
                else
                {
                    ConsolePanel.AppendExternal($"[VIP Check] {upn}: not VIP-classified.");
                }
            }
            catch (VipClassificationsException ex)
            {
                ConsolePanel.AppendExternal($"[VIP Check] {upn}: lookup failed — {ex.Message}");
            }
        }
    }

    // ---- Runbooks (#3479) — Console tab galleries + record workspaces ----------------------

    /// <summary>Real rows from GET /api/msp/runbooks (#3479), gated by the same MSP+customer
    /// scope gap <see cref="TryResolveLaunchControlScope"/> already states honestly. Tile
    /// carries the current cycle's completion percentage — the closest equivalent to Script
    /// Library's destructive-vs-read-only tile UI_RULES.md §4 asks for.</summary>
    private System.Collections.Generic.IReadOnlyList<GalleryRowSpec> BuildRunbookRows()
    {
        if (!TryResolveLaunchControlScope(out var mspId, out var customerId))
        {
            var reason = !_authService.IsAuthenticated
                ? "Sign in to load Runbooks"
                : "Runbooks needs a real customer id — TenantService is fixture data (#3502/#3505/#3540)";
            return new[] { new GalleryRowSpec { Id = "blocked", Name = reason, OnSelect = () => { } } };
        }

        RunbooksPayload payload;
        try
        {
            payload = _runbooksService.GetRunbooksAsync(mspId, customerId).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            // Real, honest failure — most likely 401/403 (auth still not wired), not a bug in
            // this client. Surfaced as a single disabled row rather than a fake row.
            return new[] { new GalleryRowSpec { Id = "error", Name = $"Could not load: {ex.Message}", OnSelect = () => { } } };
        }

        if (payload.Runbooks.Count == 0)
        {
            return new[] { new GalleryRowSpec { Id = "empty", Name = "No active runbooks for this customer", OnSelect = () => { } } };
        }

        return payload.Runbooks
            .Select(rb => new GalleryRowSpec
            {
                Id = rb.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                Tile = $"{(int)Math.Round(rb.Pct)}%",
                Name = rb.Title,
                Sub = $"{rb.StatusLabel} · {rb.CheckedSteps}/{rb.TotalSteps} steps" + (rb.Hold != null ? $" · hold: {rb.Hold.Badge}" : string.Empty),
                OnSelect = () => OpenRunbookRecord(rb, mspId, customerId),
            })
            .ToList();
    }

    /// <summary>Real rows from the same GET /api/msp/runbooks payload's top-level <c>holds</c>
    /// list (#3479) — every active hold window for the customer, not just the one gating a
    /// runbook's current cycle. Shares <see cref="IRunbooksService"/>'s short-TTL cache, so
    /// browsing this gallery right after Runbooks' own doesn't force a second real GET.</summary>
    private System.Collections.Generic.IReadOnlyList<GalleryRowSpec> BuildHoldWindowRows()
    {
        if (!TryResolveLaunchControlScope(out var mspId, out var customerId))
        {
            var reason = !_authService.IsAuthenticated
                ? "Sign in to load Hold Windows"
                : "Hold Windows needs a real customer id — TenantService is fixture data (#3502/#3505/#3540)";
            return new[] { new GalleryRowSpec { Id = "blocked", Name = reason, OnSelect = () => { } } };
        }

        RunbooksPayload payload;
        try
        {
            payload = _runbooksService.GetRunbooksAsync(mspId, customerId).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            return new[] { new GalleryRowSpec { Id = "error", Name = $"Could not load: {ex.Message}", OnSelect = () => { } } };
        }

        if (payload.Holds.Count == 0)
        {
            return new[] { new GalleryRowSpec { Id = "empty", Name = "No active hold windows for this customer", OnSelect = () => { } } };
        }

        return payload.Holds
            .Select(hold => new GalleryRowSpec
            {
                Id = hold.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                Tile = hold.Badge,
                Name = hold.Title,
                Sub = $"{hold.State} · {hold.Pillar} · {hold.TMinus}",
                OnSelect = () => OpenHoldWindowRecord(hold, mspId, customerId),
            })
            .ToList();
    }

    /// <summary>Opens a runbook's full-panel record workspace (UI_RULES.md §3) — real facts, the
    /// current cycle's steps rendered as one confirm-less <see cref="WorkspaceAction"/> each
    /// (UI_RULES.md §3's own example: "a runbook step-complete is an actions entry"), a link into
    /// the gating hold window when one exists, and real run history as a <see cref="WorkspaceListRow"/>
    /// list. Same gallery → contextual tab → workspace contract #3493 proved with Change Requests
    /// and Script Library.</summary>
    private void OpenRunbookRecord(Runbook rb, int mspId, int customerId)
    {
        var actions = rb.Steps
            .Select(step => new WorkspaceAction
            {
                Label = (step.Checked ? "☑ " : "☐ ") + $"{step.Position}. {step.Text}",
                OnSelect = () => ToggleRunbookStep(rb, mspId, customerId, step),
            })
            .ToList();

        if (rb.Hold != null)
        {
            var hold = rb.Hold;
            actions.Add(new WorkspaceAction
            {
                Label = $"Open Hold Window — {hold.Title}",
                OnSelect = () => OpenHoldWindowRecord(hold, mspId, customerId),
            });
        }

        var spec = new RecordWorkspaceSpec
        {
            Kind = "runbook",
            Id = rb.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Eyebrow = "Runbook",
            Title = rb.Title,
            Sub = $"{rb.Pillar} · Cycle {rb.CycleNumber} · {rb.StatusLabel}",
            Facts =
            {
                new WorkspaceFact { Label = "Progress", Value = $"{rb.CheckedSteps}/{rb.TotalSteps} steps ({(int)Math.Round(rb.Pct)}%)" },
                new WorkspaceFact { Label = "Days elapsed", Value = rb.DaysElapsed.ToString(System.Globalization.CultureInfo.InvariantCulture) },
                new WorkspaceFact { Label = "Days left", Value = rb.DaysLeft.ToString(System.Globalization.CultureInfo.InvariantCulture) },
                new WorkspaceFact { Label = "Recurring", Value = rb.Recurring ? "Yes" : "No" },
                new WorkspaceFact { Label = "Hold", Value = rb.Hold != null ? $"{rb.Hold.Badge} — {rb.Hold.TMinus}" : "None" },
            },
            Body = ("Context", string.IsNullOrEmpty(rb.Context) ? "(none)" : rb.Context),
            Actions = actions,
            List = rb.RunHistory.Count == 0
                ? null
                : ("Run History", rb.RunHistory.Select(run => new WorkspaceListRow
                {
                    Id = run.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    Name = $"Cycle {run.CycleNumber}",
                    Sub = $"{run.Status} · started {run.StartedOn}",
                    Right = $"{run.CheckedSteps}/{run.TotalSteps}",
                    OnSelect = () => { },
                }).ToList()),
        };

        _shellRegistry.OpenContextual(
            new TrailEntry("runbook", spec.Id, rb.Title, () => OpenRunbookRecord(rb, mspId, customerId)),
            new ContextualTabSpec
            {
                Id = "runbook",
                Label = "Runbook",
                Groups =
                {
                    new RibbonGroupSpec
                    {
                        Label = "Steps",
                        Large = { new RibbonCommandSpec
                        {
                            Label = "Mark step complete",
                            Intent = RibbonIntent.Record,
                            OnSelect = () => { },
                        } },
                    },
                },
            },
            onSearchEverything: () => PaletteOverlay.Open());

        _shellRegistry.OpenRecord(spec);
    }

    // ---- Document Hub (#3486) — real msp-documents-hub.ts client, gallery + full-panel workspace ----

    /// <summary>Real rows from GET /api/msp/documents-hub (#3486). Unlike Launch Control's write
    /// actions (<see cref="TryResolveLaunchControlScope"/>), this endpoint is book-wide and does
    /// NOT require a customerId to work — only mspId. #3486's own checklist item names "browse/
    /// view for the selected tenant," but <see cref="Models.Tenant.Id"/> is a display string, not
    /// the numeric <c>tenants.id</c> the endpoint's <c>customerId</c> filter takes, and
    /// TenantService remains fixture data for that numeric id (the same real, already-tracked gap
    /// #3502/#3505/#3540 document for every other gallery in this file). Filtering by a
    /// non-numeric fixture id would be inventing a match, not honoring the real selection — so
    /// until that numeric id is real, Document Hub browses the caller's whole book rather than
    /// guessing a filter.</summary>
    private System.Collections.Generic.IReadOnlyList<GalleryRowSpec> BuildDocumentHubRows()
    {
        if (!_authService.IsAuthenticated)
        {
            return new[] { new GalleryRowSpec { Id = "blocked", Name = "Sign in to load Document Hub", OnSelect = () => { } } };
        }

        var mspId = _authService.MspId;
        if (mspId is not > 0)
        {
            return new[] { new GalleryRowSpec { Id = "blocked", Name = "Document Hub needs a real MSP context (not resolved from the current session)", OnSelect = () => { } } };
        }

        DocumentHubListResponse payload;
        try
        {
            payload = _documentHubService.GetDocumentsAsync(mspId.Value, customerId: null).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            // Real, honest failure — most likely 401/403 (auth still not wired), not a bug in
            // this client. Surfaced as a single disabled row rather than a fake row.
            return new[] { new GalleryRowSpec { Id = "error", Name = $"Could not load: {ex.Message}", OnSelect = () => { } } };
        }

        if (payload.Documents.Count == 0)
        {
            return new[] { new GalleryRowSpec { Id = "empty", Name = "No documents generated yet across your book", OnSelect = () => { } } };
        }

        return payload.Documents
            .Select(doc => new GalleryRowSpec
            {
                Id = doc.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                Tile = (doc.DocType ?? doc.Category ?? "doc").Length > 3 ? (doc.DocType ?? doc.Category ?? "doc")[..3].ToUpperInvariant() : (doc.DocType ?? doc.Category ?? "doc").ToUpperInvariant(),
                Name = doc.Title,
                Sub = $"{doc.CustomerName ?? "Unknown customer"} · {doc.Status} · {(doc.DeliveredAt ?? doc.CreatedAt ?? "")}",
                OnSelect = () => OpenDocumentHubRecord(doc, mspId.Value),
            })
            .ToList();
    }

    /// <summary>Opens a document's full-panel record workspace (UI_RULES.md §3) — real facts, and
    /// the gallery's own three named checklist actions: View (fetches the sandboxed-viewer HTML
    /// and opens it in the OS default browser via a local temp file — the same
    /// Process.Start(UseShellExecute) pattern <c>LaunchExternalButton_Click</c> already uses;
    /// MyArchitect has no in-app HTML document renderer, and adding one is shell chrome UI_RULES.md
    /// doesn't define), Download PDF (same temp-file-then-launch pattern, PDF bytes), and Share
    /// (POST .../share, real shareUrl surfaced as a fact and copied to the clipboard).</summary>
    private void OpenDocumentHubRecord(DocumentHubItem doc, int mspId)
    {
        var canDownloadOrShare = doc.Status is "approved" or "delivered";

        var spec = new RecordWorkspaceSpec
        {
            Kind = "document-hub-item",
            Id = doc.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Eyebrow = "Document Hub",
            Title = doc.Title,
            Sub = $"{doc.CustomerName ?? "Unknown customer"} · {doc.Status}",
            Facts =
            {
                new WorkspaceFact { Label = "Category", Value = doc.Category ?? "—" },
                new WorkspaceFact { Label = "Type", Value = doc.DocType ?? "—" },
                new WorkspaceFact { Label = "Status", Value = doc.Status ?? "—" },
                new WorkspaceFact { Label = "Created", Value = doc.CreatedAt ?? "—", Prose = true },
                new WorkspaceFact { Label = "Delivered", Value = doc.DeliveredAt ?? "not yet", Prose = true },
            },
            Actions =
            {
                new WorkspaceAction
                {
                    Label = "View document",
                    OnSelect = () => ViewDocumentHubItem(doc),
                },
            },
            Body = canDownloadOrShare
                ? null
                : ("PDF / Share", $"Not available while status is \"{doc.Status}\" — the endpoint only serves approved/delivered documents."),
        };

        if (!string.IsNullOrEmpty(doc.ProjectTitle))
        {
            spec.Facts.Add(new WorkspaceFact { Label = "Project", Value = doc.ProjectTitle, Prose = true });
        }
        if (!string.IsNullOrEmpty(doc.SowTotalPrice))
        {
            spec.Facts.Add(new WorkspaceFact { Label = "SOW total", Value = doc.SowTotalPrice });
        }

        if (canDownloadOrShare)
        {
            spec.Actions.Add(new WorkspaceAction
            {
                Label = "Download PDF",
                OnSelect = () => DownloadDocumentHubPdf(doc),
            });
            spec.Actions.Add(new WorkspaceAction
            {
                Label = "Create & copy share link",
                Confirm = true,
                OnSelect = () => ShareDocumentHubItem(doc),
            });
        }

        _shellRegistry.OpenContextual(
            new TrailEntry("document-hub-item", spec.Id, doc.Title, () => OpenDocumentHubRecord(doc, mspId)),
            new ContextualTabSpec { Id = "document-hub-item", Label = "Document" },
            onSearchEverything: () => PaletteOverlay.Open());

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>GET /api/msp/documents-hub/:id/view, then opens the real sandboxed-viewer HTML in
    /// the OS default browser via a temp file. Feedback goes to the Console pane, same channel
    /// <see cref="ToggleRunbookStep"/> already uses for a real side-effecting action's result.</summary>
    private void ViewDocumentHubItem(DocumentHubItem doc)
    {
        ShowDocument(ConsolePanel);
        ConsolePanel.AppendExternal($"[Document Hub] Loading \"{doc.Title}\"…");
        try
        {
            var view = _documentHubService.GetDocumentViewAsync(doc.Id).GetAwaiter().GetResult();
            var path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"myarchitect-doc-{doc.Id}.html");
            System.IO.File.WriteAllText(path, view.HtmlContent);
            Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true });
            ConsolePanel.AppendExternal($"[Document Hub] Opened \"{view.Title ?? doc.Title}\" in the default browser.");
        }
        catch (DocumentHubServiceException ex)
        {
            ConsolePanel.AppendExternal($"[Document Hub] View failed: {ex.Message}");
        }
        catch (Exception ex)
        {
            ConsolePanel.AppendExternal($"[Document Hub] Exception: {ex.Message}");
        }
    }

    /// <summary>GET /api/msp/documents-hub/:id/pdf, then opens the real branded PDF bytes in the
    /// OS default PDF viewer via a temp file — same Process.Start pattern as
    /// <see cref="ViewDocumentHubItem"/>.</summary>
    private void DownloadDocumentHubPdf(DocumentHubItem doc)
    {
        ShowDocument(ConsolePanel);
        ConsolePanel.AppendExternal($"[Document Hub] Downloading PDF for \"{doc.Title}\"…");
        try
        {
            var bytes = _documentHubService.GetDocumentPdfAsync(doc.Id).GetAwaiter().GetResult();
            var safeTitle = new string(doc.Title.Where(c => char.IsLetterOrDigit(c) || c is ' ' or '_' or '-').ToArray()).Trim();
            if (safeTitle.Length == 0) safeTitle = $"document-{doc.Id}";
            var path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"{safeTitle}.pdf");
            System.IO.File.WriteAllBytes(path, bytes);
            Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true });
            ConsolePanel.AppendExternal($"[Document Hub] PDF saved to {path} and opened.");
        }
        catch (DocumentHubServiceException ex)
        {
            ConsolePanel.AppendExternal($"[Document Hub] PDF download failed: {ex.Message}");
        }
        catch (Exception ex)
        {
            ConsolePanel.AppendExternal($"[Document Hub] Exception: {ex.Message}");
        }
    }

    /// <summary>POST /api/msp/documents-hub/:id/share, then copies the real shareUrl to the
    /// clipboard so the operator can paste it straight into an email/Teams message to the
    /// customer.</summary>
    private void ShareDocumentHubItem(DocumentHubItem doc)
    {
        ShowDocument(ConsolePanel);
        ConsolePanel.AppendExternal($"[Document Hub] Creating share link for \"{doc.Title}\"…");
        try
        {
            var share = _documentHubService.ShareDocumentAsync(doc.Id).GetAwaiter().GetResult();
            try { System.Windows.Clipboard.SetText(share.ShareUrl); } catch { /* clipboard access can legitimately fail (e.g. locked by another process) — link is still logged below */ }
            ConsolePanel.AppendExternal($"[Document Hub] Share link (copied to clipboard, expires {share.ExpiresAt}): {share.ShareUrl}");
        }
        catch (DocumentHubServiceException ex)
        {
            ConsolePanel.AppendExternal($"[Document Hub] Share failed: {ex.Message}");
        }
        catch (Exception ex)
        {
            ConsolePanel.AppendExternal($"[Document Hub] Exception: {ex.Message}");
        }
    }

    /// <summary>Wires PUT /api/msp/runbooks/:runbookId/steps/:position into the Console tab's
    /// output pane (#3479's own "wired into embedded Console execution flow" checklist item,
    /// #3459 dependency) — the same feedback channel <see cref="RunScriptLibraryAction"/> already
    /// uses, since this call also runs server-side rather than through the hosted runspace.
    /// Re-opens the record afterward against a freshly re-fetched (cache-busted by the write
    /// itself) payload, so the checkbox glyph reflects the real, just-written state.</summary>
    private void ToggleRunbookStep(Runbook rb, int mspId, int customerId, RunbookStep step)
    {
        ShowDocument(ConsolePanel);
        var wantChecked = !step.Checked;
        ConsolePanel.AppendExternal($"[Runbooks] {(wantChecked ? "Completing" : "Reopening")} step {step.Position} of \"{rb.Title}\"…");

        try
        {
            var result = _runbooksService
                .SetStepCompletionAsync(mspId, customerId, rb.Id, step.Position, wantChecked)
                .GetAwaiter().GetResult();

            ConsolePanel.AppendExternal($"[Runbooks] Step {result.Position} now {(result.Checked ? "checked" : "unchecked")}.");

            var refreshed = _runbooksService.GetRunbooksAsync(mspId, customerId).GetAwaiter().GetResult();
            var reloaded = refreshed.Runbooks.FirstOrDefault(r => r.Id == rb.Id);
            if (reloaded != null) OpenRunbookRecord(reloaded, mspId, customerId);
        }
        catch (RunbooksServiceException ex)
        {
            // A real server-side rejection (401/403/404/409 — see msp-runbooks.ts), surfaced
            // with its own real message, not swallowed or faked into a success.
            ConsolePanel.AppendExternal($"[Runbooks] Step update failed: {ex.Message}");
        }
        catch (Exception ex)
        {
            ConsolePanel.AppendExternal($"[Runbooks] Exception: {ex.Message}");
        }
    }

    /// <summary>Opens a hold window's own full-panel record workspace (#3479's "hold-window
    /// extend + audit trail view" checklist item) — real facts, a write-through Extend action
    /// (Edits feed a dictionary a confirm-armed Action reads, same shape as
    /// <see cref="OpenScriptLibraryRecord"/>), and the real decision audit trail from GET
    /// /api/msp/hold-windows/:holdId/events, fetched fresh every open (never cached — a stale
    /// audit trail would be worse than none, same reasoning UI_RULES.md §5 states for the
    /// command palette's <c>?</c> answers).</summary>
    private void OpenHoldWindowRecord(HoldWindow hold, int mspId, int customerId)
    {
        var extend = new System.Collections.Generic.Dictionary<string, string> { ["days"] = string.Empty, ["reason"] = string.Empty };

        HoldWindowEventsResponse? events;
        try
        {
            events = _runbooksService.GetHoldWindowEventsAsync(mspId, customerId, hold.Id).GetAwaiter().GetResult();
        }
        catch (Exception)
        {
            events = null; // falls through to a stated "could not load" row below, not a fake empty trail
        }

        var auditRows = events == null
            ? new System.Collections.Generic.List<WorkspaceListRow> { new() { Id = "error", Name = "Could not load audit trail", OnSelect = () => { } } }
            : events.Events.Count == 0
                ? new System.Collections.Generic.List<WorkspaceListRow> { new() { Id = "empty", Name = "No decisions recorded yet", OnSelect = () => { } } }
                : events.Events.Select((e, i) => new WorkspaceListRow
                {
                    Id = i.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    Name = e.Kind + (e.DaysDelta != null ? $" ({(e.DaysDelta > 0 ? "+" : string.Empty)}{e.DaysDelta}d)" : string.Empty),
                    Sub = string.IsNullOrEmpty(e.Reason)
                        ? e.ChangeRequestCode
                        : $"{e.Reason}{(string.IsNullOrEmpty(e.ChangeRequestCode) ? string.Empty : $" · {e.ChangeRequestCode}")}",
                    Right = e.CreatedAt.ToLocalTime().ToString("g"),
                    OnSelect = () => { },
                }).ToList();

        var spec = new RecordWorkspaceSpec
        {
            Kind = "hold-window",
            Id = hold.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Eyebrow = "Hold Window",
            Title = hold.Title,
            Sub = $"{hold.Pillar} · {hold.State} · {hold.TMinus}",
            Facts =
            {
                new WorkspaceFact { Label = "Badge", Value = hold.Badge },
                new WorkspaceFact { Label = "Days left", Value = hold.DaysLeft.ToString(System.Globalization.CultureInfo.InvariantCulture) },
                new WorkspaceFact { Label = "Hours left", Value = hold.HoursLeft.ToString(System.Globalization.CultureInfo.InvariantCulture) },
                new WorkspaceFact { Label = "Total days", Value = hold.TotalDays.ToString(System.Globalization.CultureInfo.InvariantCulture) },
                new WorkspaceFact { Label = "Extended days", Value = hold.ExtendedDays.ToString(System.Globalization.CultureInfo.InvariantCulture) },
                new WorkspaceFact { Label = "Closes", Value = hold.ClosesAt },
                new WorkspaceFact { Label = "Scan verdict", Value = string.IsNullOrEmpty(hold.ScanLabel) ? "(none)" : hold.ScanLabel },
            },
            Body = ("Why", string.IsNullOrEmpty(hold.Why) ? "(none)" : hold.Why),
            Edits =
            {
                new WorkspaceEdit { Key = "days", Label = "Extend by (days)", Value = string.Empty, OnChange = v => extend["days"] = v },
                new WorkspaceEdit { Key = "reason", Label = "Reason", Value = string.Empty, OnChange = v => extend["reason"] = v },
            },
            Actions =
            {
                new WorkspaceAction
                {
                    Label = "Extend Hold Window",
                    Confirm = true,
                    OnSelect = () => ExtendHoldWindow(hold, mspId, customerId, extend),
                },
            },
            List = ("Audit Trail", auditRows),
        };

        _shellRegistry.OpenContextual(
            new TrailEntry("hold-window", spec.Id, hold.Title, () => OpenHoldWindowRecord(hold, mspId, customerId)),
            new ContextualTabSpec
            {
                Id = "hold-window",
                Label = "Hold Window",
                Groups =
                {
                    new RibbonGroupSpec
                    {
                        Label = "Actions",
                        Large = { new RibbonCommandSpec
                        {
                            Label = "Extend",
                            Intent = RibbonIntent.Record,
                            OnSelect = () => { },
                        } },
                    },
                },
            },
            onSearchEverything: () => PaletteOverlay.Open());

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>Real POST /api/msp/hold-windows/:holdId/extend — validates a positive day count
    /// and a non-empty reason client-side (matching msp-runbooks.ts's own extend schema),
    /// reports the real result to the Console pane the same way <see cref="RunScriptLibraryAction"/>
    /// does, then reopens the hold window's own record against the freshly re-fetched (cache-busted
    /// by the write itself) payload so the extended-days fact reflects reality.</summary>
    private void ExtendHoldWindow(HoldWindow hold, int mspId, int customerId, System.Collections.Generic.Dictionary<string, string> fields)
    {
        if (!int.TryParse(fields["days"], System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var days) || days <= 0)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal("[Runbooks] Extend needs a positive number of days — nothing sent.");
            return;
        }

        var reason = fields["reason"];
        if (string.IsNullOrWhiteSpace(reason))
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal("[Runbooks] Extend needs a reason — nothing sent.");
            return;
        }

        ShowDocument(ConsolePanel);
        ConsolePanel.AppendExternal($"[Runbooks] Extending hold window \"{hold.Title}\" by {days} day(s)…");

        try
        {
            var result = _runbooksService.ExtendHoldWindowAsync(mspId, customerId, hold.Id, days, reason).GetAwaiter().GetResult();
            ConsolePanel.AppendExternal($"[Runbooks] Extended — hold window now carries {result.ExtendedDays} extended day(s) total.");

            var refreshed = _runbooksService.GetRunbooksAsync(mspId, customerId).GetAwaiter().GetResult();
            var reloadedHold = refreshed.Holds.FirstOrDefault(h => h.Id == hold.Id);
            if (reloadedHold != null) OpenHoldWindowRecord(reloadedHold, mspId, customerId);
        }
        catch (RunbooksServiceException ex)
        {
            ConsolePanel.AppendExternal($"[Runbooks] Extend failed: {ex.Message}");
        }
        catch (Exception ex)
        {
            ConsolePanel.AppendExternal($"[Runbooks] Exception: {ex.Message}");
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
            new() { Id = "dest:break-glass", Type = PaletteType.Destination, Name = "Break-Glass Requests", Sub = "Cross-tenant pending break-glass deliveries (#3480)", Run = () => OpenBreakGlassPendingList() },
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
        // Real login/session bootstrap (#3501): try to silently restore a session from the
        // DPAPI-stored refresh token; if that fails, prompt the operator to sign in. Either way
        // the resolved token/mspId is pushed into every service via OnAuthSessionChanged.
        var restored = await _authService.TryRestoreSessionAsync();
        if (!restored)
        {
            ShowLoginDialog();
        }
        ApplyAuthState();

        if (_tenantService.CurrentTenant != null)
        {
            LeftReferencePanelControl.SetTenantName(_tenantService.CurrentTenant.Name);
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.M365Admin);
        }
    }

    // ---- Auth/session wiring (#3501) -------------------------------------------------------

    /// <summary>Fired by <see cref="IAuthService"/> on sign-in, sign-out, and every token
    /// refresh — possibly from the refresh timer thread, so marshal to the UI thread before
    /// touching services/UI.</summary>
    private void OnAuthSessionChanged()
    {
        if (Dispatcher.CheckAccess()) ApplyAuthState();
        else Dispatcher.Invoke(ApplyAuthState);
    }

    /// <summary>Push the current session's bearer token into every service that attaches an
    /// Authorization header, and refresh the status-bar sign-in indicator. This is the single
    /// place the token is fanned out, so a refresh updates all of them at once.</summary>
    private void ApplyAuthState()
    {
        var token = _authService.AccessToken;

        _launchControlActionsService.AuthToken = token;
        _changeControlService.AuthToken = token;
        _breakGlassService.AuthToken = token;
        _adminRetainerService.AuthToken = token;
        _remediationTrackerService.AuthToken = token;
        _vipClassificationsService.AuthToken = token;
        _retainerService.AuthToken = token;
        _runbooksService.AuthToken = token;
        _documentHubService.AuthToken = token;
        _poamsService.AuthToken = token;
        TelemetryDashboardView.SetAuthToken(token);
        SowAssessmentDashboardView.SetAuthToken(token);
        EvidenceGalleryPanel.SetAuthToken(token);

        UpdateSessionStatusUi();
        _ = RefreshContractHoursAsync();
    }

    private void UpdateSessionStatusUi()
    {
        if (_authService.IsAuthenticated)
        {
            var email = _authService.CurrentSession?.User.Email;
            SessionStatusButton.Content = string.IsNullOrWhiteSpace(email)
                ? "Signed in · Sign out"
                : $"Signed in: {email} · Sign out";
        }
        else
        {
            SessionStatusButton.Content = "Not signed in · Sign in";
        }
    }

    private void ShowLoginDialog()
    {
        var login = new LoginWindow(_authService) { Owner = IsLoaded ? this : null };
        login.ShowDialog();
    }

    private async void SessionStatusButton_Click(object sender, RoutedEventArgs e)
    {
        if (_authService.IsAuthenticated)
        {
            var confirm = System.Windows.MessageBox.Show(
                "Sign out of MyArchitect? Every auth-gated surface will stop loading real data until you sign in again.",
                "Sign out", System.Windows.MessageBoxButton.YesNo, System.Windows.MessageBoxImage.Question);
            if (confirm != System.Windows.MessageBoxResult.Yes) return;

            await _authService.SignOutAsync();
            // OnAuthSessionChanged already re-applied the (now null) token + status.
        }
        else
        {
            ShowLoginDialog();
            ApplyAuthState();
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
        _foregroundAppWatcher.Dispose();
        (_authService as IDisposable)?.Dispose();
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

        await RefreshContractHoursAsync();
    }

    // ---- Contract-hours utilization (#3474) — real GET /api/admin/retainer/:customerId -------

    /// <summary>Real customerId resolution for the retainer call. <see cref="TenantService"/> is
    /// fixture data (fake tenant GUIDs, no real numeric tenants.id) — the exact same gap
    /// <c>TryResolveLaunchControlScope</c> hit and correctly deferred to #3540 (parented under
    /// #3457, the Feature that actually owns TenantService). Returns true only when a real
    /// customerId is resolvable; rebuilding TenantService here would be scope creep into #3457's
    /// own named responsibility, so this states the honest block instead of guessing an id.</summary>
    private bool TryResolveRetainerCustomerId(out int customerId)
    {
        customerId = 0; // no real customer list yet — TenantService is fixture (#3540)
        return customerId > 0;
    }

    /// <summary>Loads the real settings + current-period bucket for the active tenant and
    /// renders it into the status bar's contract-hours progress bar. Hides the whole segment —
    /// never a fake/zeroed bar — whenever there is nothing real to show yet (not signed in, no
    /// real customerId, or the call failed), per UI_RULES.md §1's "never a fake clickable stop
    /// for read-only state."</summary>
    private async Task RefreshContractHoursAsync()
    {
        if (!_authService.IsAuthenticated || !TryResolveRetainerCustomerId(out var customerId))
        {
            ContractHoursPanel.Visibility = Visibility.Collapsed;
            return;
        }

        RetainerDetailResponse retainer;
        try
        {
            retainer = await _retainerService.GetRetainerAsync(customerId).ConfigureAwait(true);
        }
        catch (RetainerServiceException)
        {
            // Real, honest failure (401/403/404/500) — most likely not signed in as a platform
            // admin (requireAdmin) or the customer isn't on retainer at all. Hide rather than
            // show a fake/zeroed bar.
            ContractHoursPanel.Visibility = Visibility.Collapsed;
            return;
        }

        var bucket = retainer.Bucket;
        if (bucket == null || retainer.Settings is not { Configured: true })
        {
            // No retainer configured for this customer — a real, valid state, not an error.
            ContractHoursPanel.Visibility = Visibility.Collapsed;
            return;
        }

        var retainedTotal = bucket.RetainedHours + bucket.RolledHours;
        var percent = retainedTotal > 0
            ? Math.Min(100.0, bucket.UsedHours / retainedTotal * 100.0)
            : 0.0;

        ContractHoursProgressBar.Value = percent;
        ContractHoursProgressBar.Foreground = bucket.IsOverMonth
            ? new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(0xFF, 0x6B, 0x6B))
            : new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(0x7F, 0xD1, 0xFF));

        ContractHoursTextBlock.Text = bucket.IsOverMonth
            ? $"{bucket.UsedHours:0.#}h / {retainedTotal:0.#}h retained · {bucket.OverHours:0.#}h over"
            : $"{bucket.UsedHours:0.#}h / {retainedTotal:0.#}h retained";

        ContractHoursPanel.Visibility = Visibility.Visible;
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
