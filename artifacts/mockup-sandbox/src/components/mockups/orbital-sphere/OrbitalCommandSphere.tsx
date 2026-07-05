import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function OrbitalCommandSphere() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (container.querySelector("canvas")) return;

    let animFrameId: number | undefined;
    let renderer: THREE.WebGLRenderer | undefined;
    const disposables: Array<{ dispose: () => void }> = [];

    function reg<T extends { dispose: () => void }>(obj: T): T {
      disposables.push(obj);
      return obj;
    }

    try {
      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
      camera.position.set(0, 2, 14);
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.domElement.style.display = "block";
      container.appendChild(renderer.domElement);

      // ── Deep-space star field (~2 000 particles) ─────────────────────────────
      const STAR_COUNT = 2000;
      const starPos = new Float32Array(STAR_COUNT * 3);
      const starSz  = new Float32Array(STAR_COUNT);
      for (let i = 0; i < STAR_COUNT; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi   = Math.acos(2 * Math.random() - 1);
        const r     = 80 + Math.random() * 120;
        starPos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
        starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        starPos[i * 3 + 2] = r * Math.cos(phi);
        starSz[i] = 0.5 + Math.random() * 1.5;
      }
      const starGeo = reg(new THREE.BufferGeometry());
      starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
      starGeo.setAttribute("size",     new THREE.BufferAttribute(starSz,  1));
      const starMat = reg(new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader: `
          attribute float size;
          uniform float time;
          varying float vAlpha;
          void main() {
            vAlpha = 0.35 + 0.65 * sin(time * 1.1 + position.x * 0.05);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size * (300.0 / -mv.z);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          varying float vAlpha;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            if (d > 1.0) discard;
            gl_FragColor = vec4(0.85, 0.92, 1.0, (1.0 - d) * vAlpha);
          }
        `,
        transparent: true,
        depthWrite: false,
      }));
      scene.add(new THREE.Points(starGeo, starMat));

      // ── Central command sphere (wireframe + Fresnel GLSL) ────────────────────
      const sphereGeo = reg(new THREE.SphereGeometry(2.2, 48, 48));
      const sphereMat = reg(new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vPosition;
          varying vec2 vUv;
          void main() {
            vNormal   = normalize(normalMatrix * normal);
            vPosition = position;
            vUv       = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float time;
          varying vec3 vNormal;
          varying vec3 vPosition;
          varying vec2 vUv;
          void main() {
            vec3 blue   = vec3(0.0,  0.471, 0.831); // #0078D4
            vec3 purple = vec3(0.651,0.482, 1.0);   // #A67BFF
            vec3 teal   = vec3(0.0,  0.706, 0.847); // #00B4D8

            float t1 = sin(time * 0.38) * 0.5 + 0.5;
            float t2 = sin(time * 0.38 + 2.094) * 0.5 + 0.5;
            vec3 base = mix(blue, purple, t1);
            base = mix(base, teal, t2 * 0.5);

            // Fresnel rim
            vec3 viewDir = normalize(cameraPosition - vPosition);
            float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.5);

            // Lat/lon grid lines
            float grid = step(0.96, fract(vUv.x * 18.0)) + step(0.96, fract(vUv.y * 9.0));
            vec3 col   = mix(base * 0.2, base + vec3(fresnel * 0.7), grid * 0.6 + fresnel * 0.4);
            float alpha = clamp(0.12 + grid * 0.58 + fresnel * 0.58, 0.0, 1.0);

            gl_FragColor = vec4(col, alpha);
          }
        `,
        transparent: true,
        side: THREE.FrontSide,
        depthWrite: false,
      }));
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);
      scene.add(sphere);

      // ── Orbital ring factory ─────────────────────────────────────────────────
      type RingDef = { radius: number; tube: number; rotX: number; rotZ: number; c1: THREE.Vector3; c2: THREE.Vector3; speed: number };
      function makeRing(d: RingDef) {
        const geo = reg(new THREE.TorusGeometry(d.radius, d.tube, 6, 120));
        const mat = reg(new THREE.ShaderMaterial({
          uniforms: { time: { value: 0 }, c1: { value: d.c1 }, c2: { value: d.c2 }, spd: { value: d.speed } },
          vertexShader: `
            varying float vEdge;
            varying float vAngle;
            void main() {
              vEdge  = abs(normal.z);
              vAngle = atan(position.y, position.x);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform float time;
            uniform vec3  c1, c2;
            uniform float spd;
            varying float vEdge;
            varying float vAngle;
            void main() {
              float t   = fract(vAngle / 6.28318 + time * spd * 0.1);
              vec3  col = mix(c1, c2, t);
              float glow = pow(vEdge, 1.5);
              gl_FragColor = vec4(col + glow * 0.45, 0.2 + glow * 0.7);
            }
          `,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = d.rotX;
        mesh.rotation.z = d.rotZ;
        scene.add(mesh);
        return { mesh, mat };
      }

      const BLUE   = new THREE.Vector3(0.0,  0.471, 0.831);
      const PURPLE = new THREE.Vector3(0.651, 0.482, 1.0);
      const TEAL   = new THREE.Vector3(0.0,  0.706, 0.847);
      const GOLD   = new THREE.Vector3(1.0,  0.714, 0.153); // #FFB627 — NASA gold

      const ring1 = makeRing({ radius: 3.6, tube: 0.040, rotX: Math.PI * 0.14, rotZ: 0,              c1: BLUE,   c2: TEAL,   speed:  0.35 });
      const ring2 = makeRing({ radius: 4.4, tube: 0.035, rotX: Math.PI * 0.36, rotZ: Math.PI * 0.20, c1: PURPLE, c2: BLUE,   speed: -0.22 });
      const ring3 = makeRing({ radius: 5.0, tube: 0.045, rotX: Math.PI * 0.06, rotZ: Math.PI * 0.12, c1: GOLD,   c2: GOLD,   speed:  0.15 });
      const rings = [ring1, ring2, ring3];

      // ── Racing light particles (~20 per ring = 60 total) ─────────────────────
      const PER_RING = 20;
      type ParticleGroup = { geo: THREE.BufferGeometry; phases: Float32Array; r: number };

      function makeParticles(r: number, rotX: number, rotZ: number, col: THREE.Vector3): ParticleGroup {
        const pos    = new Float32Array(PER_RING * 3);
        const phases = new Float32Array(PER_RING);
        for (let i = 0; i < PER_RING; i++) phases[i] = (i / PER_RING) * Math.PI * 2;

        const geo = reg(new THREE.BufferGeometry());
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        const mat = reg(new THREE.ShaderMaterial({
          uniforms: { col: { value: col } },
          vertexShader: `
            void main() {
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              gl_PointSize = 4.0 * (200.0 / -mv.z);
              gl_Position  = projectionMatrix * mv;
            }
          `,
          fragmentShader: `
            uniform vec3 col;
            void main() {
              float d = length(gl_PointCoord - 0.5) * 2.0;
              if (d > 1.0) discard;
              gl_FragColor = vec4(col + 0.3, (1.0 - d * d) * 0.92);
            }
          `,
          transparent: true,
          depthWrite: false,
        }));
        const points = new THREE.Points(geo, mat);
        const pivot  = new THREE.Object3D();
        pivot.rotation.x = rotX;
        pivot.rotation.z = rotZ;
        pivot.add(points);
        scene.add(pivot);
        return { geo, phases, r };
      }

      const pGroups = [
        makeParticles(3.6, Math.PI * 0.14, 0,              TEAL),
        makeParticles(4.4, Math.PI * 0.36, Math.PI * 0.20, PURPLE),
        makeParticles(5.0, Math.PI * 0.06, Math.PI * 0.12, GOLD),
      ];
      const pSpeeds = [1.2, -0.75, 0.45];

      // ── Equatorial scan pulse — one revolution every ~8 s ────────────────────
      const scanGeo = reg(new THREE.TorusGeometry(2.26, 0.018, 4, 80));
      const scanMat = reg(new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader: `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform float time;
          void main() {
            float pulse = 0.35 + 0.65 * abs(sin(time * 0.75));
            gl_FragColor = vec4(0.0, 0.706, 0.847, pulse * 0.6);
          }
        `,
        transparent: true,
        depthWrite: false,
      }));
      const scanPulse = new THREE.Mesh(scanGeo, scanMat);
      scanPulse.rotation.x = Math.PI / 2;
      scene.add(scanPulse);

      // ── Lights ───────────────────────────────────────────────────────────────
      scene.add(new THREE.AmbientLight(0x8899cc, 0.6));
      const pLight = new THREE.PointLight(0x0078D4, 2.5, 30);
      pLight.position.set(0, 0, 8);
      scene.add(pLight);

      // ── Render loop ──────────────────────────────────────────────────────────
      function animate(t: number) {
        animFrameId = requestAnimationFrame(animate);
        const time = t * 0.001;

        starMat.uniforms.time.value  = time;
        sphereMat.uniforms.time.value = time;
        scanMat.uniforms.time.value  = time;
        rings.forEach(({ mat }, i) => { mat.uniforms.time.value = time + i * 1.5; });

        sphere.rotation.y += 0.003;
        sphere.rotation.x  = Math.sin(time * 0.15) * 0.08;

        ring1.mesh.rotation.y += 0.006;
        ring2.mesh.rotation.y -= 0.004;
        ring3.mesh.rotation.y += 0.0025;

        scanPulse.rotation.y = time * (Math.PI * 2 / 8);

        pGroups.forEach((pg, gi) => {
          const attr = pg.geo.attributes.position as THREE.BufferAttribute;
          const spd  = pSpeeds[gi];
          for (let i = 0; i < PER_RING; i++) {
            const angle = pg.phases[i] + time * spd;
            attr.setXYZ(i, Math.cos(angle) * pg.r, Math.sin(angle) * pg.r, 0);
          }
          attr.needsUpdate = true;
        });

        camera.position.y = 2 + Math.sin(time * 0.18) * 0.5;
        camera.lookAt(0, 0, 0);

        renderer!.render(scene, camera);
      }
      animate(0);

      // ── Resize ───────────────────────────────────────────────────────────────
      function onResize() {
        const w = containerRef.current?.clientWidth  || window.innerWidth;
        const h = containerRef.current?.clientHeight || window.innerHeight;
        renderer!.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      window.addEventListener("resize", onResize);

      return () => {
        cancelAnimationFrame(animFrameId!);
        window.removeEventListener("resize", onResize);
        const c = containerRef.current;
        if (c && c.contains(renderer!.domElement)) c.removeChild(renderer!.domElement);
        try { renderer!.getContext().getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* ignore */ }
        renderer!.dispose();
        for (const d of disposables) { try { d.dispose(); } catch { /* ignore */ } }
      };
    } catch {
      if (animFrameId !== undefined) cancelAnimationFrame(animFrameId);
      try { renderer?.dispose(); } catch { /* ignore */ }
      for (const d of disposables) { try { d.dispose(); } catch { /* ignore */ } }
      return undefined;
    }
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100vh", background: "#0A2540" }}
    />
  );
}
