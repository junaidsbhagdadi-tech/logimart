#!/usr/bin/env bash
# Build + (re)start the SALES DEMO instance from the current production checkout — a separate app (pm2
# "demo-erp", port 3100) on its own database, with every real name rewritten out of the built bundles.
#   bash deploy/demo-deploy.sh            # rebuild + restart (data kept)
#   bash deploy/demo-deploy.sh --reseed   # also wipe the demo database and seed fresh fictional data
# One-time setup (database, .env, nginx + HTTPS): bash deploy/demo-setup.sh
set -euo pipefail
SRC=/root/logimart
DEMO=/root/demo-erp

[ -f "$DEMO/apps/api/.env" ] || { echo "No $DEMO/apps/api/.env — run deploy/demo-setup.sh first."; exit 1; }
echo "==> Sync code from $SRC (no .git, no prod .env, no mobile app)"
rsync -a --delete --exclude .git --exclude apps/api/.env --exclude apps/api/dist --exclude apps/web/dist --exclude apps/mobile "$SRC/" "$DEMO/"

cd "$DEMO/apps/api"
set -a; . ./.env; set +a
case "$DATABASE_URL" in *demo*) ;; *) echo "Refusing: DATABASE_URL is not a demo database."; exit 1;; esac

echo "==> Build API + web"
npx prisma generate >/dev/null
npm run build >/dev/null
(cd "$DEMO/apps/web" && npm run build >/dev/null)

echo "==> Rewrite real names out of the build (fails on any leftover)"
node "$DEMO/scripts/demo/rebrand.mjs" "$DEMO"

if [ "${1:-}" = "--reseed" ]; then
  echo "==> Recreate the demo database"
  pm2 stop demo-erp >/dev/null 2>&1 || true
  ADMIN_URL="${DATABASE_URL/\/demo_erp?//defaultdb?}"
  psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS demo_erp WITH (FORCE)" -qc "CREATE DATABASE demo_erp"
fi

echo "==> Schema"
npx prisma db push --skip-generate --accept-data-loss >/dev/null

if [ "${1:-}" = "--reseed" ]; then
  bash "$DEMO/deploy/demo-reference-data.sh"
  echo "==> Seed fictional data (takes a few minutes)"
  node scripts/demo/seed-demo.js
fi

echo "==> Start"
if pm2 describe demo-erp >/dev/null 2>&1; then pm2 restart demo-erp --update-env >/dev/null; else pm2 start "node dist/main.js" --name demo-erp --cwd "$DEMO/apps/api" >/dev/null; fi
pm2 save >/dev/null
echo "Demo deployed → ${APP_URL:-http://127.0.0.1:3100}"
