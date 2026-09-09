-- Real Apple Health bridge via Shortcuts automation (Git #3322, Feature #3220): oxygen (SpO2)
-- and heart-rate readings, so they can eventually correlate against #3321's medication usage log
-- and other real logged events.
--
-- Real, confirmed platform constraint (issue body): HealthKit is exclusively a native iOS
-- framework -- no web app/PWA (which shanes-life is) can read it directly. The real, viable
-- bridge is Apple's own Shortcuts app, which CAN read HealthKit and make real HTTP requests: a
-- Shortcuts automation posts a real reading to this app's own ingestion endpoint.
--
-- health_metric_hook_tokens: the real bearer credential a Shortcuts automation authenticates
-- with. Same real shape as widget_tokens (migration 046) and tesla_hook_tokens (migration 055,
-- itself already built for exactly this "iOS Shortcuts automation posts to a webhook" case) --
-- high-entropy value handed out once, only its SHA-256 stored, scoped to one user, revocable.
CREATE TABLE IF NOT EXISTS health_metric_hook_tokens (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   text        NOT NULL UNIQUE,
    label        text        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS health_metric_hook_tokens_user_idx ON health_metric_hook_tokens (user_id, created_at DESC);

-- health_metrics: the real readings themselves. metric_type is a real, closed vocabulary (issue
-- body names exactly these two) rather than free text, the same "real vocabularies only"
-- discipline this project already applies everywhere else. recorded_at is the real moment
-- HealthKit itself timestamped the sample (set by the Shortcut from the HealthKit sample it
-- read), distinct from created_at (when this row was actually written, which can lag behind a
-- delayed/batched Shortcuts run).
CREATE TABLE IF NOT EXISTS health_metrics (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metric_type  text        NOT NULL CHECK (metric_type IN ('spo2', 'heart_rate')),
    value        numeric     NOT NULL,
    recorded_at  timestamptz NOT NULL,
    source       text        NOT NULL DEFAULT 'shortcuts',
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- The real read pattern (Settings -> Connected recent-readings list, and the future #3321
-- correlation view): most recent readings for a user, optionally filtered to one metric type.
CREATE INDEX IF NOT EXISTS health_metrics_user_recorded_idx ON health_metrics (user_id, recorded_at DESC);
