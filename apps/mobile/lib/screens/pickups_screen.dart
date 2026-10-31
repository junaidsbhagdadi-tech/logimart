import 'package:flutter/material.dart';
import '../api_client.dart';
import '../ui.dart';

/// Rider's assigned pickups. Tap one → details (call / map) → "Mark picked", which books the
/// shipment for the customer (needs the destination unless CS already generated the AWB).
class PickupsScreen extends StatefulWidget {
  const PickupsScreen({super.key});
  @override
  State<PickupsScreen> createState() => _PickupsScreenState();
}

class _PickupsScreenState extends State<PickupsScreen> {
  List<Map<String, dynamic>> _pickups = [];
  Map<String, dynamic> _today = {};
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final t = await ApiClient.instance.myTasks();
      _pickups = (t['pickups'] as List).cast<Map<String, dynamic>>();
      _today = (t['today'] as Map?)?.cast<String, dynamic>() ?? {};
    } catch (e) {
      _error = '$e';
    }
    if (mounted) setState(() => _loading = false);
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          _TodayBar(picked: _today['picked'] ?? 0, delivered: _today['delivered'] ?? 0, open: _pickups.length),
          if (_loading) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
          if (!_loading && _error != null) EmptyState(Icons.cloud_off, _error!),
          if (!_loading && _error == null && _pickups.isEmpty)
            const EmptyState(Icons.inventory_2_outlined, 'No pickups assigned to you right now.\nPull down to refresh.'),
          ..._pickups.map((p) => Card(
                child: ListTile(
                  contentPadding: const EdgeInsets.fromLTRB(14, 8, 8, 8),
                  title: Text('${p['customerName'] ?? p['contactName'] ?? 'Pickup #${p['id']}'}',
                      style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text(
                    '${[p['pickupAddress'], p['city'], p['pincode']].where((x) => x != null && '$x'.isNotEmpty).join(', ')}'
                    '\n${p['estPieces'] ?? 1} box(es)${p['weight'] != null ? ' · ~${p['weight']} kg' : ''}${p['pickedAwb'] != null ? ' · AWB ${p['pickedAwb']}' : ''}',
                  ),
                  isThreeLine: true,
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () async {
                    final done = await Navigator.of(context).push<bool>(
                      MaterialPageRoute(builder: (_) => PickupDetail(pickup: p)),
                    );
                    if (done == true) _load();
                  },
                ),
              )),
        ],
      ),
    );
  }
}

class _TodayBar extends StatelessWidget {
  final dynamic picked, delivered;
  final int open;
  const _TodayBar({required this.picked, required this.delivered, required this.open});
  @override
  Widget build(BuildContext context) {
    Widget cell(String label, String v) => Expanded(
          child: Column(children: [
            Text(v, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
            Text(label, style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.outline)),
          ]),
        );
    return Card(
      color: Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.5),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(children: [cell('To pick', '$open'), cell('Picked today', '$picked'), cell('Delivered today', '$delivered')]),
      ),
    );
  }
}

class PickupDetail extends StatefulWidget {
  final Map<String, dynamic> pickup;
  const PickupDetail({super.key, required this.pickup});
  @override
  State<PickupDetail> createState() => _PickupDetailState();
}

class _PickupDetailState extends State<PickupDetail> {
  late final Map<String, dynamic> p = widget.pickup;
  late final _awb = TextEditingController(text: '${p['pickedAwb'] ?? ''}');
  late final _pieces = TextEditingController(text: '${p['estPieces'] ?? 1}');
  late final _weight = TextEditingController(text: p['weight'] != null ? '${p['weight']}' : '');
  late final _value = TextEditingController(text: p['invoiceValue'] != null ? '${p['invoiceValue']}' : '');
  final _destPin = TextEditingController();
  final _conName = TextEditingController();
  final _conPhone = TextEditingController();
  final _conAddr = TextEditingController();
  String _destCity = '';
  bool _busy = false;

  /// CS already booked it at the carrier hand-off → only the count / weight need confirming.
  bool get _preBooked => '${p['pickedAwb'] ?? ''}'.isNotEmpty;

  Future<void> _lookupPin(String v) async {
    setState(() => _destCity = '');
    if (!RegExp(r'^\d{6}$').hasMatch(v)) return;
    try {
      final i = await ApiClient.instance.pincode(v);
      if (mounted) {
        setState(() => _destCity = i['known'] == false
            ? 'Not in the pincode master'
            : [i['city'], i['state']].where((x) => x != null).join(', '));
      }
    } catch (_) {}
  }

