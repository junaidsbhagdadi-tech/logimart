import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api_client.dart';
import '../ui.dart';
import 'booking_summary.dart';
import 'print_view.dart';

/// Book tab: "New booking" (the quick-book form) and "My bookings" (today's, with manifest print).
class BookScreen extends StatefulWidget {
  const BookScreen({super.key});
  @override
  State<BookScreen> createState() => _BookScreenState();
}

class _BookScreenState extends State<BookScreen> {
  int _view = 0;
  final _mine = GlobalKey<_MyBookingsState>();

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
        child: SegmentedButton<int>(
          segments: const [
            ButtonSegment(value: 0, label: Text('New booking'), icon: Icon(Icons.add)),
            ButtonSegment(value: 1, label: Text('My bookings'), icon: Icon(Icons.list_alt)),
          ],
          selected: {_view},
          onSelectionChanged: (s) {
            setState(() => _view = s.first);
            if (_view == 1) _mine.currentState?.load();
          },
        ),
      ),
      Expanded(child: IndexedStack(index: _view, children: [const _NewBooking(), MyBookings(key: _mine)])),
    ]);
  }
}

class _Product {
  final String code, name;
  final bool surface;
  _Product(this.code, this.name, this.surface);
}

/// One line of box sizes: how many boxes of this size, and L × W × H in cm (sizes optional).
class _BoxLine {
  final nos = TextEditingController(text: '1');
  final l = TextEditingController();
  final w = TextEditingController();
  final h = TextEditingController();
  int get count => (int.tryParse(nos.text.trim()) ?? 1).clamp(1, 999);
  double? _n(TextEditingController t) {
    final v = double.tryParse(t.text.trim());
    return v != null && v > 0 ? v : null;
  }

  Map<String, dynamic> dims() => {
        if (_n(l) != null) 'lengthCm': _n(l),
        if (_n(w) != null) 'widthCm': _n(w),
        if (_n(h) != null) 'heightCm': _n(h),
      };
}

/// Quick booking on the phone — same booking API as the web "Quick Book": customer code, product,
/// consignee + pincode, boxes (+ sizes) + weight, optional AWB / forwarding / invoice / e-way (scannable).
class _NewBooking extends StatefulWidget {
  const _NewBooking();
  @override
  State<_NewBooking> createState() => _NewBookingState();
}

class _NewBookingState extends State<_NewBooking> {
  List<Map<String, dynamic>> _customers = [];
  List<_Product> _products = [];
  List<Map<String, String>> _vendors = [];
  bool _loading = true;
  String? _loadError;

  Map<String, dynamic>? _cust;
  String? _product;
  String? _vendor;
  String _docType = 'NDOX';
  bool _pickupElsewhere = false;

  final _conName = TextEditingController();
  final _conPhone = TextEditingController();
  final _conAddr = TextEditingController();
  final _conPin = TextEditingController();
  final _conGst = TextEditingController();
  String _destCity = '';
  List<_BoxLine> _lines = [_BoxLine()];
  final _kg = TextEditingController();
  final _awb = TextEditingController();
  final _fwd = TextEditingController();
  final _ref = TextEditingController();
  final _content = TextEditingController();
  final _invNo = TextEditingController();
  final _invAmt = TextEditingController();
  final _ewb = TextEditingController();
  final _pickAddr = TextEditingController();
  final _pickPin = TextEditingController();
  final _pickPhone = TextEditingController();

  bool _busy = false;

