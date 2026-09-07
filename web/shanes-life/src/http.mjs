// Tiny HTTP plumbing: routing, body reading, cookies, JSON replies, static files.
// Deliberately hand-rolled -- see README "Why there is no framework and no build step".

import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, normalize, resolve, sep } from "node:path";

export class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export const badRequest = (m, d) => new HttpError(400, m, d);
export const unauthorized = (m = "Not signed in") => new HttpError(401, m);
export const forbidden = (m = "Not allowed") => new HttpError(403, m);
export const notFound = (m = "Not found") => new HttpError(404, m);
export const tooMany = (m, d) => new HttpError(429, m, d);

/** A route table with :params, matched in registration order. */
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const parts = pattern.split("/").filter(Boolean);
    this.routes.push({ method, parts, handler, pattern });
    return this;
  }

  get(p, h) {
    return this.add("GET", p, h);
  }
  post(p, h) {
    return this.add("POST", p, h);
  }
  patch(p, h) {
    return this.add("PATCH", p, h);
  }
  delete(p, h) {
    return this.add("DELETE", p, h);
  }

  match(method, pathname) {
    const parts = pathname.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.parts.length !== parts.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < route.parts.length; i++) {
        const rp = route.parts[i];
        if (rp.startsWith(":")) params[rp.slice(1)] = decodeURIComponent(parts[i]);
        else if (rp !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const chunk of header.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq === -1) continue;
    const k = chunk.slice(0, eq).trim();
    const v = chunk.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function setCookie(res, name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (opts.maxAge !== undefined) bits.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.secure) bits.push("Secure");
  const existing = res.getHeader("Set-Cookie");
  const list = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  list.push(bits.join("; "));
  res.setHeader("Set-Cookie", list);
}

/** Read the raw request body with a hard byte ceiling; never buffer an unbounded upload. */
export function readBody(req, maxBytes) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new HttpError(413, `Body too large (limit ${maxBytes} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function readJson(req, maxBytes = 1_000_000) {
  const buf = await readBody(req, maxBytes);
  if (buf.length === 0) return {};
  try {
    const parsed = JSON.parse(buf.toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected a JSON object");
    }
    return parsed;
  } catch (err) {
    throw badRequest(`Invalid JSON body: ${err.message}`);
  }
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

export function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Serve a file from publicDir. Returns false if there is nothing to serve, so the caller can
 * fall through to a 404 or an SPA shell.
 */
export function serveStatic(publicDir, urlPath, res) {
  // normalize + prefix check is the whole path-traversal defence; ../ never escapes publicDir.
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(publicDir, "." + (clean.startsWith("/") ? clean : "/" + clean));
  if (!filePath.startsWith(publicDir + sep) && filePath !== publicDir) return false;
  if (!existsSync(filePath)) return false;
  const stat = statSync(filePath);
  if (!stat.isFile()) return false;

  const ext = extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "content-length": stat.size,
    // The service worker must never be cached, or a redeploy cannot roll the app forward.
    "cache-control": ext === ".html" || filePath.endsWith("sw.js") ? "no-cache" : "public, max-age=300",
  });
  createReadStream(filePath).pipe(res);
  return true;
}

export function clientIp(req) {
  // Replit terminates TLS in front of the app, so the real client address is in the header.
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || null;
}
