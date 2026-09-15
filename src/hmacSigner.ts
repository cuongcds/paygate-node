import { createHmac } from 'crypto';

/**
 * Computes the X-Signature header for the HMAC auth strategy — see
 * documents/02-authentication.md. Signed string is
 * "{timestamp}.{METHOD}.{path}.{rawBody}", HMAC-SHA256, lowercase hex.
 */
export class HmacSigner {
  constructor(private readonly apiSecret: string) {}

  /**
   * @param path Path only, no query string, with a leading slash
   *             (e.g. "/api/v1/checkout-sessions").
   * @param rawBody Exact request body bytes ("" for a GET with no body).
   */
  sign(method: string, path: string, rawBody: string, timestamp: number): string {
    const signedPayload = `${timestamp}.${method.toUpperCase()}.${path}.${rawBody}`;
    return createHmac('sha256', this.apiSecret).update(signedPayload).digest('hex');
  }
}
