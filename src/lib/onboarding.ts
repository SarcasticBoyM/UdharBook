import { prisma } from "@/lib/db";
import type { SessionUser } from "@/types";

export async function getOnboardingState(session: SessionUser) {
  const businessWhere = { id: { not: "platform-shop" } };
  const [totalShops, incompleteShops, latestShop] = await Promise.all([
    prisma.shop.count({ where: businessWhere }),
    prisma.shop.findMany({
      where: { ...businessWhere, onboardingCompleted: false },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { id: true, shopName: true, setupStep: true },
    }),
    prisma.shop.findFirst({
      where: businessWhere,
      orderBy: { createdAt: "desc" },
      select: { id: true, shopName: true, onboardingCompleted: true, setupStep: true },
    }),
  ]);

  const incomplete = incompleteShops[0] ?? null;
  const needsOnboarding = session.role === "SUPER_ADMIN" && (totalShops === 0 || Boolean(incomplete));

  return {
    needsOnboarding,
    totalShops,
    activeShopId: incomplete?.id ?? latestShop?.id ?? null,
    activeShopName: incomplete?.shopName ?? latestShop?.shopName ?? null,
    setupStep: incomplete?.setupStep ?? latestShop?.setupStep ?? "welcome",
  };
}
