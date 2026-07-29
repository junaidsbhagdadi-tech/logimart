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

class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  String? _token;

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
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('token');
  }

  Future<void> login(String email, String password) async {
    final res = await http.post(
      Uri.parse('$kApiBase/api/v1/auth/login'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    if (res.statusCode != 201 && res.statusCode != 200) {
      throw Exception('Login failed: ${res.statusCode}');
    }
    await _saveToken(jsonDecode(res.body)['accessToken'] as String);
  }

  /// Push a batch of offline scans. The server is idempotent on clientEventId,
  /// so re-sending after a flaky connection is always safe.
  Future<BulkSyncResult> bulkSync(String deviceId, List<Scan> scans) async {
    final t = await token();
    final res = await http.post(
      Uri.parse('$kApiBase/api/v1/scans/bulk-sync'),
      headers: {'content-type': 'application/json', 'authorization': 'Bearer $t'},
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

  Future<Map<String, dynamic>> recordPod(
    String awb, {
    required double lat,
    required double lng,
    required int piecesDelivered,
    bool force = false,
  }) async {
    final t = await token();
    final res = await http.post(
      Uri.parse('$kApiBase/api/v1/shipments/$awb/pod${force ? '?force=true' : ''}'),
      headers: {'content-type': 'application/json', 'authorization': 'Bearer $t'},
      body: jsonEncode({'gpsLat': lat, 'gpsLng': lng, 'piecesDelivered': piecesDelivered}),
    );
    if (res.statusCode == 409) {
      throw Exception('Missing pieces — POD blocked. Use force to record a short delivery.');
    }
    if (res.statusCode != 201 && res.statusCode != 200) {
      throw Exception('POD failed: ${res.statusCode} ${res.body}');
    }
    return jsonDecode(res.body) as Map<String, dynamic>;
  }
}
