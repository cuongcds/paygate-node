/**
 * Run: npx ts-node examples/verify-transaction.ts <transaction_id> <expected_external_ref>
 * Requires PAYGATE_BASE_URL / PAYGATE_API_KEY / PAYGATE_API_SECRET env vars.
 *
 * Simulates what your success_url handler should do with the
 * paygate_transaction_id/paygate_external_ref query params PayGate appends
 * to the redirect — never trust the redirect itself as proof of payment.
 */

import { Client, PayGateError } from '../src';

const transactionId = process.argv[2];
const expectedExternalRef = process.argv[3];
if (!transactionId || !expectedExternalRef) {
  console.error('Usage: ts-node verify-transaction.ts <transaction_id> <expected_external_ref>');
  process.exit(1);
}

const client = Client.withHmac(
  process.env.PAYGATE_BASE_URL || 'https://payments.example.com',
  process.env.PAYGATE_API_KEY || 'pgk_your_api_key',
  process.env.PAYGATE_API_SECRET || 'your_api_secret'
);

async function main() {
  let transaction;
  try {
    transaction = await client.getTransaction(transactionId as string);
  } catch (e) {
    if (e instanceof PayGateError) {
      if (e.errorCode === 'not_found') {
        console.log(`No transaction found for id '${transactionId}' — do not unlock anything.`);
        process.exit(1);
      }
      console.log(`PayGate error: ${e.errorCode} — ${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  if (transaction.external_ref !== expectedExternalRef) {
    console.log(
      `Mismatch: transaction belongs to '${transaction.external_ref}', not '${expectedExternalRef}' — do not unlock anything.`
    );
    process.exit(1);
  }

  if (transaction.status !== 'completed') {
    console.log(`Transaction status is '${transaction.status}', not completed — do not unlock anything.`);
    process.exit(0);
  }

  console.log(`Verified: transaction ${transaction.transaction_id} for '${transaction.external_ref}' is completed.`);
  console.log(JSON.stringify(transaction, null, 2));
}

main();
