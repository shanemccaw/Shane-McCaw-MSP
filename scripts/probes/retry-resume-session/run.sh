#!/usr/bin/env bash
# Git #3728 — export every real bt_build_queue row and replay it through the real classifier.
# Usage:  bash scripts/probes/retry-resume-session/run.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"

# The queue lives in the BuildConsole database on the same local PostgreSQL instance as
# DATABASE_URL (see CLAUDE.md "Database"), not in shanemccawmsp.
db_url="$(grep -m1 '^DATABASE_URL' "$repo/.env.local" | cut -d= -f2- | sed 's#/shanemccawmsp#/BuildConsole#')"

psql "$db_url" -t -A -F $'\t' -c \
  "select id, replace(title, chr(9), ' '), coalesce(resume_session_id, ''), status
     from bt_build_queue order by id;" > "$here/rows.tsv"

echo "exported $(wc -l < "$here/rows.tsv") real queue rows"
echo
dotnet run --project "$here/RetryResumeSessionProbe.csproj" -v quiet -- "$here/rows.tsv"
