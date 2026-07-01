import { Prisma, type NotificationPriority, type NotificationTargetType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeFixedRole } from "@/lib/operational-roles";
import { logger } from "@/lib/logger";
import {
  notificationPolicy,
  notificationPriority,
  OPERATIONAL_NOTIFICATION_ROLES,
} from "@/lib/notification-priority";
import { taskTypeLabels } from "@/lib/tasks";
import { sendPushForNotification } from "@/lib/web-push";

const RETRY_DELAYS_MINUTES = [1, 5, 30, 120] as const;
const DEFAULT_MAX_RETRIES = RETRY_DELAYS_MINUTES.length;
const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;
const RETRY_SWEEP_THROTTLE_MS = 30 * 1000;
const retrySweepAfterByShop = new Map<string, number>();
const OVERDUE_SWEEP_THROTTLE_MS = 60 * 1000;
const overdueSweepAfterByShop = new Map<string, number>();

export type NotificationTarget =
  | { type: "SHOP" }
  | { type: "ROLE"; role: string }
  | { type: "USER"; userId: string };

export type CreateNotificationInput = {
  shopId: string;
  actorUserId?: string;
  target: NotificationTarget;
  type: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
  metadata?: Prisma.InputJsonValue;
  idempotencyKey?: string;
};

export type NotificationDeliveryResult = {
  success: boolean;
  queued: boolean;
  retryQueued: boolean;
  notificationId?: string;
};

export type NotificationActor = {
  id: string;
  name: string;
  role: string;
  shopId: string;
};

class NotificationValidationError extends Error {}

export function orderUrl(id: string) {
  return `/orders?highlight=${encodeURIComponent(id)}`;
}

export function chequeUrl(id: string) {
  return `/cheques?highlight=${encodeURIComponent(id)}`;
}

export function customerUrl(id: string) {
  return `/customers/${encodeURIComponent(id)}`;
}

export function followUpUrl(customerId: string) {
  return `/customers/${encodeURIComponent(customerId)}?tab=follow-ups`;
}

export function attendanceUrl() {
  return "/daily-visits";
}

export function taskUrl(id: string) {
  return `/tasks?taskId=${encodeURIComponent(id)}`;
}

function targetData(target: NotificationTarget) {
  if (target.type === "ROLE") {
    return {
      targetType: "ROLE" as NotificationTargetType,
      roleTarget: String(normalizeFixedRole(target.role)),
      userId: null,
    };
  }
  if (target.type === "USER") {
    return {
      targetType: "USER" as NotificationTargetType,
      roleTarget: null,
      userId: target.userId,
    };
  }
  return {
    targetType: "SHOP" as NotificationTargetType,
    roleTarget: null,
    userId: null,
  };
}

function targetKey(target: NotificationTarget) {
  if (target.type === "USER") return `USER:${target.userId}`;
  if (target.type === "ROLE") return `ROLE:${String(normalizeFixedRole(target.role))}`;
  return "SHOP";
}

