import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/types";
import { prisma } from "@/lib/db";

export function isSuperAdmin(session: SessionUser) {
  return session.role === "SUPER_ADMIN";
}

export function canManageShop(session: SessionUser) {
  return session.role === "SHOP_ADMIN";
}

export function requestedShopId(request: Request, session: SessionUser) {
  if (isSuperAdmin(session)) return session.shopId;
  return session.shopId;
}

export function requireShopId(request: Request, session: SessionUser) {
  const shopId = requestedShopId(request, session);
  if (!shopId) throw new Error("SHOP_REQUIRED");
  return shopId;
}

export function customerWhereForShop(
  request: Request,
  session: SessionUser,
  extra: Prisma.CustomerWhereInput = {}
) {
  return {
    ...extra,
    shopId: requireShopId(request, session),
  } satisfies Prisma.CustomerWhereInput;
}

export async function visibleShops(session: SessionUser) {
  if (isSuperAdmin(session)) {
    return prisma.shop.findMany({ where: { id: { not: "platform-shop" } }, orderBy: { createdAt: "desc" } });
  }
  if (!session.shopId) return [];
  return prisma.shop.findMany({ where: { id: session.shopId } });
}
