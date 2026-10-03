import { request as httpRequest } from 'http';
import { request as httpsRequest, RequestOptions } from 'https';
import { URL } from 'url';
import { HmacSigner } from './hmacSigner';
import { PayGateError, TransportError } from './errors';

export type IntervalUnit = 'day' | 'week' | 'month' | 'year';

/** Introductory period charged before the first regular renewal. */
export interface Trial {
  amount: number;
  interval_unit: IntervalUnit;
  interval_count: number;
}

export interface Customer {
  /** Public id, e.g. "cus_…". */
  id: string;
  name: string;
  email: string;
  cc_emails: string[];
  bcc_emails: string[];
  merchant_customer_id: string | null;
  locale: 'en' | 'vi';
  created_at: string;
  updated_at: string;
}

export interface CreateCustomerParams {
  name: string;
  email: string;
  cc_emails?: string[];
  bcc_emails?: string[];
  merchant_customer_id?: string;
  locale?: 'en' | 'vi';
}

/** Every field is optional — only the fields sent are changed. */
export type UpdateCustomerParams = Partial<CreateCustomerParams>;

/** A price as sent when creating a plan or adding a price to one. */
export interface PriceParams {
  name?: string;
  amount: number;
  currency: string;
  interval_unit: IntervalUnit;
  interval_count: number;
  trial?: Trial | null;
}

export interface Price {
  /** Public id, e.g. "price_…". */
  id: string;
  name: string | null;
  amount: number;
  currency: string;
  interval_unit: IntervalUnit;
  interval_count: number;
  trial: Trial | null;
  status: 'active' | 'archived';
  created_at: string;
}

export interface Plan {
  /** Public id, e.g. "plan_…". */
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  prices: Price[];
  created_at: string;
  updated_at: string;
}

export interface CreatePlanParams {
  code: string;
  name: string;
  description?: string;
  prices: PriceParams[];
}

export interface UpdatePlanParams {
  name?: string;
  description?: string;
  status?: 'active' | 'archived';
}

export interface UpdatePriceParams {
  name?: string;
  status?: 'active' | 'archived';
}

export interface ListPlansParams {
  status?: 'active' | 'archived';
}

/** One-time payment checkout. */
export interface CreatePaymentCheckoutSessionParams {
  mode: 'payment';
  plan_ref: string;
  amount: number;
  currency: string;
  success_url: string;
  cancel_url: string;
  external_ref?: string;
  /** "stripe", "payos", or "test" (see createCheckoutSession docs). */
  payment_method?: string;
  [key: string]: unknown;
}

/**
 * Subscription checkout. Amount, currency and interval come from the price,
 * so plan_ref/amount/currency/interval/interval_count/plan_id must not be sent.
 */
export interface CreateSubscriptionCheckoutSessionParams {
  mode: 'subscription';
  price_id: string;
  customer_id: string;
  /** Charge the first period right away even if the price has a trial. */
  skip_trial?: boolean;
  success_url?: string;
  cancel_url?: string;
  external_ref?: string;
  /** "stripe", "payos", or "test" (see createCheckoutSession docs). */
  payment_method?: string;
}

export type CreateCheckoutSessionParams =
  | CreatePaymentCheckoutSessionParams
  | CreateSubscriptionCheckoutSessionParams;

export interface CheckoutSession {
  checkout_url: string;
  /** Subscription mode only: true when no payment was needed (e.g. free trial). */
  activated?: boolean;
  /** Subscription mode only: the trial that applies, or null. */
  trial?: Trial | null;
  [key: string]: unknown;
}

export interface SubscriptionState {
  plan_ref: string;
  plan_id: string | null;
  price_id: string | null;
  customer_id: string | null;
  status: string;
  current_period_end: string | null;
  in_trial: boolean;
  trial_ends_at: string | null;
  [key: string]: unknown;
}

/** @deprecated Use SubscriptionState. */
export type Subscription = SubscriptionState;

export interface Transaction {
  transaction_id: number;
  external_ref: string;
  plan_ref: string;
  amount: number;
  currency: string;
  mode: string;
  status: string;
  created_at: string;
  [key: string]: unknown;
}

/**
 * PayGate API client — see https://github.com/cuongcds/paygate-docs for the
 * full API reference this wraps.
 *
 * Construct with exactly one auth strategy:
 *   Client.withHmac(baseUrl, apiKey, apiSecret)
 *   Client.withFirebaseIdToken(baseUrl, idToken)
 */
