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
  lrNumber?: string | null;
  ewbNo?: string | null;
  ewbValidUpto?: string | null;
  vehicleNo?: string | null;
  ftlVehicleType?: string | null;
  departureAt?: string | null;
  arrivalAt?: string | null;
  // payment terms
  paymentTerm?: 'PREPAID' | 'TO_PAY';
  freightToCollect?: string | null;
  freightCollected?: string | null;
  freightCollectedAt?: string | null;
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
  contactPhone: string | null;
  creditLimit: string;
  creditDays: number;
  outstandingBal: string;
  isCreditHold: boolean;
  isActive: boolean;
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

  // ---- finance ----
  rateQuote: (awb: string) => request<RateQuote>(`/api/v1/shipments/${awb}/rate-quote`),
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

  // ---- master data ----
  listClients: () => request<Client[]>('/api/v1/clients'),
  createClient: (body: unknown) =>
    request<Client>('/api/v1/clients', { method: 'POST', body: JSON.stringify(body) }),
  updateClient: (id: string, body: unknown) =>
    request<Client>(`/api/v1/clients/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  listRateCards: () => request<RateCardRow[]>('/api/v1/rate-cards'),
  createRateCard: (body: unknown) =>
    request<RateCardRow>('/api/v1/rate-cards', { method: 'POST', body: JSON.stringify(body) }),
  listFtlRates: () => request<any[]>('/api/v1/rate-cards/ftl'),
  createFtlRate: (body: unknown) =>
    request('/api/v1/rate-cards/ftl', { method: 'POST', body: JSON.stringify(body) }),

  // ---- vendors ----
  listVendors: () => request<any[]>('/api/v1/vendors'),
  getVendor: (id: string) => request<any>(`/api/v1/vendors/${id}`),
  createVendor: (body: unknown) => request('/api/v1/vendors', { method: 'POST', body: JSON.stringify(body) }),
  addVendorPayment: (id: string, body: unknown) =>
    request(`/api/v1/vendors/${id}/payments`, { method: 'POST', body: JSON.stringify(body) }),
  markVendorPaid: (paymentId: string) =>
    request(`/api/v1/vendors/payments/${paymentId}/paid`, { method: 'PATCH' }),

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
