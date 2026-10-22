import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:uuid/uuid.dart';
import '../config.dart';
import '../local_queue.dart';
import '../models/scan.dart';
import '../sync_service.dart';

/// Hub / checkpoint scanning — offline-first; scans queue on the phone and sync when online.
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});
  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final _uuid = const Uuid();
  final _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.normal, // de-dup rapid repeats of same code
  );
  String _checkpoint = kCheckpoints.first;
  int _pending = 0;
  String? _lastBarcode;
  String _status = '';

  @override
  void initState() {
    super.initState();
    SyncService.instance.startAutoSync();
    _refreshPending();
  }

  Future<void> _refreshPending() async {
    final n = await LocalQueue.instance.pendingCount();
    if (mounted) setState(() => _pending = n);
  }

  Future<void> _enqueue(String barcode) async {
    if (barcode == _lastBarcode) return; // ignore immediate repeat frames
    _lastBarcode = barcode;
    final seq = await LocalQueue.instance.nextDeviceSeq();
    await LocalQueue.instance.enqueue(Scan(
      clientEventId: _uuid.v4(),
      barcode: barcode,
      checkpoint: _checkpoint,
      scannedAt: DateTime.now().toUtc().toIso8601String(),
      deviceSeq: seq,
    ));
    await _refreshPending();
    if (mounted) {
      setState(() => _status = '$_checkpoint  •  $barcode');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Queued $barcode'), duration: const Duration(milliseconds: 600)),
      );
    }
  }

  Future<void> _syncNow() async {
    setState(() => _status = 'Syncing…');
    try {
      final n = await SyncService.instance.sync();
      setState(() => _status = 'Synced $n event(s)');
    } catch (e) {
      setState(() => _status = 'Sync error: $e');
    }
    await _refreshPending();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(8),
            child: DropdownButtonFormField<String>(
              initialValue: _checkpoint,
              decoration: const InputDecoration(labelText: 'Checkpoint'),
              items: kCheckpoints
                  .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                  .toList(),
              onChanged: (v) => setState(() => _checkpoint = v!),
            ),
          ),
          Expanded(
            child: MobileScanner(
              controller: _controller,
              onDetect: (capture) {
                for (final b in capture.barcodes) {
                  final v = b.rawValue;
                  if (v != null && v.isNotEmpty) _enqueue(v);
                }
              },
            ),
          ),
          Container(
            color: Colors.black87,
            padding: const EdgeInsets.all(12),
            width: double.infinity,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_status, style: const TextStyle(color: Colors.white)),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Pending: $_pending',
                        style: const TextStyle(color: Colors.white, fontSize: 16)),
                    FilledButton.icon(
                      onPressed: _syncNow,
                      icon: const Icon(Icons.sync),
                      label: const Text('Sync now'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _manualEntry,
        tooltip: 'Manual entry',
        child: const Icon(Icons.keyboard),
      ),
    );
  }

  Future<void> _manualEntry() async {
    final ctrl = TextEditingController();
    final v = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Manual barcode'),
        content: TextField(controller: ctrl, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(context, ctrl.text.trim()),
              child: const Text('Add')),
        ],
      ),
    );
    if (v != null && v.isNotEmpty) {
      _lastBarcode = null; // allow manual same-as-last
      await _enqueue(v);
    }
  }
}
