# Critters addition — journal

Commit: Add custom vector-based critters: models, registry, factory, spawner; wire into FocusCharacterLayer on celebration

Files added/modified in branch critters/add-more-critters:
- desktop/BuildConsole/Controls/CritterModels.cs
- desktop/BuildConsole/Controls/CritterRegistry.cs
- desktop/BuildConsole/Controls/CritterFactory.cs
- desktop/BuildConsole/Controls/CritterSpawner.cs
- desktop/BuildConsole/Controls/FocusCharacterLayer.Critters.cs (moved logic into main file)

Notes:
- New critters are vector-based Canvas factories (see CritterFactory).
- CritterSpawner picks weighted random critters and spawns them onto the Stage canvas with entrance animation and TTL.
- FocusCharacterLayer now instantiates a CritterSpawner and triggers critter spawns during CelebrateBuildFinished.
- Style intentionally differs from existing Gemini vectors; palette favors soft pastels and round blobs.

Status: ✅ fixed duplicate method definitions and ready for merge into main.
