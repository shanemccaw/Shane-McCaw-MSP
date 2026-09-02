using System.Collections.Generic;
using System.Windows.Controls;

namespace ShaneBuilder;

// Ported from desktop/BuildConsole/Controls/CritterRegistry.cs for Git #2180 — the
// real registry combining the 10 real Negative builders (MeanCritterArt) and the 10
// real Positive builders (CritterArt) into one spawnable pool with
// SpawnWeight/Scale/Factory per entry. Standalone art layer only — not wired into
// any panel, animation trigger, or celebration event in ShaneBuilder yet.
public static class CritterRegistry
{
    public static List<CritterInfo> All { get; } = BuildAll();

    private static List<CritterInfo> BuildAll()
    {
        var list = new List<CritterInfo>();

        // Negative — the 10 real mean mascots. Each mascot's native canvas is 74x64
        // with a swung prop riding off the right edge; Scale trims it down to read at
        // ambient-companion size alongside the Positive pool below.
        foreach (var mean in MeanCritterArt.MeanCritterPool)
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

        // Positive — the 10 real Build Queue card critters, rendered in their default
        // happy expression.
        void AddPositive(string id, string name, System.Func<Canvas> factory, double weight)
            => list.Add(new CritterInfo { Id = id, Name = name, Category = CritterCategory.Positive, SpawnWeight = weight, Scale = 1.4, Factory = factory });

        AddPositive("panda", "Panda", () => CritterArt.CreateCutePandaVector(CritterArt.CritterMood.Normal), 2.6);
        AddPositive("otter", "Otter", () => CritterArt.CreateCuteOtterVector(CritterArt.CritterMood.Normal), 2.4);
        AddPositive("hedgehog", "Hedgehog", () => CritterArt.CreateCuteHedgehogVector(CritterArt.CritterMood.Normal), 2.2);
        AddPositive("owl", "Owl", () => CritterArt.CreateCuteOwlVector(CritterArt.CritterMood.Normal), 2.1);
        AddPositive("seal", "Seal", () => CritterArt.CreateCuteSealVector(CritterArt.CritterMood.Normal), 2.3);
        AddPositive("raccoon", "Raccoon", () => CritterArt.CreateCuteRaccoonVector(CritterArt.CritterMood.Normal), 2.0);
        AddPositive("hamster", "Hamster", () => CritterArt.CreateCuteHamsterVector(CritterArt.CritterMood.Normal), 2.8);
        AddPositive("frog", "Frog", () => CritterArt.CreateCuteFrogVector(CritterArt.CritterMood.Normal), 2.0);
        AddPositive("koala", "Koala", () => CritterArt.CreateCuteKoalaVector(CritterArt.CritterMood.Normal), 2.2);
        AddPositive("chick", "Chick", () => CritterArt.CreateCuteChickVector(CritterArt.CritterMood.Normal), 3.0);

        return list;
    }
}
