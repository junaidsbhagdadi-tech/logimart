import { PieceStatus, ScanCheckpoint } from '@prisma/client';

/**
 * Maps a scan checkpoint to the piece status it implies, plus a rank used to
 * decide "forward progress". Status is a PROJECTION of the ordered event log,
 * never last-write-wins — so out-of-order sync still resolves correctly.
 */
const CHECKPOINT_TO_STATUS: Record<ScanCheckpoint, PieceStatus> = {
  PICKUP: PieceStatus.PICKED_UP,
  HUB_IN: PieceStatus.AT_HUB,
  HUB_OUT: PieceStatus.AT_HUB,
  LOAD: PieceStatus.LOADED,
  UNLOAD: PieceStatus.AT_HUB,
  OUT_FOR_DELIVERY: PieceStatus.OUT_FOR_DELIVERY,
  DELIVERY: PieceStatus.DELIVERED,
  POD: PieceStatus.DELIVERED,
};

const STATUS_RANK: Record<PieceStatus, number> = {
  CREATED: 0,
  PICKED_UP: 1,
  AT_HUB: 2,
  LOADED: 3,
  IN_TRANSIT: 4,
  OUT_FOR_DELIVERY: 5,
  DELIVERED: 6,
  MISSING: -1,
  DAMAGED: -1,
};

export interface OrderedScan {
  checkpoint: ScanCheckpoint;
  scannedAt: Date;
  deviceSeq: bigint | null;
  hubId: bigint | null;
}

export interface ProjectionResult {
  status: PieceStatus;
  anomaly?: string;
}

/**
 * Replay a piece's full event set (any arrival order) into a final status.
 * - Sort by device scannedAt, deviceSeq as tiebreaker.
 * - Advance only forward by rank; a backward checkpoint after DELIVERED, or a
 *   DELIVERY before any LOAD, is recorded as an anomaly instead of corrupting.
 */
export function projectPieceStatus(events: OrderedScan[]): ProjectionResult {
  if (events.length === 0) return { status: PieceStatus.CREATED };

  const sorted = [...events].sort((a, b) => {
    const t = a.scannedAt.getTime() - b.scannedAt.getTime();
    if (t !== 0) return t;
    return Number((a.deviceSeq ?? 0n) - (b.deviceSeq ?? 0n));
  });

  let status: PieceStatus = PieceStatus.CREATED;
  let sawLoad = false;
  let anomaly: string | undefined;

  for (const e of sorted) {
    const next = CHECKPOINT_TO_STATUS[e.checkpoint];
    if (e.checkpoint === ScanCheckpoint.LOAD) sawLoad = true;

    if (
      (e.checkpoint === ScanCheckpoint.DELIVERY || e.checkpoint === ScanCheckpoint.POD) &&
      !sawLoad
    ) {
      anomaly = 'delivery_before_load';
    }

    // forward-only progress
    if (STATUS_RANK[next] >= STATUS_RANK[status]) {
      status = next;
    }
  }

  return { status, anomaly };
}
