/// API base URL. Override at build/run time:
///   flutter run --dart-define=API_BASE=https://your-host
const String kApiBase = String.fromEnvironment(
  'API_BASE',
  defaultValue: 'https://logimart-erp.onrender.com',
);

/// Checkpoints the ground staff can scan against (mirror of the server enum).
const List<String> kCheckpoints = [
  'PICKUP',
  'HUB_IN',
  'HUB_OUT',
  'LOAD',
  'UNLOAD',
  'DELIVERY',
];
