using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Service providing isolated Chromium environments and user data folders per tenant.
/// </summary>
public interface IWebViewProfileService
{
    Task<CoreWebView2Environment> GetEnvironmentForTenantAsync(Tenant tenant);
    string GetProfilePathForTenant(Tenant tenant);
}
