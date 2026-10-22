import 'package:flutter/material.dart';
import '../api_client.dart';
import '../ui.dart';

/// Rider deliveries: "Take out for delivery" (scan AWBs → OFD, they become mine), my open list,
/// find any AWB, and the delivery screen (collect DOD / To-Pay, POD photo, Delivered / Undelivered).
class DeliveriesScreen extends StatefulWidget {
  const DeliveriesScreen({super.key});
  @override
  State<DeliveriesScreen> createState() => _DeliveriesScreenState();
}

class _DeliveriesScreenState extends State<DeliveriesScreen> {
  List<Map<String, dynamic>> _list = [];
  bool _loading = true;
  String? _error;
  final _find = TextEditingController();

  bool get _isRider => ApiClient.instance.me?.isRider ?? true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!_isRider) {
      setState(() => _loading = false);
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final t = await ApiClient.instance.myTasks();
      _list = (t['deliveries'] as List).cast<Map<String, dynamic>>();
    } catch (e) {
      _error = '$e';
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _open(String awb) async {
    if (awb.trim().isEmpty) return;
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => DeliveryDetail(awb: awbFromBarcode(awb))),
    );
    if (changed == true) _load();
  }

  Future<void> _takeOut() async {
    final awbs = await CodeScanner.scanMany(context, title: 'Scan AWBs going out');
    if (awbs == null || awbs.isEmpty || !mounted) return;
    try {
      final r = await ApiClient.instance.lifecycleScan(awbs, 'OFD');
      if (!mounted) return;
      final parts = <String>['${r['updated']} out for delivery'];
      void add(String k, String label) {
        final l = (r[k] as List?) ?? [];
        if (l.isNotEmpty) parts.add('$label: ${l.join(', ')}');
      }
      add('missing', 'Not found');
      add('locked', 'Not at the destination hub yet');
      add('duplicate', 'Already out');
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Out for delivery'),
          content: Text(parts.join('\n\n')),
          actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
        ),
      );
      _load();
    } catch (e) {
      if (mounted) toast(context, '$e', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          Row(children: [
            Expanded(
              child: TextField(
                controller: _find,
                textCapitalization: TextCapitalization.characters,
                textInputAction: TextInputAction.search,
                onSubmitted: _open,
                decoration: InputDecoration(
                  hintText: 'Find AWB',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: IconButton(
                    icon: const Icon(Icons.qr_code_scanner),
                    onPressed: () async {
                      final v = await CodeScanner.scanOne(context, title: 'Scan AWB');
                      if (v != null) _open(v);
                    },
                  ),
                  border: const OutlineInputBorder(),
                  isDense: true,
                ),
              ),
            ),
          ]),
          const SizedBox(height: 10),
          FilledButton.tonalIcon(
            onPressed: _takeOut,
            icon: const Icon(Icons.local_shipping_outlined),
            label: const Text('Take out for delivery (scan)'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          ),
          if (_isRider) SectionLabel('My deliveries (${_list.length})'),
          if (_loading) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
          if (!_loading && _error != null) EmptyState(Icons.cloud_off, _error!),
          if (!_loading && _error == null && _isRider && _list.isEmpty)
            const EmptyState(Icons.route_outlined, 'Nothing out with you.\nScan AWBs above to take them out for delivery.'),
          ..._list.map((d) => Card(
                child: ListTile(
                  contentPadding: const EdgeInsets.fromLTRB(14, 8, 10, 8),
                  title: Text('${d['consigneeName'] ?? d['awb']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('${d['awb']} · ${d['pieceCount']} box(es)\n${d['address']}'),
                  isThreeLine: true,
                  trailing: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      StatusChip(d['statusCode'] as String?),
                      if (d['toPay'] == true || d['dodPending'] == true)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(d['dodPending'] == true ? 'Collect DOD' : 'Collect ₹',
                              style: const TextStyle(fontSize: 11, color: Color(0xFFB45309), fontWeight: FontWeight.w700)),
                        ),
                    ],
                  ),
                  onTap: () => _open('${d['awb']}'),
                ),
              )),
        ],
      ),
    );
  }
}

const _udlReasons = [
  'Consignee not available',
  'Address not found / incomplete',
  'Refused by consignee',
  'Premises closed',
  'Consignee asked to reschedule',
  'Payment / DOD not ready',
  'Out of delivery area',
];

