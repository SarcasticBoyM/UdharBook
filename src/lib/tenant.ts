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
  if (isSuperAdmin(session)) {
    const url = new URL(request.url);
    const cookieShopId = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("udharbook_shop="))?.split("=")[1];
    const requested = url.searchParams.get("shopId") || request.headers.get("x-shop-id") || (cookieShopId ? decodeURIComponent(cookieShopId) : null);
    if (requested && requested !== "platform-shop") return requested;
  }
  return session.shopId;
}

export function requireShopId(request: Request, session: SessionUser) {
  const shopId = requestedShopId(request, session);
  if (!shopId) throw new Error("SHOP_REQUIRED");
  return shopId;
}

export async function resolveOperationalShopId(request: Request, session: SessionUser) {
  const shopId = requestedShopId(request, session);
  if (shopId && shopId !== "platform-shop") return shopId;
  if (!isSuperAdmin(session)) {
    if (!shopId) throw new Error("SHOP_REQUIRED");
    return shopId;
  }

  const fallback = await prisma.shop.findFirst({
    where: { id: { not: "platform-shop" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!fallback) throw new Error("SHOP_REQUIRED");
  return fallback.id;
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
