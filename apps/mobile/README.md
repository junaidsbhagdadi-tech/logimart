# Logimart Scanner (Flutter) — Ground-Ops Mobile

Offline-first MPS scanning client for warehouse handlers and drivers.

## What it does (Module 2)
- **Camera scanning** of child barcodes via `mobile_scanner` (ML Kit). Works with
  integrated hardware scanners (Zebra/Honeywell) too — they emit the same scan events.
- **Checkpoint selector** — PICKUP / HUB_IN / HUB_OUT / LOAD / UNLOAD / DELIVERY.
- **Offline-first queue** — every scan is written to a local SQLite WAL queue with a
  client-generated `clientEventId` (UUID). Scans survive dead zones, basements, and
  app restarts.
- **Idempotent sync** — `SyncService` drains the queue to `POST /api/v1/scans/bulk-sync`
  in batches of 500. The server dedups on `clientEventId`, so re-sends are safe; we only
  clear locally what the server reports as `accepted` or `duplicate`. Auto-syncs when
  connectivity returns.

## Run it
This folder contains `pubspec.yaml` + `lib/` only. Generate the platform projects once:

```bash
cd apps/mobile
flutter create .            # generates android/ ios/ etc. (keeps lib/ & pubspec.yaml)
flutter pub get
flutter run --dart-define=API_BASE=https://brave-respect-production-1357.up.railway.app
```

Default API base is already the Railway UAT URL (see `lib/config.dart`); override with
`--dart-define=API_BASE=...` for production.

**Login:** seeded ops user `warehouse@logimart.com` / `logimart1234` (or `driver@…`).

## Permissions to add after `flutter create`
- **Android** — `android/app/src/main/AndroidManifest.xml`:
  `<uses-permission android:name="android.permission.CAMERA"/>` and (for POD GPS)
  `ACCESS_FINE_LOCATION`.
- **iOS** — `ios/Runner/Info.plist`: `NSCameraUsageDescription` and
  `NSLocationWhenInUseUsageDescription`.

## Test the offline guarantee
1. Put the phone in airplane mode.
2. Scan a batch of child labels — watch **Pending** climb; nothing is lost.
3. Re-enable network → auto-sync (or tap **Sync now**). Pending drops to 0.
4. Re-run sync — the server returns those as `duplicate`, so no double-counting.

## Layout
```
lib/
├─ main.dart            # app entry; routes to login or scanner by token
├─ config.dart          # API base + checkpoint list
├─ api_client.dart      # login, bulk-sync, POD
├─ local_queue.dart     # SQLite offline queue
├─ sync_service.dart    # idempotent drain + auto-sync on reconnect
├─ models/scan.dart
└─ screens/
   ├─ login_screen.dart
   └─ scan_screen.dart  # camera + checkpoint + pending count + sync
```
