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
// path router (Replit `router = "path"`, see .replit) forwards `/msp-console/*` to
// this service, and this service is built/served with `BASE_PATH = "/msp-console/"`
// to match — the same pattern `/portal/`, `/admin-panel/` and `/msp/` already use
// (see artifacts/portal/vite.config.ts's own comment for the full story of why a
// flat/absent BASE_PATH is wrong here: it mounts the SPA at `/`, so a navigation to
// `/msp-console/...` falls through to the client-side NotFound even though Vite
// returns 200 for the HTML).
const MSP_CONSOLE_CANONICAL_BASE = "/msp-console/";
const rawBasePath = process.env.BASE_PATH;
const basePath =
  !rawBasePath || rawBasePath === "/" ? MSP_CONSOLE_CANONICAL_BASE : rawBasePath;

// Local dev topology: the API server runs as its own process (scripts/dev-all.mjs
// → api-server on :8080), separate from this front-end's Vite dev server. The SPA
// calls the API with same-origin RELATIVE /api URLs, so the dev/preview server must
// forward /api (REST + SSE) to the API process. Without this every /api call would
// 404 at the Vite origin. Override the target with VITE_API_PROXY_TARGET if the API
// server runs on a non-default port.
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
