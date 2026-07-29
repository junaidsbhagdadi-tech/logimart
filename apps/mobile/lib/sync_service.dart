import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'api_client.dart';
import 'local_queue.dart';

/// Drains the offline queue to the server. Safe to call repeatedly — the
/// server dedups on clientEventId, and we only clear what the server settled.
class SyncService {
  SyncService._();
  static final SyncService instance = SyncService._();

  final String deviceId = 'FLUTTER-${DateTime.now().millisecondsSinceEpoch % 100000}';
  bool _running = false;
  StreamSubscription? _sub;

  /// Auto-sync whenever connectivity returns.
  void startAutoSync() {
    _sub ??= Connectivity().onConnectivityChanged.listen((results) {
      if (!results.contains(ConnectivityResult.none)) {
        sync();
      }
    });
  }

  void dispose() => _sub?.cancel();

  /// Returns the number of events the server settled this run.
  Future<int> sync() async {
    if (_running) return 0;
    _running = true;
    var settled = 0;
    try {
      // page through the backlog in batches of 500
      while (true) {
        final batch = await LocalQueue.instance.unsynced(limit: 500);
        if (batch.isEmpty) break;
        final result = await ApiClient.instance.bulkSync(deviceId, batch);
        await LocalQueue.instance.markSynced(result.settled);
        settled += result.settled.length;
        // rejected events stay in the queue; stop if nothing settled to avoid a loop
        if (result.settled.isEmpty) break;
      }
    } finally {
      _running = false;
    }
    return settled;
  }
}
