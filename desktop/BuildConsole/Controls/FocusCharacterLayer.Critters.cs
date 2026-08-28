using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    public partial class FocusCharacterLayer : UserControl
    {
        private CritterSpawner? _critterSpawner;

        public void Start()
        {
            if (_running) return;
            _running = true;
            _ambient = new DispatcherTimer(DispatcherPriority.Background, Dispatcher)
            {
                Interval = TimeSpan.FromSeconds(6) // first companion wanders in shortly after entering
            };
            _ambient.Tick += (_, _) => AmbientTick();
            _ambient.Start();

            // instantiate the critter spawner against the same Stage canvas used for other ambient effects
            try
            {
                _critterSpawner = new CritterSpawner(Stage);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("focus-mode", $"couldn't create critter spawner: {ex.Message}");
            }
        }

        public void CelebrateBuildFinished(string title, bool success)
        {
            if (ActualWidth < 60 || ActualHeight < 60) return;
            if (success)
            {
                ConfettiBurst(14);
                Banner("🎉", "Build done!", Res("GreenBrush"));
                HappyHop("🦊");
                // spawn positive critters
                try { _critterSpawner?.SpawnForEvent(true); } catch (Exception ex) { ActivityLog.Log("focus-mode", $"critter spawn failed: {ex.Message}"); }
            }
            else
            {
                Banner("🌧️", "Build ended — shake it off", Res("PeachBrush"));
                HappyHop("🐢");
                // spawn negative critters (cute grumps)
                try { _critterSpawner?.SpawnForEvent(false); } catch (Exception ex) { ActivityLog.Log("focus-mode", $"critter spawn failed: {ex.Message}"); }
            }
            ActivityLog.Log("focus-mode", $"immersive celebration: build {(success ? "finished ✔" : "ended")} — '{Trunc(title)}'");
        }
    }
}
