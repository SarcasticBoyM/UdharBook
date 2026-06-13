import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireShopId } from "@/lib/tenant";
import { canAssignTasks, normalizeFixedRole } from "@/lib/operational-roles";
import { logger } from "@/lib/logger";
import {
  checkNotificationStorage,
  notificationStorageAdminMessage,
  type NotificationStorageReadiness,
} from "@/lib/notification-storage";
import {
  generateTaskOverdueNotifications,
  notificationEntityAvailable,
  processNotificationRetries,
} from "@/lib/notifications";
import { processDueOrderFollowUpReminders } from "@/lib/order-follow-up-reminders";
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

const runtimeRecipientRules = {
  TASK_ASSIGNED: "Assigned same-shop staff user only",
  TASK_COMPLETED: "Assigning same-shop Shop Admin",
  ORDER_CREATED: "All active same-shop operational roles",
  CHEQUE_BOUNCED: "Same-shop Shop Admin, Account Staff, Sales Person Cum Accounts, and relevant assigned user",
};

function notificationApiError() {
  return "Notifications could not be loaded. Please retry.";
}

function canSeeStorageDiagnostics(role: string) {
  const normalizedRole = String(normalizeFixedRole(role));
  return normalizedRole === "SHOP_ADMIN" || normalizedRole === "SUPER_ADMIN";
}

function storageErrorResponse(readiness: NotificationStorageReadiness, role: string) {
  const admin = canSeeStorageDiagnostics(role);
  return {
    success: false,
    notifications: [],
    unreadCount: 0,
    criticalUnreadCount: 0,
    error: admin
      ? notificationStorageAdminMessage(readiness)
      : "Notifications are temporarily unavailable. Please retry shortly.",
    ...(admin ? { storage: readiness } : {}),
  };
}

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

  const { searchParams } = new URL(request.url);
  const forceStorageCheck = searchParams.get("storageCheck") === "force";
  const debugRequested = searchParams.get("debug") === "runtime";
  const readiness = await checkNotificationStorage({ force: forceStorageCheck || debugRequested });
  if (!readiness.ready) {
    if (canSeeStorageDiagnostics(session.role)) {
      logger.error("notification_storage_not_ready", {
        event: "notification_storage_not_ready",
        userId: session.id,
        role: String(normalizeFixedRole(session.role)),
        shopId: session.shopId,
        prismaCode: readiness.prismaCode,
        issues: readiness.issues,
        failureReason: readiness.failureReason,
        checkedAt: readiness.checkedAt,
      });
    }
    return NextResponse.json(storageErrorResponse(readiness, session.role), { status: 503 });
  }

  if (session.role === "SUPER_ADMIN") {
    return NextResponse.json({
      success: true,
      notifications: [],
      unreadCount: 0,
      criticalUnreadCount: 0,
      ...(debugRequested ? { storage: readiness } : {}),
    });
  }

  const shopId = requireShopId(request, session);
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? 20)));
  const visible = visibleWhere(shopId, session.id, session.role);
  const resolveId = searchParams.get("resolveId");

  try {
    await generateTaskOverdueNotifications(shopId);
    await processDueOrderFollowUpReminders({ shopId, recipientUserId: session.id, limit: 20 });
    await processNotificationRetries({ shopId, limit: 5 });

    if (debugRequested) {
      if (String(normalizeFixedRole(session.role)) !== "SHOP_ADMIN") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const [totalNotificationCount, unreadCount, latest, schemaColumns] = await Promise.all([
        prisma.notification.count({ where: { shopId } }),
        prisma.notification.count({ where: { AND: [visible, unreadWhere(session.id)] } }),
        prisma.notification.findMany({
          where: visible,
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { type: true, priority: true, targetType: true, createdAt: true },
        }),
        prisma.$queryRaw<Array<{ tableName: string; columnName: string }>>(Prisma.sql`
          SELECT table_name AS "tableName", column_name AS "columnName"
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN ('Notification', 'NotificationRetry')
          ORDER BY table_name, ordinal_position
        `),
      ]);
      return NextResponse.json({
        success: true,
        debug: {
          sessionUserId: session.id,
          role: String(normalizeFixedRole(session.role)),
          shopId,
          totalNotificationCount,
          unreadCount,
          latestNotificationTypes: latest,
          resolvedRecipientRules: runtimeRecipientRules,
          schemaColumns,
          pwaPush: {
            available: false,
            reason: "No persisted push subscription store or server-side VAPID delivery service is configured.",
          },
          storage: readiness,
          apiError: null,
        },
      });
    }

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
      success: true,
      unreadCount,
      criticalUnreadCount,
      notifications,
    });
  } catch (error) {
    const safeError = notificationApiError();
    if (canSeeStorageDiagnostics(session.role)) {
      logger.error("notification_api_get_failed", {
        event: "notification_api_get_failed",
        shopId,
        userId: session.id,
        role: session.role,
        debugRequested,
        prismaCode: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return NextResponse.json({
      success: false,
      notifications: [],
      unreadCount: 0,
      criticalUnreadCount: 0,
      error: safeError,
      ...(debugRequested && String(normalizeFixedRole(session.role)) === "SHOP_ADMIN"
        ? {
            debug: {
              sessionUserId: session.id,
              role: String(normalizeFixedRole(session.role)),
              shopId,
              totalNotificationCount: null,
              unreadCount: null,
              latestNotificationTypes: [],
              resolvedRecipientRules: runtimeRecipientRules,
              schemaColumns: [],
              pwaPush: {
                available: false,
                reason: "No persisted push subscription store or server-side VAPID delivery service is configured.",
              },
              storage: await checkNotificationStorage({ force: true }),
              apiError: safeError,
            },
          }
        : {}),
    }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const readiness = await checkNotificationStorage();
  if (!readiness.ready) {
    if (canSeeStorageDiagnostics(session.role)) {
      logger.error("notification_storage_not_ready", {
        event: "notification_storage_not_ready",
        userId: session.id,
        role: String(normalizeFixedRole(session.role)),
        shopId: session.shopId,
        prismaCode: readiness.prismaCode,
        issues: readiness.issues,
        failureReason: readiness.failureReason,
        checkedAt: readiness.checkedAt,
      });
    }
    return NextResponse.json(storageErrorResponse(readiness, session.role), { status: 503 });
  }
  if (session.role === "SUPER_ADMIN") {
    return NextResponse.json({ success: true, ok: true, unreadCount: 0, criticalUnreadCount: 0 });
  }

  const shopId = requireShopId(request, session);
  try {
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
    return NextResponse.json({ success: true, ok: true, unreadCount, criticalUnreadCount });
  } catch (error) {
    const safeError = error instanceof z.ZodError
      ? "Invalid notification action."
      : notificationApiError();
    if (canSeeStorageDiagnostics(session.role)) {
      logger.error("notification_api_patch_failed", {
        event: "notification_api_patch_failed",
        shopId,
        userId: session.id,
        role: session.role,
        prismaCode: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return NextResponse.json({ success: false, error: safeError }, {
      status: error instanceof z.ZodError ? 400 : 503,
    });
  }
}
