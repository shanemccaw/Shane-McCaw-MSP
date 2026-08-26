import { z } from "zod";
import { apiFetch } from "../api-client.ts";
import type { ToolDef } from "./registry.ts";
import { logger } from "../logger.ts";

/**
 * create_account — Phase 2 of #1319 (Git #1321): the buyer's portal account
 * for a PAID purchase session, created through #1310's REAL generalized
 * inline account-creation flow. A thin wrapper over the api-server's
 * public-purchase-account.ts routes → lib/purchase-account-flow.ts — the
 * exact code Buy.tsx runs; account creation is NOT re-implemented here.
 *
 * The flow is inherently multi-step (the buyer must prove control of the
 * purchase mailbox with an emailed six-digit code before a password can be
 * attached), so one tool drives it via `action`:
 *
 *   status                  GET  /public/purchase/account-status
 *   send_verification_code  POST /public/purchase/send-verification-code
 *   verify_code             POST /public/purchase/verify-code
 *   set_password            POST /public/purchase/set-password
 *
 * Every step re-enforces the flow's own server-side gates — this wrapper
 * adds none and removes none: the session must be a real, unexpired,
 * already-PAID checkout_sessions row (session_invalid / session_expired /
 * payment_required); the code's 5-attempt budget follows the issued code;
 * the verified address must still be the session's own at password time;
 * and an existing account's password is never overwritten (already_set —
 * /auth/forgot-password is the door for that).
 *
 * Secrets doctrine (same as the routes', extended to the MCP trail):
 *  - `code` and `password` are redacted from the #1325 audit row's
 *    metadata.params (audit: redactParams) — the routes never persist
 *    either, and neither does this trail.
 *  - set-password's response carries a portalUrl bearing a single-use,
 *    2-minute signup-exchange token that logs a browser in with NO MFA
 *    challenge (#636/#1313). The tool result persists verbatim into the
 *    audit row's metadata.result, so that token is stripped from the
 *    returned portalUrl (`signupTokenWithheld: true`) — the buyer signs in
 *    at the portal with the credentials just set instead.
 *
 * MFA enrollment (totp/passkey) is deliberately NOT wrapped: it is the tail
 * of Buy.tsx's own browser flow (passkeys are origin-bound and cannot
 * enroll over MCP), and an account completed here enrolls MFA in the
 * portal after first sign-in.
 */

// Account-creation lines land under the flow's own channel (auth, matching
// public-purchase-account.ts) — the child binding overrides the parent
// logger's admin.mcp channel key, so each line carries exactly one channel.
const log = logger.child({ channel: "auth" });

interface AccountStatusResponse {
  productSlug: string;
  email: string;
  emailVerified: boolean;
  passwordSet: boolean;
  mfaEnrolled: boolean;
}

interface SendCodeResponse {
  ok: boolean;
  expiresAt: string;
  email: string;
}

interface VerifyCodeResponse {
  ok: boolean;
  alreadyVerified?: boolean;
}

interface SetPasswordResponse {
  ok: boolean;
  email: string;
  accountProvisioned: boolean;
  portalUrl: string;
}

const inputSchema = {
  action: z
    .enum(["status", "send_verification_code", "verify_code", "set_password"])
    .describe(
      "Flow step to run. ALWAYS start with 'status' to see where this session honestly stands (emailVerified/" +
        "passwordSet/mfaEnrolled) — a resumed session may already be past a step. Then: 'send_verification_code' " +
        "emails the buyer a REAL six-digit code (Exchange Online/Graph, 15-minute expiry; re-sending supersedes " +
        "the previous code) → 'verify_code' judges the code the buyer reads back → 'set_password' completes the " +
        "account.",
    ),
  sessionId: z
    .string()
    .uuid()
    .describe(
      "checkout_sessions UUID of the buyer's PAID purchase session — the same server-side session Buy.tsx checks " +
        "out through (#1302/#1306). Refused with session_invalid/session_expired/payment_required unless the row " +
        "is real, unexpired and status='paid'.",
    ),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "code must be the six digits from the buyer's email")
    .optional()
    .describe(
      "The six-digit code from the buyer's email — required for (and only used by) 'verify_code'. Each issued " +
        "code allows 5 attempts total; exhausting them locks that code out even for the right digits (429 " +
        "too_many_attempts — send a fresh code).",
    ),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .optional()
    .describe(
      "The buyer's chosen portal password (min 8 chars) — required for (and only used by) 'set_password'. Never " +
        "persisted in the audit trail (redacted), stored only as a bcrypt(12) hash by the flow itself.",
    ),
};

