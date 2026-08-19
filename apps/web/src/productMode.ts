// Shared product → transport-mode mapping (used by New Shipment + Bulk Booking).
// Product is the single service selector; the billing/transport mode is derived from
// the product's master 'service'/'mode' attribute.
export const MODES = ['AIR_EXPRESS', 'AIR_ECONOMY', 'ROAD_FTL', 'ROAD_PTL', 'RAIL'];

export function mapMode(v?: string): string {
  const s = (v || '').toString().trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!s) return '';
  if (MODES.includes(s)) return s;
  if (s.includes('FTL')) return 'ROAD_FTL';
  if (s.includes('PTL') || s.includes('SURFACE') || s.includes('ROAD')) return 'ROAD_PTL';
  if (s.includes('RAIL') || s.includes('TRAIN')) return 'RAIL';
  if (s.includes('ECON')) return 'AIR_ECONOMY';
  if (s.includes('AIR') || s.includes('EXP') || s.includes('PRIOR')) return 'AIR_EXPRESS';
  return '';
}

const MODE_LABEL: Record<string, string> = {
  AIR_EXPRESS: 'Air — Express', AIR_ECONOMY: 'Air — Economy',
  ROAD_FTL: 'Road — FTL', ROAD_PTL: 'Road — PTL', RAIL: 'Rail',
};
export const modeLabel = (m: string) => MODE_LABEL[m] ?? m;
