import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Restrict a route to one or more roles. Used with RolesGuard. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const SUPER_ADMIN_ONLY_KEY = 'superAdminOnly';

/**
 * Locks a route (or whole controller) to SYS_ADMIN even for ADMIN, who otherwise
 * inherits all access. Use on user-management and destructive wipe/delete routes.
 */
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_ONLY_KEY, true);
