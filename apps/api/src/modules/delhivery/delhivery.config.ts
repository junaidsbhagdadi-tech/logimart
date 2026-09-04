/**
 * Delhivery B2C integration config — all from env/secrets, never hardcoded.
 * Set on the host (.env), git-ignored:
 *   DELHIVERY_API_TOKEN     the API token (Authorization: Token <token>) — SECRET
 *   DELHIVERY_BASE_URL      https://track.delhivery.com (prod) | https://staging-express.delhivery.com (staging)
 *   DELHIVERY_PICKUP_NAME   registered pickup/warehouse name, e.g. LOGIMARTTECHNOLOGIESLTDB2C
 * Docs: https://one.delhivery.com/developer-portal/documents
 */
export const DELHIVERY = {
  token: process.env.DELHIVERY_API_TOKEN ?? '',
  baseUrl: (process.env.DELHIVERY_BASE_URL ?? 'https://track.delhivery.com').replace(/\/$/, ''),
  pickupName: process.env.DELHIVERY_PICKUP_NAME ?? '',
};

export const delConfigured = () => !!(DELHIVERY.token && DELHIVERY.baseUrl && DELHIVERY.pickupName);
