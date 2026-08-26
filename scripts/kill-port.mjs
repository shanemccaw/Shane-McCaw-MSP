#!/usr/bin/env node
/**
 * kill-port.mjs
 * Reads /proc/net/tcp to find any process bound to $PORT and sends it SIGTERM.
 * Called as `predev` in Vite artifact packages so stale processes from a previous
 * workflow run don't cause EADDRINUSE on the next start.
 *
 * Safe to run even if PORT is unset or /proc is unavailable — exits 0 always.
 */
import fs from "fs";
import { execSync } from "child_process";

const portStr = process.argv[2] || process.env.PORT;
const port = parseInt(portStr ?? "", 10);
if (!port || isNaN(port)) process.exit(0);

if (process.platform === "win32") {
  try {
    const output = execSync(`netstat -ano`).toString();
    const lines = output.split("\n");
    const pids = new Set();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5) {
        const localAddress = parts[1];
        const state = parts[3];
        const pidStr = parts[4];
        if (state === "LISTENING" && (localAddress.endsWith(`:${port}`) || localAddress.endsWith(`[::]:${port}`))) {
          const pid = parseInt(pidStr, 10);
          if (pid && !isNaN(pid)) {
            pids.add(pid);
          }
        }
      }
    }
    for (const pid of pids) {
      try {
        console.log(`[kill-port] Killing Windows process ${pid} listening on port ${port}...`);
        execSync(`taskkill /F /PID ${pid}`);
      } catch {}
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
}

// /proc/net/tcp stores local addresses in little-endian hex: "0100007F:1F90"
// We need to match the port part (last 4 hex chars of the address field).
const portHex = port.toString(16).toUpperCase().padStart(4, "0");

function killPort(tcpFile) {
  let content;
  try {
    content = fs.readFileSync(tcpFile, "utf8");
  } catch {
    return;
  }

  const inodes = new Set();
  for (const line of content.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 10) continue;
    const localAddr = parts[1]; // e.g. "00000000:4E82"
    const [, p] = localAddr.split(":");
    if (!p) continue;
    if (p.toUpperCase() === portHex) {
      inodes.add(parts[9]); // inode number
    }
  }

  if (inodes.size === 0) return;

  let procDirs;
  try {
    procDirs = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d));
  } catch {
    return;
  }

  for (const pid of procDirs) {
    const fdDir = `/proc/${pid}/fd`;
    let fds;
    try {
      fds = fs.readdirSync(fdDir);
    } catch {
      continue;
    }
    for (const fd of fds) {
      let link;
      try {
        link = fs.readlinkSync(`${fdDir}/${fd}`);
      } catch {
        continue;
      }
      for (const inode of inodes) {
        if (link === `socket:[${inode}]`) {
          try {
            process.kill(parseInt(pid, 10), "SIGTERM");
            console.log(`[kill-port] Sent SIGTERM to PID ${pid} (port ${port})`);
          } catch {
            // process may have already exited
          }
        }
      }
    }
  }
}

killPort("/proc/net/tcp");
killPort("/proc/net/tcp6");

// Give the killed process a moment to release the port
await new Promise((r) => setTimeout(r, 300));