  static const _lastContentKey = 'quickbook_content';

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      final api = ApiClient.instance;
      final r = await Future.wait([api.bookingCustomers(), api.master('PRODUCT'), api.vendors().catchError((_) => <Map<String, dynamic>>[])]);
      _customers = r[0];
      _products = r[1].where((x) => x['active'] != false).map((x) {
        final a = (x['attrs'] as Map?) ?? {};
        final mode = '${a['service'] ?? a['mode'] ?? a['serviceMode'] ?? a['groupType'] ?? ''}';
        final code = '${x['code']}';
        final surface = RegExp(r'SURF|ROAD|RAIL', caseSensitive: false).hasMatch(mode) ||
            RegExp(r'SFC|SURFACE|ROAD|RAIL|HUB', caseSensitive: false).hasMatch(code);
        return _Product(code, '${x['name']}', surface);
      }).toList();
      _vendors = r[2]
          .where((x) => x['isActive'] != false)
          .map((x) => {'code': '${x['vendorCode']}', 'name': '${x['name']}'})
          .toList();
      final prefs = await SharedPreferences.getInstance();
      _content.text = prefs.getString(_lastContentKey) ?? '';
    } catch (e) {
      _loadError = '$e';
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _pickCustomer() async {
    final c = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _CustomerPicker(customers: _customers),
    );
    if (c != null) {
      setState(() {
        _cust = c;
        final dv = '${c['defaultVendor'] ?? ''}'.toUpperCase();
        if (dv.isNotEmpty && _vendors.any((v) => v['code']!.toUpperCase() == dv)) {
          _vendor = _vendors.firstWhere((v) => v['code']!.toUpperCase() == dv)['code'];
        }
      });
    }
  }

  Future<void> _lookupPin(String v) async {
    setState(() => _destCity = '');
    if (!RegExp(r'^\d{6}$').hasMatch(v)) return;
    try {
      final i = await ApiClient.instance.pincode(v);
      if (mounted) {
        setState(() => _destCity =
            i['known'] == false ? 'Not in the pincode master' : [i['city'], i['state']].where((x) => x != null).join(', '));
      }
    } catch (_) {}
  }

  List<String> get _missing => [
        if (_cust == null) 'customer',
        if (_product == null) 'product',
        if (!RegExp(r'^\d{6}$').hasMatch(_conPin.text.trim())) 'consignee pincode',
        if (_conName.text.trim().isEmpty) 'consignee name',
        if ((double.tryParse(_kg.text.trim()) ?? 0) <= 0) 'weight',
        if (_pickupElsewhere && _pickAddr.text.trim().isEmpty) 'pickup address',
        if (_pickupElsewhere && !RegExp(r'^\d{6}$').hasMatch(_pickPin.text.trim())) 'pickup pincode',
      ];

  Future<void> _book() async {
    final miss = _missing;
    if (miss.isNotEmpty) return toast(context, 'Missing: ${miss.join(', ')}', error: true);
    final c = _cust!;
    final boxes = _lines.fold<int>(0, (a, b) => a + b.count);
    final kg = double.parse(_kg.text.trim());
    final perBox = double.parse((kg / boxes).toStringAsFixed(3));
    final sel = _products.firstWhere((p) => p.code == _product);
    final originPin = _pickupElsewhere ? _pickPin.text.trim() : '${c['pincode'] ?? ''}';
    final inv = double.tryParse(_invAmt.text.trim());
    String? opt(TextEditingController t) => t.text.trim().isEmpty ? null : t.text.trim();
    setState(() => _busy = true);
    try {
      final body = <String, dynamic>{
        'clientId': int.parse('${c['id']}'),
        'product': _product,
        'docType': _docType,
        'serviceMode': sel.surface ? 'ROAD_PTL' : 'AIR_EXPRESS',
        'originZone': 'SOUTH', 'destZone': 'SOUTH', // re-derived server-side from the pincodes
        if (originPin.isNotEmpty) 'originPincode': originPin,
        'destPincode': _conPin.text.trim(),
        'shipperName': c['legalName'],
        if (c['contactName'] != null) 'shipperContact': c['contactName'],
        'shipperAddress1': _pickupElsewhere ? _pickAddr.text.trim() : c['addressLine'],
        if (originPin.isNotEmpty) 'shipperPincode': originPin,
        if (!_pickupElsewhere && c['city'] != null) 'shipperCity': c['city'],
        'shipperMobile': _pickupElsewhere ? opt(_pickPhone) : c['contactPhone'],
        'consigneeName': _conName.text.trim(),
        'consigneePhone': opt(_conPhone),
        'consigneeAddress': opt(_conAddr),
        'consigneeGstin': opt(_conGst),
        'vendor': _vendor,
        'forwardingAwb': opt(_fwd)?.toUpperCase(),
        'manualAwb': opt(_awb)?.toUpperCase(),
        'referenceNo': opt(_ref),
        'goodsDesc': opt(_content),
        if (inv != null) 'shipmentValue': inv,
        if (inv != null) 'declaredValue': inv,
        'invoiceNo': opt(_invNo),
        'ewbNo': opt(_ewb),
        'paymentTerm': 'PREPAID',
        // One piece per box, each carrying its line's size (volumetric weight is worked out server-side).
        'pieces': [
          for (final line in _lines)
            for (var i = 0; i < line.count; i++) {'deadKg': perBox, ...line.dims()},
        ],
      }..removeWhere((k, v) => v == null);
      final res = await ApiClient.instance.createShipment(body);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_lastContentKey, _content.text.trim());
      if (!mounted) return;
      // Show what was booked (edit / hand to carrier / print from there), then start the next one.
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => BookingSummary(awb: '${res['awb']}', justBooked: true)));
      _next();
    } catch (e) {
      if (mounted) toast(context, '$e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Book the next one for the same customer / product / carrier — clear the per-shipment fields.
  void _next() {
    for (final t in [_conName, _conPhone, _conAddr, _conPin, _conGst, _kg, _awb, _fwd, _ref, _invNo, _invAmt, _ewb]) {
      t.clear();
    }
    setState(() {
      _lines = [_BoxLine()];
      _destCity = '';
    });
  }

  Widget _boxLine(_BoxLine b, int i) {
    Widget n(TextEditingController c, String label) => Expanded(
          child: TextField(controller: c, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: label)),
        );
    return Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
      SizedBox(
        width: 64,
        child: TextField(controller: b.nos, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Boxes'), onChanged: (_) => setState(() {})),
      ),
      const SizedBox(width: 8),
      n(b.l, 'L cm'),
      const SizedBox(width: 6),
      n(b.w, 'W cm'),
      const SizedBox(width: 6),
      n(b.h, 'H cm'),
      if (_lines.length > 1)
        IconButton(tooltip: 'Remove', icon: const Icon(Icons.close, size: 18), onPressed: () => setState(() => _lines.removeAt(i)))
      else
        const SizedBox(width: 8),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_loadError != null) return EmptyState(Icons.cloud_off, _loadError!);

    final needEway = (double.tryParse(_invAmt.text.trim()) ?? 0) >= 50000;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        const SectionLabel('Customer'),
        Card(
          margin: EdgeInsets.zero,
          child: ListTile(
            leading: const Icon(Icons.business_outlined),
            title: Text(_cust == null ? 'Choose customer' : '${_cust!['accountCode']} — ${_cust!['legalName']}'),
            subtitle: _cust == null ? null : Text([_cust!['city'], _cust!['pincode']].where((x) => x != null).join(' · ')),
            trailing: const Icon(Icons.arrow_drop_down),
            onTap: _pickCustomer,
          ),
        ),
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          key: ValueKey('p$_product'),
          initialValue: _product,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Product'),
          items: _products.map((p) => DropdownMenuItem(value: p.code, child: Text('${p.code} — ${p.name}', overflow: TextOverflow.ellipsis))).toList(),
          onChanged: (v) => setState(() => _product = v),
        ),
        DropdownButtonFormField<String?>(
          key: ValueKey('v$_vendor'), // re-seeded when the customer's default carrier fills it in
          initialValue: _vendor,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Carrier (optional)'),
          // The field shows the carrier CODE (what ops know them by); the list shows code + name.
          selectedItemBuilder: (_) => [
            const Text('— Own network / decide later —'),
            ..._vendors.map((v) => Text('${v['code']}', style: const TextStyle(fontWeight: FontWeight.w700))),
          ],
          items: [
            const DropdownMenuItem<String?>(value: null, child: Text('— Own network / decide later —')),
            ..._vendors.map((v) => DropdownMenuItem<String?>(
                  value: v['code'],
                  child: Text.rich(TextSpan(children: [
                    TextSpan(text: '${v['code']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    TextSpan(text: '  ${v['name']}', style: TextStyle(color: Theme.of(context).colorScheme.outline)),
                  ]), overflow: TextOverflow.ellipsis),
                )),
          ],
          onChanged: (v) => setState(() => _vendor = v),
        ),
        const SizedBox(height: 10),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'NDOX', label: Text('Parcel'), icon: Icon(Icons.inventory_2_outlined)),
            ButtonSegment(value: 'DOX', label: Text('Document'), icon: Icon(Icons.description_outlined)),
          ],
          selected: {_docType},
          onSelectionChanged: (s) => setState(() => _docType = s.first),
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Pickup from another address'),
          subtitle: const Text('Off = the customer\'s own address'),
          value: _pickupElsewhere,
          onChanged: (v) => setState(() => _pickupElsewhere = v),
        ),
        if (_pickupElsewhere) ...[
          TextField(controller: _pickAddr, maxLines: 2, decoration: const InputDecoration(labelText: 'Pickup address')),
          Row(children: [
            Expanded(child: TextField(controller: _pickPin, keyboardType: TextInputType.number, maxLength: 6, decoration: const InputDecoration(labelText: 'Pickup pincode', counterText: ''))),
            const SizedBox(width: 12),
            Expanded(child: TextField(controller: _pickPhone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Pickup phone'))),
          ]),
        ],
        const SectionLabel('Consignee'),
        TextField(controller: _conName, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Name'), onChanged: (_) => setState(() {})),
        Row(children: [
          Expanded(
            child: TextField(
              controller: _conPin,
              keyboardType: TextInputType.number,
              maxLength: 6,
              onChanged: _lookupPin,
              decoration: InputDecoration(labelText: 'Pincode', helperText: _destCity.isEmpty ? null : _destCity, counterText: ''),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(child: TextField(controller: _conPhone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone'))),
        ]),
        TextField(controller: _conAddr, maxLines: 2, decoration: const InputDecoration(labelText: 'Address')),
        TextField(controller: _conGst, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'GSTIN (optional)')),
        SectionLabel('Boxes (${_lines.fold<int>(0, (a, b) => a + b.count)}) — sizes optional'),
        for (var i = 0; i < _lines.length; i++) _boxLine(_lines[i], i),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: () => setState(() => _lines.add(_BoxLine())),
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Another box size'),
          ),
        ),
        TextField(
            controller: _kg,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(labelText: 'Total weight (kg)')),
        TextField(controller: _content, decoration: const InputDecoration(labelText: 'Content / description')),
        const SectionLabel('Numbers (scan or type)'),
        ScanField(controller: _awb, label: 'AWB no.', hint: 'Blank = auto-generate'),
        ScanField(controller: _fwd, label: 'Forwarding / carrier AWB (optional)'),
        ScanField(controller: _ref, label: 'Reference no. (optional)'),
        Row(children: [
          Expanded(child: ScanField(controller: _invNo, label: 'Invoice no.')),
          const SizedBox(width: 12),
          Expanded(
              child: TextField(
                  controller: _invAmt,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(labelText: 'Invoice ₹'))),
        ]),
        ScanField(controller: _ewb, label: needEway ? 'E-way bill no. (needed: ₹50,000+)' : 'E-way bill no. (optional)'),
        const SizedBox(height: 22),
        FilledButton.icon(
          onPressed: _busy ? null : _book,
          icon: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.check),
          label: Text(_busy ? 'Booking…' : 'Book shipment'),
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
        ),
      ],
    );
  }

}

