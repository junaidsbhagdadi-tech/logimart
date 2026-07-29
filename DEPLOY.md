# Deployment — UAT → Production

Topology: **API + Postgres + Redis on Railway**, **web portal on Vercel**.

## 1. Railway (API + Postgres + Redis) — UAT

1. Push this repo to GitHub (see bottom).
2. In Railway: **New Project → Deploy from GitHub repo**, pick this repo.
3. Add plugins to the project: **PostgreSQL** and **Redis**. Railway injects
   `DATABASE_URL` and a Redis URL automatically.
4. Set service variables (Railway → service → Variables):
   - `JWT_SECRET` = a long random string
   - `REDIS_URL` = the injected Redis connection string
   - `VOLUMETRIC_DIVISOR` = `5000`
   - S3 vars (`S3_*`) once an object store is provisioned (POD photos/labels).
5. Railway reads `railway.json`:
   - **build:** `npm install && prisma generate && npm run build`
   - **start:** `prisma db push --accept-data-loss && npm run start:prod`
   - **healthcheck:** `GET /health`
6. After first deploy, seed once from the Railway shell:
   `cd apps/api && npm run seed`
7. Smoke test (replace host):
   ```bash
   curl https://<service>.up.railway.app/health
   # login -> grab accessToken
   curl -X POST https://<host>/api/v1/auth/login \
     -H 'content-type: application/json' \
     -d '{"email":"admin@akullogistics.com","password":"akul1234"}'
   ```

### UAT vs Production schema strategy
- **UAT** uses `prisma db push` — fast, no migration files, fine while the
  schema is still moving. `--accept-data-loss` is safe on a throwaway UAT DB.
- **Production**: switch to proper migrations before go-live. Once you have a
  database to point at, run locally:
  ```bash
  cd apps/api && npx prisma migrate dev --name init
  ```
  commit the generated `prisma/migrations/`, then change the Railway start
  command back to `prisma migrate deploy && npm run start:prod`. This removes
  `--accept-data-loss` and gives you reviewable, reversible schema history.

## 2. Vercel (web portal) — added later

The React client/admin portal will live in `apps/web` and deploy to Vercel,
pointing at the Railway API base URL via `NEXT_PUBLIC_API_URL` (or Vite env).
Not yet scaffolded — backend-first per the roadmap.

## 3. Production cutover
1. Promote a separate Railway **production** environment (own Postgres/Redis).
2. Switch start command to `prisma migrate deploy`.
3. Point the production domain; flip the portal's API URL to production.
4. Decommission UAT or keep it as staging.

## Push to GitHub
```bash
cd "Akul ERP"
git init && git add . && git commit -m "chore: scaffold Akul ERP (NestJS + Prisma)"
git branch -M main
git remote add origin git@github.com:<org>/akul-erp.git
git push -u origin main
```
