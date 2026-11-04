import { ShipmentStatus } from '@prisma/client';

// Maps a carrier's free-text scan status (BlueDart, Delhivery) → our internal milestone code.
// The ONE mapper: the sync write-through, the backfill and the tracker page all use it, so the
// persisted statusCode and what the tracker displays never disagree.
//
// Rule order matters — many texts mention "DELIVERY" without being delivered
// ("SHIPMENT OUT FOR DELIVERY", "DELIVERY SCHEDULED THROUGH APPOINTMENT", "NETWORK DELAY, WILL IMPACT
// DELIVERY", "OFFICE CLOSED; UNABLE TO DELIVER"). Only the word DELIVERED itself means delivered.
export function bdStatusToCode(st: string): string | null {
  const u = String(st).toUpperCase();
  // Return leg: back with the shipper = RTO delivered (terminal); on its way back = RTO.
  if (/RETURNED BACK TO SHIPPER|RETURN(ED)? DELIVERED|RTO DELIVERED|DELIVERED TO SHIPPER/.test(u)) return 'RTD';
  if (/\bRTO\b|RETURN(ED)? TO (ORIGIN|ORIG|SHIPPER)/.test(u)) return 'RTO';
  // Delivery exceptions (NDR reasons / holds) — CS needs to act.
  if (/UNDELIVER|NOT DELIVER|UNABLE TO DELIVER|REFUSED|NOT AVAILABLE|SHIFTED|NO SUCH CONSIGNEE|INCOMPLETE ADDRESS|ADDRESS INCORRECT|DOOR LOCKED|PREMISES CLOSED|OFFICE CLOSED|ON HOLD|\bHELD\b|CONTACT CUSTOMER SERVICE/.test(u)) return 'UDL';
  if (/OUT FOR DELIVERY|\bOFD\b/.test(u)) return 'OFD';
  if (/\bDELIVERED\b/.test(u)) return 'DLD';
  if (/ARRIV|REACHED|IN ?SCAN|RECEIVED AT|DESTINATION|DELIVERY SCHEDULED|APPOINTMENT/.test(u)) return 'DRD';
  if (/IN ?TRANSIT|DEPART|BAGGED|CONNECT|FORWARD|REDIRECT|OUTSCAN|NETWORK (DELAY|ISSUE)|WILL IMPACT DELIVERY/.test(u)) return 'DPD';
  if (/OUT TO P\/?U|PICKUP (SCHEDULED|REGISTERED)/.test(u)) return null; // pickup not done yet
  if (/PICK/.test(u)) return 'PKD';
  return null;
}

/** True once the carrier status is final — auto-sync can stop polling it. */
export function isFinalBdStatus(st: string | null | undefined): boolean {
  if (!st) return false;
  if (/CANCEL/i.test(st)) return true;
  const c = bdStatusToCode(st);
  return c === 'DLD' || c === 'RTD';
}

// Forward milestone order (monotonic — status never regresses along this line).
export const STATUS_ORDER = ['MAN', 'PKD', 'ORD', 'DPD', 'DRD', 'OFD', 'DLD'];

const TO_ENUM: Record<string, ShipmentStatus> = {
  MAN: ShipmentStatus.CREATED, PKD: ShipmentStatus.PICKED_UP, ORD: ShipmentStatus.AT_HUB,
  DPD: ShipmentStatus.IN_TRANSIT, DRD: ShipmentStatus.AT_HUB, OFD: ShipmentStatus.OUT_FOR_DELIVERY,
  DLD: ShipmentStatus.DELIVERED, UDL: ShipmentStatus.EXCEPTION,
  RTO: ShipmentStatus.IN_TRANSIT, RTD: ShipmentStatus.DELIVERED, CAN: ShipmentStatus.CANCELLED,
};

/** The milestone a shipment should show given its stored code + the carrier text (stored code if no change). */
export function effectiveCode(currentStatusCode: string | null | undefined, bdStatusText: string | null | undefined): string {
  return deriveStatusFromBd(currentStatusCode, bdStatusText)?.statusCode ?? String(currentStatusCode || 'MAN').toUpperCase();
}

/**
 * Given the current internal statusCode and a carrier status string, derive the
 * statusCode/status the shipment should now hold. Returns null when nothing should change.
 * - Never touches a CANCELLED shipment; never moves off a terminal DLD / RTD.
 * - On the return leg (RTO) only "back with shipper" (or a delivered scan, which on an RTO is the
 *   return delivery) moves it on — to RTD. Return-leg transit scans don't flip it back to forward.
 * - RTO / RTD / UDL (exception) apply from any open state.
 * - Otherwise advances only forward along STATUS_ORDER (UDL → a re-attempt OFD/DLD is forward).
 */
export function deriveStatusFromBd(
  currentStatusCode: string | null | undefined,
  bdStatusText: string | null | undefined,
): { statusCode: string; status: ShipmentStatus } | null {
  if (!bdStatusText) return null;
  const cur = String(currentStatusCode || 'MAN').toUpperCase();
  if (cur === 'CAN' || cur === 'DLD' || cur === 'RTD') return null;
  const mapped = bdStatusToCode(bdStatusText);
  if (!mapped) return null;
  let eff = cur;
  if (cur === 'RTO') {
    if (mapped === 'RTD' || mapped === 'DLD') eff = 'RTD';
  } else if (mapped === 'RTD' || mapped === 'RTO' || mapped === 'UDL') {
    eff = mapped;
  } else if (STATUS_ORDER.indexOf(mapped) > STATUS_ORDER.indexOf(cur)) {
    eff = mapped; // includes UDL (index -1) → any forward re-attempt status
  }
  if (eff === cur) return null;
  return { statusCode: eff, status: TO_ENUM[eff] ?? ShipmentStatus.IN_TRANSIT };
}

// ---- Carrier scan history (Shipment.bdScans) — the one JSON every carrier writes, so the tracker, the CS
//      "Last scan" column and the pickup date read Delhivery / XpressBees history exactly like BlueDart's.
//      Row shape (BlueDart's): { scan, date: "30-Oct-2026", time: "2205", location, carrier }.
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export type CarrierScan = { scan: string; date: string; time: string; location: string | null; carrier: string };
/** One scan row from an IST wall-clock time (y, m 1-12, d, hh, mm). */
export function carrierScanRow(carrier: string, scan: string, y: number, m: number, d: number, hh: number, mm: number, location?: string | null): CarrierScan {
  return { scan, date: `${String(d).padStart(2, '0')}-${MON3[m - 1]}-${y}`, time: `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`, location: location || null, carrier };
}
/** Merge new carrier scans into the stored JSON (dedupe on date+time+text), newest first like BlueDart. */
export function mergeCarrierScans(oldJson: string | null | undefined, add: CarrierScan[]): string | null {
  let old: any[] = [];
  try { old = oldJson ? JSON.parse(oldJson) : []; } catch { old = []; }
  const key = (x: any) => `${x?.date}|${x?.time}|${String(x?.scan ?? '').toUpperCase()}`;
  const seen = new Set(old.map(key));
  const fresh = add.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
  const merged = [...old, ...fresh];
  const at = (x: any) => { const [d, mo, y] = String(x?.date ?? '').split('-'); const t = String(x?.time ?? '').replace(/\D/g, '').padStart(4, '0'); return `${y}${String(MON3.indexOf(mo)).padStart(2, '0')}${d}${t}`; };
  merged.sort((a, b) => at(b).localeCompare(at(a)));
  return merged.length ? JSON.stringify(merged) : null;
}
