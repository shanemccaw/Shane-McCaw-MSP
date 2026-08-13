-- Git #558 — Identifier hygiene applies to ALL visible text, not just the
-- flight-log finding-entry tag.
--
-- Manual migration — review and run by hand (do not run drizzle-kit push /
-- push --force). No DATABASE_URL in this environment; NOT run here.
--
-- ── WHAT WENT WRONG ──────────────────────────────────────────────────────────
-- Confirmed live (2026-08-08) on a freshly generated `governance_maturity_report`
-- (the rendered document is captured in docs/something.json). Raw internal
-- identifiers — both check keys AND raw extracted-property field names — appear
-- pervasively throughout the document's narrative prose. Every "Domain" section
-- does it, and so does the Required Actions table. Real lines from that document:
--
--   "The governance:ownerless-groups check returned ownerlessGroupCount: 26 out
--    of 104 total groups."
--   "identity:b2b-collaboration-settings returned allowInvitesFrom: everyone and
--    guestInviteRestriction: everyone."
--   "governance:dynamic-group-usage shows dynamicGroupCount: 0 and
--    membershipRule_count: 0 across all 104 groups."
--   "teams:meeting-policy-coverage returned meetingPolicyAssignedCount: 18 and
--    teams:messaging-policy-coverage returned messagingPolicyAssignedCount: 18."
--   "sharepoint:inactive-sites identified 99 sites but returned
--    inactiveSiteCount: 0 and lastModifiedDateTime_count: 0."
--   "m365:message-center returned _itemCount: 440 total items, of which
--    majorChangeCount: 108."
--
-- The underlying data and every number in them are genuinely correct. This is a
-- PRESENTATION defect, not a data defect: the model is transcribing the shape of
-- its input instead of writing customer-facing prose from it.
--
-- ── WHY THE EARLIER FIXES DID NOT COVER THIS ─────────────────────────────────
-- #554 and #557 both narrowed in on the finding-entry surface specifically —
-- the check key used as a HEADING (#554) and the model inventing a "check:" /
-- "Source:" label to introduce one (#557), both in code, in
-- FINDING_IDENTIFIER_HONESTY_RULE. The earlier `insights-document-style` edit
-- was likewise scoped to the flight-log finding-entry TAG (the small mono
-- identifier under each finding card).
--
-- None of those reach free-form narrative writing elsewhere in a document:
-- section introductions, per-domain "Current State" prose, or action-table body
-- cells, where the model is composing sentences directly from {{profileSample}}
-- and {{findings}} rather than filling in a structured tag.
-- `governance_maturity_report` writes almost entirely in that narrative style
-- (unlike `copilot_readiness`'s structured finding cards), which is why the gap
-- survived this session's earlier testing.
--
-- ── WHY THIS IS AN APPEND, NOT A REPLACE ─────────────────────────────────────
-- The live `insights-document-style` body is NOT in this repo. Row 1 of
-- 2026-08-06-document-generation-ai-prompts.sql was deliberately committed
-- COMMENTED OUT for exactly this reason: the approved style_prompt.txt (the
-- flight-readiness-review dual-theme system) exists nowhere in the repo, in git
-- history, or in any scratchpad, and this key is prepended to EVERY generated
-- document by prompt-loader.ts's getDocumentStylePrefix(). A
-- `SET prompt_body = <full body>` here would silently overwrite an approved
-- style guide — including the whole theme system and the earlier
-- finding-entry-tag rule — with a guess.
--
-- So this file APPENDS one block to whatever is live, and appends it
-- IDEMPOTENTLY: the CASE guards on the block's own marker line, so re-running
-- this file is a no-op rather than a second copy of the rule. `default_body`
-- gets the same append (and is left alone when NULL) so a "Reset to default" in
-- the AI Prompts admin UI cannot silently revert the fix.
--
-- The block is appended at the END of the body on purpose: it is the last thing
-- the model reads before the document prompt itself, and it must override the
-- narrower earlier tag-scoped statement, which it says explicitly.
--
-- ── SCOPE ─────────────────────────────────────────────────────────────────────
-- One row. `insights-document-style` is prepended to every AI-generated client
-- document (all 9 document types via document-engine.ts, plus the SOW path via
-- document-engine-sow.ts), so a single append is the whole fix — there is no
-- per-document-type edit here and none is wanted. Stating the rule by SHAPE
-- rather than by a list of already-observed strings is what makes it cover
-- identifiers not yet seen leaking.
--
-- ── THE ONE THING THIS MUST NOT DO ───────────────────────────────────────────
-- Make the output vague. The rule bans internal NAMES, never the values they
-- carry: "26 of the tenant's 104 groups have no owner" and "guest invitations
-- are open to everyone" must both still be written, in full. The block below
-- says so twice — once positively (every number still gets stated) and once as
-- an explicit failure mode ("vagueness is a worse failure than the leak") — and
-- its worked rewrites are annotated with what survives each one.
--
-- ── VERIFICATION ──────────────────────────────────────────────────────────────
-- artifacts/api-server/src/lib/document-style-identifier-hygiene-558.test.ts
-- READS THIS FILE, extracts the dollar-quoted block below, asserts its
-- scope/pattern/preservation clauses, and then drives generateDocument()'s
-- dry-run branch with the REAL prompt-loader over a simulated post-migration
-- ai_prompts row — asserting the block reaches the assembled style prefix for
-- governance_maturity_report and for other document types alike. If this file
-- and that suite ever diverge, the suite fails. No live model call is available
-- in this environment; a fresh live regeneration is Shane's to run.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

WITH block AS (
  SELECT
    'IDENTIFIER HYGIENE'::text AS marker,
    $idhyg$
IDENTIFIER HYGIENE — INTERNAL NAMES NEVER APPEAR IN VISIBLE TEXT

This rule governs EVERY document type and EVERY part of a document. It replaces
and supersedes any narrower statement above that applied only to the flight-log
finding-entry tag: that scoping was too narrow. The rule below is not about one
tag, one card, or one section. It is about all visible text.

WHERE THIS APPLIES
Everywhere a reader can see words: the executive summary, "Current State" and
other narrative prose, domain and section introductions, finding titles,
headings and subheadings, body paragraphs, every cell of every table including
the required/recommended actions table, metric tiles and their captions,
callouts, figure labels, footers, and the finding-entry tag. There is no
section of any document in which an internal identifier is acceptable.

WHAT IS FORBIDDEN — RECOGNISE IT BY SHAPE, NOT FROM A LIST
Two syntactic shapes mark a name as internal. Judge by the shape itself, so
that this rule covers identifiers you have never seen before exactly as it
covers ones you have. The examples below illustrate the SHAPE and are NOT an
exhaustive list of what is banned:

  1. COLON-SEPARATED CHECK KEYS — a lowercase word, a colon, then a hyphenated
     lowercase slug, in the form <domain>:<slug>. Shape examples:
     governance:ownerless-groups, identity:stale-accounts, teams:channel-sprawl,
     m365:message-center, sharepoint:inactive-sites. Any token of that shape is
     an internal check key. Never print it, in any context — not as a heading,
     not as a subject of a sentence, not in parentheses, not in a table cell,
     not in a reference list, not with a label in front of it.

  2. camelCase, snake_case AND _underscore-prefixed FIELD NAMES — a machine
     property name from the telemetry: two or more words fused with an internal
     capital (ownerlessGroupCount, allowInvitesFrom, guestAccessReviewExists,
     teamsWithGuestsCount), words joined by underscores (membershipRule_count,
     signInActivity_count, lastModifiedDateTime_count), or a name beginning
     with an underscore (_itemCount). Any token of that shape is an internal
     data-model field name. Never print it, and never print the
     "fieldName: value" pairing it arrives in.

The telemetry and findings handed to you are written in these names because
that is how the platform stores them. They are your INPUT, not your output
vocabulary. Reading them is required. Reproducing them is a defect.

WHAT IS REQUIRED — EVERY REAL NUMBER AND EVERY REAL FACT IS STILL STATED
This rule forbids the NAMES. It does not forbid, soften, round, generalise or
withhold anything those names carry. Every measured count, ratio, boolean,
setting value, date and object name is the substance of the document and must
still appear, in full, exactly as measured.

Translate — never omit, never hedge. Name what was measured in the words a
customer's IT decision-maker would use, and state the real value alongside it:

  NOT  "The governance:ownerless-groups check returned ownerlessGroupCount: 26
        out of 104 total groups."
  BUT  "26 of the tenant's 104 groups have no owner."

  NOT  "identity:b2b-collaboration-settings returned allowInvitesFrom: everyone
        and guestInviteRestriction: everyone."
  BUT  "Guest invitations are open to everyone — any licensed user in the
        tenant can invite an external guest, with no restriction configured."

  NOT  "governance:dynamic-group-usage shows dynamicGroupCount: 0 and
        membershipRule_count: 0 across all 104 groups."
  BUT  "No group in the tenant uses dynamic membership — all 104 groups are
        maintained by hand."

  NOT  "teams:meeting-policy-coverage returned meetingPolicyAssignedCount: 18
        and teams:messaging-policy-coverage returned
        messagingPolicyAssignedCount: 18."
  BUT  "All 18 Teams have both a meeting policy and a messaging policy
        assigned."

  NOT  "m365:message-center returned _itemCount: 440 total items, of which
        majorChangeCount: 108."
  BUT  "The Message Center holds 440 items, 108 of them flagged as major
        changes."

Look at what survives every one of those rewrites: 26, 104, 0, 18, 440, 108,
"everyone", "no restriction configured". Every number and every real setting is
still on the page. Only the machine name is gone.

WHEN THE VALUE ITSELF IS A MACHINE TOKEN
Some measured VALUES are themselves API tokens (an enumerated setting value, a
Message Center category such as planForChange / preventOrFixIssue /
stayInformed). State it the way the Microsoft admin center labels it for an
administrator — "Plan for change", "Prevent or fix issue" — and keep the
distinction exact. Do not collapse two different values into one word, and do
not invent a value that was not measured. If no natural label exists, say
precisely what the value means in a short phrase.

VAGUENESS IS A WORSE FAILURE THAN THE LEAK
Never satisfy this rule by writing less. Do not replace a named measurement
with "a certain setting", "some groups", "several accounts", "a configuration
issue", or any other placeholder that drops the specific. Do not drop a finding
because a plain-English name for what was measured does not come easily. If a
clean name will not come, describe what was counted and where it was counted,
and state the exact number anyway. Precise and readable is the target; vague is
a failure of this rule, not compliance with it.

The only thing you may never do is print the internal name itself.
$idhyg$::text AS body
)
UPDATE ai_prompts p
SET
  prompt_body = CASE
    WHEN position(b.marker in p.prompt_body) = 0
      THEN p.prompt_body || E'\n\n' || b.body
    ELSE p.prompt_body
  END,
  default_body = CASE
    WHEN p.default_body IS NULL THEN NULL
    WHEN position(b.marker in p.default_body) = 0
      THEN p.default_body || E'\n\n' || b.body
    ELSE p.default_body
  END,
  updated_at = now()
FROM block b
WHERE p.key = 'insights-document-style';

-- ── RECEIPT ──────────────────────────────────────────────────────────────────
-- Expect EXACTLY ONE row, with:
--   has_rule            = true
--   rule_occurrences    = 1        (2 means the idempotency guard did not hold)
--   default_has_rule    = true, or NULL if this row has no default_body
--   has_shape_examples  = true     (the block landed whole, not truncated)
--   body_len                       (compare against the pre-run value: it must
--                                   have GROWN by the length of the block, not
--                                   shrunk to it — a shrink means a replace)
--
-- ZERO ROWS is a real failure, not a no-op: it means the
-- `insights-document-style` row does not exist in this database, in which case
-- getDocumentStylePrefix() returns "" and NO style guide (and therefore no part
-- of this fix) reaches any document. ROLLBACK and create the row first.
SELECT
  key,
  (position('IDENTIFIER HYGIENE' in prompt_body) > 0)                       AS has_rule,
  (length(prompt_body) - length(replace(prompt_body, 'IDENTIFIER HYGIENE', '')))
    / length('IDENTIFIER HYGIENE')                                          AS rule_occurrences,
  (position('IDENTIFIER HYGIENE' in default_body) > 0)                      AS default_has_rule,
  (position('governance:ownerless-groups' in prompt_body) > 0)              AS has_shape_examples,
  (position('VAGUENESS IS A WORSE FAILURE' in prompt_body) > 0)             AS has_anti_vagueness_clause,
  length(prompt_body)                                                       AS body_len,
  updated_at
FROM ai_prompts
WHERE key = 'insights-document-style';

-- If the receipt looks right:  COMMIT;
-- If anything looks wrong:     ROLLBACK;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-08-document-style-identifier-hygiene-558.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
