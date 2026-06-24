---
name: Mobile auth session-expiry
description: Pattern for redirecting to login on auth expiry without false positives on logout or app boot
---

# Mobile auth session-expiry redirect

## The rule
Use a dedicated `sessionExpired: boolean` field in `AuthState` to drive the session-expiry redirect in `_layout.tsx`, NOT a "previous user value" diff.

**Why:** A prev-user diff (`wasLoggedIn && !user`) fires on:
- Explicit logout (wrong — no banner needed)
- App boot with no stored session (harmless but noisy)
- Parallel 401s causing a race (see below)

`sessionExpired` is only set `true` inside `fetchWithAuth`'s catch block — explicitly NOT in `logout()` or startup. This means the redirect fires exactly when intended.

## The re-login race condition
Without a lock, multiple parallel queries all getting 401 simultaneously each independently call `doLogin()`. All fail → all call `setState({ user: null })` → redirect fires N times immediately after a successful manual login (appears as "login box refreshing").

**Fix:** `reloggingRef` bool in `AuthContext`. Only one re-login in flight at a time. On failure: clear `credRef.current` AND set `sessionExpired: true`.

## How to apply
- `contexts/AuthContext.tsx` — `reloggingRef`, `sessionExpired` in state
- `app/_layout.tsx` — `useEffect` on `[user, isLoading, sessionExpired]`; only fires when all three are `!user && !isLoading && sessionExpired`
- `app/login.tsx` — reads `?reason=session_expired` param to show info banner
