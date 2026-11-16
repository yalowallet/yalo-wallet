export type P2PSide = 'buy' | 'sell';
export type AdvertisementStatus = 'active' | 'paused' | 'cancelled';
export type OrderStatus =
  | 'awaiting_escrow'
  | 'awaiting_payment'
  | 'payment_reported'
  | 'completed'
  | 'cancelled'
  | 'disputed';

export const USDT_DECIMALS = 6;
export const FEE_BPS = 0;
export const BPS_DENOMINATOR = 10_000n;

export function parseUsdtMicros(input: unknown): bigint {
  if (typeof input !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(input)) {
    throw new Error('USDT amount must be a positive decimal with at most 6 places.');
  }
  const [whole, fraction = ''] = input.split('.');
  const micros = BigInt(whole) * 10n ** BigInt(USDT_DECIMALS) + BigInt(fraction.padEnd(USDT_DECIMALS, '0'));
  if (micros <= 0n) throw new Error('USDT amount must be positive.');
  return micros;
}

export function formatUsdtMicros(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function calculateXof(amountMicros: bigint, rateXofPerUsdt: bigint): bigint {
  if (amountMicros <= 0n || rateXofPerUsdt <= 0n) throw new Error('Amount and XOF rate must be positive.');
  // XOF is an integer currency unit: round half up from USDT micros.
  return (amountMicros * rateXofPerUsdt + 500_000n) / 1_000_000n;
}

export function calculateFeeXof(totalXof: bigint, feeBps = FEE_BPS): bigint {
  if (totalXof < 0n || !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) throw new Error('Invalid fee configuration.');
  return (totalXof * BigInt(feeBps) + BPS_DENOMINATOR / 2n) / BPS_DENOMINATOR;
}

const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
  awaiting_escrow: ['awaiting_payment', 'cancelled', 'disputed'],
  awaiting_payment: ['payment_reported', 'cancelled', 'disputed'],
  payment_reported: ['completed', 'disputed'],
  completed: [],
  cancelled: [],
  disputed: ['completed', 'cancelled']
};

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!transitions[from].includes(to)) throw new Error(`Invalid order transition: ${from} -> ${to}.`);
}

export interface EscrowReservation {
  reference: string;
  transactionId: string;
}

/** An adapter must verify actual on-chain USDT collateral. A database ledger alone is not escrow. */
export interface EscrowProvider {
  readonly configured: boolean;
  reserve(input: { orderId: string; sellerPrivyId: string; amountUsdtMicros: bigint }): Promise<EscrowReservation>;
  release(input: { orderId: string; reservationReference: string; buyerPrivyId: string }): Promise<{ transactionId: string }>;
  refund(input: { orderId: string; reservationReference: string; sellerPrivyId: string }): Promise<{ transactionId: string }>;
}

export interface XofPaymentProvider {
  readonly id: string;
  readonly configured: boolean;
  readonly supportedCurrencies: readonly string[];
  verifyWebhook(request: Request, rawBody: string): Promise<{ eventId: string; orderId: string; status: 'settled' | 'failed' }>;
}

export class IntegrationUnavailableError extends Error {
  readonly status = 503;
  constructor(message: string) { super(message); this.name = 'IntegrationUnavailableError'; }
}

export class UnconfiguredEscrowProvider implements EscrowProvider {
  readonly configured = false;
  async reserve(): Promise<never> { throw new IntegrationUnavailableError('USDT escrow provider is not configured; no order was placed.'); }
  async release(): Promise<never> { throw new IntegrationUnavailableError('USDT escrow release is unavailable until an audited provider is configured.'); }
  async refund(): Promise<never> { throw new IntegrationUnavailableError('USDT escrow refund is unavailable until an audited provider is configured.'); }
}

export class UnconfiguredXofPaymentProvider implements XofPaymentProvider {
  readonly id = 'unconfigured';
  readonly configured = false;
  readonly supportedCurrencies: readonly string[] = [];
  async verifyWebhook(): Promise<never> { throw new IntegrationUnavailableError('No XOF payment provider is configured.'); }
}
