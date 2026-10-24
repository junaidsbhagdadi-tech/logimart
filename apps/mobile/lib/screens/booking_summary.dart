import 'package:flutter/material.dart';
import '../api_client.dart';
import '../ui.dart';
import 'print_view.dart';

/// One booked shipment: the details, Edit (while still Booked and not with a carrier), Hand to carrier
/// (generates the carrier AWB), and the prints — AWB copy, courier label, BlueDart AWB.
class BookingSummary extends StatefulWidget {
  final String awb;
  final bool justBooked;
  const BookingSummary({super.key, required this.awb, this.justBooked = false});
  @override
  State<BookingSummary> createState() => _BookingSummaryState();
}

class _BookingSummaryState extends State<BookingSummary> {
  Map<String, dynamic>? s;
  String? _error;
  bool _busy = false;
  List<String> _bdCodes = [];

  @override
  void initState() {
    super.initState();
    _load();
    ApiClient.instance.blueDartCodes().then((c) => setState(() => _bdCodes = c)).catchError((_) {});
  }

  Future<void> _load() async {
    try {
      final r = await ApiClient.instance.shipment(widget.awb);
      if (mounted) setState(() => s = r);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  String get _vendor => '${s?['vendor'] ?? ''}'.toUpperCase();
  String get _carrier {
    if (s?['bdWaybill'] != null || RegExp(r'^(BLUE|BDR)').hasMatch(_vendor) || _bdCodes.contains(_vendor)) return 'BD';
    if (RegExp(r'DELHIVERY|^DLY').hasMatch(_vendor)) return 'DLY';
    if (RegExp(r'^XPB$|XPRESS\s*BEES|^XB$').hasMatch(_vendor)) return 'XB';
    if (RegExp(r'^GATI$|ALLCARGO').hasMatch(_vendor)) return 'GATI';
    if (RegExp(r'^VXP$|^VX$|V\s*EXPRESS').hasMatch(_vendor)) return 'VXP';
    if (RegExp(r'^ARL$|AR\s*LOG').hasMatch(_vendor)) return 'ARL';
    return _vendor.isEmpty || _vendor == 'SELF' ? 'SELF' : 'OTHER';
  }

  String? get _carrierAwb => (s?['bdWaybill'] ?? s?['forwardingAwb']) as String?;
  bool get _editable => '${s?['statusCode'] ?? 'MAN'}' == 'MAN' && _carrierAwb == null;

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

  Future<void> _handoff() async {
    if (_carrier == 'OTHER') {
      final fwd = await CodeScanner.scanOne(context, title: '$_vendor AWB');
      if (fwd == null || fwd.isEmpty || !mounted) return;
      return _run(() async {
        await ApiClient.instance.setForwarding(widget.awb, _vendor, fwd.toUpperCase());
        await _load();
        if (mounted) toast(context, 'Carrier AWB $fwd saved.');
      });
    }
    await _run(() async {
      final r = _carrier == 'BD'
          ? await ApiClient.instance.handoffBlueDart(widget.awb)
          : _carrier == 'XB'
              ? await ApiClient.instance.handoffXpressBees(widget.awb)
              : _carrier == 'GATI'
                  ? await ApiClient.instance.handoffGati(widget.awb)
                  : _carrier == 'VXP'
                      ? await ApiClient.instance.handoffVExpress(widget.awb)
                      : _carrier == 'ARL'
                          ? await ApiClient.instance.handoffArl(widget.awb)
                          : await ApiClient.instance.handoffDelhivery(widget.awb);
      await _load();
      final got = _carrierAwb;
      if (!mounted) return;
      if (got != null) {
        toast(context, '${{'BD': 'BlueDart', 'XB': 'XpressBees', 'GATI': 'Gati', 'VXP': 'V Express', 'ARL': 'AR Logistics'}[_carrier] ?? 'Delhivery'} AWB $got generated.');
      } else {
        toast(context, '${r['reason'] ?? r['message'] ?? 'Carrier did not return an AWB.'}', error: true);
      }
    });
  }

  Future<void> _edit() async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => _EditBooking(s: s!)));
    if (changed == true) {
      await _load();
      if (mounted) toast(context, 'Booking updated.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.awb)),
      body: s == null
          ? Center(child: _error != null ? EmptyState(Icons.search_off, _error!) : const CircularProgressIndicator())
          : _body(context),
    );
  }

