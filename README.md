# PayGate Node.js SDK

Node.js/TypeScript client for [PayGate](https://github.com/cuongcds/paygate-docs), a multi-tenant payment gateway. See that repo for the full, language-agnostic API reference this SDK wraps.

## Install

```bash
npm install @cuongcds/paygate-node
```

## Usage — HMAC (server-to-server)

Use this when your own backend calls PayGate — never embed `apiSecret` in a mobile app or browser bundle.

```ts
import { Client, PayGateError } from '@cuongcds/paygate-node';

const client = Client.withHmac(
  'https://payments.example.com',
  'pgk_your_api_key',
  'your_api_secret'
);

try {
  const result = await client.createCheckoutSession({
    external_ref: 'user-42',
    mode: 'subscription',
    price_id: 'price_abc123', // from createPlan()/listPlans()
    customer_id: 'cus_abc123', // from createCustomer()
    success_url: 'https://yourapp.com/success',
    cancel_url: 'https://yourapp.com/cancel',
  });

  res.redirect(result.checkout_url);
} catch (e) {
  if (e instanceof PayGateError) {
    // e.errorCode is one of the codes in
    // https://github.com/cuongcds/paygate-docs/blob/main/documents/05-errors.md
    console.log(`Could not start checkout: ${e.errorCode} — ${e.message}`);
  }
}
```

## Usage — Firebase ID Token (client calls PayGate directly)

Use this when your client already authenticates end users with Firebase Auth. `external_ref` is derived from the token automatically — never pass it.

```ts
import { Client } from '@cuongcds/paygate-node';

const client = Client.withFirebaseIdToken(
  'https://payments.example.com',
  firebaseIdToken // from your client, e.g. a mobile app's Authorization header
);

const subscription = await client.getSubscription(currentUserUid);
```

## Checking subscription status

```ts
import { Client, PayGateError } from '@cuongcds/paygate-node';

try {
  const subscription = await client.getSubscription('user-42');
  // {
  //   plan_ref: 'premium', plan_id: 'plan_…', price_id: 'price_…', customer_id: 'cus_…',
  //   status: 'active', current_period_end: '2026-04-15 00:00:00',
  //   in_trial: false, trial_ends_at: null
  // }
} catch (e) {
  if (e instanceof PayGateError && e.errorCode === 'not_found') {
    // user has never checked out — not necessarily an error in your flow
  }
}
```

## Customers

A subscription checkout needs a customer. Writes use HMAC auth.

```ts
const customer = await client.createCustomer({
  name: 'Nguyen Van A',
  email: 'a@example.com',
  cc_emails: ['billing@example.com'],
  merchant_customer_id: 'user-42', // your own id, optional
  locale: 'vi', // 'en' | 'vi'
});

await client.getCustomer(customer.id);
await client.updateCustomer(customer.id, { locale: 'en' }); // partial update
```

## Plans and prices

A plan holds many prices on sale at once (e.g. monthly, half-year, yearly). Plan writes are HMAC only.

```ts
const plan = await client.createPlan({
  code: 'premium',
  name: 'Premium',
  prices: [
    {
      name: 'Monthly',
      amount: 199000,
      currency: 'VND',
      interval_unit: 'month',
      interval_count: 1,
      trial: { amount: 0, interval_unit: 'day', interval_count: 7 },
    },
    { name: 'Half-year', amount: 1090000, currency: 'VND', interval_unit: 'month', interval_count: 6 },
    { name: 'Yearly', amount: 1990000, currency: 'VND', interval_unit: 'year', interval_count: 1 },
  ],
});

const active = await client.listPlans({ status: 'active' }); // or listPlans() for all
await client.getPlan(plan.id);
await client.updatePlan(plan.id, { description: 'All features' });
await client.addPlanPrice(plan.id, { amount: 99000, currency: 'VND', interval_unit: 'week', interval_count: 1 });
await client.updatePlanPrice(plan.id, plan.prices[0].id, { status: 'archived' });
```

## Subscription checkout with a price

For `mode: 'subscription'`, send `price_id` + `customer_id` (optionally `skip_trial`, `payment_method`, `success_url`, `cancel_url`, `external_ref`). Amount, currency and interval come from the price — do **not** send `plan_ref`, `amount`, `currency`, `interval`, `interval_count` or `plan_id`. The response is `{ checkout_url, activated, trial }`.

```ts
const session = await client.createCheckoutSession({
  mode: 'subscription',
  price_id: plan.prices[2].id,
  customer_id: customer.id,
  external_ref: 'user-42',
  skip_trial: false,
});
// session.activated — true when no payment was needed; session.trial — the applied trial or null
```

One-time payments (`mode: 'payment'`) keep `plan_ref`, `amount`, `currency`, `success_url` and `cancel_url`.

## Changing a subscription's customer or price

```ts
await client.setSubscriptionCustomer('user-42', 'cus_abc123');
await client.setSubscriptionPrice('user-42', 'price_xyz789'); // HMAC only, effective from the next renewal
```

## Verifying a checkout redirect

`success_url`/`cancel_url` come back with `paygate_transaction_id`/`paygate_external_ref`/`paygate_status` appended — but that redirect alone is never proof of payment (it's a client-side navigation, not a signed confirmation). Verify server-side before unlocking anything:

```ts
import { Client, PayGateError } from '@cuongcds/paygate-node';

// From your success_url handler: req.query.paygate_transaction_id, req.query.paygate_external_ref
try {
  const transaction = await client.getTransaction(req.query.paygate_transaction_id as string);

  if (transaction.external_ref !== req.query.paygate_external_ref) {
    throw new Error('Transaction does not belong to the expected user.');
  }
  if (transaction.status !== 'completed') {
    // 'pending'/'failed'/'canceled' — do not unlock anything yet
  }
} catch (e) {
  if (e instanceof PayGateError && e.errorCode === 'not_found') {
    // id doesn't exist, or belongs to a different app; treat as unverified
  }
}
```

This also covers one-time payments (`mode: 'payment'`), which never create a subscription record — `getSubscription()` alone can't verify those.

## Error handling

Every non-2xx PayGate response throws `PayGateError`:

```ts
import { PayGateError } from '@cuongcds/paygate-node';

try {
  await client.createCheckoutSession({ ... });
} catch (e) {
  if (e instanceof PayGateError) {
    e.errorCode;   // e.g. "invalid_card_details"
    e.message;     // human-readable message from PayGate
    e.httpStatus;  // e.g. 400
  }
}
```

A request that never reached PayGate at all (DNS, timeout, connection refused) throws `TransportError` instead — treat this as a network problem, not a PayGate-side rejection.

## Testing your integration

`createCheckoutSession()` never accepts a `test_card_code` and never resolves a payment result itself — it only ever returns a `checkout_url`. To test without a real Stripe account, call it on an app whose environment allows the Test Payment Method (`test`/`staging`), with or without `payment_method: 'test'`; open the returned `checkout_url` (PayGate's own hosted picker page) and choose **Test Payment Method** there with one of the documented card codes — see [Testing without a real Stripe account](https://github.com/cuongcds/paygate-docs/blob/main/documents/03.04-testing.md).

```ts
const session = await client.createCheckoutSession({
  external_ref: 'user-42',
  plan_ref: 'premium_1m',
  amount: 100000,
  currency: 'VND',
  mode: 'payment',
  success_url: 'https://yourapp.com/success',
  cancel_url: 'https://yourapp.com/cancel',
  payment_method: 'test',
});
// Open session.checkout_url in a browser to pick Test Payment Method there.
```

## Requirements

- Node.js >= 16

## More examples

See [`examples/`](examples/) for runnable scripts, including [`subscription-flow.ts`](examples/subscription-flow.ts) (customer, plan with 3 prices, checkout, poll) and [`verify-transaction.ts`](examples/verify-transaction.ts) for the redirect-verification flow above.

## Development

```bash
npm install
npm test     # runs the Vitest suite
npm run build
```
