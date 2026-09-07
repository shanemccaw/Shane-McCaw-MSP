// Real audit trail. MCP is a write plane reachable from any Claude conversation and share links
// are a write plane reachable by anyone holding a URL -- both get recorded from day one, so
// "where did this row come from" always has an answer.

import { query } from "../db.mjs";

export async function record({ userId, actor, actorLabel = null, action, entityId = null, detail = {} }) {
  await query(
    `INSERT INTO activity_log (user_id, actor, actor_label, action, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [userId ?? null, actor, actorLabel, action, entityId, JSON.stringify(detail ?? {})],
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
