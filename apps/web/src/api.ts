// Thin API client for the Logimart ERP backend.
// Default: same-origin ('' -> calls /api/v1/... on whatever host serves the app),
// which is what happens when the NestJS server serves this built portal.
// For local dev (vite on :5173, api on :3000) set VITE_API_URL in apps/web/.env.
const BASE = (import.meta.env.VITE_API_URL as string) || '';

const TOKEN_KEY = 'logimart_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  // Expired/invalid session: clear it and bounce to login (only if we sent a token).
  if (res.status === 401 && token) {
    clearToken();
    localStorage.removeItem('logimart_user');
    if (!location.pathname.startsWith('/login')) location.href = '/login';
    throw new ApiError(401, 'Session expired — please log in again');
  }
  if (!res.ok && res.status !== 207) {
    throw new ApiError(res.status, data?.message || res.statusText);
  }
  return data as T;
}

// ---- types ----
export interface Piece {
  id: string;
  childId: string;
  sequenceNo: number;
  deadKg: string;
  volKg: string;
  status: string;
}
export interface Shipment {
  awb: string;
  serviceMode: string;
  originZone: string;
  destZone: string;
  pieceCount: number;
  status: string;
  totalDeadKg: string;
  totalVolKg: string;
  pieces: Piece[];
  rollup: { pieceCount: number; delivered: number; isShort: boolean };
  consigneeName?: string | null;
  consigneePhone?: string | null;
  consigneeAddress?: string | null;
  consigneeCity?: string | null;
  destPincode?: string | null;
  lrNumber?: string | null;
  ewbNo?: string | null;
  ewbValidUpto?: string | null;
  vehicleNo?: string | null;
  ftlVehicleType?: string | null;
  departureAt?: string | null;
  arrivalAt?: string | null;
  expectedDelivery?: string | null;
  // payment terms
  paymentTerm?: 'PREPAID' | 'TO_PAY';
  freightToCollect?: string | null;
  freightCollected?: string | null;
  freightCollectedAt?: string | null;
  // services + charges
  product?: string | null;
  docType?: string | null;
  chargeWeight?: string | null;
  charges?: { code: string; name: string; amount: number }[] | null;
  bdWaybill?: string | null;
  bdStatus?: string | null;
  vendor?: string | null;
  forwardingAwb?: string | null;
  forwardingAt?: string | null;
  // DOD (Draft on Delivery)
  isDod?: boolean;
  dodAmount?: string | null;
  dodInstrument?: 'CHEQUE' | 'DD' | null;
  dodReference?: string | null;
  dodBankName?: string | null;
  dodCollectedAt?: string | null;
  dodHandedOverAt?: string | null;
  pods?: {
    id: string;
    stampPhotoUrl: string | null;
    signatureUrl: string | null;
    isShort: boolean;
    piecesDelivered: number;
    deliveredAt: string;
  }[];
}
export interface ShipmentRow {
  awb: string;
  client: string;
  serviceMode: string;
  route: string;
  status: string;
  pieceCount: number;
  delivered: number;
  totalDeadKg: string;
  totalVolKg: string;
  createdAt: string;
}
export interface MasterLabel {
  awb: string;
  barcode: string;
  lrNumber: string;
  carrier: { brand: string; tagline: string };
  consignor: { name: string; address: string; gstin: string | null };
  consignee: { name: string; address: string; phone: string | null; gstin: string | null };
  serviceMode: string;
  route: string;
  pieceCount: number;
  totalDeadKg: number;
  totalVolKg: number;
  declaredValue: number | null;
  goodsDesc: string | null;
  ewbNo: string | null;
}
export interface LabelItem {
  masterAwb: string;
  childId: string;
  sequenceLabel: string;
  barcode: string;
  deadKg: number;
  volKg: number;
  serviceMode: string;
  route: string;
  client: string;
  zpl: string;
}

