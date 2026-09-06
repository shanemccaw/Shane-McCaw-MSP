#!/usr/bin/env node
// Git #2004 — root package.json `preinstall` pnpm-guard, made explicit and cross-platform.
//
// SCOPE, STATED PLAINLY: this guard only ever runs under `npm install` / `yarn install`.
// pnpm does NOT run a workspace root's `preinstall`/`postinstall` lifecycle scripts during
// `pnpm install` — not fresh, not with `--force`, not with `--enable-pre-post-scripts`
// (empirically verified on pnpm 11.13.0: a marker file written from this script never
// appears under any `pnpm install` variant, while `pnpm run preinstall` invoked directly
// does write it). So this file can never be the thing that gates a `pnpm install` — see
// `.pnpmfile.cjs` at the repo root for the hook that actually does (Git #1986 / #1988).
//
// What THIS script is actually for: when someone runs `npm install` or `yarn install`
// against this pnpm workspace by mistake, refuse it and point them at pnpm instead, and
// clean up whatever lockfile that tool just dropped. `npm_config_user_agent` is real and
// npm/yarn both do run root preinstall scripts, so this half of the original guard is
// correct as far as it goes — it just never touches the pnpm case, by design.
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const userAgent = process.env.npm_config_user_agent || "";

for (const lockfile of ["package-lock.json", "yarn.lock"]) {
  try {
    fs.unlinkSync(path.join(root, lockfile));
  } catch {
    // fine if it never existed
  }
}

if (!/^pnpm\//.test(userAgent)) {
  console.error("Use pnpm instead");
  process.exit(1);
}
