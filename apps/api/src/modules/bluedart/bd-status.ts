import { ShipmentStatus } from '@prisma/client';

// Maps BlueDart's free-text scan status → our internal milestone code.
// Mirrors the (read-time) display mapper in lifecycle.service.ts so the persisted
// statusCode and the tracker's displayed code never disagree.
export function bdStatusToCode(st: string): string | null {
  const u = String(st).toUpperCase();
  if (/UNDELIVER|NOT DELIVER|UNDEL/.test(u)) return 'UDL';
  if (/RTO|RETURN TO ORIG/.test(u)) return 'RTO';
  if (/DELIVER/.test(u)) return 'DLD';
  if (/OUT FOR DELIVERY|\bOFD\b/.test(u)) return 'OFD';
  if (/ARRIV|REACHED|IN ?SCAN|RECEIVED AT|DESTINATION/.test(u)) return 'DRD';
  if (/IN ?TRANSIT|DEPART|BAGGED|CONNECT|FORWARD|OUTSCAN/.test(u)) return 'DPD';
  if (/PICK/.test(u)) return 'PKD';
  return null;
}

// Forward milestone order (monotonic — status never regresses along this line).
export const STATUS_ORDER = ['MAN', 'PKD', 'ORD', 'DPD', 'DRD', 'OFD', 'DLD'];

const TO_ENUM: Record<string, ShipmentStatus> = {
  MAN: ShipmentStatus.CREATED, PKD: ShipmentStatus.PICKED_UP, ORD: ShipmentStatus.AT_HUB,
  DPD: ShipmentStatus.IN_TRANSIT, DRD: ShipmentStatus.AT_HUB, OFD: ShipmentStatus.OUT_FOR_DELIVERY,
  DLD: ShipmentStatus.DELIVERED, UDL: ShipmentStatus.EXCEPTION,
  RTO: ShipmentStatus.IN_TRANSIT, RTD: ShipmentStatus.DELIVERED, CAN: ShipmentStatus.CANCELLED,
};

/**
 * Given the current internal statusCode and a BlueDart status string, derive the
 * statusCode/status the shipment should now hold. Returns null when nothing should change.
 * - Never touches a CANCELLED shipment.
 * - Never regresses a terminal delivered state (DLD/RTD).
 * - UDL/RTO win over the forward line (exception/return), unless already delivered.
 * - Otherwise advances only forward along STATUS_ORDER.
 */
export function deriveStatusFromBd(
  currentStatusCode: string | null | undefined,
  bdStatusText: string | null | undefined,
): { statusCode: string; status: ShipmentStatus } | null {
  if (!bdStatusText) return null;
  const cur = String(currentStatusCode || 'MAN').toUpperCase();
  if (cur === 'CAN') return null;
  const mapped = bdStatusToCode(bdStatusText);
  if (!mapped) return null;
  let eff = cur;
  if (mapped === 'UDL' || mapped === 'RTO') {
    if (eff !== 'DLD' && eff !== 'RTD') eff = mapped;
  } else if (STATUS_ORDER.indexOf(mapped) > STATUS_ORDER.indexOf(eff)) {
    eff = mapped;
  }
  if (eff === cur) return null;
  return { statusCode: eff, status: TO_ENUM[eff] ?? ShipmentStatus.IN_TRANSIT };
}
