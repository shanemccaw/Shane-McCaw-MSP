-- Bearer tokens for the lightweight /widget page (Git #3188).
--
-- A third-party iOS "Widget Web" app (Villy21/JsWidget, same lineage as "Widget Web 26") loads
-- this page in its own WKWebView to screenshot it for the Home Screen. That WKWebView does not
-- share Safari's session, and passkeys/WebAuthn cannot run inside it at all -- so the widget
-- cannot reuse sl_session the way the real signed-in app does. This is the same problem
-- mcp_tokens (013_shanes_life_foundation.sql) already solved for a different headless client
-- (Claude via MCP), and this table copies that shape exactly: a high-entropy value handed out
-- once, only its SHA-256 stored, scoped to exactly one user, revocable.
--
-- No call_count here (unlike mcp_tokens) -- a widget refreshes on a plain timer/manual tap, and
-- counting those calls answers nothing useful the way "which Claude conversation wrote this" does
-- for MCP. last_used_at alone is enough to show "last loaded ...".

CREATE TABLE IF NOT EXISTS widget_tokens (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   text        NOT NULL UNIQUE,
    label        text        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS widget_tokens_user_idx ON widget_tokens (user_id, created_at DESC);
