using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    public class ApiEndpointInfo
    {
        public string Method { get; set; } = "GET";
        public string Route { get; set; } = "";
        public string FilePath { get; set; } = "";
        public string SourceFile { get; set; } = "";
    }

    public partial class ApiRunnerView : UserControl
    {
        private BuildConsole.Services.BuildTrackerApiClient? _api;
        private List<ApiEndpointInfo> _allEndpoints = new();
        private List<ApiEndpointInfo> _filteredEndpoints = new();
        private ApiEndpointInfo? _selectedEndpoint;

        public ApiRunnerView()
        {
            InitializeComponent();
        }

        public void Initialize(BuildConsole.Services.BuildTrackerApiClient api)
        {
            _api = api;
            TxtBaseUrl.Text = _api.HttpClient.BaseAddress?.ToString().TrimEnd('/') ?? "http://localhost:8080";
            
            // Scan endpoints asynchronously on load
            _ = ScanEndpointsAsync();
        }

        private async Task ScanEndpointsAsync()
        {
            BtnRescan.IsEnabled = false;
            TxtEndpointCount.Text = "Scanning endpoints...";

            try
            {
                var scanned = await Task.Run(() => ScanApiEndpoints());
                
                Dispatcher.Invoke(() =>
                {
                    _allEndpoints = scanned;
                    FilterEndpoints();
                    BtnRescan.IsEnabled = true;
                });
            }
            catch (Exception ex)
            {
                Dispatcher.Invoke(() =>
                {
                    TxtEndpointCount.Text = $"Scan failed: {ex.Message}";
                    BtnRescan.IsEnabled = true;
                });
            }
        }

        private List<ApiEndpointInfo> ScanApiEndpoints()
        {
            var result = new List<ApiEndpointInfo>();
            var repoRoot = BuildConsole.Services.VersionInfo.FindRepoRoot();
            if (repoRoot == null) return result;

            var routesDir = Path.Combine(repoRoot, "artifacts", "api-server", "src", "routes");
            if (!Directory.Exists(routesDir)) return result;

            var routePattern = new Regex(@"\b(?:router|app)\.(get|post|delete|put|patch)\s*\(\s*[""']([^""']+)[""']", RegexOptions.IgnoreCase);

            try
            {
                foreach (var file in Directory.GetFiles(routesDir, "*.ts", SearchOption.AllDirectories))
                {
                    if (file.EndsWith(".test.ts", StringComparison.OrdinalIgnoreCase))
                        continue;

                    var relativePath = Path.GetRelativePath(routesDir, file);
                    var text = File.ReadAllText(file);
                    var matches = routePattern.Matches(text);
                    foreach (Match m in matches)
                    {
                        var method = m.Groups[1].Value.ToUpperInvariant();
                        var route = m.Groups[2].Value;

                        // Clean up double slashes or prefix route appropriately
                        if (!route.StartsWith("/")) route = "/" + route;

                        // Ensure we don't add exact duplicates
                        if (!result.Any(x => x.Method == method && x.Route == route))
                        {
                            result.Add(new ApiEndpointInfo
                            {
                                Method = method,
                                Route = route,
                                FilePath = file,
                                SourceFile = relativePath
                            });
                        }
                    }
                }
            }
            catch { }

            // Sort by route path
            result.Sort((a, b) => string.Compare(a.Route, b.Route, StringComparison.OrdinalIgnoreCase));
            return result;
        }

        private void FilterEndpoints()
        {
            var search = TxtSearch.Text.Trim();
            if (string.IsNullOrEmpty(search))
            {
                _filteredEndpoints = _allEndpoints;
            }
            else
            {
                _filteredEndpoints = _allEndpoints
                    .Where(x => x.Route.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                                x.Method.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                                x.SourceFile.Contains(search, StringComparison.OrdinalIgnoreCase))
                    .ToList();
            }

            LstEndpoints.ItemsSource = null;
            LstEndpoints.ItemsSource = _filteredEndpoints;
            TxtEndpointCount.Text = $"{_filteredEndpoints.Count} of {_allEndpoints.Count} endpoints loaded";
        }

        private void BtnRescan_Click(object sender, RoutedEventArgs e)
        {
            _ = ScanEndpointsAsync();
        }

        private void TxtSearch_TextChanged(object sender, TextChangedEventArgs e)
        {
            SearchPlaceholder.Visibility = string.IsNullOrEmpty(TxtSearch.Text) ? Visibility.Visible : Visibility.Collapsed;
            FilterEndpoints();
        }

        private void TxtSearch_GotFocus(object sender, RoutedEventArgs e)
        {
            SearchPlaceholder.Visibility = Visibility.Collapsed;
        }

        private void TxtSearch_LostFocus(object sender, RoutedEventArgs e)
        {
            SearchPlaceholder.Visibility = string.IsNullOrEmpty(TxtSearch.Text) ? Visibility.Visible : Visibility.Collapsed;
        }

        private void LstEndpoints_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            _selectedEndpoint = LstEndpoints.SelectedItem as ApiEndpointInfo;
            if (_selectedEndpoint == null)
            {
                GridRunnerPlaceholder.Visibility = Visibility.Visible;
                GridRunnerContent.Visibility = Visibility.Collapsed;
                return;
            }

            GridRunnerPlaceholder.Visibility = Visibility.Collapsed;
            GridRunnerContent.Visibility = Visibility.Visible;
            PanelResponse.Visibility = Visibility.Collapsed;

            TxtSelectedMethod.Text = _selectedEndpoint.Method;
            TxtSelectedRoute.Text = _selectedEndpoint.Route;
            TxtSelectedFile.Text = $"File: {_selectedEndpoint.SourceFile}";

            // Highlight selected method
            switch (_selectedEndpoint.Method)
            {
                case "GET":
                    TxtSelectedMethod.Foreground = FindResource("GreenBrush") as Brush;
                    break;
                case "POST":
                    TxtSelectedMethod.Foreground = FindResource("BlueBrush") as Brush;
                    break;
                case "PUT":
                case "PATCH":
                    TxtSelectedMethod.Foreground = FindResource("PeachBrush") as Brush;
                    break;
                case "DELETE":
                    TxtSelectedMethod.Foreground = FindResource("RedBrush") as Brush;
                    break;
                default:
                    TxtSelectedMethod.Foreground = FindResource("TextBrush") as Brush;
                    break;
            }

            // Enable/disable Request Body input based on method
            bool isGet = _selectedEndpoint.Method == "GET";
            LblRequestBody.Visibility = isGet ? Visibility.Collapsed : Visibility.Visible;
            TxtRequestBody.Visibility = isGet ? Visibility.Collapsed : Visibility.Visible;

            // Clear inputs
            TxtQueryParams.Text = "";
            TxtRequestBody.Text = isGet ? "" : "{\n  \n}";
        }

        private async void BtnExecute_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedEndpoint == null || _api == null) return;

            BtnExecute.IsEnabled = false;
            BtnExecute.Content = "⚡ Executing...";
            PanelResponse.Visibility = Visibility.Visible;
            BorderHttpStatus.Background = FindResource("Surface0Brush") as Brush;
            TxtHttpStatus.Foreground = FindResource("TextBrush") as Brush;
            TxtHttpStatus.Text = "WAITING...";
            TxtElapsed.Text = "";
            TxtHeaders.Text = "";
            TxtResponseBody.Text = "Sending HTTP request to the API server...";

            var baseAddress = TxtBaseUrl.Text.Trim().TrimEnd('/');
            var route = _selectedEndpoint.Route;
            var query = TxtQueryParams.Text.Trim();

            // Build request URL
            var url = baseAddress + route;
            if (!string.IsNullOrEmpty(query))
            {
                if (query.StartsWith("?"))
                    url += query;
                else if (query.Contains("="))
                    url += "?" + query;
                else
                {
                    // Convert line-by-line key=value to query string
                    var lines = query.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                    var kvs = new List<string>();
                    foreach (var line in lines)
                    {
                        var parts = line.Split(new[] { '=' }, 2);
                        if (parts.Length == 2)
                            kvs.Add($"{Uri.EscapeDataString(parts[0].Trim())}={Uri.EscapeDataString(parts[1].Trim())}");
                        else
                            kvs.Add(Uri.EscapeDataString(line.Trim()));
                    }
                    if (kvs.Count > 0)
                        url += "?" + string.Join("&", kvs);
                }
            }

            var method = new HttpMethod(_selectedEndpoint.Method);
            using var req = new HttpRequestMessage(method, url);

            // Add authorization header if configured in client
            if (_api.HttpClient.DefaultRequestHeaders.Authorization != null)
            {
                req.Headers.Authorization = _api.HttpClient.DefaultRequestHeaders.Authorization;
            }

            // Set body content if not GET
            if (method != HttpMethod.Get)
            {
                var bodyText = TxtRequestBody.Text.Trim();
                if (!string.IsNullOrEmpty(bodyText))
                {
                    req.Content = new StringContent(bodyText, Encoding.UTF8, "application/json");
                }
            }

            var sw = Stopwatch.StartNew();
            try
            {
                // Send using HttpClient
                using var response = await _api.HttpClient.SendAsync(req);
                sw.Stop();

                var duration = sw.ElapsedMilliseconds;
                var statusCode = (int)response.StatusCode;
                var statusText = $"{statusCode} {response.ReasonPhrase}";

                // Format status badge
                if (statusCode >= 200 && statusCode < 300)
                {
                    BorderHttpStatus.Background = new SolidColorBrush(Color.FromArgb(0x33, 0xA6, 0xE3, 0xA1));
                    BorderHttpStatus.BorderBrush = FindResource("GreenBrush") as Brush;
                    BorderHttpStatus.BorderThickness = new Thickness(1);
                    TxtHttpStatus.Foreground = FindResource("GreenBrush") as Brush;
                }
                else if (statusCode >= 400)
                {
                    BorderHttpStatus.Background = new SolidColorBrush(Color.FromArgb(0x33, 0xF3, 0x8B, 0xA8));
                    BorderHttpStatus.BorderBrush = FindResource("RedBrush") as Brush;
                    BorderHttpStatus.BorderThickness = new Thickness(1);
                    TxtHttpStatus.Foreground = FindResource("RedBrush") as Brush;
                }
                else
                {
                    BorderHttpStatus.Background = new SolidColorBrush(Color.FromArgb(0x33, 0xFA, 0xB3, 0x87));
                    BorderHttpStatus.BorderBrush = FindResource("PeachBrush") as Brush;
                    BorderHttpStatus.BorderThickness = new Thickness(1);
                    TxtHttpStatus.Foreground = FindResource("PeachBrush") as Brush;
                }

                TxtHttpStatus.Text = statusText;
                TxtElapsed.Text = $"{duration}ms";

                // Format Headers
                var headersBuilder = new StringBuilder();
                foreach (var h in response.Headers)
                    headersBuilder.AppendLine($"{h.Key}: {string.Join(", ", h.Value)}");
                if (response.Content != null)
                {
                    foreach (var h in response.Content.Headers)
                        headersBuilder.AppendLine($"{h.Key}: {string.Join(", ", h.Value)}");
                }
                TxtHeaders.Text = headersBuilder.ToString();

                // Format Body
                var rawBody = response.Content != null ? await response.Content.ReadAsStringAsync() : string.Empty;
                TxtResponseBody.Text = PrettyPrintJson(rawBody);
            }
            catch (Exception ex)
            {
                sw.Stop();
                BorderHttpStatus.Background = new SolidColorBrush(Color.FromArgb(0x33, 0xF3, 0x8B, 0xA8));
                BorderHttpStatus.BorderBrush = FindResource("RedBrush") as Brush;
                BorderHttpStatus.BorderThickness = new Thickness(1);
                TxtHttpStatus.Foreground = FindResource("RedBrush") as Brush;
                TxtHttpStatus.Text = "ERROR";
                TxtElapsed.Text = $"{sw.ElapsedMilliseconds}ms";
                TxtHeaders.Text = "";
                TxtResponseBody.Text = $"Request execution failed:\n{ex.Message}\n\nStack Trace:\n{ex.StackTrace}";
            }

            BtnExecute.IsEnabled = true;
            BtnExecute.Content = "⚡ Send Request";
        }

        private string PrettyPrintJson(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) return string.Empty;
            try
            {
                using var doc = JsonDocument.Parse(json);
                return JsonSerializer.Serialize(doc, new JsonSerializerOptions { WriteIndented = true });
            }
            catch
            {
                return json; // If not valid JSON, return as-is
            }
        }
    }
}
