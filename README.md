# Logimart ERP — B2B Surface & Air Cargo Platform

Standalone B2B logistics ERP for **Logimart** (Surface + Domestic Air cargo).
Multi-Piece Shipment (MPS) aware, offline-first mobile scanning, corporate
invoicing & credit. **No cash COD** — instead **To-Pay / Freight Collect** and
**DOD (Draft on Delivery)**.

> **Origin:** this repo was **seeded from the Akul ERP** codebase (a proven
> ~80%-complete B2B logistics ERP) as a blueprint, then rebranded for Logimart.
> It is an independent project with its own repo, server, and database — Akul ERP
> stays separate and untouched.

## Logimart-specific deltas vs the Akul blueprint (to build)

- **No cash COD** (Akul already has none — good).
- **To-Pay / Freight Collect** — the *freight charge* (not goods value) is
  collected from the **consignee at delivery**; a payment-term on the shipment
  (Prepaid vs To-Pay) plus freight-collected reconciliation. _(new)_
- **DOD (Draft on Delivery)** — a **cheque/DD collected before the shipment is
  released** (air + surface LTL): delivery gate + instrument capture + handover
  of the draft to the consignor. _(new)_
- **Identity/config** rebranded to Logimart (`apps/api/src/config/company.ts` —
  placeholders pending real details).
- **Air = a service mode** (AIR_EXPRESS / AIR_ECONOMY), not air-freight
  forwarding — no MAWB/HAWB / airline booking / ULD / customs.

See `docs/` and the functional inputs checklist for what's still needed.

## Stack

| Layer | Choice |
|---|---|
| API server | NestJS (TypeScript) |
| Database | PostgreSQL 16 |
| ORM / migrations | Prisma |
| Queue / idempotency cache | Redis + BullMQ |
| Object storage (POD photos, labels) | S3-compatible (MinIO locally) |
| Auth / RBAC | JWT + NestJS guards |
| Web portal | React (Vite) — `apps/web` |
| Mobile | Flutter — `apps/mobile` |

## Local development (free — all local)

```bash
# 1. start infra (Postgres + Redis + MinIO)
docker compose up -d

# 2. API
cd apps/api
cp ../../.env.example .env
npm install
npx prisma db push        # create schema in the dev DB
npm run seed              # roles, demo client, rate card
npm run start:dev         # http://localhost:3000
```

## Repo layout

```
Logimart ERP/
├─ docker-compose.yml        # Postgres + Redis + MinIO for local dev
├─ .env.example
└─ apps/
   ├─ api/                   # NestJS backend
   │  ├─ prisma/schema.prisma
   │  └─ src/
   │     ├─ config/company.ts          # Logimart identity (labels/invoices)
   │     ├─ common/rbac/               # roles decorator + guard
   │     └─ modules/                   # shipments, scans, billing, ... (27 modules)
   ├─ web/                   # React portal
   └─ mobile/                # Flutter scanner app
```

## Core design (inherited from the blueprint)

- **Scans are append-only immutable events.** Piece & AWB status is a
  **projection** recomputed from the ordered event log — never last-write-wins.
- **Idempotency** via device-generated `clientEventId` (UNIQUE). Network replays
  are safe no-ops.
- **Out-of-order sync** — events sorted by device `scannedAt` and replayed through
  a checkpoint state machine; impossible jumps raise an exception flag instead of
  corrupting state.
- **Volumetric divisor = 5000.** `volKg = L*W*H / 5000` (cm).

See `apps/api/src/modules/scans/` for the ingestion + projector.
