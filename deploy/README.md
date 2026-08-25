# Deploying Logimart ERP to a single Ubuntu server

Target in this guide: **`erp.logimart.co.in`** on **`200.141.8.30`** (user `erpdeploy`).
The whole ERP is **one Node process** (NestJS API on `:3000` that also serves the built React
portal), plus **Postgres** on the same box. nginx terminates HTTPS and proxies to `:3000`.

---

## 0. DNS (do this first)
Point an **A record** for `erp.logimart.co.in` → `200.141.8.30` at the domain registrar.
Verify before running certbot: `dig +short erp.logimart.co.in` should return `200.141.8.30`.

## 1. Provision the server (one time)
SSH in and run the setup script (edit `DB_PASS` inside it first):
```
ssh erpdeploy@200.141.8.30
# copy this repo's deploy/ folder up, or clone the repo (step 2) first, then:
bash deploy/server-setup.sh
```
This installs Node 20, Postgres, nginx, pm2, certbot; creates the `logimart_erp` database;
configures the firewall + nginx; and requests the HTTPS certificate.

## 2. Get the code onto the server
Preferred — a **read-only GitHub deploy key** so the partner can pull updates:
```
ssh-keygen -t ed25519 -C "logimart-deploy" -f ~/.ssh/logimart_deploy -N ""
cat ~/.ssh/logimart_deploy.pub    # add this in GitHub → repo → Settings → Deploy keys (read-only)
git clone git@github.com:junaidsbhagdadi-tech/logimart.git ~/logimart
```
(Alternative: build locally and `rsync` the folder up — but a clone makes future updates one command.)

## 3. Configure secrets
```
cp ~/logimart/deploy/env.production.template ~/logimart/apps/api/.env
nano ~/logimart/apps/api/.env      # fill DB_PASS, JWT_SECRET (openssl rand -hex 32), GSTIN, keys
```

## 4. Migrate the master data (THE important step)
The code alone boots an **empty** ERP. The real value — ~21k pincodes with per-product zones,
rate cards, products, charges, vendors, EDL matrix, zone-TAT, settings — lives in the **current
database**, not in git. Copy it across:
```
# On a machine that can reach the CURRENT (Render) DB — dump the whole database:
pg_dump "<CURRENT_DATABASE_URL>" --no-owner --no-privileges -Fc -f logimart.dump

# Copy it up and restore into the fresh DB (schema + data together):
scp logimart.dump erpdeploy@200.141.8.30:~/
psql "postgresql://logimart:<DB_PASS>@localhost:5432/logimart_erp" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
pg_restore --no-owner --no-privileges -d "postgresql://logimart:<DB_PASS>@localhost:5432/logimart_erp" logimart.dump
```
Because the dump's schema was produced by the same `schema.prisma`, the `prisma db push` in the
next step is a no-op — it won't alter anything.

> Don't want to hand over your live shipments/invoices? Dump only the reference tables instead
> (`-t pincode -t master_entry -t customer_rate_card -t customer_rate_card_slab -t vendor -t edl_rate -t hub -t ftl_rate`)
> and skip the DROP SCHEMA line.

## 5. Build & start
```
bash ~/logimart/deploy/app-deploy.sh
```
Builds everything, runs `prisma db push` (no-op after step 4), and starts the app under pm2
(auto-restart on reboot). Re-run this same script for every future update.

## 6. Verify
```
pm2 logs logimart          # should show "listening on :3000"
curl -I https://erp.logimart.co.in
```

---

## First-time login
If you did **not** migrate data (fresh start), seed base users once:
```
cd ~/logimart/apps/api && npx ts-node prisma/seed.ts
```
Seed admin: `admin@logimart.com` / `logimart1234` — **change this password immediately.**
If you migrated the database (step 4), use your existing accounts.

## Updating later
```
cd ~/logimart && bash deploy/app-deploy.sh
```

## Notes
- Optional integrations (BlueDart, WhatsApp) are off unless their keys are set in `apps/api/.env`.
- POD images currently live in Postgres; plan to move them to object storage (e.g. DO Spaces) later.
- Backups: schedule `pg_dump` of `logimart_erp` (cron) — it holds all the master data + transactions.
