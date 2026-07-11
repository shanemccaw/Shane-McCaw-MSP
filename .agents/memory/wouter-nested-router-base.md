---
name: Wouter nested router base concatenation
description: Wouter appends nested Router bases to the parent base — passing an absolute path as the inner base doubles the prefix and silently breaks all inner route matching.
---

# Wouter nested Router base concatenation

## The Rule
When creating a nested `<Router base="...">` (or `<WouterRouter base="...">`), always pass a **relative** base — one that starts from the parent router's base, not from the URL root.

Wouter source (index.js, `Router` component):
```js
k === "base"
  ? parent[k] + (props[k] ?? "")   // BASE IS APPENDED, not replaced
  : props[k] ?? parent[k];
```

**Why:** The outer router already has `base="/portal"`. Passing `base="/portal/shane-mccaw-consulting"` produces an effective base of `/portal/portal/shane-mccaw-consulting`. Every path the inner router sees will start with `~` (unresolvable), so no Switch cases match and the tree renders nothing — a completely silent blank screen.

**How to apply:** When the outer router has `base="/portal"` and you want an inner router at `/portal/shane-mccaw-consulting`:
```tsx
// WRONG — doubles the prefix
<WouterRouter base={`${BASE_PATH}/${slug}`}>   // → /portal/portal/shane-mccaw-consulting

// CORRECT — relative; Wouter prepends parent base
<WouterRouter base={`/${slug}`}>               // → /portal/shane-mccaw-consulting
```

Applies in `artifacts/msp-portal/src/App.tsx` in `SlugScope`.
