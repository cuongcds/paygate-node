import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { HmacSigner } from '../src/hmacSigner';

describe('HmacSigner', () => {
  it('matches the reference vector', () => {
    const signer = new HmacSigner('my_secret');

    const signature = signer.sign('POST', '/api/v1/checkout-sessions', '{"a":1}', 1700000000);

    const expected = createHmac('sha256', 'my_secret')
      .update('1700000000.POST./api/v1/checkout-sessions.{"a":1}')
      .digest('hex');
    expect(signature).toBe(expected);
  });

  it('uppercases the method regardless of input case', () => {
    const signer = new HmacSigner('secret');

    expect(signer.sign('post', '/x', '', 1)).toBe(signer.sign('POST', '/x', '', 1));
  });

  it('produces a different signature for a different body', () => {
    const signer = new HmacSigner('secret');

    expect(signer.sign('GET', '/x', 'a', 1)).not.toBe(signer.sign('GET', '/x', 'b', 1));
  });

  it('outputs lowercase hex', () => {
    const signer = new HmacSigner('secret');

    const signature = signer.sign('GET', '/x', '', 1);

    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });
});
