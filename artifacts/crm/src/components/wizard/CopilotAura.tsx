import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function CopilotAura() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, w / h, 0.1, 100);
    camera.position.set(0, 0, 8.5);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    // ── Glassmorphic rim-lit shader ──────────────────────────────────────────
    const makeMat = (seed: number) =>
      new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0.0 },
          seed: { value: seed },
        },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vPosition;
          void main() {
            vNormal   = normalize(normalMatrix * normal);
            vPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float time;
          uniform float seed;
          varying vec3 vNormal;
          varying vec3 vPosition;

          void main() {
            // Shane McCaw brand palette
            vec3 azure  = vec3(0.000, 0.471, 0.831); // #0078D4
            vec3 teal   = vec3(0.000, 0.706, 0.847); // #00B4D8
            vec3 violet = vec3(0.47,  0.48,  0.96);  // soft indigo-blue
            vec3 navy   = vec3(0.04,  0.145, 0.251); // #0A2540 hint

            float t = time * 0.28 + seed;
            float w1 = sin(vPosition.x * 0.45 + t)        * 0.5 + 0.5;
            float w2 = cos(vPosition.y * 0.45 - t * 0.8)  * 0.5 + 0.5;
            float w3 = sin(vPosition.z * 0.4  + t * 1.1)  * 0.5 + 0.5;

            vec3 col = mix(azure,  violet, w1);
            col      = mix(col,    teal,   w2 * 0.55);
            col      = mix(col,    navy,   w3 * 0.18);

            // Glassmorphic rim glow
            vec3 viewDir = vec3(0.0, 0.0, 1.0);
            float rim = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.2);
            col += rim * vec3(0.35, 0.72, 1.0) * 0.9;

            // Translucent center, bright rim — classic glass material
            float alpha = 0.18 + rim * 0.62;

            gl_FragColor = vec4(col, alpha);
          }
        `,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

    // ── Geometry: 3 interlocking tori (Copilot wings) ───────────────────────
    // Torus 1 — large, front-facing primary ring
    const geo1 = new THREE.TorusGeometry(2.5, 0.52, 140, 80);
    const mat1 = makeMat(0.0);
    const ring1 = new THREE.Mesh(geo1, mat1);
    ring1.rotation.set(0.12, 0.0, 0.08);
    scene.add(ring1);

    // Torus 2 — medium, angled into depth (right wing)
    const geo2 = new THREE.TorusGeometry(1.8, 0.38, 100, 64);
    const mat2 = makeMat(2.09);
    const ring2 = new THREE.Mesh(geo2, mat2);
    ring2.rotation.set(-0.72, 1.15, 0.0);
    scene.add(ring2);

    // Torus 3 — smaller, angled opposite (left wing)
    const geo3 = new THREE.TorusGeometry(1.25, 0.3, 80, 48);
    const mat3 = makeMat(4.54);
    const ring3 = new THREE.Mesh(geo3, mat3);
    ring3.rotation.set(0.88, -0.95, 0.28);
    scene.add(ring3);

    // Torus 4 — ultra-thin outer halo (depth-of-field hint)
    const geo4 = new THREE.TorusGeometry(3.3, 0.12, 60, 120);
    const mat4 = makeMat(1.5);
    const halo = new THREE.Mesh(geo4, mat4);
    halo.rotation.set(0.3, 0.6, 0.0);
    scene.add(halo);

    // ── Floating particle cloud ──────────────────────────────────────────────
    const PTS = 80;
    const pos = new Float32Array(PTS * 3);
    const cols = new Float32Array(PTS * 3);
    const palette = [
      [0.0, 0.471, 0.831],   // azure
      [0.0, 0.706, 0.847],   // teal
      [0.47, 0.48, 0.96],    // violet
    ];
    for (let i = 0; i < PTS; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = 2.2 + Math.random() * 2.8;
      pos[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
      const c = palette[Math.floor(Math.random() * palette.length)]!;
      cols[i * 3 + 0] = c[0]!;
      cols[i * 3 + 1] = c[1]!;
      cols[i * 3 + 2] = c[2]!;
    }
    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    ptGeo.setAttribute("color",    new THREE.BufferAttribute(cols, 3));
    const ptMat = new THREE.PointsMaterial({
      size: 0.055,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(ptGeo, ptMat);
    scene.add(particles);

    // ── Lights ───────────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const lA = new THREE.PointLight(0x0078d4, 2.5, 20);
    lA.position.set(4, 5, 5);
    scene.add(lA);
    const lB = new THREE.PointLight(0x7b7ff5, 2.0, 20);
    lB.position.set(-5, -3, 4);
    scene.add(lB);
    const lC = new THREE.PointLight(0x00b4d8, 1.2, 15);
    lC.position.set(0, -6, -2);
    scene.add(lC);

    // ── Animation loop ───────────────────────────────────────────────────────
    let raf: number;

    const animate = (t: number) => {
      raf = requestAnimationFrame(animate);
      const s = t * 0.001;

      mat1.uniforms.time.value = s;
      mat2.uniforms.time.value = s;
      mat3.uniforms.time.value = s;
      mat4.uniforms.time.value = s;

      // Primary ring — majestic slow drift
      ring1.rotation.y += 0.0028;
      ring1.rotation.x  = 0.12 + Math.sin(s * 0.18) * 0.06;

      // Secondary — counter-drift for parallax depth feel
      ring2.rotation.y += 0.0042;
      ring2.rotation.x  = -0.72 + Math.cos(s * 0.25) * 0.09;

      // Tertiary — opposite Y drift
      ring3.rotation.y -= 0.0035;
      ring3.rotation.z  = 0.28 + Math.sin(s * 0.22) * 0.08;

      // Halo — very slow outer orbit
      halo.rotation.y += 0.0015;
      halo.rotation.x += 0.001;

      // Breathing scale — subtle pulse on the primary ring
      const breathe = 1.0 + Math.sin(s * 0.38) * 0.035;
      ring1.scale.setScalar(breathe);
      ring2.scale.setScalar(1.0 + Math.sin(s * 0.42 + 1.0) * 0.025);
      halo.scale.setScalar(1.0 + Math.sin(s * 0.3) * 0.04);

      // Particles — very slow drift rotation
      particles.rotation.y += 0.0012;
      particles.rotation.x += 0.0006;

      renderer.render(scene, camera);
    };
    animate(0);

    // ── Resize handler ───────────────────────────────────────────────────────
    const onResize = () => {
      if (!el) return;
      const nw = el.clientWidth;
      const nh = el.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener("resize", onResize);

    // ── Cleanup ──────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      [geo1, geo2, geo3, geo4, ptGeo].forEach(g => g.dispose());
      [mat1, mat2, mat3, mat4, ptMat].forEach(m => m.dispose());
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <>
      {/* CSS radial aura glow — brand color warmth behind the canvas */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          background: [
            "radial-gradient(ellipse 90% 75% at 62% 48%, rgba(0,120,212,0.13) 0%, rgba(123,127,245,0.09) 40%, transparent 68%)",
            "radial-gradient(ellipse 50% 40% at 80% 70%, rgba(0,180,216,0.07) 0%, transparent 55%)",
          ].join(", "),
        }}
      />
      {/* Three.js canvas */}
      <div
        ref={mountRef}
        className="absolute inset-0 z-0 pointer-events-none"
        style={{ opacity: 0.58 }}
      />
    </>
  );
}
