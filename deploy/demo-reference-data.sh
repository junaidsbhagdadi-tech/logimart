#!/usr/bin/env bash
# Copy the GENERIC reference data the demo needs from production into the demo database: the pincode
# directory (public geography) and generic masters (zones, charge heads, product list, settings, own-network
# transit times). Nothing customer-, carrier- or company-specific is copied; carrier transit tables are
# re-created under the fictional carrier codes.
set -euo pipefail
PROD_URL=$(grep -E '^DATABASE_URL=' /root/logimart/apps/api/.env | head -1 | cut -d= -f2- | tr -d '"')
DEMO_URL=$(grep -E '^DATABASE_URL=' /root/demo-erp/apps/api/.env | head -1 | cut -d= -f2- | tr -d '"')
case "$DEMO_URL" in *demo*) ;; *) echo "Refusing: demo DATABASE_URL is not a demo database."; exit 1;; esac
TMP=$(mktemp -d)

cols() { psql "$1" -Atc "select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='$2' and column_name <> 'id'"; }

echo "==> pincode directory"
PC=$(cols "$DEMO_URL" pincodes)
psql "$PROD_URL" -qc "\\copy (select $PC from pincodes) to '$TMP/pins.csv' csv"
psql "$DEMO_URL" -qc "truncate pincodes" -qc "\\copy pincodes ($PC) from '$TMP/pins.csv' csv"

echo "==> generic masters"
MC=$(cols "$DEMO_URL" master_entries)
psql "$PROD_URL" -qc "\\copy (select $MC from master_entries where type in ('ZONE','CHARGE','INSTRUCTION','PRODUCT_TYPE','SETTING','PRODUCT') or (type='FUEL_MECHANISM' and code='AIRFUEL_SELF') or (type='ZONE_TAT' and code in ('SELF__APEX','SELF__SURFACE'))) to '$TMP/masters.csv' csv"
psql "$DEMO_URL" -qc "\\copy master_entries ($MC) from '$TMP/masters.csv' csv"
psql "$DEMO_URL" -q <<'SQL'
update master_entries set name = 'PREMIUM EXPRESS' where type = 'PRODUCT' and name ilike '%dtdc%';
update master_entries set name = 'Air Fuel — own network' where type = 'FUEL_MECHANISM';
-- transit-time matrices for the fictional carriers (copies of the own-network tables)
insert into master_entries (type, code, name, attrs, active, "updatedAt")
select 'ZONE_TAT', v || '__' || split_part(code, '__', 2), v || ' ' || split_part(code, '__', 2) || ' TAT (days)', jsonb_set(attrs::jsonb, '{vendor}', to_jsonb(v)), active, now()
from master_entries, unnest(array['SKY','RDW','PJT','MRD','VTX']) v
where type = 'ZONE_TAT' and code in ('SELF__APEX', 'SELF__SURFACE')
on conflict do nothing;
SQL
rm -rf "$TMP"
echo "    $(psql "$DEMO_URL" -Atc "select count(*) from pincodes") pincodes, $(psql "$DEMO_URL" -Atc "select count(*) from master_entries") masters"
