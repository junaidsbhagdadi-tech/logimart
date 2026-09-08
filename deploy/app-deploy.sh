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

# Give the API's tsc build enough heap — the 2GB droplet OOMs the nest build otherwise, which used
# to leave apps/api/dist/main.js missing and could wedge pm2 in a crash-loop. Prevents the root cause.
export NODE_OPTIONS="--max-old-space-size=1792"

echo "==> Build (installs deps, prisma generate + db push, builds API + web portal)"
# npm run build ends with scripts/verify-build.mjs, which exits non-zero if a build artifact is
# missing. Combined with `set -e`, a failed/OOM build ABORTS HERE — before any restart — so the
# currently-running app keeps serving and the site never 502s on a broken build.
npm run build

# Belt-and-suspenders: never restart unless both entry artifacts are actually on disk.
if [ ! -f apps/api/dist/main.js ] || [ ! -f apps/web/dist/index.html ]; then
  echo "ERROR: build artifacts missing after build — NOT restarting; previous version stays live."
  exit 1
fi

echo "==> Start / restart under pm2"
if pm2 describe logimart >/dev/null 2>&1; then
  pm2 restart logimart --update-env
else
  # cwd = apps/api so NestJS ConfigModule finds apps/api/.env; it serves the built web too.
  pm2 start "node dist/main.js" --name logimart --cwd apps/api
fi
pm2 save
pm2 startup systemd -u "${USER:-root}" --hp "${HOME:-/root}" | tail -1 || true

echo ""
echo "Deployed. App on http://127.0.0.1:3000  (nginx serves https://erp.logimart.co.in)"
echo "Check logs:  pm2 logs logimart"
