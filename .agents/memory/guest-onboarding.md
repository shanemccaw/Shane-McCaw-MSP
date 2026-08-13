---
name: Guest onboarding flow
description: How new clients get their account — no open registration; account is created at purchase time via a guest token flow
---

# Guest Onboarding Account Flow

Registration is locked (`POST /api/auth/register` → 403). Accounts are only created:
1. Automatically when a guest completes the Stripe onboarding flow.
2. Manually by an admin.

## Flow summary

1. **OnboardingSelect** — if not logged in, shows a name+email modal (no password). Saves `{name, email}` to `sessionStorage.onboardingGuest`.
2. **OnboardingContract** — no auth required. On sign, passes `guestEmail`/`guestName` to `POST /api/portal/onboarding/contract`. Server calls `ensureClientAccount()` to create/locate the user and returns a short-lived `guestToken` JWT.
3. **Stripe checkout** — guestToken used as Bearer for `POST /api/portal/checkout/create-session`.
4. **OnboardingSuccess** — uses guestToken Bearer for session/provision API calls. `POST /api/portal/onboarding/provision/:id` returns `{ok, hasPassword, setupToken}`. If `setupToken` is present, a password setup form is shown.
5. **Setup password** — `POST /api/auth/setup-password` validates the one-time token, sets `passwordHash`, returns accessToken. Page auto-logs the user in.

## Key files
- `artifacts/api-server/src/routes/auth.ts` — setup-password endpoint
- `artifacts/api-server/src/routes/portal.ts` — ensureClientAccount, guestToken, setupToken
- `artifacts/crm/src/pages/portal/OnboardingSelect.tsx` — guest info modal
- `artifacts/crm/src/pages/portal/OnboardingContract.tsx` — guest auth support
- `artifacts/crm/src/pages/portal/OnboardingSuccess.tsx` — password setup form
- `artifacts/crm/src/pages/Login.tsx` — login + forgot only (no register)
- `lib/db/src/schema/index.ts` — accountSetupTokensTable

**Why:** Prevents strangers from creating portal accounts. Every client account maps to a real Stripe payment. passwordHash is nullable — accounts without passwords must use setup-password flow.
