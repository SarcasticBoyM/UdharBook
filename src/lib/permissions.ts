import type { UserRole } from "@prisma/client";

export function canDelete(role: UserRole): boolean {
  return role === "ADMIN";
}

export function canImport(role: UserRole): boolean {
  return role === "ADMIN";
}

export function canManageUsers(role: UserRole): boolean {
  return role === "ADMIN";
}
