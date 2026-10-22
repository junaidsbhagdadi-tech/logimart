import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:url_launcher/url_launcher.dart';

// Shared bits for the rider app: status chip, barcode capture, camera → data URL, call, snackbars.

const kBrand = Color(0xFF2B2E83);

/// Same labels + tones as the web app's StatusBadge.
const Map<String, (String, Color)> _status = {
  'MAN': ('Booked', Color(0xFF64748B)),
  'PKD': ('Picked', Color(0xFF2563EB)),
  'ORD': ('At origin hub', Color(0xFF2563EB)),
  'DPD': ('In transit', Color(0xFF2563EB)),
  'DRD': ('At destination hub', Color(0xFF2563EB)),
  'OFD': ('Out for delivery', Color(0xFFD97706)),
  'DLD': ('Delivered', Color(0xFF16A34A)),
  'UDL': ('Undelivered', Color(0xFFDC2626)),
  'RTO': ('Return to origin', Color(0xFF7C3AED)),
  'RTD': ('Returned', Color(0xFF7C3AED)),
  'CAN': ('Cancelled', Color(0xFF6B7280)),
};

class StatusChip extends StatelessWidget {
  final String? code;
  const StatusChip(this.code, {super.key});
  @override
  Widget build(BuildContext context) {
    final k = (code == null || code!.isEmpty ? 'MAN' : code!).toUpperCase();
    final s = _status[k] ?? (k, const Color(0xFF64748B));
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: s.$2.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
      child: Text(s.$1, style: TextStyle(color: s.$2, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}

/// A label's barcode may be a piece id (AWB-001); milestones are recorded on the AWB.
String awbFromBarcode(String raw) => raw.trim().toUpperCase().replaceFirst(RegExp(r'-\d{1,3}$'), '');

/// Full-screen camera scanner. Single mode returns the first code; multi mode collects codes until Done.
class CodeScanner extends StatefulWidget {
  final String title;
  final bool multi;
  const CodeScanner({super.key, this.title = 'Scan barcode', this.multi = false});

  static Future<String?> scanOne(BuildContext context, {String title = 'Scan barcode'}) =>
      Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => CodeScanner(title: title)));

  static Future<List<String>?> scanMany(BuildContext context, {String title = 'Scan AWBs'}) =>
      Navigator.of(context).push<List<String>>(MaterialPageRoute(builder: (_) => CodeScanner(title: title, multi: true)));

  @override
  State<CodeScanner> createState() => _CodeScannerState();
}

class _CodeScannerState extends State<CodeScanner> {
  final _controller = MobileScannerController(detectionSpeed: DetectionSpeed.noDuplicates);
  final List<String> _codes = [];
  bool _done = false;

  void _handle(String v) {
    if (_done) return;
    if (!widget.multi) {
      _done = true;
      Navigator.of(context).pop(v);
      return;
    }
    final awb = awbFromBarcode(v);
    if (_codes.contains(awb)) return;
    setState(() => _codes.insert(0, awb));
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text('Added $awb'), duration: const Duration(milliseconds: 700)));
  }

  Future<void> _typeIn() async {
    final v = await promptText(context, 'Enter code', caps: true);
    if (v != null && v.isNotEmpty) _handle(v);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          IconButton(tooltip: 'Torch', icon: const Icon(Icons.flash_on), onPressed: () => _controller.toggleTorch()),
          IconButton(tooltip: 'Type it in', icon: const Icon(Icons.keyboard), onPressed: _typeIn),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: MobileScanner(
              controller: _controller,
              onDetect: (capture) {
                for (final b in capture.barcodes) {
                  final v = b.rawValue;
                  if (v != null && v.trim().isNotEmpty) _handle(v.trim());
                }
              },
            ),
          ),
          if (widget.multi)
            Container(
              color: Theme.of(context).colorScheme.surface,
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(
                    height: 64,
                    child: _codes.isEmpty
                        ? const Center(child: Text('Point the camera at each AWB label'))
                        : ListView(
                            scrollDirection: Axis.horizontal,
                            children: _codes
                                .map((c) => Padding(
                                      padding: const EdgeInsets.only(right: 6),
                                      child: InputChip(label: Text(c), onDeleted: () => setState(() => _codes.remove(c))),
                                    ))
                                .toList(),
                          ),
                  ),
                  FilledButton(
                    onPressed: _codes.isEmpty ? null : () => Navigator.of(context).pop(List<String>.from(_codes)),
                    child: Text('Done — ${_codes.length} AWB${_codes.length == 1 ? '' : 's'}'),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Text field with a scan button on the right.
class ScanField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final String? hint;
  final ValueChanged<String>? onChanged;
  const ScanField({super.key, required this.controller, required this.label, this.hint, this.onChanged});
  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      textCapitalization: TextCapitalization.characters,
      onChanged: onChanged,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        suffixIcon: IconButton(
          tooltip: 'Scan',
          icon: const Icon(Icons.qr_code_scanner),
          onPressed: () async {
            final v = await CodeScanner.scanOne(context, title: label);
            if (v != null) {
              controller.text = v.toUpperCase();
              onChanged?.call(controller.text);
            }
          },
        ),
      ),
    );
  }
}

/// Take a photo with the camera, downscaled + JPEG-compressed, as a data URL the API stores.
Future<String?> takePhotoDataUrl() async {
  final x = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1600, maxHeight: 1600, imageQuality: 60);
  if (x == null) return null;
  final bytes = await x.readAsBytes();
  return 'data:image/jpeg;base64,${base64Encode(bytes)}';
}

Future<void> callPhone(String phone) async {
  final uri = Uri(scheme: 'tel', path: phone.replaceAll(RegExp(r'[^0-9+]'), ''));
  await launchUrl(uri);
}

Future<void> openMap(String address) async {
  final uri = Uri.parse('https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(address)}');
  await launchUrl(uri, mode: LaunchMode.externalApplication);
}

void toast(BuildContext context, String msg, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? const Color(0xFFB91C1C) : null,
      duration: Duration(seconds: error ? 5 : 3),
    ));
}

Future<String?> promptText(BuildContext context, String title,
    {String? initial, String? hint, bool number = false, bool caps = false}) {
  final ctrl = TextEditingController(text: initial ?? '');
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: ctrl,
        autofocus: true,
        keyboardType: number ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text,
        textCapitalization: caps ? TextCapitalization.characters : TextCapitalization.none,
        decoration: InputDecoration(hintText: hint),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: const Text('OK')),
      ],
    ),
  );
}

Future<bool> confirm(BuildContext context, String title, String body, {String ok = 'Yes'}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(ok)),
      ],
    ),
  );
  return r == true;
}

/// Section label used inside cards / forms.
class SectionLabel extends StatelessWidget {
  final String text;
  const SectionLabel(this.text, {super.key});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 16, bottom: 6),
        child: Text(text.toUpperCase(),
            style: TextStyle(fontSize: 11, letterSpacing: 0.8, fontWeight: FontWeight.w700, color: Theme.of(context).colorScheme.outline)),
      );
}

/// Empty / error state for a list.
class EmptyState extends StatelessWidget {
  final IconData icon;
  final String text;
  const EmptyState(this.icon, this.text, {super.key});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
        child: Column(children: [
          Icon(icon, size: 40, color: Theme.of(context).colorScheme.outline),
          const SizedBox(height: 10),
          Text(text, textAlign: TextAlign.center, style: TextStyle(color: Theme.of(context).colorScheme.outline)),
        ]),
      );
}
