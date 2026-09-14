import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// This app's canonical mount point (see .replit-artifact/artifact.toml:
// `previewPath = "/admin-panel/"`, `services.env.BASE_PATH = "/admin-panel/"`).
// In Staging/Production the whole platform is served from a single origin whose
// path router forwards `/admin-panel/*` to this service — the same pattern
// `/portal/`, `/msp-console/` and `/msp/` already use (see
// artifacts/portal/vite.config.ts for the full story of why a flat/absent
// BASE_PATH is wrong here). A flat/absent BASE_PATH defaults to this canonical
// base instead of failing config-eval outright.
const ADMIN_PANEL_CANONICAL_BASE = "/admin-panel/";

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

export default defineConfig(async ({ command }) => {
  const rawBasePath = process.env.BASE_PATH;
  const basePath =
    !rawBasePath || rawBasePath === "/" ? ADMIN_PANEL_CANONICAL_BASE : rawBasePath;

  // PORT only matters for `vite dev`/`vite preview` — a real server binds to it.
  // A plain `vite build` never binds a port, so don't make it required at
  // config-eval time for a build (Git #3953): it broke `pnpm run build` for every
  // consumer that doesn't happen to have a PORT already set in its environment.
  let port: number | undefined;
  if (command !== "build") {
    const rawPort = process.env.PORT;

    if (!rawPort) {
      throw new Error(
        "PORT environment variable is required but was not provided.",
      );
    }

    port = Number(rawPort);

    if (Number.isNaN(port) || port <= 0) {
      throw new Error(`Invalid PORT value: "${rawPort}"`);
    }
  }

  return {
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
  };
});