export interface RateQuote {
  awb: string;
  lane: string;
  serviceMode: string;
  isOda: boolean;
  declaredValue: string | null;
  chargeableKg: number;
  freight: number;
  fuel: number;
  fov: number;
  oda: number;
  docket: number;
  handling: number;
  subtotal: number;
  lines: { head: string; amount: number }[];
  gst: number;
  grandTotal: number;
}
export interface Client {
  id: string;
  legalName: string;
  accountCode: string;
  gstin: string | null;
  pan: string | null;
  city: string | null;
  state?: string | null;
  contactPhone: string | null;
  contactEmail?: string | null;
  contactPerson?: string | null;
  billingState?: string | null;
  serviceCentre?: string | null;
  origin?: string | null;
  customerType?: string | null;
  registerType?: string | null;
  creditLimit: string;
  creditDays: number;
  outstandingBal: string;
  isCreditHold: boolean;
  isActive: boolean;
  isCash?: boolean;
}
export interface RateCardRow {
  id: string;
  clientId: string;
  originZone: string;
  destZone: string;
  serviceMode: string;
  perKgRate: string;
  minCharge: string;
  fuelPct: string;
  fovPct: string;
  fovMin: string;
  odaFlat: string;
  odaPerKg: string;
  odaMin: string;
  docketCharge: string;
  handlingCharge: string;
  effectiveFrom: string;
}
export interface InvoiceLine {
  id: string;
  shipmentId: string;
  chargeableKg: string;
  amount: string;
  isDisputed: boolean;
  disputeReason: string | null;
  shipment?: { awb: string; originZone: string; destZone: string };
}
export interface Invoice {
  id: string;
  invoiceNo: string;
  periodStart: string;
  periodEnd: string;
  subtotal: string;
  tax: string;
  cgst?: string;
  sgst?: string;
  igst?: string;
  placeOfSupply?: string | null;
  sacCode?: string | null;
  total: string;
  status: string;
  dueDate: string;
  lines: InvoiceLine[];
  irn?: string | null;
  client?: {
    legalName: string;
    accountCode: string;
    gstin: string | null;
    addressLine: string | null;
    city: string | null;
    pincode: string | null;
  };
}
export interface Credit {
  clientId: string;
  legalName: string;
  creditLimit: string;
  creditDays: number;
  outstandingBalance: string;
  available: number;
  isCreditHold: boolean;
}

