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