export class Client {
  private constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | null,
    private readonly signer: HmacSigner | null,
    private readonly bearerToken: string | null
  ) {}

  static withHmac(baseUrl: string, apiKey: string, apiSecret: string): Client {
    return new Client(baseUrl.replace(/\/+$/, ''), apiKey, new HmacSigner(apiSecret), null);
  }

  static withFirebaseIdToken(baseUrl: string, idToken: string): Client {
    return new Client(baseUrl.replace(/\/+$/, ''), null, null, idToken);
  }

  /**
   * POST /api/v1/checkout-sessions — see documents/03.01-checkout-sessions.md.
   *
   * Two shapes, selected by `mode`:
   *  - `mode: 'subscription'` — send `price_id` + `customer_id` (optionally
   *    `skip_trial`, `success_url`, `cancel_url`, `external_ref`,
   *    `payment_method`). Never send plan_ref/amount/currency/interval/
   *    interval_count/plan_id: they are derived from the price. Returns
   *    `{ checkout_url, activated, trial }`.
   *  - `mode: 'payment'` — send `plan_ref`, `amount`, `currency`,
   *    `success_url`, `cancel_url`.
   *
   * `payment_method` is optional (`"stripe"`, `"payos"`, or `"test"`) — omit
   * it for the normal flow. This endpoint never accepts a `test_card_code`
   * and never resolves a payment result itself: `checkout_url` points to
   * PayGate's hosted picker page, even when `payment_method="test"`, where
   * the `test_card_code` is actually submitted. See documents/03.04-testing.md.
   */
  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSession> {
    return this.request('POST', '/api/v1/checkout-sessions', params) as Promise<CheckoutSession>;
  }

  /** POST /api/v1/customers. */
  async createCustomer(params: CreateCustomerParams): Promise<Customer> {
    return this.request('POST', '/api/v1/customers', params) as unknown as Promise<Customer>;
  }

  /** GET /api/v1/customers/{customerId}. */
  async getCustomer(customerId: string): Promise<Customer> {
    return this.request('GET', `/api/v1/customers/${encodeURIComponent(customerId)}`) as unknown as Promise<Customer>;
  }

  /** PATCH /api/v1/customers/{customerId} — partial update. */
  async updateCustomer(customerId: string, params: UpdateCustomerParams): Promise<Customer> {
    return this.request(
      'PATCH',
      `/api/v1/customers/${encodeURIComponent(customerId)}`,
      params
    ) as unknown as Promise<Customer>;
  }

  /**
   * GET /api/v1/plans[?status=active|archived]. The query string is sent but
   * never signed — the signature covers the path only.
   */
  async listPlans(params: ListPlansParams = {}): Promise<Plan[]> {
    const query = params.status !== undefined ? `status=${encodeURIComponent(params.status)}` : '';
    const data = await this.request('GET', '/api/v1/plans', null, query);
    return (data.plans ?? []) as Plan[];
  }

  /** GET /api/v1/plans/{planId}. */
  async getPlan(planId: string): Promise<Plan> {
    return this.request('GET', `/api/v1/plans/${encodeURIComponent(planId)}`) as unknown as Promise<Plan>;
  }

  /** POST /api/v1/plans — a plan holds many prices on sale at once. HMAC only. */
  async createPlan(params: CreatePlanParams): Promise<Plan> {
    return this.request('POST', '/api/v1/plans', params) as unknown as Promise<Plan>;
  }

  /** PATCH /api/v1/plans/{planId} — rename, re-describe, or archive. HMAC only. */
  async updatePlan(planId: string, params: UpdatePlanParams): Promise<Plan> {
    return this.request('PATCH', `/api/v1/plans/${encodeURIComponent(planId)}`, params) as unknown as Promise<Plan>;
  }

  /** POST /api/v1/plans/{planId}/prices — put another price on sale. HMAC only. */
  async addPlanPrice(planId: string, price: PriceParams): Promise<Plan> {
    return this.request(
      'POST',
      `/api/v1/plans/${encodeURIComponent(planId)}/prices`,
      price
    ) as unknown as Promise<Plan>;
  }

  /** PATCH /api/v1/plans/{planId}/prices/{priceId} — rename or archive a price. HMAC only. */
  async updatePlanPrice(planId: string, priceId: string, params: UpdatePriceParams): Promise<Plan> {
    return this.request(
      'PATCH',
      `/api/v1/plans/${encodeURIComponent(planId)}/prices/${encodeURIComponent(priceId)}`,
      params
    ) as unknown as Promise<Plan>;
  }

  /**
   * GET /api/v1/subscriptions/{externalRef} — see documents/03.02-subscriptions.md.
   */
  async getSubscription(externalRef: string): Promise<SubscriptionState> {
    return this.request(
      'GET',
      `/api/v1/subscriptions/${encodeURIComponent(externalRef)}`
    ) as Promise<SubscriptionState>;
  }

  /** PUT /api/v1/subscriptions/{externalRef}/customer — attach a customer. */
  async setSubscriptionCustomer(externalRef: string, customerId: string): Promise<SubscriptionState> {
    return this.request('PUT', `/api/v1/subscriptions/${encodeURIComponent(externalRef)}/customer`, {
      customer_id: customerId,
    }) as Promise<SubscriptionState>;
  }

  /**
   * PUT /api/v1/subscriptions/{externalRef}/plan — switch to another price,
   * effective from the next renewal. HMAC only.
   */
  async setSubscriptionPrice(externalRef: string, priceId: string): Promise<SubscriptionState> {
    return this.request('PUT', `/api/v1/subscriptions/${encodeURIComponent(externalRef)}/plan`, {
      price_id: priceId,
    }) as Promise<SubscriptionState>;
  }

  /**
   * GET /api/v1/transactions/{transactionId} — see documents/03.05-transactions.md.
   * Use this to verify the paygate_transaction_id/paygate_external_ref query
   * params PayGate appends to your success_url/cancel_url before trusting
   * the redirect.
   */
  async getTransaction(transactionId: number | string): Promise<Transaction> {
    return this.request(
      'GET',
      `/api/v1/transactions/${encodeURIComponent(String(transactionId))}`
    ) as Promise<Transaction>;
  }

  private async request(
    method: string,
    path: string,
    body: object | null = null,
    query = ''
  ): Promise<Record<string, unknown>> {
    const rawBody = body === null ? '' : JSON.stringify(body);
    // The signature covers the path only, never the query string.
    const url = new URL(this.baseUrl + path + (query ? `?${query}` : ''));
    const timestamp = Math.floor(Date.now() / 1000);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.bearerToken !== null) {
      headers['Authorization'] = `Bearer ${this.bearerToken}`;
    } else {
      const signature = this.signer!.sign(method, path, rawBody, timestamp);
      headers['X-App-Key'] = this.apiKey!;
      headers['X-Timestamp'] = String(timestamp);
      headers['X-Signature'] = signature;
    }
    if (body !== null) {
      headers['Content-Length'] = String(Buffer.byteLength(rawBody));
    }

    const responseBody = await this.send(url, method, headers, body !== null ? rawBody : null);

    let decoded: unknown;
    try {
      decoded = JSON.parse(responseBody.body);
    } catch {
      throw new TransportError('PayGate returned a non-JSON or unexpected response.');
    }

    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      !('success' in decoded)
    ) {
      throw new TransportError('PayGate returned a non-JSON or unexpected response.');
    }

    const envelope = decoded as {
      success: boolean;
      data?: Record<string, unknown>;
      error?: { code?: string; message?: string };
    };

    if (envelope.success === true) {
      return envelope.data ?? {};
    }

    const error = envelope.error ?? {};
    throw new PayGateError(
      error.code ?? 'unknown_error',
      error.message ?? 'PayGate returned an error with no message.',
      responseBody.status || 400
    );
  }

  private send(
    url: URL,
    method: string,
    headers: Record<string, string>,
    body: string | null
  ): Promise<{ status: number; body: string }> {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const options: RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers,
      timeout: 30_000,
    };

    return new Promise((resolve, reject) => {
      const req = transport(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      });

      req.on('timeout', () => req.destroy(new Error('Request to PayGate timed out.')));
      req.on('error', (err) => reject(new TransportError(`Request to PayGate failed: ${err.message}`)));

      if (body !== null) {
        req.write(body);
      }
      req.end();
    });
  }
}
