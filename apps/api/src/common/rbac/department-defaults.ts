// ============================================================================
// CANONICAL department → feature access map — the SINGLE SOURCE OF TRUTH for RBAC.
// Edit ONLY this file. A verbatim copy is generated to
//   apps/web/src/rbac-departments.generated.ts
// by scripts/gen-rbac.mjs on every web build, so the frontend and backend maps
// can never drift. (MANAGEMENT is derived as full access on both sides, so it is
// intentionally NOT listed here.)
//
// Keys are UI route paths; values are the max level that department grants.
// This file must stay SELF-CONTAINED (no imports) so it copies cleanly to the web.
// ============================================================================
export type DeptLevel = 'VIEW' | 'EDIT' | 'DELETE';

export const DEPARTMENT_DEFAULTS: Record<string, Record<string, DeptLevel>> = {
  OPERATIONS: {
    '/': 'VIEW', '/tracker': 'VIEW', '/pincode-search': 'VIEW',
    '/create': 'EDIT', '/awb-list': 'EDIT', '/bulk': 'EDIT', '/deliver': 'EDIT', '/pickups': 'EDIT', '/walk-in': 'EDIT',
    '/fm': 'VIEW', '/fm/pickup-outscan': 'EDIT', '/fm/bulk-pickup-outscan': 'EDIT', '/fm/update-pickup': 'EDIT',
    '/mm': 'VIEW', '/mm/inscan-shipment': 'EDIT', '/mm/bagging': 'EDIT', '/mm/trips': 'EDIT', '/mm/inscan-trip': 'EDIT',
    '/lm': 'VIEW', '/lm/inscan-shipment': 'EDIT', '/lm/inscan-trip': 'EDIT', '/lm/delivery-outscan': 'EDIT',
    '/lm/update-delivery': 'EDIT', '/lm/bulk-delivery-update': 'EDIT', '/lm/manual-scan': 'EDIT',
    '/reports': 'VIEW',
  },
  CUSTOMER_SERVICE: {
    '/': 'VIEW', '/team-dashboards': 'VIEW', '/tracker': 'VIEW', '/pincode-search': 'VIEW',
    '/create': 'EDIT', '/awb-list': 'EDIT', '/bulk': 'EDIT', '/pickups': 'EDIT',
    '/customers': 'EDIT', '/claims': 'EDIT', '/documents': 'EDIT', '/notes': 'VIEW', '/invoices': 'VIEW',
    '/reports': 'VIEW',
  },
  FINANCE: {
    '/': 'VIEW', '/team-dashboards': 'VIEW', '/tracker': 'VIEW',
    '/invoices': 'DELETE', '/bill-worksheet': 'EDIT', '/sales-mis': 'VIEW', '/receivables': 'EDIT',
    '/notes': 'DELETE', '/claims': 'EDIT', '/customers': 'EDIT', '/vendors': 'EDIT', '/vehicles': 'EDIT',
    '/vendor-bills': 'EDIT', '/documents': 'EDIT', '/expenses': 'EDIT', '/sales': 'VIEW',
    '/ftl-rates': 'VIEW', '/per-box-rates': 'VIEW', '/tax': 'EDIT', '/reports': 'VIEW',
  },
  SALES: {
    '/': 'VIEW', '/team-dashboards': 'VIEW', '/tracker': 'VIEW', '/pincode-search': 'VIEW',
    '/create': 'EDIT', '/awb-list': 'VIEW', '/invoices': 'VIEW',
    '/customers': 'EDIT', '/sales': 'EDIT', '/sales-mis': 'VIEW',
    '/ftl-rates': 'VIEW', '/per-box-rates': 'VIEW', '/service-mapping': 'VIEW', '/pincodes': 'VIEW',
    '/reports': 'VIEW',
  },
};
