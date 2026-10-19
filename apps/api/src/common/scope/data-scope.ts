import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * #10 — location / company-wise data scope for internal staff.
 * A user's `branches` + `companyCodes` (set on the Users screen) limit which CUSTOMERS — and so which
 * shipments, invoices, sales and ops rows — they see. Empty lists = unrestricted (the default, so
 * nobody loses access until an admin assigns a scope). Super-admins and customer logins are never
 * scoped here (customers are scoped by their own account elsewhere). The RolesGuard attaches the live
 * values to req.user.scope.
 */
export type DataScope = { branches: string[]; companies: string[] };

const norm = (a: unknown): string[] => (Array.isArray(a) ? a.map((x) => String(x ?? '').trim().toUpperCase()).filter(Boolean) : []);

/** The user's effective scope, or null when they're unrestricted. */
export function scopeOf(user: any): DataScope | null {
  if (!user || user.role === 'SYS_ADMIN' || user.role === 'CLIENT_ADMIN') return null;
  const branches = norm(user.scope?.branches);
  const companies = norm(user.scope?.companies);
  return branches.length || companies.length ? { branches, companies } : null;
}

/** Prisma filter for B2bClient rows inside a scope. */
export function clientScopeWhere(s: DataScope) {
  return {
    AND: [
      ...(s.branches.length ? [{ branch: { in: s.branches } }] : []),
      ...(s.companies.length ? [{ serviceCentre: { in: s.companies } }] : []),
    ],
  };
}

// Short cache: the guard already caches the user for 15s; customer↔branch edits apply within the TTL.
const cache = new Map<string, { ids: bigint[]; exp: number }>();

/** Customer ids the user may see, or null when unrestricted. */
export async function scopedClientIds(prisma: PrismaService, user: any): Promise<bigint[] | null> {
  const s = scopeOf(user);
  if (!s) return null;
  const key = `${s.branches.join(',')}|${s.companies.join(',')}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.ids;
  const rows = await prisma.b2bClient.findMany({ where: clientScopeWhere(s), select: { id: true } });
  const ids = rows.map((r) => r.id);
  cache.set(key, { ids, exp: Date.now() + 15_000 });
  return ids;
}

/** Throws unless the customer is inside the user's scope (no-op when unrestricted). */
export async function assertClientInScope(prisma: PrismaService, user: any, clientId: bigint | number | string | null | undefined) {
  const ids = await scopedClientIds(prisma, user);
  if (!ids) return;
  if (clientId == null || !ids.some((i) => i === BigInt(clientId as any))) {
    throw new ForbiddenException('This customer is outside your assigned branch / company.');
  }
}

/** Expense branches the user may see, or null when unrestricted by branch. */
export function scopedBranches(user: any): string[] | null {
  const s = scopeOf(user);
  return s && s.branches.length ? s.branches : null;
}
