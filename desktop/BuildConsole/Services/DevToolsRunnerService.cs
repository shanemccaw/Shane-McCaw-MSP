using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole.Services
{
    public static class DevToolsRunnerService
    {
        public enum ApiInputType
        {
            FetchSnippet,
            XhrSnippet,
            CurlCommand,
            RawUrl,
            RelativePath,
            JsonPayload,
            Unknown
        }

        public sealed class ConsoleExecutionResult
        {
            public bool IsError { get; set; }
            public string Command { get; set; } = "";
            public string ReturnValue { get; set; } = "";
            public List<string> ConsoleLogs { get; set; } = new();
            public string ErrorMessage { get; set; } = "";
            public string ErrorStack { get; set; } = "";
            public double DurationMs { get; set; }
        }

        public sealed class ApiResponseResult
        {
            public bool IsSuccess { get; set; }
            public string Url { get; set; } = "";
            public string Method { get; set; } = "GET";
            public int StatusCode { get; set; }
            public string StatusText { get; set; } = "";
            public double DurationMs { get; set; }
            public long SizeBytes { get; set; }
            public Dictionary<string, string> Headers { get; set; } = new();
            public string RawBody { get; set; } = "";
            public string PrettyJson { get; set; } = "";
            public string ErrorMessage { get; set; } = "";
            public string ExecutedSnippet { get; set; } = "";
        }

        /// <summary>
        /// Detects the type of input snippet according to the specification rules.
        /// </summary>
        public static ApiInputType DetectInputType(string rawInput)
        {
            if (string.IsNullOrWhiteSpace(rawInput)) return ApiInputType.Unknown;
            string trimmed = rawInput.Trim();

            if (trimmed.Contains("fetch(", StringComparison.OrdinalIgnoreCase))
                return ApiInputType.FetchSnippet;

            if (trimmed.Contains("XMLHttpRequest", StringComparison.OrdinalIgnoreCase))
                return ApiInputType.XhrSnippet;

            if (trimmed.StartsWith("curl", StringComparison.OrdinalIgnoreCase))
                return ApiInputType.CurlCommand;

            if (trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                return ApiInputType.RawUrl;

            if (trimmed.StartsWith("/"))
                return ApiInputType.RelativePath;

            if ((trimmed.StartsWith("{") && trimmed.EndsWith("}")) ||
                (trimmed.StartsWith("[") && trimmed.EndsWith("]")))
                return ApiInputType.JsonPayload;

            return ApiInputType.Unknown;
        }

        /// <summary>
        /// Converts a curl command string into an executable JavaScript fetch() call.
        /// </summary>
        public static string ConvertCurlToFetch(string curlCommand)
        {
            if (string.IsNullOrWhiteSpace(curlCommand)) return "";

            // Normalize line continuations
            string normalized = Regex.Replace(curlCommand, @"\\\r?\n", " ").Trim();
            var tokens = TokenizeCommandLine(normalized);
            if (tokens.Count == 0) return "";

            string url = "";
            string method = "GET";
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            string? body = null;

            for (int i = 0; i < tokens.Count; i++)
            {
                string t = tokens[i];
                if (t.Equals("curl", StringComparison.OrdinalIgnoreCase)) continue;

                if ((t == "-X" || t == "--request") && i + 1 < tokens.Count)
                {
                    method = tokens[++i].ToUpperInvariant();
                }
                else if ((t == "-H" || t == "--header") && i + 1 < tokens.Count)
                {
                    string header = tokens[++i];
                    int colonIdx = header.IndexOf(':');
                    if (colonIdx > 0)
                    {
                        string k = header[..colonIdx].Trim();
                        string v = header[(colonIdx + 1)..].Trim();
                        headers[k] = v;
                    }
                }
                else if ((t == "-d" || t == "--data" || t == "--data-raw" || t == "--data-binary") && i + 1 < tokens.Count)
                {
                    body = tokens[++i];
                    if (method == "GET") method = "POST";
                }
                else if (!t.StartsWith("-") && string.IsNullOrEmpty(url))
                {
                    url = t;
                }
            }

            if (string.IsNullOrEmpty(url)) url = "/";

            var sb = new StringBuilder();
            sb.Append($"fetch('{EscapeJs(url)}', {{\n");
            sb.Append($"  method: '{method}',\n");

            if (headers.Count > 0)
            {
                sb.Append("  headers: {\n");
                foreach (var kvp in headers)
                {
                    sb.Append($"    '{EscapeJs(kvp.Key)}': '{EscapeJs(kvp.Value)}',\n");
                }
                sb.Append("  },\n");
            }

            if (!string.IsNullOrEmpty(body))
            {
                // Check if valid JSON to format cleanly
                if (body.TrimStart().StartsWith("{") || body.TrimStart().StartsWith("["))
                {
                    sb.Append($"  body: JSON.stringify({body})\n");
                }
                else
                {
                    sb.Append($"  body: '{EscapeJs(body)}'\n");
                }
            }

            sb.Append("})");
            return sb.ToString();
        }

        private static List<string> TokenizeCommandLine(string commandLine)
        {
            var tokens = new List<string>();
            var current = new StringBuilder();
            bool inSingleQuote = false;
            bool inDoubleQuote = false;

            for (int i = 0; i < commandLine.Length; i++)
            {
                char c = commandLine[i];
                if (c == '\'' && !inDoubleQuote)
                {
                    inSingleQuote = !inSingleQuote;
                }
                else if (c == '"' && !inSingleQuote)
                {
                    inDoubleQuote = !inDoubleQuote;
                }
                else if (char.IsWhiteSpace(c) && !inSingleQuote && !inDoubleQuote)
                {
                    if (current.Length > 0)
                    {
                        tokens.Add(current.ToString());
                        current.Clear();
                    }
                }
                else
                {
                    current.Append(c);
                }
            }

            if (current.Length > 0)
            {
                tokens.Add(current.ToString());
            }

            return tokens;
        }

        /// <summary>
        /// Executes a JavaScript command in the WebView2 context, capturing the return value,
        /// any console.log/info/warn/error produced, and any runtime exceptions.
        /// </summary>
        public static async Task<ConsoleExecutionResult> ExecuteConsoleAsync(WebView2? webView, string jsCode)
        {
            var result = new ConsoleExecutionResult { Command = jsCode };
            if (webView?.CoreWebView2 == null || string.IsNullOrWhiteSpace(jsCode))
            {
                result.IsError = true;
                result.ErrorMessage = "WebView2 is not active or command is empty.";
                return result;
            }

            string wrappedScript = $@"
(async function() {{
    var capturedLogs = [];
    var origLog = console.log;
    var origWarn = console.warn;
    var origError = console.error;
    var origInfo = console.info;

    function intercept(lvl, orig) {{
        return function() {{
            var msg = Array.from(arguments).map(function(a) {{
                try {{
                    if (typeof a === 'object') return JSON.stringify(a);
                    return String(a);
                }} catch(e) {{ return String(a); }}
            }}).join(' ');
            capturedLogs.push('[' + lvl + '] ' + msg);
            orig.apply(console, arguments);
        }};
    }}

    console.log = intercept('log', origLog);
    console.warn = intercept('warn', origWarn);
    console.error = intercept('error', origError);
    console.info = intercept('info', origInfo);

    var t0 = performance.now();
    var returnValue = undefined;
    var isError = false;
    var errorMsg = '';
    var errorStack = '';

    try {{
        returnValue = eval({JsonSerializer.Serialize(jsCode)});
        if (returnValue instanceof Promise) {{
            returnValue = await returnValue;
        }}
    }} catch(err) {{
        isError = true;
        errorMsg = err && err.message ? err.message : String(err);
        errorStack = err && err.stack ? String(err.stack) : '';
    }} finally {{
        console.log = origLog;
        console.warn = origWarn;
        console.error = origError;
        console.info = origInfo;
    }}

    var t1 = performance.now();
    var formattedReturn = '';
    try {{
        if (returnValue === undefined) formattedReturn = 'undefined';
        else if (returnValue === null) formattedReturn = 'null';
        else if (typeof returnValue === 'object') formattedReturn = JSON.stringify(returnValue, null, 2);
        else formattedReturn = String(returnValue);
    }} catch(e) {{
        formattedReturn = String(returnValue);
    }}

    return JSON.stringify({{
        isError: isError,
        returnValue: formattedReturn,
        consoleLogs: capturedLogs,
        errorMsg: errorMsg,
        errorStack: errorStack,
        durationMs: Math.round((t1 - t0) * 100) / 100
    }});
}})();
";

            try
            {
                var raw = await webView.ExecuteScriptAsync(wrappedScript);
                if (!string.IsNullOrWhiteSpace(raw) && raw != "null")
                {
                    string json = raw;
                    if (raw.StartsWith("\"") && raw.EndsWith("\""))
                    {
                        try { json = JsonSerializer.Deserialize<string>(raw) ?? raw; } catch { }
                    }

                    using var doc = JsonDocument.Parse(json);
                    var root = doc.RootElement;
                    result.IsError = root.GetProperty("isError").GetBoolean();
                    result.ReturnValue = root.GetProperty("returnValue").GetString() ?? "";
                    result.ErrorMessage = root.GetProperty("errorMsg").GetString() ?? "";
                    result.ErrorStack = root.GetProperty("errorStack").GetString() ?? "";
                    result.DurationMs = root.GetProperty("durationMs").GetDouble();

                    if (root.TryGetProperty("consoleLogs", out var logsEl) && logsEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in logsEl.EnumerateArray())
                        {
                            result.ConsoleLogs.Add(item.GetString() ?? "");
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                result.IsError = true;
                result.ErrorMessage = ex.Message;
            }

            return result;
        }

        /// <summary>
        /// Executes an API call (raw URL, relative path, fetch snippet, curl, or JSON payload)
        /// inside the WebView2 context.
        /// </summary>
        public static async Task<ApiResponseResult> ExecuteApiAsync(WebView2? webView, string input, string? jsonPayload = null, string? methodOverride = null)
        {
            var result = new ApiResponseResult();
            if (webView?.CoreWebView2 == null || string.IsNullOrWhiteSpace(input))
            {
                result.ErrorMessage = "WebView2 is not active or input is empty.";
                return result;
            }

            string trimmed = input.Trim();
            var inputType = DetectInputType(trimmed);
            string fetchCallJs = "";

            if (inputType == ApiInputType.CurlCommand)
            {
                fetchCallJs = ConvertCurlToFetch(trimmed);
            }
            else if (inputType == ApiInputType.FetchSnippet)
            {
                fetchCallJs = trimmed;
            }
            else if (inputType == ApiInputType.RawUrl || inputType == ApiInputType.RelativePath)
            {
                string method = methodOverride ?? (string.IsNullOrEmpty(jsonPayload) ? "GET" : "POST");
                string resolvedUrl = trimmed;
                if (inputType == ApiInputType.RelativePath)
                {
                    resolvedUrl = $"window.location.origin + '{EscapeJs(trimmed)}'";
                }
                else
                {
                    resolvedUrl = $"'{EscapeJs(trimmed)}'";
                }

                if (!string.IsNullOrWhiteSpace(jsonPayload))
                {
                    fetchCallJs = $"fetch({resolvedUrl}, {{\n  method: '{method}',\n  headers: {{ 'Content-Type': 'application/json' }},\n  body: {JsonSerializer.Serialize(jsonPayload)}\n}})";
                }
                else
                {
                    fetchCallJs = $"fetch({resolvedUrl}, {{ method: '{method}' }})";
                }
            }
            else if (inputType == ApiInputType.JsonPayload)
            {
                // Pairing JSON payload with current page or active endpoint
                string method = methodOverride ?? "POST";
                fetchCallJs = $"fetch(window.location.href, {{\n  method: '{method}',\n  headers: {{ 'Content-Type': 'application/json' }},\n  body: {JsonSerializer.Serialize(trimmed)}\n}})";
            }
            else
            {
                fetchCallJs = $"fetch('{EscapeJs(trimmed)}')";
            }

            result.ExecutedSnippet = fetchCallJs;

            string runnerWrapper = $@"
(async function() {{
    var t0 = performance.now();
    try {{
        var res = await ({fetchCallJs});
        var t1 = performance.now();
        var headersObj = {{}};
        if (res.headers && res.headers.entries) {{
            for (var pair of res.headers.entries()) {{
                headersObj[pair[0]] = pair[1];
            }}
        }}

        var text = await res.text();
        var pretty = text;
        try {{
            var parsed = JSON.parse(text);
            pretty = JSON.stringify(parsed, null, 2);
        }} catch(e) {{}}

        return JSON.stringify({{
            isSuccess: res.ok,
            url: res.url || '',
            statusCode: res.status,
            statusText: res.statusText || '',
            durationMs: Math.round((t1 - t0) * 100) / 100,
            sizeBytes: text.length,
            headers: headersObj,
            rawBody: text,
            prettyJson: pretty,
            errorMsg: ''
        }});
    }} catch(err) {{
        var t1 = performance.now();
        return JSON.stringify({{
            isSuccess: false,
            url: '',
            statusCode: 0,
            statusText: 'Failed',
            durationMs: Math.round((t1 - t0) * 100) / 100,
            sizeBytes: 0,
            headers: {{}},
            rawBody: '',
            prettyJson: '',
            errorMsg: err && err.message ? err.message : String(err)
        }});
    }}
}})();
";

            try
            {
                var raw = await webView.ExecuteScriptAsync(runnerWrapper);
                if (!string.IsNullOrWhiteSpace(raw) && raw != "null")
                {
                    string json = raw;
                    if (raw.StartsWith("\"") && raw.EndsWith("\""))
                    {
                        try { json = JsonSerializer.Deserialize<string>(raw) ?? raw; } catch { }
                    }

                    using var doc = JsonDocument.Parse(json);
                    var root = doc.RootElement;
                    result.IsSuccess = root.GetProperty("isSuccess").GetBoolean();
                    result.Url = root.GetProperty("url").GetString() ?? "";
                    result.StatusCode = root.GetProperty("statusCode").GetInt32();
                    result.StatusText = root.GetProperty("statusText").GetString() ?? "";
                    result.DurationMs = root.GetProperty("durationMs").GetDouble();
                    result.SizeBytes = root.GetProperty("sizeBytes").GetInt64();
                    result.RawBody = root.GetProperty("rawBody").GetString() ?? "";
                    result.PrettyJson = root.GetProperty("prettyJson").GetString() ?? "";
                    result.ErrorMessage = root.GetProperty("errorMsg").GetString() ?? "";

                    if (root.TryGetProperty("headers", out var hEl) && hEl.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var prop in hEl.EnumerateObject())
                        {
                            result.Headers[prop.Name] = prop.Value.GetString() ?? "";
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                result.IsSuccess = false;
                result.ErrorMessage = ex.Message;
            }

            return result;
        }

        /// <summary>
        /// Formats a console command execution result for markdown bug reports.
        /// </summary>
        public static string FormatConsoleResultForBugReport(ConsoleExecutionResult result)
        {
            var sb = new StringBuilder();
            sb.AppendLine("#### Console Command Execution");
            sb.AppendLine("```javascript");
            sb.AppendLine(result.Command);
            sb.AppendLine("```");

            if (result.IsError)
            {
                sb.AppendLine($"**Error**: `{result.ErrorMessage}`");
                if (!string.IsNullOrEmpty(result.ErrorStack))
                {
                    sb.AppendLine("```text");
                    sb.AppendLine(result.ErrorStack);
                    sb.AppendLine("```");
                }
            }
            else
            {
                sb.AppendLine($"**Return Value** ({result.DurationMs} ms):");
                sb.AppendLine("```json");
                sb.AppendLine(result.ReturnValue);
                sb.AppendLine("```");
            }

            if (result.ConsoleLogs.Count > 0)
            {
                sb.AppendLine("**Console Output**:");
                sb.AppendLine("```text");
                foreach (var log in result.ConsoleLogs) sb.AppendLine(log);
                sb.AppendLine("```");
            }

            return sb.ToString();
        }

        /// <summary>
        /// Formats an API response result for markdown bug reports.
        /// </summary>
        public static string FormatApiResultForBugReport(ApiResponseResult result)
        {
            var sb = new StringBuilder();
            sb.AppendLine("#### API Request Execution");
            sb.AppendLine("```javascript");
            sb.AppendLine(result.ExecutedSnippet);
            sb.AppendLine("```");

            if (!string.IsNullOrEmpty(result.ErrorMessage))
            {
                sb.AppendLine($"**API Error**: `{result.ErrorMessage}` ({result.DurationMs} ms)");
            }
            else
            {
                sb.AppendLine($"**Status**: `{result.StatusCode} {result.StatusText}` • **Duration**: `{result.DurationMs} ms` • **Size**: `{result.SizeBytes} bytes`");
            }

            if (result.Headers.Count > 0)
            {
                sb.AppendLine("<details><summary>Response Headers</summary>\n");
                sb.AppendLine("| Header | Value |");
                sb.AppendLine("|---|---|");
                foreach (var h in result.Headers)
                {
                    sb.AppendLine($"| `{h.Key}` | `{h.Value}` |");
                }
                sb.AppendLine("\n</details>\n");
            }

            if (!string.IsNullOrEmpty(result.PrettyJson))
            {
                sb.AppendLine("**Response Body**:");
                sb.AppendLine("```json");
                sb.AppendLine(result.PrettyJson.Length > 2000 ? result.PrettyJson.Substring(0, 1997) + "..." : result.PrettyJson);
                sb.AppendLine("```");
            }

            return sb.ToString();
        }

        private static string EscapeJs(string val) =>
            val.Replace("\\", "\\\\").Replace("'", "\\'").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "\\n");
    }
}
