/**
 * Run: npx ts-node examples/hmac-checkout.ts
 * Requires PAYGATE_BASE_URL / PAYGATE_API_KEY / PAYGATE_API_SECRET env vars.
 */

import { Client, PayGateError, TransportError } from '../src';

const client = Client.withHmac(
  process.env.PAYGATE_BASE_URL || 'https://payments.example.com',
  process.env.PAYGATE_API_KEY || 'pgk_your_api_key',
  process.env.PAYGATE_API_SECRET || 'your_api_secret'
);

async function main() {
  try {
    const result = await client.createCheckoutSession({
      external_ref: 'example-user-1',
      plan_ref: 'premium_1m',
      amount: 199000,
      currency: 'VND',
      mode: 'subscription',
      interval: 'month',
      interval_count: 1,
      success_url: 'https://yourapp.com/success',
      cancel_url: 'https://yourapp.com/cancel',
    });

    console.log(`Redirect the user to: ${result.checkout_url}`);
  } catch (e) {
    if (e instanceof PayGateError) {
      console.log(`PayGate rejected the request: ${e.errorCode} — ${e.message}`);
    } else if (e instanceof TransportError) {
      console.log(`Could not reach PayGate: ${e.message}`);
    } else {
      throw e;
    }
  }
}

main();