/// Today's (or a picked day's) bookings by me — open one, or tick several of a carrier and print the
/// handover manifest the carrier signs.
class MyBookings extends StatefulWidget {
  const MyBookings({super.key});
  @override
  State<MyBookings> createState() => _MyBookingsState();
}

class _MyBookingsState extends State<MyBookings> {
  DateTime _day = DateTime.now();
  List<Map<String, dynamic>> _rows = [];
  final Set<String> _sel = {};
  String? _vendor; // filter
  bool _loading = true;
  String? _error;

  String get _ymd => '${_day.year}-${'${_day.month}'.padLeft(2, '0')}-${'${_day.day}'.padLeft(2, '0')}';

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = await ApiClient.instance.myBookings(date: _ymd);
      _rows = (r['rows'] as List).cast<Map<String, dynamic>>();
      _sel.removeWhere((a) => !_rows.any((x) => x['awb'] == a));
    } catch (e) {
      _error = '$e';
    }
    if (mounted) setState(() => _loading = false);
  }

  String _v(Map<String, dynamic> r) => '${r['vendor'] ?? ''}'.isEmpty ? 'SELF' : '${r['vendor']}'.toUpperCase();

  Future<void> _printManifest() async {
    final picked = _rows.where((r) => _sel.contains(r['awb'])).toList();
    final vendors = picked.map(_v).toSet();
    if (vendors.length > 1) {
      return toast(context, 'Pick shipments of ONE carrier — a manifest is per carrier (${vendors.join(', ')}).', error: true);
    }
    await PrintView.open(context, 'Handover manifest',
        '/handover/print?date=$_ymd&vendor=${Uri.encodeComponent(vendors.first)}&awbs=${Uri.encodeComponent(picked.map((r) => r['awb']).join(','))}');
  }

  @override
  Widget build(BuildContext context) {
    final vendors = _rows.map(_v).toSet().toList()..sort();
    final shown = _rows.where((r) => _vendor == null || _v(r) == _vendor).toList();
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
        child: Row(children: [
          TextButton.icon(
            icon: const Icon(Icons.calendar_today, size: 18),
            label: Text('${'${_day.day}'.padLeft(2, '0')}-${'${_day.month}'.padLeft(2, '0')}-${_day.year}'),
            onPressed: () async {
              final d = await showDatePicker(context: context, initialDate: _day, firstDate: DateTime(2025), lastDate: DateTime.now());
              if (d != null) {
                setState(() => _day = d);
                load();
              }
            },
          ),
          const Spacer(),
          IconButton(tooltip: 'Refresh', onPressed: load, icon: const Icon(Icons.refresh)),
        ]),
      ),
      if (vendors.length > 1)
        SizedBox(
          height: 44,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12), children: [
            Padding(padding: const EdgeInsets.only(right: 6), child: ChoiceChip(label: const Text('All'), selected: _vendor == null, onSelected: (_) => setState(() => _vendor = null))),
            ...vendors.map((v) => Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ChoiceChip(label: Text(v), selected: _vendor == v, onSelected: (_) => setState(() => _vendor = v)),
                )),
          ]),
        ),
      Expanded(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? EmptyState(Icons.cloud_off, _error!)
                : shown.isEmpty
                    ? const EmptyState(Icons.inbox_outlined, 'No bookings by you on this day.')
                    : RefreshIndicator(
                        onRefresh: load,
                        child: ListView.builder(
                          itemCount: shown.length,
                          itemBuilder: (_, i) {
                            final r = shown[i];
                            final awb = '${r['awb']}';
                            final carrierAwb = r['bdWaybill'] ?? r['forwardingAwb'];
                            return CheckboxListTile(
                              value: _sel.contains(awb),
                              onChanged: (v) => setState(() => v == true ? _sel.add(awb) : _sel.remove(awb)),
                              controlAffinity: ListTileControlAffinity.leading,
                              title: Text('$awb · ${_v(r)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                              subtitle: Text('${r['customerCode']} → ${r['consigneeName'] ?? ''}, ${r['consigneeCity'] ?? r['destPincode'] ?? ''}'
                                  '\n${r['pieceCount']} box(es)${carrierAwb != null ? ' · carrier AWB $carrierAwb' : ' · not handed to carrier'}'),
                              isThreeLine: true,
                              secondary: IconButton(
                                icon: const Icon(Icons.chevron_right),
                                onPressed: () async {
                                  await Navigator.of(context).push(MaterialPageRoute(builder: (_) => BookingSummary(awb: awb)));
                                  load();
                                },
                              ),
                            );
                          },
                        ),
                      ),
      ),
      if (_sel.isNotEmpty)
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
            child: FilledButton.icon(
              onPressed: _printManifest,
              icon: const Icon(Icons.print),
              label: Text('Print manifest (${_sel.length})'),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
            ),
          ),
        ),
    ]);
  }
}

