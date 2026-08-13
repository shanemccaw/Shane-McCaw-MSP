using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;

namespace BuildConsole.Services
{
    /// <summary>
    /// One parsed <c>shaneapp://</c> invocation. The URI's authority (host) is
    /// the action; everything else rides in the query string. Deliberately only
    /// <c>ref</c> (a temp-file path holding the real payload) travels in the URL,
    /// never the payload itself — see <see cref="ShaneAppProtocol"/>.
    /// </summary>
    public sealed class ShaneAppRequest
    {
        public string Raw { get; set; } = "";
        /// <summary>The action, from the URI authority (e.g. "executeSql"). Canonicalized for known actions.</summary>
        public string Action { get; set; } = "";
        /// <summary>Path to the temp file holding the real payload (the SQL text for executeSql). Required.</summary>
        public string? Ref { get; set; }
        /// <summary>Optional path the handler writes the JSON result envelope to. Defaults to "&lt;Ref&gt;.result.json".</summary>
        public string? ResultRef { get; set; }
        /// <summary>Optional caller tag (?src=) — logged verbatim as the source ("if determinable"); "unknown" when absent.</summary>
        public string? Source { get; set; }
    }

    /// <summary>
    /// The receiving/forwarding side of the <c>shaneapp://executeSql</c> local
    /// protocol.
    ///
    /// WHY A PROTOCOL AND NOT HTTP (the deliberate split vs Git #898):
    ///   Git #898's remote-trigger is a rendezvous over plain HTTP for UI test
    ///   runs — anything HTTP-reachable (a headless Claude Code session) can POST
    ///   /admin/deploy/test-run and poll the result. SQL execution is kept off
    ///   that path ON PURPOSE: it runs through BuildConsole's OWN configured,
    ///   authenticated dev-DB path (the same POST /api/simulator/sql/execute the
    ///   floaty SQL Runner and SqlRunnerView already use, carrying THIS app's
    ///   locally-held Build Tracker token/base-url — see BuildTrackerApiClient).
    ///   A caller that doesn't have BuildConsole's local config can't reach it,
    ///   which is exactly the local-context guarantee Shane wants for SQL. So the
    ///   trigger is a local-machine handoff, not an HTTP endpoint.
    ///
    /// HOW IT REACHES THE ALREADY-RUNNING APP:
    ///   shaneapp:// is registered (setup-shaneapp-protocol.ps1) to launch THIS
    ///   exe with the URI as %1. Because the build-queue instance is already
    ///   open, a fresh protocol launch is just a courier: it connects to the
    ///   per-user named pipe below, hands the running instance the URI, and exits
    ///   without ever drawing a window (App.OnStartup). Only if nothing is running
    ///   does the launch become a real cold start that handles the URI itself.
    ///   Keeping the receiver IN-PROCESS is what lets every invocation land on
    ///   ActivityLog (source / action / real outcome) instead of a detached script.
    /// </summary>
    public sealed class ShaneAppProtocol
    {
        public const string Scheme = "shaneapp";

        /// <summary>Log channel for every protocol invocation (BuildConsole's ActivityLog, sql-runner family — parallels #898's "testing.remote-trigger").</summary>
        public const string LogChannel = "sql-runner.protocol";

        /// <summary>
        /// Per-user pipe name so two different Windows users on one machine never
        /// cross wires, and so the courier connects to the same user's running
        /// instance that registered the handler.
        /// </summary>
        public static string PipeName => $"BuildConsole.ShaneApp.{Environment.UserName}";

        private Thread? _thread;
        private volatile bool _running;

        // ── Courier side (transient protocol launch) ────────────────────────────

        /// <summary>
        /// Try to hand <paramref name="uri"/> to an already-running BuildConsole
        /// instance over the named pipe. Returns true if a live instance accepted
        /// it (this process should then exit without a window), false if nothing
        /// was listening (this process is the cold start and must handle it).
        /// Never throws — a missing server is the normal "no instance yet" answer.
        /// </summary>
        public static bool TryForwardToRunningInstance(string uri)
        {
            try
            {
                using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
                // Generous enough to ride over the microsecond gap while the server
                // re-opens between connections; short enough to fall through fast
                // to a real cold start when genuinely nothing is running.
                client.Connect(2000);
                using var writer = new StreamWriter(client, new UTF8Encoding(false)) { AutoFlush = true };
                writer.Write(uri);
                writer.Flush();
                client.WaitForPipeDrain(); // ensure the running instance actually read it before we exit
                return true;
            }
            catch
            {
                return false;
            }
        }

        // ── Listener side (the always-running instance) ─────────────────────────

