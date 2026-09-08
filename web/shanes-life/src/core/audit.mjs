// Real audit trail. MCP is a write plane reachable from any Claude conversation and share links
// are a write plane reachable by anyone holding a URL -- both get recorded from day one, so
// "where did this row come from" always has an answer.

import { query } from "../db.mjs";
import { currentToolName } from "../mcp/tool-context.mjs";

export async function record({ userId, actor, actorLabel = null, action, entityId = null, detail = {} }) {
  // The real MCP tool name a Claude conversation actually called (e.g. "set_medication"), read
  // back automatically from protocol.mjs's dispatch context (Git #3214) -- Recent activity's own
  // "what Claude wrote" transparency reads this, not the internal `action` string, which is a
  // different, older vocabulary. Never overwrites a `detail.tool` a caller set explicitly.
  const tool = actor === "mcp" ? currentToolName() : null;
  const enrichedDetail = tool && detail && detail.tool === undefined ? { tool, ...detail } : detail;
  await query(
    `INSERT INTO activity_log (user_id, actor, actor_label, action, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [userId ?? null, actor, actorLabel, action, entityId, JSON.stringify(enrichedDetail ?? {})],
  );
}

export async function recent(userId, limit = 50) {
  const { rows } = await query(
    `SELECT at, actor, actor_label, action, entity_id, detail
       FROM activity_log
      WHERE user_id = $1
      ORDER BY at DESC
      LIMIT $2`,
    [userId, Math.min(Number(limit) || 50, 200)],
  );
  return rows;
}

/**
 * The real, scoped feed a share page's live activity line polls (Git #3186's decision: "a real
 * 'activity' feed must show only events on THIS list, never a general account-activity stream").
 * Filtered on entity_id (a real, unique id -- a list's or entity's own) AND user_id (defense in
 * depth, since entity_id is already unique), and on a real action allowlist so this can never
 * widen into a general per-user feed just because a new action string gets added elsewhere.
 * `afterId` (bigserial, so strictly increasing) lets a poller ask for only what's new since its
 * last real render instead of re-diffing the whole page every tick.
 */
export async function recentForEntity(userId, entityId, { limit = 10, afterId = null } = {}) {
  const params = [userId, entityId];
  let cursor = "";
  if (afterId) {
    params.push(afterId);
    cursor = `AND id > $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 10, 50));
  const { rows } = await query(
    `SELECT id, at, actor, actor_label, action, detail
       FROM activity_log
      WHERE user_id = $1 AND entity_id = $2
        AND action IN ('list.item.check', 'list.item.add', 'entity.item.check', 'entity.item.add')
        ${cursor}
      ORDER BY id DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}
