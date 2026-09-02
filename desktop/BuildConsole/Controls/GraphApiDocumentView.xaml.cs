using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    public enum GraphApiEndpointType
    {
        ReadOnly,
        Write
    }

    public partial class GraphApiDocumentView : UserControl, INotifyPropertyChanged
    {
        private BuildTrackerApiClient? _api;
        private GraphApiEndpointType _apiType = GraphApiEndpointType.ReadOnly;
        private string _apiKey = string.Empty; // key for read-only, templateId for write
        private List<string> _rawRequiredVariables = new();
        private ObservableCollection<VariableInput> _variablesList = new();

        public ObservableCollection<VariableInput> VariablesList => _variablesList;

        public event PropertyChangedEventHandler? PropertyChanged;
        protected void OnPropertyChanged(string name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

        public GraphApiDocumentView()
        {
            InitializeComponent();
            DataContext = this;
            VariablesItemsControl.ItemsSource = _variablesList;
        }

        public void Initialize(BuildTrackerApiClient? api)
        {
            _api = api;
            _ = LoadTenantsAsync();
        }

        private async Task LoadTenantsAsync()
        {
            if (_api == null) return;

            try
            {
                // Query all active tenants
                var sql = "SELECT id, customer_name, tenant_id, is_testbed FROM tenants WHERE status = 'active' ORDER BY customer_name;";
                var results = await LocalSqlExecutor.ExecuteAsync(_api, sql);

                var tenants = new List<TenantComboItem>();
                if (results != null && results.Count > 0 && results[0].Success)
                {
                    foreach (var row in results[0].Rows)
                    {
                        tenants.Add(new TenantComboItem
                        {
                            Id = GetInt(row, "id"),
                            DisplayName = GetStr(row, "customer_name") + (GetBool(row, "is_testbed") ? " 🧪 [TESTBED]" : ""),
                            TenantId = GetStr(row, "tenant_id")
                        });
                    }
                }

                Dispatcher.Invoke(() =>
                {
                    ComboTenants.ItemsSource = tenants;
                    if (tenants.Count > 0) ComboTenants.SelectedIndex = 0;
                });
            }
            catch (Exception ex)
            {
                TxtStatus.Text = $"Error loading tenants: {ex.Message}";
            }
        }

        public void LoadApiEndpoint(
            GraphApiEndpointType type,
            string key,
            string label,
            string? description,
            string endpoint,
            string method,
            List<string> requiredVariables,
            string? bodyTemplate)
        {
            _apiType = type;
            _apiKey = key;
            _rawRequiredVariables = requiredVariables ?? new List<string>();

            // Setup Badge UI
            if (type == GraphApiEndpointType.ReadOnly)
            {
                BadgeType.Background = (Brush)FindResource("SapphireBrush");
                TxtBadgeType.Text = "READ-ONLY";
                TxtBadgeType.Foreground = (Brush)FindResource("CrustBrush");
                BtnExecute.Background = (Brush)FindResource("SapphireBrush");
                BtnExecute.Foreground = (Brush)FindResource("CrustBrush");
            }
            else
            {
                BadgeType.Background = (Brush)FindResource("PeachBrush");
                TxtBadgeType.Text = "WRITE ACTION";
                TxtBadgeType.Foreground = (Brush)FindResource("CrustBrush");
                BtnExecute.Background = (Brush)FindResource("PeachBrush");
                BtnExecute.Foreground = (Brush)FindResource("CrustBrush");
            }

            TxtApiTitle.Text = label;
            TxtApiDescription.Text = string.IsNullOrWhiteSpace(description) ? "No description configured." : description;
            TxtMethod.Text = method;
            TxtEndpoint.Text = endpoint;

            // Setup dynamic parameters / variables input
            _variablesList.Clear();
            if (_rawRequiredVariables.Count > 0)
            {
                foreach (var v in _rawRequiredVariables)
                {
                    _variablesList.Add(new VariableInput { Key = v, Value = "" });
                }
                LblVariables.Visibility = Visibility.Visible;
                VariablesItemsControl.Visibility = Visibility.Visible;
            }
            else
            {
                LblVariables.Visibility = Visibility.Collapsed;
                VariablesItemsControl.Visibility = Visibility.Collapsed;
            }

            // Setup request body textarea (Only for write actions POST/PUT/PATCH/DELETE)
            if (type == GraphApiEndpointType.Write && (method == "POST" || method == "PUT" || method == "PATCH"))
            {
                TxtRequestBody.Text = bodyTemplate ?? "{\n  \n}";
                LblRequestBody.Visibility = Visibility.Visible;
                TxtRequestBody.Visibility = Visibility.Visible;
            }
            else
            {
                LblRequestBody.Visibility = Visibility.Collapsed;
                TxtRequestBody.Visibility = Visibility.Collapsed;
            }

            // Clear previous results
            TxtStatus.Text = "Ready";
            TxtExecutionTime.Text = "";
            TxtJsonOutput.Text = "";
            TxtRawOutput.Text = "";
        }

        private async void BtnExecute_Click(object sender, RoutedEventArgs e)
        {
            if (_api == null)
            {
                MessageBox.Show("API Client not initialized.", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
                return;
            }

            var selectedTenant = ComboTenants.SelectedItem as TenantComboItem;
            if (selectedTenant == null)
            {
                MessageBox.Show("Please select a target tenant first.", "Validation", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            // Confirm before executing write actions to prevent accidental live updates
            if (_apiType == GraphApiEndpointType.Write)
            {
                var confirmMsg = $"Are you sure you want to execute this Write Action ({_apiKey}) against {selectedTenant.DisplayName}?\n\nThis will perform a live mutating operation on the M365 tenant.";
                var res = MessageBox.Show(confirmMsg, "⚠️ Live Write Action Confirmation", MessageBoxButton.YesNo, MessageBoxImage.Warning);
                if (res != MessageBoxResult.Yes) return;
            }

            BtnExecute.IsEnabled = false;
            TxtStatus.Text = "Submitting execution request...";
            TxtExecutionTime.Text = "";
            TxtJsonOutput.Text = "";
            TxtRawOutput.Text = "";

            var sw = System.Diagnostics.Stopwatch.StartNew();

            try
            {
                if (_apiType == GraphApiEndpointType.ReadOnly)
                {
                    await ExecuteReadOnlyCheckAsync(selectedTenant.Id, sw);
                }
                else
                {
                    await ExecuteWriteActionAsync(selectedTenant.Id, sw);
                }
            }
            catch (Exception ex)
            {
                sw.Stop();
                TxtStatus.Text = "Execution failed";
                TxtExecutionTime.Text = $"{sw.ElapsedMilliseconds} ms";
                TxtRawOutput.Text = $"Error: {ex.Message}\n\nStack Trace:\n{ex.StackTrace}";
            }
            finally
            {
                BtnExecute.IsEnabled = true;
            }
        }

        private async Task ExecuteReadOnlyCheckAsync(int customerId, System.Diagnostics.Stopwatch sw)
        {
            if (_api == null) return;

            // Resolve target endpoint replacing parameter templates (e.g. {userId} -> entered value)
            string resolvedUrl = TxtEndpoint.Text;
            var requestBodyDict = new Dictionary<string, string>();
            foreach (var v in _variablesList)
            {
                resolvedUrl = resolvedUrl.Replace("{" + v.Key + "}", v.Value);
                requestBodyDict[v.Key] = v.Value;
            }

            var payload = new Dictionary<string, object>
            {
                { "customerId", customerId },
                { "endpoint", resolvedUrl },
                { "method", TxtMethod.Text }
            };

            // Call POST /api/admin/monitor-checks/:key/run
            var route = $"api/admin/monitor-checks/{_apiKey}/run";
            var response = await _api.HttpClient.PostAsJsonAsync(route, payload);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                sw.Stop();
                TxtStatus.Text = $"API Server returned status {(int)response.StatusCode}";
                TxtExecutionTime.Text = $"{sw.ElapsedMilliseconds} ms";
                TxtRawOutput.Text = $"HTTP {(int)response.StatusCode} {response.ReasonPhrase}\n\n{errorBody}";
                return;
            }

            var runInit = await response.Content.ReadFromJsonAsync<JsonElement>();
            string? runId = null;
            if (runInit.TryGetProperty("runId", out var runIdProp))
            {
                runId = runIdProp.GetString();
            }

            if (string.IsNullOrEmpty(runId))
            {
                sw.Stop();
                TxtStatus.Text = "Run started, but no runId returned";
                TxtExecutionTime.Text = $"{sw.ElapsedMilliseconds} ms";
                TxtRawOutput.Text = JsonSerializer.Serialize(runInit, new JsonSerializerOptions { WriteIndented = true });
                return;
            }

            // Start polling for terminal status
            TxtStatus.Text = $"Execution queued. Polling run status (runId: {runId})...";
            int ticks = 0;
            while (ticks < 120) // 2-minute timeout
            {
                await Task.Delay(1000);
                ticks++;

                var pollResponse = await _api.HttpClient.GetAsync($"api/admin/monitor-check-runs/{runId}");
                if (!pollResponse.IsSuccessStatusCode)
                {
                    var pollErr = await pollResponse.Content.ReadAsStringAsync();
                    TxtStatus.Text = $"Polling failed: HTTP {(int)pollResponse.StatusCode}";
                    TxtRawOutput.Text = pollErr;
                    break;
                }

                var pollResult = await pollResponse.Content.ReadFromJsonAsync<JsonElement>();
                if (pollResult.TryGetProperty("run", out var runObj))
                {
                    string status = runObj.TryGetProperty("status", out var sProp) ? sProp.GetString() ?? "" : "";
                    string statusText = runObj.TryGetProperty("statusText", out var stProp) ? stProp.GetString() ?? "" : "";

                    TxtStatus.Text = $"Polling run... Status: {status.ToUpper()} ({statusText})";

                    if (status == "completed" || status == "failed")
                    {
                        sw.Stop();
                        TxtStatus.Text = $"Finished: {status.ToUpper()}";
                        TxtExecutionTime.Text = $"{sw.ElapsedMilliseconds} ms";

                        // Display formatted results
                        string prettyJson = JsonSerializer.Serialize(pollResult, new JsonSerializerOptions { WriteIndented = true });
                        TxtJsonOutput.Text = prettyJson;
                        
                        // Extract raw body or items if available
                        if (runObj.TryGetProperty("result", out var resObj))
                        {
                            TxtRawOutput.Text = JsonSerializer.Serialize(resObj, new JsonSerializerOptions { WriteIndented = true });
                        }
                        else
                        {
                            TxtRawOutput.Text = prettyJson;
                        }
                        break;
                    }
                }
            }
        }

        private async Task ExecuteWriteActionAsync(int customerId, System.Diagnostics.Stopwatch sw)
        {
            if (_api == null) return;

            // Gather variables dictionary
            var variables = new Dictionary<string, string>();
            foreach (var v in _variablesList)
            {
                variables[v.Key] = v.Value;
            }

            var payload = new Dictionary<string, object>
            {
                { "customerId", customerId },
                { "variables", variables },
                { "confirmed", true }
            };

            // Call POST /api/admin/write-actions/:templateId/execute
            var route = $"api/admin/write-actions/{_apiKey}/execute";
            var response = await _api.HttpClient.PostAsJsonAsync(route, payload);
            var responseString = await response.Content.ReadAsStringAsync();

            sw.Stop();
            TxtStatus.Text = response.IsSuccessStatusCode ? "Execution Completed" : $"Execution Failed: HTTP {(int)response.StatusCode}";
            TxtExecutionTime.Text = $"{sw.ElapsedMilliseconds} ms";
            TxtRawOutput.Text = responseString;

            try
            {
                var parsed = JsonSerializer.Deserialize<JsonElement>(responseString);
                TxtJsonOutput.Text = JsonSerializer.Serialize(parsed, new JsonSerializerOptions { WriteIndented = true });
            }
            catch
            {
                TxtJsonOutput.Text = "Response was not valid JSON.";
            }
        }

        // Database row parsing helpers
        private static int GetInt(Dictionary<string, JsonElement> row, string field)
        {
            return row.TryGetValue(field, out var val) && val.ValueKind == JsonValueKind.Number ? val.GetInt32() : 0;
        }

        private static string GetStr(Dictionary<string, JsonElement> row, string field)
        {
            return row.TryGetValue(field, out var val) && val.ValueKind == JsonValueKind.String ? val.GetString() ?? "" : "";
        }

        private static bool GetBool(Dictionary<string, JsonElement> row, string field)
        {
            return row.TryGetValue(field, out var val) && (val.ValueKind == JsonValueKind.True || val.ValueKind == JsonValueKind.False) && val.GetBoolean();
        }
    }

    public class TenantComboItem
    {
        public int Id { get; set; }
        public string DisplayName { get; set; } = string.Empty;
        public string TenantId { get; set; } = string.Empty;
    }

    public class VariableInput : INotifyPropertyChanged
    {
        public string Key { get; set; } = string.Empty;

        private string _value = string.Empty;
        public string Value
        {
            get => _value;
            set { _value = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Value))); }
        }

        public event PropertyChangedEventHandler? PropertyChanged;
    }
}
