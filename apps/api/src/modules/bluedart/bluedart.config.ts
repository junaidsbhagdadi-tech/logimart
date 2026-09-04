/**
 * BlueDart integration config — all from env/secrets, never hardcoded.
 * Set these on the host once the BlueDart account + dev.dhl.com app are ready:
 *   BLUEDART_BASE_URL      e.g. https://apigateway.bluedart.com/in/transportation
 *   BLUEDART_AUTH_URL      the Blue Dart Authentication API endpoint (JWT)
 *   BLUEDART_CLIENT_ID     ClientID (API Key) from the developer.dhl.com app
 *   BLUEDART_CLIENT_SECRET Client Secret from the developer.dhl.com app
 *   BLUEDART_LOGINID       BlueDart customer login id (e.g. BOM00001)
 *   BLUEDART_LICKEY        BlueDart licence key
 */
export const BLUEDART = {
  baseUrl: (process.env.BLUEDART_BASE_URL ?? '').replace(/\/$/, ''),
  authUrl: process.env.BLUEDART_AUTH_URL ?? '',
  clientId: process.env.BLUEDART_CLIENT_ID ?? '',
  clientSecret: process.env.BLUEDART_CLIENT_SECRET ?? '',
  loginId: process.env.BLUEDART_LOGINID ?? '',
  licKey: process.env.BLUEDART_LICKEY ?? '',
  // ---- account-specific shipper defaults for GenerateWayBill (from your BlueDart onboarding) ----
  customerCode: process.env.BLUEDART_CUSTOMER_CODE ?? '', // 6-char BD customer code (falls back to loginId)
  originArea: process.env.BLUEDART_ORIGIN_AREA ?? '',     // 3-char BD origin area code, e.g. BOM/DEL/BLR
  pickupTime: process.env.BLUEDART_PICKUP_TIME ?? '1600', // default pickup time HHMM
  // Logimart product code → BlueDart ProductCode. Air→A (Apex), surface→D (Domestic Priority).
  // Override with BLUEDART_PRODUCT_MAP='SFC:D,APEX:A' if your account uses different codes.
  productMap: (process.env.BLUEDART_PRODUCT_MAP ?? '')
    .split(',').map((p) => p.trim()).filter(Boolean)
    .reduce((m, kv) => { const [k, v] = kv.split(':'); if (k && v) m[k.toUpperCase()] = v.toUpperCase(); return m; }, {} as Record<string, string>),
};

export const bdConfigured = () =>
  !!(BLUEDART.baseUrl && BLUEDART.authUrl && BLUEDART.clientId && BLUEDART.clientSecret && BLUEDART.loginId && BLUEDART.licKey);
