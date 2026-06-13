import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireShopId } from "@/lib/tenant";
import { canAssignTasks, normalizeFixedRole } from "@/lib/operational-roles";
import {
  generateTaskOverdueNotifications,
  notificationEntityAvailable,
  processNotificationRetries,
} from "@/lib/notifications";
import {
  canRoleSeeShopNotification,
  priorityRank,
  roleRestrictedShopEventTypes,
  type NotificationPriorityValue,
} from "@/lib/notification-priority";

const patchSchema = z.object({
  action: z.enum(["MARK_READ", "MARK_ALL_READ", "DELETE"]),
  id: z.string().optional(),
});

function visibleWhere(shopId: string, userId: string, role: string): Prisma.NotificationWhereInput {
  const normalizedRole = String(normalizeFixedRole(role));
  const hiddenShopEventTypes = roleRestrictedShopEventTypes.filter(
    (eventType) => !canRoleSeeShopNotification(eventType, normalizedRole),
  );
  return {
    shopId,
    NOT: { deletedByUserIds: { has: userId } },
    OR: [
      {
        targetType: "SHOP",
        ...(hiddenShopEventTypes.length > 0 ? { type: { notIn: hiddenShopEventTypes } } : {}),
      },
      { targetType: "ROLE", roleTarget: normalizedRole },
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
  const resolveId = searchParams.get("resolveId");

  await generateTaskOverdueNotifications(shopId);
  await processNotificationRetries({ shopId, limit: 5 });

  if (resolveId) {
    const notification = await prisma.notification.findFirst({
      where: { AND: [visible, { id: resolveId }] },
      select: { entityType: true, entityId: true, actionUrl: true },
    });
    if (!notification) {
      return NextResponse.json({ error: "This record is no longer available." }, { status: 404 });
    }
    if (notification.entityType === "TASK" && notification.entityId && !canAssignTasks(session.role)) {
      const assignedTask = await prisma.task.findFirst({
        where: { id: notification.entityId, shopId, assignedToId: session.id },
        select: { id: true },
      });
      if (!assignedTask) {
        return NextResponse.json({ error: "This record is no longer available." }, { status: 404 });
      }
    }
    const available = await notificationEntityAvailable(shopId, notification.entityType, notification.entityId);
    if (!available) {
      return NextResponse.json({ error: "This record is no longer available." }, { status: 404 });
    }
    return NextResponse.json({ success: true, actionUrl: notification.actionUrl });
  }

  const [recentNotifications, unreadCritical, unreadCount, criticalUnreadCount] = await prisma.$transaction([
    prisma.notification.findMany({
      where: visible,
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.notification.findMany({
      where: { AND: [visible, unreadWhere(session.id), { priority: "CRITICAL" }] },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.notification.count({
      where: { AND: [visible, unreadWhere(session.id)] },
    }),
    prisma.notification.count({
      where: { AND: [visible, unreadWhere(session.id), { priority: "CRITICAL" }] },
    }),
  ]);

  const byId = new Map([...unreadCritical, ...recentNotifications].map((notification) => [notification.id, notification]));
  const notifications = [...byId.values()]
    .map((notification) => ({
      ...notification,
      isRead: notification.isRead || notification.readByUserIds.includes(session.id),
    }))
    .sort((left, right) => {
      if (left.isRead !== right.isRead) return left.isRead ? 1 : -1;
      const priorityDifference =
        priorityRank(left.priority as NotificationPriorityValue) -
        priorityRank(right.priority as NotificationPriorityValue);
      if (priorityDifference !== 0) return priorityDifference;
      return right.createdAt.getTime() - left.createdAt.getTime();
    })
    .slice(0, limit);

  return NextResponse.json({
    unreadCount,
    criticalUnreadCount,
    notifications,
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
      const notification = await prisma.notification.findFirst({
        where,
        select: { priority: true, isRead: true, readByUserIds: true },
      });
      if (
        notification?.priority === "CRITICAL" &&
        !notification.isRead &&
        !notification.readByUserIds.includes(session.id)
      ) {
        return NextResponse.json(
          { error: "Mark this critical alert as read before deleting it." },
          { status: 409 },
        );
      }
      await prisma.notification.updateMany({
        where,
        data: { deletedByUserIds: { push: session.id } },
      });
    }
  }

  const unreadCount = await prisma.notification.count({
    where: { AND: [visibleWhere(shopId, session.id, session.role), unreadWhere(session.id)] },
  });
  const criticalUnreadCount = await prisma.notification.count({
    where: {
      AND: [
        visibleWhere(shopId, session.id, session.role),
        unreadWhere(session.id),
        { priority: "CRITICAL" },
      ],
    },
  });
  return NextResponse.json({ ok: true, unreadCount, criticalUnreadCount });
}
