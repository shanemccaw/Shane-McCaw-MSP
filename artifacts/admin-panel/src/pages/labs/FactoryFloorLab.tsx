/**
 * FactoryFloorLab — Three.js integration spike.
 *
 * Labs/WIP. Real colony + HQ data flows from GET /api/admin/overlord, but the
 * scene is still unstyled — no belts, no animation, no final art. HQ's
 * era-reset/prestige mechanic (Space-Empire -> Growth Era) is a follow-up;
 * for now grossRevenueUsd past the Space-Empire threshold caps visually.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useAuth } from "@/contexts/AuthContext";

interface Colony {
  mspId: number;
  name: string;
  compositeScore: number;
  seatTier: string | null;
}

interface OverlordTotal {
  grossRevenueUsd: string;
}

interface OverlordResponse {
  overlordTotal: OverlordTotal;
  colonies: Colony[];
}

// ── Sizing ───────────────────────────────────────────────────────────────
// Live compositeScore is near-zero right now (test/fake data, not real
// revenue yet). A dampened sqrt curve with a minimum floor keeps every
// colony visible and distinguishable at score ≈ 0, and grows fast enough
// early on that non-zero scores are still visually meaningful without
// blowing up at the high end.
const SIZE_FLOOR = 0.6;
const SIZE_SCALE = 0.18;

function domeRadius(compositeScore: number): number {
  const score = Number.isFinite(compositeScore) ? Math.max(0, compositeScore) : 0;
  return SIZE_FLOOR + Math.sqrt(score) * SIZE_SCALE;
}

// ── Shape ladder ─────────────────────────────────────────────────────────
// seatTier -> distinct geometry. Genuinely distinguishable, not polished art.
type TierKey = "Micro" | "SMB" | "Mid-Market" | "Enterprise" | "unclassified";

const TIER_MAP: Record<string, TierKey> = {
  Micro: "Micro",
  SMB: "SMB",
  "Mid-Market": "Mid-Market",
  Enterprise: "Enterprise",
};

function resolveTier(seatTier: string | null): TierKey {
  if (seatTier && TIER_MAP[seatTier]) return TIER_MAP[seatTier];
  return "unclassified";
}

const TIER_COLOR: Record<TierKey, string> = {
  Micro: "#4f8ef7",
  SMB: "#4fd1c5",
  "Mid-Market": "#f7b84f",
  Enterprise: "#c084fc",
  unclassified: "#9ca3af",
};

function TierGeometry({ tier, radius }: { tier: TierKey; radius: number }) {
  switch (tier) {
    // Capsule — smallest, low-poly icosahedron.
    case "Micro":
      return <icosahedronGeometry args={[radius, 0]} />;
    // Inflatable — mid-size icosahedron, one subdivision rounder.
    case "SMB":
      return <icosahedronGeometry args={[radius, 1]} />;
    // Dome — smooth sphere.
    case "Mid-Market":
      return <sphereGeometry args={[radius, 24, 16]} />;
    // Mega Dome — larger smooth sphere, higher segment count.
    case "Enterprise":
      return <sphereGeometry args={[radius, 32, 24]} />;
    // Unclassified — octahedron, visually unlike any real tier shape.
    case "unclassified":
    default:
      return <octahedronGeometry args={[radius, 0]} />;
  }
}

// ── HQ growth ladder (Founding Era) ─────────────────────────────────────────
// Locked thresholds from the Factory Floor design doc. Era-reset/prestige
// (Space-Empire -> Growth Era) is out of scope here — values past the
// Space-Empire threshold just cap visually at that stage.
type HqStage = "Garage" | "Factory" | "Launch Pad" | "Spaceport" | "Space-Empire";

const HQ_STAGES: Array<{ stage: HqStage; threshold: number }> = [
  { stage: "Garage", threshold: 0 },
  { stage: "Factory", threshold: 100 },
  { stage: "Launch Pad", threshold: 500 },
  { stage: "Spaceport", threshold: 2_500 },
  { stage: "Space-Empire", threshold: 10_000 },
];

function resolveHqStage(grossRevenueUsd: number): HqStage {
  let current: HqStage = "Garage";
  for (const { stage, threshold } of HQ_STAGES) {
    if (grossRevenueUsd >= threshold) current = stage;
  }
  return current;
}

const HQ_COLOR: Record<HqStage, string> = {
  Garage: "#9ca3af",
  Factory: "#f97316",
  "Launch Pad": "#facc15",
  Spaceport: "#38bdf8",
  "Space-Empire": "#c084fc",
};

// Same floored-growth-curve shape as domeRadius(), scoped to HQ's own stage
// thresholds so HQ visibly grows within a stage, not just jumps between 5
// fixed sizes.
const HQ_SIZE_FLOOR = 1.0;
const HQ_SIZE_SCALE = 0.35;

function hqRadius(grossRevenueUsd: number, stage: HqStage): number {
  const stageIndex = HQ_STAGES.findIndex(s => s.stage === stage);
  const nextThreshold = HQ_STAGES[stageIndex + 1]?.threshold;
  const cappedRevenue = nextThreshold !== undefined
    ? Math.min(grossRevenueUsd, nextThreshold)
    : grossRevenueUsd;
  const revenueIntoStage = Math.max(0, cappedRevenue - HQ_STAGES[stageIndex].threshold);
  return HQ_SIZE_FLOOR + Math.sqrt(revenueIntoStage) * HQ_SIZE_SCALE;
}

function HqGeometry({ stage, radius }: { stage: HqStage; radius: number }) {
  switch (stage) {
    // Garage — simple box, humble beginnings.
    case "Garage":
      return <boxGeometry args={[radius * 1.4, radius * 1.4, radius * 1.4]} />;
    // Factory — squat cylinder, industrial.
    case "Factory":
      return <cylinderGeometry args={[radius, radius, radius * 1.4, 8]} />;
    // Launch Pad — cone, rocket-adjacent.
    case "Launch Pad":
      return <coneGeometry args={[radius, radius * 2, 12]} />;
    // Spaceport — torus, ring-shaped station.
    case "Spaceport":
      return <torusGeometry args={[radius, radius * 0.4, 12, 24]} />;
    // Space-Empire — high-poly icosahedron, grandest silhouette.
    case "Space-Empire":
      return <icosahedronGeometry args={[radius, 2]} />;
    default:
      return <icosahedronGeometry args={[radius, 1]} />;
  }
}

function Headquarters({ grossRevenueUsd }: { grossRevenueUsd: number }) {
  const stage = resolveHqStage(grossRevenueUsd);
  const radius = hqRadius(grossRevenueUsd, stage);
  const color = HQ_COLOR[stage];

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    console.log(`[HQ] stage ${stage} — grossRevenueUsd ${grossRevenueUsd}`);
  };

  return (
    <mesh position={[0, radius, 0]} castShadow onClick={handleClick}>
      <HqGeometry stage={stage} radius={radius} />
      <meshStandardMaterial color={color} flatShading />
    </mesh>
  );
}

function ColonyDome({ colony, position }: { colony: Colony; position: [number, number, number] }) {
  const tier = resolveTier(colony.seatTier);
  const radius = domeRadius(colony.compositeScore);
  const color = TIER_COLOR[tier];

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    console.log(`[colony] ${colony.name} — score ${colony.compositeScore} — tier ${tier}`);
  };

  return (
    <mesh position={[position[0], radius, position[2]]} castShadow onClick={handleClick}>
      <TierGeometry tier={tier} radius={radius} />
      <meshStandardMaterial color={color} flatShading />
    </mesh>
  );
}

function colonyPositions(count: number): Array<[number, number, number]> {
  if (count === 0) return [];
  const layoutRadius = Math.max(6, 3 + count * 1.5);
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return [Math.cos(angle) * layoutRadius, 0, Math.sin(angle) * layoutRadius] as [number, number, number];
  });
}

function Scene({ colonies, grossRevenueUsd }: { colonies: Colony[]; grossRevenueUsd: number }) {
  const positions = useMemo(() => colonyPositions(colonies.length), [colonies.length]);

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[8, 12, 6]} intensity={1.2} castShadow />

      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#2f3336" flatShading />
      </mesh>

      <Headquarters grossRevenueUsd={grossRevenueUsd} />

      {colonies.map((colony, i) => (
        <ColonyDome key={colony.mspId} colony={colony} position={positions[i]} />
      ))}

      <OrbitControls makeDefault />
    </>
  );
}

export default function FactoryFloorLab() {
  const { fetchWithAuth } = useAuth();
  const [colonies, setColonies] = useState<Colony[]>([]);
  const [grossRevenueUsd, setGrossRevenueUsd] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchWithAuth("/api/admin/overlord")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as OverlordResponse;
        setColonies(body.colonies);
        setGrossRevenueUsd(Number(body.overlordTotal.grossRevenueUsd) || 0);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load overlord data"))
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  return (
    <div className="w-full h-full bg-background">
      <div className="absolute z-10 m-4 px-3 py-1.5 rounded-md bg-black/60 text-white text-xs font-medium">
        Factory Floor — Labs Spike (WIP, no final art)
      </div>
      {loading && (
        <div className="absolute z-10 top-14 m-4 px-3 py-1.5 rounded-md bg-black/60 text-white text-xs font-medium">
          Loading colonies…
        </div>
      )}
      {error && (
        <div className="absolute z-10 top-14 m-4 px-3 py-1.5 rounded-md bg-red-900/80 text-white text-xs font-medium">
          Failed to load colonies: {error}
        </div>
      )}
      <Canvas
        shadows
        camera={{ position: [8, 6, 8], fov: 50 }}
        className="w-full h-full"
      >
        <Suspense fallback={null}>
          <Scene colonies={colonies} grossRevenueUsd={grossRevenueUsd} />
        </Suspense>
      </Canvas>
    </div>
  );
}
