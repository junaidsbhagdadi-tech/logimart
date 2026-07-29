/// A single scan event, queued locally before it syncs to the ERP.
class Scan {
  final String clientEventId; // UUID — the server's idempotency key
  final String barcode; // child id, e.g. LMT2026000001-002
  final String checkpoint;
  final String scannedAt; // ISO8601, device clock
  final int deviceSeq; // monotonic per-device ordering tiebreaker
  final double? lat;
  final double? lng;
  final bool synced;

  Scan({
    required this.clientEventId,
    required this.barcode,
    required this.checkpoint,
    required this.scannedAt,
    required this.deviceSeq,
    this.lat,
    this.lng,
    this.synced = false,
  });

  Map<String, Object?> toDb() => {
        'client_event_id': clientEventId,
        'barcode': barcode,
        'checkpoint': checkpoint,
        'scanned_at': scannedAt,
        'device_seq': deviceSeq,
        'lat': lat,
        'lng': lng,
        'synced': synced ? 1 : 0,
      };

  factory Scan.fromDb(Map<String, Object?> r) => Scan(
        clientEventId: r['client_event_id'] as String,
        barcode: r['barcode'] as String,
        checkpoint: r['checkpoint'] as String,
        scannedAt: r['scanned_at'] as String,
        deviceSeq: r['device_seq'] as int,
        lat: r['lat'] as double?,
        lng: r['lng'] as double?,
        synced: (r['synced'] as int) == 1,
      );

  /// Shape the server's /scans/bulk-sync expects per event.
  Map<String, Object?> toSyncJson() => {
        'clientEventId': clientEventId,
        'barcode': barcode,
        'checkpoint': checkpoint,
        'scannedAt': scannedAt,
        'deviceSeq': deviceSeq,
        if (lat != null && lng != null) 'gps': {'lat': lat, 'lng': lng},
      };
}