  Widget _row(String k, Object? v) => v == null || '$v'.isEmpty
      ? const SizedBox.shrink()
      : Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 120, child: Text(k, style: TextStyle(color: Theme.of(context).colorScheme.outline))),
            Expanded(child: Text('$v', style: const TextStyle(fontWeight: FontWeight.w600))),
          ]),
        );

  Widget _body(BuildContext context) {
    final x = s!;
    final client = (x['client'] as Map?) ?? {};
    final pieces = (x['rollup'] as Map?)?['pieceCount'] ?? x['pieceCount'];
    final carrierName = {'BD': 'BlueDart', 'DLY': 'Delhivery', 'XB': 'XpressBees', 'GATI': 'Gati', 'VXP': 'V Express', 'ARL': 'AR Logistics', 'SELF': 'own network'}[_carrier] ?? _vendor;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (widget.justBooked)
          Card(
            color: const Color(0xFFDCFCE7),
            child: ListTile(
              leading: const Icon(Icons.check_circle, color: Color(0xFF16A34A)),
              title: Text('Booked — ${widget.awb}', style: const TextStyle(fontWeight: FontWeight.w800)),
              subtitle: const Text('Check the details. Use Edit if anything is wrong.'),
            ),
          ),
        Row(children: [
          Expanded(child: Text('${client['accountCode'] ?? ''} — ${client['legalName'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700))),
          StatusChip('${x['statusCode'] ?? 'MAN'}'),
        ]),
        const SectionLabel('Shipment'),
        _row('Product', x['product']),
        _row('Carrier', _vendor.isEmpty ? 'Own network' : _vendor),
        _row('Carrier AWB', _carrierAwb),
        _row('Boxes', pieces),
        _row('Weight (kg)', x['chargeWeight'] ?? (x['rollup'] as Map?)?['totalDeadKg']),
        _row('Content', x['goodsDesc']),
        _row('Reference', x['referenceNo']),
        _row('Invoice', [x['invoiceNo'], if (x['declaredValue'] != null) '₹${x['declaredValue']}'].where((v) => v != null).join(' · ')),
        _row('E-way bill', x['ewbNo']),
        const SectionLabel('Consignee'),
        _row('Name', x['consigneeName']),
        _row('Phone', x['consigneePhone']),
        _row('Address', [x['consigneeAddress'], x['consigneeCity'], x['destPincode']].where((v) => v != null && '$v'.isNotEmpty).join(', ')),
        const SizedBox(height: 16),
        if (_editable)
          OutlinedButton.icon(
            onPressed: _busy ? null : _edit,
            icon: const Icon(Icons.edit_outlined),
            label: const Text('Edit booking'),
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          ),
        if (_carrier != 'SELF' && _carrierAwb == null) ...[
          const SizedBox(height: 10),
          FilledButton.icon(
            onPressed: _busy ? null : _handoff,
            icon: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send),
            label: Text(_carrier == 'OTHER' ? 'Enter $_vendor AWB (scan)' : 'Hand to $carrierName — generate AWB'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          ),
        ],
        const SectionLabel('Print'),
        Wrap(spacing: 8, runSpacing: 8, children: [
          OutlinedButton.icon(
            onPressed: () => PrintView.open(context, 'AWB ${widget.awb}', '/shipments/${widget.awb}/awb-print'),
            icon: const Icon(Icons.description_outlined),
            label: const Text('AWB copy'),
          ),
          OutlinedButton.icon(
            onPressed: () => PrintView.open(context, 'Label ${widget.awb}', '/shipments/${widget.awb}/bd-label'),
            icon: const Icon(Icons.qr_code_2),
            label: const Text('Courier label'),
          ),
          if (x['bdWaybill'] != null)
            OutlinedButton.icon(
              onPressed: () => PrintView.open(context, 'BlueDart AWB', '/shipments/${widget.awb}/bd-awb'),
              icon: const Icon(Icons.local_shipping_outlined),
              label: const Text('BlueDart AWB'),
            ),
        ]),
      ],
    );
  }
}

/// Correct a booking — the fields the office's Edit AWB allows that a rider can get wrong at the door.
class _EditBooking extends StatefulWidget {
  final Map<String, dynamic> s;
  const _EditBooking({required this.s});
  @override
  State<_EditBooking> createState() => _EditBookingState();
}

class _EditBookingState extends State<_EditBooking> {
  late final Map<String, TextEditingController> c = {
    for (final k in ['consigneeName', 'consigneePhone', 'consigneeAddress', 'destPincode', 'referenceNo', 'goodsDesc', 'declaredValue', 'chargeWeight'])
      k: TextEditingController(text: widget.s[k] == null ? '' : '${widget.s[k]}'),
  };
  bool _busy = false;

  Future<void> _save() async {
    if (!RegExp(r'^\d{6}$').hasMatch(c['destPincode']!.text.trim())) return toast(context, 'Pincode must be 6 digits.', error: true);
    final patch = <String, dynamic>{};
    c.forEach((k, t) {
      final now = t.text.trim();
      final was = widget.s[k] == null ? '' : '${widget.s[k]}';
      if (now != was) patch[k] = now;
    });
    if (patch.containsKey('declaredValue')) patch['shipmentValue'] = patch['declaredValue'];
    if (patch.isEmpty) return Navigator.of(context).pop(false);
    setState(() => _busy = true);
    try {
      await ApiClient.instance.editShipment('${widget.s['awb']}', patch);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) toast(context, '$e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget f(String k, String label, {TextInputType? type, int lines = 1}) =>
        TextField(controller: c[k], keyboardType: type, maxLines: lines, decoration: InputDecoration(labelText: label));
    return Scaffold(
      appBar: AppBar(title: Text('Edit ${widget.s['awb']}')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        f('consigneeName', 'Consignee name'),
        f('consigneePhone', 'Consignee phone', type: TextInputType.phone),
        f('consigneeAddress', 'Address', lines: 2),
        f('destPincode', 'Destination pincode', type: TextInputType.number),
        f('chargeWeight', 'Weight (kg)', type: const TextInputType.numberWithOptions(decimal: true)),
        f('declaredValue', 'Invoice value (₹)', type: const TextInputType.numberWithOptions(decimal: true)),
        f('goodsDesc', 'Content'),
        f('referenceNo', 'Reference no.'),
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _busy ? null : _save,
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
          child: Text(_busy ? 'Saving…' : 'Save changes'),
        ),
      ]),
    );
  }
}
