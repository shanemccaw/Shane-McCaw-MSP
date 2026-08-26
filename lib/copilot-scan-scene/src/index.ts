/**
 * @workspace/copilot-scan-scene — the shared "Scene 0" of the Copilot Readiness
 * journey: the live tenant-scan overlay and its never-scanned backstop, plus
 * the pure auto-trigger / gating decisions behind them, extracted so every app
 * that shows this scene renders the SAME component rather than a copy.
 *
 * Consumers today: the original Copilot Readiness journey and the Customer
 * Portal v2 scan landing (both in msp-portal). Ready for the marketing site's
 * Free Scan (Epic #1352, Phase 6) to import directly — nothing here reaches
 * into any app.
 */

// Scene 0 components.
export { RevealScanOverlay } from "./RevealScanOverlay.tsx";
export { RevealNoScanGate } from "./RevealNoScanGate.tsx";

// The pure auto-trigger / gating decisions the scene drives itself with.
export { decideAutoScan, AUTO_SCAN_UNAVAILABLE_MESSAGE } from "./revealAutoScan.ts";
export type { AutoScanDecision, AutoScanStatus } from "./revealAutoScan.ts";
export { shouldBlockNeverScanned } from "./neverScannedGate.ts";
export type { RevealNoScanGateInput } from "./neverScannedGate.ts";

// The scene's view-model contract and the shared "actively scanning" sentinel.
export { SCANNING_PILLAR_CHIP } from "./sceneModel.ts";
export type { ScanScenePillarView, ScanSceneFinding } from "./sceneModel.ts";

// The crossfade lifecycle the overlays share — a consumer coordinating the
// handoff to whatever sits underneath needs the same timing (see msp-portal's
// PortalV2ScanLanding for the pattern).
export { OVERLAY_FADE_MS, useOverlayFade } from "./journeyMotion.ts";
export type { OverlayFade } from "./journeyMotion.ts";

// The pillar identity vocabulary a consumer needs to build a ScanScenePillarView.
export { PILLARS, PILLAR_KEYS, PILLAR_ORDER } from "./journeyTokens.ts";
export type { PillarKey, PillarIdentity } from "./journeyTokens.ts";
