import io
path = "/tmp/platform_build_origin2.md"
with io.open(path, "r", encoding="utf-8", newline="") as f:
    lines = f.readlines()

old = "| 2026-08-17 | ⏳ IN FLIGHT | Git #1116 -- Governance: Investigate Overdue Access Review = 0 vs known expired app registrations (part of #1045). Live-verifying governance:overdue-access-reviews sourceKey against testbed tenant; investigation-only, no blind fix. |  |\n"
new = ("| 2026-08-17 | ✅ DONE | Git #1116 -- Governance: Investigate Overdue Access Review = 0 vs known expired app registrations (part of #1045). "
       "Live-verified via shaneapp://executeSql: overdueAccessReviewCount=0 is honest (zero Access Review definitions ever collected, either dev tenant) "
       "but the check's countEquals('InProgress') mapping is a latent status-vs-date bug (filed #1121). "
       "\"Expired app registrations\" is NOT a missing capability -- appgov:cert-secret-expiration + appgov:stale-app-registrations already exist, "
       "are active, and are live-firing on the testbed tenant right now (3 expired secrets, 1 expired cert, severity warning) -- just never wired into "
       "lib/dashboard-registry/src/metrics.ts (filed #1122). Also found governance.accessReviewDriftCount's sourceKey governance:access-review-drift "
       "is a phantom key, same class as #1103/#1110 (filed #1123). Investigation-only, no code changes, per the issue's own instruction. Posted findings "
       "comment on #1116. Commits: 799abc98 (IN FLIGHT bookend). |  |\n")

count = lines.count(old)
assert count == 1, "expected exactly 1 match, found %d" % count
idx = lines.index(old)
lines[idx] = new

with io.open(path, "w", encoding="utf-8", newline="") as f:
    f.writelines(lines)
print("OK, replaced at line", idx + 1)
