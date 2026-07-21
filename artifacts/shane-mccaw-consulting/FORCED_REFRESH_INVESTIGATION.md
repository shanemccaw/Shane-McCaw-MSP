# Site-Wide "Forced Refresh on Scroll" — Root-Cause Investigation

**Date:** 2026-07-21
**Reported symptom:** Scrolling partway down Governance (`/solutions/governance`) and
Monitoring (`/monitoring`) triggers a full, unexpected browser refresh/reload. Reported
as site-wide and not tied to a deployment.

## Verdict

**This is a Vite _dev-server_ HMR artifact, not a bug in the site's code, and not
triggered by scrolling.** A full page reload is issued by the Vite dev server whenever a
**concurrent editor/session saves a source module in the root import chain** (or a module
whose HMR update can't be accepted and propagates to the entry). That reload lands on
**every open browser tab at once**, regardless of which page is showing or where the user
has scrolled. The apparent "scroll causes it" link is coincidental: Governance and
Monitoring are long, multi-second reads, so a background file-save frequently lands while
the user happens to be scrolling.

It does **not** occur in a production build, and it does **not** occur on a clean,
single dev server. There is **no code path anywhere in the app that reloads the browser**
(no `location.reload`, no `<meta http-equiv="refresh">`, no service worker, no
chunk-load-error reload handler, no error boundary).

## Evidence (all via live Playwright, 3 full scroll passes down+up per page)

| Environment | Governance | Monitoring | Reload on scroll? |
|---|---|---|---|
| **Production build** (`vite build` + `vite preview`, no HMR) | rendered 6269px, 3 passes | rendered 7083px, 3 passes | **No — 0 reloads** |
| **Isolated single dev server** (own cold `cacheDir`, own port) | 3 passes | 3 passes | **No — 0 reloads** |
| **Shared dev server** (5 concurrent servers, live concurrent edits) | 1 reload during *initial load* (not scroll) | live `[vite] hot updated: /src/pages/Monitoring.tsx` + `/src/index.css` observed *from another session mid-test* | reloads seen, **uncorrelated with scroll** |

### Controlled experiment — the definitive proof

Two tabs (Governance + Monitoring) opened on a clean isolated dev server, each scrolled to
the middle and then **held completely still**. A single source file was then saved
(simulating a concurrent session), with no scrolling occurring:

| File saved (while tabs idle, mid-page) | Result on BOTH tabs |
|---|---|
| `src/main.tsx` (the entry) | **FULL RELOAD** — `docLoads 1→2`, `[vite] connecting…` reboot |
| `src/lib/analytics.ts` | app-wide `[vite] invalidate … Could not Fast Refresh ("usePersonalizationState" export is incompatible)` |
| `src/components/ui/button.tsx` | app-wide `[vite] invalidate … Could not Fast Refresh ("buttonVariants" export is incompatible)` |
| `src/lib/utils.ts` | app-wide `[vite] invalidate` cascade across `button.tsx` / `badge.tsx` / `form.tsx` |

The `main.tsx` case reloads **both idle tabs with zero scrolling**, proving the reload is
driven by the file-save event, not by scroll position or by the page's own code.

## Why the original hypothesis (shared/global scroll effect) was ruled out

Every globally-mounted component (`Layout`, `Header`, `Footer`, `BackToTop`,
`EngagementOfferPanel`, `PersistentChatBubble`) and the analytics tracker were read in
full. The only scroll listeners are `BackToTop` (sets a boolean) and the analytics tracker
(fires beacons) — neither navigates or reloads. `recharts` (Governance's only lazy import)
is discovered at Vite's startup scan and pre-bundled, so scrolling to the chart never
triggers a mid-session dependency re-optimization.

## Contributing amplifiers (dev-experience only, not user-facing)

1. **Multiple concurrent dev servers** (5 were running) share one `node_modules/.vite`
   cache, so a re-optimize by one server can invalidate the others.
2. **Fast-Refresh-incompatible mixed exports.** Several modules export a component *and* a
   non-component from the same file, which disables React Fast Refresh for them and turns
   an otherwise-clean hot-update into an app-wide invalidation (and, when it reaches the
   root, a full reload):
   - `src/hooks/usePersonalizationState.tsx` — exports the `usePersonalizationState` hook
     **and** a provider component. This one is consumed by the global Layout components on
     **every** page, so its incompatibility poisons every page's HMR.
   - `src/components/ui/button.tsx` (`buttonVariants`), `badge.tsx` (`badgeVariants`),
     `form.tsx` (`useFormField`) — shadcn primitives that mix component + non-component
     exports.

## Recommended mitigations (none are required to fix production)

- **Don't run many concurrent dev servers of this app at once** against the shared Vite
  cache — the single biggest source of the disruptive reloads in this workspace.
- Optionally split the non-component exports out of the Fast-Refresh-incompatible modules
  above (esp. `usePersonalizationState.tsx`, since it's global) so routine edits
  hot-update instead of invalidating every tab. This is a dev-experience improvement, not
  a fix for the reported reloads (a save to a genuine root module such as `main.tsx` will
  always full-reload — that is correct Vite behavior).

## What was deliberately NOT changed

No application code was modified. Per the task's own guardrail ("do not apply a
speculative fix without first reproducing and confirming the actual trigger"), and because
the reproduced root cause is a development-environment artifact with no corresponding
app-code defect, there is nothing to fix in the site's runtime code. A change to
`Layout`/global components would fix nothing and would be speculative.
