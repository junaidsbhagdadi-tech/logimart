// Backend copy of the department / feature-grant model. KEEP IN SYNC with the frontend source of
// truth at apps/web/src/features.ts (DEPARTMENT_DEFAULTS) and apps/web/src/rights.ts.
//
// A user's server access to a feature resolves as: explicit per-user featureGrants → their
// department's default map → null (no grant map → fall back to the route's @Roles). Grants are
// ADDITIVE to @Roles in the guard: a grant can admit a request a role wouldn't, never the reverse.

export type Level = 'VIEW' | 'EDIT' | 'DELETE';
export const RANK: Record<Level, number> = { VIEW: 1, EDIT: 2, DELETE: 3 };

// Compact level maps per department. Anything not listed is not granted for that department.
const OPERATIONS: Record<string, Level> = {
  '/': 'VIEW', '/tracker': 'VIEW', '/pincode-search': 'VIEW',
  '/create': 'EDIT', '/awb-list': 'EDIT', '/bulk': 'EDIT', '/deliver': 'EDIT', '/pickups': 'EDIT', '/walk-in': 'EDIT',
  '/fm': 'VIEW', '/fm/pickup-outscan': 'EDIT', '/fm/bulk-pickup-outscan': 'EDIT', '/fm/update-pickup': 'EDIT',
  '/mm': 'VIEW', '/mm/inscan-shipment': 'EDIT', '/mm/bagging': 'EDIT', '/mm/trips': 'EDIT', '/mm/inscan-trip': 'EDIT',
  '/lm': 'VIEW', '/lm/inscan-shipment': 'EDIT', '/lm/inscan-trip': 'EDIT', '/lm/delivery-outscan': 'EDIT',
  '/lm/update-delivery': 'EDIT', '/lm/bulk-delivery-update': 'EDIT', '/lm/manual-scan': 'EDIT',
  '/reports': 'VIEW',
};
const CUSTOMER_SERVICE: Record<string, Level> = {
  '/': 'VIEW', '/team-dashboards': 'VIEW', '/tracker': 'VIEW', '/pincode-search': 'VIEW',
  '/create': 'EDIT', '/awb-list': 'EDIT', '/bulk': 'EDIT', '/pickups': 'EDIT',
  '/customers': 'EDIT', '/claims': 'EDIT', '/documents': 'EDIT', '/notes': 'VIEW', '/invoices': 'VIEW',
  '/reports': 'VIEW',
};
const FINANCE: Record<string, Level> = {
  '/': 'VIEW', '/team-dashboards': 'VIEW', '/tracker': 'VIEW',
  '/invoices': 'DELETE', '/bill-worksheet': 'EDIT', '/sales-mis': 'VIEW', '/receivables': 'EDIT',
  '/notes': 'DELETE', '/claims': 'EDIT', '/customers': 'EDIT', '/vendors': 'EDIT', '/vehicles': 'EDIT',
  '/vendor-bills': 'EDIT', '/documents': 'EDIT', '/expenses': 'EDIT', '/sales': 'VIEW',
  '/ftl-rates': 'VIEW', '/per-box-rates': 'VIEW', '/tax': 'EDIT', '/reports': 'VIEW',
};
const SALES: Record<string, Level> = {
  '/': 'VIEW', '/team-dashboards': 'VIEW', '/tracker': 'VIEW', '/pincode-search': 'VIEW',
  '/create': 'EDIT', '/awb-list': 'VIEW', '/invoices': 'VIEW',
  '/customers': 'EDIT', '/sales': 'EDIT', '/sales-mis': 'VIEW',
  '/ftl-rates': 'VIEW', '/per-box-rates': 'VIEW', '/service-mapping': 'VIEW', '/pincodes': 'VIEW',
  '/reports': 'VIEW',
};

const DEPARTMENT_DEFAULTS: Record<string, Record<string, Level>> = { OPERATIONS, CUSTOMER_SERVICE, FINANCE, SALES };

/** Normalize either grant shape (legacy string[] = full access, or { route: level } map) to a map. */
export function normalizeGrants(g: unknown): Record<string, Level> | null {
  if (!g) return null;
  if (Array.isArray(g)) { const m: Record<string, Level> = {}; for (const k of g) m[String(k)] = 'DELETE'; return m; }
  if (typeof g === 'object') {
    const m: Record<string, Level> = {};
    for (const [k, v] of Object.entries(g as Record<string, unknown>)) { const lv = String(v).toUpperCase(); if (lv in RANK) m[k] = lv as Level; }
    return Object.keys(m).length ? m : null;
  }
  return null;
}

type GrantUser = { department?: string | null; featureGrants?: unknown } | null | undefined;

/** The granted level for a feature: explicit per-user grant → department default → null. MANAGEMENT
 *  and an explicit-full (string[]) grant yield DELETE. null = "no grant covers this" (defer to @Roles). */
export function grantLevelFor(user: GrantUser, feature: string): Level | null {
  if (!user) return null;
  const explicit = normalizeGrants(user.featureGrants);
  if (explicit) return explicit[feature] ?? null;
  if (user.department === 'MANAGEMENT') return 'DELETE'; // full cross-department access
  const dep = user.department && DEPARTMENT_DEFAULTS[user.department] ? DEPARTMENT_DEFAULTS[user.department] : null;
  return dep ? dep[feature] ?? null : null;
}

/** True if a held level satisfies the required level. */
export function meetsLevel(have: Level | null, need: Level): boolean {
  return !!have && RANK[have] >= RANK[need];
}

/** The grant level an HTTP method needs: reads = VIEW, deletes = DELETE, writes = EDIT. */
export function levelForMethod(method: string): Level {
  const m = String(method).toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return 'VIEW';
  if (m === 'DELETE') return 'DELETE';
  return 'EDIT';
}
