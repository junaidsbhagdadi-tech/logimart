import 'package:flutter/material.dart';
import '../api_client.dart';
import 'book_screen.dart';
import 'deliveries_screen.dart';
import 'pickups_screen.dart';
import 'scan_screen.dart';

/// Signed-in shell: bottom tabs. Riders get Pickups · Deliveries · Book · Scan; staff logins
/// (no rider task list) get Deliveries (find AWB) · Book · Scan.
class HomeShell extends StatefulWidget {
  final VoidCallback onLogout;
  const HomeShell({super.key, required this.onLogout});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _Tab {
  final String label;
  final IconData icon, selected;
  final Widget Function() build;
  _Tab(this.label, this.icon, this.selected, this.build);
}

class _HomeShellState extends State<HomeShell> {
  int _i = 0;
  // Build each tab once and keep it alive (IndexedStack), so switching tabs doesn't lose a half-filled booking.
  final Map<int, Widget> _built = {};

  late final List<_Tab> _tabs = [
    if (ApiClient.instance.me?.isRider ?? true)
      _Tab('Pickups', Icons.inventory_2_outlined, Icons.inventory_2, () => const PickupsScreen()),
    _Tab('Deliveries', Icons.local_shipping_outlined, Icons.local_shipping, () => const DeliveriesScreen()),
    _Tab('Book', Icons.add_box_outlined, Icons.add_box, () => const BookScreen()),
    _Tab('Scan', Icons.qr_code_scanner_outlined, Icons.qr_code_scanner, () => const ScanScreen()),
  ];

  Future<void> _logout() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Sign out')),
        ],
      ),
    );
    if (ok == true) widget.onLogout();
  }

  @override
  Widget build(BuildContext context) {
    final me = ApiClient.instance.me;
    _built.putIfAbsent(_i, () => _tabs[_i].build());
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(_tabs[_i].label),
          if (me != null)
            Text('${me.fullName}${me.riderCode != null ? ' · ${me.riderCode}' : ''}',
                style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
        ]),
        actions: [IconButton(tooltip: 'Sign out', onPressed: _logout, icon: const Icon(Icons.logout))],
      ),
      body: IndexedStack(
        index: _i,
        children: List.generate(_tabs.length, (k) => _built[k] ?? const SizedBox.shrink()),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _i,
        onDestinationSelected: (k) => setState(() {
          // The scanner holds the camera — drop it when leaving the Scan tab.
          if (_tabs[_i].label == 'Scan') _built.remove(_i);
          _i = k;
        }),
        destinations: _tabs
            .map((t) => NavigationDestination(icon: Icon(t.icon), selectedIcon: Icon(t.selected), label: t.label))
            .toList(),
      ),
    );
  }
}
