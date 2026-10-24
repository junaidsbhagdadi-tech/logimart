/**
 * Delhivery B2B / LTL integration config — all from env/secrets, never hardcoded.
 * Set on the host (.env), git-ignored:
 *   DELHIVERY_USERNAME     UMS login username (SECRET)
 *   DELHIVERY_PASSWORD     UMS login password (SECRET) — exchanged at /ums/login for a Bearer token
 *   DELHIVERY_BASE_URL     https://ltl-clients-api.delhivery.com (prod) | https://ltl-clients-api-dev.delhivery.com (staging)
 *   DELHIVERY_PICKUP_NAME  registered client-warehouse name (used as the manifest pickup location)
 * Docs: https://one.delhivery.com/developer-portal/document/b2b
 */
export const DELHIVERY = {
  baseUrl: (process.env.DELHIVERY_BASE_URL ?? 'https://ltl-clients-api.delhivery.com').trim().replace(/\/$/, ''),
  username: (process.env.DELHIVERY_USERNAME ?? '').trim(),
  password: (process.env.DELHIVERY_PASSWORD ?? '').trim(),
  pickupName: (process.env.DELHIVERY_PICKUP_NAME ?? '').trim(),
};

export const delConfigured = () => !!(DELHIVERY.baseUrl && DELHIVERY.username && DELHIVERY.password);

/** One Delhivery B2B account = one vendor code. The default (DELHIVERY_USERNAME/PASSWORD) is vendor DLY;
 *  more accounts via DELHIVERY_ACCOUNTS (JSON): {"DLY12": {"username": "…", "password": "…"}}. */
export type DelAccount = { code: string; username: string; password: string };
export function delAccounts(): DelAccount[] {
  const list: DelAccount[] = [{ code: 'DLY', username: DELHIVERY.username, password: DELHIVERY.password }];
  try {
    const extra = JSON.parse(process.env.DELHIVERY_ACCOUNTS || '{}');
    for (const [code, v] of Object.entries<any>(extra)) {
      if (v?.username && v?.password) list.push({ code: code.toUpperCase(), username: String(v.username).trim(), password: String(v.password) });
    }
  } catch { /* bad JSON → default account only */ }
  return list;
}
/** The account for a shipment's vendor code (exact match), else the default DLY account. */
export const delAccountFor = (vendor?: string | null): DelAccount => {
  const all = delAccounts();
  return all.find((a) => a.code === String(vendor ?? '').trim().toUpperCase()) ?? all[0];
};
