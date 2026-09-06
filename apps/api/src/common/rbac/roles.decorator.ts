import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Restrict a route to one or more roles. Used with RolesGuard. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const FEATURE_KEY = 'feature';

/**
 * Tie a route (or whole controller) to a UI feature key (the nav route, e.g. '/customers').
 * RolesGuard then ALSO admits a user whose department/feature-grant covers this feature at the
 * level the HTTP method needs (GET=VIEW, POST/PATCH/PUT=EDIT, DELETE=DELETE) — additive to @Roles,
 * so granting a feature actually grants API access without removing any role-based access.
 */
export const Feature = (key: string) => SetMetadata(FEATURE_KEY, key);

export const SUPER_ADMIN_ONLY_KEY = 'superAdminOnly';

/**
 * Locks a route (or whole controller) to SYS_ADMIN even for ADMIN, who otherwise
 * inherits all access. Use on user-management and destructive wipe/delete routes.
 */
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_ONLY_KEY, true);
