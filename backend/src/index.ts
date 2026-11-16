import { authenticate } from './auth';
import {
  assertOrderTransition,
  calculateFeeXof,
  calculateXof,
  formatUsdtMicros,
  IntegrationUnavailableError,
  parseUsdtMicros,
  UnconfiguredEscrowProvider,
  UnconfiguredXofPaymentProvider,
  type AdvertisementStatus,
  type OrderStatus,
  type P2PSide
} from './domain';

interface D1Result { success: boolean; results?: Array<Record<string, unknown>>; meta?: { changes?: number }; }
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result & { results: T[] }>;
  run(): Promise<D1Result>;
}
interface D1Database { prepare(sql: string): D1PreparedStatement; batch<T = D1Result>(statements: D1PreparedStatement[]): Promise<T[]>; }
interface Env {
  DB: D1Database;
  PRIVY_APP_ID: string;
  PRIVY_ISSUER?: string;
  ALLOWED_ORIGIN?: string;
  ENABLED_XOF_PAYMENT_METHODS?: string;
  P2P_ADMIN_SUBJECTS?: string;
  FEE_BPS?: string;
}
interface Principal { privyId: string; }

const escrow = new UnconfiguredEscrowProvider();
const xofPayment = new UnconfiguredXofPaymentProvider();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const fail = (message: string, status = 400) => json({ message }, status);
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function cors(request: Request, env: Env, response: Response): Response {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGIN;
  const headers = new Headers(response.headers);
  if (origin && allowed && origin === allowed) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  }
  return new Response(response.body, { status: response.status, headers });
}

async function bodyJson(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 32_000) throw new Error('Request body too large.');
  const value: unknown = await request.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object required.');
  return value as Record<string, unknown>;
}

