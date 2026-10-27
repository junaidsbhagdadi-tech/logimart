import { PrismaService } from '../prisma/prisma.service';

/**
 * A readable place name for a pincode (invoices, MIS). The pincode master holds a 3-letter city CODE and an
 * area name — for towns the area name IS the town (RUDRAPUR, RANIPET), but metro pincodes carry a locality
 * (110001 → "ANTARIKSH"), so metro codes map to the city's name. Order: the city typed on the shipment →
 * metro name → area name → city code.
 */
const METRO: Record<string, string> = {
  DEL: 'DELHI', NDL: 'NEW DELHI', BOM: 'MUMBAI', NBM: 'NAVI MUMBAI', THN: 'THANE', BLR: 'BENGALURU', MAA: 'CHENNAI',
  HYD: 'HYDERABAD', CCU: 'KOLKATA', PNQ: 'PUNE', AHD: 'AHMEDABAD', AMD: 'AHMEDABAD', JAI: 'JAIPUR', GGN: 'GURUGRAM',
  NOI: 'NOIDA', NDA: 'NOIDA', GZB: 'GHAZIABAD', FBD: 'FARIDABAD', LKO: 'LUCKNOW', CHD: 'CHANDIGARH', IXC: 'CHANDIGARH',
  IDR: 'INDORE', BHO: 'BHOPAL', NAG: 'NAGPUR', SUR: 'SURAT', STV: 'SURAT', BDQ: 'VADODARA', COK: 'KOCHI', CJB: 'COIMBATORE',
  PAT: 'PATNA', IXR: 'RANCHI', BBI: 'BHUBANESWAR', GAU: 'GUWAHATI', LDH: 'LUDHIANA', ATQ: 'AMRITSAR', VNS: 'VARANASI',
  KNU: 'KANPUR', AGR: 'AGRA', DED: 'DEHRADUN', RPR: 'RAIPUR', VZG: 'VISAKHAPATNAM', VGA: 'VIJAYAWADA', MDU: 'MADURAI',
  TRV: 'THIRUVANANTHAPURAM', IXM: 'MADURAI', MYS: 'MYSURU', IXE: 'MANGALURU', GOI: 'GOA',
};

type PinRow = { city: string | null; areaName: string | null };

export function placeName(typedCity: string | null | undefined, pin: PinRow | undefined | null, fallback?: string | null): string {
  const t = String(typedCity ?? '').trim();
  if (t && !/^[A-Z]{3}$/.test(t)) return t.toUpperCase(); // a real name, not a 3-letter code
  const code = (t || String(pin?.city ?? '')).toUpperCase();
  return METRO[code] || String(pin?.areaName ?? '').trim().toUpperCase() || code || String(fallback ?? '').toUpperCase();
}

/**
 * A city NAME for carrier APIs. Our city fields often hold the 3-letter area code ("DEL", "BOM" — the customer
 * and pincode masters store codes), which carriers reject ("Consignor city must be valid"). The first candidate
 * that is a real name wins; otherwise the code / pincode is turned into a name (DEL → DELHI, BOM → MUMBAI).
 */
export async function cityName(prisma: PrismaService, pincode: string | null | undefined, ...candidates: (string | null | undefined)[]): Promise<string> {
  const list = candidates.map((c) => String(c ?? '').trim()).filter(Boolean);
  const real = list.find((c) => !/^[A-Za-z]{3}$/.test(c));
  if (real) return real;
  const pin = String(pincode ?? '').trim();
  const row = /^\d{6}$/.test(pin) ? await prisma.pincode.findUnique({ where: { pincode: pin }, select: { city: true, areaName: true } }).catch(() => null) : null;
  return placeName(list[0]?.toUpperCase() || null, row);
}

/** Look up many pincodes at once → pincode → row. */
export async function pinRows(prisma: PrismaService, pins: (string | null | undefined)[]): Promise<Map<string, PinRow>> {
  const list = [...new Set(pins.map((p) => String(p ?? '').trim()).filter((p) => /^\d{6}$/.test(p)))];
  if (!list.length) return new Map();
  const rows = await prisma.pincode.findMany({ where: { pincode: { in: list } }, select: { pincode: true, city: true, areaName: true } });
  return new Map(rows.map((r) => [r.pincode, { city: r.city, areaName: r.areaName }]));
}
