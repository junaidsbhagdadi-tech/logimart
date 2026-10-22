import 'package:flutter/material.dart';
import 'api_client.dart';
import 'screens/home_shell.dart';
import 'screens/login_screen.dart';
import 'ui.dart';

void main() {
  runApp(const LogimartApp());
}

class LogimartApp extends StatefulWidget {
  const LogimartApp({super.key});
  @override
  State<LogimartApp> createState() => _LogimartAppState();
}

enum _Stage { loading, signedOut, signedIn }

class _LogimartAppState extends State<LogimartApp> {
  _Stage _stage = _Stage.loading;

  @override
  void initState() {
    super.initState();
    ApiClient.instance.onUnauthorized = () {
      ApiClient.instance.logout();
      if (mounted && _stage == _Stage.signedIn) setState(() => _stage = _Stage.signedOut);
    };
    _restore();
  }

  /// Resume a saved session: the token must still be valid (/auth/me), else back to sign-in.
  Future<void> _restore() async {
    final t = await ApiClient.instance.token();
    if (t == null) return setState(() => _stage = _Stage.signedOut);
    try {
      await ApiClient.instance.loadMe();
      setState(() => _stage = _Stage.signedIn);
    } on ApiException catch (e) {
      if (e.status == 401) await ApiClient.instance.logout();
      setState(() => _stage = e.status == 401 ? _Stage.signedOut : _Stage.signedIn);
    } catch (_) {
      // Offline at launch — keep the session; screens show their own network errors and scans queue.
      setState(() => _stage = _Stage.signedIn);
    }
  }

  Future<void> _signedIn() async {
    try {
      await ApiClient.instance.loadMe();
    } catch (_) {}
    setState(() => _stage = _Stage.signedIn);
  }

  Future<void> _logout() async {
    await ApiClient.instance.logout();
    setState(() => _stage = _Stage.signedOut);
  }

  @override
  Widget build(BuildContext context) {
    final theme = ThemeData(
      colorSchemeSeed: kBrand,
      useMaterial3: true,
      inputDecorationTheme: const InputDecorationTheme(isDense: true),
    );
    return MaterialApp(
      title: 'ExcelEx Rider',
      debugShowCheckedModeBanner: false,
      theme: theme,
      darkTheme: ThemeData(colorSchemeSeed: kBrand, useMaterial3: true, brightness: Brightness.dark),
      home: switch (_stage) {
        _Stage.loading => const Scaffold(body: Center(child: CircularProgressIndicator())),
        _Stage.signedOut => LoginScreen(onSignedIn: _signedIn),
        _Stage.signedIn => HomeShell(key: ValueKey(ApiClient.instance.me?.id), onLogout: _logout),
      },
    );
  }
}
