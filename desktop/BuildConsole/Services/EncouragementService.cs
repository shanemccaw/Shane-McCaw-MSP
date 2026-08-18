using System;
using System.Windows.Threading;

namespace BuildConsole.Services
{
    /// <summary>
    /// Background service that periodically triggers the Big Encouragement Critter
    /// to walk across the screen, cheering Shane on with uplifting milestone progress
    /// ("37% of the way there! Way to go! Get some ice cream! 🍦").
    /// </summary>
    public sealed class EncouragementService
    {
        public static EncouragementService Instance { get; } = new EncouragementService();

        private readonly Random _rng = new();
        private DispatcherTimer? _timer;
        private string? _activeMilestoneTitle;
        private int _activeMilestonePercent = 37; // default / initial fallback
        private bool _hasMilestoneStats;

        private EncouragementService() { }

        public void Start()
        {
            if (_timer != null) return;

            _timer = new DispatcherTimer();
            ScheduleNextCheer();
            _timer.Tick += Timer_Tick;
            _timer.Start();

            ActivityLog.Log("encouragement", "Encouragement critter cheer service started.");
        }

        public void UpdateMilestoneProgress(string? title, int openCount, int closedCount)
        {
            if (string.IsNullOrWhiteSpace(title)) return;

            int total = openCount + closedCount;
            if (total > 0)
            {
                _activeMilestoneTitle = title;
                _activeMilestonePercent = (int)Math.Round((double)closedCount * 100 / total);
                _hasMilestoneStats = true;
            }
        }

        public void TriggerCheerNow()
        {
            string? header = null;
            string? subtitle = null;

            if (_hasMilestoneStats && !string.IsNullOrWhiteSpace(_activeMilestoneTitle))
            {
                header = $"Way to go! 🎯";
                subtitle = $"{_activeMilestonePercent}% of the way to {_activeMilestoneTitle}! Get some ice cream! 🍦";
            }

            IssueChompAnimation.PlayEncouragement(header, subtitle);
            ScheduleNextCheer();
        }

        private void Timer_Tick(object? sender, EventArgs e)
        {
            _timer?.Stop();
            try
            {
                TriggerCheerNow();
            }
            catch { }
            finally
            {
                ScheduleNextCheer();
                _timer?.Start();
            }
        }

        private void ScheduleNextCheer()
        {
            if (_timer == null) return;
            // Random interval between 12 and 24 minutes (720s to 1440s)
            int nextMinutes = _rng.Next(12, 25);
            _timer.Interval = TimeSpan.FromMinutes(nextMinutes);
        }
    }
}
