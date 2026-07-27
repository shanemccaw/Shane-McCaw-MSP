# Build Plans

This directory holds the plan files for multi-phase initiatives in this repo.

## Convention

- **Plan files are the source of truth** for multi-phase initiatives. Each
  initiative gets one file: `docs/build-plans/<slug>.md`, based on
  [_TEMPLATE.md](_TEMPLATE.md).
- **GitHub Issues/Project cards are derived views**, created from the plan
  file — not the other way around. An Issue's body should follow
  [_ISSUE_TEMPLATE.md](_ISSUE_TEMPLATE.md).
- **If a plan file and its Issue ever disagree, the plan file wins.** Correct
  the Issue to match it.
- **One GitHub Issue per phase.** Phases use decimal insertion (e.g. `2.5`)
  when a phase splits mid-build — never renumber existing phases.

## Labels

- `area:*` labels (`area:billing-webhooks`, `area:admin-panel`,
  `area:msp-portal`, `area:public-website`, `area:backlog`) are pre-seeded
  on the repo.
- `initiative:*` and `phase:*` labels are created per-initiative/phase as
  needed — not pre-seeded.
