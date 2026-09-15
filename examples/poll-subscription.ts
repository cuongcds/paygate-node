/**
 * Run: npx ts-node examples/poll-subscription.ts <external_ref>
 * Requires PAYGATE_BASE_URL / PAYGATE_API_KEY / PAYGATE_API_SECRET env vars.
 */

import { Client, PayGateError } from '../src';

const externalRef = process.argv[2];
if (!externalRef) {
  console.error('Usage: ts-node poll-subscription.ts <external_ref>');
  process.exit(1);
}

const client = Client.withHmac(
  process.env.PAYGATE_BASE_URL || 'https://payments.example.com',
  process.env.PAYGATE_API_KEY || 'pgk_your_api_key',
  process.env.PAYGATE_API_SECRET || 'your_api_secret'
);

async function main() {
  try {
    const subscription = await client.getSubscription(externalRef as string);
    console.log(JSON.stringify(subscription, null, 2));
  } catch (e) {
    if (e instanceof PayGateError) {
      if (e.errorCode === 'not_found') {
        console.log(`No subscription yet for '${externalRef}'.`);
        process.exit(0);
      }
      console.log(`PayGate error: ${e.errorCode} — ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

main();
