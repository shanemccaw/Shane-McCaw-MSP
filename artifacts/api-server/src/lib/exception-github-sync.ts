/**
 * Auto-files exception_groups as GitHub issues, DEV ONLY.
 *
 * Shane's ask: every DLQ item / caught exception / uncaught exception
 * currently just sits silently in the database. Wrap capture so it also
 * shows up in GitHub, attached under Epic #530 ("EPIC: Platform" — Shane's
 * real platform-monitoring epic, confirmed live 2026-08-10), WITHOUT
 * spamming it — a group that's already been filed gets a "happened again"
 * comment instead of a duplicate issue, throttled so a hot-looping error
 * can't flood the issue with comments either.
 *
 * Deliberately separate from admin-build-tracker.ts's own GitHub client
 * (routes/ shouldn't be a dependency of lib/) — small, self-contained REST
 * client here instead of importing across that boundary.
 *
 * Gated to SKIP in production (the inverse of most isProductionEnvironment()
 * gates in this codebase, e.g. MFA enforcement): Shane's production tenant
 * genuinely cannot reach GitHub — no GITHUB_TOKEN there, no git — the exact
 * same constraint that made the Git tab and the Build Tracker/Project
 * Management screens themselves devOnly (registry/types.ts's `devOnly`
 * flag, "Gate Git/Build tabs devOnly" commit). Calling the GitHub API from
 * production would just be a guaranteed failure on top of whatever error
 * this was trying to report — worse than not filing anything. This only
 * ever runs from a dev workspace, where GITHUB_TOKEN is actually set.
 *
 * Uses console.error, not the shared `logger` — exception-tracker.ts calls
 * into this module, and logger.ts's own pino hook calls into
 * exception-tracker.ts (to feed every `logger.error({ err })` call site into
 * capture), so importing `logger` here would close that loop into a real
 * circular import (logger.ts -> exception-tracker.ts ->
 * exception-github-sync.ts -> logger.ts), which breaks module init order in
 * some bundling/test contexts. exception-tracker.ts's own catch-all follows
 * the identical rule for the identical reason (see its own comment).
 */

import { db, exceptionGroupsTable, type ExceptionGroup } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isProductionEnvironment } from "./env.ts";

const GITHUB_OWNER = "shanemccaw";
const GITHUB_REPO_NAME = "Shane-McCaw-MSP";
const GITHUB_API = "https://api.github.com";

/** Epic #530, "EPIC: Platform" — Shane's real platform-monitoring epic. Every auto-filed issue is attached under this as a sub-issue. */
const PLATFORM_MONITORING_EPIC_NUMBER = 530;

/** How long to wait before posting another "this happened again" comment on an already-filed issue — a hot-looping error shouldn't flood it. */
const RENOTIFY_COOLDOWN_MS = 60 * 60 * 1000;

async function ghFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN env var not set");
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers || {}),
    },
  });
}

function issueTitle(group: ExceptionGroup): string {
  const location = group.file ? `${group.file}${group.line ? `:${group.line}` : ""}` : group.channel;
  const title = `[${group.channel}] ${group.errorName}: ${group.errorMessage}`.replace(/\s+/g, " ").trim();
  const full = `${title} (${location})`;
  return full.length > 250 ? `${full.slice(0, 247)}...` : full;
}

function issueBody(group: ExceptionGroup): string {
  const lines = [
    `Auto-filed from the exception tracker — this error was captured, not manually reported.`,
    ``,
    `**Fingerprint:** \`${group.fingerprint}\``,
    `**Channel:** ${group.channel}`,
    `**Source:** ${group.source}`,
    `**First seen:** ${group.firstSeenAt.toISOString()}`,
  ];
  if (group.file) lines.push(`**Location:** ${group.file}${group.line ? `:${group.line}` : ""}${group.functionName ? ` (${group.functionName})` : ""}`);
  if (group.codeFrame) lines.push(``, "```", group.codeFrame, "```");
  if (group.stackSample) lines.push(``, "<details><summary>Stack trace</summary>", "", "```", group.stackSample.slice(0, 4000), "```", "", "</details>");
  return lines.join("\n");
}

