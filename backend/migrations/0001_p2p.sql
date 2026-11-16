PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  privy_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trader_profiles (
  privy_id TEXT PRIMARY KEY REFERENCES users(privy_id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  bio TEXT,
  reputation_score REAL NOT NULL DEFAULT 0 CHECK (reputation_score BETWEEN 0 AND 5),
  completed_orders INTEGER NOT NULL DEFAULT 0 CHECK (completed_orders >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS advertisements (
  id TEXT PRIMARY KEY,
  owner_privy_id TEXT NOT NULL REFERENCES users(privy_id),
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  price_xof_per_usdt INTEGER NOT NULL CHECK (price_xof_per_usdt > 0),
  min_usdt_micros INTEGER NOT NULL CHECK (min_usdt_micros > 0),
  max_usdt_micros INTEGER NOT NULL CHECK (max_usdt_micros >= min_usdt_micros),
  available_usdt_micros INTEGER NOT NULL CHECK (available_usdt_micros >= 0),
  payment_methods_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS advertisements_market_idx ON advertisements(status, side, created_at DESC);
CREATE INDEX IF NOT EXISTS advertisements_owner_idx ON advertisements(owner_privy_id, created_at DESC);

CREATE TABLE IF NOT EXISTS p2p_orders (
  id TEXT PRIMARY KEY,
  advertisement_id TEXT NOT NULL REFERENCES advertisements(id),
  buyer_privy_id TEXT NOT NULL REFERENCES users(privy_id),
  seller_privy_id TEXT NOT NULL REFERENCES users(privy_id),
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  status TEXT NOT NULL CHECK (status IN ('awaiting_escrow', 'awaiting_payment', 'payment_reported', 'completed', 'cancelled', 'disputed')),
  escrow_status TEXT NOT NULL CHECK (escrow_status IN ('not_reserved', 'reserved', 'release_pending', 'released', 'refund_pending', 'refunded')),
  escrow_reference TEXT,
  amount_usdt_micros INTEGER NOT NULL CHECK (amount_usdt_micros > 0),
  rate_xof_per_usdt INTEGER NOT NULL CHECK (rate_xof_per_usdt > 0),
  total_xof INTEGER NOT NULL CHECK (total_xof >= 0),
  fee_xof INTEGER NOT NULL CHECK (fee_xof >= 0),
  payout_xof INTEGER NOT NULL CHECK (payout_xof >= 0),
  payment_reported_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS p2p_orders_buyer_idx ON p2p_orders(buyer_privy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS p2p_orders_seller_idx ON p2p_orders(seller_privy_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES p2p_orders(id),
  provider_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'XOF'),
  amount_xof INTEGER NOT NULL CHECK (amount_xof >= 0),
  provider_reference TEXT,
  status TEXT NOT NULL CHECK (status IN ('created', 'pending', 'verified', 'failed', 'refunded')),
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref_unique ON payments(provider_id, provider_reference) WHERE provider_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES p2p_orders(id),
  opened_by_privy_id TEXT NOT NULL REFERENCES users(privy_id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'under_review', 'resolved_buyer', 'resolved_seller', 'closed')),
  resolution TEXT,
  resolved_by_privy_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS disputes_order_idx ON disputes(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transaction_records (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES p2p_orders(id),
  user_privy_id TEXT REFERENCES users(privy_id),
  asset TEXT NOT NULL CHECK (asset = 'USDT'),
  currency TEXT NOT NULL CHECK (currency = 'XOF'),
  amount_usdt_micros INTEGER NOT NULL DEFAULT 0,
  amount_xof INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN ('escrow_reserve', 'escrow_release', 'escrow_refund', 'payment_settlement', 'fee')),
  provider_reference TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transaction_records_order_idx ON transaction_records(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_events (
  provider_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('received', 'processed', 'rejected')),
  payload_hash TEXT NOT NULL,
  PRIMARY KEY(provider_id, event_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_privy_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  request_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_logs(entity_type, entity_id, created_at DESC);
