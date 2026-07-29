import 'package:flutter/material.dart';
import 'api_client.dart';
import 'screens/login_screen.dart';
import 'screens/scan_screen.dart';

void main() {
  runApp(const AkulScannerApp());
}

class AkulScannerApp extends StatelessWidget {
  const AkulScannerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Akul Scanner',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF2B2E83), // Akul brand blue/indigo
        useMaterial3: true,
      ),
      home: FutureBuilder<String?>(
        future: ApiClient.instance.token(),
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Scaffold(body: Center(child: CircularProgressIndicator()));
          }
          return snap.data != null ? const ScanScreen() : const LoginScreen();
        },
      ),
    );
  }
}
