/**
 * Git #4408 — TOTP codes for tests, one per time-step.
 *
 * The server refuses a code whose time-step is <= the last one an enrollment
 * accepted (RFC 6238 §5.2 replay protection), and the code that finishes
 * enrollment counts as accepted. A test that enrolls and then signs in, or signs
 * in twice, inside one 30s window cannot reuse `generateSync({ secret })` — that
 * is the replay the server now refuses.
 *
 * `nextTotpCode(secret)` hands out a code for a step no earlier code from this
 * helper used, starting one step in the past. The server accepts steps
 * [now-1, now+1], so three codes per secret are available without waiting; a
 * fourth waits for the clock. It also steps past a window boundary that is under
 * `BOUNDARY_MARGIN_MS` away, so a code minted for now-1 cannot age out between
 * generation and verification.
 */

import { generateSync } from "otplib";

const PERIOD_SECONDS = 30;
const BOUNDARY_MARGIN_MS = 3_000;

const lastStepBySecret = new Map<string, number>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function nextTotpCode(secret: string): Promise<string> {
  for (;;) {
    const nowMs = Date.now();
    const msIntoStep = nowMs % (PERIOD_SECONDS * 1000);
    const msLeft = PERIOD_SECONDS * 1000 - msIntoStep;
    if (msLeft < BOUNDARY_MARGIN_MS) {
      await sleep(msLeft + 100);
      continue;
    }

    const current = Math.floor(nowMs / 1000 / PERIOD_SECONDS);
    const last = lastStepBySecret.get(secret);
    const step = last == null ? current - 1 : Math.max(last + 1, current - 1);
    if (step > current + 1) {
      await sleep(msLeft + 100);
      continue;
    }

    lastStepBySecret.set(secret, step);
    return generateSync({ secret, epoch: step * PERIOD_SECONDS });
  }
}

/** The step the last `nextTotpCode(secret)` call used — for asserting what the server stored. */
export function lastIssuedTotpStep(secret: string): number | undefined {
  return lastStepBySecret.get(secret);
}
