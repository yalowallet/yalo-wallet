# YALO Wallet P2P backend foundation

This is a separate Cloudflare Worker + D1 API. It does not replace the wallet frontend or its existing Privy wallet, Send, Receive, balance, or withdrawal flows. The primary and only supported market schema is USDT/XOF.

## What is implemented

- D1 schema for Privy identities, trader profiles, advertisements, orders, XOF payments, disputes, USDT/XOF transaction records, webhook idempotency, and audit logs.
- Privy bearer-token verification against the app's remote JWKS with issuer, audience, and `did:privy:` subject checks. The API derives identity only from the verified token.
- Owner-checked listing create/read/pause/resume/cancel operations, XOF integer price validation, USDT micro-unit precision, and server-side XOF/fee calculations.
- Authenticated order/profile/dispute endpoints, ownership checks, a strict transition helper, and buyer payment-reported action that explicitly does not count as provider verification.
- Typed escrow and payment interfaces, fail-closed unconfigured adapters, XOF-only payment rows, webhook idempotency schema, and audit records.

## Not live / requires external work

- The default escrow adapter deliberately refuses new orders. No USDT is reserved, released, or refunded until a reviewed on-chain escrow implementation is supplied and configured. The database is not treated as custody.
- No XOF payment provider is configured. `ENABLED_XOF_PAYMENT_METHODS` must contain only methods backed by a real provider, and the provider adapter must verify signed webhooks. Until then listing creation requiring a payment method and the webhook endpoint fail closed.
- Privy app ID, D1 database ID, allowed production origin, and provider credentials/configuration must be set as Worker secrets/variables. Never put secrets in Vite environment variables.
- Admin dispute adjudication, rate limiting, bot protection, KYC/compliance, operational monitoring, backup/retention policy, and security review are required before production.

## Local setup

1. `cd backend && npm install`
2. Create D1, replace the placeholder `database_id` in `wrangler.jsonc`, then apply `npx wrangler d1 migrations apply yalo-p2p --local` (and `--remote` for deployed DB).
3. Set `PRIVY_APP_ID` and `ALLOWED_ORIGIN` as Worker vars/secrets. Set `ENABLED_XOF_PAYMENT_METHODS` only after a real XOF provider adapter exists.
4. Deploy the Worker and set frontend `VITE_P2P_API_URL` to its HTTPS origin.

Routes under `/v1/p2p`: `GET /health`, `GET/PATCH /profile`, `GET/POST /advertisements`, `PATCH/DELETE /advertisements/:id`, `GET/POST /orders`, `POST /orders/:id/actions/:action`, `GET /disputes`, and provider webhook endpoint `POST /webhooks/xof`.

Caution: this is backend scaffolding, not production payment or escrow integration. Never treat a screenshot or buyer's `payment_sent` action as settlement evidence.
