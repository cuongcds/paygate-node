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
    plan_ref: 'premium_1m',
    amount: 199000,
    currency: 'VND',
    mode: 'subscription',
    interval: 'month',
    interval_count: 1,
    success_url: 'https://yourapp.com/success',
    cancel_url: 'https://yourapp.com/cancel',
  });

  res.redirect(result.checkout_url as string);
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
  // { plan_ref: 'premium_1m', status: 'active', current_period_end: '2026-04-15 00:00:00' }
} catch (e) {
  if (e instanceof PayGateError && e.errorCode === 'not_found') {
    // user has never checked out — not necessarily an error in your flow
  }
}
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

`createCheckoutSession()` never accepts `payment_method: 'test'` or a `test_card_code` — it only ever creates a pending transaction and returns a `checkout_url`, never a payment result. To test without a real Stripe account, call it without `payment_method` on an app whose environment allows the Test Payment Method (`test`/`staging`); open the returned `checkout_url` (PayGate's own hosted picker page) and choose **Test Payment Method** there with one of the documented card codes — see [Testing without a real Stripe account](https://github.com/cuongcds/paygate-docs/blob/main/documents/03.04-testing.md).

```ts
const session = await client.createCheckoutSession({
  external_ref: 'user-42',
  plan_ref: 'premium_1m',
  amount: 100000,
  currency: 'VND',
  mode: 'payment',
  success_url: 'https://yourapp.com/success',
  cancel_url: 'https://yourapp.com/cancel',
});
// Open session.checkout_url in a browser to pick Test Payment Method there.
```

## Requirements

- Node.js >= 16

## More examples

See [`examples/`](examples/) for runnable scripts, including [`verify-transaction.ts`](examples/verify-transaction.ts) for the redirect-verification flow above.

## Development

```bash
npm install
npm test     # runs the Vitest suite
npm run build
```
