-- ShanesSurvival — transaction tagging rules (#2931)
-- Real gap found live 2026-09-04: spend_bleed groups by real Plaid merchant name only, so a
-- round-number cash withdrawal disguised as a "7-Eleven" purchase (Ronnie's medical marijuana,
-- legally cash-only since federal banking law won't touch it even where state-legal) showed up
-- indistinguishable from an actual small snack run. Shane's prior budgeting app had a real
-- `transactionRules` concept for exactly this — matching patterns to a real meaning — that
-- ShanesSurvival never built until now.
--
-- transaction_tags: a real rule matching a merchant substring (case-insensitive) plus an
-- optional real amount range, mapped to a real human meaning (tag). No regex, no generic rule
-- engine — this only needs to handle "7-Eleven, $100 or more" cleanly.
--
-- Applied automatically by MigrationRunner (see README.md) — no manual psql step needed for the
-- WPF app. Run once, by hand, against the real local `finances` DB as part of this build's own
-- verification (see build-journal/2931.md).

BEGIN;

CREATE TABLE IF NOT EXISTS transaction_tags (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_pattern TEXT NOT NULL,
    min_amount       NUMERIC(14,2),
    max_amount       NUMERIC(14,2),
    tag              TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
