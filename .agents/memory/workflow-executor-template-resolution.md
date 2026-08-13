---
name: Workflow executor template resolution (interp vs native)
description: interp() always stringifies arrays/objects; use resolveExprNative() when a whole field should preserve its native type (e.g. passing arrays between workflow nodes).
---

`interp(template, payload)` in `workflow-executor.ts` always returns a `string`. For a pure `{{path}}` expression that resolves to an array/object, it JSON.stringifies it so it can be embedded in larger template strings (e.g. `"Hello {{name}}"`).

**Why:** Several node handlers (`group_by` arrayExpression, `for` arraySource, `run_workflow` inputMapping) need the ARRAY/OBJECT, not a JSON string. Passing `interp()`'s result straight through silently produces a stringified value where a native type was expected — e.g. Run Workflow's child payload got `"tasks": "[{...}]"` (a string) instead of `"tasks": [{...}]` (an array).

**How to apply:** Use `resolveExprNative(expr, payload)` instead of `interp()` whenever the ENTIRE field value must preserve its native type. It resolves a sole `{{...}}` placeholder directly against `payload` without stringifying; falls back to `interp()` for anything else (partial/multi-placeholder strings). `group_by`/`for` still use the older `interp()` + `JSON.parse()` workaround pattern — leave those as-is unless touching that code, but any NEW node field that must hand off structured data downstream should use `resolveExprNative()` from the start.
