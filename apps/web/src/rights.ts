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
//
// Resolution order for a staff user's access to a page:
//   1. explicit per-user featureGrants (super admin override)  →  else
//   2. their DEPARTMENT's default feature map                  →  else
//   3. role defaults (full access on pages the role shows)      (back-compat: no dept, no grants)
import { useAuth } from './auth';
import { departmentGrants } from './features';

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

type AccessUser = { role?: string; department?: string | null; featureGrants?: Grants } | null;

/** The effective grant map for a user (explicit grants → department defaults → null=role default).
 *  null means "no restriction map applies" — nav falls back to role visibility, rights to FULL. */
export function effectiveGrants(user: AccessUser): Record<string, Level> | null {
  if (!user) return null;
  // ADMIN / super admin / client admin are governed by role, not department — full access (ADMIN
  // inherits everything server-side, so it must not be frontend-restricted by a stray grant/dept).
  if (user.role === 'ADMIN' || user.role === 'SYS_ADMIN' || user.role === 'CLIENT_ADMIN') return null;
  // A per-user override REPLACES the department default (this is what the Users → 🔑 Features dialog
  // promises: "None hides it", "Empty + Save hides everything"). The dialog seeds itself from the
  // department default, so a saved override is a COMPLETE map — setting one feature to None removes
  // only that feature, never the rest. With no override we fall back to the department default, and
  // with neither we return null (role defaults / full).
  const explicit = normalizeGrants(user.featureGrants);
  if (explicit) return explicit;
  return normalizeGrants(departmentGrants(user.department));
}

/** Resolve a user's rights for a feature. Super/client = full; else explicit grant → department
 *  default → role default (full on visible pages). */
export function rightsForUser(user: AccessUser, to: string): Rights {
  if (!user) return { view: false, edit: false, del: false, level: null };
  if (user.role === 'ADMIN' || user.role === 'SYS_ADMIN' || user.role === 'CLIENT_ADMIN') return FULL;
  const m = effectiveGrants(user);
  if (!m) return FULL; // no explicit grants and no department → role defaults (unchanged behaviour)
  const lvl = m[to];
  if (!lvl) return { view: false, edit: false, del: false, level: null };
  return { view: RANK[lvl] >= 1, edit: RANK[lvl] >= 2, del: RANK[lvl] >= 3, level: lvl };
}

/** Hook: rights for the current user on a feature key (the page's route path, e.g. '/customers'). */
export function useRights(to: string): Rights {
  const { user } = useAuth();
  return rightsForUser(user as any, to);
}
