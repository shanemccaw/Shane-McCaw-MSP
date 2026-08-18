using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    public sealed class TestQueueItem
    {
        public string Id { get; } = Guid.NewGuid().ToString("N");
        public string ManifestFile { get; }
        public string Source { get; }
        public DateTime EnqueuedAt { get; } = DateTime.Now;
        public string Status { get; set; } = "Queued";

        public TestQueueItem(string manifestFile, string source)
        {
            ManifestFile = manifestFile;
            Source = source;
        }
    }

    /// <summary>
    /// Thread-safe test queue and deploy coordination manager.
    /// Ensures:
    /// 1. Only one test manifest or suite executes against the shared TestRunnerWindow / WebView2 and dev server at a time.
    /// 2. Concurrent test requests from parallel builds or agents are queued FIFO and executed sequentially rather than rejected.
    /// 3. Deployments & server restarts wait for in-progress tests to complete before restarting, and block new tests until the server restart is verified live.
    /// </summary>
    public sealed class TestQueueService
    {
        private static readonly Lazy<TestQueueService> _instance = new(() => new TestQueueService());
        public static TestQueueService Instance => _instance.Value;

        private const string LogChannel = "testing.queue";

        // Global execution gate: serializes all test runs and deployments
        private readonly SemaphoreSlim _executionGate = new(1, 1);

        private readonly object _stateLock = new();
        private int _activeTestsCount = 0;
        private bool _isDeploying = false;
        private string? _currentActiveItem;
        private readonly List<TestQueueItem> _pendingItems = new();

        public event Action? QueueChanged;

        public bool IsBusy
        {
            get
            {
                lock (_stateLock)
                {
                    return _activeTestsCount > 0 || _isDeploying || _pendingItems.Count > 0;
                }
            }
        }

        public string CurrentStatus
        {
            get
            {
                lock (_stateLock)
                {
                    if (_isDeploying) return "Server Deploying / Restarting…";
                    if (!string.IsNullOrEmpty(_currentActiveItem))
                    {
                        int pending = _pendingItems.Count;
                        return pending > 0
                            ? $"Running: {_currentActiveItem} ({pending} queued)"
                            : $"Running: {_currentActiveItem}";
                    }
                    return "Idle";
                }
            }
        }

        public IReadOnlyList<TestQueueItem> GetSnapshot()
        {
            lock (_stateLock)
            {
                return _pendingItems.ToArray();
            }
        }

        /// <summary>
        /// Enqueues a test execution and runs it sequentially when the runner and server are available.
        /// </summary>
        public async Task<TResult> EnqueueAndRunAsync<TResult>(
            string manifestName,
            string source,
            Func<Task<TResult>> executeFunc,
            CancellationToken cancellationToken = default)
        {
            var item = new TestQueueItem(manifestName, source);
            lock (_stateLock)
            {
                _pendingItems.Add(item);
            }
            ActivityLog.Log(LogChannel, $"Enqueued test: {manifestName} (Source: {source}, Queue position: {_pendingItems.Count})");
            ShaneAppStreamService.Instance.AppendLine($"[TEST QUEUE] Enqueued '{manifestName}' (Position #{_pendingItems.Count})", ShaneAppLogLevel.Info);
            QueueChanged?.Invoke();

            var swWait = System.Diagnostics.Stopwatch.StartNew();
            await _executionGate.WaitAsync(cancellationToken);
            swWait.Stop();

            lock (_stateLock)
            {
                _pendingItems.Remove(item);
                _activeTestsCount++;
                _currentActiveItem = manifestName;
                item.Status = "Running";
            }
            ActivityLog.Log(LogChannel, $"Starting test: {manifestName} (Waited in queue {swWait.ElapsedMilliseconds}ms)");
            ShaneAppStreamService.Instance.AppendLine($"[TEST QUEUE] Starting '{manifestName}' after {swWait.ElapsedMilliseconds}ms wait in queue", ShaneAppLogLevel.Info);
            QueueChanged?.Invoke();

            try
            {
                return await executeFunc();
            }
            finally
            {
                lock (_stateLock)
                {
                    _activeTestsCount--;
                    if (_activeTestsCount == 0) _currentActiveItem = null;
                }
                _executionGate.Release();
                QueueChanged?.Invoke();
                ActivityLog.Log(LogChannel, $"Finished test: {manifestName}");
            }
        }

        /// <summary>
        /// Acquires the exclusive deploy/restart coordination lock.
        /// Waits for any in-flight test to finish before server restart is triggered,
        /// and blocks new tests from starting until the deploy action completes and confirms live.
        /// </summary>
        public async Task<TResult> ExecuteDeployExclusiveAsync<TResult>(
            string deployTitle,
            Func<Task<TResult>> deployAction,
            CancellationToken cancellationToken = default)
        {
            ActivityLog.Log(LogChannel, $"Deploy lock requested: {deployTitle} (waiting for any active tests to complete first)…");
            ShaneAppStreamService.Instance.AppendLine($"[DEPLOY QUEUE] Waiting for active tests before deploying '{deployTitle}'…", ShaneAppLogLevel.Info);

            await _executionGate.WaitAsync(cancellationToken);
            lock (_stateLock)
            {
                _isDeploying = true;
                _currentActiveItem = $"Deploying: {deployTitle}";
            }
            QueueChanged?.Invoke();
            ActivityLog.Log(LogChannel, $"Deploy lock acquired: {deployTitle}. Server restart/deploy proceeding in isolation.");
            ShaneAppStreamService.Instance.AppendLine($"[DEPLOY QUEUE] Deploy lock acquired for '{deployTitle}'.", ShaneAppLogLevel.Info);

            try
            {
                return await deployAction();
            }
            finally
            {
                lock (_stateLock)
                {
                    _isDeploying = false;
                    _currentActiveItem = null;
                }
                _executionGate.Release();
                QueueChanged?.Invoke();
                ActivityLog.Log(LogChannel, $"Deploy lock released: {deployTitle}. Pending tests may now proceed.");
                ShaneAppStreamService.Instance.AppendLine($"[DEPLOY QUEUE] Deploy complete for '{deployTitle}'. Next queued item starting.", ShaneAppLogLevel.Info);
            }
        }
    }
}
