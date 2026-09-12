# retry-resume-session probe (Git #3728)

Verifies that "🔄 Retry" classifies queue rows correctly, against the **real**
`bt_build_queue` table rather than a synthetic fixture.

```
bash scripts/probes/retry-resume-session/run.sh
```

It exports every real row (`id`, `title`, `resume_session_id`, `status`) to `rows.tsv`
(gitignored), then replays each one through the **real** classifier —
`desktop/BuildConsole/Services/ResumeOnlyQueueRows.cs` is compiled into the probe via
`<Compile Include>`, not copied — and reports what Retry would do before vs after the fix.

Never launches BuildConsole, and reads nothing but the queue table.

## Result at the time of the fix (2,170 real rows)

| | rows |
|---|---|
| ordinary → `null` (start over, **unchanged**) | 2084 |
| resume-only with a session → carried forward | 83 |
| resume-only with **no** session → Retry refused | 3 |

The three refused rows are the ones the old Retry would have relaunched cold with a
conversational fragment as their entire prompt: `#462 "retry"`, `#480 "try again"`, and
`#2382 "Retry"` — the build that found this bug.

96% of rows are untouched by the change, which is the point: an ordinary build's Retry
still means start over.
