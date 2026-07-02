import type { UserRole } from "@prisma/client";
import { isAccountsRole, isRestrictedSchoolRole, isSalesRole, isShopAdminRole, normalizeFixedRole } from "@/lib/operational-roles";

export function canDelete(role: UserRole | string): boolean {
  if (isRestrictedSchoolRole(role)) return false;
  return isShopAdminRole(role) || isAccountsRole(role);
}

export function canImport(role: UserRole | string): boolean {
  if (isRestrictedSchoolRole(role)) return false;
  return isShopAdminRole(role) || isAccountsRole(role);
}

export function canManageUsers(role: UserRole | string): boolean {
  if (isRestrictedSchoolRole(role)) return false;
  return role === "SUPER_ADMIN" || isShopAdminRole(role);
}

export function canViewReports(role: UserRole | string): boolean {
  if (isRestrictedSchoolRole(role)) return false;
  return role === "SUPER_ADMIN" || isShopAdminRole(role) || isAccountsRole(role);
}

export function canManageCustomers(role: UserRole | string): boolean {
  if (isRestrictedSchoolRole(role)) return false;
  return isShopAdminRole(role) || isAccountsRole(role);
}

export function canReadCustomers(role: UserRole | string): boolean {
  if (isRestrictedSchoolRole(role)) return false;
  return canManageCustomers(role) || isSalesRole(role);
}

export function canUseOrders(role: UserRole | string): boolean {
  if (isRestrictedSchoolRole(role)) return false;
  return isShopAdminRole(role) || isSalesRole(role) || isAccountsRole(role);
}

export function canUseCheques(role: UserRole | string): boolean {
  if (isRestrictedSchoolRole(role)) return false;
  return role === "SUPER_ADMIN" || isShopAdminRole(role) || isSalesRole(role) || isAccountsRole(role);
}

export function canManageChequeAccounting(role: UserRole | string): boolean {
  if (isRestrictedSchoolRole(role)) return false;
  return role === "SUPER_ADMIN" || isShopAdminRole(role) || isAccountsRole(role);
}

export function canUseFollowUps(role: UserRole | string): boolean {
  if (isRestrictedSchoolRole(role)) return false;
  return isShopAdminRole(role) || isAccountsRole(role) || isSalesRole(role);
}

export function isSuperAdminRole(role: UserRole | string) {
  return normalizeFixedRole(role) === "SUPER_ADMIN";
}

export function canManageSchoolTransport(role: UserRole | string) {
  const normalized = normalizeFixedRole(role);
  return normalized === "SHOP_ADMIN" || normalized === "SCHOOL_ADMIN";
}

export function canDriveSchoolTransport(role: UserRole | string) {
  const normalized = normalizeFixedRole(role);
  return normalized === "SCHOOL_DRIVER" || normalized === "SHOP_ADMIN" || normalized === "SCHOOL_ADMIN";
}