export const api = {
  login: (email: string, password: string) =>
    request<{
      accessToken: string;
      user: { id: string; fullName: string; role: string; clientId: string | null };
    }>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  listShipments: () => request<ShipmentRow[]>('/api/v1/shipments'),
  getShipment: (awb: string) => request<Shipment>(`/api/v1/shipments/${awb}`),
  getLabels: (awb: string) =>
    request<{ awb: string; pieceCount: number; master: MasterLabel; labels: LabelItem[] }>(
      `/api/v1/shipments/${awb}/print-mps-labels`,
    ),
  lookupPincode: (pincode: string) =>
    request<{ pincode: string; city: string | null; state: string | null; region: string | null; tier: number | null; isOda: boolean; known: boolean }>(
      `/api/v1/pincodes/${pincode}`,
    ),
  createShipment: (body: unknown) =>
    request<Shipment>('/api/v1/shipments', { method: 'POST', body: JSON.stringify(body) }),
  bulkCreateShipments: (rows: unknown[]) =>
    request<{ total: number; created: number; results: { row: number; ok: boolean; awb?: string; error?: string }[] }>(
      '/api/v1/shipments/bulk',
      { method: 'POST', body: JSON.stringify({ rows }) },
    ),

  // ---- ground ops ----
  uploadPod: async (file: File, kind = 'pod_stamp') => {
    const fd = new FormData();
    fd.append('file', file);
    const token = getToken();
    const res = await fetch(`${BASE}/api/v1/uploads?kind=${kind}`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiError(res.status, data?.message || res.statusText);
    return data as { id: string; url: string };
  },
  riderTasks: () =>
    request<{ pickups: any[]; deliveries: any[] }>('/api/v1/rider/tasks'),
  markOfd: (awb: string) => request(`/api/v1/shipments/${awb}/ofd`, { method: 'POST' }),
  assignDelivery: (awb: string, riderId: number) =>
    request(`/api/v1/shipments/${awb}/assign-delivery`, { method: 'POST', body: JSON.stringify({ riderId }) }),
  recordPod: (awb: string, body: unknown, force = false) =>
    request<{ isShort: boolean; expected: number; pod: { piecesDelivered: number } }>(
      `/api/v1/shipments/${awb}/pod${force ? '?force=true' : ''}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // ---- To-Pay / DOD ----
  collectDod: (awb: string, body: { reference: string; bankName?: string; amount?: number }) =>
    request<{ message: string }>(`/api/v1/shipments/${awb}/dod/collect`, { method: 'POST', body: JSON.stringify(body) }),
  handoverDod: (awb: string) =>
    request<{ message: string }>(`/api/v1/shipments/${awb}/dod/handover`, { method: 'POST' }),
  collectFreight: (awb: string, amount: number) =>
    request<{ message: string }>(`/api/v1/shipments/${awb}/collect-freight`, { method: 'POST', body: JSON.stringify({ amount }) }),
  setForwarding: (awb: string, body: { vendor?: string; forwardingAwb?: string }) =>
    request<{ awb: string; vendor: string | null; forwardingAwb: string | null; message: string }>(
      `/api/v1/shipments/${awb}/forwarding`, { method: 'POST', body: JSON.stringify(body) }),
  payAtBooking: (awb: string, amount: number, method: 'CASH' | 'WALLET') =>
    request<{ awb: string; method: string; amount: number; walletBalance: number | null; customer: string; accountCode: string; collectedAt: string; message: string }>(
      `/api/v1/shipments/${awb}/pay`, { method: 'POST', body: JSON.stringify({ amount, method }) }),
  // ---- wallet + walk-in ----
  ensureWalkin: () => request<any>('/api/v1/clients/walkin', { method: 'POST' }),
  getWallet: (id: string | number) => request<{ clientId: string; legalName: string; accountType: string; walletBalance: number }>(`/api/v1/clients/${id}/wallet`),
  walletTopup: (id: string | number, amount: number, note?: string) =>
    request<{ clientId: string; topup: number; walletBalance: number }>(`/api/v1/clients/${id}/wallet/topup`, { method: 'POST', body: JSON.stringify({ amount, note }) }),

  // ---- finance ----
  rateQuote: (awb: string) => request<RateQuote>(`/api/v1/shipments/${awb}/rate-quote`),
  billWorksheet: (clientId: string | number, from?: string, to?: string) =>
    request<{ columns: { header: string; key: string }[]; client: { accountCode: string; legalName: string }; count: number; rows: Record<string, any>[] }>(
      `/api/v1/billing/bill-worksheet?clientId=${clientId}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`),
  listInvoices: () => request<Invoice[]>('/api/v1/billing/invoices'),
  getInvoice: (id: string) => request<Invoice>(`/api/v1/billing/invoices/${id}`),
  generateInvoice: (clientId: number, periodStart: string, periodEnd: string) =>
    request<{ invoice: Invoice; creditHold: boolean; newBalance: number; creditLimit: string }>(
      '/api/v1/billing/invoices/generate',
      { method: 'POST', body: JSON.stringify({ clientId, periodStart, periodEnd }) },
    ),
  disputeLine: (invoiceId: string, shipmentId: number, reason: string) =>
    request('/api/v1/billing/invoices/' + invoiceId + '/dispute', {
      method: 'POST',
      body: JSON.stringify({ shipmentId, reason }),
    }),
  payInvoice: (invoiceId: string, body: { amount: number; tds?: number; other?: number; otherNote?: string }) =>
    request<{ settled: number; newBalance: number; fullyPaid: boolean }>(
      '/api/v1/billing/invoices/' + invoiceId + '/pay',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // ---- tax filing ----
  gstReport: (from: string, to: string) => request<any>(`/api/v1/tax/gst?from=${from}&to=${to}`),
  tdsReport: (from: string, to: string) => request<any>(`/api/v1/tax/tds?from=${from}&to=${to}`),
  exportTally: async (from: string, to: string) => {
    const res = await fetch(`${BASE}/api/v1/tax/tally?from=${from}&to=${to}`, {
      headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, 'Tally export failed');
    const xml = await res.text();
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `Tally_Sales_${from}_${to}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // ---- feedback ----
  submitFeedback: (body: { message: string; rating?: number; page?: string; category?: string }) =>
    request('/api/v1/feedback', { method: 'POST', body: JSON.stringify(body) }),
  listFeedback: () => request<any[]>('/api/v1/feedback'),
  reviewFeedback: (id: string) => request(`/api/v1/feedback/${id}`, { method: 'PATCH' }),

  // ---- users (admin) ----
  listUsers: () => request<any[]>('/api/v1/users'),
  createUser: (body: unknown) =>
    request('/api/v1/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: string, body: unknown) =>
    request(`/api/v1/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getCredit: (clientId: number) => request<Credit>(`/api/v1/clients/${clientId}/credit`),
  generateEInvoice: (invoiceId: string) =>
    request<{ irn: string; ackNo: string; mode: string }>(
      `/api/v1/billing/invoices/${invoiceId}/einvoice`,
      { method: 'POST' },
    ),

  // ---- compliance ----
  consignmentNote: (awb: string) => request<any>(`/api/v1/shipments/${awb}/consignment-note`),
  generateEway: (awb: string, declaredValue: number, vehicleNo: string, distanceKm?: number) =>
    request<{ ewbNo: string; validUpto: string; mode: string }>(
      `/api/v1/shipments/${awb}/eway-bill`,
      { method: 'POST', body: JSON.stringify({ declaredValue, vehicleNo, distanceKm }) },
    ),

  // ---- master data: serviceability + hubs ----
  listPincodes: (limit = 500) => request<{ pincode: string; city: string; state: string; region: string; tier: number; isOda: boolean }[]>(`/api/v1/pincodes?limit=${limit}`),
  createPincode: (body: { pincode: string; city: string; state: string; region: string; tier: number; isOda?: boolean }) =>
    request('/api/v1/pincodes', { method: 'POST', body: JSON.stringify(body) }),
  // ---- serviceability coverage (SELF network / vendor-wise) ----
  serviceOptions: (pincode: string) => request<{ network: string; mode: string | null; tatDays: number | null; isOda: boolean; city: string | null }[]>(`/api/v1/pincodes/service-options/${pincode}`),
  serviceNetworks: () => request<string[]>('/api/v1/pincodes/service-areas/networks'),
  listServiceAreas: (network?: string, limit = 500) =>
    request<{ id: string; pincode: string; city: string | null; state: string | null; network: string; mode: string | null; tatDays: number | null; isOda: boolean }[]>(
      `/api/v1/pincodes/service-areas?limit=${limit}${network ? `&network=${encodeURIComponent(network)}` : ''}`),
  bulkServiceAreas: (rows: Record<string, string>[], defaultNetwork = 'SELF') =>
    request<{ imported: number; failed: number; errors: { pincode: string; error: string }[] }>(
      '/api/v1/pincodes/service-areas/bulk', { method: 'POST', body: JSON.stringify({ rows, defaultNetwork }) }),
  bulkPincodeMapping: (rows: Record<string, any>[]) =>
    request<{ imported: number; failed: number; errors: { pincode: string; error: string }[] }>(
      '/api/v1/pincodes/mapping/bulk', { method: 'POST', body: JSON.stringify({ rows }) }),
  bulkEdl: (network: string, rows: any[]) =>
    request<{ network: string; imported: number }>('/api/v1/rate-cards/edl/bulk', { method: 'POST', body: JSON.stringify({ network, rows }) }),
  listEdl: (network?: string) => request<any[]>(`/api/v1/rate-cards/edl${network ? `?network=${network}` : ''}`),
  listVendorBills: (vendorCode?: string) => request<any[]>(`/api/v1/vendor-bills${vendorCode ? `?vendorCode=${vendorCode}` : ''}`),
  bulkVendorBills: (rows: any[]) => request<{ imported: number; failed: number; errors: any[] }>('/api/v1/vendor-bills/bulk', { method: 'POST', body: JSON.stringify({ rows }) }),
  getPnl: (from?: string, to?: string) => request<{ count: number; totalSell: number; totalCost: number; totalMargin: number; rows: any[] }>(`/api/v1/billing/pnl${from || to ? `?${from ? `from=${from}` : ''}${to ? `&to=${to}` : ''}` : ''}`),
  listHubs: () => request<{ id: string; code: string; name: string; zone: string }[]>('/api/v1/hubs'),

  // ---- generic master data (Zone, Country, State, Product, Charge, …) ----
  listMaster: (type: string) => request<{ code: string; name: string; attrs: Record<string, any>; active: boolean }[]>(`/api/v1/masters/${type}`),
  saveMaster: (type: string, body: { code: string; name: string; attrs?: Record<string, any>; active?: boolean }) =>
    request(`/api/v1/masters/${type}`, { method: 'POST', body: JSON.stringify(body) }),
  deleteMaster: (type: string, code: string) => request(`/api/v1/masters/${type}/${encodeURIComponent(code)}`, { method: 'DELETE' }),

  // ---- operational scans (pickup-in, out-scan, manifest-in, undelivered, miss-route) ----
  recordScan: (body: { awb: string; eventType: string; serviceCenter?: string; remark?: string }) =>
    request<{ awb: string; eventType: string; shipmentUpdated: boolean }>('/api/v1/opscan', { method: 'POST', body: JSON.stringify(body) }),
  listScans: (limit = 50) => request<{ id: string; awb: string; eventType: string; serviceCenter: string | null; scanAt: string }[]>(`/api/v1/opscan?limit=${limit}`),

  // ---- milestone lifecycle (First / Mid / Last mile) ----
  lifecycleSummary: () => request<{ counts: Record<string, number>; lifecycle: { code: string; label: string; mile: string }[] }>('/api/v1/lifecycle/summary'),
  lifecycleList: (code?: string, limit = 100) => request<any[]>(`/api/v1/lifecycle/list?limit=${limit}${code ? `&code=${code}` : ''}`),
  lifecycleScan: (body: { awbs: string[]; code: string; remark?: string; podDataUrl?: string; bagCode?: string }) =>
    request<{ code: string; updated: number; done: string[]; missing: string[]; locked?: string[] }>('/api/v1/lifecycle/scan', { method: 'POST', body: JSON.stringify(body) }),
  lifecycleTrack: (awb: string) =>
    request<{ awb: string; statusCode: string; currentLabel: string; statusAt: string | null; originZone: string; destZone: string; consigneeName?: string; consigneeCity?: string; expectedDelivery?: string | null; timeline: { code: string; label: string; at: string; remark?: string | null }[] }>(`/api/v1/lifecycle/track/${encodeURIComponent(awb)}`),
  lifecycleBag: (body: { bagCode: string; awbs: string[] }) => request<{ bagCode: string; bagged: number }>('/api/v1/lifecycle/bag', { method: 'POST', body: JSON.stringify(body) }),
  lifecycleBags: () => request<{ bagCode: string; shipments: number }[]>('/api/v1/lifecycle/bags'),

  // ---- BlueDart carrier integration ----
  bdStatus: () => request<{ configured: boolean; [k: string]: any }>('/api/v1/bluedart/status'),
  bdServiceable: (pincode: string) => request<any>(`/api/v1/bluedart/serviceable/${pincode}`),
  bdTrack: (awb: string) => request<any>(`/api/v1/bluedart/track/${awb}`),
  bdHandoff: (awb: string) => request<{ awb: string; bdWaybill: string | null; response: any }>(`/api/v1/bluedart/handoff/${awb}`, { method: 'POST' }),
  bdSync: (awb: string) => request<{ awb: string; bdStatus: string | null }>(`/api/v1/bluedart/sync/${awb}`, { method: 'POST' }),

  // ---- reports ----
  runReport: (type: string, from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const s = q.toString();
    return request<{ columns: { key: string; label: string }[]; rows: any[] }>(`/api/v1/reports/${type}${s ? '?' + s : ''}`);
  },
  createHub: (body: { code: string; name: string; zone: string }) =>
    request('/api/v1/hubs', { method: 'POST', body: JSON.stringify(body) }),

  // ---- master data ----
  listClients: () => request<Client[]>('/api/v1/clients'),
  createClient: (body: unknown) =>
    request<Client>('/api/v1/clients', { method: 'POST', body: JSON.stringify(body) }),
  bulkCreateClients: (rows: Record<string, string>[]) =>
    request<{ total: number; created: number; results: { name: string; code?: string; ok: boolean; error?: string }[] }>('/api/v1/clients/bulk', { method: 'POST', body: JSON.stringify({ rows }) }),
  updateClient: (id: string, body: unknown) =>
    request<Client>(`/api/v1/clients/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ---- customer sub-tabs ----
  listFuel: (clientId: string) => request<any[]>(`/api/v1/clients/${clientId}/fuel-surcharges`),
  addFuel: (clientId: string, body: unknown) => request(`/api/v1/clients/${clientId}/fuel-surcharges`, { method: 'POST', body: JSON.stringify(body) }),
  delFuel: (clientId: string, rowId: string) => request(`/api/v1/clients/${clientId}/fuel-surcharges/${rowId}`, { method: 'DELETE' }),
  listCharges: (clientId: string) => request<any[]>(`/api/v1/clients/${clientId}/other-charges`),
  addCharge: (clientId: string, body: unknown) => request(`/api/v1/clients/${clientId}/other-charges`, { method: 'POST', body: JSON.stringify(body) }),
  delCharge: (clientId: string, rowId: string) => request(`/api/v1/clients/${clientId}/other-charges/${rowId}`, { method: 'DELETE' }),
  listVol: (clientId: string) => request<any[]>(`/api/v1/clients/${clientId}/volumetrics`),
  addVol: (clientId: string, body: unknown) => request(`/api/v1/clients/${clientId}/volumetrics`, { method: 'POST', body: JSON.stringify(body) }),
  delVol: (clientId: string, rowId: string) => request(`/api/v1/clients/${clientId}/volumetrics/${rowId}`, { method: 'DELETE' }),
  listAddr: (clientId: string) => request<any[]>(`/api/v1/clients/${clientId}/addresses`),
  addAddr: (clientId: string, body: unknown) => request(`/api/v1/clients/${clientId}/addresses`, { method: 'POST', body: JSON.stringify(body) }),
  delAddr: (clientId: string, rowId: string) => request(`/api/v1/clients/${clientId}/addresses/${rowId}`, { method: 'DELETE' }),

  // ---- AWB Entry List ----
  awbList: (limit = 300) => request<any[]>(`/api/v1/shipments/awb-list?limit=${limit}`),

  // ---- fuel price (drives dynamic fuel surcharge) ----
  getFuelPrice: () => request<{ fuelType: string; current: number | null; effectiveFrom: string | null; history: any[] }>('/api/v1/fuel-price'),
  setFuelPrice: (body: unknown) => request('/api/v1/fuel-price', { method: 'POST', body: JSON.stringify(body) }),

  // ---- rate matrix (weight-slab tariff) ----
  listRateSlabs: (clientId?: string) => request<any[]>(`/api/v1/rate-slabs${clientId ? `?clientId=${clientId}` : ''}`),
  addRateSlab: (body: unknown) => request('/api/v1/rate-slabs', { method: 'POST', body: JSON.stringify(body) }),
  delRateSlab: (id: string) => request(`/api/v1/rate-slabs/${id}`, { method: 'DELETE' }),

  listRateCards: () => request<RateCardRow[]>('/api/v1/rate-cards'),
  createRateCard: (body: unknown) =>
    request<RateCardRow>('/api/v1/rate-cards', { method: 'POST', body: JSON.stringify(body) }),
  listFtlRates: () => request<any[]>('/api/v1/rate-cards/ftl'),
  createFtlRate: (body: unknown) =>
    request('/api/v1/rate-cards/ftl', { method: 'POST', body: JSON.stringify(body) }),

  // ---- revamped customer rate cards (eye → popout) ----
  listCustomerCards: (clientId?: string | number) =>
    request<any[]>(`/api/v1/rate-cards/cards${clientId != null ? `?clientId=${clientId}` : ''}`),
  getCustomerCard: (id: string | number) => request<any>(`/api/v1/rate-cards/cards/${id}`),
  createCustomerCard: (body: unknown) =>
    request<any>('/api/v1/rate-cards/cards', { method: 'POST', body: JSON.stringify(body) }),
  updateCustomerCard: (id: string | number, body: unknown) =>
    request<any>(`/api/v1/rate-cards/cards/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delCustomerCard: (id: string | number) =>
    request(`/api/v1/rate-cards/cards/${id}`, { method: 'DELETE' }),

  // ---- vendors ----
  listVendors: () => request<any[]>('/api/v1/vendors'),
  getVendor: (id: string) => request<any>(`/api/v1/vendors/${id}`),
  createVendor: (body: unknown) => request('/api/v1/vendors', { method: 'POST', body: JSON.stringify(body) }),
  addVendorPayment: (id: string, body: unknown) =>
    request(`/api/v1/vendors/${id}/payments`, { method: 'POST', body: JSON.stringify(body) }),
  markVendorPaid: (paymentId: string) =>
    request(`/api/v1/vendors/payments/${paymentId}/paid`, { method: 'PATCH' }),
  // ---- service mapping ----
  listServiceMappings: () => request<any[]>('/api/v1/vendors/service-mappings'),
  resolveCarrier: (weight: number, service?: string, singlePiece?: boolean) =>
    request<{ vendor: string; billingVendor?: string; vendorLink?: string; serviceType?: string; minWeight?: number; maxWeight?: number } | null>(
      `/api/v1/vendors/service-mappings/resolve?weight=${weight}${service ? `&service=${encodeURIComponent(service)}` : ''}${singlePiece != null ? `&singlePiece=${singlePiece}` : ''}`),
  addServiceMapping: (body: unknown) => request('/api/v1/vendors/service-mappings', { method: 'POST', body: JSON.stringify(body) }),
  delServiceMapping: (id: string) => request(`/api/v1/vendors/service-mappings/${id}`, { method: 'DELETE' }),

  // ---- CRM / sales ----
  listLeads: () => request<any[]>('/api/v1/leads'),
  leadPipeline: () => request<any[]>('/api/v1/leads/pipeline'),
  createLead: (body: unknown) => request('/api/v1/leads', { method: 'POST', body: JSON.stringify(body) }),
  updateLead: (id: string, body: unknown) => request(`/api/v1/leads/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  addQuotation: (leadId: string, body: unknown) =>
    request(`/api/v1/leads/${leadId}/quotations`, { method: 'POST', body: JSON.stringify(body) }),

  // ---- stats / dashboard ----
  statsOverview: () =>
    request<{
      shipments: { total: number; byStatus: Record<string, number> };
      deliveredPct: number;
      piecesInTransit: number;
      openExceptions: number;
      revenueThisMonth: number;
      outstandingReceivables: number;
      clientsOnHold: number;
      clientCount: number;
    }>('/api/v1/stats/overview'),

  // ---- pickups ----
  listPickups: () => request<any[]>('/api/v1/pickups'),
  createPickup: (body: unknown) =>
    request('/api/v1/pickups', { method: 'POST', body: JSON.stringify(body) }),
  assignPickup: (id: string, riderId: number) =>
    request(`/api/v1/pickups/${id}/assign`, { method: 'POST', body: JSON.stringify({ riderId }) }),
  completePickup: (id: string) =>
    request(`/api/v1/pickups/${id}/complete`, { method: 'POST' }),

  // ---- manifests ----
  listManifests: () => request<any[]>('/api/v1/manifests'),
  getManifest: (id: string) => request<any>(`/api/v1/manifests/${id}`),
  createManifest: (body: unknown) =>
    request<any>('/api/v1/manifests', { method: 'POST', body: JSON.stringify(body) }),
  attachManifest: (id: string, awbs: string[]) =>
    request(`/api/v1/manifests/${id}/attach`, { method: 'POST', body: JSON.stringify({ awbs }) }),
  sealManifest: (id: string) => request(`/api/v1/manifests/${id}/seal`, { method: 'POST' }),
  arriveManifest: (id: string) => request(`/api/v1/manifests/${id}/arrive`, { method: 'POST' }),

  // ---- debit / credit notes ----
  listNotes: (params: { clientId?: number; kind?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.clientId != null) q.set('clientId', String(params.clientId));
    if (params.kind) q.set('kind', params.kind);
    const s = q.toString();
    return request<any[]>(`/api/v1/notes${s ? '?' + s : ''}`);
  },
  createNote: (body: unknown) => request<any>('/api/v1/notes', { method: 'POST', body: JSON.stringify(body) }),
  cancelNote: (id: string) => request(`/api/v1/notes/${id}/cancel`, { method: 'POST' }),

  // ---- weight discrepancy (re-weigh) ----
  reweigh: (awb: string, lines: { sequenceNo: number; actualKg: number; lengthCm?: number; widthCm?: number; heightCm?: number }[]) =>
    request<{ awb: string; bookedChargeableKg: number; actualChargeableKg: number; freightDelta: number; debitNote: { noteNo: string; total: string } | null; billable: boolean }>(
      `/api/v1/shipments/${awb}/reweigh`,
      { method: 'POST', body: JSON.stringify({ lines }) },
    ),

  // ---- claims & insurance ----
  listClaims: (status?: string) => request<any[]>(`/api/v1/claims${status ? '?status=' + status : ''}`),
  createClaim: (body: unknown) => request<any>('/api/v1/claims', { method: 'POST', body: JSON.stringify(body) }),
  reviewClaim: (id: string, body: unknown) => request(`/api/v1/claims/${id}/review`, { method: 'POST', body: JSON.stringify(body) }),
  settleClaim: (id: string, body: unknown) => request(`/api/v1/claims/${id}/settle`, { method: 'POST', body: JSON.stringify(body) }),

  // ---- receivables ----
  aging: () =>
    request<{ rows: any[]; totals: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; total: number } }>(
      '/api/v1/billing/aging',
    ),
  statement: (clientId: string) => request<any>(`/api/v1/billing/clients/${clientId}/statement`),

  // ---- documents / KYC ----
  listDocuments: (entityType: string, entityId: string) =>
    request<any[]>(`/api/v1/documents?entityType=${entityType}&entityId=${entityId}`),
  uploadDocument: async (file: File, meta: { entityType: string; entityId: string; docType: string; label?: string; expiresAt?: string }) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('entityType', meta.entityType);
    fd.append('entityId', meta.entityId);
    fd.append('docType', meta.docType);
    if (meta.label) fd.append('label', meta.label);
    if (meta.expiresAt) fd.append('expiresAt', meta.expiresAt);
    const token = getToken();
    const res = await fetch(`${BASE}/api/v1/documents`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiError(res.status, data?.message || res.statusText);
    return data;
  },
  deleteDocument: (id: string) => request(`/api/v1/documents/${id}`, { method: 'DELETE' }),

  // ---- audit log (admin) ----
  auditLog: (params: { entity?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.entity) q.set('entity', params.entity);
    if (params.limit) q.set('limit', String(params.limit));
    const s = q.toString();
    return request<any[]>(`/api/v1/audit${s ? '?' + s : ''}`);
  },

  // ---- public tracking (no auth required) ----
  track: (awb: string) =>
    request<{
      awb: string;
      status: string;
      destination: string;
      pieceCount: number;
      delivered: number;
      isShort: boolean;
      timeline: { checkpoint: string; label: string; at: string }[];
    }>(`/api/v1/track/${awb}`),
};
