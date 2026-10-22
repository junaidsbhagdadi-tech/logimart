# ExcelEx Rider (Flutter) — field app for Logimart ERP

Android app for pickup boys, delivery riders and ground staff. Talks to the same API as the web
app (`https://erp.logimart.co.in`, see `lib/config.dart`).

## What it does
| Tab | Who | What |
|---|---|---|
| **Pickups** | riders | Pickups assigned to me (`GET /rider/tasks`), call / map, **Mark picked** → `POST /pickups/:id/complete` books the shipment (needs destination pincode + consignee unless CS already generated the AWB at hand-off). Today's picked / delivered counts. |
| **Deliveries** | riders + staff | **Take out for delivery** (scan many AWBs → `OFD`; the rider becomes the delivery rider), my open deliveries, find any AWB. Delivery screen: collect DOD cheque/DD and To-Pay freight, **POD photo (mandatory)** → `DLD`, or **Undelivered** with a reason → `UDL`. |
| **Book** | riders + staff | Quick booking — same payload as web Quick Book (customer, product, carrier, consignee, boxes + weight, AWB / forwarding / invoice / e-way scannable). |
| **Scan** | everyone | Offline-first checkpoint scanning: scans queue in SQLite and sync to `POST /scans/bulk-sync` (idempotent on `clientEventId`) when the network returns. |

Login: riders use **Rider ID + PIN** (web → Riders & Drivers); staff can switch to email + password.
Staff logins don't get the Pickups tab (the rider task list is per rider).

## Build the APK (Windows)
One-time toolchain (no admin needed) lives in `C:\dev`: `flutter` (stable), `jdk17`, `android-sdk`
(platforms 35/36, build-tools, NDK 28.2). Then:

```bash
cd apps/mobile
flutter pub get
flutter build apk --release      # → build/app/outputs/flutter-apk/app-release.apk
```

**Signing:** release builds are signed with `C:\dev\logimart-keys\logimart-release.jks` via
`C:\dev\logimart-keys\key.properties` (override with `LOGIMART_KEY_PROPS`). Both are deliberately
**outside the repo**. Keep a backup — Android only installs updates signed with the same key; lose it
and every rider has to uninstall + reinstall.

Bump `version:` in `pubspec.yaml` (e.g. `1.0.1+3`) for every release so phones accept the update.

## Publish
Copy the APK to the server; riders install from the link (also shown on the web Riders page):

```bash
scp build/app/outputs/flutter-apk/app-release.apk root@168.144.77.53:/var/www/logimart-downloads/excelex-rider.apk
```
→ `https://erp.logimart.co.in/downloads/excelex-rider.apk` (nginx `location /downloads/`).
On the phone: open the link → allow "install unknown apps" for the browser once → Install.

## Layout
```
lib/
├─ main.dart              # session restore (/auth/me) → login or home
├─ config.dart            # API base + checkpoint list
├─ api_client.dart        # all API calls; 401 → back to login
├─ ui.dart                # status chip, camera barcode scanner, POD photo, call/map, dialogs
├─ local_queue.dart       # SQLite offline scan queue
├─ sync_service.dart      # idempotent drain + auto-sync on reconnect
├─ models/scan.dart
└─ screens/
   ├─ login_screen.dart
   ├─ home_shell.dart     # bottom tabs
   ├─ pickups_screen.dart
   ├─ deliveries_screen.dart
   ├─ book_screen.dart
   └─ scan_screen.dart
```
