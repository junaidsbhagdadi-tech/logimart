// Backend copy of the department / feature-grant model. KEEP IN SYNC with the frontend source of
// truth at apps/web/src/features.ts (DEPARTMENT_DEFAULTS) and apps/web/src/rights.ts.
//
// A user's server access to a feature resolves as: explicit per-user featureGrants → their
// department's default map → null (no grant map → fall back to the route's @Roles). Grants are
// ADDITIVE to @Roles in the guard: a grant can admit a request a role wouldn't, never the reverse.

import { DEPARTMENT_DEFAULTS } from './department-defaults'; // ← single source of truth (see that file)

export type Level = 'VIEW' | 'EDIT' | 'DELETE';
export const RANK: Record<Level, number> = { VIEW: 1, EDIT: 2, DELETE: 3 };

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

/** The granted level for a feature. The department default is the BASE; a per-user grant OVERRIDES
 *  it for that one feature. (Previously an explicit grant replaced the whole department map, which
 *  silently wiped a person's department access if they had any per-user grant at all.) MANAGEMENT =
 *  full. null = "no grant covers this" → defer to @Roles. */
export function grantLevelFor(user: GrantUser, feature: string): Level | null {
  if (!user) return null;
  if (user.department === 'MANAGEMENT') return 'DELETE'; // full cross-department access
  const dep = (user.department && DEPARTMENT_DEFAULTS[user.department]) || null;
  const explicit = normalizeGrants(user.featureGrants);
  return (explicit && explicit[feature]) ?? (dep && dep[feature]) ?? null;
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
