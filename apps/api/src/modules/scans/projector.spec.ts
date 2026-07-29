import { projectPieceStatus, OrderedScan } from './projector';

const ev = (checkpoint: any, isoTime: string, deviceSeq?: number): OrderedScan => ({
  checkpoint,
  scannedAt: new Date(isoTime),
  deviceSeq: deviceSeq != null ? BigInt(deviceSeq) : null,
  hubId: null,
});

describe('projectPieceStatus (offline-first state machine)', () => {
  it('returns CREATED for no events', () => {
    expect(projectPieceStatus([]).status).toBe('CREATED');
  });

  it('advances through the normal lifecycle', () => {
    const events = [
      ev('PICKUP', '2026-06-18T08:00:00Z'),
      ev('HUB_IN', '2026-06-18T09:00:00Z'),
      ev('LOAD', '2026-06-18T10:00:00Z'),
      ev('DELIVERY', '2026-06-18T14:00:00Z'),
    ];
    expect(projectPieceStatus(events).status).toBe('DELIVERED');
  });

  it('resolves OUT-OF-ORDER arrival by device time, not arrival order', () => {
    // HUB_OUT synced before HUB_IN (dead-zone sync delay) — still correct.
    const outOfOrder = [
      ev('LOAD', '2026-06-18T10:00:00Z'),
      ev('PICKUP', '2026-06-18T08:00:00Z'),
      ev('HUB_IN', '2026-06-18T09:00:00Z'),
    ];
    expect(projectPieceStatus(outOfOrder).status).toBe('LOADED');
  });

  it('does NOT regress when a backward checkpoint arrives late', () => {
    const events = [
      ev('DELIVERY', '2026-06-18T14:00:00Z'),
      ev('HUB_IN', '2026-06-18T09:00:00Z'), // arrives after, must not downgrade
      ev('LOAD', '2026-06-18T10:00:00Z'),
    ];
    expect(projectPieceStatus(events).status).toBe('DELIVERED');
  });

  it('flags an anomaly when delivery happens before any load', () => {
    const events = [
      ev('PICKUP', '2026-06-18T08:00:00Z'),
      ev('DELIVERY', '2026-06-18T09:00:00Z'),
    ];
    const res = projectPieceStatus(events);
    expect(res.status).toBe('DELIVERED');
    expect(res.anomaly).toBe('delivery_before_load');
  });

  it('uses deviceSeq as a tiebreaker for identical timestamps', () => {
    const t = '2026-06-18T09:00:00Z';
    const events = [ev('LOAD', t, 2), ev('HUB_IN', t, 1)];
    expect(projectPieceStatus(events).status).toBe('LOADED');
  });
});