class _CustomerPicker extends StatefulWidget {
  final List<Map<String, dynamic>> customers;
  const _CustomerPicker({required this.customers});
  @override
  State<_CustomerPicker> createState() => _CustomerPickerState();
}

class _CustomerPickerState extends State<_CustomerPicker> {
  String _q = '';
  @override
  Widget build(BuildContext context) {
    final q = _q.toLowerCase();
    final list = widget.customers
        .where((c) => q.isEmpty || '${c['accountCode']} ${c['legalName']}'.toLowerCase().contains(q))
        .take(100)
        .toList();
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.85,
        child: Column(children: [
          Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 8 + MediaQuery.of(context).viewInsets.bottom * 0),
            child: TextField(
              autofocus: true,
              decoration: const InputDecoration(hintText: 'Customer code or name', prefixIcon: Icon(Icons.search), border: OutlineInputBorder()),
              onChanged: (v) => setState(() => _q = v.trim()),
            ),
          ),
          Expanded(
            child: ListView.builder(
              itemCount: list.length,
              itemBuilder: (_, i) {
                final c = list[i];
                return ListTile(
                  title: Text('${c['accountCode']} — ${c['legalName']}'),
                  subtitle: Text([c['city'], c['pincode']].where((x) => x != null).join(' · ')),
                  onTap: () => Navigator.pop(context, c),
                );
              },
            ),
          ),
        ]),
      ),
    );
  }
}
