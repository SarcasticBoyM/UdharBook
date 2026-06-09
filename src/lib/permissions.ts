import type { OperationalRole, UserRole } from "@prisma/client";
import { normalizeOperationalRoles } from "@/lib/operational-roles";

export function canDelete(role: UserRole): boolean {
  return role === "SHOP_ADMIN";
}

export function canImport(role: UserRole, assignedRoles: OperationalRole[] = []): boolean {
  const roles = normalizeOperationalRoles(role, assignedRoles);
  return roles.includes("SHOP_ADMIN") || roles.includes("ACCOUNTING_STAFF");
}

export function canManageUsers(role: UserRole): boolean {
  return role === "SUPER_ADMIN" || role === "SHOP_ADMIN";
}

export function canViewReports(role: UserRole, assignedRoles: OperationalRole[] = []): boolean {
  const roles = normalizeOperationalRoles(role, assignedRoles);
  return roles.includes("SHOP_ADMIN") || roles.includes("ACCOUNTING_STAFF") || roles.includes("FOLLOWUP_MANAGER");
}
