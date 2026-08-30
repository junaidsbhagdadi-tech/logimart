// Per-user CRUD rights, layered on the existing feature-grant allow-list.
//
// featureGrants can be either:
//   • legacy string[]           — each granted feature = FULL access (view+edit+delete)
//   • map { [to]: Level }        — per-feature level: 'VIEW' | 'EDIT' | 'DELETE'
// Level hierarchy: DELETE ⊃ EDIT ⊃ VIEW. A user with no featureGrants (null) uses role
// defaults = full access on every page their role shows (unchanged behaviour).
//
// This is enforced in the UI (consistent with how feature visibility already works). The
// API's @Roles gates remain the hard security boundary.
import { useAuth } from './auth';

export type Level = 'VIEW' | 'EDIT' | 'DELETE';
const RANK: Record<Level, number> = { VIEW: 1, EDIT: 2, DELETE: 3 };

export type Grants = string[] | Record<string, Level> | null | undefined;
export type Rights = { view: boolean; edit: boolean; del: boolean; level: Level | null };

/** Normalize either grant shape to a { to: Level } map, or null when there are no custom grants. */
export function normalizeGrants(g: Grants): Record<string, Level> | null {
  if (!g) return null;
  if (Array.isArray(g)) { const m: Record<string, Level> = {}; for (const k of g) m[k] = 'DELETE'; return m; }
  const m: Record<string, Level> = {};
  for (const [k, v] of Object.entries(g)) { const lv = String(v).toUpperCase(); if (lv in RANK) m[k] = lv as Level; }
  return m;
}

/** Is this feature visible at all (view+) for these grants? null grants = role default (visible). */
export function hasFeature(g: Grants, to: string): boolean {
  const m = normalizeGrants(g);
  return m ? !!m[to] : true;
}

const FULL: Rights = { view: true, edit: true, del: true, level: 'DELETE' };

/** Resolve a user's rights for a feature. Admin/super/client = full; no custom grants = full. */
export function rightsForUser(user: { role?: string; featureGrants?: Grants } | null, to: string): Rights {
  if (!user) return { view: false, edit: false, del: false, level: null };
  if (user.role === 'SYS_ADMIN' || user.role === 'ADMIN' || user.role === 'CLIENT_ADMIN') return FULL;
  const m = normalizeGrants(user.featureGrants);
  if (!m) return FULL; // role defaults — unchanged full access on visible pages
  const lvl = m[to];
  if (!lvl) return { view: false, edit: false, del: false, level: null };
  return { view: RANK[lvl] >= 1, edit: RANK[lvl] >= 2, del: RANK[lvl] >= 3, level: lvl };
}

/** Hook: rights for the current user on a feature key (the page's route path, e.g. '/customers'). */
export function useRights(to: string): Rights {
  const { user } = useAuth();
  return rightsForUser(user as any, to);
}
