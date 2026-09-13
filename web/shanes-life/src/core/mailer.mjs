// Minimal, dependency-free Microsoft Graph mail sender.
//
// CLAUDE.md, "Email": "Shane does not use Resend, ever, for any reason. All outgoing platform
// email goes exclusively through Exchange Online / Microsoft Graph." This is that path, written
// against this app's own philosophy from src/auth/webauthn.mjs's header: one runtime dependency
// (pg) on purpose, so a plain client-credentials token request + a POST to /sendMail is cheaper
// than adding an SDK for the one email this app ever sends -- account-recovery codes (Git #3246).
//
// Absent credentials are a real, reportable state, not a crash -- the same convention
// config.mjs already uses for Plaid/Tesla. A caller that needs to mint recovery codes still gets
// its real result (the codes themselves) even when mail delivery is not configured; it is just
// told, honestly, that nothing went out.

import { config } from "../config.mjs";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export class MailerNotConfigured extends Error {
  constructor(message) {
    super(message);
    this.name = "MailerNotConfigured";
  }
}

export function mailerConfigured() {
  return Boolean(
    config.graphTenantId && config.graphClientId && config.graphClientSecret && config.graphSenderUserId,
  );
}

let tokenCache = null;

async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;

  const res = await fetch(`https://login.microsoftonline.com/${config.graphTenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.graphClientId,
      client_secret: config.graphClientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3000) * 1000,
  };
  return tokenCache.token;
}

/**
 * Send a plain-text email as the configured sender mailbox. Throws MailerNotConfigured when
 * SL_GRAPH_* is not set -- the caller decides whether that is fatal for its own flow.
 */
export async function sendMail({ to, subject, text }) {
  if (!mailerConfigured()) {
    throw new MailerNotConfigured(
      "SL_GRAPH_TENANT_ID / SL_GRAPH_CLIENT_ID / SL_GRAPH_CLIENT_SECRET / SL_GRAPH_SENDER_USER_ID " +
        "are not all set -- Exchange Online mail delivery is not configured.",
    );
  }
  const token = await getAccessToken();
  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(config.graphSenderUserId)}/sendMail`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "Text", content: text },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok && res.status !== 202) {
    const errText = await res.text();
    throw new Error(`Graph sendMail failed (${res.status}): ${errText.slice(0, 300)}`);
  }
}
