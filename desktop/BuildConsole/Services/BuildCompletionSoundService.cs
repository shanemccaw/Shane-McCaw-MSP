using System;
using System.IO;
using System.Windows.Media;

namespace BuildConsole.Services
{
    /// <summary>
    /// Plays the build-completion sound when a queue-managed build genuinely
    /// finishes (see QueueWatcherService.BuildFinished, raised from TickAsync
    /// right after it reports completion via MarkQueueItemCompleteAsync — the
    /// same real completion state the queue panel and PLATFORM_BUILD already
    /// treat as "done").
    ///
    /// Bundled default is Assets\Sounds\taskCompleted.mp3, copied from Shane's
    /// real local Antigravity IDE install (a VS Code fork) — its stock
    /// accessibility-signal completion sound, confirmed by ear against the
    /// alternative (antigravityCascadeDone.mp3) before wiring anything up.
    /// Shane can override the path in Settings (BuildConsoleSettings.
    /// BuildCompleteSoundPath); empty means "use the bundled default".
    ///
    /// MediaPlayer (WPF's media element, not System.Media.SoundPlayer) is used
    /// because SoundPlayer only supports WAV — this file is an mp3.
    /// </summary>
    public class BuildCompletionSoundService
    {
        private readonly MediaPlayer _player = new();

        /// <summary>Plays the configured completion sound, unless muted. Muting only suppresses playback — callers should still log/react to the completion event itself.</summary>
        public void Play()
        {
            var settings = BuildConsoleSettings.Load();
            if (settings.BuildCompleteSoundMuted) return;

            var path = ResolveSoundPath(settings);
            if (path == null) return;

            try
            {
                // MediaPlayer plays asynchronously via MediaOpened; re-opening on every
                // call (rather than caching) keeps a custom path picked in Settings
                // picked up immediately without restarting the app.
                _player.Open(new Uri(path, UriKind.Absolute));
                _player.Play();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("build-sound", $"Couldn't play completion sound ({path}): {ex.Message}");
            }
        }

        /// <summary>Resolves the real file BuildCompleteSoundPath/the bundled default point at, or null if neither exists on disk.</summary>
        public static string? ResolveSoundPath(BuildConsoleSettings settings)
        {
            var custom = settings.BuildCompleteSoundPath;
            if (!string.IsNullOrWhiteSpace(custom))
                return File.Exists(custom) ? custom : null;

            var bundled = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Assets", "Sounds", "taskCompleted.mp3");
            return File.Exists(bundled) ? bundled : null;
        }
    }
}
