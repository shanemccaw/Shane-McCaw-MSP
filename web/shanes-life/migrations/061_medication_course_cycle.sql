-- Real cyclical/course medication tracking (Git #3267, sub-issue of #3226's Meds Feature).
--
-- Real, confirmed gap: `medications` had no way to represent a real cyclical course --
-- Terbinafine is a real 15-days-on-then-dormant-for-a-repeating-cycle medication, and the
-- existing model (a static morning/night/as-needed batch assignment) can only ever be
-- always-in-a-batch or always-as-needed. Neither is correct for a course.
--
-- Three new columns, all nullable -- an ordinary daily/as-needed medication leaves all three
-- null and behaves exactly as before. Only a real course medication sets them:
--   * course_start_date    -- the day the current/most recent course actually began.
--   * course_active_days   -- how many days into the cycle it's actually taken (Terbinafine: 15).
--   * course_cycle_days    -- the real full cycle length (active + dormant) before it repeats.
--
-- getMedsToday (src/core/medications.mjs) computes "days since course_start_date, modulo
-- course_cycle_days" and only includes the medication in its assigned batch's items when that
-- falls inside [0, course_active_days) -- otherwise it's dormant and simply doesn't appear in
-- today's tray, no separate paused UI needed (issue's own real scope item 4).
--
-- CHECK constraints: all three null together (not a course) or all three set together (a real
-- course) -- a half-set course is neither "not a course" nor computable, so it's rejected rather
-- than silently defaulting to always-active or always-dormant. active_days must be > 0 and <=
-- cycle_days -- an active window longer than its own cycle is not a real cycle.

ALTER TABLE medications ADD COLUMN IF NOT EXISTS course_start_date date;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS course_active_days integer;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS course_cycle_days integer;

ALTER TABLE medications DROP CONSTRAINT IF EXISTS medications_course_all_or_none;
ALTER TABLE medications ADD CONSTRAINT medications_course_all_or_none CHECK (
    (course_start_date IS NULL AND course_active_days IS NULL AND course_cycle_days IS NULL)
    OR (course_start_date IS NOT NULL AND course_active_days IS NOT NULL AND course_cycle_days IS NOT NULL)
);

ALTER TABLE medications DROP CONSTRAINT IF EXISTS medications_course_days_positive;
ALTER TABLE medications ADD CONSTRAINT medications_course_days_positive CHECK (
    course_active_days IS NULL OR (course_active_days > 0 AND course_cycle_days > 0 AND course_active_days <= course_cycle_days)
);
