-- Important documents -- wills, life insurance, and the like (Git #3244, sub-issue of #3234
-- Feature: Money -- Core & Room Tabs).
--
-- Shane's own two real examples plus an explicit signal this is a genuinely open-ended category
-- ("all the things"), not a fixed two-item list -- doc_type is free text, not an enum, so a
-- property deed or a power of attorney needs no schema change to be added.
--
-- The issue's own open question ("does this live inside Vault, or as its own room/section?")
-- is answered here as: its own room (a distinct content type from vault.mjs's bill-payment
-- references -- these are documents/policies, not credentials), but reusing the SAME real
-- security tier as the vault per the issue's own explicit lean ("lean toward the same real
-- security model as Vault rather than a lighter one"): AES-256-GCM at rest under the SAME
-- SL_VAULT_KEY (no second key to provision/rotate), a fresh passkey assertion per reveal, and a
-- real per-reveal audit row -- see important_document_reveals below, the same shape as
-- vault_reveals (migration 017).
--
-- What is NOT encrypted, on purpose: doc_type, name and location. The issue's own real search
-- requirement ("where's my will" answered directly from stored data) has to be answerable
-- without a passkey prompt on every keystroke, and "safe deposit box at NFCU" / "filing cabinet,
-- home office" is exactly the kind of answer a search should return immediately -- the genuinely
-- sensitive content (policy numbers, beneficiaries, executor names, SSN card whereabouts, will
-- contents) lives only in the encrypted `details` blob, same reveal-gated shape as the vault's
-- secret. summary_hint is the vault's `masked` idiom carried over: a real, human-written glance
-- line ("Northwestern Mutual -- policy on file") shown in the list without a reveal.

CREATE TABLE IF NOT EXISTS important_documents (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_type     text        NOT NULL,
    name         text        NOT NULL,
    location     text,
    summary_hint text,
    ciphertext   bytea       NOT NULL,
    iv           bytea       NOT NULL,
    auth_tag     bytea       NOT NULL,
    key_id       text        NOT NULL DEFAULT 'v1',
    position     integer     NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS important_documents_user_idx ON important_documents (user_id, position, created_at);

-- Real search target (item 2 of the issue's scope): case-insensitive substring over the doc's
-- own real type/name/location, the same deterministic idiom things.mjs's findThing/searchThings
-- already use -- no AI call, no encrypted-content match.
CREATE INDEX IF NOT EXISTS important_documents_search_idx
  ON important_documents (user_id, lower(doc_type), lower(name));

CREATE TABLE IF NOT EXISTS important_document_reveals (
    id            bigserial PRIMARY KEY,
    document_id   uuid        NOT NULL REFERENCES important_documents(id) ON DELETE CASCADE,
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at            timestamptz NOT NULL DEFAULT now(),
    credential_id text,
    ip            text,
    user_agent    text
);

CREATE INDEX IF NOT EXISTS important_document_reveals_document_idx
  ON important_document_reveals (document_id, at DESC);
