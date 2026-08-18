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
};

export const bdConfigured = () =>
  !!(BLUEDART.baseUrl && BLUEDART.authUrl && BLUEDART.clientId && BLUEDART.clientSecret && BLUEDART.loginId && BLUEDART.licKey);
