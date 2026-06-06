import { prisma } from "@/lib/db";
import type { SessionUser } from "@/types";
import { logger } from "@/lib/logger";

export async function getOnboardingState(session: SessionUser) {
  if (session.role !== "SUPER_ADMIN") {
    return {
      needsOnboarding: false,
      totalShops: 0,
      activeShopId: null,
      activeShopName: null,
      setupStep: "welcome",
    };
  }

  const businessWhere = { id: { not: "platform-shop" } };
  let totalShops = 0;
  let incompleteShops: { id: string; shopName: string; setupStep: string | null }[] = [];
  let latestShop: { id: string; shopName: string; onboardingCompleted: boolean; setupStep: string | null } | null = null;
  try {
    [totalShops, incompleteShops, latestShop] = await Promise.all([
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
  } catch (error) {
    logger.error("onboarding_state_lookup_failed_non_blocking", {
      userId: session.id,
      role: session.role,
      error: error instanceof Error ? error.message : "Unknown onboarding lookup error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return {
      needsOnboarding: false,
      totalShops: 0,
      activeShopId: null,
      activeShopName: null,
      setupStep: "welcome",
    };
  }

  const incomplete = incompleteShops[0] ?? null;
  const needsOnboarding = totalShops === 0 || Boolean(incomplete);

  return {
    needsOnboarding,
    totalShops,
    activeShopId: incomplete?.id ?? latestShop?.id ?? null,
    activeShopName: incomplete?.shopName ?? latestShop?.shopName ?? null,
    setupStep: incomplete?.setupStep ?? latestShop?.setupStep ?? "welcome",
  };
}
