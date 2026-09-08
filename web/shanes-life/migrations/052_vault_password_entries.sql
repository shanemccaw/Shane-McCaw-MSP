-- The full password vault (Git #3242): the narrow bill-payment reference vault from 017 becomes
-- a real, general password manager -- every real login, not just "which website + which account
-- number". This is the schema half; src/core/vault.mjs owns the crypto and the audit write.
--
-- Additive only, and deliberately so: every existing 017 row IS still a real bill-payment
-- reference, so `kind` defaults to 'bill_reference' and the entries Shane already has keep
-- working, keep their masks, and keep their bill-account links untouched. A login is a second
-- KIND of row in the same table, not a second table -- one vault, one encryption key, one audit
-- trail, one reveal path. Two tables would have meant two of each, and the second copy of a
-- security control is the one that rots.
--
--   kind              'bill_reference' (017's rows) or 'login' (a real site/username/password).
--   username          The real login name. NOT encrypted, on purpose: it has to be listable,
--                     searchable and copyable without spending a passkey assertion, which is
--                     exactly how LastPass behaves too. The password is the secret; the username
--                     is the label on the drawer.
--   notes_*           Optional free text, encrypted with the SAME AES-256-GCM key as the secret
--                     but its own iv/tag and its own AAD suffix -- recovery codes and security
--                     answers end up here, and they are every bit as sensitive as the password.
--                     All three columns are written together or not at all (the check below).
--   secret_updated_at When the PASSWORD itself last changed, as distinct from updated_at, which
--                     also moves when a row is merely renamed. Password age is a real signal a
--                     password manager owes its owner; updated_at cannot answer it.

ALTER TABLE vault ADD COLUMN IF NOT EXISTS kind              text NOT NULL DEFAULT 'bill_reference';
ALTER TABLE vault ADD COLUMN IF NOT EXISTS username          text;
ALTER TABLE vault ADD COLUMN IF NOT EXISTS notes_ciphertext  bytea;
ALTER TABLE vault ADD COLUMN IF NOT EXISTS notes_iv          bytea;
ALTER TABLE vault ADD COLUMN IF NOT EXISTS notes_auth_tag    bytea;
ALTER TABLE vault ADD COLUMN IF NOT EXISTS secret_updated_at timestamptz NOT NULL DEFAULT now();

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, and this migration has to stay a safe no-op on
-- re-run like every other one in this directory.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vault_kind_check') THEN
        ALTER TABLE vault ADD CONSTRAINT vault_kind_check
            CHECK (kind IN ('bill_reference', 'login'));
    END IF;

    -- A half-written notes triple would decrypt to a crash rather than to notes. The database
    -- refuses to hold one at all, so no code path has to defend against it.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vault_notes_triple_check') THEN
        ALTER TABLE vault ADD CONSTRAINT vault_notes_triple_check
            CHECK (num_nonnulls(notes_ciphertext, notes_iv, notes_auth_tag) IN (0, 3));
    END IF;
END $$;

-- The room's real default read is "this user's entries, this kind, in order"; search is an ILIKE
-- over label/site/username on top of that. At one person's real vault size the index that matters
-- is the one that gets the user's rows out, not one per searchable column.
CREATE INDEX IF NOT EXISTS vault_user_kind_idx ON vault (user_id, kind, position, created_at);