  Future<void> _submit() async {
    final pieces = int.tryParse(_pieces.text.trim());
    final weight = double.tryParse(_weight.text.trim());
    if (pieces == null || pieces < 1) return toast(context, 'Enter the number of boxes.', error: true);
    if (weight == null || weight <= 0) return toast(context, 'Enter the total weight (kg).', error: true);
    if (!_preBooked && _awb.text.trim().isEmpty) {
      if (!RegExp(r'^\d{6}$').hasMatch(_destPin.text.trim())) {
        return toast(context, 'Enter the destination pincode — the shipment is booked with it.', error: true);
      }
      if (_conName.text.trim().isEmpty) return toast(context, 'Enter the consignee name.', error: true);
    }
    setState(() => _busy = true);
    try {
      final r = await ApiClient.instance.completePickup('${p['id']}', {
        if (_awb.text.trim().isNotEmpty) 'awb': _awb.text.trim().toUpperCase(),
        'pieces': pieces,
        'weight': weight,
        if (double.tryParse(_value.text.trim()) != null) 'value': double.parse(_value.text.trim()),
        if (_destPin.text.trim().isNotEmpty) 'destPincode': _destPin.text.trim(),
        if (_conName.text.trim().isNotEmpty) 'consigneeName': _conName.text.trim(),
        if (_conPhone.text.trim().isNotEmpty) 'consigneePhone': _conPhone.text.trim(),
        if (_conAddr.text.trim().isNotEmpty) 'consigneeAddress': _conAddr.text.trim(),
      });
      final s = r['shipment'] as Map?;
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          icon: const Icon(Icons.check_circle, color: Color(0xFF16A34A), size: 40),
          title: const Text('Picked'),
          content: Text(s != null
              ? '${s['booked'] == true ? 'Booked' : 'Updated'} AWB ${s['awb']} — status Picked.'
              : 'Pickup marked as picked.'),
          actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
        ),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) toast(context, '$e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Couldn't collect — pick a reason; the pickup is rebooked (CS hands it off again) unless closed.
  Future<void> _notPicked() async {
    const reasons = ['Shipment not ready', 'Customer not available', 'Address not found', 'Customer cancelled', 'Paperwork / e-way bill missing'];
    String? reason = reasons.first;
    bool rebook = true;
    final other = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: const Text('Not picked'),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            for (final r in [...reasons, 'Other'])
              RadioListTile<String>(dense: true, contentPadding: EdgeInsets.zero, title: Text(r), value: r, groupValue: reason, onChanged: (v) => set(() => reason = v)),
            if (reason == 'Other') TextField(controller: other, decoration: const InputDecoration(labelText: 'Reason')),
            SwitchListTile(dense: true, contentPadding: EdgeInsets.zero, title: const Text('Rebook the pickup'), value: rebook, onChanged: (v) => set(() => rebook = v)),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Back')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    final why = reason == 'Other' ? other.text.trim() : (reason ?? '');
    if (why.isEmpty) return toast(context, 'Give the reason.', error: true);
    setState(() => _busy = true);
    try {
      await ApiClient.instance.pickupNotPicked('${p['id']}', why, rebook);
      if (!mounted) return;
      toast(context, rebook ? 'Marked not picked — rebooked.' : 'Marked not picked — closed.');
      Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) toast(context, '$e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final addr = [p['pickupAddress'], p['city'], p['pincode']].where((x) => x != null && '$x'.isNotEmpty).join(', ');
    final phone = '${p['contactPhone'] ?? ''}';
    return Scaffold(
      appBar: AppBar(title: Text('Pickup #${p['id']}')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('${p['customerName'] ?? ''}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          if (p['accountCode'] != null) Text('${p['accountCode']}', style: TextStyle(color: Theme.of(context).colorScheme.outline)),
          const SizedBox(height: 8),
          Text(addr),
          if ('${p['contactName'] ?? ''}'.isNotEmpty) Text('Contact: ${p['contactName']}'),
          if ('${p['notes'] ?? ''}'.isNotEmpty)
            Padding(padding: const EdgeInsets.only(top: 6), child: Text('Note: ${p['notes']}', style: const TextStyle(fontStyle: FontStyle.italic))),
          const SizedBox(height: 10),
          Wrap(spacing: 8, children: [
            if (phone.isNotEmpty) OutlinedButton.icon(onPressed: () => callPhone(phone), icon: const Icon(Icons.call), label: Text(phone)),
            if (addr.isNotEmpty) OutlinedButton.icon(onPressed: () => openMap(addr), icon: const Icon(Icons.map_outlined), label: const Text('Map')),
          ]),
          const SectionLabel('Collected'),
          if (_preBooked)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text('AWB ${p['pickedAwb']} was generated at hand-off — confirm boxes and weight.',
                  style: TextStyle(color: Theme.of(context).colorScheme.primary)),
            )
          else
            ScanField(controller: _awb, label: 'AWB (if the customer has one)', hint: 'Leave blank to auto-generate'),
          Row(children: [
            Expanded(child: TextField(controller: _pieces, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Boxes'))),
            const SizedBox(width: 12),
            Expanded(
                child: TextField(
                    controller: _weight,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(labelText: 'Total weight (kg)'))),
          ]),
          TextField(
              controller: _value,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Invoice value (₹, optional)')),
          if (!_preBooked) ...[
            const SectionLabel('Deliver to'),
            TextField(
              controller: _destPin,
              keyboardType: TextInputType.number,
              maxLength: 6,
              onChanged: _lookupPin,
              decoration: InputDecoration(labelText: 'Destination pincode', helperText: _destCity.isEmpty ? null : _destCity, counterText: ''),
            ),
            TextField(controller: _conName, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Consignee name')),
            TextField(controller: _conPhone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Consignee phone')),
            TextField(controller: _conAddr, maxLines: 2, decoration: const InputDecoration(labelText: 'Consignee address')),
          ],
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _busy ? null : _submit,
            icon: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.check),
            label: Text(_busy ? 'Saving…' : 'Mark picked'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: _busy ? null : _notPicked,
            icon: const Icon(Icons.close),
            label: const Text('Not picked'),
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), foregroundColor: Theme.of(context).colorScheme.error),
          ),
        ],
      ),
    );
  }
}
