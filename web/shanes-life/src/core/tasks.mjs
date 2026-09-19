// Tasks room -- Git #4864. A real one-time to-do: open or done, optionally with a due date.
// Deliberately separate from dates.mjs (appointment-shaped, recurring, per-kind lead times).
// Table is migration 076.

import { many, one } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";

const STATUSES = new Set(["open", "done"]);

// `date` columns come back from pg as a local-midnight JS Date; format in SQL so the wire value
// is always the plain YYYY-MM-DD that was stored.
const COLUMNS = `id, title, notes, to_char(due_date, 'YYYY-MM-DD') AS due_date,
                 status, completed_at, created_at`;

function coerceDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw badRequest(`${field} is not a valid date (YYYY-MM-DD): ${value}`);
  }
  return s;
}

/** Create one open task. Only `title` is required. */
export async function createTask(userId, { title, dueDate = null, notes = null } = {}) {
  const trimmed = String(title ?? "").trim();
  if (!trimmed) throw badRequest("title is required");
  if (trimmed.length > 500) throw badRequest("title is too long (500 char limit)");
  const trimmedNotes = notes === null || notes === undefined ? null : String(notes).trim() || null;

  return one(
    `INSERT INTO tasks (user_id, title, notes, due_date)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [userId, trimmed, trimmedNotes, coerceDate(dueDate, "dueDate")],
  );
}

/**
 * Real tasks, filtered by status (default open only) and optionally due on/before a date.
 * Open tasks sort soonest-due first, undated last; done tasks sort most recently completed first.
 */
export async function listTasks(userId, { status = "open", dueBefore = null } = {}) {
  if (!STATUSES.has(status)) throw badRequest("status must be one of: open, done");
  const before = coerceDate(dueBefore, "dueBefore");

  return many(
    `SELECT ${COLUMNS}
       FROM tasks
      WHERE user_id = $1
        AND status = $2
        AND ($3::date IS NULL OR due_date <= $3::date)
      ORDER BY CASE WHEN status = 'done' THEN NULL ELSE due_date END ASC NULLS LAST,
               completed_at DESC NULLS LAST,
               created_at ASC`,
    [userId, status, before],
  );
}

/** Mark one task done. Idempotent: completing a done task returns it unchanged. */
export async function completeTask(userId, taskId) {
  const row = await one(
    `UPDATE tasks
        SET status = 'done', completed_at = COALESCE(completed_at, now())
      WHERE id = $1 AND user_id = $2
      RETURNING ${COLUMNS}`,
    [taskId, userId],
  ).catch((err) => {
    // A malformed id is "no such task", not a server error.
    if (err?.code === "22P02") return null;
    throw err;
  });
  if (!row) throw notFound(`No task ${taskId}`);
  return row;
}
