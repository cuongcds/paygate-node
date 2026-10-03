/**
 * Run: npx ts-node examples/subscription-flow.ts
 * Requires PAYGATE_BASE_URL / PAYGATE_API_KEY / PAYGATE_API_SECRET env vars.
 *
 * customer -> plan with 3 prices -> checkout with price_id -> poll subscription.
 */

import { Client, PayGateError } from '../src';

const client = Client.withHmac(
  process.env.PAYGATE_BASE_URL || 'https://payments.example.com',
  process.env.PAYGATE_API_KEY || 'pgk_your_api_key',
  process.env.PAYGATE_API_SECRET || 'your_api_secret'
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  try {
    const customer = await client.createCustomer({
      name: 'Nguyen Van A',
      email: 'a@example.com',
      merchant_customer_id: 'user-42',
      locale: 'vi',
    });

    const plan = await client.createPlan({
      code: `premium_${Date.now()}`,
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
    const yearly = plan.prices[2];

    const session = await client.createCheckoutSession({
      mode: 'subscription',
      price_id: yearly.id,
      customer_id: customer.id,
      external_ref: 'user-42',
      success_url: 'https://yourapp.com/success',
      cancel_url: 'https://yourapp.com/cancel',
    });
    console.log(`Open ${session.checkout_url} (activated: ${session.activated}, trial: ${JSON.stringify(session.trial)})`);

    for (let i = 0; i < 20; i++) {
      try {
        const subscription = await client.getSubscription('user-42');
        console.log(`status=${subscription.status} in_trial=${subscription.in_trial}`);
        if (subscription.status === 'active') {
          break;
        }
      } catch (e) {
        if (!(e instanceof PayGateError && e.errorCode === 'not_found')) {
          throw e;
        }
      }
      await sleep(3000);
    }
  } catch (e) {
    if (e instanceof PayGateError) {
      console.log(`PayGate error: ${e.errorCode} — ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

main();
