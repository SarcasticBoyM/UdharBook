import type { UserRole } from "@prisma/client";

export function canDelete(role: UserRole): boolean {
  return role === "SUPER_ADMIN" || role === "SHOP_ADMIN";
}

export function canImport(role: UserRole): boolean {
  return role === "SUPER_ADMIN" || role === "SHOP_ADMIN" || role === "STAFF";
}

export function canManageUsers(role: UserRole): boolean {
  return role === "SUPER_ADMIN" || role === "SHOP_ADMIN";
}

export function canViewReports(role: UserRole): boolean {
  return role === "SUPER_ADMIN" || role === "SHOP_ADMIN";
}
