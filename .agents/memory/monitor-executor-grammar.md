---
name: Monitor executor evalConditionGrammar bugs
description: OPS array order and contains-needle fallback pitfalls in evalClause
---

## Rules

1. **OPS array order** — multi-char operators (`" length>="`, `" length>"`, `" contains "`) MUST appear in the array before single-char prefixes (`">"`, `"<"`). Otherwise `"items length> 0"` has `">"` matched at `idx=12` before `" length>"` is checked, returning `NaN > 0 = false`.

   Correct order: `[" length>=", " length<=", " length==", " length>", " length<", " contains ", ">=", "<=", "!=", "==", ">", "<"]`

2. **contains needle** — `parseExprValue(rhs, data)` returns `undefined` when `rhs` (e.g. `"admin"`) is not a key in `data`. The `contains` handler must fall back to raw `rhs` when `right === undefined`, or `haystack.includes(undefined)` always returns `false`.

3. **executeMonitoringPackage test mock count** — the function makes **3** `db.select()` calls: (1) package lookup, (2) package-checks (ordered links), (3) actual check definitions. Tests must provide all 3 `mockReturnValueOnce` chains or the 3rd resolves to an object (not an array) and `.map()` throws.

**Why:** These are subtle bugs where short-circuit operator matching and data-path resolution interact badly — easy to miss in code review but obvious in tests.
