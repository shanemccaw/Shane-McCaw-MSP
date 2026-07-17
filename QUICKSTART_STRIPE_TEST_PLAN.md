# Entra ID Quick-Start Pack — Stripe Billing Path Test Plan

**Migration:** `0195_baseline_templates_quickstart_data.sql`  
**Service:** Entra ID Quick-Start Pack (`entra-id-quickstart-v1`)  
**Service Class:** `add_on` (instant Stripe checkout, one-time charge)  
**Internal Cost:** $250.00 (25000 cents)

## Overview

The Entra ID Quick-Start Pack is now configured in the services catalog with an `add_on` service class. When an MSP customer purchases this pack, the Stripe billing path must:

1. Calculate wholesale cost via `resolveCatalogPricing()` ($250 base, may be overridden per offer)
2. Charge the **MSP's saved payment method** for the wholesale cost (NOT the retail price)
3. Emit fulfillment event with pricing breakdown
4. Track the charge in fulfillment_queue with correct amounts

This test verifies the entire flow works correctly.

---

## Prerequisites

- A testbed customer MSP with:
  - Active Stripe customer ID (`msp_stripe_customer_id` in the platform)
  - Saved payment method on file (test card)
  - `is_testbed = true` flag set
  - Connected tenant (for baseline template testing, optional for billing test)

- Stripe test mode enabled with test card:
  - **Visa (success):** `4242 4242 4242 4242`
  - **Visa (decline):** `4000 0000 0000 0002`

---

## Test Scenario

### Step 1: Create a Sales Offer for the Quickstart Pack

Create a sales offer targeting the quickstart-v1 service with a custom retail price.

**GraphQL/API call:**
```graphql
mutation CreateOffer {
  createOffer(input: {
    mspId: <testbed-msp-id>
    customerId: <testbed-customer-id>
    serviceId: <quickstart-service-id>  # From services table: name='Entra ID Quick-Start Pack'
    title: "Entra ID Quick-Start Pack"
    adjustedPriceCents: 50000  # $500 retail (MSP markup)
    status: "sent"
  }) {
    offerId
    adjustedPriceCents
    internalCostCents  # Should be 25000 from service
  }
}
```

**Expected response:**
```json
{
  "offerId": 123,
  "adjustedPriceCents": 50000,
  "internalCostCents": 25000
}
```

### Step 2: Initiate Checkout

The customer (via portal) accepts the offer and initiates checkout at `/api/portal/offers/123/checkout`.

**Request body:**
```json
{
  "agreementVersion": "1.0",
  "checkboxConfirmed": true
}
```

**Expected HTTP flow:**
1. Offer marked as `accepted` in DB
2. `resolveCatalogPricing()` called with:
   - `priceCents: 50000` (retail)
   - `internalCostCents: 25000` (service default, may be overridden per offer)
3. Result: `wholesaleCostCents: 25000`, `retailPriceCents: 50000`, `mspMarginCents: 25000`

### Step 3: Stripe PaymentIntent Creation (add_on branch)

Portal-checkout.ts (line 679-701) creates a PaymentIntent on the MSP's Stripe customer:

```javascript
const pi = await stripe.paymentIntents.create({
  amount: 25000,  // ← WHOLESALE COST, NOT RETAIL
  currency: "usd",
  customer: stripeCustomerId,
  payment_method: defaultPaymentMethod,
  confirm: true,
  off_session: true,
  description: "Wholesale charge: Entra ID Quick-Start Pack (MSP: 42)",
  metadata: {
    offerId: "123",
    customerId: "456",
    mspId: "42",
    serviceClass: "add_on",
  },
});
```

