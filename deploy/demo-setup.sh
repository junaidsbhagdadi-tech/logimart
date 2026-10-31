#!/usr/bin/env bash
# ONE-TIME setup of the sales demo on this droplet: demo database (same Postgres cluster, separate database),
# a clean .env (NO carrier / email / storage / WhatsApp credentials — the demo can't reach anyone), nginx +
# HTTPS for the demo hostname. Then builds and seeds via demo-deploy.sh --reseed.
#   DEMO_HOST=demo.example.com bash deploy/demo-setup.sh     (default host: demo.<ip>.sslip.io)
set -euo pipefail
DEMO=/root/demo-erp
HOST=${DEMO_HOST:-demo.168-144-77-53.sslip.io}
PROD_URL=$(grep -E '^DATABASE_URL=' /root/logimart/apps/api/.env | head -1 | cut -d= -f2- | tr -d '"')
DEMO_URL=$(echo "$PROD_URL" | sed -E 's#/([^/?]+)(\?|$)#/demo_erp\2#')

echo "==> Demo database"
psql "$PROD_URL" -Atc "select 1 from pg_database where datname='demo_erp'" | grep -q 1 || psql "$PROD_URL" -qc "CREATE DATABASE demo_erp"

echo "==> Code + clean .env"
mkdir -p "$DEMO/apps/api"
rsync -a --exclude .git --exclude apps/api/.env --exclude apps/mobile /root/logimart/ "$DEMO/"
if [ ! -f "$DEMO/apps/api/.env" ]; then
  umask 077
  cat > "$DEMO/apps/api/.env" <<EOF
NODE_ENV=production
PORT=3100
DATABASE_URL="$DEMO_URL"
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRES_IN=12h
APP_URL=https://$HOST
AWB_PREFIX=D
COMPANY_GSTIN=07AAACN1234Q1Z5
COMPANY_STATE_CODE=07
DIGEST_AUTOSEND=false
DAILY_SUMMARY=false
DOC_PURGE_DAYS=7
EOF
fi

echo "==> nginx + HTTPS for $HOST"
cat > /etc/nginx/sites-available/demo-erp <<EOF
server {
  listen 80;
  server_name $HOST;
  client_max_body_size 25m;
  gzip on; gzip_types text/plain text/css application/json application/javascript text/javascript image/svg+xml;
  location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 300s;
  }
}
EOF
ln -sf /etc/nginx/sites-available/demo-erp /etc/nginx/sites-enabled/demo-erp
nginx -t && systemctl reload nginx
certbot --nginx -d "$HOST" --non-interactive --agree-tos --register-unsafely-without-email --redirect || echo "!! HTTPS certificate failed — the demo still works on http://$HOST"

bash "$DEMO/deploy/demo-deploy.sh" --reseed
