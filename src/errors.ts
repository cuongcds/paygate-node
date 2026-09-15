/**
 * Base error for every error PayGate's API returns (`error.code` in the
 * response envelope) — see documents/05-errors.md. Thrown by Client for any
 * `success: false` response; network/transport failures throw
 * TransportError instead.
 */
export class PayGateError extends Error {
  public readonly errorCode: string;
  public readonly httpStatus: number;

  constructor(errorCode: string, message: string, httpStatus: number) {
    super(message);
    this.name = 'PayGateError';
    this.errorCode = errorCode;
    this.httpStatus = httpStatus;
    Object.setPrototypeOf(this, PayGateError.prototype);
  }
}

/**
 * The request never reached PayGate or no valid HTTP response came back
 * (DNS, timeout, connection refused, malformed body) — as opposed to
 * PayGateError, which means PayGate itself answered with an error.
 */
export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportError';
    Object.setPrototypeOf(this, TransportError.prototype);
  }
}
