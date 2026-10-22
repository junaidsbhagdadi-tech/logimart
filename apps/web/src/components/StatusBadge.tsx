// One status badge for the whole app — same label + colour for a status on every screen.
// Tones: booked (neutral) · moving (blue) · ofd (amber) · done (green) · problem (red) · return (violet) · void (grey).
type Tone = 'booked' | 'moving' | 'ofd' | 'done' | 'problem' | 'return' | 'void';

const BY_CODE: Record<string, [string, Tone]> = {
  // milestone codes (statusCode)
  MAN: ['Booked', 'booked'], PKD: ['Picked', 'moving'], ORD: ['At origin hub', 'moving'], DPD: ['In transit', 'moving'],
  DRD: ['At destination hub', 'moving'], OFD: ['Out for delivery', 'ofd'], DLD: ['Delivered', 'done'],
  UDL: ['Undelivered', 'problem'], RTO: ['Return to origin', 'return'], RTD: ['Returned', 'return'], CAN: ['Cancelled', 'void'],
  // legacy status enum (status)
  CREATED: ['Booked', 'booked'], PICKED_UP: ['Picked', 'moving'], AT_HUB: ['At hub', 'moving'], LOADED: ['In transit', 'moving'],
  IN_TRANSIT: ['In transit', 'moving'], OUT_FOR_DELIVERY: ['Out for delivery', 'ofd'], DELIVERED: ['Delivered', 'done'],
  PARTIAL: ['Part delivered', 'problem'], EXCEPTION: ['Exception', 'problem'], CANCELLED: ['Cancelled', 'void'],
};

/** Label + tone for a status code (milestone or legacy enum); unknown codes show as-is, neutral. */
export function statusInfo(code?: string | null): { label: string; tone: Tone } {
  const k = String(code || 'MAN').toUpperCase();
  const hit = BY_CODE[k];
  return hit ? { label: hit[0], tone: hit[1] } : { label: String(code), tone: 'booked' };
}

export function StatusBadge({ code, label, title }: { code?: string | null; label?: string; title?: string }) {
  const info = statusInfo(code);
  return <span className={`st st-${info.tone}`} title={title ?? String(code || '')}>{label ?? info.label}</span>;
}
