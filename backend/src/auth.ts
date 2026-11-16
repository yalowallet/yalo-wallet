import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface Identity { privyId: string; }
export interface AuthEnv { PRIVY_APP_ID: string; PRIVY_ISSUER?: string; }

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function authenticate(request: Request, env: AuthEnv): Promise<Identity> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) throw new Error('Authentication required.');
  if (!env.PRIVY_APP_ID) throw new Error('Server Privy application ID is not configured.');
  const appId = env.PRIVY_APP_ID;
  let keySet = keySets.get(appId);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${encodeURIComponent(appId)}/jwks.json`));
    keySets.set(appId, keySet);
  }
  const { payload } = await jwtVerify(header.slice(7), keySet, {
    issuer: env.PRIVY_ISSUER || 'privy.io',
    audience: appId,
    algorithms: ['ES256', 'ES384', 'RS256']
  });
  if (typeof payload.sub !== 'string' || !payload.sub.startsWith('did:privy:')) throw new Error('Invalid Privy subject.');
  return { privyId: payload.sub };
}
