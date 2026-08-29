#!/usr/bin/env bash
# ============================================================================
#  Logimart ERP — auto-deploy poller.
#  Run from cron (every minute). When origin/main has a new commit, it runs
#  deploy/app-deploy.sh (pull → build → pm2 restart). A flock prevents
#  overlapping builds; all output is appended to deploy.log.
#     * * * * * /bin/bash /root/logimart/deploy/auto-deploy.sh >/dev/null 2>&1
# ============================================================================
set -euo pipefail

REPO="${REPO:-$HOME/logimart}"
BRANCH="${BRANCH:-main}"
LOG="$REPO/deploy.log"
LOCK="$REPO/.autodeploy.lock"

# Only one deploy at a time — if a build is already running, skip this tick.
exec 9>"$LOCK"
flock -n 9 || exit 0

cd "$REPO"
git fetch origin "$BRANCH" --quiet || exit 0
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" != "$REMOTE" ]; then
  {
    echo ""
    echo "=== $(date -u '+%Y-%m-%d %H:%M:%S UTC') — new commit $REMOTE, deploying ==="
  } >> "$LOG"
  bash deploy/app-deploy.sh >> "$LOG" 2>&1 && echo "=== deploy OK ===" >> "$LOG" || echo "=== deploy FAILED (old build still running) ===" >> "$LOG"
fi