export function notificationIdempotencyKey(input: CreateNotificationInput) {
  if (input.idempotencyKey) return input.idempotencyKey;
  return [
    input.shopId,
    input.type,
    input.entityType ?? "GENERAL",
    input.entityId ?? "NONE",
    targetKey(input.target),
  ].join(":");
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

async function resolveNotificationRecipients(input: CreateNotificationInput) {
  const users = await prisma.$queryRaw<Array<{ id: string; role: string }>>(Prisma.sql`
    SELECT "id", "role"::text AS "role"
    FROM "User"
    WHERE "shopId" = ${input.shopId} AND "disabledAt" IS NULL
  `);
  const allowedShopRoles = notificationPolicy(input.type).shopRoles ?? OPERATIONAL_NOTIFICATION_ROLES;
  return users
    .filter((user) => {
      const role = String(normalizeFixedRole(user.role));
      if (input.target.type === "USER") return user.id === input.target.userId;
      if (input.target.type === "ROLE") return role === String(normalizeFixedRole(input.target.role));
      return (allowedShopRoles as readonly string[]).includes(role);
    })
    .map((user) => user.id);
}

function retryPayload(input: CreateNotificationInput): Prisma.InputJsonObject {
  return {
    shopId: input.shopId,
    target: input.target,
    type: input.type,
    title: input.title,
    message: input.message,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    actionUrl: input.actionUrl ?? null,
    metadata: input.metadata ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  };
}

function parseRetryPayload(payload: Prisma.JsonValue): CreateNotificationInput {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new NotificationValidationError("Invalid notification retry payload");
  }
  const value = payload as Prisma.JsonObject;
  const targetValue = value.target;
  if (!targetValue || Array.isArray(targetValue) || typeof targetValue !== "object") {
    throw new NotificationValidationError("Invalid notification retry target");
  }
  const targetObject = targetValue as Prisma.JsonObject;
  let target: NotificationTarget;
  if (targetObject.type === "USER" && typeof targetObject.userId === "string") {
    target = { type: "USER", userId: targetObject.userId };
  } else if (targetObject.type === "ROLE" && typeof targetObject.role === "string") {
    target = { type: "ROLE", role: targetObject.role };
  } else if (targetObject.type === "SHOP") {
    target = { type: "SHOP" };
  } else {
    throw new NotificationValidationError("Invalid notification retry target");
  }

  if (
    typeof value.shopId !== "string" ||
    typeof value.type !== "string" ||
    typeof value.title !== "string" ||
    typeof value.message !== "string"
  ) {
    throw new NotificationValidationError("Invalid notification retry payload");
  }

  return {
    shopId: value.shopId,
    target,
    type: value.type,
    title: value.title,
    message: value.message,
    entityType: typeof value.entityType === "string" ? value.entityType : undefined,
    entityId: typeof value.entityId === "string" ? value.entityId : undefined,
    actionUrl: typeof value.actionUrl === "string" ? value.actionUrl : undefined,
    metadata: value.metadata === null || value.metadata === undefined
      ? undefined
      : value.metadata as Prisma.InputJsonValue,
    idempotencyKey: typeof value.idempotencyKey === "string" ? value.idempotencyKey : undefined,
  };
}

export async function notificationEntityAvailable(shopId: string, entityType?: string | null, entityId?: string | null) {
  if (!entityType || !entityId) return true;
  const where = { id: entityId, shopId };
  switch (entityType) {
    case "ORDER":
      return (await prisma.order.count({ where })) > 0;
    case "TASK":
      return (await prisma.task.count({ where })) > 0;
    case "CHEQUE":
      return (await prisma.cheque.count({ where })) > 0;
    case "FOLLOW_UP":
      return (await prisma.followUp.count({ where })) > 0;
    case "CUSTOMER":
      return (await prisma.customer.count({ where })) > 0;
    case "ATTENDANCE":
      return (await prisma.attendance.count({ where })) > 0;
    case "STAFF_VISIT":
      return (await prisma.staffVisit.count({ where })) > 0;
    default:
      return true;
  }
}

async function validateNotification(input: CreateNotificationInput) {
  if (!input.shopId || !input.type || !input.title || !input.message) {
    throw new NotificationValidationError("Missing required notification fields");
  }

  const shop = await prisma.shop.findUnique({ where: { id: input.shopId }, select: { id: true } });
  if (!shop) throw new NotificationValidationError("Notification shop does not exist");

  if (input.target.type === "USER") {
    const targetUser = await prisma.user.findFirst({
      where: { id: input.target.userId, shopId: input.shopId, disabledAt: null },
      select: { id: true },
    });
    if (!targetUser) throw new NotificationValidationError("Notification target user is outside the shop or inactive");
  }

  if (input.target.type === "ROLE" && !String(normalizeFixedRole(input.target.role)).trim()) {
    throw new NotificationValidationError("Notification target role is invalid");
  }

  if (!(await notificationEntityAvailable(input.shopId, input.entityType, input.entityId))) {
    throw new NotificationValidationError("Notification entity is outside the shop or no longer exists");
  }
}