/**
 * Creates a real GitHub issue for `group` and attaches it under Epic #530 as
 * a sub-issue. Returns the created issue's number/url, or null on any
 * failure (logged, never thrown — filing is best-effort and must never
 * affect the exception-capture path it's called from).
 */
async function createGithubIssue(group: ExceptionGroup): Promise<{ number: number; url: string; id: number } | null> {
  try {
    const createRes = await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues`, {
      method: "POST",
      body: JSON.stringify({ title: issueTitle(group), body: issueBody(group) }),
    });
    if (!createRes.ok) {
      console.error("exception-github-sync: issue creation failed", { status: createRes.status, fingerprint: group.fingerprint });
      return null;
    }
    const created = await createRes.json() as { number: number; html_url: string; id: number };

    try {
      await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${PLATFORM_MONITORING_EPIC_NUMBER}/sub_issues`, {
        method: "POST",
        body: JSON.stringify({ sub_issue_id: created.id }),
      });
    } catch (err) {
      // Non-fatal — the issue still exists and is still useful even if it
      // isn't attached under the epic; don't lose the created issue over this.
      console.error("exception-github-sync: failed to attach under Epic #530", { err, issueNumber: created.number });
    }

    return { number: created.number, url: created.html_url, id: created.id };
  } catch (err) {
    console.error("exception-github-sync: createGithubIssue failed", { err, fingerprint: group.fingerprint });
    return null;
  }
}

async function commentAgain(group: ExceptionGroup): Promise<boolean> {
  if (!group.githubIssueNumber) return false;
  try {
    const body = [
      `This happened again.`,
      ``,
      `**Occurrences:** ${group.occurrenceCount}`,
      `**First seen:** ${group.firstSeenAt.toISOString()}`,
      `**Last seen:** ${group.lastSeenAt.toISOString()}`,
    ].join("\n");
    const res = await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${group.githubIssueNumber}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      console.error("exception-github-sync: re-notify comment failed", { status: res.status, issueNumber: group.githubIssueNumber });
      return false;
    }
    return true;
  } catch (err) {
    console.error("exception-github-sync: commentAgain failed", { err, issueNumber: group.githubIssueNumber });
    return false;
  }
}

/**
 * Syncs `group` to GitHub: files a new issue under Epic #530 if it's never
 * been filed, or posts a throttled "happened again" comment on the
 * already-filed issue otherwise. Dev-workspace only — a complete no-op in
 * production (Shane's production tenant has no path to GitHub at all, see
 * this module's own header comment) and a no-op without GITHUB_TOKEN set
 * even in dev. Never throws — always call this with `void`, never `await`,
 * from a capture path: it must never add GitHub API latency to the thing
 * it's instrumenting.
 */
export async function syncExceptionGroupToGitHub(group: ExceptionGroup): Promise<void> {
  if (isProductionEnvironment()) return;
  if (!process.env.GITHUB_TOKEN) return;
  if (group.status === "suppressed") return; // Shane explicitly doesn't want to hear about this one.

  try {
    if (!group.githubIssueNumber) {
      const created = await createGithubIssue(group);
      if (!created) return;
      await db
        .update(exceptionGroupsTable)
        .set({ githubIssueNumber: created.number, githubIssueUrl: created.url, githubLastNotifiedAt: new Date() })
        .where(eq(exceptionGroupsTable.fingerprint, group.fingerprint));
      console.info("exception-github-sync: filed new issue", { fingerprint: group.fingerprint, issueNumber: created.number });
      return;
    }

    const lastNotified = group.githubLastNotifiedAt?.getTime() ?? 0;
    if (Date.now() - lastNotified < RENOTIFY_COOLDOWN_MS) return; // Already filed and recently notified — don't spam.

    const commented = await commentAgain(group);
    if (commented) {
      await db
        .update(exceptionGroupsTable)
        .set({ githubLastNotifiedAt: new Date() })
        .where(eq(exceptionGroupsTable.fingerprint, group.fingerprint));
    }
  } catch (err) {
    console.error("exception-github-sync: syncExceptionGroupToGitHub failed", { err, fingerprint: group.fingerprint });
  }
}
