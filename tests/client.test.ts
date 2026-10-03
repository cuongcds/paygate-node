import { createServer, IncomingMessage, Server } from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '../src/client';
import { HmacSigner } from '../src/hmacSigner';
import { PayGateError, TransportError } from '../src/errors';

interface Captured {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

const SECRET = 'test_secret';
const KEY = 'pgk_test';

let server: Server;
let baseUrl: string;
let last: Captured;
let reply: { status: number; payload: unknown };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      last = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(typeof reply.payload === 'string' ? reply.payload : JSON.stringify(reply.payload));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  reply = { status: 200, payload: { success: true, data: { ok: true } } };
});

const client = () => Client.withHmac(baseUrl, KEY, SECRET);

function assertSigned(method: string, pathWithoutQuery: string, rawBody: string) {
  expect(last.method).toBe(method);
  expect(last.headers['x-app-key']).toBe(KEY);
  const timestamp = Number(last.headers['x-timestamp']);
  expect(Number.isInteger(timestamp)).toBe(true);
  expect(last.headers['x-signature']).toBe(
    new HmacSigner(SECRET).sign(method, pathWithoutQuery, rawBody, timestamp)
  );
  expect(last.body).toBe(rawBody);
}

describe('Client new endpoints', () => {
  const price = { amount: 199000, currency: 'VND', interval_unit: 'month' as const, interval_count: 1 };

  const cases: Array<{
    name: string;
    call: (c: Client) => Promise<unknown>;
    method: string;
    path: string;
    body: object | null;
  }> = [
    {
      name: 'createCustomer',
      call: (c) => c.createCustomer({ name: 'A', email: 'a@example.com', locale: 'vi' }),
      method: 'POST',
      path: '/api/v1/customers',
      body: { name: 'A', email: 'a@example.com', locale: 'vi' },
    },
    {
      name: 'getCustomer',
      call: (c) => c.getCustomer('cus_1'),
      method: 'GET',
      path: '/api/v1/customers/cus_1',
      body: null,
    },
    {
      name: 'updateCustomer',
      call: (c) => c.updateCustomer('cus_1', { locale: 'en' }),
      method: 'PATCH',
      path: '/api/v1/customers/cus_1',
      body: { locale: 'en' },
    },
    {
      name: 'getPlan',
      call: (c) => c.getPlan('plan_1'),
      method: 'GET',
      path: '/api/v1/plans/plan_1',
      body: null,
    },
    {
      name: 'createPlan',
      call: (c) => c.createPlan({ code: 'premium', name: 'Premium', prices: [price] }),
      method: 'POST',
      path: '/api/v1/plans',
      body: { code: 'premium', name: 'Premium', prices: [price] },
    },
    {
      name: 'updatePlan',
      call: (c) => c.updatePlan('plan_1', { status: 'archived' }),
      method: 'PATCH',
      path: '/api/v1/plans/plan_1',
      body: { status: 'archived' },
    },
    {
      name: 'addPlanPrice',
      call: (c) => c.addPlanPrice('plan_1', { ...price, trial: { amount: 0, interval_unit: 'day', interval_count: 7 } }),
      method: 'POST',
      path: '/api/v1/plans/plan_1/prices',
      body: { ...price, trial: { amount: 0, interval_unit: 'day', interval_count: 7 } },
    },
    {
      name: 'updatePlanPrice',
      call: (c) => c.updatePlanPrice('plan_1', 'price_1', { name: 'Monthly', status: 'archived' }),
      method: 'PATCH',
      path: '/api/v1/plans/plan_1/prices/price_1',
      body: { name: 'Monthly', status: 'archived' },
    },
    {
      name: 'getSubscription',
      call: (c) => c.getSubscription('user 42'),
      method: 'GET',
      path: '/api/v1/subscriptions/user%2042',
      body: null,
    },
    {
      name: 'setSubscriptionCustomer',
      call: (c) => c.setSubscriptionCustomer('user-42', 'cus_1'),
      method: 'PUT',
      path: '/api/v1/subscriptions/user-42/customer',
      body: { customer_id: 'cus_1' },
    },
    {
      name: 'setSubscriptionPrice',
      call: (c) => c.setSubscriptionPrice('user-42', 'price_2'),
      method: 'PUT',
      path: '/api/v1/subscriptions/user-42/plan',
      body: { price_id: 'price_2' },
    },
    {
      name: 'createCheckoutSession (subscription)',
      call: (c) =>
        c.createCheckoutSession({ mode: 'subscription', price_id: 'price_1', customer_id: 'cus_1', skip_trial: true }),
      method: 'POST',
      path: '/api/v1/checkout-sessions',
      body: { mode: 'subscription', price_id: 'price_1', customer_id: 'cus_1', skip_trial: true },
    },
  ];

  for (const tc of cases) {
    it(`${tc.name} sends ${tc.method} ${tc.path} signed`, async () => {
      await tc.call(client());

      expect(last.url).toBe(tc.path);
      const rawBody = tc.body === null ? '' : JSON.stringify(tc.body);
      assertSigned(tc.method, tc.path, rawBody);
    });

    it(`${tc.name} maps PayGate errors to PayGateError`, async () => {
      reply = { status: 404, payload: { success: false, error: { code: 'not_found', message: 'Nope.' } } };

      const err = await tc.call(client()).catch((e) => e);

      expect(err).toBeInstanceOf(PayGateError);
      expect(err.errorCode).toBe('not_found');
      expect(err.message).toBe('Nope.');
      expect(err.httpStatus).toBe(404);
    });
  }

  it('listPlans without a filter has no query string', async () => {
    reply = { status: 200, payload: { success: true, data: { plans: [{ id: 'plan_1' }] } } };

    const plans = await client().listPlans();

    expect(plans).toEqual([{ id: 'plan_1' }]);
    expect(last.url).toBe('/api/v1/plans');
    assertSigned('GET', '/api/v1/plans', '');
  });

  it('listPlans sends the status query but signs the path only', async () => {
    reply = { status: 200, payload: { success: true, data: { plans: [] } } };

    await client().listPlans({ status: 'archived' });

    expect(last.url).toBe('/api/v1/plans?status=archived');
    assertSigned('GET', '/api/v1/plans', '');
  });

  it('returns the unwrapped data object', async () => {
    reply = { status: 200, payload: { success: true, data: { id: 'cus_1', name: 'A' } } };

    await expect(client().getCustomer('cus_1')).resolves.toEqual({ id: 'cus_1', name: 'A' });
  });

  it('throws TransportError on a non-JSON response', async () => {
    reply = { status: 200, payload: 'not json' };

    await expect(client().getCustomer('cus_1')).rejects.toBeInstanceOf(TransportError);
  });

  it('uses a Bearer token instead of HMAC headers for Firebase auth', async () => {
    await Client.withFirebaseIdToken(baseUrl, 'tok').getCustomer('cus_1');

    expect(last.headers['authorization']).toBe('Bearer tok');
    expect(last.headers['x-signature']).toBeUndefined();
  });
});
