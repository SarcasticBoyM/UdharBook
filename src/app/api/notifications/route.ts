import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireShopId } from "@/lib/tenant";
import { normalizeFixedRole } from "@/lib/operational-roles";

const patchSchema = z.object({
  action: z.enum(["MARK_READ", "MARK_ALL_READ", "DELETE"]),
  id: z.string().optional(),
});

function visibleWhere(shopId: string, userId: string, role: string): Prisma.NotificationWhereInput {
  return {
    shopId,
    NOT: { deletedByUserIds: { has: userId } },
    OR: [
      { targetType: "SHOP" },
      { targetType: "ROLE", roleTarget: String(normalizeFixedRole(role)) },
      { targetType: "USER", userId },
    ],
  };
}

function unreadWhere(userId: string): Prisma.NotificationWhereInput {
  return {
    isRead: false,
    NOT: { readByUserIds: { has: userId } },
  };
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "SUPER_ADMIN") return NextResponse.json({ notifications: [], unreadCount: 0 });

  const shopId = requireShopId(request, session);
  const { searchParams } = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? 20)));
  const visible = visibleWhere(shopId, session.id, session.role);

  const [notifications, unreadCount] = await prisma.$transaction([
    prisma.notification.findMany({
      where: visible,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({
      where: { AND: [visible, unreadWhere(session.id)] },
    }),
  ]);

  return NextResponse.json({
    unreadCount,
    notifications: notifications.map((notification) => ({
      ...notification,
      isRead: notification.isRead || notification.readByUserIds.includes(session.id),
    })),
  });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "SUPER_ADMIN") return NextResponse.json({ ok: true, unreadCount: 0 });

  const shopId = requireShopId(request, session);
  const body = patchSchema.parse(await request.json());
  const visible = visibleWhere(shopId, session.id, session.role);

  if (body.action === "MARK_ALL_READ") {
    await prisma.notification.updateMany({
      where: { AND: [visible, unreadWhere(session.id)] },
      data: { readByUserIds: { push: session.id } },
    });
  } else {
    if (!body.id) return NextResponse.json({ error: "Missing notification id" }, { status: 400 });
    const where: Prisma.NotificationWhereInput = { AND: [visible, { id: body.id }] };
    if (body.action === "MARK_READ") {
      await prisma.notification.updateMany({
        where: { AND: [where, unreadWhere(session.id)] },
        data: { readByUserIds: { push: session.id } },
      });
    }
    if (body.action === "DELETE") {
      await prisma.notification.updateMany({
        where,
        data: { deletedByUserIds: { push: session.id } },
      });
    }
  }

  const unreadCount = await prisma.notification.count({
    where: { AND: [visibleWhere(shopId, session.id, session.role), unreadWhere(session.id)] },
  });
  return NextResponse.json({ ok: true, unreadCount });
}
