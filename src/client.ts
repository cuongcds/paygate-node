import { request as httpRequest } from 'http';
import { request as httpsRequest, RequestOptions } from 'https';
import { URL } from 'url';
import { HmacSigner } from './hmacSigner';
import { PayGateError, TransportError } from './errors';

export interface CreateCheckoutSessionParams {
  plan_ref: string;
  amount: number;
  currency: string;
  mode: 'payment' | 'subscription';
  success_url: string;
  cancel_url: string;
  external_ref?: string;
  interval?: string;
  interval_count?: number;
  /** "stripe" or "payos" only — never "test" (see createCheckoutSession docs). */
  payment_method?: string;
  [key: string]: unknown;
}

export interface Subscription {
  plan_ref: string;
  status: string;
  current_period_end: string | null;
  [key: string]: unknown;
}

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
   * `payment_method` is optional and, when sent, must be `"stripe"` or
   * `"payos"` — omit it entirely for the normal flow. This endpoint never
   * accepts `"test"` or a `test_card_code`, and never resolves a payment
   * result: it always returns just `{ checkout_url }`. To exercise the Test
   * Payment Method, open the returned `checkout_url` (PayGate's hosted
   * picker page) and choose it there — see documents/03.04-testing.md.
   */
  async createCheckoutSession(
    params: CreateCheckoutSessionParams
  ): Promise<Record<string, unknown>> {
    return this.request('POST', '/api/v1/checkout-sessions', params);
  }

  /**
   * GET /api/v1/subscriptions/{externalRef} — see documents/03.02-subscriptions.md.
   */
  async getSubscription(externalRef: string): Promise<Subscription> {
    return this.request('GET', `/api/v1/subscriptions/${encodeURIComponent(externalRef)}`) as Promise<Subscription>;
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
    body: Record<string, unknown> | null = null
  ): Promise<Record<string, unknown>> {
    const rawBody = body === null ? '' : JSON.stringify(body);
    const url = new URL(this.baseUrl + path);
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