**Verification points:**
- `amount: 25000` (wholesale, not $500 retail)
- `customer: <msp-stripe-customer-id>` (charge MSP's account, not end customer)
- `payment_method: <saved-card-id>` (MSP's default payment method)
- Metadata includes offerId, customerId, mspId for audit trail

**Expected Stripe response:**
```json
{
  "id": "pi_1234567890",
  "status": "succeeded",
  "amount_received": 25000,
  "metadata": {
    "offerId": "123",
    "mspId": "42",
    ...
  }
}
```

### Step 4: Fulfillment Event Emission

After successful Stripe charge, `resolveFulfillment()` is called (portal-checkout.ts line 707-728):

```javascript
await resolveFulfillment({
  fulfillmentTypeKey: "standard",  // From services.fulfillmentTypeKey
  idempotencyKey: `portal_offer_checkout:direct:123:pi_1234567890`,
  trigger: "purchase",
  payload: {
    offerId: 123,
    customerId: 456,
    mspId: 42,
    amountCents: 50000,  // ← RETAIL (customer-facing amount)
    serviceName: "Entra ID Quick-Start Pack",
    serviceClass: "add_on",
    customerEmail: "customer@contoso.com",
    legalAgreementText: "...",
    agreementVersion: "1.0",
    wholesalePriceCharged: 25000,  // ← WHOLESALE (what MSP was charged)
  },
});
```

**Verification:** Check that payload includes both:
- `amountCents: 50000` (retail, customer-facing)
- `wholesalePriceCharged: 25000` (wholesale, what was actually charged)

### Step 5: Fulfillment Queue Entry

The fulfillment event creates a row in `fulfillment_queue`:

**Expected DB state:**
```sql
SELECT
  source_type,
  source_id,
  item_title,
  purchase_amount_cents,
  wholesale_charged_cents,
  customer_quote_cents,
  delivery_status
FROM fulfillment_queue
WHERE source_type = 'offer' AND source_id = '123';

-- Expected:
-- offer | 123 | Entra ID Quick-Start Pack | 50000 | 25000 | 50000 | not_started
```

---

## Verification Checklist

Run these checks to confirm the billing path is correct:

### Database Verification

```sql
-- 1. Service exists with correct wholesale cost
SELECT id, name, service_class, internal_cost_cents, price_cents
FROM services
WHERE slug = 'entra-id-quickstart-v1';
-- Expected: internal_cost_cents = 25000

-- 2. Offer was created correctly
SELECT id, adjusted_price_cents, internal_cost_cents
FROM sales_offers
WHERE id = 123;
-- Expected: adjusted_price_cents = 50000, internal_cost_cents = 25000 (or NULL to use service default)

-- 3. Fulfillment queue entry has correct pricing split
SELECT wholesale_charged_cents, customer_quote_cents, purchase_amount_cents
FROM fulfillment_queue
WHERE source_type = 'offer' AND source_id = '123';
-- Expected: 25000, 50000, 50000

-- 4. Offer transitioned to accepted → ... → paid
SELECT state, accepted_at, paid_at
FROM sales_offers
WHERE id = 123;
-- Expected: state = 'paid', accepted_at and paid_at both set
```

### Stripe Verification

In Stripe Dashboard (test mode):

1. **Customers → [MSP Stripe Customer ID]**
   - Verify PaymentIntent appears with `amount: 25000`
   - Metadata shows `offerId: 123`, `mspId: 42`
   - Status: `succeeded`

2. **Payments → Search by Payment Intent ID**
   - Verify charge is `$2.50` (25000 cents)
   - Fee breakdown shows platform's cut
   - Description: "Wholesale charge: Entra ID Quick-Start Pack (MSP: 42)"

### Application Logs

Check server logs for:

```
INFO portal-checkout: offer checkout flow initiated
     offerId=123, customerId=456, mspId=42, serviceClass=add_on

INFO portal-checkout: pricing resolved
     retailPriceCents=50000, wholesaleCostCents=25000, mspMarginCents=25000

INFO portal-checkout: PaymentIntent succeeded
     piId=pi_1234567890, amount=25000

INFO portal-checkout: fulfillment event emitted
     fulfillmentTypeKey=standard, payload.wholesalePriceCharged=25000
```

---

## Failure Scenarios & Troubleshooting

### Scenario 1: Wrong Charge Amount

**Symptom:** Stripe charged $500 (retail) instead of $250 (wholesale)

**Root cause:** `resolveCatalogPricing()` not being called, or `internalCostCents` not set correctly

**Fix:**
1. Verify `services.internal_cost_cents = 25000` for quickstart service
2. Check portal-checkout.ts line 640 is being executed
3. Inspect logs: should show `wholesaleCostCents: 25000`

### Scenario 2: Charged Wrong Account

**Symptom:** Charge appears on end-customer's Stripe account, not MSP's account

**Root cause:** `stripeCustomerId` resolves to customer instead of MSP

**Fix:**
1. Verify MSP has `msp_stripe_customer_id` set in DB
2. Check portal-checkout.ts line 605-625 (stripeCustomerId resolution)
3. Ensure `getMspDefaultPaymentMethod()` returns MSP's saved card, not customer's

### Scenario 3: Fulfillment Event Not Emitted

**Symptom:** Stripe charge succeeds, but no row appears in fulfillment_queue

**Root cause:** `fulfillmentTypeKey` is null or `resolveFulfillment()` fails silently

**Fix:**
1. Verify `services.fulfillment_type_key` is set (should be "standard" or custom key)
2. Check logs for errors in `resolveFulfillment()` call
3. Verify `fulfillment_types` table has row matching the key

---

## Post-Test Cleanup

After successful test, revert Stripe test mode data:

```sql
-- Cancel the test offer (if needed for repeated testing)
UPDATE sales_offers SET state = 'cancelled' WHERE id = 123;

-- Or delete if using ephemeral test data
DELETE FROM fulfillment_queue WHERE source_id = '123';
DELETE FROM sales_offers WHERE id = 123;
```

---

## Sign-Off

✅ **Test Pass Criteria:**
- [ ] Stripe test charge for $250 (wholesale) succeeds
- [ ] MSP's account charged, not customer's
- [ ] Fulfillment queue entry created with correct pricing split (25000 wholesale, 50000 retail)
- [ ] Offer state transitions: accepted → ... → paid
- [ ] resolveCatalogPricing() produces margin: $500 retail - $250 wholesale = $250 MSP margin
- [ ] All server logs show expected flow without errors

**Test Date:** ___________  
**Tester:** ___________  
**Result:** ✅ PASS / ❌ FAIL

---

## References

- **Billing Implementation:** `artifacts/api-server/src/routes/portal-checkout.ts` (lines 640-710)
- **Pricing Resolution:** `artifacts/api-server/src/lib/catalog-pricing.ts`
- **Service Schema:** `lib/db/src/schema/index.ts` (line 130-240, servicesTable)
- **Migration:** `lib/db/drizzle/0195_baseline_templates_quickstart_data.sql`
