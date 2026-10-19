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
