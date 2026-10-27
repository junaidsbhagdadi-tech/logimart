import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'config.dart';
import 'models/scan.dart';

class BulkSyncResult {
  final List<String> accepted;
  final List<String> duplicate;
  final List<Map<String, dynamic>> rejected;
  BulkSyncResult(this.accepted, this.duplicate, this.rejected);

  /// Both accepted and duplicate are safe to clear from the local queue.
  List<String> get settled => [...accepted, ...duplicate];
}

/// An API error carrying the server's own message (Nest returns `{ message }`, sometimes a list).
class ApiException implements Exception {
  final int status;
  final String message;
  ApiException(this.status, this.message);
  @override
  String toString() => message;
}

/// The signed-in user (from /auth/me).
class Me {
  final String id;
  final String fullName;
  final String role;
  final String? riderCode;
  Me(this.id, this.fullName, this.role, this.riderCode);
  bool get isRider => role == 'DRIVER';
}

class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  /// Called when the server rejects the token (expired / revoked) — the app returns to login.
  void Function()? onUnauthorized;

  String? _token;
  Me? me;

  Future<String?> token() async {
    if (_token != null) return _token;
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('token');
    return _token;
  }

  Future<void> _saveToken(String t) async {
    _token = t;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('token', t);
  }

  Future<void> logout() async {
    _token = null;
    me = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('token');
  }

  // ---- low-level helpers ----

  Future<Map<String, String>> _headers({bool json = false}) async {
    final t = await token();
    return {
      if (json) 'content-type': 'application/json',
      if (t != null) 'authorization': 'Bearer $t',
    };
  }

  dynamic _decode(http.Response res) {
    dynamic body;
    try {
      body = res.body.isEmpty ? null : jsonDecode(res.body);
    } catch (_) {
      body = null;
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return body;
    var msg = 'Request failed (${res.statusCode})';
    if (body is Map && body['message'] != null) {
      final m = body['message'];
      msg = m is List ? m.join('\n') : m.toString();
    }
    if (res.statusCode == 401) {
      onUnauthorized?.call();
      msg = 'Session expired — please sign in again.';
    }
    throw ApiException(res.statusCode, msg);
  }

  Future<dynamic> get(String path) async {
    final res = await http
        .get(Uri.parse('$kApiBase$path'), headers: await _headers())
        .timeout(const Duration(seconds: 30));
    return _decode(res);
  }

  Future<dynamic> post(String path, [Object? body]) async {
    final res = await http
        .post(Uri.parse('$kApiBase$path'), headers: await _headers(json: true), body: jsonEncode(body ?? {}))
        .timeout(const Duration(seconds: 90));
    return _decode(res);
  }

  // ---- auth ----

  Future<void> login(String email, String password) async {
    final res = await http.post(
      Uri.parse('$kApiBase/api/v1/auth/login'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    if (res.statusCode != 201 && res.statusCode != 200) {
      throw ApiException(res.statusCode, 'Wrong email or password');
    }
    await _saveToken(jsonDecode(res.body)['accessToken'] as String);
  }

  /// Field-rider login: Rider ID (e.g. RID001) + numeric PIN.
  Future<void> riderLogin(String riderCode, String pin) async {
    final res = await http.post(
      Uri.parse('$kApiBase/api/v1/auth/rider-login'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'riderCode': riderCode.trim().toUpperCase(), 'pin': pin.trim()}),
    );
    if (res.statusCode != 201 && res.statusCode != 200) {
      throw ApiException(res.statusCode, 'Invalid Rider ID or PIN');
    }
    await _saveToken(jsonDecode(res.body)['accessToken'] as String);
  }

  Future<Me> loadMe() async {
    final m = await get('/api/v1/auth/me') as Map<String, dynamic>;
    me = Me('${m['id']}', '${m['fullName'] ?? ''}', '${m['role'] ?? ''}', m['riderCode'] as String?);
    return me!;
  }

  // ---- rider tasks ----

  /// The signed-in rider's open pickups + deliveries, and today's done counts.
  Future<Map<String, dynamic>> myTasks() async => await get('/api/v1/rider/tasks') as Map<String, dynamic>;

  /// Mark a pickup request collected. With a destination (and no existing AWB) the server books
  /// the billable shipment and moves it to Picked.
  Future<Map<String, dynamic>> completePickup(String id, Map<String, dynamic> body) async =>
      await post('/api/v1/pickups/$id/complete', body) as Map<String, dynamic>;

  // ---- shipments / delivery ----

  Future<Map<String, dynamic>> shipment(String awb) async =>
      await get('/api/v1/shipments/${Uri.encodeComponent(awb.trim().toUpperCase())}') as Map<String, dynamic>;

  /// Milestone scan (OFD / DLD / UDL …) for one or more AWBs. DLD needs a POD image data URL.
  Future<Map<String, dynamic>> lifecycleScan(List<String> awbs, String code, {String? remark, String? podDataUrl}) async =>
      await post('/api/v1/lifecycle/scan', {
        'awbs': awbs,
        'code': code,
        if (remark != null) 'remark': remark,
        if (podDataUrl != null) 'podDataUrl': podDataUrl,
      }) as Map<String, dynamic>;

  Future<void> collectDod(String awb, String reference, {String? bankName}) =>
      post('/api/v1/shipments/$awb/dod/collect', {
        'reference': reference,
        if (bankName != null && bankName.isNotEmpty) 'bankName': bankName,
      });

  /// Record cash / To-Pay freight collected at delivery.
  Future<void> collectFreight(String awb, double amount) =>
      post('/api/v1/shipments/$awb/collect-freight', {'amount': amount});

  // ---- booking ----

  Future<List<Map<String, dynamic>>> bookingCustomers() async =>
      (await get('/api/v1/shipments/booking-customers') as List).cast<Map<String, dynamic>>();

  Future<List<Map<String, dynamic>>> master(String type) async =>
      (await get('/api/v1/masters/$type') as List).cast<Map<String, dynamic>>();

  Future<List<Map<String, dynamic>>> vendors() async =>
      (await get('/api/v1/vendors') as List).cast<Map<String, dynamic>>();

  Future<Map<String, dynamic>> pincode(String pin) async =>
      await get('/api/v1/pincodes/$pin') as Map<String, dynamic>;

  Future<Map<String, dynamic>> createShipment(Map<String, dynamic> body) async =>
      await post('/api/v1/shipments', body) as Map<String, dynamic>;

  /// Shipments I booked on a day (IST, default today).
  Future<Map<String, dynamic>> myBookings({String? date}) async =>
      await get('/api/v1/shipments/my-bookings${date != null ? '?date=$date' : ''}') as Map<String, dynamic>;

  /// Correct a booking (riders: own bookings only, before pickup / carrier hand-off).
  Future<void> editShipment(String awb, Map<String, dynamic> patch) => post('/api/v1/shipments/$awb/edit', patch);

  /// Carrier hand-off — the server picks the integration (BlueDart / Delhivery / XpressBees / Gati /
  /// V Express / AR Logistics) from the shipment's vendor code and returns the carrier AWB.
  Future<Map<String, dynamic>> handoffCarrier(String awb) async =>
      await post('/api/v1/carriers/handoff/$awb') as Map<String, dynamic>;

  /// Cancel a booking (riders: own bookings only, before pickup / carrier hand-off).
  Future<void> cancelShipment(String awb, String reason) => post('/api/v1/shipments/$awb/cancel', {'reason': reason});

  /// Other carriers: record the carrier's AWB against ours.
  Future<void> setForwarding(String awb, String vendor, String forwardingAwb) =>
      post('/api/v1/shipments/$awb/forwarding', {'vendor': vendor, 'forwardingAwb': forwardingAwb});

  /// BlueDart account codes — a vendor code matching one of these is a BlueDart booking.
  Future<List<String>> blueDartCodes() async {
    final r = (await get('/api/v1/bluedart/account-options') as List).cast<Map<String, dynamic>>();
    return r.expand((a) => [a['customerCode'], a['accountCode']]).where((x) => x != null && '$x'.isNotEmpty).map((x) => '$x'.toUpperCase()).toList();
  }

  // ---- offline scan sync ----

  /// Push a batch of offline scans. The server is idempotent on clientEventId,
  /// so re-sending after a flaky connection is always safe.
  Future<BulkSyncResult> bulkSync(String deviceId, List<Scan> scans) async {
    final res = await http.post(
      Uri.parse('$kApiBase/api/v1/scans/bulk-sync'),
      headers: await _headers(json: true),
      body: jsonEncode({
        'deviceId': deviceId,
        'events': scans.map((s) => s.toSyncJson()).toList(),
      }),
    );
    if (res.statusCode != 200 && res.statusCode != 207) {
      throw Exception('Sync failed: ${res.statusCode} ${res.body}');
    }
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return BulkSyncResult(
      (body['accepted'] as List).cast<String>(),
      (body['duplicate'] as List).cast<String>(),
      (body['rejected'] as List).cast<Map<String, dynamic>>(),
    );
  }
}
