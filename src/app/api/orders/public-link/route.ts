import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { generateOrderPublicToken, publicOrderUrl } from "@/lib/order-public-link";
import { canUseOrders } from "@/lib/permissions";
import { requireShopId } from "@/lib/tenant";

function forbidden() {
  return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
}

async function requireOrderUser(request: Request) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
  if (!canUseOrders(session.role)) return { error: forbidden() };
  return { session, shopId: requireShopId(request, session) };
}

async function getOrCreateLink(shopId: string) {
  const existing = await prisma.orderPublicLink.findUnique({ where: { shopId } });
  if (existing) return existing;
  return prisma.orderPublicLink.create({
    data: {
      shopId,
      token: generateOrderPublicToken(),
      isEnabled: true,
    },
  });
}

function linkResponse(request: Request, link: { token: string; isEnabled: boolean }) {
  return NextResponse.json({
    success: true,
    url: publicOrderUrl(request, link.token),
    token: link.token,
    isEnabled: link.isEnabled,
  });
}

export async function GET(request: Request) {
  const auth = await requireOrderUser(request);
  if (auth.error) return auth.error;
  try {
    const link = await getOrCreateLink(auth.shopId);
    return linkResponse(request, link);
  } catch (error) {
    logger.error("order_public_link_get_failed", {
      shopId: auth.shopId,
      userId: auth.session.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ success: false, error: "Could not load customer order link." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireOrderUser(request);
  if (auth.error) return auth.error;
  try {
    const link = await getOrCreateLink(auth.shopId);
    return linkResponse(request, link);
  } catch (error) {
    logger.error("order_public_link_create_failed", {
      shopId: auth.shopId,
      userId: auth.session.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ success: false, error: "Could not create customer order link." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireOrderUser(request);
  if (auth.error) return auth.error;
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body.isEnabled !== "boolean") {
      return NextResponse.json({ success: false, error: "isEnabled is required." }, { status: 400 });
    }
    await getOrCreateLink(auth.shopId);
    const link = await prisma.orderPublicLink.update({
      where: { shopId: auth.shopId },
      data: { isEnabled: body.isEnabled },
    });
    return linkResponse(request, link);
  } catch (error) {
    logger.error("order_public_link_update_failed", {
      shopId: auth.shopId,
      userId: auth.session.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ success: false, error: "Could not update customer order link." }, { status: 500 });
  }
}
