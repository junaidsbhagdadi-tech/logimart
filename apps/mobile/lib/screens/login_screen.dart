import 'package:flutter/material.dart';
import '../api_client.dart';
import 'scan_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  // Rider (default) login — Rider ID + PIN
  final _riderCode = TextEditingController();
  final _pin = TextEditingController();
  // Staff login — email + password (for warehouse handlers / managers)
  final _email = TextEditingController();
  final _password = TextEditingController();

  bool _riderMode = true; // riders are the primary app users
  bool _busy = false;
  String? _error;

  Future<void> _login() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_riderMode) {
        await ApiClient.instance.riderLogin(_riderCode.text, _pin.text);
      } else {
        await ApiClient.instance.login(_email.text.trim(), _password.text);
      }
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const ScanScreen()),
        );
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('LogiMart',
                  style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold)),
              Text(_riderMode ? 'Rider App' : 'Ground Ops Scanner'),
              const SizedBox(height: 24),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(_error!, style: const TextStyle(color: Colors.red)),
                ),
              if (_riderMode) ...[
                TextField(
                  controller: _riderCode,
                  decoration:
                      const InputDecoration(labelText: 'Rider ID (e.g. RID001)'),
                  textCapitalization: TextCapitalization.characters,
                  autocorrect: false,
                ),
                TextField(
                  controller: _pin,
                  decoration: const InputDecoration(labelText: 'PIN'),
                  keyboardType: TextInputType.number,
                  obscureText: true,
                ),
              ] else ...[
                TextField(
                  controller: _email,
                  decoration: const InputDecoration(labelText: 'Email'),
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                ),
                TextField(
                  controller: _password,
                  decoration: const InputDecoration(labelText: 'Password'),
                  obscureText: true,
                ),
              ],
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _busy ? null : _login,
                  child: Text(_busy ? 'Signing in…' : 'Sign in'),
                ),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: _busy
                    ? null
                    : () => setState(() {
                          _riderMode = !_riderMode;
                          _error = null;
                        }),
                child: Text(_riderMode
                    ? 'Staff sign-in (email & password)'
                    : 'Rider sign-in (Rider ID & PIN)'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
