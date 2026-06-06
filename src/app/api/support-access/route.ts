import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";

const grantSchema = z.object({
  reason: z.string().min(8).max(500),
  superAdminEmail: z.string().email().optional(),
  durationMinutes: z.coerce.number().int().min(15).max(240).default(60),
});

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  if (session.role === "SUPER_ADMIN") {
    const grants = await prisma.supportAccessGrant.findMany({
      where: {
        status: "ACTIVE",
        expiresAt: { gt: now },
        OR: [{ superAdminId: session.id }, { superAdminId: null }],
      },
      orderBy: { expiresAt: "asc" },
      select: {
        id: true,
        reason: true,
        expiresAt: true,
        createdAt: true,
        shop: { select: { id: true, shopName: true, subscriptionStatus: true, onboardingCompleted: true } },
        requestedBy: { select: { name: true, role: true } },
      },
    });
    return NextResponse.json({ grants });
  }

  if (session.role !== "SHOP_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const grants = await prisma.supportAccessGrant.findMany({
    where: { shopId: session.shopId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      reason: true,
      status: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      superAdmin: { select: { name: true, email: true } },
    },
  });
  return NextResponse.json({ grants });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "SHOP_ADMIN") {
    return NextResponse.json({ error: "Only shop admins can grant temporary support access" }, { status: 403 });
  }

  try {
    const body = grantSchema.parse(await request.json());
    const superAdmin = body.superAdminEmail
      ? await prisma.user.findUnique({
          where: { email: body.superAdminEmail.toLowerCase() },
          select: { id: true, role: true, email: true },
        })
      : null;

    if (body.superAdminEmail && superAdmin?.role !== "SUPER_ADMIN") {
      logger.warn("support_access_grant_super_admin_not_found", {
        actorId: session.id,
        shopId: session.shopId,
        requestedEmail: body.superAdminEmail.toLowerCase(),
      });
      return NextResponse.json({ error: "Super admin account not found" }, { status: 404 });
    }

    const grant = await prisma.supportAccessGrant.create({
      data: {
        shopId: session.shopId,
        requestedById: session.id,
        superAdminId: superAdmin?.id ?? null,
        reason: body.reason,
        expiresAt: new Date(Date.now() + body.durationMinutes * 60 * 1000),
      },
      select: {
        id: true,
        reason: true,
        expiresAt: true,
        status: true,
        superAdmin: { select: { name: true, email: true } },
      },
    });

    await logActivity({
      action: "support_access_granted",
      userId: session.id,
      shopId: session.shopId,
      details: `Temporary support access granted for ${body.durationMinutes} minutes`,
    });

    return NextResponse.json({ grant }, { status: 201 });
  } catch (error) {
    logger.warn("support_access_grant_invalid_request", {
      actorId: session.id,
      shopId: session.shopId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
