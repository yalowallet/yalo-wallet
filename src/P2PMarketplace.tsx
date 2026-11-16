import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowDownLeft, ArrowUpRight, CircleAlert, RefreshCw } from 'lucide-react';

type Side = 'buy' | 'sell';
type Tab = 'market' | 'ads' | 'orders';
type Advertisement = {
  id: string;
  side: Side;
  priceXofPerUsdt: string;
  minUsdt: string;
  maxUsdt: string;
  availableUsdt: string;
  paymentMethods: string[];
  merchant: { displayName: string; completedOrders: number; rating: number };
  status: 'active' | 'paused';
};
type P2POrder = {
  id: string;
  side: Side;
  status: string;
  escrowStatus: string;
  amountUsdt: string;
  rateXofPerUsdt: string;
  totalXof: string;
  feeXof: string;
  payoutXof: string;
  availableActions: string[];
};

const apiBaseUrl = import.meta.env.VITE_P2P_API_URL?.trim().replace(/\/$/, '');
const moneyXof = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export default function P2PMarketplace() {
  const { getAccessToken } = usePrivy();
  const [tab, setTab] = useState<Tab>('market');
  const [side, setSide] = useState<Side>('buy');
  const [ads, setAds] = useState<Advertisement[]>([]);
  const [orders, setOrders] = useState<P2POrder[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [showCreateAd, setShowCreateAd] = useState(false);
  const [adForm, setAdForm] = useState({ side: 'sell' as Side, price: '', min: '', max: '', methods: '' });

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (!apiBaseUrl) throw new Error('P2P service is not configured. No live offers, payments, or escrow are available.');
    const token = await getAccessToken();
    if (!token) throw new Error('Please reconnect your wallet to access P2P.');
    const response = await fetch(`${apiBaseUrl}/v1/p2p${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...init?.headers
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `P2P service returned ${response.status}.`);
    return payload as T;
  }, [getAccessToken]);

  const refresh = useCallback(async () => {
    if (!apiBaseUrl) return;
    setBusy(true);
    setError('');
    try {
      const [market, mine] = await Promise.all([
        request<{ advertisements: Advertisement[] }>(`/advertisements?side=${side}`),
        request<{ orders: P2POrder[] }>('/orders')
      ]);
      setAds(market.advertisements);
      setOrders(mine.orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load P2P market.');
    } finally {
      setBusy(false);
    }
  }, [request, side]);

  useEffect(() => { void refresh(); }, [refresh]);

  const myAds = useMemo(() => ads.filter((ad) => ad.status === 'active' || ad.status === 'paused'), [ads]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try { await action(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'P2P request failed.'); setBusy(false); }
  }

  async function createOrder(ad: Advertisement) {
    const amountUsdt = amounts[ad.id] || '';
    if (!amountUsdt || !Number.isFinite(Number(amountUsdt)) || Number(amountUsdt) <= 0) {
      setError('Enter a valid USDT amount.'); return;
    }
    await run(() => request('/orders', { method: 'POST', body: JSON.stringify({ advertisementId: ad.id, amountUsdt }) }));
    setTab('orders');
  }

  async function saveAd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(() => request('/advertisements', {
      method: 'POST',
      body: JSON.stringify({
        side: adForm.side,
        priceXofPerUsdt: adForm.price,
        minUsdt: adForm.min,
        maxUsdt: adForm.max,
        paymentMethods: adForm.methods.split(',').map((method) => method.trim()).filter(Boolean)
      })
    }));
    setShowCreateAd(false);
  }

  async function orderAction(orderId: string, action: string) {
    await run(() => request(`/orders/${encodeURIComponent(orderId)}/actions/${encodeURIComponent(action)}`, { method: 'POST' }));
  }

  return (
    <section className="p2p-section" id="p2p-market">
      <div className="p2p-heading">
        <div><p className="muted">Peer-to-peer market</p><h2>USDT / XOF</h2></div>
        <button className="refresh-button" onClick={() => void refresh()} disabled={busy || !apiBaseUrl}>
          <RefreshCw size={15} className={busy ? 'spin' : ''} /> Refresh
        </button>
      </div>
      <p className="p2p-intro">Buy or sell USDT using West African CFA Franc (XOF). Prices, fees, and payouts are shown in XOF.</p>
      {!apiBaseUrl && <div className="p2p-warning"><CircleAlert size={18} /><span>P2P is not live: configure <code>VITE_P2P_API_URL</code> and deploy the authenticated market, escrow, and XOF settlement services. This app will not display sample offers or simulate payments.</span></div>}
      {error && <div className="message-box" role="alert">{error}</div>}
      <div className="p2p-tabs" role="tablist" aria-label="P2P sections">
        {(['market', 'ads', 'orders'] as Tab[]).map((value) => <button key={value} className={tab === value ? 'selected' : ''} onClick={() => setTab(value)}>{value === 'market' ? 'Buy / Sell' : value === 'ads' ? 'My advertisements' : 'My orders'}</button>)}
      </div>

      {tab === 'market' && <>
        <div className="p2p-side-switch"><button className={side === 'buy' ? 'selected' : ''} onClick={() => setSide('buy')}><ArrowDownLeft size={16} /> Buy USDT</button><button className={side === 'sell' ? 'selected' : ''} onClick={() => setSide('sell')}><ArrowUpRight size={16} /> Sell USDT</button></div>
        {ads.filter((ad) => ad.side === side && ad.status === 'active').map((ad) => <article className="p2p-card" key={ad.id}>
          <div className="p2p-card-top"><div><b>{ad.merchant.displayName}</b><p className="muted">★ {ad.merchant.rating.toFixed(1)} · {ad.merchant.completedOrders} completed orders</p></div><b className="xof-price">{moneyXof.format(Number(ad.priceXofPerUsdt))} XOF <small>/ USDT</small></b></div>
          <p className="p2p-limits">Limits: {ad.minUsdt}–{ad.maxUsdt} USDT · Available: {ad.availableUsdt} USDT</p>
          <p className="p2p-limits">Payment methods: {ad.paymentMethods.join(', ') || 'Not specified'}</p>
          <label>Amount (USDT)<input type="number" min="0" step="any" value={amounts[ad.id] || ''} onChange={(e) => setAmounts((old) => ({ ...old, [ad.id]: e.target.value }))} placeholder="Enter USDT amount" /></label>
          <button className="primary-button" disabled={busy || !apiBaseUrl} onClick={() => void createOrder(ad)}>{side === 'buy' ? 'Buy USDT' : 'Sell USDT'}</button>
        </article>)}
        {apiBaseUrl && !busy && ads.filter((ad) => ad.side === side && ad.status === 'active').length === 0 && <p className="p2p-empty">No active {side} offers are available right now.</p>}
      </>}

      {tab === 'ads' && <>
        <button className="primary-button p2p-create-button" disabled={!apiBaseUrl} onClick={() => setShowCreateAd(true)}>Create advertisement</button>
        {myAds.map((ad) => <article className="p2p-card" key={ad.id}><div className="p2p-card-top"><b>{ad.side === 'buy' ? 'Buy USDT' : 'Sell USDT'} · {ad.status}</b><b className="xof-price">{moneyXof.format(Number(ad.priceXofPerUsdt))} XOF / USDT</b></div><p className="p2p-limits">{ad.minUsdt}–{ad.maxUsdt} USDT · {ad.paymentMethods.join(', ')}</p><div className="p2p-inline-actions"><button disabled={busy || !apiBaseUrl} onClick={() => void run(() => request(`/advertisements/${encodeURIComponent(ad.id)}`, { method: 'PATCH', body: JSON.stringify({ status: ad.status === 'active' ? 'paused' : 'active' }) }))}>{ad.status === 'active' ? 'Pause' : 'Resume'}</button><button disabled={busy || !apiBaseUrl} onClick={() => void run(() => request(`/advertisements/${encodeURIComponent(ad.id)}`, { method: 'DELETE' }))}>Cancel ad</button></div></article>)}
        {apiBaseUrl && !busy && myAds.length === 0 && <p className="p2p-empty">Your advertisements will appear here.</p>}
      </>}

      {tab === 'orders' && <>
        {orders.map((order) => <article className="p2p-card" key={order.id}><div className="p2p-card-top"><b>Order {order.id.slice(0, 10)} · {order.side}</b><span className="p2p-status">{order.status}</span></div><p className="p2p-limits">{order.amountUsdt} USDT × {moneyXof.format(Number(order.rateXofPerUsdt))} XOF/USDT</p><p className="p2p-limits">Total: {moneyXof.format(Number(order.totalXof))} XOF · Fee: {moneyXof.format(Number(order.feeXof))} XOF · Payout: {moneyXof.format(Number(order.payoutXof))} XOF</p><p className="p2p-limits">Escrow status: {order.escrowStatus}</p><div className="p2p-inline-actions">{order.availableActions.map((action) => <button key={action} disabled={busy || !apiBaseUrl} onClick={() => void orderAction(order.id, action)}>{action.replaceAll('_', ' ')}</button>)}</div></article>)}
        {apiBaseUrl && !busy && orders.length === 0 && <p className="p2p-empty">Your P2P orders will appear here.</p>}
      </>}

      <p className="p2p-security-note">Order state, escrow, fees, and XOF payouts must be verified by the configured backend. Do not send funds or mark a payment complete outside the order flow.</p>

      {showCreateAd && <div className="modal-overlay"><form className="modal" onSubmit={(event) => void saveAd(event)}><button type="button" className="modal-close" onClick={() => setShowCreateAd(false)}>×</button><h2>Create USDT/XOF advertisement</h2><label>Advertisement type<select value={adForm.side} onChange={(e) => setAdForm({ ...adForm, side: e.target.value as Side })}><option value="sell">Sell USDT for XOF</option><option value="buy">Buy USDT with XOF</option></select></label><label>Price (XOF per USDT)<input required type="number" min="1" step="1" value={adForm.price} onChange={(e) => setAdForm({ ...adForm, price: e.target.value })} /></label><label>Minimum order (USDT)<input required type="number" min="0.000001" step="any" value={adForm.min} onChange={(e) => setAdForm({ ...adForm, min: e.target.value })} /></label><label>Maximum order (USDT)<input required type="number" min="0.000001" step="any" value={adForm.max} onChange={(e) => setAdForm({ ...adForm, max: e.target.value })} /></label><label>Payment methods (as supported by your service)<input required value={adForm.methods} onChange={(e) => setAdForm({ ...adForm, methods: e.target.value })} placeholder="Comma-separated" /></label><button className="primary-button" disabled={busy || !apiBaseUrl}>Publish advertisement</button></form></div>}
    </section>
  );
}
