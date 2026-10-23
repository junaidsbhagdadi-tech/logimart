import 'dart:collection';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import '../api_client.dart';
import '../config.dart';

/// Opens one of the ERP's print pages (AWB copy, courier label, BlueDart AWB, handover manifest) inside
/// the app, signed in as the rider, and sends it to Android's print dialog (printer or "Save as PDF").
/// Re-using the web pages keeps every printout identical to what the office prints.
class PrintView extends StatefulWidget {
  final String title;
  final String path; // e.g. /shipments/L100/awb-print
  const PrintView({super.key, required this.title, required this.path});

  static Future<void> open(BuildContext context, String title, String path) =>
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => PrintView(title: title, path: path)));

  @override
  State<PrintView> createState() => _PrintViewState();
}

class _PrintViewState extends State<PrintView> {
  InAppWebViewController? _web;
  String? _token;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    ApiClient.instance.token().then((t) => setState(() => _token = t));
  }

  Future<void> _print() async {
    final w = _web;
    if (w == null) return;
    try {
      await w.printCurrentPage(settings: PrintJobSettings(jobName: widget.title));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not print: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ApiClient.instance.me;
    // The web app keeps its session in localStorage — seed it before the page's own scripts run.
    final seed = '''
      try {
        localStorage.setItem('logimart_token', ${jsonEncode(_token ?? '')});
        localStorage.setItem('logimart_user', ${jsonEncode(jsonEncode({'id': me?.id, 'fullName': me?.fullName, 'role': me?.role, 'clientId': null}))});
      } catch (e) {}
      // The pages call window.print() themselves — hand that to the phone's print dialog.
      window.print = function () { window.flutter_inappwebview.callHandler('print'); };
    ''';
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [IconButton(tooltip: 'Print / Save PDF', icon: const Icon(Icons.print), onPressed: _print)],
      ),
      body: _token == null
          ? const Center(child: CircularProgressIndicator())
          : Stack(children: [
              InAppWebView(
                initialUrlRequest: URLRequest(url: WebUri('$kApiBase${widget.path}')),
                initialUserScripts: UnmodifiableListView([
                  UserScript(source: seed, injectionTime: UserScriptInjectionTime.AT_DOCUMENT_START),
                ]),
                initialSettings: InAppWebViewSettings(javaScriptEnabled: true, supportZoom: true, builtInZoomControls: true, displayZoomControls: false),
                onWebViewCreated: (c) {
                  _web = c;
                  c.addJavaScriptHandler(handlerName: 'print', callback: (_) => _print());
                },
                onLoadStop: (_, __) => setState(() => _loading = false),
              ),
              if (_loading) const LinearProgressIndicator(),
            ]),
    );
  }
}
