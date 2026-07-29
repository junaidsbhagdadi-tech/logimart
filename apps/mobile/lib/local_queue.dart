import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';
import 'models/scan.dart';

/// Offline write-ahead queue. Scans live here first and survive app restarts,
/// dead zones, and crashes until the sync service confirms the server took them.
class LocalQueue {
  LocalQueue._();
  static final LocalQueue instance = LocalQueue._();

  Database? _db;

  Future<Database> get _database async {
    if (_db != null) return _db!;
    final dir = await getDatabasesPath();
    _db = await openDatabase(
      p.join(dir, 'logimart_scans.db'),
      version: 1,
      onCreate: (db, _) => db.execute('''
        CREATE TABLE scans (
          client_event_id TEXT PRIMARY KEY,
          barcode TEXT NOT NULL,
          checkpoint TEXT NOT NULL,
          scanned_at TEXT NOT NULL,
          device_seq INTEGER NOT NULL,
          lat REAL,
          lng REAL,
          synced INTEGER NOT NULL DEFAULT 0
        )
      '''),
    );
    return _db!;
  }

  Future<void> enqueue(Scan scan) async {
    final db = await _database;
    // INSERT OR IGNORE: a local double-tap on the same client_event_id is a no-op.
    await db.insert('scans', scan.toDb(), conflictAlgorithm: ConflictAlgorithm.ignore);
  }

  Future<List<Scan>> unsynced({int limit = 500}) async {
    final db = await _database;
    final rows = await db.query('scans',
        where: 'synced = 0', orderBy: 'device_seq ASC', limit: limit);
    return rows.map(Scan.fromDb).toList();
  }

  /// Mark the given client_event_ids as synced (accepted OR duplicate on server).
  Future<void> markSynced(List<String> clientEventIds) async {
    if (clientEventIds.isEmpty) return;
    final db = await _database;
    final placeholders = List.filled(clientEventIds.length, '?').join(',');
    await db.rawUpdate(
      'UPDATE scans SET synced = 1 WHERE client_event_id IN ($placeholders)',
      clientEventIds,
    );
  }

  Future<int> pendingCount() async {
    final db = await _database;
    final r = await db.rawQuery('SELECT COUNT(*) c FROM scans WHERE synced = 0');
    return Sqflite.firstIntValue(r) ?? 0;
  }

  Future<int> nextDeviceSeq() async {
    final db = await _database;
    final r = await db.rawQuery('SELECT MAX(device_seq) m FROM scans');
    return (Sqflite.firstIntValue(r) ?? 0) + 1;
  }

  Future<List<Scan>> recent({int limit = 30}) async {
    final db = await _database;
    final rows = await db.query('scans', orderBy: 'device_seq DESC', limit: limit);
    return rows.map(Scan.fromDb).toList();
  }
}
