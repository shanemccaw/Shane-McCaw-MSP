-- Tasks room (Git #4864, sub-issue of #3086's Shane's Life epic).
--
-- Real, confirmed gap this closes: there was no dedicated to-do primitive. A genuine task
-- ("call bankruptcy attorney candidates Monday 9/21") landed as inert text inside capture().
-- A Task is deliberately NOT a Date (014): dates are appointment-shaped, often recurring, with
-- per-kind lead times. A task is a one-time to-do -- open or done, optionally with a due date --
-- so it gets its own table rather than borrowing dates' recurrence/lead-time model.
--
-- `notes` carries the full free-text detail so nothing is lost to a short title. `completed_at`
-- is set once by complete_task and never rewritten (completing is idempotent).
CREATE TABLE IF NOT EXISTS tasks (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        text        NOT NULL,
    notes        text,
    due_date     date,
    status       text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    completed_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_user_status_due_idx
    ON tasks (user_id, status, due_date);