async function audit(db: D1Database, actor: string, action: string, entityType: string, entityId: string, details: unknown, request: Request) {
  await db.prepare('INSERT INTO audit_logs (id, actor_privy_id, action, entity_type, entity_id, details_json, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id(), actor, action, entityType, entityId, JSON.stringify(details), request.headers.get('X-Request-Id'), now()).run();
}

async function ensureUser(db: D1Database, principal: Principal) {
  await db.prepare('INSERT INTO users (privy_id, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(privy_id) DO UPDATE SET updated_at = excluded.updated_at')
    .bind(principal.privyId, now(), now()).run();
  await db.prepare('INSERT INTO trader_profiles (privy_id, display_name, reputation_score, completed_orders, created_at, updated_at) VALUES (?, ?, 0, 0, ?, ?) ON CONFLICT(privy_id) DO NOTHING')
    .bind(principal.privyId, `Trader ${principal.privyId.slice(-6)}`, now(), now()).run();
}

function allowedPaymentMethods(env: Env): string[] {
  return (env.ENABLED_XOF_PAYMENT_METHODS || '').split(',').map((x) => x.trim()).filter(Boolean);
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/v1\/p2p/, '') || '/';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (route === '/health' && request.method === 'GET') return json({ status: 'ok', market: 'USDT/XOF', escrowConfigured: escrow.configured, xofPaymentProviderConfigured: xofPayment.configured });
  if (route === '/webhooks/xof' && request.method === 'POST') {
    // Never trust browser assertions. This route remains closed until a provider-specific signature verifier is configured.
    if (!xofPayment.configured) return fail('XOF payment webhook integration is not configured.', 503);
    const raw = await request.text();
    const event = await xofPayment.verifyWebhook(request, raw);
    return json({ received: true, eventId: event.eventId });
  }

  let principal: Principal;
  try { principal = await authenticate(request, env); }
  catch (error) { return fail(error instanceof Error ? error.message : 'Unauthorized.', 401); }
  await ensureUser(env.DB, principal);

  if (route === '/profile' && request.method === 'GET') {
    const profile = await env.DB.prepare('SELECT privy_id, display_name, bio, reputation_score, completed_orders, created_at FROM trader_profiles WHERE privy_id = ?').bind(principal.privyId).first();
    return json({ profile });
  }
  if (route === '/profile' && request.method === 'PATCH') {
    const data = await bodyJson(request);
    if (typeof data.displayName !== 'string' || data.displayName.trim().length < 2 || data.displayName.length > 40 || (data.bio !== undefined && (typeof data.bio !== 'string' || data.bio.length > 240))) return fail('Invalid trader profile.');
    await env.DB.prepare('UPDATE trader_profiles SET display_name = ?, bio = ?, updated_at = ? WHERE privy_id = ?').bind(data.displayName.trim(), typeof data.bio === 'string' ? data.bio.trim() : null, now(), principal.privyId).run();
    await audit(env.DB, principal.privyId, 'profile.update', 'trader_profile', principal.privyId, {}, request);
    return json({ updated: true });
  }

  if (route === '/advertisements' && request.method === 'GET') {
    const mine = url.searchParams.get('mine') === 'true';
    const side = url.searchParams.get('side');
    if (side && side !== 'buy' && side !== 'sell') return fail('Market side must be buy or sell.');
    const predicates = [mine ? 'a.owner_privy_id = ?' : "a.status = 'active'"];
    const params: unknown[] = mine ? [principal.privyId] : [];
    if (side) { predicates.push('a.side = ?'); params.push(side); }
    const rows = await env.DB.prepare(`SELECT a.id, a.side, a.price_xof_per_usdt, a.min_usdt_micros, a.max_usdt_micros, a.available_usdt_micros, a.payment_methods_json, a.status, p.display_name, p.reputation_score, p.completed_orders FROM advertisements a JOIN trader_profiles p ON p.privy_id = a.owner_privy_id WHERE ${predicates.join(' AND ')} ORDER BY a.created_at DESC LIMIT 100`).bind(...params).all();
    return json({ advertisements: rows.results.map((row) => ({
      id: row.id, side: row.side, priceXofPerUsdt: String(row.price_xof_per_usdt), minUsdt: formatUsdtMicros(BigInt(String(row.min_usdt_micros))), maxUsdt: formatUsdtMicros(BigInt(String(row.max_usdt_micros))), availableUsdt: formatUsdtMicros(BigInt(String(row.available_usdt_micros))), paymentMethods: JSON.parse(String(row.payment_methods_json)), status: row.status, merchant: { displayName: row.display_name, rating: Number(row.reputation_score), completedOrders: Number(row.completed_orders) }
    })) });
  }

  if (route === '/advertisements' && request.method === 'POST') {
    const data = await bodyJson(request);
    if (data.side !== 'buy' && data.side !== 'sell') return fail('Side must be buy or sell.');
    const price = typeof data.priceXofPerUsdt === 'string' && /^\d+$/.test(data.priceXofPerUsdt) ? BigInt(data.priceXofPerUsdt) : 0n;
    if (price <= 0n || price > 10_000_000n) return fail('Price must be a positive integer amount of XOF per USDT.');
    let min: bigint, max: bigint;
    try { min = parseUsdtMicros(data.minUsdt); max = parseUsdtMicros(data.maxUsdt); } catch (e) { return fail(e instanceof Error ? e.message : 'Invalid USDT limits.'); }
    if (min > max) return fail('Minimum order must not exceed maximum order.');
    if (!Array.isArray(data.paymentMethods) || data.paymentMethods.length === 0 || data.paymentMethods.some((x) => typeof x !== 'string')) return fail('Choose a configured XOF payment method.');
    const allowed = allowedPaymentMethods(env);
    const methods = [...new Set(data.paymentMethods as string[])];
    if (!allowed.length || methods.some((method) => !allowed.includes(method))) return fail('No requested XOF payment method is configured and enabled.', 503);
    const adId = id();
    const timestamp = now();
    await env.DB.prepare('INSERT INTO advertisements (id, owner_privy_id, side, price_xof_per_usdt, min_usdt_micros, max_usdt_micros, available_usdt_micros, payment_methods_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'active\', ?, ?)')
      .bind(adId, principal.privyId, data.side, price.toString(), min.toString(), max.toString(), max.toString(), JSON.stringify(methods), timestamp, timestamp).run();
    await audit(env.DB, principal.privyId, 'advertisement.create', 'advertisement', adId, { side: data.side, currency: 'XOF' }, request);
    return json({ id: adId, status: 'active' }, 201);
  }

  const adMatch = route.match(/^\/advertisements\/([0-9a-f-]+)$/i);
  if (adMatch && (request.method === 'PATCH' || request.method === 'DELETE')) {
    const adId = adMatch[1];
    const ad = await env.DB.prepare('SELECT owner_privy_id, status FROM advertisements WHERE id = ?').bind(adId).first<{ owner_privy_id: string; status: AdvertisementStatus }>();
    if (!ad) return fail('Advertisement not found.', 404);
    if (ad.owner_privy_id !== principal.privyId) return fail('Not authorized to manage this advertisement.', 403);
    if (request.method === 'DELETE') {
      if (ad.status === 'cancelled') return fail('Advertisement is already cancelled.', 409);
      await env.DB.prepare("UPDATE advertisements SET status = 'cancelled', updated_at = ? WHERE id = ? AND owner_privy_id = ? AND status != 'cancelled'").bind(now(), adId, principal.privyId).run();
      await audit(env.DB, principal.privyId, 'advertisement.cancel', 'advertisement', adId, {}, request);
      return json({ id: adId, status: 'cancelled' });
    }
    const data = await bodyJson(request);
    if (data.status !== 'active' && data.status !== 'paused') return fail('Status must be active or paused.');
    if (ad.status === 'cancelled') return fail('Cancelled advertisements cannot be reactivated.', 409);
    await env.DB.prepare('UPDATE advertisements SET status = ?, updated_at = ? WHERE id = ? AND owner_privy_id = ?').bind(data.status, now(), adId, principal.privyId).run();
    await audit(env.DB, principal.privyId, 'advertisement.status', 'advertisement', adId, { status: data.status }, request);
    return json({ id: adId, status: data.status });
  }

  if (route === '/orders' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT id, side, status, escrow_status, amount_usdt_micros, rate_xof_per_usdt, total_xof, fee_xof, payout_xof, buyer_privy_id, seller_privy_id FROM p2p_orders WHERE buyer_privy_id = ? OR seller_privy_id = ? ORDER BY created_at DESC LIMIT 100').bind(principal.privyId, principal.privyId).all();
    return json({ orders: rows.results.map((row) => ({ id: row.id, side: row.buyer_privy_id === principal.privyId ? 'buy' : 'sell', status: row.status, escrowStatus: row.escrow_status, amountUsdt: formatUsdtMicros(BigInt(String(row.amount_usdt_micros))), rateXofPerUsdt: String(row.rate_xof_per_usdt), totalXof: String(row.total_xof), feeXof: String(row.fee_xof), payoutXof: String(row.payout_xof), availableActions: row.status === 'awaiting_payment' && row.buyer_privy_id === principal.privyId ? ['payment_sent', 'cancel'] : row.status === 'payment_reported' ? ['dispute'] : row.status === 'awaiting_escrow' ? ['cancel'] : [] })) });
  }
  if (route === '/orders' && request.method === 'POST') {
    // No internal balance counter is treated as real collateral. Fail closed until an escrow adapter is configured.
    if (!escrow.configured) throw new IntegrationUnavailableError('USDT escrow is not configured. Orders cannot be opened and no funds were reserved.');
    const data = await bodyJson(request);
    if (typeof data.advertisementId !== 'string') return fail('Advertisement is required.');
    let amount: bigint;
    try { amount = parseUsdtMicros(data.amountUsdt); } catch (e) { return fail(e instanceof Error ? e.message : 'Invalid USDT amount.'); }
    const ad = await env.DB.prepare("SELECT id, owner_privy_id, side, price_xof_per_usdt, min_usdt_micros, max_usdt_micros, available_usdt_micros FROM advertisements WHERE id = ? AND status = 'active'").bind(data.advertisementId).first<Record<string, unknown>>();
    if (!ad) return fail('Active advertisement not found.', 404);
    if (ad.owner_privy_id === principal.privyId) return fail('You cannot open an order against your own advertisement.');
    if (amount < BigInt(String(ad.min_usdt_micros)) || amount > BigInt(String(ad.max_usdt_micros)) || amount > BigInt(String(ad.available_usdt_micros))) return fail('USDT amount is outside this advertisement’s limits or availability.');
    const orderId = id();
    const sellerId = String(ad.side) === 'sell' ? String(ad.owner_privy_id) : principal.privyId;
    const buyerId = String(ad.side) === 'buy' ? String(ad.owner_privy_id) : principal.privyId;
    const rate = BigInt(String(ad.price_xof_per_usdt));
    const total = calculateXof(amount, rate);
    const fee = calculateFeeXof(total, Number(env.FEE_BPS || 0));
    const reservation = await escrow.reserve({ orderId, sellerPrivyId: sellerId, amountUsdtMicros: amount });
    const status: OrderStatus = 'awaiting_escrow';
    const result = await env.DB.prepare("UPDATE advertisements SET available_usdt_micros = CAST(available_usdt_micros AS INTEGER) - ?, updated_at = ? WHERE id = ? AND status = 'active' AND CAST(available_usdt_micros AS INTEGER) >= ?")
      .bind(amount.toString(), now(), String(ad.id), amount.toString()).run();
    if (!result.meta?.changes) {
      await escrow.refund({ orderId, reservationReference: reservation.reference, sellerPrivyId: sellerId });
      return fail('Advertisement inventory changed; retry with a current offer.', 409);
    }
    try {
      await env.DB.prepare('INSERT INTO p2p_orders (id, advertisement_id, buyer_privy_id, seller_privy_id, side, status, escrow_status, escrow_reference, amount_usdt_micros, rate_xof_per_usdt, total_xof, fee_xof, payout_xof, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(orderId, ad.id, buyerId, sellerId, ad.side, status, 'reserved', reservation.reference, amount.toString(), rate.toString(), total.toString(), fee.toString(), (total - fee).toString(), now(), now()).run();
    } catch (error) {
      await env.DB.prepare('UPDATE advertisements SET available_usdt_micros = CAST(available_usdt_micros AS INTEGER) + ?, updated_at = ? WHERE id = ?').bind(amount.toString(), now(), String(ad.id)).run();
      await escrow.refund({ orderId, reservationReference: reservation.reference, sellerPrivyId: sellerId });
      throw error;
    }
    await audit(env.DB, principal.privyId, 'order.create', 'p2p_order', orderId, { amountUsdt: formatUsdtMicros(amount), totalXof: total.toString() }, request);
    return json({ id: orderId, status }, 201);
  }

  const actionMatch = route.match(/^\/orders\/([0-9a-f-]+)\/actions\/([a-z_]+)$/i);
  if (actionMatch && request.method === 'POST') {
    const [, orderId, action] = actionMatch;
    const order = await env.DB.prepare('SELECT * FROM p2p_orders WHERE id = ? AND (buyer_privy_id = ? OR seller_privy_id = ?)').bind(orderId, principal.privyId, principal.privyId).first<Record<string, unknown>>();
    if (!order) return fail('Order not found.', 404);
    const status = String(order.status) as OrderStatus;
    if (action === 'payment_sent') {
      if (order.buyer_privy_id !== principal.privyId || status !== 'awaiting_payment') return fail('Only the buyer can report payment for an order awaiting payment.', 409);
      // This is a buyer assertion only. It never verifies fiat settlement or releases crypto.
      assertOrderTransition(status, 'payment_reported');
      await env.DB.prepare("UPDATE p2p_orders SET status = 'payment_reported', payment_reported_at = ?, updated_at = ? WHERE id = ? AND status = 'awaiting_payment'").bind(now(), now(), orderId).run();
    } else if (action === 'cancel') {
      if (status !== 'awaiting_escrow' && status !== 'awaiting_payment') return fail('Order cannot be cancelled at this stage; open a dispute instead.', 409);
      assertOrderTransition(status, 'cancelled');
      await env.DB.prepare("UPDATE p2p_orders SET status = 'cancelled', escrow_status = 'refund_pending', updated_at = ? WHERE id = ? AND status = ?").bind(now(), orderId, status).run();
      return fail('Cancellation is recorded only after the configured escrow provider confirms its refund; no escrow provider is configured.', 503);
    } else if (action === 'dispute') {
      if (!['awaiting_escrow', 'awaiting_payment', 'payment_reported'].includes(status)) return fail('This order cannot be disputed at its current status.', 409);
      assertOrderTransition(status, 'disputed');
      await env.DB.prepare("UPDATE p2p_orders SET status = 'disputed', updated_at = ? WHERE id = ? AND status = ?").bind(now(), orderId, status).run();
      await env.DB.prepare('INSERT INTO disputes (id, order_id, opened_by_privy_id, reason, status, created_at, updated_at) VALUES (?, ?, ?, ?, \'open\', ?, ?)').bind(id(), orderId, principal.privyId, 'User opened dispute', now(), now()).run();
    } else {
      return fail('Unsupported order action. Order completion and escrow release require a verified payment-provider event and configured escrow adapter.', 403);
    }
    await audit(env.DB, principal.privyId, `order.${action}`, 'p2p_order', orderId, { from: status }, request);
    return json({ id: orderId, status: action === 'payment_sent' ? 'payment_reported' : action === 'dispute' ? 'disputed' : 'cancelled', note: action === 'payment_sent' ? 'Payment reported by buyer; this is not payment verification and does not release USDT.' : undefined });
  }

  if (route === '/disputes' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT d.id, d.order_id, d.opened_by_privy_id, d.reason, d.status, d.created_at FROM disputes d JOIN p2p_orders o ON o.id = d.order_id WHERE o.buyer_privy_id = ? OR o.seller_privy_id = ? ORDER BY d.created_at DESC LIMIT 100').bind(principal.privyId, principal.privyId).all();
    return json({ disputes: rows.results });
  }

  return fail('Not found.', 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return cors(request, env, await handle(request, env)); }
    catch (error) {
      if (error instanceof IntegrationUnavailableError) return cors(request, env, fail(error.message, 503));
      console.error('P2P request error', error);
      return cors(request, env, fail('Internal server error.', 500));
    }
  }
};
