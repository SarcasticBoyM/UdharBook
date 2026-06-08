import type { OperationalRole, UserRole } from "@prisma/client";

export const operationalRoleLabels: Record<OperationalRole, string> = {
  SHOP_ADMIN: "Shop Admin",
  ACCOUNTING_STAFF: "Accounting",
  FIELD_SALES_PERSON: "Field Sales",
  CHEQUE_OPERATIONS: "Cheques",
  ORDER_MANAGER: "Orders",
  FOLLOWUP_MANAGER: "Follow-ups",
};

export const assignableOperationalRoles: OperationalRole[] = [
  "SHOP_ADMIN",
  "ACCOUNTING_STAFF",
  "FIELD_SALES_PERSON",
  "CHEQUE_OPERATIONS",
  "ORDER_MANAGER",
  "FOLLOWUP_MANAGER",
];

export function fallbackOperationalRoles(role: UserRole | string): OperationalRole[] {
  if (role === "SHOP_ADMIN") return ["SHOP_ADMIN"];
  if (role === "FIELD_SALES") return ["FIELD_SALES_PERSON", "ORDER_MANAGER"];
  if (role === "STAFF") return ["ACCOUNTING_STAFF", "CHEQUE_OPERATIONS", "FOLLOWUP_MANAGER"];
  return [];
}

export function normalizeOperationalRoles(role: UserRole | string, assignedRoles?: { role: OperationalRole }[] | OperationalRole[]) {
  const roles = (assignedRoles ?? []).map((item) => (typeof item === "string" ? item : item.role));
  const merged = roles.length > 0 ? roles : fallbackOperationalRoles(role);
  return Array.from(new Set(merged));
}

export function primaryUserRoleFromOperationalRoles(roles: OperationalRole[], fallback: UserRole = "STAFF") {
  if (roles.includes("SHOP_ADMIN")) return "SHOP_ADMIN" as UserRole;
  if (roles.includes("FIELD_SALES_PERSON") && !roles.includes("ACCOUNTING_STAFF")) return "FIELD_SALES" as UserRole;
  if (roles.length > 0) return "STAFF" as UserRole;
  return fallback;
}

export function canAccessModule(role: UserRole | string, assignedRoles: OperationalRole[], href: string) {
  if (role === "SUPER_ADMIN") return href === "/" || href === "/shops" || href === "/staff";
  const roles = normalizeOperationalRoles(role, assignedRoles);
  if (roles.includes("SHOP_ADMIN")) return true;
  if (href === "/" || href === "/customers") return true;
  if (href === "/field-staff" || href === "/daily-visits") return roles.includes("FIELD_SALES_PERSON");
  if (href === "/orders") return roles.includes("FIELD_SALES_PERSON") || roles.includes("ORDER_MANAGER") || roles.includes("ACCOUNTING_STAFF");
  if (href === "/cheques") return roles.includes("CHEQUE_OPERATIONS") || roles.includes("ACCOUNTING_STAFF") || roles.includes("FIELD_SALES_PERSON");
  if (href === "/today-follow-ups" || href === "/follow-ups") return roles.includes("FOLLOWUP_MANAGER") || roles.includes("ACCOUNTING_STAFF");
  if (href === "/upload" || href === "/reports") return roles.includes("ACCOUNTING_STAFF");
  return false;
}
