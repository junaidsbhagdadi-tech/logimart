#!/usr/bin/env bash
# ============================================================================
#  Logimart ERP — ONE-TIME server provisioning  (Ubuntu 22.04 / 24.04)
#  Run on the target server (200.141.8.30) as a sudo-capable user.
#     bash server-setup.sh
#  Edit DB_PASS below FIRST.
# ============================================================================
set -euo pipefail

DB_PASS="CHANGE_ME_DB_PASS"      # <-- set a strong password; must match apps/api/.env
DOMAIN="erp.logimart.co.in"

echo "==> System packages"
sudo apt-get update
sudo apt-get install -y curl git ufw nginx postgresql postgresql-contrib

echo "==> Node.js 20 LTS + pm2"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

echo "==> Postgres database + user"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'logimart') THEN
    CREATE ROLE logimart LOGIN PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SELECT 'CREATE DATABASE logimart_erp OWNER logimart'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'logimart_erp')\gexec
GRANT ALL PRIVILEGES ON DATABASE logimart_erp TO logimart;
SQL

echo "==> Firewall (SSH + HTTP + HTTPS)"
sudo ufw allow OpenSSH || true
sudo ufw allow 'Nginx Full' || true
sudo ufw --force enable || true

echo "==> nginx site"
sudo cp "$(dirname "$0")/nginx-erp.conf" /etc/nginx/sites-available/logimart
sudo ln -sf /etc/nginx/sites-available/logimart /etc/nginx/sites-enabled/logimart
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "==> HTTPS via Let's Encrypt (needs DNS ${DOMAIN} -> this server first)"
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m admin@logimart.co.in --redirect || \
  echo "certbot skipped — run 'sudo certbot --nginx -d ${DOMAIN}' once DNS resolves."

echo ""
echo "Provisioning done."
echo "DATABASE_URL=postgresql://logimart:${DB_PASS}@localhost:5432/logimart_erp?schema=public"
echo "Next: clone the repo, create apps/api/.env, then run deploy/app-deploy.sh"
