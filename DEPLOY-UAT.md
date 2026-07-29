# Logimart ERP — UAT Deployment Runbook

Goal: a **shared URL** the team opens in any browser to test — no installs on their
machines, everyone on the same data. This is the single source of truth for deploying;
older deploy notes were consolidated into this file.

## Architecture (why it's simple)

- **One service** deploys the whole app: the NestJS API also serves the built React
  portal (`ServeStaticModule` → `apps/web/dist`). **No separate frontend host / Vercel.**
- **Postgres is the only external dependency.** The app uses **no Redis** and **no S3/
  object store** — POD photos & labels are stored in Postgres (`Upload` table).
- Build = `npm run build` (builds API + portal). Start = `npm start`
  (`prisma db push` then `node dist/main.js`). Health check = `GET /health`.
- The portal calls the API **same-origin**, so no web env config is needed in prod.

## ⚠️ Steps only you can do (I can't create accounts or enter credentials)

1. **Create a GitHub repo** and push this project to it (commands at the bottom).
2. **Open/log in to the cloud account** (DigitalOcean or Railway) and authorize GitHub.
3. **Enter the secrets** (`JWT_SECRET`, etc.) in the host's dashboard.

Everything else below is click-through. Rough cost: a hobby app + small managed/dev
Postgres ≈ a few USD/month.

---

## Path A — DigitalOcean (recommended: single app + managed Postgres)

### A1. Dashboard (no CLI)
1. **Apps → Create App → GitHub →** authorize → pick your `logimart-erp` repo →
   branch **`main`** → *Autodeploy on push: on*.
2. It detects **Node.js**. Set:
   - Build command: `npm run build`
   - Run command: `npm start`
   - HTTP port: `8080`
   - Health check path: `/health`
   - Instance size: **Basic — 1 GB RAM** (the Vite+Nest build can OOM on 512 MB).
3. **Resources → Create/Attach Database → Dev Database (PostgreSQL 16)**, name it `db`.
   Bind `DATABASE_URL` → `${db.DATABASE_URL}`.
4. **Env vars** (see the secrets table below), then **Deploy** (~3–5 min).
5. When healthy, DO gives a URL like `https://logimart-erp-xxxx.ondigitalocean.app`.
6. **Seed once:** app → **Console** → `cd apps/api && npm run seed`.

### A2. CLI (uses `.do/app.yaml`, which is already configured)
```bash
doctl auth init
# edit .do/app.yaml: set repo slug, JWT_SECRET, COMPANY_GSTIN
doctl apps create --spec .do/app.yaml
doctl apps list                       # get the app id
doctl apps console <app-id> --command "cd apps/api && npm run seed"
```

---

## Path B — Railway (single service + Postgres plugin)

1. **New Project → Deploy from GitHub repo →** pick `logimart-erp`.
2. Add the **PostgreSQL** plugin — Railway injects `DATABASE_URL` automatically.
   (Do **not** add Redis — it isn't used.)
3. Service **Variables**: set `JWT_SECRET`, `VOLUMETRIC_DIVISOR=5000`,
   `COMPANY_GSTIN`, `COMPANY_STATE_CODE`.
4. Railway reads `railway.json` (build `npm run build`, start `npm start`,
   healthcheck `/health`).
5. After first deploy, seed from the Railway shell: `cd apps/api && npm run seed`.

---

## Secrets / env vars

| Key | Value | Notes |
|---|---|---|
| `DATABASE_URL` | bound to the managed DB | DO: `${db.DATABASE_URL}`; Railway: auto |
| `JWT_SECRET` | a long random string | **mark secret/encrypted** |
| `VOLUMETRIC_DIVISOR` | `5000` | chargeable-weight divisor |
| `COMPANY_GSTIN` | Logimart's GSTIN | replace the `TODO_LOGIMART_GSTIN` placeholder |
| `COMPANY_STATE_CODE` | e.g. `29` | GSTIN state code (29 = Karnataka) |
| `NODE_ENV` | `production` | |

`VITE_API_URL` is **not** set in prod (portal is served same-origin).

## Seeded demo logins (after `npm run seed`)

Password for all: **`logimart1234`**

| Email | Role |
|---|---|
| `admin@logimart.com` | Sys Admin |
| `hub@logimart.com` | Hub Manager |
| `warehouse@logimart.com` | Warehouse |
| `driver@logimart.com` | Driver |
| `finance@logimart.com` | Finance |

The seed also loads hubs, a demo client, a rate card, and the pincode directory.

## Smoke test (replace `<host>`)
```bash
curl https://<host>/health
curl -X POST https://<host>/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@logimart.com","password":"logimart1234"}'
```

## Later / production hardening
- **Managed Postgres cluster** (backups, standby) instead of the dev DB — just
  repoint `DATABASE_URL`, no code change.
- **Custom domain:** host settings → Domains → add `erp.logimart…` → set the shown
  CNAME → free HTTPS.
- **Migrations:** UAT uses `prisma db push`. Before real production, generate
  `prisma migrate` files and switch the start command to `prisma migrate deploy`.

---

## First-time push to GitHub
```bash
cd "Logimart ERP"
# (repo is already initialised and committed on branch feat/logimart-uat / main)
git remote add origin git@github.com:<your-org>/logimart-erp.git
git push -u origin main
```
