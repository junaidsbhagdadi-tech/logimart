#!/usr/bin/env bash
# ============================================================================
#  Logimart ERP — DigitalOcean provisioning (APP DROPLET ONLY)
#  Use this when Postgres lives on a DO *Managed Database* (NOT on this box).
#  Installs Node, nginx, pm2, certbot and the Postgres CLIENT (for pg_restore).
#  It does NOT install or create a local Postgres server.
#
#  Run on the droplet as a sudo-capable user:
#     DOMAIN=erp.example.com EMAIL=you@example.com bash deploy/server-setup-do.sh
#  Leave DOMAIN unset to serve plain HTTP on the droplet IP (add TLS later).
# ============================================================================
set -euo pipefail

DOMAIN="${DOMAIN:-}"                       # optional — blank = HTTP on the IP
EMAIL="${EMAIL:-admin@logimart.co.in}"     # for Let's Encrypt

echo "==> System packages"
sudo apt-get update
sudo apt-get install -y curl git ufw nginx postgresql-client

echo "==> Node.js 20 LTS + pm2"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

echo "==> Firewall (SSH + HTTP + HTTPS)"
sudo ufw allow OpenSSH || true
sudo ufw allow 'Nginx Full' || true
sudo ufw --force enable || true

echo "==> nginx reverse proxy -> 127.0.0.1:3000"
SERVER_NAME="${DOMAIN:-_}"
sudo tee /etc/nginx/sites-available/logimart >/dev/null <<NGINX
server {
    listen 80;
    server_name ${SERVER_NAME};
    client_max_body_size 25m;   # POD images / labels stream through the API as data-URIs
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/logimart /etc/nginx/sites-enabled/logimart
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

if [ -n "${DOMAIN}" ]; then
  echo "==> HTTPS via Let's Encrypt for ${DOMAIN} (DNS must already point here)"
  sudo apt-get install -y certbot python3-certbot-nginx
  sudo certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${EMAIL}" --redirect || \
    echo "certbot skipped — run 'sudo certbot --nginx -d ${DOMAIN}' once DNS resolves."
else
  echo "==> No DOMAIN set — serving HTTP on the droplet IP. Add TLS later with certbot."
fi

echo ""
echo "App-droplet provisioning done (no local Postgres — using DO Managed DB)."
echo "Next:"
echo "  1. cp deploy/env.production.template apps/api/.env   # set DATABASE_URL to the MANAGED cluster URL (?sslmode=require)"
echo "  2. Restore the dump into the managed DB:"
echo "       pg_restore --no-owner --no-privileges -d \"<MANAGED_DATABASE_URL>\" ~/logimart-render.dump"
echo "  3. bash deploy/app-deploy.sh"
