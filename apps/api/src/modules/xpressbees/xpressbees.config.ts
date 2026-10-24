/**
 * XpressBees B2B (cargo) integration config — all from env/secrets, never hardcoded. Set on the host (.env):
 *   XB_KEY               XBKey for the account (manifest, pickup, cancel)                       SECRET
 *   XB_ACCESS_KEY        xbaccesskey for bulk AWB generation (defaults to XB_KEY)               SECRET
 *   XB_AWB_TOKEN         `token` header for the bulk AWB generation API                         SECRET
 *   XB_TRACK_USERNAME / XB_TRACK_PASSWORD / XB_TRACK_SECRET   tracking-token login             SECRET
 *   XB_PICKUP_LOCATION   registered pickup location id (BookPickupRequest "PickupLocation")
 *   XB_PICKUP_EMAIL      contact email sent with pickup requests when the customer has none
 *   XB_DEFAULT_CATEGORY  product category when it can't be told from the goods description
 *                        (XB list: Document, Electronic goods, Liquid, Metal, Furniture, Pharmaceuticals,
 *                         Auto Parts, Food Stuff, Garments, Baby Product)
 * Endpoint URLs default to the ones in XpressBees' documents (stage where only stage was given) —
 * override each with XB_MANIFEST_URL / XB_AWB_URL / XB_PICKUP_URL / XB_CANCEL_URL / XB_AUTH_URL / XB_TRACK_URL.
 * XpressBees whitelists the calling server's IP (error 102) — ours: 168.144.77.53.
 */
const env = (k: string, d = '') => (process.env[k] ?? d).trim();

export const XB = {
  manifestUrl: env('XB_MANIFEST_URL', 'https://stage-globalapi-cargo-service.xbees.in/POSTShipmentService.svc/AddCargoManifestDetails'),
  awbUrl: env('XB_AWB_URL', 'https://cargoautoallocation-apistage.xbees.in/api/generateclientawbinbulk'),
  pickupUrl: env('XB_PICKUP_URL', 'https://stage-globalapi-cargo-service.xbees.in/v1/BookPickupRequest'),
  cancelUrl: env('XB_CANCEL_URL', 'https://globalapi-cargo.xbees.in/v1/B2BCancellationCargoAWB'),
  authUrl: env('XB_AUTH_URL', 'http://userauthapis.xbees.in/api/auth/generateToken'),
  trackUrl: env('XB_TRACK_URL', 'https://global-api.xbees.in/global/v1/tracking').replace(/\/$/, ''),
  key: env('XB_KEY'),
  accessKey: env('XB_ACCESS_KEY') || env('XB_KEY'),
  awbToken: env('XB_AWB_TOKEN'),
  trackUser: env('XB_TRACK_USERNAME'),
  trackPass: env('XB_TRACK_PASSWORD'),
  trackSecret: env('XB_TRACK_SECRET'),
  pickupLocation: env('XB_PICKUP_LOCATION'),
  pickupEmail: env('XB_PICKUP_EMAIL'),
  defaultCategory: env('XB_DEFAULT_CATEGORY'),
};

/** Booking (manifest) needs the key and a way to get AWB numbers. */
export const xbConfigured = () => !!(XB.key && XB.accessKey && XB.awbToken);
export const xbTrackConfigured = () => !!(XB.trackUser && XB.trackPass);

/** Vendor-master code(s) that mean XpressBees. */
export const isXpressBeesVendor = (v?: string | null) => /^XPB$|XPRESS\s*BEES|^XB$/i.test(String(v ?? '').trim());
