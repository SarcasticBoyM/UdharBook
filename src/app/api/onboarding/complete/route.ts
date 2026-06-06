import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";

const schema = z.object({
  shopId: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = schema.parse(await request.json());
    const shop = await prisma.shop.findFirst({ where: { id: body.shopId, NOT: { id: "platform-shop" } } });
    if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

    const updated = await prisma.shop.update({
      where: { id: body.shopId },
      data: {
        onboardingCompleted: true,
        setupStep: "complete",
        setupCompletedAt: new Date(),
      },
    });

    await logActivity({
      action: "onboarding_completed",
      userId: session.id,
      shopId: body.shopId,
      details: updated.shopName,
    });

    return NextResponse.json({ ok: true, shop: updated });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
