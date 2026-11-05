/**
 * Team-dashboard filters: several vendors and/or several customers (comma-separated in the query string).
 * Returns a where-fragment: `clientId` (respecting a branch/company scope) + an `AND` holding the vendor OR.
 * "SELF" = own network (no vendor or vendor SELF).
 */
export function dashFilterWhere(vendor?: string | null, clientId?: string | null, scope?: bigint[] | null) {
  const w: any = {};
  const vs = String(vendor ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (vs.length) {
    const or: any[] = vs.filter((v) => v.toUpperCase() !== 'SELF').map((v) => ({ vendor: { equals: v, mode: 'insensitive' } }));
    if (vs.some((v) => v.toUpperCase() === 'SELF')) or.push({ vendor: null }, { vendor: { equals: 'SELF', mode: 'insensitive' } });
    w.AND = [{ OR: or }];
  }
  const ids = String(clientId ?? '').split(',').map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).map((x) => BigInt(x));
  if (ids.length) w.clientId = ids.length === 1 ? ids[0] : { in: ids };
  if (scope) w.clientId = ids.length ? { in: ids.filter((i) => scope.includes(i)) } : { in: scope };
  return w;
}
