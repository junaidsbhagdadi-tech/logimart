# Deploy Logimart ERP on DigitalOcean (brand-new, standalone)

One **App** (API + portal in a single service) + one **managed PostgreSQL**.
**No Vercel / no separate frontend host** — the NestJS server serves the React portal.

---

## Option A — DigitalOcean dashboard (no CLI)

1. **Create the app**
   - DO dashboard → **Apps** → **Create App** → **GitHub** → authorize → pick the repo (`logimart-erp`) → branch `main` → **Autodeploy on push: on**.
   - It detects **Node.js**. Set:
     - **Build command:** `npm run build`
     - **Run command:** `npm start`
     - **HTTP port:** `8080`
     - **Health check path:** `/health`
     - **Instance size:** Basic — **1 GB RAM** (the build needs it; 512 MB can OOM).

2. **Add the database**
   - In the app's **Resources** → **Create/Attach Database** → **Dev Database (PostgreSQL 16)** (or a Managed cluster for production).
   - Name it `db`. DO auto-creates a `DATABASE_URL` you can bind.

3. **Environment variables** (app → Settings → App-Level / Component env):
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | bind to the DB → `${db.DATABASE_URL}` |
   | `JWT_SECRET` | a long random string (mark **encrypted**) |
   | `VOLUMETRIC_DIVISOR` | `5000` |
   | `COMPANY_GSTIN` | the company GSTIN |
   | `COMPANY_STATE_CODE` | GSTIN state code (e.g. `29`) |
   | `NODE_ENV` | `production` |

4. **Deploy.** First build ~3–5 min. When healthy, DO gives a URL like
   `https://logimart-erp-xxxx.ondigitalocean.app`.

5. **Seed the data (once)** — app → **Console** →
   ```
   cd apps/api && npm run seed
   ```
   (creates roles/users, hubs, demo client, and the pincode directory)

6. **Custom domain (optional)** — app → **Settings → Domains** → add
   `erp.<company>.com` → add the shown CNAME at your DNS → free HTTPS.

---

## Option B — `doctl` CLI (uses .do/app.yaml)

```bash
# install doctl + authenticate (one time)
doctl auth init

# edit .do/app.yaml: set the repo, JWT_SECRET, COMPANY_GSTIN, region
doctl apps create --spec .do/app.yaml

# after it's live, seed:
doctl apps list                       # get the app id
doctl apps console <app-id> --command "cd apps/api && npm run seed"
```

---

## Notes
- **Branding:** company name / GSTIN / address live in `apps/api/src/config/company.ts`
  and `apps/web/src/company.ts`; the logo is `apps/web/public/logo.svg` (or drop
  `logo.png`). Change these for a different company, redeploy.
- **WhatsApp** stays off until you set `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID`.
- **This is fully independent** of any Railway deployment — its own DB, own URL.
- Switch the dev DB to a **Managed PostgreSQL cluster** before real production
  (daily backups, standby). The app needs no code change — just repoint `DATABASE_URL`.
