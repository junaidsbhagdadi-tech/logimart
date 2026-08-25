#!/usr/bin/env bash
# ============================================================================
#  Logimart ERP — build & (re)start the app.  Run from the repo root ON the server.
#     bash deploy/app-deploy.sh
#  Prereqs: server-setup.sh has run, and apps/api/.env exists (from the template).
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

if [ ! -f apps/api/.env ]; then
  echo "ERROR: apps/api/.env is missing. Copy deploy/env.production.template to apps/api/.env and fill it."
  exit 1
fi

echo "==> Pull latest (skip if you rsynced the code)"
git pull --ff-only || true

echo "==> Build (installs deps, prisma generate + db push, builds API + web portal)"
npm run build

echo "==> Start / restart under pm2"
if pm2 describe logimart >/dev/null 2>&1; then
  pm2 restart logimart --update-env
else
  # cwd = apps/api so NestJS ConfigModule finds apps/api/.env; it serves the built web too.
  pm2 start "node dist/main.js" --name logimart --cwd apps/api
fi
pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME" | tail -1 || true

echo ""
echo "Deployed. App on http://127.0.0.1:3000  (nginx serves https://erp.logimart.co.in)"
echo "Check logs:  pm2 logs logimart"
