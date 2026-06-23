import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { generateOrderPublicToken, publicOrderUrl } from "@/lib/order-public-link";
import { canUseOrders } from "@/lib/permissions";
import { requireShopId } from "@/lib/tenant";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!canUseOrders(session.role)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

  const shopId = requireShopId(request, session);
  try {
    const link = await prisma.orderPublicLink.upsert({
      where: { shopId },
      create: {
        shopId,
        token: generateOrderPublicToken(),
        isEnabled: true,
        regeneratedAt: new Date(),
      },
      update: {
        token: generateOrderPublicToken(),
        isEnabled: true,
        regeneratedAt: new Date(),
      },
    });
    return NextResponse.json({
      success: true,
      url: publicOrderUrl(request, link.token),
      token: link.token,
      isEnabled: link.isEnabled,
    });
  } catch (error) {
    logger.error("order_public_link_regenerate_failed", {
      shopId,
      userId: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ success: false, error: "Could not regenerate customer order link." }, { status: 500 });
  }
}
