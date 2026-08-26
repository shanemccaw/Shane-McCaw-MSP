# @workspace/copilot-scan-scene

The shared **Scene 0** of the Copilot Readiness journey — the live tenant-scan
radar overlay and its never-scanned backstop — extracted so every app that
shows this scene renders the *same* component instead of a copy (Epic #1352,
Phase 5 / Git #1357).

## Public API (`.`)

- `RevealScanOverlay` — the full-bleed live-scan radar overlay.
- `RevealNoScanGate` — the "no scan on record yet" backstop panel.
- `decideAutoScan` / `AUTO_SCAN_UNAVAILABLE_MESSAGE` — the auto-trigger decision
  (testbed-only trigger; real tenants never get a self-serve trigger).
- `shouldBlockNeverScanned` — the never-scanned gating decision.
- `SCANNING_PILLAR_CHIP`, `ScanScenePillarView`, `ScanSceneFinding` — the scene's
  view-model contract and the "actively scanning" sentinel.
- `OVERLAY_FADE_MS` / `useOverlayFade` — the crossfade lifecycle the overlays
  share, exposed so a consumer can time its own handoff to match.
- `PILLARS` / `PILLAR_KEYS` / `PILLAR_ORDER` / `PillarKey` — the pillar identity
  vocabulary needed to build a `ScanScenePillarView`.

Styling: `import "@workspace/copilot-scan-scene/copilot-scan-scene.css"` — a
trimmed sheet with just the `.cj-dark` surface and the `cj-pulse-dot` keyframe
the scene needs. (msp-portal keeps importing its fuller `copilot-journey.css`,
a superset, so its styling is unchanged.)

## Why the journey design-system foundation lives here too

`RevealScanOverlay` is built on the journey's shared design tokens
(`journeyTokens`), radar math (`revealMath`), overlay motion (`journeyMotion`)
and primitive marks (`JourneyPrimitives`). For the scene to be genuinely
importable by an app that does **not** have the msp-portal journey, that
foundation has to resolve inside a shared package rather than reach back into
the app. So those four modules were moved here as the scene's single source of
truth; msp-portal's `components/copilot-journey/{journeyTokens,revealMath,`
`journeyMotion,JourneyPrimitives}` are now thin re-export shims pointing here,
so the rest of the journey imports the identical code by its existing paths with
zero behavior change. They are exposed as subpath exports (e.g.
`@workspace/copilot-scan-scene/journeyTokens`) for those shims.

## Tests

`pnpm --filter @workspace/copilot-scan-scene test` runs the `decideAutoScan` and
`shouldBlockNeverScanned` unit suites (`tsx --test`).
