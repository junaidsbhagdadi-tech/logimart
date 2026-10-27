import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import 'config.dart';

/// In-app update prompt. The server publishes /downloads/version.json next to the APKs:
///   {"version":"1.3.2","notes":"…","minVersion":"1.0.0","url":"/downloads/excelex-rider.apk","liteUrl":"/downloads/excelex-rider-lite.apk"}
/// On launch the app compares its own version; if newer, it offers the download (Android then installs it).
/// Below `minVersion` the prompt can't be dismissed. Installs from the arm64 "lite" APK (versionCode ≥ 1000,
/// split-per-ABI) are pointed at the lite file so riders don't pull the 70 MB universal one.
class UpdateCheck {
  static bool _shownThisLaunch = false;

  static int _cmp(String a, String b) {
    List<int> p(String v) => v.split('+').first.split('.').map((x) => int.tryParse(x) ?? 0).toList();
    final x = p(a), y = p(b);
    for (var i = 0; i < 3; i++) {
      final d = (i < x.length ? x[i] : 0) - (i < y.length ? y[i] : 0);
      if (d != 0) return d;
    }
    return 0;
  }

  static Future<String> currentVersion() async => (await PackageInfo.fromPlatform()).version;

  /// [manual] = the user asked ("Check for updates") → also say when they're already up to date.
  static Future<void> run(BuildContext context, {bool manual = false}) async {
    if (_shownThisLaunch && !manual) return;
    try {
      final info = await PackageInfo.fromPlatform();
      final res = await http
          .get(Uri.parse('$kApiBase/downloads/version.json?t=${DateTime.now().millisecondsSinceEpoch}'))
          .timeout(const Duration(seconds: 15));
      if (res.statusCode != 200) throw Exception('HTTP ${res.statusCode}');
      final j = jsonDecode(res.body) as Map<String, dynamic>;
      final latest = '${j['version'] ?? ''}';
      if (latest.isEmpty || _cmp(latest, info.version) <= 0) {
        if (manual && context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('You have the latest version (${info.version}).')));
        }
        return;
      }
      final forced = _cmp(info.version, '${j['minVersion'] ?? '0.0.0'}') < 0;
      final lite = (int.tryParse(info.buildNumber) ?? 0) >= 1000 && j['liteUrl'] != null;
      final path = '${lite ? j['liteUrl'] : j['url']}';
      final url = path.startsWith('http') ? path : '$kApiBase$path';
      _shownThisLaunch = true;
      if (!context.mounted) return;
      await showDialog<void>(
        context: context,
        barrierDismissible: !forced,
        builder: (ctx) => PopScope(
          canPop: !forced,
          child: AlertDialog(
            title: Text('Update available — $latest'),
            content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('You have ${info.version}.${forced ? ' This version is no longer supported — please update.' : ''}'),
              if ('${j['notes'] ?? ''}'.isNotEmpty) ...[const SizedBox(height: 10), Text('${j['notes']}')],
              const SizedBox(height: 10),
              const Text('Tap Update, let the download finish, then open it and tap Install.', style: TextStyle(fontSize: 12)),
            ]),
            actions: [
              if (!forced) TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Later')),
              FilledButton.icon(
                icon: const Icon(Icons.system_update),
                label: const Text('Update'),
                onPressed: () => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication),
              ),
            ],
          ),
        ),
      );
    } catch (e) {
      if (manual && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not check for updates: $e')));
      }
    }
  }
}
