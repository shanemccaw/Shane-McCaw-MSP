import { useEffect, useRef } from "react";
import * as THREE from "three";

interface OrbitalCommandSphereProps {
  fullScreen?: boolean;
}

export default function OrbitalCommandSphere({ fullScreen = false }: OrbitalCommandSphereProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (container.querySelector("canvas")) return;

    let animFrameId: number | undefined;
    let renderer: THREE.WebGLRenderer | undefined;
    const disposables: Array<{ dispose: () => void }> = [];

    function dispose<T extends { dispose: () => void }>(obj: T): T {
      disposables.push(obj);
      return obj;
    }

    try {
      const width = container.clientWidth || window.innerWidth;
      const height = fullScreen ? (container.clientHeight || window.innerHeight) : 720;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
      camera.position.set(0, 2, 14);
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.domElement.style.display = "block";
      container.appendChild(renderer.domElement);

      // ── Star field ──────────────────────────────────────────────────────────
      const starCount = 2000;
      const starPositions = new Float32Array(starCount * 3);
      const starSizes = new Float32Array(starCount);
      for (let i = 0; i < starCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 80 + Math.random() * 120;
        starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        starPositions[i * 3 + 2] = r * Math.cos(phi);
        starSizes[i] = 0.5 + Math.random() * 1.5;
      }
      const starGeo = dispose(new THREE.BufferGeometry());
      starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
      starGeo.setAttribute("size", new THREE.BufferAttribute(starSizes, 1));
      const starMat = dispose(new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader: `
          attribute float size;
          uniform float time;
          varying float vAlpha;
          void main() {
            vAlpha = 0.4 + 0.6 * sin(time * 1.2 + position.x * 0.05);
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
            float alpha = (1.0 - d) * vAlpha;
            gl_FragColor = vec4(0.85, 0.92, 1.0, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
      }));
      scene.add(new THREE.Points(starGeo, starMat));

      // ── Central command sphere ───────────────────────────────────────────────
      const sphereGeo = dispose(new THREE.SphereGeometry(2.2, 48, 48));
      const sphereMat = dispose(new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vPosition;
          varying vec2 vUv;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vPosition = position;
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float time;
          varying vec3 vNormal;
          varying vec3 vPosition;
          varying vec2 vUv;
          void main() {
            // Three brand colors cycling
            vec3 blue   = vec3(0.0,  0.471, 0.831); // #0078D4
            vec3 purple = vec3(0.651,0.482, 1.0);   // #A67BFF
            vec3 teal   = vec3(0.0,  0.706, 0.847); // #00B4D8

            float t1 = sin(time * 0.4) * 0.5 + 0.5;
            float t2 = sin(time * 0.4 + 2.094) * 0.5 + 0.5;
            vec3 baseColor = mix(blue, purple, t1);
            baseColor = mix(baseColor, teal, t2 * 0.5);

            // Fresnel rim glow
            vec3 viewDir = normalize(cameraPosition - vPosition);
            float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.5);

            // Grid wireframe lines
            float grid = step(0.97, fract(vUv.x * 18.0)) + step(0.97, fract(vUv.y * 9.0));
            vec3 col = mix(baseColor * 0.25, baseColor + vec3(fresnel * 0.7), grid * 0.6 + fresnel * 0.4);
            float alpha = 0.15 + grid * 0.55 + fresnel * 0.55;

            gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
          }
        `,
        transparent: true,
        side: THREE.FrontSide,
        depthWrite: false,
      }));
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);
      scene.add(sphere);

      // ── Helper: build an orbital ring ───────────────────────────────────────
      function makeRing(opts: {
        radius: number;
        tube: number;
        rotX: number;
        rotZ: number;
        color1: THREE.Vector3;
        color2: THREE.Vector3;
        speed: number;
        gold?: boolean;
      }) {
        const geo = dispose(new THREE.TorusGeometry(opts.radius, opts.tube, 6, 120));
        const mat = dispose(new THREE.ShaderMaterial({
          uniforms: {
            time: { value: 0 },
            color1: { value: opts.color1 },
            color2: { value: opts.color2 },
            speed: { value: opts.speed },
          },
          vertexShader: `
            uniform float time;
            uniform float speed;
            varying float vEdge;
            varying float vAngle;
            void main() {
              vEdge = abs(normal.z);
              // parametric angle around the torus major axis
              vAngle = atan(position.y, position.x);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform float time;
            uniform float speed;
            uniform vec3 color1;
            uniform vec3 color2;
            varying float vEdge;
            varying float vAngle;
            void main() {
              float t = fract(vAngle / (2.0 * 3.14159) + time * speed * 0.1);
              vec3 col = mix(color1, color2, t);
              float glow = pow(vEdge, 1.5);
              float alpha = 0.25 + glow * 0.65;
              gl_FragColor = vec4(col + glow * 0.4, alpha);
            }
          `,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = opts.rotX;
        mesh.rotation.z = opts.rotZ;
        scene.add(mesh);
        return { mesh, mat };
      }

      const BLUE   = new THREE.Vector3(0.0,  0.471, 0.831);
      const PURPLE = new THREE.Vector3(0.651, 0.482, 1.0);
      const TEAL   = new THREE.Vector3(0.0,  0.706, 0.847);
      const GOLD   = new THREE.Vector3(1.0,  0.714, 0.153); // #FFB627

      const ring1 = makeRing({ radius: 3.6, tube: 0.04, rotX: Math.PI * 0.14, rotZ: 0,              color1: BLUE,   color2: TEAL,   speed: 0.35 });
      const ring2 = makeRing({ radius: 4.4, tube: 0.035,rotX: Math.PI * 0.36, rotZ: Math.PI * 0.2,  color1: PURPLE, color2: BLUE,   speed: -0.22 });
      const ring3 = makeRing({ radius: 5.0, tube: 0.045,rotX: Math.PI * 0.06, rotZ: Math.PI * 0.12, color1: GOLD,   color2: GOLD,   speed: 0.15, gold: true });

      const rings = [ring1, ring2, ring3];

      // ── Racing particles on each ring ────────────────────────────────────────
      const PARTICLES_PER_RING = 20;

      function makeParticles(ringRadius: number, rotX: number, rotZ: number, color: THREE.Vector3) {
        const positions = new Float32Array(PARTICLES_PER_RING * 3);
        const phases = new Float32Array(PARTICLES_PER_RING);
        for (let i = 0; i < PARTICLES_PER_RING; i++) {
          phases[i] = (i / PARTICLES_PER_RING) * Math.PI * 2;
        }
        const geo = dispose(new THREE.BufferGeometry());
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const mat = dispose(new THREE.ShaderMaterial({
          uniforms: { color: { value: color } },
          vertexShader: `
            void main() {
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              gl_PointSize = 4.0 * (200.0 / -mv.z);
              gl_Position = projectionMatrix * mv;
            }
          `,
          fragmentShader: `
            uniform vec3 color;
            void main() {
              float d = length(gl_PointCoord - 0.5) * 2.0;
              if (d > 1.0) discard;
              float alpha = (1.0 - d * d) * 0.92;
              gl_FragColor = vec4(color + vec3(0.3), alpha);
            }
          `,
          transparent: true,
          depthWrite: false,
        }));
        const points = new THREE.Points(geo, mat);

        const pivot = new THREE.Object3D();
        pivot.rotation.x = rotX;
        pivot.rotation.z = rotZ;
        pivot.add(points);
        scene.add(pivot);

        return { geo, phases, ringRadius };
      }

      const particleGroups = [
        makeParticles(3.6, Math.PI * 0.14, 0,             TEAL),
        makeParticles(4.4, Math.PI * 0.36, Math.PI * 0.2, PURPLE),
        makeParticles(5.0, Math.PI * 0.06, Math.PI * 0.12,GOLD),
      ];
      const particleSpeeds = [1.2, -0.75, 0.45];

      // ── Equatorial scan pulse ────────────────────────────────────────────────
      const scanGeo = dispose(new THREE.TorusGeometry(2.25, 0.015, 4, 80));
      const scanMat = dispose(new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader: `
          void main() {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float time;
          void main() {
            float pulse = 0.4 + 0.6 * abs(sin(time * 0.8));
            gl_FragColor = vec4(0.0, 0.706, 0.847, pulse * 0.55);
          }
        `,
        transparent: true,
        depthWrite: false,
      }));
      const scanPulse = new THREE.Mesh(scanGeo, scanMat);
      scanPulse.rotation.x = Math.PI / 2;
      scene.add(scanPulse);

      // ── Ambient + point lights ───────────────────────────────────────────────
      scene.add(new THREE.AmbientLight(0x8899cc, 0.6));
      const pLight = new THREE.PointLight(0x0078D4, 2.5, 30);
      pLight.position.set(0, 0, 8);
      scene.add(pLight);

      // ── Animation loop ───────────────────────────────────────────────────────
      function animate(t: number) {
        animFrameId = requestAnimationFrame(animate);
        const time = t * 0.001;

        // Uniforms
        starMat.uniforms.time.value = time;
        sphereMat.uniforms.time.value = time;
        scanMat.uniforms.time.value = time;
        rings.forEach(({ mat }, i) => { mat.uniforms.time.value = time + i * 1.5; });

        // Slow sphere drift
        sphere.rotation.y += 0.003;
        sphere.rotation.x = Math.sin(time * 0.15) * 0.08;

        // Ring self-rotation
        ring1.mesh.rotation.y += 0.006;
        ring2.mesh.rotation.y -= 0.004;
        ring3.mesh.rotation.y += 0.0025;

        // Scan pulse full revolution every ~8 s
        scanPulse.rotation.y = time * (Math.PI * 2 / 8);

        // Racing particles
        particleGroups.forEach((pg, gi) => {
          const posAttr = pg.geo.attributes.position as THREE.BufferAttribute;
          const spd = particleSpeeds[gi];
          for (let i = 0; i < PARTICLES_PER_RING; i++) {
            const angle = pg.phases[i] + time * spd;
            posAttr.setXYZ(i, Math.cos(angle) * pg.ringRadius, Math.sin(angle) * pg.ringRadius, 0);
          }
          posAttr.needsUpdate = true;
        });

        // Gentle camera bob
        camera.position.y = 2 + Math.sin(time * 0.18) * 0.5;
        camera.lookAt(0, 0, 0);

        renderer!.render(scene, camera);
      }
      animate(0);

      // ── Resize handler ───────────────────────────────────────────────────────
      function onResize() {
        const w = containerRef.current?.clientWidth || window.innerWidth;
        const h = fullScreen ? (containerRef.current?.clientHeight || window.innerHeight) : 720;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullScreen]);

  return (
    <div
      ref={containerRef}
      className={
        fullScreen
          ? "fixed inset-0 w-full h-full z-[1] opacity-90 pointer-events-none"
          : "fixed top-0 left-1/2 -translate-x-1/2 w-full h-[720px] z-[1] opacity-80 pointer-events-none"
      }
    />
  );
}
