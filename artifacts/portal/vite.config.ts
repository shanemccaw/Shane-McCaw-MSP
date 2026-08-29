import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// This app's canonical mount point.
//
// In Staging/Production the whole platform is served from a SINGLE origin whose
// path router (Replit `router = "path"`, see .replit) forwards `/portal/*` to
// this service, and this service is built/served with `BASE_PATH = "/portal/"`
// to match. Every real Portal link — and every test manifest — therefore uses
// prod-shaped `/portal/:slug/...` URLs.
//
// The local Dev orchestrator (scripts/dev-all.mjs) historically injected a flat
// `BASE_PATH="/"` for EVERY front-end. For this app that flattening is wrong: it
// mounted the SPA at `/`, so a navigation to `/portal/:slug/...` fell through to
// the client-side NotFound — a real (client-side) 404 — even though Vite returned
// 200 for the HTML. That is exactly what broke every Portal uiSteps run once the
// three-tier rework moved uiSteps onto the per-service front-end ports (Git #1211,
// follow-up to #1210). So a flat-or-absent `BASE_PATH` is treated here as "mount
// this app at its canonical base", keeping local Dev PATH-equivalent to
// Staging/Production: the SPA genuinely mounts under `/portal/` (no prefix
// stripping, no manifest rewrites — the same base the Replit path router expects).
// An explicit non-flat `BASE_PATH` (e.g. a bespoke preview mount) is still honored
// verbatim.
const PORTAL_CANONICAL_BASE = "/portal/";
const rawBasePath = process.env.BASE_PATH;
const basePath =
  !rawBasePath || rawBasePath === "/" ? PORTAL_CANONICAL_BASE : rawBasePath;

// Local dev topology: the API server runs as its own process (scripts/dev-all.mjs
// → api-server on :8080), separate from this front-end's Vite dev server. The SPA
// calls the API with same-origin RELATIVE /api URLs, so the dev/preview server must
// forward /api (REST + SSE) to the API process. Without this every /api call —
// login included — 404s at the Vite origin. Override the target with
// VITE_API_PROXY_TARGET if the API server runs on a non-default port.
function apiProxy() {
  const target = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8080";
  return {
    "/api": { target, changeOrigin: true },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: apiProxy(),
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: apiProxy(),
  },
});
