-- Shane's Life -- Wins, the smoking line, Catches, the Vault and Cars (Git #3107).
--
-- Design/design_handoff_shanes_life/README.md, "Data model additions":
--   wins(when, text, source);  smoke_log(at, packs, amount);  catches(kind, text, dismissed_at)
--   vault(id, label, site, masked, ciphertext)
--   vehicles(name, loan_bill_id, insurance_amount, registration_due, registration_amount,
--            maintenance_interval_miles)
--
-- This is the migration where "one app, one login, one Postgres" stops being a slogan:
-- vehicles.loan_bill_id is a REAL foreign key into ShanesSurvival's own accounts table, so the
-- Cars tab's "all-in $/mo" reads the same real Plaid-synced bill account the WPF app does,
-- rather than a copied number that drifts. ON DELETE SET NULL, deliberately -- ShanesSurvival
-- must never find a delete of its own refused by a table it has never heard of. (Checked first:
-- nothing in desktop/ShanesSurvival/ issues a DELETE, TRUNCATE or DROP against accounts.)
--
-- On `when` and `at`: both are SQL keywords, so wins uses `happened_on` and smoke_log uses
-- `logged_at`. Everything else keeps the design's own name.

-- "I did it, ..." captures land here; a debt hitting $0 lands here automatically. Real
-- milestones only -- Section "No guilt": no streaks, no badges, no completion percentages.
CREATE TABLE IF NOT EXISTS wins (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    happened_on date        NOT NULL DEFAULT current_date,   -- design: `when`
    text        text        NOT NULL,
    source      text        NOT NULL DEFAULT 'shane',        -- shane | claude | debt_paid_off
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wins_user_idx ON wins (user_id, happened_on DESC);

-- `smoked` / `bought a pack` -> +1 pack, +$8.40. The one deliberate exception to "no guilt":
-- the Money screen's red-tinted "Cigarettes, in plain numbers" card confronts with actual spend
-- against actual shortfall, and it is shown only while the shortfall is above zero.
CREATE TABLE IF NOT EXISTS smoke_log (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    logged_at  timestamptz NOT NULL DEFAULT now(),            -- design: `at`
    packs      numeric(6,2) NOT NULL DEFAULT 1,
    amount     numeric(12,2) NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS smoke_log_user_idx ON smoke_log (user_id, logged_at DESC);

-- Renewal watch, Forgotten money, Duplicate request, Borrowed from a bill, Bulk buy.
-- "Got it" sets dismissed_at; it never deletes, so the same catch is not raised twice.
CREATE TABLE IF NOT EXISTS catches (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         text        NOT NULL,
    text         text        NOT NULL,
    detail       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    dismissed_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catches_user_open_idx ON catches (user_id, created_at DESC) WHERE dismissed_at IS NULL;

-- The bill-payment reference vault. The design calls this "a stated security requirement, not
-- polish", so all four halves of it are real here:
--   * AES-256-GCM at rest -- ciphertext + iv + auth_tag, never a plaintext column;
--   * the key lives OUTSIDE the database (SL_VAULT_KEY in the environment), so a database dump
--     on its own decrypts nothing;
--   * a fresh passkey assertion per reveal -- sessions.last_verified_at (013) is what "fresh"
--     is measured against;
--   * an audit row per reveal -- vault_reveals below, not a log line that can be lost.
-- masked is the only thing ever rendered without a reveal.
CREATE TABLE IF NOT EXISTS vault (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label      text        NOT NULL,
    site       text,
    masked     text        NOT NULL,
    ciphertext bytea       NOT NULL,
    iv         bytea       NOT NULL,
    auth_tag   bytea       NOT NULL,
    key_id     text        NOT NULL DEFAULT 'v1',   -- which key encrypted it, so it can be rotated
    position   integer     NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vault_user_idx ON vault (user_id, position, created_at);

CREATE TABLE IF NOT EXISTS vault_reveals (
    id            bigserial PRIMARY KEY,
    vault_id      uuid        NOT NULL REFERENCES vault(id) ON DELETE CASCADE,
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at            timestamptz NOT NULL DEFAULT now(),
    credential_id text,                              -- the passkey that actually authorised it
    ip            text,
    user_agent    text
);

CREATE INDEX IF NOT EXISTS vault_reveals_vault_idx ON vault_reveals (vault_id, at DESC);

-- Money -> Cars. One card per vehicle; all-in $/mo is computed from the linked real bill
-- account plus insurance and amortised registration, never stored as a literal.
CREATE TABLE IF NOT EXISTS vehicles (
    id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                       text        NOT NULL,
    -- ShanesSurvival's own accounts(id). This is the shared-database payoff.
    loan_bill_id               uuid REFERENCES accounts(id) ON DELETE SET NULL,
    insurance_amount           numeric(12,2),
    registration_due           date,
    registration_amount        numeric(12,2),
    maintenance_interval_miles integer,
    next_maintenance_on        date,
    next_maintenance_note      text,
    position                   integer     NOT NULL DEFAULT 0,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicles_user_idx ON vehicles (user_id, position, name);
CREATE INDEX IF NOT EXISTS vehicles_loan_bill_idx ON vehicles (loan_bill_id) WHERE loan_bill_id IS NOT NULL;
