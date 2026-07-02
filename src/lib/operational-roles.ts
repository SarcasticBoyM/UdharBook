import type { UserRole } from "@prisma/client";

export type FixedShopRole = "SHOP_ADMIN" | "SALES_PERSON" | "ACCOUNT_STAFF" | "SALES_PERSON_CUM_ACCOUNTS" | "DRIVER" | "SCHOOL_ADMIN" | "SCHOOL_DRIVER";
export type AppRole = UserRole | FixedShopRole | string;

export const fixedRoleLabels: Record<FixedShopRole, string> = {
  SHOP_ADMIN: "Shop Admin",
  SALES_PERSON: "Sales Person",
  ACCOUNT_STAFF: "Account Staff",
  SALES_PERSON_CUM_ACCOUNTS: "Sales Person Cum Accounts",
  DRIVER: "Driver",
  SCHOOL_ADMIN: "School Admin",
  SCHOOL_DRIVER: "School Driver",
};

export const assignableFixedRoles: FixedShopRole[] = [
  "SHOP_ADMIN",
  "SALES_PERSON",
  "ACCOUNT_STAFF",
  "SALES_PERSON_CUM_ACCOUNTS",
  "DRIVER",
  "SCHOOL_ADMIN",
  "SCHOOL_DRIVER",
];

export function normalizeFixedRole(role: AppRole): AppRole {
  const value = String(role);
  // School roles are intentionally resolved before every legacy/fuzzy rule.
  // They must never fall through to DRIVER, STAFF, SALES, or ACCOUNT_STAFF.
  if (value === "SCHOOL_ADMIN" || value === "SCHOOL_DRIVER") return value;
  if (value === "SALES_PERSON_CUM_ACCOUNTS" || (value.includes("SALES") && (value.includes("ACCOUNT") || value.includes("ACCOUNTING")))) return "SALES_PERSON_CUM_ACCOUNTS";
  if (value === "DRIVER") return "DRIVER";
  if (value === "SALES_PERSON" || value === "SALES" || value.includes("FIELD")) return "SALES_PERSON";
  if (value === "ACCOUNT_STAFF" || value === "STAFF" || value === "ACCOUNTING" || value === "ACCOUNTS" || value.includes("ACCOUNTING")) return "ACCOUNT_STAFF";
  if (value === "SHOP_OWNER_ADMIN" || value === "ADMIN") return "SHOP_ADMIN";
  return value;
}

export function isRestrictedSchoolRole(role: AppRole) {
  const normalized = normalizeFixedRole(role);
  return normalized === "SCHOOL_ADMIN" || normalized === "SCHOOL_DRIVER";
}

export function roleLabel(role: AppRole) {
  const normalized = normalizeFixedRole(role);
  if (normalized === "SUPER_ADMIN") return "Super Admin";
  return fixedRoleLabels[normalized as FixedShopRole] ?? String(role).replace(/_/g, " ");
}

export function isShopAdminRole(role: AppRole) {
  return normalizeFixedRole(role) === "SHOP_ADMIN";
}

export function isSalesRole(role: AppRole) {
  const normalized = normalizeFixedRole(role);
  return normalized === "SALES_PERSON" || normalized === "SALES_PERSON_CUM_ACCOUNTS";
}

export function isAccountsRole(role: AppRole) {
  const normalized = normalizeFixedRole(role);
  return normalized === "ACCOUNT_STAFF" || normalized === "SALES_PERSON_CUM_ACCOUNTS";
}

export function canAccessTasks(role: AppRole) {
  const normalized = normalizeFixedRole(role);
  return ["SHOP_ADMIN", "SALES_PERSON", "ACCOUNT_STAFF", "SALES_PERSON_CUM_ACCOUNTS"].includes(String(normalized));
}

export function canAssignTasks(role: AppRole) {
  const normalized = normalizeFixedRole(role);
  return normalized === "SHOP_ADMIN" || normalized === "SUPER_ADMIN";
}

export function canAccessModule(role: AppRole, href: string) {
  const normalized = normalizeFixedRole(role);
  if (href === "/tasks") return canAccessTasks(normalized);
  if (normalized === "SCHOOL_DRIVER") return href === "/school-transport/driver";
  if (normalized === "SCHOOL_ADMIN") return href === "/school-transport";
  if (normalized === "DRIVER") return href === "/driver-trip";
  if (normalized === "SUPER_ADMIN") return href === "/" || href === "/shops" || href === "/staff" || href === "/trade-calculator";
  if (normalized === "SHOP_ADMIN") return true;
  if (normalized === "SALES_PERSON") {
    return ["/orders", "/cheques", "/customers", "/today-follow-ups", "/field-staff", "/daily-visits", "/qrvcard"].includes(href);
  }
  if (normalized === "ACCOUNT_STAFF") {
    return ["/", "/customers", "/upload", "/today-follow-ups", "/orders", "/cheques", "/reports", "/qrvcard"].includes(href);
  }
  if (normalized === "SALES_PERSON_CUM_ACCOUNTS") {
    return ["/", "/customers", "/upload", "/today-follow-ups", "/orders", "/cheques", "/field-staff", "/daily-visits", "/reports", "/qrvcard"].includes(href);
  }
  return false;
}
