-- Settings redesign (Git #3214): the real Home Screen widget usage signal the design calls
-- for -- "real per-token screenshot count + 'last N minutes ago'" -- how often the widget app
-- has actually rendered the page.
--
-- 046_widget_tokens.sql deliberately left this out ("a widget refreshes on a plain timer/manual
-- tap, and counting those calls answers nothing useful the way 'which Claude conversation wrote
-- this' does for MCP"). The real design screenshot (v4-settings-claude-widget.png) supersedes
-- that call: it shows "412 screenshots · last 8 minutes ago" as a genuine, real usage signal --
-- proof the widget app is actually alive and rendering, not just that a link was minted once and
-- never loaded again. Same shape as mcp_tokens.call_count, bumped once per real /widget/t/:token
-- render (see resolveWidgetToken in src/core/widget-tokens.mjs).

ALTER TABLE widget_tokens ADD COLUMN IF NOT EXISTS screenshot_count integer NOT NULL DEFAULT 0;
