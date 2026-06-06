import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/tenant";
import { canManageUsers } from "@/lib/permissions";
import { generateTemporaryPassword } from "@/lib/password";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["SHOP_ADMIN", "STAFF", "FIELD_SALES"]),
  mobile: z.string().optional(),
  jobTitle: z.string().optional(),
  password: z.string().min(8).optional(),
  shopId: z.string().optional(),
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = isSuperAdmin(session) ? new URL(request.url).searchParams.get("shopId") : session.shopId;
  const users = await prisma.user.findMany({
    where: {
      ...(shopId ? { shopId } : {}),
      role: { not: "SUPER_ADMIN" },
    },
    include: { shop: { select: { shopName: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = createSchema.parse(await request.json());
    const shopId = isSuperAdmin(session) ? body.shopId : session.shopId;
    if (!shopId || shopId === "platform-shop") {
      logger.warn("user_create_missing_business_shop", { actorId: session.id, actorRole: session.role, requestedShopId: shopId });
      return NextResponse.json({ error: "A business shop is required" }, { status: 400 });
    }
    const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } });
    if (!shop) {
      logger.warn("user_create_shop_not_found", { actorId: session.id, actorRole: session.role, requestedShopId: shopId });
      return NextResponse.json({ error: "Selected shop no longer exists. Please select a valid business shop." }, { status: 400 });
    }
    if (!isSuperAdmin(session) && body.role === "SHOP_ADMIN") {
      return NextResponse.json({ error: "Shop admins can only create staff or field sales users" }, { status: 403 });
    }
    const temporaryPassword = body.password ?? generateTemporaryPassword();
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email.toLowerCase(),
        mobile: body.mobile,
        role: body.role,
        jobTitle: body.jobTitle,
        shopId,
        passwordHash: await hashPassword(temporaryPassword),
        passwordResetRequired: !body.password,
        tempPasswordExpiresAt: body.password ? null : new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      include: { shop: { select: { shopName: true } } },
    });
    await logActivity({
      action: "user_created",
      userId: session.id,
      shopId,
      details: user.email,
    });
    return NextResponse.json({ user, temporaryPassword }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