        /// <summary>
        /// Start the background accept loop. <paramref name="onUri"/> is invoked
        /// for each received URI and MUST be non-blocking (the running instance
        /// passes a Dispatcher.BeginInvoke post), so the loop re-opens the pipe
        /// immediately and never serializes long SQL runs behind the accept.
        /// </summary>
        public void Start(Action<string> onUri)
        {
            if (_running) return;
            _running = true;
            _thread = new Thread(() => Loop(onUri))
            {
                IsBackground = true, // dies with the app; no explicit teardown needed
                Name = "ShaneAppProtocolListener",
            };
            _thread.Start();
        }

        private void Loop(Action<string> onUri)
        {
            while (_running)
            {
                NamedPipeServerStream? server = null;
                try
                {
                    server = new NamedPipeServerStream(
                        PipeName, PipeDirection.In,
                        NamedPipeServerStream.MaxAllowedServerInstances,
                        PipeTransmissionMode.Byte, PipeOptions.None);
                    server.WaitForConnection();

                    string uri;
                    using (var reader = new StreamReader(server, new UTF8Encoding(false), false, 1024, leaveOpen: false))
                        uri = reader.ReadToEnd();
                    server = null; // the StreamReader disposed it

                    uri = uri?.Trim() ?? "";
                    if (uri.Length > 0)
                    {
                        try { onUri(uri); } catch { /* onUri only posts to the UI thread; never let it kill the loop */ }
                    }
                }
                catch (Exception ex)
                {
                    // A single bad connection must never take the listener down.
                    ActivityLog.Log(LogChannel, $"listener error (will keep listening): {ex.Message}");
                    try { server?.Dispose(); } catch { }
                    try { Thread.Sleep(250); } catch { }
                }
            }
        }

        // ── Parsing ─────────────────────────────────────────────────────────────

        /// <summary>
        /// Parse a raw <c>shaneapp://</c> URI. Returns false with a reason on a
        /// malformed URI or wrong scheme; a well-formed URI with an unknown action
        /// still parses true (the handler decides what it supports).
        /// </summary>
        public static bool TryParse(string uriString, out ShaneAppRequest request, out string error)
        {
            request = new ShaneAppRequest { Raw = uriString ?? "" };
            error = "";
            if (string.IsNullOrWhiteSpace(uriString)) { error = "empty URI"; return false; }

            Uri uri;
            try { uri = new Uri(uriString); }
            catch (Exception ex) { error = $"unparseable URI: {ex.Message}"; return false; }

            if (!string.Equals(uri.Scheme, Scheme, StringComparison.OrdinalIgnoreCase))
            {
                error = $"wrong scheme '{uri.Scheme}' (expected '{Scheme}')";
                return false;
            }

            // The authority carries the action. System.Uri lowercases it, so the
            // action name is inherently case-insensitive on the wire; canonicalize
            // the ones we know for readable logs.
            request.Action = CanonicalizeAction(uri.Host);

            var q = ParseQuery(uri.Query);
            request.Ref = q.TryGetValue("ref", out var r) ? r : null;
            request.ResultRef = q.TryGetValue("resultRef", out var rr) ? rr : null;
            request.Source = q.TryGetValue("src", out var s) ? s : null;
            return true;
        }

        /// <summary>Where the handler writes its JSON result envelope: the caller's resultRef, or "&lt;ref&gt;.result.json" beside the payload.</summary>
        public static string ResolveResultPath(ShaneAppRequest req) =>
            !string.IsNullOrWhiteSpace(req.ResultRef)
                ? req.ResultRef!
                : (string.IsNullOrWhiteSpace(req.Ref) ? "shaneapp-executeSql.result.json" : req.Ref + ".result.json");

        private static string CanonicalizeAction(string host) =>
            string.Equals(host, "executesql", StringComparison.OrdinalIgnoreCase) ? "executeSql" : host;

        /// <summary>
        /// Minimal query-string parser — deliberately no System.Web dependency
        /// (System.Web.HttpUtility isn't referenced by a WPF app). Percent-decodes
        /// each key and value; last write wins on duplicate keys.
        /// </summary>
        private static Dictionary<string, string> ParseQuery(string query)
        {
            var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (string.IsNullOrEmpty(query)) return dict;
            foreach (var pair in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var idx = pair.IndexOf('=');
                if (idx < 0)
                {
                    dict[Uri.UnescapeDataString(pair)] = "";
                    continue;
                }
                var key = Uri.UnescapeDataString(pair.Substring(0, idx));
                var val = Uri.UnescapeDataString(pair.Substring(idx + 1));
                dict[key] = val;
            }
            return dict;
        }
    }
}
