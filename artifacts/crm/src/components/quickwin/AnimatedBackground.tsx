import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function AnimatedBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let animFrameId: number | undefined;
    let renderer: THREE.WebGLRenderer | undefined;
    let geometry: THREE.BufferGeometry | undefined;
    let material: THREE.ShaderMaterial | undefined;

    try {
      const width = container.clientWidth || window.innerWidth;
      const height = 600;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });

      renderer.setSize(width, height);
      container.appendChild(renderer.domElement);

      geometry = new THREE.TorusKnotGeometry(2.2, 0.6, 200, 32, 2, 3);

      material = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vPosition;
          void main() {
            vUv = uv;
            vNormal = normalize(normalMatrix * normal);
            vPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float time;
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vPosition;
          void main() {
            vec3 azure = vec3(0.0, 0.47, 0.83);
            vec3 violet = vec3(0.65, 0.48, 1.0);
            vec3 cyan = vec3(0.0, 0.95, 1.0);

            float shift = time * 0.35;
            float pattern = sin(vPosition.x * 0.4 + shift) * 0.5 + 0.5;
            float pattern2 = cos(vPosition.y * 0.4 - shift) * 0.5 + 0.5;

            vec3 color = mix(azure, violet, pattern);
            color = mix(color, cyan, pattern2 * 0.6);

            float intensity = pow(1.0 - max(dot(vNormal, vec3(0,0,1)), 0.0), 3.0);
            color += intensity * 0.6;

            gl_FragColor = vec4(color, 0.45);
          }
        `,
        transparent: true,
        side: THREE.DoubleSide,
      });

      const ribbon = new THREE.Mesh(geometry, material);
      scene.add(ribbon);
      scene.add(new THREE.AmbientLight(0xffffff, 0.8));
      const pointLight = new THREE.PointLight(0xffffff, 0.6);
      pointLight.position.set(5, 5, 5);
      scene.add(pointLight);

      camera.position.z = 7;
      camera.position.y = 0;

      function animate(t: number) {
        animFrameId = requestAnimationFrame(animate);
        material!.uniforms.time.value = t * 0.001;
        ribbon.rotation.x = Math.sin(t * 0.0001) * 0.2;
        ribbon.rotation.y += 0.004;
        const s = 1.05 + Math.sin(t * 0.0008) * 0.05;
        ribbon.scale.set(s, s, s);
        renderer!.render(scene, camera);
      }
      animate(0);

      function onResize() {
        const w = containerRef.current?.clientWidth || window.innerWidth;
        renderer!.setSize(w, height);
        camera.aspect = w / height;
        camera.updateProjectionMatrix();
      }
      window.addEventListener("resize", onResize);

      return () => {
        cancelAnimationFrame(animFrameId!);
        window.removeEventListener("resize", onResize);
        renderer!.dispose();
        geometry!.dispose();
        material!.dispose();
        const c = containerRef.current;
        if (c && c.contains(renderer!.domElement)) {
          c.removeChild(renderer!.domElement);
        }
      };
    } catch {
      // WebGL not available (e.g. headless browser, restricted environment).
      // Degrade silently — the background is purely decorative.
      if (animFrameId !== undefined) cancelAnimationFrame(animFrameId);
      try { renderer?.dispose(); } catch { /* ignore */ }
      try { geometry?.dispose(); } catch { /* ignore */ }
      try { material?.dispose(); } catch { /* ignore */ }
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed top-0 left-1/2 -translate-x-1/2 w-full h-[600px] z-0 opacity-40 pointer-events-none overflow-hidden"
    />
  );
}
