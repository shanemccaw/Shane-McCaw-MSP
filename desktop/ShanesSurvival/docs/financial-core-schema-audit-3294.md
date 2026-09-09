# Financial-core schema audit — ShanesSurvival vs shanes-life (Git #3294)

Real, read-only audit for #3293 ("Feature: ShanesSurvival/shanes-life financial-core
unification (Option C)") Phase 1. Source of truth for every claim below is the migration
files themselves — `desktop/ShanesSurvival/migrations/001`–`012` (ShanesSurvival's own
namespace) and `web/shanes-life/migrations/013`–`065` (shanes-life's own namespace, 52
files, sharing the same live `finances` Postgres database and the same migration-number
sequence). No live database was queried to produce this document — text of the `.sql`
files on disk is what's enumerated. No writes were made to any database.

## 1. ShanesSurvival's financial-core tables/columns (own migrations 001–012)

### `plaid_items`
| Column | Type | Added by |
|---|---|---|
| id | UUID PK | 001 |
| access_token | TEXT NOT NULL | 001 |
| institution_name | TEXT NOT NULL | 001 |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | 001 |
| last_synced_at | TIMESTAMPTZ | 001 |
| plaid_item_id | TEXT UNIQUE | 002 |
| sync_cursor | TEXT | 002 |

### `accounts`
| Column | Type | Added by |
|---|---|---|
| id | UUID PK | 001 |
| plaid_item_id | UUID NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE | 001 |
| plaid_account_id | TEXT NOT NULL | 001 |
| name | TEXT NOT NULL | 001 |
| type | TEXT NOT NULL | 001 |
| subtype | TEXT | 001 |
| current_balance | NUMERIC(14,2) | 001 |
| available_balance | NUMERIC(14,2) | 001 |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | 001 |
| role | TEXT (CHECK: income_gate/bill/spend, widened by 006/008 — see below) | 003 |
| target_amount | NUMERIC(14,2) | 003 |
| is_gate | BOOLEAN NOT NULL DEFAULT false | 003 |
| due_day | INTEGER (CHECK 1–31) | 007 |
| last_paid_date | DATE | 011 |

`accounts_role_check` constraint evolution (own-namespace only): 003 → `income_gate, bill,
spend`; 006 (Emergency Fund) widened to add `emergency_fund`; 008 (Reserve) widened to add
`reserve`. Current own-namespace allowed set: `income_gate, bill, spend, emergency_fund,
reserve`.

### `transactions`
| Column | Type | Added by |
|---|---|---|
| id | UUID PK | 001 |
| account_id | UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE | 001 |
| plaid_transaction_id | TEXT NOT NULL UNIQUE | 001 |
| amount | NUMERIC(14,2) NOT NULL | 001 |
| date | DATE NOT NULL | 001 |
| merchant_name | TEXT | 001 |
| category | TEXT | 001 |
| pending | BOOLEAN NOT NULL DEFAULT false | 001 |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | 001 |
| name | TEXT | 009 |

### `debts`
| Column | Type | Added by |
|---|---|---|
| id | UUID PK | 001 |
| creditor_name | TEXT NOT NULL | 001 |
| balance | NUMERIC(14,2) NOT NULL | 001 |
| minimum_payment | NUMERIC(14,2) | 001 |
| is_delinquent | BOOLEAN NOT NULL DEFAULT false | 001 |
| days_past_due | INTEGER NOT NULL DEFAULT 0 | 001 |
| notes | TEXT | 001 |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | 001 |
| is_critical | BOOLEAN NOT NULL DEFAULT false | 010_debt_is_critical |

### `survival_snapshots`
id, created_at, total_cash, total_debt, monthly_income, monthly_fixed_costs, notes — all from 001. Untouched by any later ShanesSurvival or shanes-life migration.

### `pay_period_plans`
id, pay_date, income_amount, status (CHECK: proposed/active/completed), notes, created_at — all from 004. Untouched since.

### `pay_period_plan_allocations`
id, plan_id (FK → pay_period_plans), account_id (FK → accounts), amount, reason, executed, executed_at — all from 004. Untouched since.

### `income_sources`
| Column | Type | Added by |
|---|---|---|
| id | UUID PK | 005 |
| name | TEXT NOT NULL UNIQUE | 005 |
| person | TEXT NOT NULL | 005 |
| pay_frequency_days | INTEGER | 005 |
| expected_per_cycle | NUMERIC(14,2) | 005 |
| next_pay_date | DATE | 005 |
| is_active | BOOLEAN NOT NULL DEFAULT true | 005 |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | 005 |

### `income_entries`
id, source_id (FK → income_sources), date, amount, notes, created_at — all from 005. Untouched by any later ShanesSurvival migration.

