/**
 * dev-wrapper.js
 *
 * Problem: Expo Metro takes 2-3 minutes to compile its first bundle.
 * Replit's workflow health checker times out waiting for PORT to serve an
 * HTTP 200 response, marking the workflow as "failed" even though Expo is
 * running and the QR code is fully scannable.
 *
 * Solution: Start a lightweight HTTP/WebSocket proxy on PORT immediately
 * (health check passes right away), then launch Expo on PORT+1 and proxy
 * all traffic to it. The Expo domain ($REPLIT_EXPO_DEV_DOMAIN) still
 * points to PORT, so mobile devices connect through the proxy transparently.
 */

const http = require("http");
const net = require("net");
const { spawn } = require("child_process");

const PROXY_PORT = parseInt(process.env.PORT || "24323", 10);
const EXPO_PORT = PROXY_PORT + 1; // e.g. 24324

// ---------------------------------------------------------------------------
// Proxy server — starts instantly so health checks pass before Metro bundles
// ---------------------------------------------------------------------------
const proxy = http.createServer((req, res) => {
  const options = {
    hostname: "127.0.0.1",
    port: EXPO_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${EXPO_PORT}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", () => {
    // Expo not ready yet — return a lightweight status 200 so health checks pass
    if (!res.headersSent) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "starting", message: "Expo Metro is compiling…" }));
    }
  });

  req.pipe(proxyReq, { end: true });
});

// WebSocket upgrade passthrough — needed for Expo HMR (hot module reloading)
proxy.on("upgrade", (req, clientSocket, head) => {
  const serverSocket = net.connect(EXPO_PORT, "127.0.0.1", () => {
    // Replay the upgrade handshake to the Expo server
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\r\n");
    serverSocket.write(
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`
    );
    if (head && head.length) serverSocket.write(head);
    serverSocket.pipe(clientSocket, { end: true });
    clientSocket.pipe(serverSocket, { end: true });
  });
  serverSocket.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => serverSocket.destroy());
});

proxy.listen(PROXY_PORT, "0.0.0.0", () => {
  console.log(
    `[dev-wrapper] Proxy listening on :${PROXY_PORT} → Expo on :${EXPO_PORT}`
  );
});

// ---------------------------------------------------------------------------
// Spawn Expo on EXPO_PORT (inherited env vars carry EXPO_PACKAGER_PROXY_URL etc.)
// ---------------------------------------------------------------------------
const expo = spawn(
  "pnpm",
  ["exec", "expo", "start", "--localhost", "--port", String(EXPO_PORT)],
  {
    env: { ...process.env, PORT: String(EXPO_PORT) },
    stdio: "inherit",
    shell: false,
  }
);

expo.on("error", (err) => {
  console.error("[dev-wrapper] Failed to start Expo:", err);
  process.exit(1);
});

expo.on("exit", (code) => {
  process.exit(code ?? 0);
});

// Forward termination signals so Expo shuts down cleanly
process.on("SIGTERM", () => expo.kill("SIGTERM"));
process.on("SIGINT", () => expo.kill("SIGINT"));
