import 'package:flutter/material.dart';
import '../api_client.dart';
import '../ui.dart';

/// Rider sign-in (Rider ID + PIN) by default; staff can switch to email + password.
class LoginScreen extends StatefulWidget {
  final Future<void> Function() onSignedIn;
  const LoginScreen({super.key, required this.onSignedIn});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _riderCode = TextEditingController();
  final _pin = TextEditingController();
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
      await widget.onSignedIn();
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : 'Could not reach the server — check your internet.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Image.asset('assets/logo.png', height: 56, errorBuilder: (_, __, ___) => const SizedBox.shrink()),
                  const SizedBox(height: 12),
                  Text(_riderMode ? 'Rider sign-in' : 'Staff sign-in',
                      textAlign: TextAlign.center, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
                  Text('Pickups · Deliveries · Booking · Scanning',
                      textAlign: TextAlign.center, style: TextStyle(color: cs.outline)),
                  const SizedBox(height: 28),
                  if (_error != null)
                    Container(
                      margin: const EdgeInsets.only(bottom: 12),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(color: cs.errorContainer, borderRadius: BorderRadius.circular(8)),
                      child: Text(_error!, style: TextStyle(color: cs.onErrorContainer)),
                    ),
                  if (_riderMode) ...[
                    TextField(
                      controller: _riderCode,
                      decoration: const InputDecoration(labelText: 'Rider ID', hintText: 'e.g. RID001', border: OutlineInputBorder()),
                      textCapitalization: TextCapitalization.characters,
                      autocorrect: false,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _pin,
                      decoration: const InputDecoration(labelText: 'PIN', border: OutlineInputBorder()),
                      keyboardType: TextInputType.number,
                      obscureText: true,
                      onSubmitted: (_) => _login(),
                    ),
                  ] else ...[
                    TextField(
                      controller: _email,
                      decoration: const InputDecoration(labelText: 'Email', border: OutlineInputBorder()),
                      keyboardType: TextInputType.emailAddress,
                      autocorrect: false,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _password,
                      decoration: const InputDecoration(labelText: 'Password', border: OutlineInputBorder()),
                      obscureText: true,
                      onSubmitted: (_) => _login(),
                    ),
                  ],
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _busy ? null : _login,
                    style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52), backgroundColor: kBrand),
                    child: Text(_busy ? 'Signing in…' : 'Sign in'),
                  ),
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: _busy
                        ? null
                        : () => setState(() {
                              _riderMode = !_riderMode;
                              _error = null;
                            }),
                    child: Text(_riderMode ? 'Staff? Sign in with email' : 'Rider? Sign in with Rider ID & PIN'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