class DeliveryDetail extends StatefulWidget {
  final String awb;
  const DeliveryDetail({super.key, required this.awb});
  @override
  State<DeliveryDetail> createState() => _DeliveryDetailState();
}

class _DeliveryDetailState extends State<DeliveryDetail> {
  Map<String, dynamic>? s;
  String? _error;
  String? _pod; // data URL
  bool _busy = false;
  bool _changed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await ApiClient.instance.shipment(widget.awb);
      if (mounted) setState(() => s = r);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  String get _code => '${s?['statusCode'] ?? 'MAN'}'.toUpperCase();
  bool get _dodBlocked => s?['isDod'] == true && s?['dodCollectedAt'] == null;

  Future<void> _run(Future<void> Function() fn) async {
    setState(() => _busy = true);
    try {
      await fn();
    } catch (e) {
      if (mounted) toast(context, '$e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _collectDod() async {
    final ref = await promptText(context, '${s!['dodInstrument'] == 'DD' ? 'DD' : 'Cheque'} number collected');
    if (ref == null || ref.isEmpty || !mounted) return;
    final bank = await promptText(context, 'Bank name (optional)');
    await _run(() async {
      await ApiClient.instance.collectDod(widget.awb, ref, bankName: bank);
      _changed = true;
      await _load();
      if (mounted) toast(context, 'DOD recorded.');
    });
  }

  Future<void> _collectFreight() async {
    final v = await promptText(context, 'Freight collected (₹)', initial: '${s!['freightToCollect'] ?? ''}', number: true);
    final amt = double.tryParse(v ?? '');
    if (amt == null || amt <= 0 || !mounted) return;
    await _run(() async {
      await ApiClient.instance.collectFreight(widget.awb, amt);
      _changed = true;
      await _load();
      if (mounted) toast(context, 'Collection recorded.');
    });
  }

  Future<void> _photo() async {
    try {
      final d = await takePhotoDataUrl();
      if (d != null && mounted) setState(() => _pod = d);
    } catch (e) {
      if (mounted) toast(context, 'Camera error: $e', error: true);
    }
  }

  Future<void> _outForDelivery() => _run(() async {
        final r = await ApiClient.instance.lifecycleScan([widget.awb], 'OFD');
        _changed = true;
        if ((r['updated'] ?? 0) == 0 && mounted) {
          toast(context, (r['locked'] as List?)?.isNotEmpty == true ? 'Not at the destination hub yet.' : 'Not updated.', error: true);
        }
        await _load();
      });

  Future<void> _deliver() async {
    if (_pod == null) return toast(context, 'Take the POD photo first.', error: true);
    await _run(() async {
      final r = await ApiClient.instance.lifecycleScan([widget.awb], 'DLD', podDataUrl: _pod);
      if ((r['updated'] ?? 0) > 0) {
        if (!mounted) return;
        toast(context, '${widget.awb} delivered.');
        Navigator.of(context).pop(true);
      } else {
        final why = (r['locked'] as List?)?.isNotEmpty == true
            ? 'Mark it Out for delivery first.'
            : (r['duplicate'] as List?)?.isNotEmpty == true
                ? 'Already delivered.'
                : 'Not updated.';
        if (mounted) toast(context, why, error: true);
      }
    });
  }

  Future<void> _undelivered() async {
    final reason = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          const ListTile(title: Text('Why not delivered?', style: TextStyle(fontWeight: FontWeight.w700))),
          ..._udlReasons.map((r) => ListTile(title: Text(r), onTap: () => Navigator.pop(ctx, r))),
        ]),
      ),
    );
    if (reason == null || !mounted) return;
    await _run(() async {
      final r = await ApiClient.instance.lifecycleScan([widget.awb], 'UDL', remark: reason);
      if ((r['updated'] ?? 0) > 0) {
        if (!mounted) return;
        toast(context, 'Marked undelivered — $reason');
        Navigator.of(context).pop(true);
      } else if (mounted) {
        toast(context, 'Not updated — it must be Out for delivery first.', error: true);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_changed);
      },
      child: Scaffold(
        appBar: AppBar(title: Text(widget.awb)),
        body: s == null
            ? Center(child: _error != null ? EmptyState(Icons.search_off, _error!) : const CircularProgressIndicator())
            : _body(context),
      ),
    );
  }

  Widget _body(BuildContext context) {
    final x = s!;
    final addr = [x['consigneeAddress'], x['consigneeCity'], x['destPincode']].where((v) => v != null && '$v'.isNotEmpty).join(', ');
    final phone = '${x['consigneePhone'] ?? ''}';
    final pieces = (x['rollup'] as Map?)?['pieceCount'] ?? x['pieceCount'];
    final toPay = x['paymentTerm'] == 'TO_PAY';
    final isDod = x['isDod'] == true;
    final open = !['DLD', 'RTD', 'CAN', 'RTO'].contains(_code);
    final canOfd = ['DRD', 'PKD', 'UDL'].contains(_code);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(children: [
          Expanded(child: Text('${x['consigneeName'] ?? '—'}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
          StatusChip(_code),
        ]),
        const SizedBox(height: 6),
        Text(addr),
        Text('$pieces box(es)', style: TextStyle(color: Theme.of(context).colorScheme.outline)),
        const SizedBox(height: 10),
        Wrap(spacing: 8, children: [
          if (phone.isNotEmpty) OutlinedButton.icon(onPressed: () => callPhone(phone), icon: const Icon(Icons.call), label: Text(phone)),
          if (addr.isNotEmpty) OutlinedButton.icon(onPressed: () => openMap(addr), icon: const Icon(Icons.map_outlined), label: const Text('Map')),
        ]),
        if (toPay || isDod) ...[
          const SectionLabel('Collect'),
          Card(
            color: _dodBlocked ? const Color(0xFFFFF7ED) : null,
            child: Column(children: [
              if (isDod)
                ListTile(
                  leading: const Icon(Icons.account_balance_outlined),
                  title: Text('DOD ${x['dodInstrument'] == 'DD' ? 'DD' : 'cheque'} ₹${x['dodAmount'] ?? ''}'),
                  subtitle: Text(x['dodCollectedAt'] != null ? 'Collected' : 'Not collected — required before delivery'),
                  trailing: x['dodCollectedAt'] == null && open
                      ? FilledButton(onPressed: _busy ? null : _collectDod, child: const Text('Collect'))
                      : const Icon(Icons.check_circle, color: Color(0xFF16A34A)),
                ),
              if (toPay)
                ListTile(
                  leading: const Icon(Icons.payments_outlined),
                  title: Text('To-Pay freight ₹${x['freightToCollect'] ?? ''}'),
                  subtitle: Text(x['freightCollectedAt'] != null ? 'Collected' : 'Pending'),
                  trailing: x['freightCollectedAt'] == null && open
                      ? OutlinedButton(onPressed: _busy ? null : _collectFreight, child: const Text('Collect'))
                      : const Icon(Icons.check_circle, color: Color(0xFF16A34A)),
                ),
            ]),
          ),
        ],
        if (open && canOfd) ...[
          const SizedBox(height: 16),
          FilledButton.tonalIcon(
            onPressed: _busy ? null : _outForDelivery,
            icon: const Icon(Icons.local_shipping_outlined),
            label: const Text('Take out for delivery'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          ),
        ],
        if (open && _code == 'OFD') ...[
          const SectionLabel('Proof of delivery'),
          if (_pod != null)
            Stack(children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Image.memory(UriData.parse(_pod!).contentAsBytes(), height: 220, width: double.infinity, fit: BoxFit.cover),
              ),
              Positioned(
                right: 6,
                top: 6,
                child: IconButton.filledTonal(onPressed: () => setState(() => _pod = null), icon: const Icon(Icons.close)),
              ),
            ])
          else
            OutlinedButton.icon(
              onPressed: _photo,
              icon: const Icon(Icons.photo_camera_outlined),
              label: const Text('Take POD photo'),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(64)),
            ),
          if (_dodBlocked)
            const Padding(
              padding: EdgeInsets.only(top: 10),
              child: Text('Collect the DOD cheque / DD before delivering.', style: TextStyle(color: Color(0xFFB45309), fontWeight: FontWeight.w600)),
            ),
          const SizedBox(height: 16),
          Row(children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _busy ? null : _undelivered,
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52), foregroundColor: const Color(0xFFB91C1C)),
                child: const Text('Undelivered'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              flex: 2,
              child: FilledButton.icon(
                onPressed: _busy || _dodBlocked ? null : _deliver,
                icon: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.check),
                label: const Text('Delivered'),
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              ),
            ),
          ]),
        ],
        if (!open)
          const Padding(
            padding: EdgeInsets.only(top: 24),
            child: Center(child: Text('This shipment is closed.')),
          ),
      ],
    );
  }
}
