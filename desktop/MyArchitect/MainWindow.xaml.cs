using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Threading;
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
    private readonly ICabService _cabService;
    private readonly IRemediationTrackerService _remediationTrackerService;
    private readonly IVipClassificationsService _vipClassificationsService;
    private readonly ILaunchControlActionsService _launchControlActionsService;
    private readonly IAdminRetainerService _adminRetainerService;
    private readonly IAutomationRegistryService _automationRegistryService;
    private readonly IRunbooksService _runbooksService;
    private readonly IDocumentHubService _documentHubService;
    private readonly IVaultService _vaultService;
    private readonly IBreakGlassService _breakGlassService;
    private readonly ISupportTicketsService _supportTicketsService;
    private readonly IAuditLogService _auditLogService;
    private readonly IAuthService _authService;
    private readonly IRetainerService _retainerService;
    private readonly IPoamsService _poamsService;
    private readonly ISlaService _slaService;
    private readonly ITaskQueueService _taskQueueService;
    private readonly IAlertsService _alertsService;
    private readonly IConsentService _consentService;
    private readonly IActivityContextService _activityContextService;
    private readonly IForegroundAppWatcher _foregroundAppWatcher;
    private CancellationTokenSource? _taskQueueSseCts;

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
        _cabService = new CabService();
        _remediationTrackerService = new RemediationTrackerService();
        _vipClassificationsService = new VipClassificationsService();
        _launchControlActionsService = new LaunchControlActionsService();
        _adminRetainerService = new AdminRetainerService();
        _automationRegistryService = new AutomationRegistryService();
        _runbooksService = new RunbooksService();
        _documentHubService = new DocumentHubService();
        _vaultService = new VaultService();
        _breakGlassService = new BreakGlassService();
        _supportTicketsService = new SupportTicketsService();
        _auditLogService = new AuditLogService();
        _authService = new AuthService();
        _retainerService = new RetainerService();
        _poamsService = new PoamsService();
        _slaService = new SlaService();
        _taskQueueService = new TaskQueueService();
        _alertsService = new AlertsService();
        _consentService = new ConsentService();
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
        LeftReferencePanelControl.VipLookupRequested += upn => { _ = RunVipLookupAsync(upn); };

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
        RegisterWatchTab();
        RegisterDocumentsTab();
        RegisterAdminTab();
        // Watch now carries Support Tickets (#3488), SLA (#3487), the Task Queue (#3490) and
        // Alerts (#3483) — each its own group (UI_RULES.md §2: one tab, one group per real
        // source, not one hand-fused group). Admin now carries Vault (#3461), Break-Glass
        // (#3480) and the Audit Log (#3489); consent status (#3485) attaches here as it lands.
        // Documents now carries Document Hub (#3486).

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
                        GetRowsAsync = BuildRemediationPlanRowsAsync,
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
                        GetRowsAsync = BuildPoamRowsAsync,
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
            Label = "Change Advisory Board",
            Order = 36,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Browse",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Real GET /api/msp/change-control/cab/meetings (#3482 / Git #1501)",
                    Gallery = new GallerySpec
                    {
                        Title = "CAB Meetings",
                        Searchable = true,
                        GetRowsAsync = BuildCabMeetingRowsAsync,
                    },
                    OnSelect = () => { },
                },
                new RibbonCommandSpec
                {
                    Label = "Schedule Meeting",
                    Intent = RibbonIntent.Create,
                    ToolTip = "POST /api/msp/change-control/cab/meetings",
                    OnSelect = () => OpenScheduleCabMeetingRecord(),
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

        _shellRegistry.RegisterFixedTabGroup(FixedTab.Home, new RibbonGroupSpec
        {
            Label = "Automation Registry",
            Order = 41,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Browse",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Real GET /api/admin/automation-registry/:customerId (Git #3771)",
                    Gallery = new GallerySpec
                    {
                        Title = "Automation Registry",
                        Searchable = true,
                        GetRowsAsync = BuildAutomationRegistryRowsAsync,
                    },
                    OnSelect = () => { },
                },
                new RibbonCommandSpec
                {
                    Label = "Add Automation",
                    Intent = RibbonIntent.Create,
                    ToolTip = "POST /api/admin/automation-registry/:customerId — Power Automate flow or Power Platform/Azure AI Studio agent (Git #3771)",
                    OnSelect = () => OpenAddAutomationRecord(),
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
                        GetRowsAsync = BuildScriptLibraryRowsAsync,
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
                        GetRowsAsync = BuildRunbookRowsAsync,
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
                        GetRowsAsync = BuildHoldWindowRowsAsync,
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
                        GetRowsAsync = BuildDocumentHubRowsAsync,
                    },
                    OnSelect = () => { },
                },
            },
        });
    }

    /// <summary>Admin tab (UI_RULES.md §2). Carries the Credential Vault (#3461), Break-Glass
    /// Access (#3480), the Audit Log (#3489) and Tenant Consent Status (#3485) — all
    /// <see cref="RibbonIntent.Open"/> commands (global-scope, no specific record).</summary>
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
                    OnSelect = () => { _ = OpenBreakGlassPendingListAsync(); },
                },
            },
        });

        // Audit Log (#3489) — real msp-audit-log.ts client, filterable by tenant (mspId,
        // PlatformAdmin-only server-side) / action type. Open-intent (nothing tenant-specific to
        // select yet), so it is fixed-tab legal.
        _shellRegistry.RegisterFixedTabGroup(FixedTab.Admin, new RibbonGroupSpec
        {
            Label = "Audit Log",
            Order = 30,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Audit Log",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Filterable platform audit trail — tenant / action type (GET /api/msp/audit, #3489)",
                    OnSelect = () => { _ = OpenAuditLogAsync(new Models.AuditLogFilter()); },
                },
            },
        });

        // Tenant Consent Status (#3485) — cross-tenant list of the three real grant keys (Graph
        // read / write-back / SharePoint) opens as a full-panel record workspace (UI_RULES.md §3);
        // rows drill into a per-customer detail with the real invite-link/start-consent/revoke
        // actions. An Open-intent command (nothing tenant-specific to select yet), fixed-tab legal.
        _shellRegistry.RegisterFixedTabGroup(FixedTab.Admin, new RibbonGroupSpec
        {
            Label = "Consent Status",
            Order = 40,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Tenant Consent",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Admin/write/SharePoint consent status across your MSP book (GET /api/msp/consent, #3485)",
                    OnSelect = () => { _ = OpenConsentStatusListAsync(); },
                },
            },
        });
    }

    /// <summary>Watch tab (UI_RULES.md §2) — "the one 'what needs me' surface." Support Tickets
    /// (#3488), SLA (#3487, real msp-sla.ts + msp-m365-sla.ts endpoints), the Task Queue (#3490)
    /// and Alerts (#3483, real msp-alerts.ts) each get their own group (UI_RULES.md §2: one tab,
    /// one group per real source, not one hand-fused group). Support Tickets is a cross-tenant
    /// Open-intent list (nothing tenant-specific to select yet,
    /// so fixed-tab legal), same shape as Break-Glass's pending list on Admin. SLA's five
    /// galleries are also Open-intent: Breaches/Compliance carry a numeric customerId filter
    /// server-side, but wiring that filter through these two galleries is a separate, scoped
    /// change from #3540 (which only made <see cref="TryResolveLaunchControlScope"/>'s
    /// customerId real, not every gallery that could now use it) — they still show the full MSP
    /// book rather than filtering. M365 Uptime is different: msp-m365-sla.ts's response carries
    /// the real tenant GUID per customer, which this app's real
    /// <see cref="ITenantService.CurrentTenant"/> already has — so that one gallery is genuinely
    /// filtered to the selected tenant today.</summary>
    private void RegisterWatchTab()
    {
        _shellRegistry.RegisterFixedTabGroup(FixedTab.Watch, new RibbonGroupSpec
        {
            Label = "Support Tickets",
            Order = 10,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Open Requests",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Every ticket under your MSP's Zoho Desk org — customer requests + chat escalations (GET /api/msp/support/requests, #3488)",
                    OnSelect = () => { _ = OpenSupportTicketsListAsync(); },
                },
            },
        });

        _shellRegistry.RegisterFixedTabGroup(FixedTab.Watch, new RibbonGroupSpec
        {
            Label = "SLA",
            Order = 20,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Breaches",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Unresolved SLA breaches across the book (GET /api/msp/sla/breaches)",
                    LiveCountAsync = () => CountOpenSlaBreachesAsync(),
                    Gallery = new GallerySpec
                    {
                        Title = "SLA Breaches",
                        Searchable = true,
                        GetRowsAsync = BuildSlaBreachRowsAsync,
                    },
                    OnSelect = () => { },
                },
                new RibbonCommandSpec
                {
                    Label = "Escalations",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Open SLA escalations (GET /api/msp/sla/escalations)",
                    LiveCountAsync = () => CountOpenSlaEscalationsAsync(),
                    Gallery = new GallerySpec
                    {
                        Title = "SLA Escalations",
                        Searchable = true,
                        GetRowsAsync = BuildSlaEscalationRowsAsync,
                    },
                    OnSelect = () => { },
                },
                new RibbonCommandSpec
                {
                    Label = "Compliance",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Monthly SLA compliance history (GET /api/msp/sla/compliance)",
                    Gallery = new GallerySpec
                    {
                        Title = "SLA Compliance",
                        Searchable = true,
                        GetRowsAsync = BuildSlaComplianceRowsAsync,
                    },
                    OnSelect = () => { },
                },
                new RibbonCommandSpec
                {
                    Label = "Policies",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Active SLA policies for this MSP (GET /api/msp/sla/policies)",
                    Gallery = new GallerySpec
                    {
                        Title = "SLA Policies",
                        Searchable = true,
                        GetRowsAsync = BuildSlaPolicyRowsAsync,
                    },
                    OnSelect = () => { },
                },
                new RibbonCommandSpec
                {
                    Label = "M365 Uptime",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Microsoft's own 99.9% third-party uptime commitment, selected tenant (GET /api/msp/m365-sla)",
                    Gallery = new GallerySpec
                    {
                        Title = "M365 Uptime",
                        Searchable = false,
                        GetRowsAsync = BuildM365SlaRowsAsync,
                    },
                    OnSelect = () => { },
                },
            },
        });

        _shellRegistry.RegisterFixedTabGroup(FixedTab.Watch, new RibbonGroupSpec
        {
            Label = "Task Queue",
            Order = 30,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Open Tasks",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Virtual queue — unresolved SLA breaches + scope-creep violations, deep-linked to the Admin Panel (GET /api/msp/operator-tasks, live via SSE #3490)",
                    LiveCountAsync = () => CountOpenOperatorTasksAsync(),
                    Gallery = new GallerySpec
                    {
                        Title = "Task Queue",
                        Searchable = true,
                        GetRowsAsync = BuildOperatorTaskRowsAsync,
                    },
                    OnSelect = () => { },
                },
            },
        });

        _shellRegistry.RegisterFixedTabGroup(FixedTab.Watch, new RibbonGroupSpec
        {
            Label = "Alerts",
            Order = 40,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Alerts",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Real GET /api/msp/alerts (#3483) — cross-tenant triage feed, merged from open policy incidents and each customer's latest diagnostic findings",
                    LiveCountAsync = () => GetOpenAlertsCountAsync(),
                    Gallery = new GallerySpec
                    {
                        Title = "Alerts",
                        Searchable = true,
                        GetRowsAsync = BuildAlertRowsAsync,
                    },
                    OnSelect = () => { },
                },
            },
        });
    }

    // ---- Task Queue (#3490) — real msp-sla.ts operator-tasks galleries ------------------------

    private async System.Threading.Tasks.Task<int> CountOpenOperatorTasksAsync()
    {
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): a LiveCount recompute fires on every
            // fixed-tab render and every real SSE push (#3490); blocking here froze the whole ribbon.
            return (await _taskQueueService.GetTasksAsync().ConfigureAwait(true)).Count;
        }
        catch
        {
            // LiveCount has no error surface of its own (Shell/ShellContracts.cs) — 0 is honest
            // "couldn't reach it right now", the gallery itself shows the real error message.
            return 0;
        }
    }

    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildOperatorTaskRowsAsync()
    {
        System.Collections.Generic.IReadOnlyList<Models.OperatorTask> tasks;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): gallery row source, must not freeze
            // the UI thread while the task-queue call is in flight.
            tasks = await _taskQueueService.GetTasksAsync().ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            return new[]
            {
                new GalleryRowSpec { Id = "operator-task-error", Name = $"Could not load task queue: {ex.Message}", OnSelect = () => { } },
            };
        }

        return tasks
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => new GalleryRowSpec
            {
                Id = t.Id,
                Tile = t.Severity.Length >= 2 ? t.Severity[..2].ToUpperInvariant() : t.Severity.ToUpperInvariant(),
                Name = string.IsNullOrWhiteSpace(t.CustomerName) && t.CustomerId == null
                    ? t.Category
                    : $"{t.CustomerName ?? $"Customer #{t.CustomerId}"} · {t.Category}",
                Sub = t.Description,
                OnSelect = () => OpenOperatorTaskRecord(t),
            })
            .ToList();
    }

    private void OpenOperatorTaskRecord(Models.OperatorTask task)
    {
        var spec = new RecordWorkspaceSpec
        {
            Kind = "operator-task",
            Id = task.Id,
            Eyebrow = task.Category,
            Title = task.CustomerName ?? (task.CustomerId.HasValue ? $"Customer #{task.CustomerId}" : task.Category),
            Sub = task.Severity,
            Facts =
            {
                new WorkspaceFact { Label = "Type", Value = task.Type },
                new WorkspaceFact { Label = "Severity", Value = task.Severity },
                new WorkspaceFact { Label = "Created", Value = task.CreatedAt.ToLocalTime().ToString("g"), Prose = true },
                new WorkspaceFact
                {
                    Label = "Resolved",
                    Value = task.ResolvedAt.HasValue ? task.ResolvedAt.Value.ToLocalTime().ToString("g") : "not yet",
                    Prose = true,
                },
                new WorkspaceFact { Label = "Admin Panel", Value = task.DeepLink ?? "(none)", Prose = true },
            },
            Body = ("Description", task.Description),
        };

        _shellRegistry.OpenRecord(spec);
    }

    // ---- Support Tickets (#3488) — real msp-support.ts client, full-panel workspaces ------------

    /// <summary>Opens the cross-org ticket list (GET /api/msp/support/requests) as a full-panel
    /// record workspace. A <c>configured: false</c> response (no Zoho Desk connection yet) renders
    /// as a real, honest state rather than an error or an empty list indistinguishable from "zero
    /// tickets." On an auth or transport failure the record states the honest reason.</summary>
    private async System.Threading.Tasks.Task OpenSupportTicketsListAsync()
    {
        SupportRequestsList result;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the request returned.
            result = await _supportTicketsService.GetRequestsAsync().ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "support-tickets",
                Id = "support-tickets",
                Eyebrow = "Support Tickets",
                Title = "Open Requests",
                Sub = "Could not load",
                Body = ("Error", DescribeSupportTicketsError(ex)),
            });
            return;
        }

        if (!result.Configured)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "support-tickets",
                Id = "support-tickets",
                Eyebrow = "Support Tickets",
                Title = "Open Requests",
                Sub = "Zoho Desk isn't connected for this MSP yet",
                Body = ("Not connected", "No requests can load until Zoho Desk is connected for your org."),
            });
            return;
        }

        var spec = new RecordWorkspaceSpec
        {
            Kind = "support-tickets",
            Id = "support-tickets",
            Eyebrow = "Support Tickets",
            Title = "Open Requests",
            Sub = result.Requests.Count == 0
                ? "No tickets under your MSP's Zoho Desk org"
                : $"{result.Count} ticket(s), most recently modified first",
            List = result.Requests.Count == 0
                ? null
                : ("Requests", result.Requests.Select(t => new WorkspaceListRow
                {
                    Id = t.Id,
                    Name = t.Subject,
                    Sub = $"{(string.IsNullOrEmpty(t.TicketNumber) ? $"#{t.Id}" : $"#{t.TicketNumber}")} · {t.Status ?? t.StatusType ?? "?"}",
                    Right = t.ModifiedTime,
                    OnSelect = () => { _ = OpenSupportTicketRecordAsync(t.Id, t.Subject); },
                }).ToList()),
        };

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>Opens one ticket (GET /api/msp/support/requests/:ticketId) as a full-panel record
    /// with its full operator-visible conversation thread (private notes included) and a
    /// write-through reply action — public (customer-visible) or internal-only, per the route's
    /// own <c>isPublic</c> flag. Not confirm-armed: a reply/note isn't destructive.</summary>
    private async System.Threading.Tasks.Task OpenSupportTicketRecordAsync(string ticketId, string? subjectHint)
    {
        SupportTicketDetail? detail;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the request returned.
            detail = await _supportTicketsService.GetTicketDetailAsync(ticketId).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "support-ticket",
                Id = $"support-ticket-{ticketId}",
                Eyebrow = "Support Tickets",
                Title = subjectHint ?? $"Ticket #{ticketId}",
                Sub = "Could not load",
                Body = ("Error", DescribeSupportTicketsError(ex)),
            });
            return;
        }

        if (detail == null)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "support-ticket",
                Id = $"support-ticket-{ticketId}",
                Eyebrow = "Support Tickets",
                Title = subjectHint ?? $"Ticket #{ticketId}",
                Sub = "Not found",
                Body = ("Not found", "This request no longer exists in your MSP's Zoho Desk org."),
            });
            return;
        }

        var request = detail.Request;
        var replyMessage = string.Empty;

        var spec = new RecordWorkspaceSpec
        {
            Kind = "support-ticket",
            Id = $"support-ticket-{request.Id}",
            Eyebrow = "Support Tickets",
            Title = request.Subject,
            Sub = $"{(string.IsNullOrEmpty(request.TicketNumber) ? $"#{request.Id}" : $"#{request.TicketNumber}")} · {request.Status ?? "?"}",
            Facts =
            {
                new WorkspaceFact { Label = "Status", Value = request.Status ?? "?" },
                new WorkspaceFact { Label = "Type", Value = request.StatusType ?? "?" },
                new WorkspaceFact { Label = "Created", Value = request.CreatedTime ?? "?", Prose = true },
                new WorkspaceFact { Label = "Modified", Value = request.ModifiedTime ?? "?", Prose = true },
            },
            List = detail.Thread.Count == 0
                ? null
                : ("Conversation", detail.Thread.Select(t => new WorkspaceListRow
                {
                    Id = t.Id,
                    Name = string.IsNullOrEmpty(t.Author) ? "(no author)" : t.Author!,
                    Sub = $"{(t.Kind == "comment" ? "internal note" : t.Direction == "in" ? "from customer" : "reply")}"
                          + (t.IsPublic ? "" : " · private") + " · " + t.Content,
                    Right = t.CreatedTime,
                    OnSelect = () => { }, // thread entries have no deeper record — display only
                }).ToList()),
        };

        spec.Edits.Add(new WorkspaceEdit
        {
            Key = "reply-message",
            Label = "Reply message",
            Value = string.Empty,
            OnChange = v => replyMessage = v,
        });
        spec.Actions.Add(new WorkspaceAction
        {
            Label = "Send reply to customer",
            OnSelect = () => { _ = RunSupportTicketReplyAsync(request.Id, request.Subject, () => replyMessage, isPublic: true); },
        });
        spec.Actions.Add(new WorkspaceAction
        {
            Label = "Add internal note",
            OnSelect = () => { _ = RunSupportTicketReplyAsync(request.Id, request.Subject, () => replyMessage, isPublic: false); },
        });
        if (!string.IsNullOrEmpty(request.WebUrl))
        {
            spec.Actions.Add(new WorkspaceAction
            {
                Label = "Open in Zoho Desk",
                OnSelect = () => Process.Start(new ProcessStartInfo(request.WebUrl!) { UseShellExecute = true }),
            });
        }
        spec.Actions.Add(new WorkspaceAction
        {
            Label = "Back to Open Requests",
            OnSelect = () => { _ = OpenSupportTicketsListAsync(); },
        });

        _shellRegistry.OpenContextual(
            new TrailEntry("support-ticket", request.Id, request.Subject,
                () => { _ = OpenSupportTicketRecordAsync(request.Id, request.Subject); }),
            new ContextualTabSpec
            {
                Id = "support-ticket",
                Label = "Support Ticket",
                Groups =
                {
                    new RibbonGroupSpec
                    {
                        Label = "Actions",
                        Large = { new RibbonCommandSpec
                        {
                            Label = "Send reply to customer",
                            Intent = RibbonIntent.Record,
                            OnSelect = () => { },
                        } },
                    },
                },
            },
            onSearchEverything: () => PaletteOverlay.Open());

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>Performs the real POST .../reply with the operator-supplied message, then reopens
    /// the ticket record so the new reply/note shows in the conversation immediately. Message is
    /// validated client-side first to avoid a guaranteed 400.</summary>
    private async System.Threading.Tasks.Task RunSupportTicketReplyAsync(string ticketId, string? subjectHint, Func<string> messageGetter, bool isPublic)
    {
        var message = (messageGetter() ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(message))
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "support-ticket-reply",
                Id = $"support-ticket-reply-{ticketId}",
                Eyebrow = "Support Tickets",
                Title = subjectHint ?? $"Ticket #{ticketId}",
                Sub = "Nothing sent",
                Body = ("Reply", "Enter a message before sending."),
                Actions = { new WorkspaceAction { Label = "Back to ticket", OnSelect = () => { _ = OpenSupportTicketRecordAsync(ticketId, subjectHint); } } },
            });
            return;
        }

        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the reply POST returned.
            var result = await _supportTicketsService.ReplyAsync(ticketId, message, isPublic).ConfigureAwait(true);
            ConsolePanel.AppendExternal($"[Support Tickets] {result.Message}");
        }
        catch (Exception ex)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "support-ticket-reply",
                Id = $"support-ticket-reply-{ticketId}",
                Eyebrow = "Support Tickets",
                Title = subjectHint ?? $"Ticket #{ticketId}",
                Sub = "Failed",
                Body = ("Server response", DescribeSupportTicketsError(ex)),
                Actions = { new WorkspaceAction { Label = "Back to ticket", OnSelect = () => { _ = OpenSupportTicketRecordAsync(ticketId, subjectHint); } } },
            });
            return;
        }

        await OpenSupportTicketRecordAsync(ticketId, subjectHint).ConfigureAwait(true);
    }

    /// <summary>Best-effort human message from a <see cref="SupportTicketsServiceException"/> (which
    /// already parses the route's <c>{ error }</c>) or any other transport error.</summary>
    private static string DescribeSupportTicketsError(Exception ex) => ex switch
    {
        SupportTicketsServiceException stse => stse.Message,
        _ => ex.Message,
    };


    // ---- SLA (#3487) — real msp-sla.ts + msp-m365-sla.ts clients, full-panel workspaces -------

    private async System.Threading.Tasks.Task<int> CountOpenSlaBreachesAsync()
    {
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): a LiveCount recompute fires on every
            // fixed-tab render; blocking here froze the whole ribbon.
            return (await _slaService.GetBreachesAsync().ConfigureAwait(true)).Count;
        }
        catch
        {
            // LiveCount has no error surface of its own (Shell/ShellContracts.cs) — 0 is honest
            // "couldn't reach it right now", the gallery itself shows the real error message.
            return 0;
        }
    }

    private async System.Threading.Tasks.Task<int> CountOpenSlaEscalationsAsync()
    {
        try
        {
            return (await _slaService.GetEscalationsAsync().ConfigureAwait(true)).Count;
        }
        catch
        {
            return 0;
        }
    }

    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildSlaBreachRowsAsync()
    {
        System.Collections.Generic.IReadOnlyList<Models.SlaBreach> breaches;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): gallery row source, must not freeze
            // the UI thread while the SLA breaches call is in flight.
            breaches = await _slaService.GetBreachesAsync().ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            return new[]
            {
                new GalleryRowSpec { Id = "sla-breach-error", Name = $"Could not load SLA breaches: {ex.Message}", OnSelect = () => { } },
            };
        }

        return breaches
            .OrderByDescending(b => b.ElapsedMinutes)
            .Select(b => new GalleryRowSpec
            {
                Id = b.BreachId,
                Tile = (b.BreachType ?? b.Phase).Length >= 2 ? (b.BreachType ?? b.Phase)[..2].ToUpperInvariant() : (b.BreachType ?? b.Phase).ToUpperInvariant(),
                Name = string.IsNullOrWhiteSpace(b.TicketRef) ? $"Customer #{b.CustomerId} · {b.Phase}" : $"{b.TicketRef} · {b.Phase}",
                Sub = $"{Math.Round(b.ElapsedMinutes)}m elapsed / {Math.Round(b.ThresholdMinutes)}m limit",
                OnSelect = () => OpenSlaBreachRecord(b),
            })
            .ToList();
    }

    private void OpenSlaBreachRecord(Models.SlaBreach breach)
    {
        var spec = new RecordWorkspaceSpec
        {
            Kind = "sla-breach",
            Id = breach.BreachId,
            Eyebrow = "SLA Breach",
            Title = string.IsNullOrWhiteSpace(breach.TicketRef) ? breach.BreachId : breach.TicketRef,
            Sub = $"Customer #{breach.CustomerId} · {breach.Phase}",
            Facts =
            {
                new WorkspaceFact { Label = "Breach type", Value = breach.BreachType ?? "(none)" },
                new WorkspaceFact { Label = "Elapsed", Value = $"{Math.Round(breach.ElapsedMinutes)} min" },
                new WorkspaceFact { Label = "Threshold", Value = $"{Math.Round(breach.ThresholdMinutes)} min" },
                new WorkspaceFact { Label = "Timer", Value = breach.TimerId, Prose = true },
                new WorkspaceFact { Label = "Created", Value = breach.CreatedAt.ToLocalTime().ToString("g"), Prose = true },
                new WorkspaceFact
                {
                    Label = "Resolved",
                    Value = breach.ResolvedAt.HasValue ? breach.ResolvedAt.Value.ToLocalTime().ToString("g") : "not yet",
                    Prose = true,
                },
            },
            Body = string.IsNullOrWhiteSpace(breach.ResolutionNotes) ? null : ("Resolution notes", breach.ResolutionNotes!),
            Actions = breach.ResolvedAt.HasValue
                ? new System.Collections.Generic.List<WorkspaceAction>()
                : new System.Collections.Generic.List<WorkspaceAction>
                {
                    new WorkspaceAction
                    {
                        Label = "Resolve Timer",
                        Confirm = true,
                        OnSelect = () => { _ = ResolveSlaTimerAsync(breach.TimerId); },
                    },
                },
        };

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>POST /api/msp/sla/timers/:timerId/resolve — the real backend action behind a
    /// breach's Resolve (there is no per-breach resolve endpoint; the timer is the resolvable
    /// unit). Re-opens the breach record afterward so the workspace reflects the real
    /// resolvedAt the server just set.</summary>
    private async System.Threading.Tasks.Task ResolveSlaTimerAsync(string timerId)
    {
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the resolve POST returned.
            await _slaService.ResolveTimerAsync(timerId, null).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[SLA] Could not resolve timer {timerId}: {ex.Message}");
            return;
        }

        var refreshed = (await _slaService.GetBreachesAsync().ConfigureAwait(true))
            .FirstOrDefault(b => b.TimerId == timerId);
        if (refreshed != null) OpenSlaBreachRecord(refreshed);
    }

    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildSlaEscalationRowsAsync()
    {
        System.Collections.Generic.IReadOnlyList<Models.SlaEscalation> escalations;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): gallery row source, must not freeze
            // the UI thread while the SLA escalations call is in flight.
            escalations = await _slaService.GetEscalationsAsync().ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            return new[]
            {
                new GalleryRowSpec { Id = "sla-escalation-error", Name = $"Could not load SLA escalations: {ex.Message}", OnSelect = () => { } },
            };
        }

        return escalations
            .OrderByDescending(e => e.Level)
            .ThenByDescending(e => e.CreatedAt)
            .Select(e => new GalleryRowSpec
            {
                Id = e.EscalationId,
                Tile = $"L{e.Level}",
                Name = $"Customer #{e.CustomerId} · {e.EscalationType ?? "escalation"}",
                Sub = $"{e.Status} · {(string.IsNullOrWhiteSpace(e.AssignedTo) ? "unassigned" : e.AssignedTo)}",
                OnSelect = () => OpenSlaEscalationRecord(e),
            })
            .ToList();
    }

    private void OpenSlaEscalationRecord(Models.SlaEscalation escalation)
    {
        var spec = new RecordWorkspaceSpec
        {
            Kind = "sla-escalation",
            Id = escalation.EscalationId,
            Eyebrow = "SLA Escalation",
            Title = $"Level {escalation.Level} · Customer #{escalation.CustomerId}",
            Sub = escalation.Status,
            Facts =
            {
                new WorkspaceFact { Label = "Type", Value = escalation.EscalationType ?? "(none)" },
                new WorkspaceFact { Label = "Target", Value = escalation.Target ?? "(none)", Prose = true },
                new WorkspaceFact { Label = "Assigned to", Value = escalation.AssignedTo ?? "unassigned", Prose = true },
                new WorkspaceFact { Label = "Breach", Value = escalation.BreachId ?? "(none)", Prose = true },
                new WorkspaceFact
                {
                    Label = "Escalated",
                    Value = escalation.EscalatedAt.HasValue ? escalation.EscalatedAt.Value.ToLocalTime().ToString("g") : "(none)",
                    Prose = true,
                },
            },
        };

        _shellRegistry.OpenRecord(spec);
    }

    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildSlaComplianceRowsAsync()
    {
        System.Collections.Generic.IReadOnlyList<Models.SlaComplianceRecord> records;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): gallery row source, must not freeze
            // the UI thread while the SLA compliance call is in flight.
            records = await _slaService.GetComplianceAsync().ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            return new[]
            {
                new GalleryRowSpec { Id = "sla-compliance-error", Name = $"Could not load SLA compliance: {ex.Message}", OnSelect = () => { } },
            };
        }

        return records
            .OrderByDescending(r => r.PeriodStart)
            .Select(r => new GalleryRowSpec
            {
                Id = r.RecordId,
                Tile = $"{Math.Round(r.CompliancePct)}%",
                Name = $"Customer #{r.CustomerId} · {r.PeriodStart:yyyy-MM}",
                Sub = $"{r.BreachedTickets}/{r.TotalTickets} tickets breached",
                OnSelect = () => OpenSlaComplianceRecord(r),
            })
            .ToList();
    }

    private void OpenSlaComplianceRecord(Models.SlaComplianceRecord record)
    {
        var spec = new RecordWorkspaceSpec
        {
            Kind = "sla-compliance",
            Id = record.RecordId,
            Eyebrow = "SLA Compliance",
            Title = $"Customer #{record.CustomerId} · {record.PeriodStart:yyyy-MM}",
            Sub = $"{record.CompliancePct:0.0}% compliant",
            Facts =
            {
                new WorkspaceFact { Label = "Period", Value = $"{record.PeriodStart:yyyy-MM-dd} – {record.PeriodEnd:yyyy-MM-dd}", Prose = true },
                new WorkspaceFact { Label = "Total tickets", Value = record.TotalTickets.ToString() },
                new WorkspaceFact { Label = "Breached tickets", Value = record.BreachedTickets.ToString() },
                new WorkspaceFact
                {
                    Label = "Avg response",
                    Value = record.AvgResponseMinutes.HasValue ? $"{Math.Round(record.AvgResponseMinutes.Value)} min" : "(none)",
                },
                new WorkspaceFact
                {
                    Label = "Avg resolution",
                    Value = record.AvgResolutionMinutes.HasValue ? $"{Math.Round(record.AvgResolutionMinutes.Value)} min" : "(none)",
                },
            },
            Body = string.IsNullOrWhiteSpace(record.Notes) ? null : ("Notes", record.Notes!),
        };

        _shellRegistry.OpenRecord(spec);
    }

    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildSlaPolicyRowsAsync()
    {
        System.Collections.Generic.IReadOnlyList<Models.SlaPolicy> policies;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): gallery row source, must not freeze
            // the UI thread while the SLA policies call is in flight.
            policies = await _slaService.GetPoliciesAsync().ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            return new[]
            {
                new GalleryRowSpec { Id = "sla-policy-error", Name = $"Could not load SLA policies: {ex.Message}", OnSelect = () => { } },
            };
        }

        return policies
            .OrderBy(p => p.MspId.HasValue ? 0 : 1)
            .ThenBy(p => p.Id)
            .Select(p => new GalleryRowSpec
            {
                Id = p.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                Tile = p.Priority.Length >= 2 ? p.Priority[..2].ToUpperInvariant() : p.Priority.ToUpperInvariant(),
                Name = p.Name,
                Sub = p.MspId.HasValue ? "MSP override" : "Global default",
                OnSelect = () => OpenSlaPolicyRecord(p),
            })
            .ToList();
    }

    private void OpenSlaPolicyRecord(Models.SlaPolicy policy)
    {
        var spec = new RecordWorkspaceSpec
        {
            Kind = "sla-policy",
            Id = policy.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Eyebrow = "SLA Policy",
            Title = policy.Name,
            Sub = policy.MspId.HasValue ? "MSP override" : "Global default",
            Facts =
            {
                new WorkspaceFact { Label = "Priority", Value = policy.Priority },
                new WorkspaceFact { Label = "Response time", Value = $"{policy.ResponseTimeMinutes} min" },
                new WorkspaceFact { Label = "Warning threshold", Value = $"{policy.WarningThresholdPct}%" },
                new WorkspaceFact { Label = "Resolution time", Value = $"{policy.ResolutionTimeMinutes} min" },
                new WorkspaceFact { Label = "Resolution warning", Value = $"{policy.ResolutionWarningThresholdPct}%" },
                new WorkspaceFact { Label = "Active", Value = policy.IsActive ? "Yes" : "No" },
            },
            Body = string.IsNullOrWhiteSpace(policy.Description) ? null : ("Description", policy.Description!),
        };

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>Real per-tenant filtering, unlike the four galleries above: msp-m365-sla.ts's
    /// response carries the real tenant GUID per customer, which this app's
    /// <see cref="ITenantService.CurrentTenant"/> already has — so this states "no tenant
    /// selected" honestly rather than the #3540 gap the others hit.</summary>
    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildM365SlaRowsAsync()
    {
        var tenant = _tenantService.CurrentTenant;
        if (tenant == null)
        {
            return new[]
            {
                new GalleryRowSpec { Id = "m365sla-no-tenant", Name = "Select a tenant first", OnSelect = () => { } },
            };
        }

        Models.M365SlaResponse response;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): gallery row source, must not freeze
            // the UI thread while the M365 uptime call is in flight.
            response = await _slaService.GetM365SlaAsync().ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            return new[]
            {
                new GalleryRowSpec { Id = "m365sla-error", Name = $"Could not load M365 uptime: {ex.Message}", OnSelect = () => { } },
            };
        }

        var customer = response.Customers.FirstOrDefault(c => string.Equals(c.TenantId, tenant.TenantGuid, StringComparison.OrdinalIgnoreCase));
        if (customer == null || customer.Services.Count == 0)
        {
            return new[]
            {
                new GalleryRowSpec { Id = "m365sla-none", Name = $"No M365 uptime data for {tenant.Name} yet", OnSelect = () => { } },
            };
        }

        return customer.Services
            .Select(s => new GalleryRowSpec
            {
                Id = $"{customer.CustomerId}:{s.ServiceName}",
                Tile = s.UptimePercent30d.HasValue ? $"{s.UptimePercent30d.Value:0.0}%" : "—",
                Name = s.ServiceName,
                Sub = s.Breached30d || s.Breached90d
                    ? $"Below {response.Target}% target — {(s.Breached30d ? "30d" : "90d")} breach"
                    : $"90d: {(s.UptimePercent90d.HasValue ? $"{s.UptimePercent90d.Value:0.0}%" : "—")}",
                OnSelect = () => OpenM365SlaServiceRecord(customer, s, response.Target),
            })
            .ToList();
    }

    private void OpenM365SlaServiceRecord(Models.M365SlaCustomer customer, Models.M365SlaService service, double target)
    {
        var spec = new RecordWorkspaceSpec
        {
            Kind = "m365-sla-service",
            Id = $"{customer.CustomerId}:{service.ServiceName}",
            Eyebrow = "M365 Uptime",
            Title = service.ServiceName,
            Sub = customer.CustomerName,
            Facts =
            {
                new WorkspaceFact { Label = "Target", Value = $"{target}%" },
                new WorkspaceFact { Label = "30-day uptime", Value = service.UptimePercent30d.HasValue ? $"{service.UptimePercent30d.Value:0.00}%" : "(no data)" },
                new WorkspaceFact { Label = "90-day uptime", Value = service.UptimePercent90d.HasValue ? $"{service.UptimePercent90d.Value:0.00}%" : "(no data)" },
                new WorkspaceFact { Label = "30-day breach", Value = service.Breached30d ? "Yes" : "No" },
                new WorkspaceFact { Label = "90-day breach", Value = service.Breached90d ? "Yes" : "No" },
            },
        };

        _shellRegistry.OpenRecord(spec);
    }


    // ---- Break-Glass Access (#3480) — real msp-break-glass.ts client, full-panel workspaces ----

    /// <summary>Opens the cross-tenant pending list (GET /api/msp/break-glass) as a full-panel record
    /// workspace. Each row is a real pending_delivery secret carrying its own numeric customerId, so a
    /// drill-down into detail/override/audit never depends on a locally-resolved tenant id. On an auth
    /// or transport failure the record states the honest reason (a 401/403 means the operator session
    /// isn't attached, not a bug here) rather than showing a fabricated list.</summary>
    private async System.Threading.Tasks.Task OpenBreakGlassPendingListAsync()
    {
        System.Collections.Generic.IReadOnlyList<Models.BreakGlassPendingItem> pending;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the request returned.
            pending = await _breakGlassService.GetPendingAsync().ConfigureAwait(true);
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
                    OnSelect = () => { _ = OpenBreakGlassSecretRecordAsync(p.CustomerId, p.PendingSecretId, p.CustomerName); },
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
    private async System.Threading.Tasks.Task OpenBreakGlassSecretRecordAsync(int customerId, int pendingSecretId, string? customerName)
    {
        Models.BreakGlassSecretDetail detail;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the request returned.
            detail = await _breakGlassService.GetSecretDetailAsync(customerId, pendingSecretId).ConfigureAwait(true);
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
                OnSelect = () => { _ = RunBreakGlassOverrideAsync(customerId, pendingSecretId, customerName, () => overrideReason, () => overrideEmails); },
            });
        }

        spec.Actions.Add(new WorkspaceAction
        {
            Label = "View override audit trail",
            OnSelect = () => { _ = OpenBreakGlassAuditRecordAsync(customerId, customerName); },
        });
        spec.Actions.Add(new WorkspaceAction
        {
            Label = "View customer break-glass history",
            OnSelect = () => { _ = OpenBreakGlassHistoryRecordAsync(customerId, customerName); },
        });

        _shellRegistry.OpenContextual(
            new TrailEntry("break-glass-secret", pendingSecretId.ToString(), $"Break-Glass #{pendingSecretId}",
                () => { _ = OpenBreakGlassSecretRecordAsync(customerId, pendingSecretId, customerName); }),
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
    private async System.Threading.Tasks.Task RunBreakGlassOverrideAsync(int customerId, int pendingSecretId, string? customerName, Func<string> reasonGetter, Func<string> emailsGetter)
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
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the override POST returned.
            var result = await _breakGlassService
                .AdminOverrideAsync(customerId, pendingSecretId, reason, emails.Count > 0 ? emails : null)
                .ConfigureAwait(true);

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
                    new WorkspaceAction { Label = "View override audit trail", OnSelect = () => { _ = OpenBreakGlassAuditRecordAsync(customerId, customerName); } },
                    new WorkspaceAction { Label = "Back to pending requests", OnSelect = () => { _ = OpenBreakGlassPendingListAsync(); } },
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
                    new WorkspaceAction { Label = "Back to secret", OnSelect = () => { _ = OpenBreakGlassSecretRecordAsync(customerId, pendingSecretId, customerName); } },
                },
            });
        }
    }

    /// <summary>Opens the per-customer override audit trail (GET .../break-glass/audit) — #3480's
    /// "audit trail view" checklist item — as a full-panel record workspace list.</summary>
    private async System.Threading.Tasks.Task OpenBreakGlassAuditRecordAsync(int customerId, string? customerName)
    {
        System.Collections.Generic.IReadOnlyList<Models.BreakGlassAuditEntry> audit;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the request returned.
            audit = await _breakGlassService.GetAuditAsync(customerId).ConfigureAwait(true);
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
    private async System.Threading.Tasks.Task OpenBreakGlassHistoryRecordAsync(int customerId, string? customerName)
    {
        System.Collections.Generic.IReadOnlyList<Models.BreakGlassSecretHistoryItem> history;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the request returned.
            history = await _breakGlassService.GetCustomerHistoryAsync(customerId).ConfigureAwait(true);
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
                    OnSelect = () => { _ = OpenBreakGlassSecretRecordAsync(customerId, h.PendingSecretId, customerName); },
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

    // ---- Audit Log (#3489) — real msp-audit-log.ts client, filterable by tenant / action type ----

    /// <summary>Opens the real audit trail (GET /api/msp/audit) as a full-panel record workspace.
    /// <see cref="WorkspaceEdit"/> fields capture the two filters the issue asks for — tenant
    /// (<c>mspId</c>, honored server-side for PlatformAdmin only) and action type (server-side
    /// <c>ilike</c> substring match) — locally, and an <c>Apply filters</c> action re-runs the
    /// query and re-opens the record with the results, the same local-capture-then-refresh pattern
    /// the Break-Glass override form and VIP lookup box already use. On an auth or transport
    /// failure the record states the honest reason rather than showing a fabricated list.</summary>
    private async System.Threading.Tasks.Task OpenAuditLogAsync(Models.AuditLogFilter filter)
    {
        Models.AuditLogPage page;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the request returned.
            page = await _auditLogService.GetAuditLogAsync(filter).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "audit-log",
                Id = "audit-log",
                Eyebrow = "Admin",
                Title = "Audit Log",
                Sub = "Could not load",
                Body = ("Error", DescribeAuditLogError(ex)),
            });
            return;
        }

        var mspId = filter.MspId ?? string.Empty;
        var actionType = filter.ActionType ?? string.Empty;

        void Rerun() => _ = OpenAuditLogAsync(new Models.AuditLogFilter
        {
            MspId = string.IsNullOrWhiteSpace(mspId) ? null : mspId,
            ActionType = string.IsNullOrWhiteSpace(actionType) ? null : actionType,
        });

        var spec = new RecordWorkspaceSpec
        {
            Kind = "audit-log",
            Id = "audit-log",
            Eyebrow = "Admin",
            Title = "Audit Log",
            Sub = page.Entries.Count == 0
                ? "No audit entries match the current filters"
                : $"{page.Entries.Count} of {page.Total} entries, most recent first (page {page.Page})",
            Edits =
            {
                new WorkspaceEdit
                {
                    Key = "mspId",
                    Label = "Tenant (MSP ID — PlatformAdmin only)",
                    Value = mspId,
                    OnChange = v => mspId = v,
                },
                new WorkspaceEdit
                {
                    Key = "actionType",
                    Label = "Action type",
                    Value = actionType,
                    OnChange = v => actionType = v,
                },
            },
            Actions =
            {
                new WorkspaceAction { Label = "Apply filters", OnSelect = Rerun },
            },
            List = page.Entries.Count == 0
                ? null
                : ("Entries", page.Entries.Select(e => new WorkspaceListRow
                {
                    Id = e.Id.ToString(),
                    Name = e.Action,
                    Sub = $"{e.ActorEmail ?? e.ActorRole ?? "unknown actor"} · {e.Resource ?? "—"} · {e.CreatedAt}",
                    Right = e.Outcome,
                    OnSelect = () => OpenAuditLogEntry(e),
                }).ToList()),
        };

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>One audit entry's full detail — the raw <c>detail</c> string the route already
    /// flattens from <c>metadata</c>, plus a link back to the filtered list.</summary>
    private void OpenAuditLogEntry(Models.AuditLogEntry entry)
    {
        _shellRegistry.OpenRecord(new RecordWorkspaceSpec
        {
            Kind = "audit-log-entry",
            Id = $"audit-log-entry-{entry.Id}",
            Eyebrow = "Admin · Audit Log",
            Title = entry.Action,
            Sub = entry.CreatedAt,
            Facts =
            {
                new WorkspaceFact { Label = "Actor", Value = entry.ActorEmail ?? entry.ActorName ?? entry.ActorRole ?? "unknown" },
                new WorkspaceFact { Label = "Role", Value = entry.ActorRole ?? "—" },
                new WorkspaceFact { Label = "Resource", Value = entry.Resource ?? "—" },
                new WorkspaceFact { Label = "Outcome", Value = entry.Outcome ?? "—" },
                new WorkspaceFact { Label = "Event ID", Value = entry.EventId ?? "—" },
            },
            Body = string.IsNullOrWhiteSpace(entry.Detail) ? null : ("Detail", entry.Detail),
            Actions =
            {
                new WorkspaceAction { Label = "Back to Audit Log", OnSelect = () => { _ = OpenAuditLogAsync(new Models.AuditLogFilter()); } },
            },
        });
    }

    /// <summary>Best-effort human message from an <see cref="AuditLogServiceException"/> (which
    /// already parses the route's <c>{ error, detail }</c>) or any other transport error.</summary>
    private static string DescribeAuditLogError(Exception ex) => ex switch
    {
        AuditLogServiceException ale => ale.Message,
        _ => ex.Message,
    };

    // ---- Tenant Consent Status (#3485) — real msp-consent.ts client, full-panel workspaces -----

    /// <summary>Opens the cross-tenant consent list (GET /api/msp/consent) as a full-panel record
    /// workspace. Each row already carries its own real numeric customerId (tenants.id) from the
    /// server, so drilling into a per-customer detail never depends on the fixture
    /// <see cref="ITenantService"/> resolving one (the same #3540 gap <see cref="TryResolveTrackerCustomerId"/>
    /// and <see cref="TryResolveRetainerCustomerId"/> document — this Feature's cross-tenant list
    /// sidesteps it entirely, same as <see cref="OpenBreakGlassPendingList"/> already does). On an
    /// auth or transport failure the record states the honest reason rather than showing a
    /// fabricated list.</summary>
    private async System.Threading.Tasks.Task OpenConsentStatusListAsync()
    {
        System.Collections.Generic.IReadOnlyList<Models.CustomerConsentSummary> summaries;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the request returned.
            summaries = await _consentService.GetAllAsync().ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "consent-status",
                Id = "consent-status",
                Eyebrow = "Consent Status",
                Title = "Tenant Consent",
                Sub = "Could not load",
                Body = ("Error", DescribeConsentError(ex)),
            });
            return;
        }

        var spec = new RecordWorkspaceSpec
        {
            Kind = "consent-status",
            Id = "consent-status",
            Eyebrow = "Consent Status",
            Title = "Tenant Consent",
            Sub = summaries.Count == 0
                ? "No customer has any consent record yet across your MSP book"
                : $"{summaries.Count} customer(s) with a consent record, across your MSP book",
            List = summaries.Count == 0
                ? null
                : ("Customers", summaries.Select(s => new WorkspaceListRow
                {
                    Id = s.CustomerId.ToString(),
                    Name = s.CustomerName ?? $"Customer #{s.CustomerId}",
                    Sub = $"Read: {DescribeGrant(s.Graph)} · Write: {DescribeGrant(s.WriteBack)} · SharePoint: {DescribeGrant(s.Sharepoint)}",
                    Right = s.UpdatedAt.HasValue ? s.UpdatedAt.Value.ToLocalTime().ToString("g") : null,
                    OnSelect = () => { _ = OpenConsentDetailRecordAsync(s.CustomerId, s.CustomerName); },
                }).ToList()),
        };

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>Opens one customer's consent detail (GET .../customers/:customerId/consent) as a
    /// full-panel record with all three real grant keys as Facts and the real
    /// invite-link/start-consent actions (always legitimate — minting a fresh invite is valid even
    /// when a grant is already active, same as the portal's own reconsent-link path). A per-key
    /// "Revoke" action only renders when that key is currently "granted" — never a fake clickable
    /// stop over a key with nothing to revoke (UI_RULES.md §1).</summary>
    private async System.Threading.Tasks.Task OpenConsentDetailRecordAsync(int customerId, string? customerName)
    {
        Models.CustomerConsentSummary detail;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the request returned.
            detail = await _consentService.GetForCustomerAsync(customerId).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "consent-detail",
                Id = $"consent-detail-{customerId}",
                Eyebrow = "Consent Status",
                Title = customerName ?? $"Customer #{customerId}",
                Sub = "Could not load",
                Body = ("Error", DescribeConsentError(ex)),
            });
            return;
        }

        var spec = new RecordWorkspaceSpec
        {
            Kind = "consent-detail",
            Id = $"consent-detail-{customerId}",
            Eyebrow = "Consent Status",
            Title = detail.CustomerName ?? customerName ?? $"Customer #{customerId}",
            Sub = detail.UpdatedAt.HasValue ? $"Last updated {detail.UpdatedAt.Value.ToLocalTime():g}" : "No consent activity recorded yet",
            Facts =
            {
                new WorkspaceFact { Label = "Read (Graph)", Value = DescribeGrant(detail.Graph) },
                new WorkspaceFact { Label = "Write-back", Value = DescribeGrant(detail.WriteBack) },
                new WorkspaceFact { Label = "SharePoint", Value = DescribeGrant(detail.Sharepoint) },
            },
        };

        AddConsentGrantDetailFact(spec, "Read admin", detail.Graph);
        AddConsentGrantDetailFact(spec, "Write-back admin", detail.WriteBack);
        AddConsentGrantDetailFact(spec, "SharePoint admin", detail.Sharepoint);

        spec.Actions.Add(new WorkspaceAction
        {
            Label = "Generate read-consent invite link",
            OnSelect = () => { _ = RunConsentInviteActionAsync(customerId, customerName, async () =>
            {
                // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the
                // UI thread and froze the ribbon until the request returned.
                var r = await _consentService.CreateInviteLinkAsync(customerId).ConfigureAwait(true);
                return (r.ConsentUrl, r.ExpiresAt);
            }); },
        });
        spec.Actions.Add(new WorkspaceAction
        {
            Label = "Start write-back consent",
            OnSelect = () => { _ = RunConsentInviteActionAsync(customerId, customerName, async () =>
            {
                var r = await _consentService.StartWriteConsentAsync(customerId).ConfigureAwait(true);
                return (r.ConsentUrl, r.ExpiresAt);
            }); },
        });
        spec.Actions.Add(new WorkspaceAction
        {
            Label = "Start SharePoint consent",
            OnSelect = () => { _ = RunConsentInviteActionAsync(customerId, customerName, async () =>
            {
                var r = await _consentService.StartSharePointConsentAsync(customerId).ConfigureAwait(true);
                return (r.ConsentUrl, r.ExpiresAt);
            }); },
        });

        if (detail.Graph?.ConsentStatus == "granted")
        {
            spec.Actions.Add(new WorkspaceAction
            {
                Label = "Revoke read consent",
                Confirm = true,
                Danger = true,
                OnSelect = () => { _ = RunConsentRevokeAsync(customerId, customerName, "graph"); },
            });
        }
        if (detail.WriteBack?.ConsentStatus == "granted")
        {
            spec.Actions.Add(new WorkspaceAction
            {
                Label = "Revoke write-back consent",
                Confirm = true,
                Danger = true,
                OnSelect = () => { _ = RunConsentRevokeAsync(customerId, customerName, "writeBack"); },
            });
        }
        if (detail.Sharepoint?.ConsentStatus == "granted")
        {
            spec.Actions.Add(new WorkspaceAction
            {
                Label = "Revoke SharePoint consent",
                Confirm = true,
                Danger = true,
                OnSelect = () => { _ = RunConsentRevokeAsync(customerId, customerName, "sharepoint"); },
            });
        }

        spec.Actions.Add(new WorkspaceAction { Label = "Back to consent list", OnSelect = () => { _ = OpenConsentStatusListAsync(); } });

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>Appends the admin identity + granted-scopes Facts for one grant key, only when
    /// there is something real to show — an unset key already reads "not requested" from the
    /// top-level Facts block, so no redundant empty rows here.</summary>
    private static void AddConsentGrantDetailFact(RecordWorkspaceSpec spec, string label, Models.ConsentGrant? grant)
    {
        if (grant == null) return;
        var who = !string.IsNullOrEmpty(grant.AdminDisplayName) || !string.IsNullOrEmpty(grant.AdminEmail)
            ? $"{grant.AdminDisplayName}{(string.IsNullOrEmpty(grant.AdminEmail) ? "" : $" <{grant.AdminEmail}>")}"
            : null;
        var scopes = grant.Grants.Count > 0 ? string.Join(", ", grant.Grants) : null;
        if (who == null && scopes == null) return;

        spec.Facts.Add(new WorkspaceFact
        {
            Label = label,
            Value = who != null && scopes != null ? $"{who} · {scopes}" : who ?? scopes!,
            Prose = true,
        });
    }

    /// <summary>Real invite-link / write-consent / SharePoint-consent mint, then opens a result
    /// record with the real consent URL — never a "press again" confirm for these (minting a link
    /// is not destructive, it always parallels the portal's own reconsent-link path).
    /// <paramref name="mint"/> performs exactly one real call and returns its (url, expiry) pair —
    /// deliberately a single call, not two, so a second invocation never mints a second, wasted
    /// invite token just to read its expiry.</summary>
    private async System.Threading.Tasks.Task RunConsentInviteActionAsync(int customerId, string? customerName, Func<System.Threading.Tasks.Task<(string Url, DateTimeOffset Expires)>> mint)
    {
        string consentUrl;
        DateTimeOffset expiresAt;
        try
        {
            (consentUrl, expiresAt) = await mint().ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "consent-invite-result",
                Id = $"consent-invite-{customerId}-{Guid.NewGuid():N}",
                Eyebrow = "Consent Invite",
                Title = "Could not mint invite link",
                Sub = customerName ?? $"Customer #{customerId}",
                Body = ("Server response", DescribeConsentError(ex)),
                Actions = { new WorkspaceAction { Label = "Back to consent record", OnSelect = () => { _ = OpenConsentDetailRecordAsync(customerId, customerName); } } },
            });
            return;
        }

        _shellRegistry.OpenRecord(new RecordWorkspaceSpec
        {
            Kind = "consent-invite-result",
            Id = $"consent-invite-{customerId}-{Guid.NewGuid():N}",
            Eyebrow = "Consent Invite",
            Title = "Invite link ready",
            Sub = $"{customerName ?? $"Customer #{customerId}"} · expires {expiresAt.ToLocalTime():g}",
            Body = ("Consent URL", consentUrl),
            Actions =
            {
                new WorkspaceAction { Label = "Open in browser", OnSelect = () => OpenExternalUrl(consentUrl) },
                new WorkspaceAction { Label = "Copy link to clipboard", OnSelect = () => CopyConsentUrlToClipboard(consentUrl) },
                new WorkspaceAction { Label = "Back to consent record", OnSelect = () => { _ = OpenConsentDetailRecordAsync(customerId, customerName); } },
            },
        });
    }

    /// <summary>Real PATCH .../consent/revoke for one key, then reopens the customer's detail
    /// record from fresh server state so the operator sees the real post-revoke status rather than
    /// a locally-guessed one.</summary>
    private async System.Threading.Tasks.Task RunConsentRevokeAsync(int customerId, string? customerName, string key)
    {
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the revoke PATCH returned.
            await _consentService.RevokeAsync(customerId, key).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "consent-detail",
                Id = $"consent-detail-{customerId}",
                Eyebrow = "Consent Status",
                Title = customerName ?? $"Customer #{customerId}",
                Sub = "Revoke failed",
                Body = ("Server response", DescribeConsentError(ex)),
                Actions = { new WorkspaceAction { Label = "Back to consent record", OnSelect = () => { _ = OpenConsentDetailRecordAsync(customerId, customerName); } } },
            });
            return;
        }

        await OpenConsentDetailRecordAsync(customerId, customerName).ConfigureAwait(true);
    }

    private static void OpenExternalUrl(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        }
        catch
        {
            // Ignore failure to launch external process — same best-effort handling as the
            // existing LaunchExternalButton_Click.
        }
    }

    private static void CopyConsentUrlToClipboard(string url)
    {
        try
        {
            System.Windows.Clipboard.SetText(string.IsNullOrEmpty(url) ? " " : url);
        }
        catch
        {
            // Clipboard can transiently fail if another process holds it; ignore (same handling
            // as VaultPanelView's CopyToClipboard).
        }
    }

    /// <summary>Human-readable grant status for a Fact/list row: the real status text when a grant
    /// record exists, "not requested" when the key has never been started for this tenant.</summary>
    private static string DescribeGrant(Models.ConsentGrant? grant) => grant?.ConsentStatus ?? "not requested";

    /// <summary>Best-effort human message from a <see cref="ConsentServiceException"/> (which
    /// already parses the route's <c>{ error, detail }</c>) or any other transport error.</summary>
    private static string DescribeConsentError(Exception ex) => ex switch
    {
        ConsentServiceException cse => cse.Message,
        _ => ex.Message,
    };

    /// <summary>Refreshes the left reference panel's read-only Consent Status section
    /// (UI_RULES.md §1) for whichever tenant is currently active, via GET /api/msp/consent filtered
    /// client-side to the active tenant's real <see cref="Tenant.TenantGuid"/> — the list route
    /// needs no numeric customerId, so this sidesteps the #3540 fixture-TenantService gap
    /// entirely. Hides the section (states "no record" honestly) when not signed in, no tenant is
    /// selected, the call fails, or the MSP's book genuinely has no consent record yet for this
    /// tenant — never a fabricated status.</summary>
    private async Task RefreshConsentStatusAsync()
    {
        var tenant = _tenantService.CurrentTenant;
        if (!_authService.IsAuthenticated || tenant == null)
        {
            LeftReferencePanelControl.SetConsentStatus(null);
            return;
        }

        try
        {
            var all = await _consentService.GetAllAsync().ConfigureAwait(true);
            var match = all.FirstOrDefault(c => string.Equals(c.TenantId, tenant.TenantGuid, StringComparison.OrdinalIgnoreCase));
            LeftReferencePanelControl.SetConsentStatus(match);
        }
        catch (ConsentServiceException)
        {
            // Real, honest failure (401/403 most likely) — hide rather than show a fake/stale status.
            LeftReferencePanelControl.SetConsentStatus(null);
        }
    }

    /// <summary>Real rows from GET /api/msp/change-requests, filtered client-side to the active
    /// tenant. Selecting a row opens the contextual tab + right-panel workspace with a real,
    /// confirm-armed action calling <see cref="IChangeControlService.RecordHumanActionAsync"/> —
    /// the end-to-end proof of the shell's gallery → contextual tab → workspace contract.</summary>
    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildChangeRequestRowsAsync()
    {
        var tenant = _tenantService.CurrentTenant;
        if (tenant == null) return Array.Empty<GalleryRowSpec>();

        System.Collections.Generic.IReadOnlyList<ChangeRequest> requests;
        try
        {
            // #3554 — awaited, not .GetAwaiter().GetResult(): this is a gallery row source, and
            // blocking the UI thread on it froze the ribbon until the HTTP call returned.
            requests = await _changeControlService.GetChangeRequestsAsync(tenant.TenantGuid).ConfigureAwait(true);
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
            OnSelect = () => { _ = OpenChangeRequestRecordAsync(cr); },
        }).ToList();
    }

    /// <summary>
    /// #3482's pre-execution gate — the real gap the issue opens with: "hands-on work could
    /// start with no way to check whether a freeze window blocks it right now." No server
    /// endpoint evaluates this at execution time (msp-change-executions.ts's human-action
    /// route never touches either calendar), so the client fetches both real calendars
    /// (GET /msp/change-freeze-windows, GET /msp/change-maintenance-windows) and evaluates
    /// them itself via <see cref="ChangeCalendarMatching"/>, ported from the server's own
    /// portal-change-freeze.ts / portal-change-maintenance.ts. An active freeze BLOCKS the
    /// "Record human action" action outright (the action is simply not added) rather than
    /// just noting it — maintenance coverage is surfaced as a fact only, since the server
    /// itself never enforces maintenance against execution time, only against a change's
    /// originally booked span at submission.</summary>
    private async System.Threading.Tasks.Task<(ChangeFreezeWindow? Freeze, ChangeMaintenanceWindow? Maintenance, string? Error)> EvaluateChangeCalendarAsync(ChangeRequest cr)
    {
        var workload = ChangeCalendarMatching.WorkloadForCategory(cr.Category);
        var now = DateTimeOffset.UtcNow;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until both requests returned.
            var freezeWindows = await _changeControlService.GetFreezeWindowsAsync().ConfigureAwait(true);
            var maintenanceWindows = await _changeControlService.GetMaintenanceWindowsAsync().ConfigureAwait(true);
            var freeze = ChangeCalendarMatching.FindActiveFreezeNow(freezeWindows, cr.TenantId, workload, now);
            var maintenance = ChangeCalendarMatching.FindMaintenanceCoverageNow(maintenanceWindows, cr.TenantId, workload, now);
            return (freeze, maintenance, null);
        }
        catch (Exception ex)
        {
            // Real, honest failure (most likely #3501 auth) — reported, not swallowed into a
            // silent "clear" reading that would be worse than no check at all.
            return (null, null, ex.Message);
        }
    }

    private async System.Threading.Tasks.Task OpenChangeRequestRecordAsync(ChangeRequest cr)
    {
        // Session Notes (#3472) — the change-control-linked half. attestationNote already
        // exists, real, on the server's own POST .../human-action route; the only gap was
        // this client never collecting one. Captured here (write-through, no save step) and
        // threaded into RecordHumanActionAsync's real attestationNote parameter below.
        var attestationNote = string.Empty;

        var (blockingFreeze, coveringMaintenance, calendarError) = await EvaluateChangeCalendarAsync(cr).ConfigureAwait(true);

        var facts = new System.Collections.Generic.List<WorkspaceFact>
        {
            new() { Label = "Status", Value = cr.Status },
            new() { Label = "Risk", Value = cr.RiskLevel },
            new() { Label = "Class", Value = cr.ChangeClass },
            new() { Label = "Impacted users", Value = cr.ImpactedUsersCount.ToString() },
        };

        if (calendarError != null)
        {
            facts.Add(new WorkspaceFact { Label = "Freeze / maintenance check", Value = $"Could not evaluate: {calendarError}", Prose = true });
        }
        else
        {
            facts.Add(new WorkspaceFact
            {
                Label = "Freeze status",
                Value = blockingFreeze != null ? $"BLOCKED — \"{blockingFreeze.Name}\" is active now" : "Clear — no active freeze",
                Prose = blockingFreeze != null,
            });
            facts.Add(new WorkspaceFact
            {
                Label = "Maintenance window",
                Value = coveringMaintenance != null ? $"Covered by \"{coveringMaintenance.Name}\"" : "Not covered by any maintenance window right now",
                Prose = true,
            });
        }

        var actions = new System.Collections.Generic.List<WorkspaceAction>();
        if (blockingFreeze == null)
        {
            actions.Add(new WorkspaceAction
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
            });
        }
        actions.Add(new WorkspaceAction
        {
            Label = "File Post-Implementation Review",
            OnSelect = () => { _ = OpenPirPickExecutionRecordAsync(cr); },
        });

        // #3471's execute wiring — the checklist's own words: "pre-fill Script Library (#3460)
        // entry into Console for catalog-backed items." Real per-item-type branch: only a change
        // request that is both catalog-backed (CatalogItemId set) and MSP-implemented (the field
        // ChangeRequest.Implementer's own doc comment says this is exactly what this branch keys
        // off — "customer"/"microsoft"-implemented changes are not something an MSP operator runs
        // through Console) gets the jump.
        if (cr.CatalogItemId is { } catalogItemId && cr.Implementer == "msp")
        {
            actions.Add(new WorkspaceAction
            {
                Label = "Open in Script Library",
                OnSelect = () => { _ = OpenCatalogItemForChangeRequestAsync(catalogItemId); },
            });
        }

        var spec = new RecordWorkspaceSpec
        {
            Kind = "change-request",
            Id = cr.Id,
            Eyebrow = "Change Request",
            Title = cr.Title,
            Sub = $"{cr.TenantName} · {cr.PrimaryDomain}",
            Facts = facts,
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
            Actions = actions,
        };

        _shellRegistry.OpenContextual(
            new TrailEntry("change-request", cr.Id, cr.Title, () => { _ = OpenChangeRequestRecordAsync(cr); }),
            new ContextualTabSpec
            {
                Id = "change-request",
                Label = "Change Request",
                Groups =
                {
                    new RibbonGroupSpec
                    {
                        Label = "Actions",
                        Large =
                        {
                            new RibbonCommandSpec { Label = "Record human action", Intent = RibbonIntent.Record, OnSelect = () => { } },
                            new RibbonCommandSpec { Label = "File PIR", Intent = RibbonIntent.Record, OnSelect = () => { } },
                        },
                    },
                },
            },
            onSearchEverything: () => PaletteOverlay.Open());

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>#3471's execute wiring, real: resolves the given `write_action_catalog` id inside
    /// the caller's own real, entitlement-resolved catalog (the same
    /// <see cref="ILaunchControlActionsService.GetActionsAsync"/> #3460's Script Library gallery
    /// already reads) and opens it via <see cref="OpenScriptLibraryRecord"/> — the same real
    /// pre-filled-variables + confirm-armed "Run" straight into the Console pane #3460 already
    /// built. Not a second execute path; this is the jump into the existing one. Real customerId
    /// resolution is the same #3540 gap <see cref="TryResolveLaunchControlScope"/> already
    /// documents — stated honestly rather than guessed.</summary>
    private async System.Threading.Tasks.Task OpenCatalogItemForChangeRequestAsync(int catalogItemId)
    {
        if (!TryResolveLaunchControlScope(out var mspId, out var customerId))
        {
            var reason = !_authService.IsAuthenticated
                ? "Sign in to open the Script Library"
                : "Script Library needs a customer selected — pick one from the tenant switcher";
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "script-library-action",
                Id = "blocked",
                Eyebrow = "Script Library",
                Title = "Open in Script Library",
                Sub = reason,
            });
            return;
        }

        LaunchControlCatalog catalog;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the catalog request returned.
            catalog = await _launchControlActionsService.GetActionsAsync(mspId, customerId).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            // Real, honest failure — most likely 401/403 (auth still not wired), not a bug in
            // this client.
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "script-library-action",
                Id = "error",
                Eyebrow = "Script Library",
                Title = "Open in Script Library",
                Sub = $"Could not load: {ex.Message}",
            });
            return;
        }

        var action = catalog.Actions.FirstOrDefault(a => a.Id == catalogItemId);
        if (action == null)
        {
            // Real, honest state — the change request's own catalogItemId points at a real
            // catalog row, but this MSP+customer's own entitlement-resolved catalog doesn't
            // include it (e.g. not entitled at the customer's current tier). Not a bug to swallow.
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "script-library-action",
                Id = "not-found",
                Eyebrow = "Script Library",
                Title = "Open in Script Library",
                Sub = $"Catalog item {catalogItemId} was not found in this customer's resolved catalog",
            });
            return;
        }

        OpenScriptLibraryRecord(action, mspId, customerId);
    }

    // ---- POA&Ms (#3481) --------------------------------------------------------------------

    /// <summary>Real rows from GET /api/msp/poams, filtered client-side to the active tenant —
    /// same approach <see cref="BuildChangeRequestRowsAsync"/> already takes against
    /// GET /api/msp/change-requests (msp-poams.ts's list route has no per-tenant filter either).
    /// Selecting a row opens the full-panel workspace with real milestone CRUD + a confirm-armed
    /// cancel action — the same gallery → contextual tab → workspace contract #3493 proved.</summary>
    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildPoamRowsAsync()
    {
        var tenant = _tenantService.CurrentTenant;
        if (tenant == null) return Array.Empty<GalleryRowSpec>();

        System.Collections.Generic.IReadOnlyList<Poam> poams;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): gallery row source, must not freeze
            // the UI thread while the POA&Ms call is in flight.
            poams = await _poamsService.GetPoamsAsync().ConfigureAwait(true);
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
                OnSelect = () => { _ = OpenPoamRecordAsync(p.PoamId); },
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
    private async System.Threading.Tasks.Task OpenPoamRecordAsync(string poamId)
    {
        Poam poam;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the request returned.
            poam = await _poamsService.GetPoamAsync(poamId).ConfigureAwait(true);
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
                        OnChange = v => { _ = UpdatePoamFieldAsync(poamId, "scheduledCompletionDate", v); },
                    },
                    new WorkspaceEdit
                    {
                        Key = "interimCompensatingControl",
                        Label = "Interim compensating control",
                        Value = poam.InterimCompensatingControl,
                        OnChange = v => { _ = UpdatePoamFieldAsync(poamId, "interimCompensatingControl", v); },
                    },
                    new WorkspaceEdit
                    {
                        Key = "resourcesRequired",
                        Label = "Resources required",
                        Value = poam.ResourcesRequired,
                        OnChange = v => { _ = UpdatePoamFieldAsync(poamId, "resourcesRequired", v); },
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
                        OnSelect = () => { _ = CancelPoamAsync(poamId); },
                    },
                },
        };

        _shellRegistry.OpenContextual(
            new TrailEntry("poam", poam.PoamId, poam.Title, () => { _ = OpenPoamRecordAsync(poamId); }),
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
    private async System.Threading.Tasks.Task UpdatePoamFieldAsync(string poamId, string key, string value)
    {
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the update PATCH returned.
            await _poamsService.UpdatePoamAsync(poamId, new System.Collections.Generic.Dictionary<string, object?> { [key] = value }).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] Update failed: {ex.Message}");
        }
        await OpenPoamRecordAsync(poamId).ConfigureAwait(true);
    }

    private async System.Threading.Tasks.Task CancelPoamAsync(string poamId)
    {
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the cancel POST returned.
            var result = await _poamsService.CancelPoamAsync(poamId).ConfigureAwait(true);
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] {result.Message}");
        }
        catch (Exception ex)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] Cancel failed: {ex.Message}");
        }
        await OpenPoamRecordAsync(poamId).ConfigureAwait(true);
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
                    OnSelect = () => { _ = SubmitCreatePoamAsync(tenant, fields); },
                },
            },
        };

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>Real POST — validates the fields the server's own <c>createPoamSchema</c>
    /// requires non-empty (title, weaknessDescription, a valid YYYY-MM-DD
    /// scheduledCompletionDate, interimCompensatingControl, resourcesRequired) client-side
    /// before sending, same discipline <see cref="SubmitAdHocHours"/> already applies.</summary>
    private async System.Threading.Tasks.Task SubmitCreatePoamAsync(Tenant tenant, System.Collections.Generic.Dictionary<string, string> fields)
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
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the create POST returned.
            var result = await _poamsService.CreatePoamAsync(
                tenant.TenantGuid,
                tenant.Name,
                fields["primaryDomain"],
                fields["title"],
                fields["weaknessDescription"],
                fields["scheduledCompletionDate"],
                fields["interimCompensatingControl"],
                fields["resourcesRequired"],
                fields["status"]).ConfigureAwait(true);

            ConsolePanel.AppendExternal($"[POA&M] {result.Message} · {result.PoamId}");
            await OpenPoamRecordAsync(result.PoamId).ConfigureAwait(true);
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
                    OnSelect = () => { _ = SubmitCreateMilestoneAsync(poamId, fields); },
                },
            },
        };

        _shellRegistry.OpenRecord(spec);
    }

    private async System.Threading.Tasks.Task SubmitCreateMilestoneAsync(string poamId, System.Collections.Generic.Dictionary<string, string> fields)
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
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the add-milestone POST returned.
            var result = await _poamsService.CreateMilestoneAsync(poamId, fields["title"], Nullify(fields["description"]), fields["dueDate"]).ConfigureAwait(true);
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] {result.Message} · milestone #{result.Id}");
        }
        catch (Exception ex)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] Add milestone failed: {ex.Message}");
        }

        await OpenPoamRecordAsync(poamId).ConfigureAwait(true);
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
                        OnChange = v => { _ = UpdateMilestoneFieldAsync(poamId, milestone.Id, "title", v); },
                    },
                    new WorkspaceEdit
                    {
                        Key = "description",
                        Label = "Description",
                        Value = milestone.Description ?? string.Empty,
                        OnChange = v => { _ = UpdateMilestoneFieldAsync(poamId, milestone.Id, "description", v); },
                    },
                    new WorkspaceEdit
                    {
                        Key = "dueDate",
                        Label = "Due (YYYY-MM-DD)",
                        Value = milestone.DueDate,
                        OnChange = v => { _ = UpdateMilestoneFieldAsync(poamId, milestone.Id, "dueDate", v); },
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
                    OnSelect = () => { _ = DeleteMilestoneAsync(poamId, milestone.Id); },
                },
            },
        };

        if (isPending)
        {
            spec.Actions.Insert(0, new WorkspaceAction
            {
                Label = "Mark Complete",
                Confirm = true,
                OnSelect = () => { _ = MarkMilestoneCompleteAsync(poamId, milestone.Id); },
            });
        }

        _shellRegistry.OpenRecord(spec);
    }

    private async System.Threading.Tasks.Task UpdateMilestoneFieldAsync(string poamId, int milestoneId, string key, string value)
    {
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the update PATCH returned.
            await _poamsService.UpdateMilestoneAsync(poamId, milestoneId, new System.Collections.Generic.Dictionary<string, object?> { [key] = value }).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] Milestone update failed: {ex.Message}");
        }
        await OpenPoamRecordAsync(poamId).ConfigureAwait(true);
    }

    private async System.Threading.Tasks.Task MarkMilestoneCompleteAsync(string poamId, int milestoneId)
    {
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the update PATCH returned.
            var result = await _poamsService.UpdateMilestoneAsync(poamId, milestoneId, new System.Collections.Generic.Dictionary<string, object?> { ["status"] = "completed" }).ConfigureAwait(true);
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] {result.Message}");
        }
        catch (Exception ex)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] Mark complete failed: {ex.Message}");
        }
        await OpenPoamRecordAsync(poamId).ConfigureAwait(true);
    }

    private async System.Threading.Tasks.Task DeleteMilestoneAsync(string poamId, int milestoneId)
    {
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the delete DELETE returned.
            var result = await _poamsService.DeleteMilestoneAsync(poamId, milestoneId).ConfigureAwait(true);
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] {result.Message}");
        }
        catch (Exception ex)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[POA&M] Delete failed: {ex.Message}");
        }
        await OpenPoamRecordAsync(poamId).ConfigureAwait(true);
    }

    /// <summary>#3482's PIR-filing checklist item: real executions for this change
    /// (GET /msp/change-control/executions?changeRequestId=), narrowed to the ones with no
    /// PIR on file yet (GET /msp/change-control/pirs?changeRequestId=) — a PIR attaches to a
    /// specific execution and the server 409s a second one against an already-reviewed
    /// execution, so this never offers to re-file one.</summary>
    private async System.Threading.Tasks.Task OpenPirPickExecutionRecordAsync(ChangeRequest cr)
    {
        var numericId = cr.NumericId;
        if (numericId == null) return;

        System.Collections.Generic.IReadOnlyList<ChangeRequestExecution> executions;
        System.Collections.Generic.IReadOnlyList<ChangeRequestPir> pirs;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until both requests returned.
            executions = await _changeControlService.GetExecutionsForChangeAsync(numericId.Value).ConfigureAwait(true);
            pirs = await _changeControlService.GetPirsForChangeAsync(numericId.Value).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "cr-pir-pick",
                Id = cr.Id,
                Eyebrow = "Post-Implementation Review",
                Title = cr.Title,
                Sub = $"Could not load executions: {ex.Message}",
            });
            return;
        }

        var reviewedExecutionIds = new System.Collections.Generic.HashSet<int>(pirs.Select(p => p.ExecutionId));
        var unreviewed = executions.Where(e => !reviewedExecutionIds.Contains(e.Id)).ToList();

        var rows = unreviewed.Select(e => new WorkspaceListRow
        {
            Id = e.Id.ToString(),
            Name = $"Execution #{e.Id} · {e.ExecutorKind}",
            Sub = e.ExecutedAt is { } executedAt ? $"Executed {executedAt:yyyy-MM-dd HH:mm}" : "Not yet marked executed",
            Right = e.Outcome,
            OnSelect = () => OpenPirFilingRecord(cr, e),
        }).ToList();

        _shellRegistry.OpenRecord(new RecordWorkspaceSpec
        {
            Kind = "cr-pir-pick",
            Id = cr.Id,
            Eyebrow = "Post-Implementation Review",
            Title = cr.Title,
            Sub = executions.Count == 0
                ? "No executions recorded against this change yet"
                : (unreviewed.Count == 0 ? "Every execution already has a Post-Implementation Review" : "Choose the execution to review"),
            List = ("Executions awaiting review", rows),
        });
    }

    /// <summary>The real PIR-filing form — write-through Edits for the close code (cycle
    /// button over CR_PIR_CLOSE_CODES) and the required narrative, a confirm-armed submit
    /// calling POST /msp/change-control/executions/:id/pir.</summary>
    private void OpenPirFilingRecord(ChangeRequest cr, ChangeRequestExecution execution)
    {
        var fields = new System.Collections.Generic.Dictionary<string, string>
        {
            ["closeCode"] = "successful",
            ["summary"] = string.Empty,
            ["issuesNoted"] = string.Empty,
        };

        _shellRegistry.OpenRecord(new RecordWorkspaceSpec
        {
            Kind = "cr-pir-file",
            Id = $"{cr.Id}-exec-{execution.Id}",
            Eyebrow = "Post-Implementation Review",
            Title = $"{cr.Title} — Execution #{execution.Id}",
            Sub = "A correction requires a new execution + a new PIR — this one cannot be re-filed once submitted",
            Edits =
            {
                new WorkspaceEdit
                {
                    Key = "closeCode",
                    Label = "Close code",
                    Value = fields["closeCode"],
                    Options = new System.Collections.Generic.List<string> { "successful", "successful_with_issues", "failed", "rolled_back" },
                    OnChange = v => fields["closeCode"] = v,
                },
                new WorkspaceEdit { Key = "summary", Label = "Summary", Value = string.Empty, OnChange = v => fields["summary"] = v },
                new WorkspaceEdit { Key = "issuesNoted", Label = "Issues noted", Value = string.Empty, OnChange = v => fields["issuesNoted"] = v },
            },
            Actions =
            {
                new WorkspaceAction
                {
                    Label = "Submit Review",
                    Confirm = true,
                    // #3564 — async lambda assigned directly to the Action-typed OnSelect (same
                    // guarded async-void-event-handler idiom as OnCurrentTenantChanged): awaited,
                    // not .GetAwaiter().GetResult(), so filing the review no longer freezes the
                    // ribbon until the PIR POST returns.
                    OnSelect = async () =>
                    {
                        if (string.IsNullOrWhiteSpace(fields["summary"]))
                        {
                            ShowDocument(ConsolePanel);
                            ConsolePanel.AppendExternal("[PIR] Summary is required — nothing filed.");
                            return;
                        }
                        ShowDocument(ConsolePanel);
                        ConsolePanel.AppendExternal($"[PIR] Filing review for execution #{execution.Id}…");
                        try
                        {
                            var pir = await _changeControlService
                                .RecordPirAsync(execution.Id, fields["closeCode"], fields["summary"], Nullify(fields["issuesNoted"]))
                                .ConfigureAwait(true);
                            ConsolePanel.AppendExternal($"[PIR] Recorded #{pir.Id} · {pir.CloseCode} · drift rescan: {pir.DriftRescan.Status}");
                        }
                        catch (ChangeControlException ex)
                        {
                            ConsolePanel.AppendExternal($"[PIR] Filing failed ({ex.StatusCode}): {ex.Message}");
                        }
                        catch (Exception ex)
                        {
                            ConsolePanel.AppendExternal($"[PIR] Exception: {ex.Message}");
                        }
                    },
                },
            },
        });
    }

    // ---- Change Advisory Board (#3482 — Git #1501) ----------------------------------------

    /// <summary>Real rows from GET /api/msp/change-control/cab/meetings — every CAB/ECAB
    /// meeting for this MSP, each already carrying its own agenda summary.</summary>
    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildCabMeetingRowsAsync()
    {
        System.Collections.Generic.IReadOnlyList<CabMeeting> meetings;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): gallery row source, must not freeze
            // the UI thread while the CAB meetings call is in flight.
            meetings = await _cabService.GetMeetingsAsync().ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            return new[] { new GalleryRowSpec { Id = "error", Name = $"Could not load: {ex.Message}", OnSelect = () => { } } };
        }

        return meetings.Select(m => new GalleryRowSpec
        {
            Id = m.Id.ToString(),
            Tile = m.MeetingType.ToUpperInvariant(),
            Name = $"{(m.MeetingType == "ecab" ? "ECAB" : "CAB")} · {m.ScheduledFor:yyyy-MM-dd HH:mm}",
            Sub = $"{m.Status} · {m.AgendaSummary.Total} item(s), {m.AgendaSummary.Undecided} undecided",
            OnSelect = () => { _ = OpenCabMeetingRecordAsync(m.Id); },
        }).ToList();
    }

    /// <summary>The CAB meeting/agenda workspace (#3482's checklist item) — real agenda,
    /// each row a real change with its recommendation, plus the meeting lifecycle actions
    /// (start/close/cancel) gated on the same rules the server itself enforces
    /// (`isMeetingOpen`, `canCloseMeeting`).</summary>
    private async System.Threading.Tasks.Task OpenCabMeetingRecordAsync(int meetingId)
    {
        CabMeeting meeting;
        System.Collections.Generic.IReadOnlyList<CabAgendaItem> agenda;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the request returned.
            (meeting, agenda) = await _cabService.GetMeetingAsync(meetingId).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "cab-meeting",
                Id = meetingId.ToString(),
                Eyebrow = "CAB Meeting",
                Title = $"Meeting #{meetingId}",
                Sub = $"Could not load: {ex.Message}",
            });
            return;
        }

        var rows = agenda.Select(item => new WorkspaceListRow
        {
            Id = item.Id.ToString(),
            Name = $"{item.ChangeCode} — {item.ChangeTitle}",
            Sub = item.Recommendation ?? "Undecided",
            Right = item.PresenterName,
            OnSelect = () => OpenCabAgendaItemRecord(meeting, item),
        }).ToList();

        var actions = new System.Collections.Generic.List<WorkspaceAction>();
        if (meeting.Status == "scheduled")
        {
            actions.Add(new WorkspaceAction
            {
                Label = "Start Meeting",
                Confirm = true,
                // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on
                // the UI thread and froze the ribbon until the start POST returned.
                OnSelect = async () => { await _cabService.StartMeetingAsync(meeting.Id).ConfigureAwait(true); await OpenCabMeetingRecordAsync(meeting.Id).ConfigureAwait(true); },
            });
        }
        if (meeting.IsOpen)
        {
            var canClose = agenda.All(i => i.Recommendation != null);
            actions.Add(new WorkspaceAction
            {
                Label = canClose ? "Close Meeting" : "Close Meeting (undecided items remain)",
                Confirm = canClose,
                OnSelect = async () =>
                {
                    if (!canClose) return;
                    await _cabService.CloseMeetingAsync(meeting.Id).ConfigureAwait(true);
                    await OpenCabMeetingRecordAsync(meeting.Id).ConfigureAwait(true);
                },
            });
            actions.Add(new WorkspaceAction
            {
                Label = "Cancel Meeting",
                Confirm = true,
                Danger = true,
                OnSelect = async () => { await _cabService.CancelMeetingAsync(meeting.Id).ConfigureAwait(true); await OpenCabMeetingRecordAsync(meeting.Id).ConfigureAwait(true); },
            });
        }

        _shellRegistry.OpenContextual(
            new TrailEntry("cab-meeting", meeting.Id.ToString(), $"CAB #{meeting.Id}", () => { _ = OpenCabMeetingRecordAsync(meeting.Id); }),
            new ContextualTabSpec
            {
                Id = "cab-meeting",
                Label = "CAB Meeting",
                Groups =
                {
                    new RibbonGroupSpec
                    {
                        Label = "Agenda",
                        Large =
                        {
                            new RibbonCommandSpec
                            {
                                Label = "Add Eligible Change",
                                Intent = RibbonIntent.Record,
                                ToolTip = "GET .../eligible-changes — changes of this meeting's class with a pending approval slot",
                                Gallery = new GallerySpec
                                {
                                    Title = "Eligible Changes",
                                    Searchable = true,
                                    GetRowsAsync = () => BuildCabEligibleChangeRowsAsync(meeting),
                                },
                                OnSelect = () => { },
                            },
                        },
                    },
                },
            },
            onSearchEverything: () => PaletteOverlay.Open());

        _shellRegistry.OpenRecord(new RecordWorkspaceSpec
        {
            Kind = "cab-meeting",
            Id = meeting.Id.ToString(),
            Eyebrow = meeting.MeetingType == "ecab" ? "Emergency CAB" : "CAB Meeting",
            Title = $"{meeting.ScheduledFor:yyyy-MM-dd HH:mm}",
            Sub = $"{meeting.ChairName} · {meeting.Location}",
            Facts =
            {
                new WorkspaceFact { Label = "Status", Value = meeting.Status },
                new WorkspaceFact { Label = "Total items", Value = meeting.AgendaSummary.Total.ToString() },
                new WorkspaceFact { Label = "Undecided", Value = meeting.AgendaSummary.Undecided.ToString() },
                new WorkspaceFact { Label = "Retroactive", Value = meeting.AgendaSummary.Retroactive.ToString() },
            },
            Body = ("Minutes", string.IsNullOrEmpty(meeting.Minutes) ? "(not yet compiled — minutes are written when the meeting closes)" : meeting.Minutes),
            List = ("Agenda", rows),
            Actions = actions,
        });
    }

    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildCabEligibleChangeRowsAsync(CabMeeting meeting)
    {
        System.Collections.Generic.IReadOnlyList<CabEligibleChange> eligible;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): gallery row source, must not freeze
            // the UI thread while the eligible-changes call is in flight.
            eligible = await _cabService.GetEligibleChangesAsync(meeting.Id).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            return new[] { new GalleryRowSpec { Id = "error", Name = $"Could not load: {ex.Message}", OnSelect = () => { } } };
        }

        return eligible.Select(c => new GalleryRowSpec
        {
            Id = c.Code,
            Tile = c.RiskLevel.Length >= 2 ? c.RiskLevel[..2].ToUpperInvariant() : c.RiskLevel.ToUpperInvariant(),
            Name = $"{c.Code} — {c.Title}",
            Sub = c.TenantId,
            // #3564 — async lambda assigned directly to the Action-typed OnSelect: awaited, not
            // .GetAwaiter().GetResult(), so adding an agenda item no longer freezes the ribbon.
            OnSelect = async () =>
            {
                await _cabService.AddAgendaItemAsync(meeting.Id, c.Id).ConfigureAwait(true);
                await OpenCabMeetingRecordAsync(meeting.Id).ConfigureAwait(true);
            },
        }).ToList();
    }

    /// <summary>One agenda item's own workspace — the board's actual decision surface.
    /// `recordAgendaDecision` 409s once a recommendation is already recorded, so once
    /// decided the actions simply aren't offered again (the fact already shows the
    /// outcome) rather than letting a second click race the server's own guard.</summary>
    private void OpenCabAgendaItemRecord(CabMeeting meeting, CabAgendaItem item)
    {
        var facts = new System.Collections.Generic.List<WorkspaceFact>
        {
            new() { Label = "Recommendation", Value = item.Recommendation ?? "Undecided" },
            new() { Label = "Presenter", Value = string.IsNullOrEmpty(item.PresenterName) ? "(unassigned)" : item.PresenterName },
            new() { Label = "Retroactive", Value = item.IsRetroactive ? "Yes — emergency change, reviewed after the fact" : "No" },
        };

        var actions = new System.Collections.Generic.List<WorkspaceAction>();
        if (item.Recommendation == null && meeting.IsOpen)
        {
            actions.Add(new WorkspaceAction
            {
                Label = "Approve",
                Confirm = true,
                // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on
                // the UI thread and froze the ribbon until the decision POST returned.
                OnSelect = async () => { await _cabService.RecordDecisionAsync(item.Id, "approve").ConfigureAwait(true); await OpenCabMeetingRecordAsync(meeting.Id).ConfigureAwait(true); },
            });
            actions.Add(new WorkspaceAction
            {
                Label = "Reject",
                Confirm = true,
                Danger = true,
                OnSelect = async () => { await _cabService.RecordDecisionAsync(item.Id, "reject").ConfigureAwait(true); await OpenCabMeetingRecordAsync(meeting.Id).ConfigureAwait(true); },
            });
            actions.Add(new WorkspaceAction
            {
                Label = "Defer",
                Confirm = true,
                OnSelect = async () => { await _cabService.DeferAgendaItemAsync(item.Id, null).ConfigureAwait(true); await OpenCabMeetingRecordAsync(meeting.Id).ConfigureAwait(true); },
            });
        }

        _shellRegistry.OpenRecord(new RecordWorkspaceSpec
        {
            Kind = "cab-agenda-item",
            Id = item.Id.ToString(),
            Eyebrow = "CAB Agenda Item",
            Title = $"{item.ChangeCode} — {item.ChangeTitle}",
            Sub = $"Ordinal {item.Ordinal}",
            Facts = facts,
            Body = ("Discussion notes", string.IsNullOrEmpty(item.DiscussionNotes) ? "(none)" : item.DiscussionNotes),
            Actions = actions,
        });
    }

    /// <summary>POST /msp/change-control/cab/meetings — schedules a new meeting from a
    /// write-through create form, same shape as <see cref="OpenLogAdHocHoursRecord"/>.</summary>
    private void OpenScheduleCabMeetingRecord()
    {
        var fields = new System.Collections.Generic.Dictionary<string, string>
        {
            ["meetingType"] = "cab",
            ["scheduledFor"] = DateTimeOffset.UtcNow.AddDays(7).ToString("yyyy-MM-dd HH:mm"),
            ["chairName"] = string.Empty,
            ["location"] = string.Empty,
            ["notes"] = string.Empty,
        };

        _shellRegistry.OpenRecord(new RecordWorkspaceSpec
        {
            Kind = "cab-meeting-new",
            Id = "new",
            Eyebrow = "Change Advisory Board",
            Title = "Schedule Meeting",
            Edits =
            {
                new WorkspaceEdit
                {
                    Key = "meetingType",
                    Label = "Meeting type",
                    Value = fields["meetingType"],
                    Options = new System.Collections.Generic.List<string> { "cab", "ecab" },
                    OnChange = v => fields["meetingType"] = v,
                },
                new WorkspaceEdit { Key = "scheduledFor", Label = "Scheduled for (UTC)", Value = fields["scheduledFor"], OnChange = v => fields["scheduledFor"] = v },
                new WorkspaceEdit { Key = "chairName", Label = "Chair", Value = string.Empty, OnChange = v => fields["chairName"] = v },
                new WorkspaceEdit { Key = "location", Label = "Location", Value = string.Empty, OnChange = v => fields["location"] = v },
                new WorkspaceEdit { Key = "notes", Label = "Notes", Value = string.Empty, OnChange = v => fields["notes"] = v },
            },
            Actions =
            {
                new WorkspaceAction
                {
                    Label = "Schedule",
                    Confirm = true,
                    // #3564 — async lambda assigned directly to the Action-typed OnSelect: awaited,
                    // not .GetAwaiter().GetResult(), so scheduling no longer freezes the ribbon.
                    OnSelect = async () =>
                    {
                        if (!DateTimeOffset.TryParse(fields["scheduledFor"], System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var scheduledFor))
                        {
                            ShowDocument(ConsolePanel);
                            ConsolePanel.AppendExternal($"[CAB] \"{fields["scheduledFor"]}\" is not a valid date/time — nothing scheduled.");
                            return;
                        }
                        try
                        {
                            var meeting = await _cabService
                                .ScheduleMeetingAsync(fields["meetingType"], scheduledFor, fields["chairName"], fields["location"], fields["notes"])
                                .ConfigureAwait(true);
                            await OpenCabMeetingRecordAsync(meeting.Id).ConfigureAwait(true);
                        }
                        catch (Exception ex)
                        {
                            ShowDocument(ConsolePanel);
                            ConsolePanel.AppendExternal($"[CAB] Schedule failed: {ex.Message}");
                        }
                    },
                },
            },
        });
    }

    /// <summary>The ad-hoc half of #3464's real hour-logging scope — work not tied to a
    /// remediation-tracker step or a change request. Same gallery-less
    /// "open a workspace with write-through Edits + a confirm-armed Action" shape as
    /// <see cref="OpenScriptLibraryRecord"/>, targeting
    /// <see cref="IAdminRetainerService.LogUnscopedHoursAsync"/> instead. Real customerId
    /// resolution is the same real <see cref="TryResolveLaunchControlScope"/> uses (#3540) — this
    /// opens a stated-blocked workspace only when no customer is actually selected.</summary>
    private void OpenLogAdHocHoursRecord()
    {
        if (!TryResolveLaunchControlScope(out _, out var customerId))
        {
            var reason = !_authService.IsAuthenticated
                ? "Sign in to log retainer hours"
                : "Logging hours needs a customer selected — pick one from the tenant switcher";
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
                    OnSelect = () => { _ = SubmitAdHocHoursAsync(customerId, fields); },
                },
            },
        };

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>Real POST — validates the two required fields client-side (matching the server's
    /// own `unscopedSchema`: non-empty item, non-negative hours) and reports the real result to
    /// the Console pane, the same feedback channel <see cref="RunScriptLibraryAction"/> already
    /// uses for a real POST's outcome.</summary>
    private async System.Threading.Tasks.Task SubmitAdHocHoursAsync(int customerId, System.Collections.Generic.Dictionary<string, string> fields)
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
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the log POST returned.
            var entry = await _adminRetainerService
                .LogUnscopedHoursAsync(
                    customerId,
                    item,
                    hours,
                    Nullify(fields["pillar"]),
                    Nullify(fields["finding"]),
                    Nullify(fields["outcome"]))
                .ConfigureAwait(true);

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

    /// <summary>Automation Registry (Git #3771) — Home-tab "Browse" gallery rows, one per
    /// automation registered against the current customer. Same real "GET list + row OnSelect
    /// opens a record" shape <see cref="BuildCabMeetingRowsAsync"/> already uses.</summary>
    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildAutomationRegistryRowsAsync()
    {
        if (!TryResolveLaunchControlScope(out _, out var customerId))
        {
            return new[] { new GalleryRowSpec { Id = "blocked", Name = "Sign in and pick a customer to browse its automation registry", OnSelect = () => { } } };
        }

        System.Collections.Generic.IReadOnlyList<AutomationRegistryEntry> entries;
        try
        {
            entries = await _automationRegistryService.GetEntriesAsync(customerId).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            return new[] { new GalleryRowSpec { Id = "error", Name = $"Could not load: {ex.Message}", OnSelect = () => { } } };
        }

        if (entries.Count == 0)
        {
            return new[] { new GalleryRowSpec { Id = "empty", Name = "No automations registered for this customer yet", OnSelect = () => { } } };
        }

        return entries.Select(e => new GalleryRowSpec
        {
            Id = e.Id.ToString(),
            Tile = e.Type == "ai_studio_agent" ? "AI" : "PA",
            Name = e.Name,
            Sub = $"{(e.Type == "ai_studio_agent" ? "AI Studio agent" : "Power Automate flow")} · {e.Status}",
            OnSelect = () => OpenAutomationRegistryRecord(customerId, e),
        }).ToList();
    }

    /// <summary>Opens one automation registry entry for editing — real PATCH/DELETE against the
    /// row selected from <see cref="BuildAutomationRegistryRowsAsync"/>, or the entry just created
    /// by <see cref="OpenAddAutomationRecord"/>. Same "write-through Edits + confirm-armed
    /// Actions" shape as <see cref="OpenLogAdHocHoursRecord"/>, targeting
    /// <see cref="IAutomationRegistryService.UpdateEntryAsync"/> and
    /// <see cref="IAutomationRegistryService.DeleteEntryAsync"/> instead.</summary>
    private void OpenAutomationRegistryRecord(int customerId, AutomationRegistryEntry entry)
    {
        var fields = new System.Collections.Generic.Dictionary<string, string>
        {
            ["type"] = entry.Type,
            ["name"] = entry.Name,
            ["status"] = entry.Status,
            ["notes"] = entry.Notes ?? string.Empty,
        };

        _shellRegistry.OpenRecord(new RecordWorkspaceSpec
        {
            Kind = "automation-registry-entry",
            Id = entry.Id.ToString(),
            Eyebrow = "Automation Registry",
            Title = entry.Name,
            Sub = $"#{entry.Id} · added {entry.CreatedAt:yyyy-MM-dd}",
            Edits =
            {
                new WorkspaceEdit
                {
                    Key = "type",
                    Label = "Type",
                    Value = fields["type"],
                    Options = new System.Collections.Generic.List<string> { "power_automate_flow", "ai_studio_agent" },
                    OnChange = v => fields["type"] = v,
                },
                new WorkspaceEdit { Key = "name", Label = "Name", Value = fields["name"], OnChange = v => fields["name"] = v },
                new WorkspaceEdit
                {
                    Key = "status",
                    Label = "Status",
                    Value = fields["status"],
                    Options = new System.Collections.Generic.List<string> { "active", "inactive", "in_development" },
                    OnChange = v => fields["status"] = v,
                },
                new WorkspaceEdit { Key = "notes", Label = "Notes", Value = fields["notes"], OnChange = v => fields["notes"] = v },
            },
            Actions =
            {
                new WorkspaceAction
                {
                    Label = "Save",
                    Confirm = true,
                    OnSelect = async () =>
                    {
                        ShowDocument(ConsolePanel);
                        try
                        {
                            var updated = await _automationRegistryService
                                .UpdateEntryAsync(entry.Id, fields["type"], fields["name"], fields["status"], Nullify(fields["notes"]))
                                .ConfigureAwait(true);
                            ConsolePanel.AppendExternal($"[Automation Registry] Saved #{updated.Id} · {updated.Name} · {updated.Status}");
                            OpenAutomationRegistryRecord(customerId, updated);
                        }
                        catch (AutomationRegistryException ex)
                        {
                            ConsolePanel.AppendExternal($"[Automation Registry] Save failed: {ex.Message}");
                        }
                        catch (Exception ex)
                        {
                            ConsolePanel.AppendExternal($"[Automation Registry] Exception: {ex.Message}");
                        }
                    },
                },
                new WorkspaceAction
                {
                    Label = "Delete",
                    Confirm = true,
                    Danger = true,
                    OnSelect = async () =>
                    {
                        ShowDocument(ConsolePanel);
                        try
                        {
                            await _automationRegistryService.DeleteEntryAsync(entry.Id).ConfigureAwait(true);
                            ConsolePanel.AppendExternal($"[Automation Registry] Deleted #{entry.Id} · {entry.Name}");
                        }
                        catch (AutomationRegistryException ex)
                        {
                            ConsolePanel.AppendExternal($"[Automation Registry] Delete failed: {ex.Message}");
                        }
                        catch (Exception ex)
                        {
                            ConsolePanel.AppendExternal($"[Automation Registry] Exception: {ex.Message}");
                        }
                    },
                },
            },
        });
    }

    /// <summary>Home-tab "Add Automation" — real POST against the current customer. Same
    /// gallery-less "workspace with locally-collected Edits + a confirm-armed Create Action"
    /// shape <see cref="OpenLogAdHocHoursRecord"/> already uses.</summary>
    private void OpenAddAutomationRecord()
    {
        if (!TryResolveLaunchControlScope(out _, out var customerId))
        {
            var reason = !_authService.IsAuthenticated
                ? "Sign in to register an automation"
                : "Registering an automation needs a customer selected — pick one from the tenant switcher";
            _shellRegistry.OpenRecord(new RecordWorkspaceSpec
            {
                Kind = "automation-registry-new",
                Id = "blocked",
                Eyebrow = "Automation Registry",
                Title = "Add Automation",
                Sub = reason,
            });
            return;
        }

        var fields = new System.Collections.Generic.Dictionary<string, string>
        {
            ["type"] = "power_automate_flow",
            ["name"] = string.Empty,
            ["status"] = "active",
            ["notes"] = string.Empty,
        };

        _shellRegistry.OpenRecord(new RecordWorkspaceSpec
        {
            Kind = "automation-registry-new",
            Id = "new",
            Eyebrow = "Automation Registry",
            Title = "Add Automation",
            Edits =
            {
                new WorkspaceEdit
                {
                    Key = "type",
                    Label = "Type",
                    Value = fields["type"],
                    Options = new System.Collections.Generic.List<string> { "power_automate_flow", "ai_studio_agent" },
                    OnChange = v => fields["type"] = v,
                },
                new WorkspaceEdit { Key = "name", Label = "Name", Value = fields["name"], OnChange = v => fields["name"] = v },
                new WorkspaceEdit
                {
                    Key = "status",
                    Label = "Status",
                    Value = fields["status"],
                    Options = new System.Collections.Generic.List<string> { "active", "inactive", "in_development" },
                    OnChange = v => fields["status"] = v,
                },
                new WorkspaceEdit { Key = "notes", Label = "Notes", Value = fields["notes"], OnChange = v => fields["notes"] = v },
            },
            Actions =
            {
                new WorkspaceAction
                {
                    Label = "Add",
                    Confirm = true,
                    OnSelect = async () =>
                    {
                        if (string.IsNullOrWhiteSpace(fields["name"]))
                        {
                            ShowDocument(ConsolePanel);
                            ConsolePanel.AppendExternal("[Automation Registry] Name is required — nothing added.");
                            return;
                        }

                        ShowDocument(ConsolePanel);
                        ConsolePanel.AppendExternal($"[Automation Registry] Adding \"{fields["name"]}\"…");

                        try
                        {
                            var entry = await _automationRegistryService
                                .CreateEntryAsync(customerId, fields["type"], fields["name"], fields["status"], Nullify(fields["notes"]))
                                .ConfigureAwait(true);
                            ConsolePanel.AppendExternal($"[Automation Registry] Added #{entry.Id} · {entry.Name} · {entry.Status}");
                            OpenAutomationRegistryRecord(customerId, entry);
                        }
                        catch (AutomationRegistryException ex)
                        {
                            ConsolePanel.AppendExternal($"[Automation Registry] Add failed: {ex.Message}");
                        }
                        catch (Exception ex)
                        {
                            ConsolePanel.AppendExternal($"[Automation Registry] Exception: {ex.Message}");
                        }
                    },
                },
            },
        });
    }

    /// <summary>#3471's unified item browser — both real sources (checklist-style remediation
    /// tracker steps and catalog-backed change requests) in one gallery, real instruction/action
    /// text per item (the issue's own words), instead of the two separate galleries the shell's
    /// own #3493 proof-of-concept session first added for Change Requests alone.</summary>
    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildRemediationPlanRowsAsync()
    {
        var rows = new System.Collections.Generic.List<GalleryRowSpec>();
        rows.AddRange(await BuildTrackerStepRowsAsync().ConfigureAwait(true));
        rows.AddRange(await BuildChangeRequestRowsAsync().ConfigureAwait(true));
        return rows;
    }

    /// <summary>Real numeric `tenants.id` resolution for the remediation tracker's
    /// customer-keyed endpoints — the same real <see cref="ITenantService.CurrentTenant"/>
    /// resolution <see cref="TryResolveLaunchControlScope"/> uses (#3540).</summary>
    private bool TryResolveTrackerCustomerId(out int customerId)
    {
        customerId = _tenantService.CurrentTenant?.CustomerId ?? 0;
        return customerId > 0;
    }

    /// <summary>Checklist-style half of #3471's two sources. Real rows from
    /// GET /api/msp/customers/:customerId/remediation-tracker/catalogue — all 28 real steps with
    /// their real title/pillar text, joined server-side with this customer's real state. Today
    /// there is no real customer id to scope the call to (#3540), so this states that honestly as
    /// a single disabled row — same pattern <see cref="BuildScriptLibraryRows"/> already uses for
    /// the identical underlying gap — rather than guessing one.</summary>
    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildTrackerStepRowsAsync()
    {
        if (!TryResolveTrackerCustomerId(out var customerId))
        {
            return new[]
            {
                new GalleryRowSpec
                {
                    Id = "tracker-blocked",
                    Name = "Remediation tracker needs a customer selected — pick one from the tenant switcher",
                    OnSelect = () => { },
                },
            };
        }

        RemediationTrackerCatalogueResponse catalogue;
        try
        {
            // #3554 — awaited, not .GetAwaiter().GetResult(): gallery row source, must not freeze
            // the UI thread while the catalogue call is in flight.
            catalogue = await _remediationTrackerService.GetCatalogueAsync(customerId).ConfigureAwait(true);
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
                // #3564 — async lambda assigned directly to the Action<string>-typed OnChange:
                // awaited, not .GetAwaiter().GetResult(), so a status change no longer freezes
                // the ribbon until the update PUT returns.
                OnChange = async newLabel =>
                {
                    var target = catalogue.AssignableStatuses.FirstOrDefault(s => s.Label == newLabel);
                    if (target == null) return;

                    try
                    {
                        var updated = await _remediationTrackerService.SetStepStatusAsync(customerId, step.StepId, target.Status).ConfigureAwait(true);
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
            // #3564 — async lambda assigned directly to the Action<string>-typed OnChange: awaited,
            // not .GetAwaiter().GetResult(), so saving a note no longer freezes the ribbon.
            OnChange = async newValue =>
            {
                try
                {
                    var updated = await _remediationTrackerService.SetStepNoteAsync(customerId, step.StepId, newValue).ConfigureAwait(true);
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
    private async System.Threading.Tasks.Task RunVipLookupAsync(string upn)
    {
        if (!TryResolveLaunchControlScope(out _, out var customerId))
        {
            var reason = !_authService.IsAuthenticated
                ? "Sign in to check VIP status"
                : "VIP lookup needs a customer selected — pick one from the tenant switcher";
            LeftReferencePanelControl.ShowVipLookupResult(upn, null, reason);
            return;
        }

        try
        {
            var classification = await FindVipClassificationAsync(customerId, upn).ConfigureAwait(true);
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
    private async System.Threading.Tasks.Task<VipClassification?> FindVipClassificationAsync(int customerId, string upn)
    {
        // #3564 — awaited, not .GetAwaiter().GetResult(): this ran directly on the UI thread and
        // froze the ribbon on every VIP lookup / pre-execute check.
        var classifications = await _vipClassificationsService.GetClassificationsAsync(customerId).ConfigureAwait(true);
        return classifications.FirstOrDefault(c => string.Equals(c.PrincipalUpn, upn, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Real MSP+customer id resolution shared by every real MSP-console call that needs
    /// one — Launch Control (#3460), ad-hoc retainer hours (#3464), and now Runbooks (#3479). As
    /// of #3501 the <paramref name="mspId"/> comes from the real signed-in session (users.msp_id
    /// claim). As of #3540 the <paramref name="customerId"/> comes from
    /// <see cref="ITenantService.CurrentTenant"/>'s real numeric <c>Tenant.CustomerId</c> — loaded
    /// from the real <c>GET /api/msp/v1/msps/:mspId/customers</c> list, not fixture data. Returns
    /// true only when BOTH ids are real (a customer is genuinely selected).</summary>
    private bool TryResolveLaunchControlScope(out int mspId, out int customerId)
    {
        mspId = _authService.MspId ?? 0;
        customerId = _tenantService.CurrentTenant?.CustomerId ?? 0;
        return mspId > 0 && customerId > 0;
    }

    /// <summary>Real catalog rows, real mapping (tile/name/sub from
    /// <see cref="LaunchControlAction"/>'s own fields, grouped by the catalog's real Domain —
    /// UI_RULES.md §4) once a real MSP+customer id pair is resolvable. Today it never is
    /// (#3501) — this states that honestly instead of guessing an id, which would be inventing
    /// data.</summary>
    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildScriptLibraryRowsAsync()
    {
        if (!TryResolveLaunchControlScope(out var mspId, out var customerId))
        {
            // Distinguish the two real remaining reasons, honestly: not signed in vs. signed
            // in but no customer selected in the tenant switcher yet.
            var reason = !_authService.IsAuthenticated
                ? "Sign in to load the Script Library"
                : "Script Library needs a customer selected — pick one from the tenant switcher";
            return new[]
            {
                new GalleryRowSpec { Id = "blocked", Name = reason, OnSelect = () => { } },
            };
        }

        LaunchControlCatalog catalog;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): gallery row source, must not freeze
            // the UI thread while the catalog call is in flight.
            catalog = await _launchControlActionsService.GetActionsAsync(mspId, customerId).ConfigureAwait(true);
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
                    OnSelect = () => { _ = RunScriptLibraryActionAsync(action, mspId, customerId, variableValues); },
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
    private async System.Threading.Tasks.Task RunScriptLibraryActionAsync(
        LaunchControlAction action,
        int mspId,
        int customerId,
        System.Collections.Generic.Dictionary<string, string> variableValues)
    {
        ShowDocument(ConsolePanel);
        ConsolePanel.AppendExternal($"[Script Library] Running \"{action.ActionName}\" against customer {customerId}…");
        await SurfaceVipStatusBeforeExecuteAsync(customerId, variableValues).ConfigureAwait(true);

        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the execute POST returned.
            var response = await _launchControlActionsService
                .ExecuteAsync(mspId, action.Id, customerId, variableValues)
                .ConfigureAwait(true);

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
    private async System.Threading.Tasks.Task SurfaceVipStatusBeforeExecuteAsync(int customerId, System.Collections.Generic.Dictionary<string, string> variableValues)
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
                var classification = await FindVipClassificationAsync(customerId, upn).ConfigureAwait(true);
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

    // ---- Cross-Tenant Alerts (#3483) — Watch tab gallery + record workspace ----------------

    /// <summary>Live count badge for the Watch tab's "Alerts" command (UI_RULES.md §8's one
    /// allowed badge) — the real, current <c>total</c> GET /api/msp/alerts already computed
    /// server-side, not a client-side re-count. Never throws: a 401/403 before sign-in (this
    /// renders at shell startup, before <see cref="ApplyAuthStateAsync"/> has run) or a transient
    /// network failure reads as "0 open" rather than crashing ribbon render — the gallery itself
    /// (<see cref="BuildAlertRows"/>) is where a real failure is surfaced honestly.</summary>
    private async System.Threading.Tasks.Task<int> GetOpenAlertsCountAsync()
    {
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): a LiveCount recompute fires on every
            // fixed-tab render; blocking here froze the whole ribbon.
            return (await _alertsService.GetAlertsAsync().ConfigureAwait(true)).Total;
        }
        catch
        {
            return 0;
        }
    }

    /// <summary>Real rows from GET /api/msp/alerts (#3483) — every open, already-triaged
    /// cross-tenant alert, severity-ranked then most-recent-first exactly as the server returns
    /// them (no client-side re-sort). Deliberately not filtered to the active tenant — a
    /// cross-tenant feed is the entire point (UI_RULES.md §2: "the one 'what needs me' surface").</summary>
    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildAlertRowsAsync()
    {
        AlertsPayload payload;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): gallery row source, must not freeze
            // the UI thread while the alerts call is in flight.
            payload = await _alertsService.GetAlertsAsync().ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            // Real, honest failure — most likely 401/403 (not signed in / not msp-operator), not
            // a bug in this client.
            return new[]
            {
                new GalleryRowSpec { Id = "alerts-error", Name = $"Could not load alerts: {ex.Message}", OnSelect = () => { } },
            };
        }

        if (payload.Alerts.Count == 0)
        {
            return new[]
            {
                new GalleryRowSpec { Id = "alerts-empty", Name = "No open alerts — the book is clean", OnSelect = () => { } },
            };
        }

        return payload.Alerts
            .Select(a => new GalleryRowSpec
            {
                Id = a.Id,
                Tile = AlertSeverityTile(a.Severity),
                Name = a.Title,
                Sub = $"{(string.IsNullOrEmpty(a.CustomerName) ? "(no customer)" : a.CustomerName)} · {a.Category} · {a.OccurredAt.ToLocalTime():g}",
                OnSelect = () => OpenAlertRecord(a),
            })
            .ToList();
    }

    private static string AlertSeverityTile(string severity) => severity switch
    {
        "critical" => "CR",
        "warning" => "WA",
        "info" => "IN",
        _ => "—",
    };

    private static string AlertSeverityLabel(string severity) => severity switch
    {
        "critical" => "Critical",
        "warning" => "Warning",
        "info" => "Info",
        _ => severity,
    };

    private static string AlertSourceLabel(string source) => source switch
    {
        "policy_incident" => "Policy engine incident",
        "diagnostic_finding" => "Diagnostic finding",
        _ => source,
    };

    /// <summary>Full-panel record workspace for one cross-tenant alert. A "policy_incident"
    /// source carries a real, confirm-armed Acknowledge action (POST .../acknowledge, which
    /// really resolves the underlying policy_rule_incidents row — see msp-alerts.ts's own
    /// header). A "diagnostic_finding" source has no per-item resolution mechanism anywhere in
    /// this codebase today, so it gets an honest Note fact instead of an action that would only
    /// 400 — same "state the real gap, don't fake the control" pattern
    /// <see cref="OpenTrackerStepRecord"/> already uses for "accepted_risk", and UI_RULES.md §7
    /// uses for Undo on Runbooks/Remediation Tracker.</summary>
    private void OpenAlertRecord(CrossTenantAlert alert)
    {
        var facts = new System.Collections.Generic.List<WorkspaceFact>
        {
            new WorkspaceFact { Label = "Severity", Value = AlertSeverityLabel(alert.Severity) },
            new WorkspaceFact { Label = "Category", Value = alert.Category },
            new WorkspaceFact { Label = "Source", Value = AlertSourceLabel(alert.Source) },
            new WorkspaceFact { Label = "Occurred", Value = alert.OccurredAt.ToLocalTime().ToString("g") },
        };

        if (alert.EscalationLevel is { } level and > 1)
        {
            facts.Add(new WorkspaceFact { Label = "Escalation level", Value = level.ToString(System.Globalization.CultureInfo.InvariantCulture) });
        }

        var actions = new System.Collections.Generic.List<WorkspaceAction>();
        if (alert.Source == "diagnostic_finding")
        {
            facts.Add(new WorkspaceFact
            {
                Label = "Note",
                Value = "Diagnostic findings have no per-item acknowledge mechanism yet — filed as a real gap from #3366's audit (see msp-alerts.ts).",
                Prose = true,
            });
        }
        else
        {
            actions.Add(new WorkspaceAction
            {
                Label = "Acknowledge",
                Confirm = true,
                OnSelect = () => { _ = AcknowledgeAlertAsync(alert); },
            });
        }

        var spec = new RecordWorkspaceSpec
        {
            Kind = "alert",
            Id = alert.Id,
            Eyebrow = AlertSeverityLabel(alert.Severity),
            Title = alert.Title,
            Sub = string.IsNullOrEmpty(alert.CustomerName) ? "(no customer)" : alert.CustomerName,
            Facts = facts,
            Body = string.IsNullOrEmpty(alert.Description) ? null : ("Description", alert.Description),
            Actions = actions,
        };

        _shellRegistry.OpenContextual(
            new TrailEntry("alert", alert.Id, alert.Title, () => OpenAlertRecord(alert)),
            contextualTab: null,
            onSearchEverything: () => PaletteOverlay.Open());

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>POST /api/msp/alerts/:alertId/acknowledge. A successful acknowledge really
    /// resolves the incident, which means it drops out of GET /api/msp/alerts entirely — unlike
    /// POA&amp;M cancel (the row survives, just terminal), there is nothing left to re-open, so
    /// this closes the workspace and refreshes the gallery instead of trying to re-fetch a row
    /// that's now gone. A real failure (already resolved is idempotent success server-side; a
    /// genuine 400/404/500 is not) leaves the workspace open so the operator can see why and
    /// retry.</summary>
    private async System.Threading.Tasks.Task AcknowledgeAlertAsync(CrossTenantAlert alert)
    {
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the acknowledge POST returned.
            var result = await _alertsService.AcknowledgeAlertAsync(alert.Id).ConfigureAwait(true);
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[Alerts] Acknowledged \"{alert.Title}\" — now {result.Status}.");
        }
        catch (AlertsServiceException ex)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[Alerts] Acknowledge failed: {ex.Message}");
            OpenAlertRecord(alert);
            return;
        }
        catch (Exception ex)
        {
            ShowDocument(ConsolePanel);
            ConsolePanel.AppendExternal($"[Alerts] Exception: {ex.Message}");
            OpenAlertRecord(alert);
            return;
        }

        _shellRegistry.CloseContextual();
        _shellRegistry.OpenRecord(null);
    }

    // ---- Runbooks (#3479) — Console tab galleries + record workspaces ----------------------

    /// <summary>Real rows from GET /api/msp/runbooks (#3479), gated by the same MSP+customer
    /// scope gap <see cref="TryResolveLaunchControlScope"/> already states honestly. Tile
    /// carries the current cycle's completion percentage — the closest equivalent to Script
    /// Library's destructive-vs-read-only tile UI_RULES.md §4 asks for.</summary>
    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildRunbookRowsAsync()
    {
        if (!TryResolveLaunchControlScope(out var mspId, out var customerId))
        {
            var reason = !_authService.IsAuthenticated
                ? "Sign in to load Runbooks"
                : "Runbooks needs a customer selected — pick one from the tenant switcher";
            return new[] { new GalleryRowSpec { Id = "blocked", Name = reason, OnSelect = () => { } } };
        }

        RunbooksPayload payload;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): gallery row source, must not freeze
            // the UI thread while the runbooks call is in flight.
            payload = await _runbooksService.GetRunbooksAsync(mspId, customerId).ConfigureAwait(true);
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
    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildHoldWindowRowsAsync()
    {
        if (!TryResolveLaunchControlScope(out var mspId, out var customerId))
        {
            var reason = !_authService.IsAuthenticated
                ? "Sign in to load Hold Windows"
                : "Hold Windows needs a customer selected — pick one from the tenant switcher";
            return new[] { new GalleryRowSpec { Id = "blocked", Name = reason, OnSelect = () => { } } };
        }

        RunbooksPayload payload;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): gallery row source, must not freeze
            // the UI thread while the runbooks call is in flight.
            payload = await _runbooksService.GetRunbooksAsync(mspId, customerId).ConfigureAwait(true);
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
                OnSelect = () => { _ = OpenHoldWindowRecordAsync(hold, mspId, customerId); },
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
                OnSelect = () => { _ = ToggleRunbookStepAsync(rb, mspId, customerId, step); },
            })
            .ToList();

        if (rb.Hold != null)
        {
            var hold = rb.Hold;
            actions.Add(new WorkspaceAction
            {
                Label = $"Open Hold Window — {hold.Title}",
                OnSelect = () => { _ = OpenHoldWindowRecordAsync(hold, mspId, customerId); },
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
    /// view for the selected tenant," and <see cref="Models.Tenant.CustomerId"/> is now a real
    /// numeric <c>tenants.id</c> as of #3540 — but wiring a customerId filter into this endpoint
    /// is its own scoped change, not something to fold into #3540's TenantService fix. Document
    /// Hub still browses the caller's whole book here; narrowing it to the selected tenant is a
    /// real, separate follow-up.</summary>
    private async System.Threading.Tasks.Task<System.Collections.Generic.IReadOnlyList<GalleryRowSpec>> BuildDocumentHubRowsAsync()
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
            // #3564 — awaited, not .GetAwaiter().GetResult(): gallery row source, must not freeze
            // the UI thread while the documents call is in flight.
            payload = await _documentHubService.GetDocumentsAsync(mspId.Value, customerId: null).ConfigureAwait(true);
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
                    OnSelect = () => { _ = ViewDocumentHubItemAsync(doc); },
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
                OnSelect = () => { _ = DownloadDocumentHubPdfAsync(doc); },
            });
            spec.Actions.Add(new WorkspaceAction
            {
                Label = "Create & copy share link",
                Confirm = true,
                OnSelect = () => { _ = ShareDocumentHubItemAsync(doc); },
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
    private async System.Threading.Tasks.Task ViewDocumentHubItemAsync(DocumentHubItem doc)
    {
        ShowDocument(ConsolePanel);
        ConsolePanel.AppendExternal($"[Document Hub] Loading \"{doc.Title}\"…");
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the view request returned.
            var view = await _documentHubService.GetDocumentViewAsync(doc.Id).ConfigureAwait(true);
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
    private async System.Threading.Tasks.Task DownloadDocumentHubPdfAsync(DocumentHubItem doc)
    {
        ShowDocument(ConsolePanel);
        ConsolePanel.AppendExternal($"[Document Hub] Downloading PDF for \"{doc.Title}\"…");
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the PDF request returned.
            var bytes = await _documentHubService.GetDocumentPdfAsync(doc.Id).ConfigureAwait(true);
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
    private async System.Threading.Tasks.Task ShareDocumentHubItemAsync(DocumentHubItem doc)
    {
        ShowDocument(ConsolePanel);
        ConsolePanel.AppendExternal($"[Document Hub] Creating share link for \"{doc.Title}\"…");
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the share POST returned.
            var share = await _documentHubService.ShareDocumentAsync(doc.Id).ConfigureAwait(true);
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
    private async System.Threading.Tasks.Task ToggleRunbookStepAsync(Runbook rb, int mspId, int customerId, RunbookStep step)
    {
        ShowDocument(ConsolePanel);
        var wantChecked = !step.Checked;
        ConsolePanel.AppendExternal($"[Runbooks] {(wantChecked ? "Completing" : "Reopening")} step {step.Position} of \"{rb.Title}\"…");

        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until both requests returned.
            var result = await _runbooksService
                .SetStepCompletionAsync(mspId, customerId, rb.Id, step.Position, wantChecked)
                .ConfigureAwait(true);

            ConsolePanel.AppendExternal($"[Runbooks] Step {result.Position} now {(result.Checked ? "checked" : "unchecked")}.");

            var refreshed = await _runbooksService.GetRunbooksAsync(mspId, customerId).ConfigureAwait(true);
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
    private async System.Threading.Tasks.Task OpenHoldWindowRecordAsync(HoldWindow hold, int mspId, int customerId)
    {
        var extend = new System.Collections.Generic.Dictionary<string, string> { ["days"] = string.Empty, ["reason"] = string.Empty };

        HoldWindowEventsResponse? events;
        try
        {
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until the audit-trail request returned.
            events = await _runbooksService.GetHoldWindowEventsAsync(mspId, customerId, hold.Id).ConfigureAwait(true);
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
                    OnSelect = () => { _ = ExtendHoldWindowAsync(hold, mspId, customerId, extend); },
                },
            },
            List = ("Audit Trail", auditRows),
        };

        _shellRegistry.OpenContextual(
            new TrailEntry("hold-window", spec.Id, hold.Title, () => { _ = OpenHoldWindowRecordAsync(hold, mspId, customerId); }),
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
    private async System.Threading.Tasks.Task ExtendHoldWindowAsync(HoldWindow hold, int mspId, int customerId, System.Collections.Generic.Dictionary<string, string> fields)
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
            // #3564 — awaited, not .GetAwaiter().GetResult(): this handler ran directly on the UI
            // thread and froze the ribbon until both requests returned.
            var result = await _runbooksService.ExtendHoldWindowAsync(mspId, customerId, hold.Id, days, reason).ConfigureAwait(true);
            ConsolePanel.AppendExternal($"[Runbooks] Extended — hold window now carries {result.ExtendedDays} extended day(s) total.");

            var refreshed = await _runbooksService.GetRunbooksAsync(mspId, customerId).ConfigureAwait(true);
            var reloadedHold = refreshed.Holds.FirstOrDefault(h => h.Id == hold.Id);
            if (reloadedHold != null) await OpenHoldWindowRecordAsync(reloadedHold, mspId, customerId).ConfigureAwait(true);
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
            new() { Id = "dest:break-glass", Type = PaletteType.Destination, Name = "Break-Glass Requests", Sub = "Cross-tenant pending break-glass deliveries (#3480)", Run = () => { _ = OpenBreakGlassPendingListAsync(); } },
            new() { Id = "dest:support-tickets", Type = PaletteType.Destination, Name = "Support Tickets", Sub = "Every ticket under your MSP's Zoho Desk org (#3488)", Run = () => { _ = OpenSupportTicketsListAsync(); } },
            new() { Id = "dest:audit-log", Type = PaletteType.Destination, Name = "Audit Log", Sub = "Filterable platform audit trail — tenant / action type (#3489)", Run = () => { _ = OpenAuditLogAsync(new Models.AuditLogFilter()); } },
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
        await ApplyAuthStateAsync();

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
        if (Dispatcher.CheckAccess()) _ = ApplyAuthStateAsync();
        else Dispatcher.Invoke(() => _ = ApplyAuthStateAsync());
    }

    /// <summary>Push the current session's bearer token into every service that attaches an
    /// Authorization header, refresh the status-bar sign-in indicator, and load the real
    /// customer list (#3540) for the session's mspId. This is the single place the token is
    /// fanned out, so a refresh updates all of them at once. Returns the in-flight tenant-load
    /// Task so a caller that needs the list before proceeding (app startup) can await it instead
    /// of racing it.</summary>
    private async Task ApplyAuthStateAsync()
    {
        var token = _authService.AccessToken;

        _launchControlActionsService.AuthToken = token;
        _changeControlService.AuthToken = token;
        _breakGlassService.AuthToken = token;
        _supportTicketsService.AuthToken = token;
        _auditLogService.AuthToken = token;
        _cabService.AuthToken = token;
        _adminRetainerService.AuthToken = token;
        _automationRegistryService.AuthToken = token;
        _remediationTrackerService.AuthToken = token;
        _vipClassificationsService.AuthToken = token;
        _retainerService.AuthToken = token;
        _runbooksService.AuthToken = token;
        _documentHubService.AuthToken = token;
        _poamsService.AuthToken = token;
        _slaService.AuthToken = token;
        _taskQueueService.AuthToken = token;
        _alertsService.AuthToken = token;
        _tenantService.AuthToken = token;
        _consentService.AuthToken = token;
        TelemetryDashboardView.SetAuthToken(token);
        SowAssessmentDashboardView.SetAuthToken(token);
        EvidenceGalleryPanel.SetAuthToken(token);

        UpdateSessionStatusUi();
        _ = RefreshContractHoursAsync();
        _ = RefreshConsentStatusAsync();
        RestartTaskQueueEventStream();

        // Real customer list load (#3540) — the mspId that just landed on the session is what
        // GET /api/msp/v1/msps/:mspId/customers is scoped to. mspId <= 0 (signed out, or no MSP
        // context) clears the list inside LoadTenantsAsync rather than issuing a request.
        await _tenantService.LoadTenantsAsync(_authService.MspId ?? 0);
    }

    // ---- Task Queue (#3490) — real msp-sla.ts operator-tasks + events/stream client -------

    /// <summary>Stops any running SSE subscription and starts a fresh one iff a token is present
    /// — called from <see cref="ApplyAuthStateAsync"/> so sign-in starts the stream and sign-out stops
    /// it (an unauthenticated stream would just 401 and end immediately, but there's no reason to
    /// hold the connection open at all with nothing to authorize it).</summary>
    private void RestartTaskQueueEventStream()
    {
        _taskQueueSseCts?.Cancel();
        _taskQueueSseCts?.Dispose();
        _taskQueueSseCts = null;

        if (string.IsNullOrWhiteSpace(_authService.AccessToken)) return;

        var cts = new CancellationTokenSource();
        _taskQueueSseCts = cts;
        _ = RunTaskQueueEventStreamAsync(cts.Token);
    }

    /// <summary>One real SSE connection to /api/msp/sla/events/stream for as long as
    /// <paramref name="cancellationToken"/> allows. A dropped/failed connection ends the loop
    /// rather than retrying indefinitely (Git #2160's bounded-wait discipline) — the next
    /// ApplyAuthStateAsync (a token refresh, ~hourly) reconnects it. Each real event bumps the Watch
    /// tab's live-count badges via ShellRegistry.RefreshLiveCounts so the Task Queue count reacts
    /// to a push rather than only refreshing when the tab happens to redraw.</summary>
    private async Task RunTaskQueueEventStreamAsync(CancellationToken cancellationToken)
    {
        try
        {
            await _taskQueueService.SubscribeToEventsAsync(
                _ => Dispatcher.Invoke(() => _shellRegistry.RefreshLiveCounts(), DispatcherPriority.Background),
                cancellationToken);
        }
        catch (OperationCanceledException)
        {
            // Expected on sign-out / window close — not a real failure.
        }
        catch (Exception ex)
        {
            Dispatcher.Invoke(() => ConsolePanel.AppendExternal($"[Task Queue] SSE stream ended: {ex.Message}"));
        }
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
            _ = ApplyAuthStateAsync();
        }
    }

    private void MainWindow_Closed(object? sender, EventArgs e)
    {
        _clockTimer.Stop();
        _taskQueueSseCts?.Cancel();
        _taskQueueSseCts?.Dispose();
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
        // #3554 — event-subscribed async void: an exception escaping here is uncatchable and
        // kills the process. This one runs on the UI thread and touches UI after every await, so
        // it must stay UI-thread-affine (no ConfigureAwait(false)); the guard is the whole body in
        // a try/catch that logs and keeps the app alive rather than crashing on a tenant switch.
        try
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
            await RefreshConsentStatusAsync();
        }
        catch (Exception ex)
        {
            Infrastructure.CrashLog.Write("MainWindow.OnCurrentTenantChanged", ex);
        }
    }

    // ---- Contract-hours utilization (#3474) — real GET /api/admin/retainer/:customerId -------

    /// <summary>Real customerId resolution for the retainer call — the same real
    /// <see cref="ITenantService.CurrentTenant"/>.<c>CustomerId</c> resolution
    /// <see cref="TryResolveLaunchControlScope"/> uses (#3540). Returns true only when a
    /// customer is genuinely selected.</summary>
    private bool TryResolveRetainerCustomerId(out int customerId)
    {
        customerId = _tenantService.CurrentTenant?.CustomerId ?? 0;
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
