using System;
using System.Text;
using System.Windows.Controls;

namespace BuildConsole.Services
{
    /// <summary>
    /// Shared pause/resume behavior for the app's continuously-scrolling live
    /// TextBox log panels (Activity Log, Build Log, Terminal). While paused,
    /// incoming text is buffered here instead of touching the TextBox, so the
    /// underlying stream keeps capturing everything but the visible panel stops
    /// moving/updating - letting Shane select and copy text without it jumping.
    /// Resume flushes the buffer and scrolls back to live.
    /// </summary>
    public sealed class PausableTextBoxLog
    {
        private readonly TextBox _box;
        private readonly StringBuilder _pending = new();

        public bool IsPaused { get; private set; }

        public PausableTextBoxLog(TextBox box) => _box = box;

        public void Append(string text, Action<string>? applyToBox = null)
        {
            if (IsPaused)
            {
                _pending.Append(text);
                return;
            }
            (applyToBox ?? (t => _box.AppendText(t)))(text);
            _box.ScrollToEnd();
        }

        public void Pause() => IsPaused = true;

        public void Resume(Action<string>? applyToBox = null)
        {
            IsPaused = false;
            if (_pending.Length > 0)
            {
                (applyToBox ?? (t => _box.AppendText(t)))(_pending.ToString());
                _pending.Clear();
            }
            _box.ScrollToEnd();
        }

        public void Toggle()
        {
            if (IsPaused) Resume(); else Pause();
        }

        /// <summary>Drop any buffered-while-paused text without flushing it (used when the panel switches to a different log entirely, e.g. a different queue item).</summary>
        public void Reset()
        {
            _pending.Clear();
            IsPaused = false;
        }
    }
}
