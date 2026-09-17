/**
 * `metadata.checkout_kind` on a Stripe Checkout Session created by
 * routes/portal-add-ons.ts (Git #4462) — how portal-checkout.ts's signed webhook
 * recognises one. Its own import-free module so the webhook can match the marker
 * without loading the add-on route or its database writer.
 */
export const PORTAL_ADD_ON_CHECKOUT_KIND = "portal_add_on";