### `expected_one_time_events`
id, description, direction (CHECK inflow/outflow), amount, status (CHECK pending/realized/cancelled), contingency_notes, expected_date, created_at, realized_at — all from 010_expected_events. Untouched since. Deliberately NOT wired into shortfall math (per the migration's own comment).

### `transaction_tags`
id, merchant_pattern, min_amount, max_amount, tag, created_at — all from 012. Untouched since.

## 2. shanes-life migrations that touch ShanesSurvival's own tables

All 52 shanes-life migrations (013–065, `039` never used — a real, documented renumber
collision, not a gap in ShanesSurvival's own schema) were scanned. **Every one of the
touches below is additive** (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, or a
new index) — none renames, drops, or changes the type of a column ShanesSurvival's own code
already relies on, and no financial-core table is ever the target of a `DROP TABLE` or
`TRUNCATE` anywhere in shanes-life's 52 files.

| Migration | Table touched | Change |
|---|---|---|
| 017_money_extras | `accounts` | New FK **into** accounts: `vehicles.loan_bill_id uuid REFERENCES accounts(id) ON DELETE SET NULL`. Does not alter `accounts` itself. |
| 033_wins_watch_state | `debts`, `accounts` | Read-only reference in comments/data (`money_watch_state.ref_id` holds a `debts.id` or `accounts.id`, no FK constraint declared). No DDL against either table. |
| 038_debt_due_dates | `debts` | `ADD COLUMN IF NOT EXISTS due_day integer` + `debts_due_day_check` (1–31) + one `UPDATE ... WHERE creditor_name = 'Treasury Offset Program'`. |
| 041_plaid_item_health | `plaid_items` | `ADD COLUMN IF NOT EXISTS`: `health_status text NOT NULL DEFAULT 'ok'`, `health_code text`, `health_message text`, `health_changed_at timestamptz`, `consent_expires_at timestamptz`, `webhook_url text`, `webhook_registered_at timestamptz`, `last_webhook_at timestamptz`, `transactions_pending_since timestamptz`, `reconnected_at timestamptz` + `plaid_items_health_status_check` constraint. Also creates new table `plaid_webhook_events` (FK → plaid_items). |
| 042_bankruptcy_overlay | `debts` | `ADD COLUMN IF NOT EXISTS`: `debt_type text`, `original_balance numeric(14,2)`, `last_payment_date date`, `included_in_bankruptcy boolean NOT NULL DEFAULT false` + two backfill `UPDATE`s (H1 Mortgage, Treasury Offset Program). |
| 043_account_mask | `accounts` | `ADD COLUMN IF NOT EXISTS mask text`. (Note: ShanesSurvival's own `PlaidSyncService.cs` INSERT was updated in the *same* real-world commit to populate this column — see §3.) |
| 044_income_rules | `accounts`, `income_sources`, `income_entries`, `transactions` | New table `income_rules` (FK → accounts, → income_sources). `income_sources`: `ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false` + partial unique index. `income_entries`: `ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL` + partial unique index. |
| 045_money_home_tab_decision_tools | `accounts` | `ADD COLUMN IF NOT EXISTS bill_category text` + `accounts_bill_category_check` (shared/general/cars/h2/h1) + 4 backfill `UPDATE`s keyed on `role='bill'` and name pattern. Also creates new table `paycheck_distributions` (FK → accounts, → shanes-life's own `users`). |
| 048_debt_balance_history | `debts` | New table `debt_balance_history` (FK → debts) + one backfill `INSERT ... SELECT id, CURRENT_DATE, balance FROM debts`. No ALTER on `debts` itself. |
| 049_bill_cycle_snapshots | `accounts` | New table `bill_cycle_snapshots` (FK → accounts). Also `ALTER TABLE vault ADD COLUMN IF NOT EXISTS bill_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL` (vault is shanes-life's own table; the FK points at accounts). |

Tables/columns from §1 that **no** shanes-life migration ever touches: `plaid_items.access_token/institution_name/created_at/last_synced_at` (untouched columns), `transactions` (only referenced via new FK in 044, never altered), `survival_snapshots`, `pay_period_plans`, `pay_period_plan_allocations`, `expected_one_time_events`, `transaction_tags` — all four of these tables are never mentioned by name in any of the 52 shanes-life migrations.

### Current full column list, post-shanes-life (for review)

- **`accounts`**: id, plaid_item_id, plaid_account_id, name, type, subtype, current_balance, available_balance, updated_at, role, target_amount, is_gate, due_day, last_paid_date, **mask** (043), **bill_category** (045)
- **`debts`**: id, creditor_name, balance, minimum_payment, is_delinquent, days_past_due, notes, updated_at, is_critical, **due_day** (038), **debt_type, original_balance, last_payment_date, included_in_bankruptcy** (042)
- **`plaid_items`**: id, access_token, institution_name, created_at, last_synced_at, plaid_item_id, sync_cursor, **health_status, health_code, health_message, health_changed_at, consent_expires_at, webhook_url, webhook_registered_at, last_webhook_at, transactions_pending_since, reconnected_at** (041)
- **`income_sources`**: id, name, person, pay_frequency_days, expected_per_cycle, next_pay_date, is_active, created_at, **is_primary** (044)
- **`income_entries`**: id, source_id, date, amount, notes, created_at, **transaction_id** (044)
- **`transactions`**: unchanged (id, account_id, plaid_transaction_id, amount, date, merchant_name, category, pending, created_at, name)

## 3. Compatibility risk assessment

**No incompatible real schema drift found.** Specifically checked and confirmed:

1. **No NOT NULL column added without a default** on any financial-core table. Every
   `ADD COLUMN` in §2 is either nullable, or `NOT NULL DEFAULT <value>` (`plaid_items
   .health_status DEFAULT 'ok'`, `debts.included_in_bankruptcy DEFAULT false`, `income_sources
   .is_primary DEFAULT false`). ShanesSurvival's own `INSERT`s (see below) would not fail
   against any of these.
2. **No DROP/RENAME/TYPE-change touches any financial-core table.** The only `ALTER
   COLUMN` / `DROP` statements found anywhere in shanes-life's 52 migrations
   (`019_share_links_typed_targets.sql:27`, `034_catches.sql:60-61`) target `share_links`
   and `catches` — both shanes-life's own tables, unrelated to the financial core.
3. **ShanesSurvival's own repositories use explicit column lists, never `SELECT *` /
   bare `INSERT`,** so a new column appended by shanes-life is structurally invisible to
   the WPF app until it chooses to read/write it:
   - `DebtRepository.cs:109` — `INSERT INTO debts (id, creditor_name, balance, minimum_payment, is_delinquent, days_past_due, notes, updated_at, is_critical)`
   - `IncomeRepository.cs:42` — `INSERT INTO income_sources (id, name, person, pay_frequency_days, expected_per_cycle, next_pay_date)`
   - `IncomeRepository.cs:114` — `INSERT INTO income_entries (id, source_id, date, amount, notes)`
   - `PlaidLinkService.cs:62` — `INSERT INTO plaid_items (plaid_item_id, access_token, institution_name)`
   - `PlaidSyncService.cs:100` — `INSERT INTO accounts (plaid_item_id, plaid_account_id, name, type, subtype, current_balance, available_balance, mask, updated_at)` — this one **already lists `mask`** (043's column), confirmed added in the same real commit that shipped 043 per that migration's own header comment.
4. **`accounts_role_check` and `accounts_bill_category_check` are two separate, non-
   conflicting constraints** — 045's `bill_category` check (`shared/general/cars/h2/h1`)
   constrains a different column than 003/006/008's `role` check (`income_gate/bill/
   spend/emergency_fund/reserve`); no overlap, no redefinition of the same constraint
   name across the two projects.
5. **One soft, non-blocking documentation gap, not a schema conflict:** `045`'s own
   header states "money.mjs's own header is explicit that core bill fields — target_amount,
   balance, role, due_day — stay ShanesSurvival's own MCP tools' job" — i.e. shanes-life
   has a self-imposed convention of read-only access to those four specific columns, but
   nothing in the database schema itself (no trigger, no REVOKE, no read-only role) enforces
   that boundary. It's a documented intent honored by every migration/code path audited here,
   not a structural guarantee. Flagging for Shane's awareness, not treating as a defect —
   the same "never a boundary crossing... normal, established practice" language appears
   directly in `043_account_mask.sql`'s own header for the ADD COLUMN pattern.
6. **Numbering collisions are real but already self-resolved.** Three migrations'
   own headers (`038`, `042`, `045`) document live renumbering after concurrent-session
   number collisions (037, 041, 040–044 respectively) — all real events already caught by
   `bin/check.mjs`'s orphan-ledger-row check and corrected before landing on `main`. Nothing
   outstanding; documented here only because the issue's own scope asked to "confirm no
   incompatible real schema drift exists," and these collisions are the closest thing to
   drift on record — resolved, not open.

**Conclusion: zero open compatibility risk found.** All 52 shanes-life migrations that
touch ShanesSurvival's own financial-core tables (`plaid_items`, `accounts`, `debts`,
`income_sources`, `income_entries`, `transactions`) are additive-only, and ShanesSurvival's
own repository code is immune to newly-added columns by construction (explicit column
lists everywhere). The one flagged item (#5) is a convention, not a drift — carried
forward for Phase 2's own awareness, not a blocker.
