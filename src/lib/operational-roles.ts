import type { UserRole } from "@prisma/client";

export type FixedShopRole = "SHOP_ADMIN" | "SALES_PERSON" | "ACCOUNT_STAFF" | "SALES_PERSON_CUM_ACCOUNTS";
export type AppRole = UserRole | FixedShopRole | string;

export const fixedRoleLabels: Record<FixedShopRole, string> = {
  SHOP_ADMIN: "Shop Admin",
  SALES_PERSON: "Sales Person",
  ACCOUNT_STAFF: "Account Staff",
  SALES_PERSON_CUM_ACCOUNTS: "Sales Person Cum Accounts",
};

export const assignableFixedRoles: FixedShopRole[] = [
  "SHOP_ADMIN",
  "SALES_PERSON",
  "ACCOUNT_STAFF",
  "SALES_PERSON_CUM_ACCOUNTS",
];

export function normalizeFixedRole(role: AppRole): AppRole {
  if (["FIELD_SALES", "FIELD_STAFF", "FIELD_SALES_PERSON", "SALES"].includes(String(role))) return "SALES_PERSON";
  if (["STAFF", "ACCOUNTING", "ACCOUNTING_STAFF", "ACCOUNTS"].includes(String(role))) return "ACCOUNT_STAFF";
  if (["FIELD_SALES_AND_ACCOUNTING", "SALES_AND_ACCOUNTS", "SALES_PERSON_AND_ACCOUNT_STAFF"].includes(String(role))) return "SALES_PERSON_CUM_ACCOUNTS";
  if (["SHOP_OWNER_ADMIN", "ADMIN"].includes(String(role))) return "SHOP_ADMIN";
  return role;
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

export function canAccessModule(role: AppRole, href: string) {
  const normalized = normalizeFixedRole(role);
  if (normalized === "SUPER_ADMIN") return href === "/" || href === "/shops" || href === "/staff" || href === "/trade-calculator";
  if (normalized === "SHOP_ADMIN") return true;
  if (normalized === "SALES_PERSON") {
    return ["/orders", "/cheques", "/customers", "/field-staff", "/daily-visits", "/qrvcard"].includes(href);
  }
  if (normalized === "ACCOUNT_STAFF") {
    return ["/", "/customers", "/upload", "/today-follow-ups", "/orders", "/cheques", "/reports", "/qrvcard"].includes(href);
  }
  if (normalized === "SALES_PERSON_CUM_ACCOUNTS") {
    return ["/", "/customers", "/upload", "/today-follow-ups", "/orders", "/cheques", "/field-staff", "/daily-visits", "/reports", "/qrvcard"].includes(href);
  }
  return false;
}
