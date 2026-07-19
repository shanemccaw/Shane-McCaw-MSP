/**
 * FactoryFloorLab — Three.js integration spike.
 *
 * Not a feature. Proves react-three-fiber renders and is interactive inside
 * the admin-panel Vite/React 19 build before any real Factory Floor work
 * (belts, colonies, live data) begins. No real data, no final art.
 */

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

function Scene() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[8, 12, 6]} intensity={1.2} castShadow />

      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#2f3336" flatShading />
      </mesh>

      {/* Placeholder dome */}
      <mesh position={[0, 1.5, 0]} castShadow>
        <icosahedronGeometry args={[1.5, 1]} />
        <meshStandardMaterial color="#4f8ef7" flatShading />
      </mesh>

      <OrbitControls makeDefault />
    </>
  );
}

export default function FactoryFloorLab() {
  return (
    <div className="w-full h-full bg-background">
      <div className="absolute z-10 m-4 px-3 py-1.5 rounded-md bg-black/60 text-white text-xs font-medium">
        Factory Floor — Labs Spike (WIP, no real data)
      </div>
      <Canvas
        shadows
        camera={{ position: [8, 6, 8], fov: 50 }}
        className="w-full h-full"
      >
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
    </div>
  );
}