/** The signup token is a no-MFA-challenge auto-login credential — never
 *  returned (and therefore never persisted into the audit row's result). */
function stripSignupToken(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.searchParams.delete("signupToken");
    return url.toString();
  } catch {
    return rawUrl.split("?")[0] ?? rawUrl;
  }
}

export const createAccountTool: ToolDef = {
  name: "create_account",
  description:
    "CREATE THE BUYER'S PORTAL ACCOUNT for a PAID purchase session — wraps #1310's real generalized inline " +
    "account-creation flow (public-purchase-account.ts → lib/purchase-account-flow.ts), the exact code Buy.tsx " +
    "runs; nothing is re-implemented. Multi-step via `action`: 'status' (where the session stands — start here), " +
    "'send_verification_code' (emails the buyer a REAL six-digit code to prove they control the purchase " +
    "mailbox), 'verify_code' (judge the code the buyer reads back; 5 attempts per issued code), 'set_password' " +
    "(attach the password — provisions the users row through the same provisionProspectAccount the consent flow " +
    "uses when no earlier step created one — completing the account). Every server-side gate applies verbatim: " +
    "paid+unexpired session only, verified-address-must-still-match, and a repeat buyer's existing password is " +
    "NEVER overwritten (409 already_set — /auth/forgot-password is that door). Refusals surface the route's real " +
    "error codes (session_invalid, session_expired, payment_required, email_missing, no_code_issued, " +
    "code_expired, code_incorrect, too_many_attempts, email_not_verified, already_set). set_password's returned " +
    "portalUrl has the single-use auto-login signupToken stripped (it bypasses MFA; the buyer signs in with " +
    "their new credentials instead). MFA enrollment is NOT this tool — it happens in Buy.tsx or in the portal " +
    "after first sign-in.",
  inputSchema,
  audit: {
    access: "write",
    entityType: "checkout_session",
    entityIdArg: "sessionId",
    redactParams: ["code", "password"],
  },
  handler: async (raw) => {
    const { action, sessionId, code, password } = raw as {
      action: "status" | "send_verification_code" | "verify_code" | "set_password";
      sessionId: string;
      code?: string;
      password?: string;
    };

    switch (action) {
      case "status": {
        const status = await apiFetch<AccountStatusResponse>("/public/purchase/account-status", {
          query: { sessionId },
        });
        return { action, ...status };
      }

      case "send_verification_code": {
        const sent = await apiFetch<SendCodeResponse>("/public/purchase/send-verification-code", {
          method: "POST",
          body: { sessionId },
        });
        log.info(
          { sessionId, expiresAt: sent.expiresAt },
          "create_account: six-digit code emailed to the buyer's mailbox",
        );
        return {
          action,
          ...sent,
          note: "A real code was emailed to the buyer's own mailbox — only the buyer can read it back for verify_code.",
        };
      }

      case "verify_code": {
        if (!code) {
          throw new Error("code is required for action 'verify_code' — the six digits from the buyer's email");
        }
        const verified = await apiFetch<VerifyCodeResponse>("/public/purchase/verify-code", {
          method: "POST",
          body: { sessionId, code },
        });
        log.info({ sessionId }, "create_account: buyer's email address proven");
        return { action, ...verified };
      }

      case "set_password": {
        if (!password) {
          throw new Error("password is required for action 'set_password' (min 8 characters)");
        }
        const completed = await apiFetch<SetPasswordResponse>("/public/purchase/set-password", {
          method: "POST",
          body: { sessionId, password },
        });
        log.info(
          { sessionId, accountProvisioned: completed.accountProvisioned },
          "create_account: account completed through the real purchase flow",
        );
        return {
          action,
          ok: completed.ok,
          email: completed.email,
          accountProvisioned: completed.accountProvisioned,
          portalUrl: stripSignupToken(completed.portalUrl),
          signupTokenWithheld: true,
        };
      }
    }
  },
};
