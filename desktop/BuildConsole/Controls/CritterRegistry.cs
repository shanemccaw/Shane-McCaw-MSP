using System.Collections.Generic;
using System.Windows.Controls;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    // Shane, 2026-08-28: "Yesterday I had Copilot add Critters... they don't work well, I
    // don't see them much and the ones I do see are not cute... add 20 new critters — 10
    // good critters that are cute and happy, they close bugs and kill builds, 10 mean
    // critters like my Whammy critter who creates blockers, or ogres who make more work."
    //
    // Replaces the old CritterFactory.cs blob set entirely (that file is gone) — this
    // registry now reuses the SAME hand-built mascots the rest of the app already shows:
    // the 10 new Build Queue card critters (BuildQueuePanel.CreateCuteXVector, the panel's
    // own "which face shows on a queue card" pool) for Positive, and the 10 new mean
    // mascots (IssueChompAnimation.MeanCritterPool, the same ones PlayBlocked/PlayNewWork
    // charge in for a blocked issue or a new-work grump) for Negative. One art set, reused
    // everywhere critters show up, instead of a second lower-quality set living only here.
    public static class CritterRegistry
    {
        public static List<CritterInfo> All { get; } = BuildAll();

        private static List<CritterInfo> BuildAll()
        {
            var list = new List<CritterInfo>();

            // Negative — the 10 new mean mascots (Stitch/Taz-flavored chaos, ogre-ish
            // troublemakers). Each mascot's native canvas is 74x64 with a swung prop
            // riding off the right edge; Scale trims it down to read at ambient-companion
            // size alongside the Positive pool below.
            foreach (var mean in IssueChompAnimation.MeanCritterPool)
            {
                list.Add(new CritterInfo
                {
                    Id = mean.Id,
                    Name = mean.Name,
                    Category = CritterCategory.Negative,
                    SpawnWeight = 1.6,
                    Scale = 0.65,
                    Factory = () => (Canvas)mean.Build().element
                });
            }

            // Positive — the 10 new Build Queue card critters (cute species distinct from
            // the panel's original 5: panda/otter/hedgehog/owl/seal/raccoon/hamster/frog/
            // koala/chick), rendered in their default happy expression for the ambient
            // Focus Mode stroll/celebration and the bug-eating chomp rotation
            // (IssueChompAnimation's CopilotMascotPool reads this Positive list).
            void AddPositive(string id, string name, System.Func<Canvas> factory, double weight)
                => list.Add(new CritterInfo { Id = id, Name = name, Category = CritterCategory.Positive, SpawnWeight = weight, Scale = 1.4, Factory = factory });

            AddPositive("panda", "Panda", () => BuildQueuePanel.CreateCutePandaVector(BuildQueuePanel.CritterMood.Normal), 2.6);
            AddPositive("otter", "Otter", () => BuildQueuePanel.CreateCuteOtterVector(BuildQueuePanel.CritterMood.Normal), 2.4);
            AddPositive("hedgehog", "Hedgehog", () => BuildQueuePanel.CreateCuteHedgehogVector(BuildQueuePanel.CritterMood.Normal), 2.2);
            AddPositive("owl", "Owl", () => BuildQueuePanel.CreateCuteOwlVector(BuildQueuePanel.CritterMood.Normal), 2.1);
            AddPositive("seal", "Seal", () => BuildQueuePanel.CreateCuteSealVector(BuildQueuePanel.CritterMood.Normal), 2.3);
            AddPositive("raccoon", "Raccoon", () => BuildQueuePanel.CreateCuteRaccoonVector(BuildQueuePanel.CritterMood.Normal), 2.0);
            AddPositive("hamster", "Hamster", () => BuildQueuePanel.CreateCuteHamsterVector(BuildQueuePanel.CritterMood.Normal), 2.8);
            AddPositive("frog", "Frog", () => BuildQueuePanel.CreateCuteFrogVector(BuildQueuePanel.CritterMood.Normal), 2.0);
            AddPositive("koala", "Koala", () => BuildQueuePanel.CreateCuteKoalaVector(BuildQueuePanel.CritterMood.Normal), 2.2);
            AddPositive("chick", "Chick", () => BuildQueuePanel.CreateCuteChickVector(BuildQueuePanel.CritterMood.Normal), 3.0);

            return list;
        }
    }
}
