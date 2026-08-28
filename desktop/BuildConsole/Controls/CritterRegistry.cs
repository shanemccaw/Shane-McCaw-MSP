using System.Collections.Generic;

namespace BuildConsole.Controls
{
    // A registry of critters (id, display name, category, weight, scale, and factory).
    // Each entry's Factory returns a Canvas containing vector elements that visually represent the critter.
    public static class CritterRegistry
    {
        public static List<CritterInfo> All { get; } = new List<CritterInfo>
        {
            // Negative (cute grumpy) critters
            new() { Id = "grumpkin", Name = "Grumpkin", Category = CritterCategory.Negative, SpawnWeight = 1.6, Scale = 1.0, Factory = () => CritterFactory.CreateGrumpkin() },
            new() { Id = "poutlet", Name = "Poutlet", Category = CritterCategory.Negative, SpawnWeight = 1.8, Scale = 0.9, Factory = () => CritterFactory.CreatePoutlet() },
            new() { Id = "snarlbug", Name = "Snarlbug", Category = CritterCategory.Negative, SpawnWeight = 1.6, Scale = 0.95, Factory = () => CritterFactory.CreateSnarlbug() },
            new() { Id = "mossmam", Name = "Mossmam", Category = CritterCategory.Negative, SpawnWeight = 1.2, Scale = 1.15, Factory = () => CritterFactory.CreateMossmam() },
            new() { Id = "glumfish", Name = "Glumfish", Category = CritterCategory.Negative, SpawnWeight = 2.0, Scale = 0.9, Factory = () => CritterFactory.CreateGlumfish() },

            // Positive (cute/celebratory) critters — a larger set
            new() { Id = "blueberry", Name = "Blueberry", Category = CritterCategory.Positive, SpawnWeight = 3.0, Scale = 1.0, Factory = () => CritterFactory.CreateBlueberry() },
            new() { Id = "moonmouse", Name = "Moonmouse", Category = CritterCategory.Positive, SpawnWeight = 2.6, Scale = 0.95, Factory = () => CritterFactory.CreateMoonmouse() },
            new() { Id = "starlet", Name = "Starlet", Category = CritterCategory.Positive, SpawnWeight = 2.4, Scale = 0.95, Factory = () => CritterFactory.CreateStarlet() },
            new() { Id = "daisy", Name = "Daisy Bloom", Category = CritterCategory.Positive, SpawnWeight = 2.2, Scale = 1.0, Factory = () => CritterFactory.CreateDaisy() },
            new() { Id = "whirlpix", Name = "Whirlpix", Category = CritterCategory.Positive, SpawnWeight = 2.1, Scale = 1.05, Factory = () => CritterFactory.CreateWhirlpix() },
            new() { Id = "aurora", Name = "Aurora Unicorn", Category = CritterCategory.Positive, SpawnWeight = 1.7, Scale = 1.15, Factory = () => CritterFactory.CreateAurora() },
            new() { Id = "puffinette", Name = "Puffinette", Category = CritterCategory.Positive, SpawnWeight = 2.8, Scale = 0.95, Factory = () => CritterFactory.CreatePuffinette() },
            new() { Id = "sproutbunny", Name = "Sprout Bunny", Category = CritterCategory.Positive, SpawnWeight = 3.0, Scale = 0.95, Factory = () => CritterFactory.CreateSproutBunny() },
            new() { Id = "buzzybee", Name = "Buzzy Bee", Category = CritterCategory.Positive, SpawnWeight = 3.4, Scale = 0.8, Factory = () => CritterFactory.CreateBuzzyBee() },
            new() { Id = "glimmerfox", Name = "Glimmer Fox", Category = CritterCategory.Positive, SpawnWeight = 2.1, Scale = 1.0, Factory = () => CritterFactory.CreateGlimmerFox() },
            new() { Id = "pompom", Name = "Pom-Pom Mouse", Category = CritterCategory.Positive, SpawnWeight = 2.2, Scale = 0.9, Factory = () => CritterFactory.CreatePomPom() },
            new() { Id = "nibbles", Name = "Nibble Squirrel", Category = CritterCategory.Positive, SpawnWeight = 2.5, Scale = 0.95, Factory = () => CritterFactory.CreateNibbles() },
            new() { Id = "dragonet", Name = "Tumble Dragonet", Category = CritterCategory.Positive, SpawnWeight = 1.9, Scale = 1.05, Factory = () => CritterFactory.CreateDragonet() },
            new() { Id = "nimbus", Name = "Nimbus Cloudling", Category = CritterCategory.Positive, SpawnWeight = 2.3, Scale = 1.1, Factory = () => CritterFactory.CreateNimbus() },
            new() { Id = "sparkle", Name = "Sparkle Narwhal", Category = CritterCategory.Positive, SpawnWeight = 1.6, Scale = 1.0, Factory = () => CritterFactory.CreateSparkle() },
            new() { Id = "peony", Name = "Peony Penguin", Category = CritterCategory.Positive, SpawnWeight = 2.0, Scale = 1.0, Factory = () => CritterFactory.CreatePeony() },
            new() { Id = "chirp", Name = "Chirp Chick", Category = CritterCategory.Positive, SpawnWeight = 3.4, Scale = 0.85, Factory = () => CritterFactory.CreateChirp() },
            new() { Id = "marigold", Name = "Marigold Fairy", Category = CritterCategory.Positive, SpawnWeight = 1.7, Scale = 0.95, Factory = () => CritterFactory.CreateMarigold() },
            new() { Id = "comet", Name = "Comet Otter", Category = CritterCategory.Positive, SpawnWeight = 1.9, Scale = 1.05, Factory = () => CritterFactory.CreateComet() },
            new() { Id = "sunny", Name = "Sunny Snail", Category = CritterCategory.Positive, SpawnWeight = 2.4, Scale = 0.9, Factory = () => CritterFactory.CreateSunny() }
        };
    }
}
