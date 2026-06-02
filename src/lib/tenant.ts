import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/types";
import { prisma } from "@/lib/db";

export function isSuperAdmin(session: SessionUser) {
  return session.role === "SUPER_ADMIN";
}

export function canManageShop(session: SessionUser) {
  return session.role === "SUPER_ADMIN" || session.role === "SHOP_ADMIN";
}

export function requestedShopId(request: Request, session: SessionUser) {
  if (!isSuperAdmin(session)) return session.shopId;
  const url = new URL(request.url);
  const cookieShop = request.headers
    .get("cookie")
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("udharbook_shop="))
    ?.split("=")[1];
  return url.searchParams.get("shopId") || request.headers.get("x-shop-id") || cookieShop || session.shopId || "default-shop";
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
