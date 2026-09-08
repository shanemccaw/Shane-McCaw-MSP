// The real, public Tesla surfaces (Git #3158): the inbound climate-preconditioning webhook and
// the vehicle-pairing well-known public key. Both are authenticated by their own bearer
// token/environment value, never by the session cookie -- so both are wired in server.mjs
// alongside /mcp, /widget and the Plaid webhook, the same "different auth model, sits above the
// session branch" reasoning plaid-webhook.mjs's own header already gives.
//
// Everything session-gated (OAuth start/callback, connection status, vehicle selection, hook
// token CRUD) lives in routes/api.mjs instead, the same split Plaid uses: its raw webhook
// receiver gets a dedicated file, its other real routes live in the normal signed-in API.

import { HttpError, readBody, sendJson, sendText } from "../http.mjs";
import { recordHookEvent, TeslaError } from "../core/tesla.mjs";
import { config } from "../config.mjs";

const MAX_HOOK_BYTES = 50_000;

/**
 * POST /hooks/tesla/:token -- a real external trigger (an iOS Shortcuts automation, an IFTTT
 * applet, Home Assistant) observed real climate preconditioning start and is telling this app so.
 * The body is optional and never trusted for anything beyond an audit record -- the token in the
 * path IS the authorization, same shape as /widget/t/:token.
 */
export async function handleTeslaHook(req, res, token, { log }) {
  let payload = {};
  try {
    const buf = await readBody(req, MAX_HOOK_BYTES);
    if (buf.length > 0) {
      const parsed = JSON.parse(buf.toString("utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed;
    }
  } catch {
    // A non-JSON or missing body is fine -- the token alone is a real, complete signal
    // ("preconditioning started"); a body just adds optional context for the audit row.
  }

  try {
    const result = await recordHookEvent(token, payload);
    log?.(`[tesla] hook received -> ${result.queued ? "nudge queued" : `not queued (${result.reason})`}`);
    return sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof TeslaError) throw new HttpError(err.status || 400, err.message);
    throw err;
  }
}

/**
 * GET /.well-known/appspecific/com.tesla.3p.public-key.pem -- Tesla's real vehicle-pairing flow
 * fetches this from the deployed domain before a virtual key can be paired. Public by definition
 * (it is, after all, a PUBLIC key) and requires no auth at all.
 *
 * This has to be special-cased ahead of server.mjs's blanket `.well-known` 404 -- that 404 is a
 * deliberate, real fix (Git #3158 found it while wiring this route) for an unrelated MCP OAuth-
 * discovery-probe bug, and without an explicit exception here Tesla's own pairing fetch would
 * silently 404 against it.
 */
export function serveTeslaPublicKey(res) {
  if (!config.teslaPublicKey) {
    return sendText(res, 404, "Tesla is not configured on this server.");
  }
  return sendText(res, 200, config.teslaPublicKey, "application/x-pem-file; charset=utf-8");
}