async function insertNotification(input: CreateNotificationInput) {
  await validateNotification(input);
  const target = targetData(input.target);
  const idempotencyKey = notificationIdempotencyKey(input);

  try {
    return await prisma.notification.upsert({
      where: { idempotencyKey },
      update: {},
      create: {
        shopId: input.shopId,
        ...target,
        type: input.type,
        title: input.title,
        message: input.message,
        entityType: input.entityType ?? "",
        entityId: input.entityId ?? "",
        actionUrl: input.actionUrl,
        metadata: input.metadata,
        idempotencyKey,
        priority: notificationPriority(input.type) as NotificationPriority,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.notification.findUnique({ where: { idempotencyKey } });
      if (existing) return existing;
    }
    throw error;
  }
}

async function markRetrySent(idempotencyKey: string) {
  try {
    await prisma.notificationRetry.updateMany({
      where: { idempotencyKey, status: { in: ["PENDING", "PROCESSING"] } },
      data: { status: "SENT", lastError: null },
    });
  } catch (error) {
    logger.warn("notification_retry_mark_sent_failed", {
      idempotencyKey,
      error: errorMessage(error),
    });
  }
}

async function queueNotificationRetry(input: CreateNotificationInput, error: unknown) {
  try {
    const idempotencyKey = notificationIdempotencyKey(input);
    const existing = await prisma.notificationRetry.findUnique({
      where: { idempotencyKey },
      select: { status: true },
    });
    if (existing?.status === "SENT") return true;
    if (existing?.status === "FAILED") return false;

    await prisma.notificationRetry.upsert({
      where: { idempotencyKey },
      update: {
        payload: retryPayload(input),
        lastError: errorMessage(error),
      },
      create: {
        shopId: input.shopId,
        eventType: input.type,
        entityType: input.entityType ?? "GENERAL",
        entityId: input.entityId ?? idempotencyKey,
        targetUserId: input.target.type === "USER" ? input.target.userId : null,
        targetRole: input.target.type === "ROLE" ? String(normalizeFixedRole(input.target.role)) : null,
        idempotencyKey,
        payload: retryPayload(input),
        retryCount: 0,
        maxRetries: DEFAULT_MAX_RETRIES,
        nextRetryAt: new Date(Date.now() + RETRY_DELAYS_MINUTES[0] * 60 * 1000),
        lastError: errorMessage(error),
      },
    });
    return true;
  } catch (retryError) {
    logger.error("notification_retry_record_failed", {
      event: "notification_retry_record_failed",
      eventType: input.type,
      shopId: input.shopId,
      targetUserId: input.target.type === "USER" ? input.target.userId : null,
      targetRole: input.target.type === "ROLE" ? String(normalizeFixedRole(input.target.role)) : null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      error: errorMessage(retryError),
    });
    return false;
  }
}

export async function safeCreateNotification(input: CreateNotificationInput): Promise<NotificationDeliveryResult> {
  let resolvedRecipients: string[] = [];
  try {
    const idempotencyKey = notificationIdempotencyKey(input);
    resolvedRecipients = await resolveNotificationRecipients(input);
    if (resolvedRecipients.length === 0) {
      throw new NotificationValidationError("Notification event resolved no active same-shop recipients");
    }
    const notification = await insertNotification(input);
    await sendPushForNotification(notification, resolvedRecipients).catch((pushError) => {
      logger.warn("notification_push_dispatch_failed_non_blocking", {
        notificationId: notification.id,
        error: errorMessage(pushError),
      });
    });
    await markRetrySent(idempotencyKey);
    logger.info("notification_created", {
      event: "notification_created",
      eventType: input.type,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      shopId: input.shopId,
      actorUserId: input.actorUserId ?? null,
      resolvedRecipients,
      notificationInsertResult: notification.id,
      retryQueued: false,
      idempotencyKey,
    });
    return {
      success: true,
      queued: true,
      retryQueued: false,
      notificationId: notification.id,
    };
  } catch (error) {
    const validationFailure = error instanceof NotificationValidationError;
    const retryQueued = validationFailure ? false : await queueNotificationRetry(input, error);
    logger.error("notification_creation_failed", {
      event: "notification_creation_failed",
      eventType: input.type,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      shopId: input.shopId,
      actorUserId: input.actorUserId ?? null,
      targetUserId: input.target.type === "USER" ? input.target.userId : null,
      targetRole: input.target.type === "ROLE" ? String(normalizeFixedRole(input.target.role)) : null,
      resolvedRecipients,
      notificationInsertResult: null,
      retryQueued,
      failureReason: errorMessage(error),
    });
    return { success: false, queued: false, retryQueued };
  }
}

export const createNotification = safeCreateNotification;

export async function processNotificationRetries(options: { shopId: string; limit?: number }) {
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
  const now = new Date();
  const nextSweepAt = retrySweepAfterByShop.get(options.shopId) ?? 0;
  if (nextSweepAt > now.getTime()) return { processed: 0, sent: 0, failed: 0 };
  retrySweepAfterByShop.set(options.shopId, now.getTime() + RETRY_SWEEP_THROTTLE_MS);
  const staleBefore = new Date(now.getTime() - PROCESSING_TIMEOUT_MS);

  try {
    await prisma.notificationRetry.updateMany({
      where: {
        shopId: options.shopId,
        status: "PROCESSING",
        updatedAt: { lt: staleBefore },
      },
      data: { status: "PENDING", nextRetryAt: now },
    });

    const retries = await prisma.notificationRetry.findMany({
      where: {
        shopId: options.shopId,
        status: "PENDING",
        nextRetryAt: { lte: now },
      },
      orderBy: { nextRetryAt: "asc" },
      take: limit,
    });

    let sent = 0;
    let failed = 0;
    for (const retry of retries) {
      const claimed = await prisma.notificationRetry.updateMany({
        where: { id: retry.id, shopId: options.shopId, status: "PENDING", nextRetryAt: { lte: now } },
        data: { status: "PROCESSING" },
      });
      if (!claimed.count) continue;

      try {
        const input = parseRetryPayload(retry.payload);
        if (input.shopId !== options.shopId || notificationIdempotencyKey(input) !== retry.idempotencyKey) {
          throw new NotificationValidationError("Retry shop or idempotency key mismatch");
        }
        const notification = await insertNotification(input);
        const recipients = await resolveNotificationRecipients(input);
        await sendPushForNotification(notification, recipients).catch((pushError) => {
          logger.warn("notification_retry_push_dispatch_failed_non_blocking", {
            notificationId: notification.id,
            error: errorMessage(pushError),
          });
        });
        await prisma.notificationRetry.update({
          where: { id: retry.id },
          data: { status: "SENT", lastError: null },
        });
        sent += 1;
      } catch (error) {
        const nextRetryCount = retry.retryCount + 1;
        const exhausted = nextRetryCount >= retry.maxRetries || error instanceof NotificationValidationError;
        const delayIndex = Math.min(nextRetryCount, RETRY_DELAYS_MINUTES.length - 1);
        await prisma.notificationRetry.update({
          where: { id: retry.id },
          data: {
            retryCount: nextRetryCount,
            status: exhausted ? "FAILED" : "PENDING",
            nextRetryAt: exhausted
              ? retry.nextRetryAt
              : new Date(Date.now() + RETRY_DELAYS_MINUTES[delayIndex] * 60 * 1000),
            lastError: errorMessage(error),
          },
        });
        logger.error("notification_retry_failed", {
          event: "notification_retry_failed",
          eventType: retry.eventType,
          shopId: retry.shopId,
          targetUserId: retry.targetUserId,
          targetRole: retry.targetRole,
          entityType: retry.entityType,
          entityId: retry.entityId,
          retryCount: nextRetryCount,
          status: exhausted ? "FAILED" : "PENDING",
          error: errorMessage(error),
        });
        failed += 1;
      }
    }
    return { processed: retries.length, sent, failed };
  } catch (error) {
    logger.error("notification_retry_worker_failed", {
      event: "notification_retry_worker_failed",
      shopId: options.shopId,
      error: errorMessage(error),
    });
    return { processed: 0, sent: 0, failed: 0 };
  }
}

function taskDueText(value: Date) {
  return value.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export async function generateTaskOverdueNotifications(shopId: string) {
  const now = new Date();
  const nextSweepAt = overdueSweepAfterByShop.get(shopId) ?? 0;
  if (nextSweepAt > now.getTime()) return { checked: 0, generated: 0 };
  overdueSweepAfterByShop.set(shopId, now.getTime() + OVERDUE_SWEEP_THROTTLE_MS);

  try {
    const tasks = await prisma.task.findMany({
      where: {
        shopId,
        dueDate: { lt: now },
        status: { notIn: ["COMPLETED", "CANCELLED"] },
        linkedFollowUpId: null,
      },
      select: {
        id: true,
        taskType: true,
        title: true,
        dueDate: true,
        assignedToId: true,
        assignedById: true,
        customer: { select: { partyName: true } },
        assignedBy: { select: { role: true } },
      },
      orderBy: { dueDate: "asc" },
      take: 100,
    });

    const candidates = tasks.flatMap((task) => {
      const targets = [task.assignedToId];
      if (
        task.assignedById !== task.assignedToId &&
        String(normalizeFixedRole(task.assignedBy.role)) === "SHOP_ADMIN"
      ) {
        targets.push(task.assignedById);
      }
      return targets.map((userId) => ({
        task,
        userId,
        idempotencyKey: notificationIdempotencyKey({
          shopId,
          target: { type: "USER", userId },
          type: "TASK_OVERDUE",
          title: "Task Overdue",
          message: "Task overdue",
          entityType: "TASK",
          entityId: task.id,
        }),
      }));
    });

    const keys = candidates.map((candidate) => candidate.idempotencyKey);
    const [existingNotifications, existingRetries] = keys.length > 0
      ? await Promise.all([
          prisma.notification.findMany({
            where: { idempotencyKey: { in: keys } },
            select: { idempotencyKey: true },
          }),
          prisma.notificationRetry.findMany({
            where: { idempotencyKey: { in: keys }, status: { in: ["PENDING", "PROCESSING", "SENT"] } },
            select: { idempotencyKey: true },
          }),
        ])
      : [[], []];
    const existingKeys = new Set([
      ...existingNotifications.map((item) => item.idempotencyKey),
      ...existingRetries.map((item) => item.idempotencyKey),
    ]);

    let generated = 0;
    for (const candidate of candidates) {
      if (existingKeys.has(candidate.idempotencyKey)) continue;
      const taskLabel = taskTypeLabels[candidate.task.taskType as keyof typeof taskTypeLabels] ?? candidate.task.title;
      const result = await safeCreateNotification({
        shopId,
        target: { type: "USER", userId: candidate.userId },
        type: "TASK_OVERDUE",
        title: "Task Overdue",
        message: [
          taskLabel,
          candidate.task.customer?.partyName ? `Customer: ${candidate.task.customer.partyName}` : "",
          `Due: ${taskDueText(candidate.task.dueDate)}`,
          "Immediate action required.",
        ].filter(Boolean).join("\n"),
        entityType: "TASK",
        entityId: candidate.task.id,
        actionUrl: taskUrl(candidate.task.id),
        metadata: {
          taskTypeLabel: taskLabel,
          customerName: candidate.task.customer?.partyName ?? null,
          dueDate: candidate.task.dueDate.toISOString(),
        },
      });
      if (result.success || result.retryQueued) generated += 1;
    }
    return { checked: tasks.length, generated };
  } catch (error) {
    logger.error("task_overdue_notification_sweep_failed", {
      event: "task_overdue_notification_sweep_failed",
      shopId,
      error: errorMessage(error),
    });
    return { checked: 0, generated: 0 };
  }
}

export async function notifyOrderCreated(input: {
  shopId: string;
  orderId: string;
  customerName: string;
  createdById?: string;
  createdByName: string;
  amountText?: string | null;
}) {
  const shopNotification = await safeCreateNotification({
    shopId: input.shopId,
    actorUserId: input.createdById,
    target: { type: "SHOP" },
    type: "ORDER_CREATED",
    title: "New Order Received",
    message: `${input.customerName}\nCreated by: ${input.createdByName}${input.amountText ? `\n${input.amountText}` : ""}`,
    entityType: "ORDER",
    entityId: input.orderId,
    actionUrl: orderUrl(input.orderId),
    metadata: { customerName: input.customerName, createdByName: input.createdByName, amountText: input.amountText ?? null },
  });
  return shopNotification;
}

export async function notifyOrderStatusChanged(input: {
  shopId: string;
  orderId: string;
  type: "ORDER_DISPATCHED" | "ORDER_DELIVERED";
  customerName: string;
  actorName: string;
}) {
  return safeCreateNotification({
    shopId: input.shopId,
    target: { type: "SHOP" },
    type: input.type,
    title: input.type === "ORDER_DISPATCHED" ? "Order Dispatched" : "Order Delivered",
    message: `${input.customerName}\nUpdated by: ${input.actorName}`,
    entityType: "ORDER",
    entityId: input.orderId,
    actionUrl: orderUrl(input.orderId),
    metadata: { customerName: input.customerName, actorName: input.actorName },
  });
}

export async function notifyChequeEvent(input: {
  shopId: string;
  chequeId: string;
  actorUserId?: string;
  type: "CHEQUE_COLLECTED" | "CHEQUE_DEPOSITED" | "CHEQUE_BOUNCED" | "CHEQUE_RETURNED";
  title: string;
  customerName: string;
  chequeNumber: string;
  amount: number;
  actorName: string;
  restoredOutstanding?: number;
  target?: NotificationTarget;
}) {
  const bounced = input.type === "CHEQUE_BOUNCED";
  return safeCreateNotification({
    shopId: input.shopId,
    actorUserId: input.actorUserId,
    target: input.target ?? { type: "SHOP" },
    type: input.type,
    title: input.title,
    message: `${input.customerName}\nCheque: ${input.chequeNumber}\n${bounced ? "Cheque Amount" : "Amount"}: ${new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(input.amount)}${bounced && input.restoredOutstanding !== undefined ? `\nOutstanding restored to: ${new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(input.restoredOutstanding)}` : ""}\nBy: ${input.actorName}${bounced ? "\nImmediate action required." : ""}`,
    entityType: "CHEQUE",
    entityId: input.chequeId,
    actionUrl: chequeUrl(input.chequeId),
    metadata: {
      customerName: input.customerName,
      chequeNumber: input.chequeNumber,
      amount: input.amount,
      restoredOutstanding: input.restoredOutstanding,
      actorName: input.actorName,
    },
  });
}

export async function notifyFollowUpCompleted(input: {
  shopId: string;
  followUpId: string;
  customerId: string;
  customerName: string;
  completedByName: string;
}) {
  return safeCreateNotification({
    shopId: input.shopId,
    target: { type: "SHOP" },
    type: "FOLLOW_UP_COMPLETED",
    title: "Follow-up Completed",
    message: `${input.customerName}\nCompleted by: ${input.completedByName}`,
    entityType: "FOLLOW_UP",
    entityId: input.followUpId,
    actionUrl: followUpUrl(input.customerId),
    metadata: { customerId: input.customerId, customerName: input.customerName, completedByName: input.completedByName },
  });
}

export async function notifyCustomerAdded(input: {
  shopId: string;
  customerId: string;
  customerName: string;
  createdByName: string;
}) {
  return safeCreateNotification({
    shopId: input.shopId,
    target: { type: "SHOP" },
    type: "CUSTOMER_ADDED",
    title: "New Customer Added",
    message: `${input.customerName}\nCreated by: ${input.createdByName}`,
    entityType: "CUSTOMER",
    entityId: input.customerId,
    actionUrl: customerUrl(input.customerId),
    metadata: { customerName: input.customerName, createdByName: input.createdByName },
  });
}

export async function notifyCustomerArchived(input: {
  shopId: string;
  customerId: string;
  customerName: string;
  archivedByName: string;
}) {
  return safeCreateNotification({
    shopId: input.shopId,
    target: { type: "SHOP" },
    type: "CUSTOMER_ARCHIVED",
    title: "Customer Archived",
    message: `${input.customerName}\nArchived by: ${input.archivedByName}`,
    entityType: "CUSTOMER",
    entityId: input.customerId,
    actionUrl: "/customers?view=archived",
    metadata: { customerName: input.customerName, archivedByName: input.archivedByName },
  });
}

export async function notifyCustomerArchiveBatch(input: {
  shopId: string;
  batchId: string;
  count: number;
  archivedByName: string;
}) {
  return safeCreateNotification({
    shopId: input.shopId,
    target: { type: "SHOP" },
    type: "CUSTOMERS_ARCHIVED",
    title: "Customers Archived",
    message: `${input.count} customer${input.count === 1 ? "" : "s"} archived\nArchived by: ${input.archivedByName}`,
    entityType: "CUSTOMER_ARCHIVE_BATCH",
    entityId: input.batchId,
    actionUrl: "/customers?view=archived",
    metadata: { count: input.count, archivedByName: input.archivedByName },
  });
}

export async function notifyAttendanceEvent(input: {
  shopId: string;
  attendanceId: string;
  type: "STAFF_CHECK_IN" | "STAFF_CHECK_OUT";
  title: string;
  staffName: string;
}) {
  return safeCreateNotification({
    shopId: input.shopId,
    target: { type: "ROLE", role: "SHOP_ADMIN" },
    type: input.type,
    title: input.title,
    message: input.staffName,
    entityType: "ATTENDANCE",
    entityId: input.attendanceId,
    actionUrl: attendanceUrl(),
    metadata: { staffName: input.staffName },
  });
}

export async function notifyTaskAssigned(input: {
  shopId: string;
  taskId: string;
  assignedToId: string;
  assignedById?: string;
  taskTypeLabel: string;
  customerName?: string | null;
  dueDate: Date;
  assignedByName: string;
}) {
  return safeCreateNotification({
    shopId: input.shopId,
    actorUserId: input.assignedById,
    target: { type: "USER", userId: input.assignedToId },
    type: "TASK_ASSIGNED",
    title: "Task Assigned To You",
    message: [
      input.taskTypeLabel,
      input.customerName ? `Customer: ${input.customerName}` : "",
      `Due: ${input.dueDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
      `Assigned by: ${input.assignedByName}`,
    ].filter(Boolean).join("\n"),
    entityType: "TASK",
    entityId: input.taskId,
    actionUrl: taskUrl(input.taskId),
    metadata: {
      taskTypeLabel: input.taskTypeLabel,
      customerName: input.customerName ?? null,
      dueDate: input.dueDate.toISOString(),
      assignedByName: input.assignedByName,
    },
  });
}

export async function notifyTaskCompleted(input: {
  shopId: string;
  taskId: string;
  assignedById: string;
  taskTypeLabel: string;
  customerName?: string | null;
  completedByName: string;
}) {
  return safeCreateNotification({
    shopId: input.shopId,
    target: { type: "USER", userId: input.assignedById },
    type: "TASK_COMPLETED",
    title: "Task Completed",
    message: [
      input.taskTypeLabel,
      input.customerName ? `Customer: ${input.customerName}` : "",
      `Completed by: ${input.completedByName}`,
    ].filter(Boolean).join("\n"),
    entityType: "TASK",
    entityId: input.taskId,
    actionUrl: taskUrl(input.taskId),
    metadata: {
      taskTypeLabel: input.taskTypeLabel,
      customerName: input.customerName ?? null,
      completedByName: input.completedByName,
    },
  });
}

export async function notifyOrderFollowUpDue(input: {
  shopId: string;
  followUpId: string;
  recipientUserId: string;
  customerName: string;
  reminderAt: Date;
  notes?: string | null;
}) {
  const reminderLabel = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(input.reminderAt);
  const occurrence = input.reminderAt.toISOString();
  return safeCreateNotification({
    shopId: input.shopId,
    target: { type: "USER", userId: input.recipientUserId },
    type: "ORDER_FOLLOW_UP_DUE",
    title: "Order Follow-up Due",
    message: [
      `Call ${input.customerName} for an order follow-up.`,
      `Reminder: ${reminderLabel}`,
      input.notes ? `Note: ${input.notes}` : "",
    ].filter(Boolean).join("\n"),
    entityType: "FOLLOW_UP",
    entityId: input.followUpId,
    actionUrl: `/today-follow-ups?followUpId=${encodeURIComponent(input.followUpId)}`,
    metadata: {
      customerName: input.customerName,
      reminderAt: occurrence,
      notes: input.notes ?? null,
    },
    idempotencyKey: [
      input.shopId,
      "ORDER_FOLLOW_UP_DUE",
      input.followUpId,
      occurrence,
      input.recipientUserId,
    ].join(":"),
  });
}

export async function notifyCustomerTaskDue(input: {
  shopId: string;
  taskId: string;
  followUpId: string;
  recipientUserId: string;
  taskTypeLabel: string;
  customerName: string;
  reminderAt: Date;
  notes?: string | null;
}) {
  const reminderLabel = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(input.reminderAt);
  const occurrence = input.reminderAt.toISOString();
  return safeCreateNotification({
    shopId: input.shopId,
    target: { type: "USER", userId: input.recipientUserId },
    type: "CUSTOMER_TASK_DUE",
    title: `${input.taskTypeLabel} Due`,
    message: [
      `Customer: ${input.customerName}`,
      `Reminder: ${reminderLabel}`,
      input.notes ? `Note: ${input.notes}` : "",
    ].filter(Boolean).join("\n"),
    entityType: "TASK",
    entityId: input.taskId,
    actionUrl: `/tasks?taskId=${encodeURIComponent(input.taskId)}`,
    metadata: {
      followUpId: input.followUpId,
      customerName: input.customerName,
      taskTypeLabel: input.taskTypeLabel,
      reminderAt: occurrence,
      notes: input.notes ?? null,
    },
    idempotencyKey: [
      input.shopId,
      "CUSTOMER_TASK_DUE",
      input.taskId,
      occurrence,
      input.recipientUserId,
    ].join(":"),
  });
}

export async function notifyTaskReassigned(input: {
  shopId: string;
  taskId: string;
  assignedToId: string;
  taskTypeLabel: string;
  reassignedByName: string;
}) {
  return safeCreateNotification({
    shopId: input.shopId,
    target: { type: "USER", userId: input.assignedToId },
    type: "TASK_REASSIGNED",
    title: "Task Reassigned To You",
    message: `${input.taskTypeLabel}\nReassigned by: ${input.reassignedByName}`,
    entityType: "TASK",
    entityId: input.taskId,
    actionUrl: taskUrl(input.taskId),
    metadata: { taskTypeLabel: input.taskTypeLabel, reassignedByName: input.reassignedByName },
  });
}

export async function notifyExcelUploadCompleted(input: {
  shopId: string;
  importId: string;
  uploadedById: string;
  created: number;
  updated: number;
  skipped: number;
  uploadedByName: string;
}) {
  return safeCreateNotification({
    shopId: input.shopId,
    target: { type: "USER", userId: input.uploadedById },
    type: "EXCEL_UPLOAD_COMPLETED",
    title: "Excel Upload Complete",
    message: `Created: ${input.created}\nUpdated: ${input.updated}\nSkipped: ${input.skipped}`,
    entityType: "IMPORT",
    entityId: input.importId,
    actionUrl: "/upload",
    metadata: {
      created: input.created,
      updated: input.updated,
      skipped: input.skipped,
      uploadedByName: input.uploadedByName,
    },
  });
}
