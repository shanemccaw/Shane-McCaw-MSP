using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShanesSurvival.Core.Accounts;
using ShanesSurvival.Core.Dashboard;
using ShanesSurvival.Core.Income;
using ShanesSurvival.Core.PayPeriodPlans;
using ShanesSurvival.Core.Settings;
using ShanesSurvival.Core.Transactions;

// Real local MCP server for ShanesSurvival — stdio transport, for Claude Desktop's local MCP
// config. Read-only against the same Postgres DB the WPF app uses. All log output MUST go to
// stderr, never stdout — stdout is the JSON-RPC channel to the MCP client, and any stray
// stdout write (a Console.WriteLine, an unhandled exception dumped by the default host) would
// corrupt the protocol stream.
var builder = Host.CreateApplicationBuilder(args);

builder.Logging.AddConsole(options =>
{
    options.LogToStandardErrorThreshold = LogLevel.Trace;
});

// Same real local settings the WPF app already uses — %AppData%\ShanesSurvival\settings.json.
// No connection string or credential is ever hardcoded here.
builder.Services.AddSingleton<SettingsService>();
builder.Services.AddSingleton<DashboardService>();
builder.Services.AddSingleton<AccountRepository>();
builder.Services.AddSingleton<TransactionRepository>();
builder.Services.AddSingleton<PayPeriodPlanRepository>();
builder.Services.AddSingleton<IncomeRepository>();

builder.Services
    .AddMcpServer(options =>
    {
        options.ServerInfo = new()
        {
            Name = "shanes-survival",
            Version = "1.0.0",
        };
    })
    .WithStdioServerTransport()
    .WithToolsFromAssembly();

await builder.Build().RunAsync();
