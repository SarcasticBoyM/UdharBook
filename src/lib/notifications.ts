import { Prisma, type NotificationTargetType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeFixedRole } from "@/lib/operational-roles";
import { logger } from "@/lib/logger";

const RETRY_DELAYS_MINUTES = [1, 5, 30, 120] as const;
const DEFAULT_MAX_RETRIES = RETRY_DELAYS_MINUTES.length;
const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;
const RETRY_SWEEP_THROTTLE_MS = 30 * 1000;
const retrySweepAfterByShop = new Map<string, number>();

export type NotificationTarget =
  | { type: "SHOP" }
  | { type: "ROLE"; role: string }
  | { type: "USER"; userId: string };

export type CreateNotificationInput = {
  shopId: string;
  target: NotificationTarget;
  type: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
  metadata?: Prisma.InputJsonValue;
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
  };
}

async function entityBelongsToShop(input: CreateNotificationInput) {
  if (!input.entityType || !input.entityId) return true;
  const where = { id: input.entityId, shopId: input.shopId };
  switch (input.entityType) {
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

  if (!(await entityBelongsToShop(input))) {
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
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.notification.findFirst({
        where: {
          shopId: input.shopId,
          type: input.type,
          entityType: input.entityType ?? "",
          entityId: input.entityId ?? "",
        },
      });
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
  try {
    const idempotencyKey = notificationIdempotencyKey(input);
    const notification = await insertNotification(input);
    await markRetrySent(idempotencyKey);
    return {
      success: true,
      queued: true,
      retryQueued: false,
      notificationId: notification.id,
    };
  } catch (error) {
    const validationFailure = error instanceof NotificationValidationError;
    logger.error("notification_creation_failed", {
      event: "notification_creation_failed",
      eventType: input.type,
      shopId: input.shopId,
      targetUserId: input.target.type === "USER" ? input.target.userId : null,
      targetRole: input.target.type === "ROLE" ? String(normalizeFixedRole(input.target.role)) : null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      error: errorMessage(error),
    });
    const retryQueued = validationFailure ? false : await queueNotificationRetry(input, error);
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
        await insertNotification(input);
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

export async function notifyOrderCreated(input: {
  shopId: string;
  orderId: string;
  customerName: string;
  createdByName: string;
  amountText?: string | null;
}) {
  return safeCreateNotification({
    shopId: input.shopId,
    target: { type: "SHOP" },
    type: "ORDER_CREATED",
    title: "New Order Received",
    message: `${input.customerName}\nCreated by: ${input.createdByName}${input.amountText ? `\n${input.amountText}` : ""}`,
    entityType: "ORDER",
    entityId: input.orderId,
    actionUrl: orderUrl(input.orderId),
    metadata: { customerName: input.customerName, createdByName: input.createdByName, amountText: input.amountText ?? null },
  });
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
  type: "CHEQUE_COLLECTED" | "CHEQUE_DEPOSITED" | "CHEQUE_BOUNCED" | "CHEQUE_RETURNED";
  title: string;
  customerName: string;
  chequeNumber: string;
  amount: number;
  actorName: string;
}) {
  return safeCreateNotification({
    shopId: input.shopId,
    target: { type: "SHOP" },
    type: input.type,
    title: input.title,
    message: `${input.customerName}\nCheque: ${input.chequeNumber}\nAmount: ${new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(input.amount)}\nBy: ${input.actorName}`,
    entityType: "CHEQUE",
    entityId: input.chequeId,
    actionUrl: chequeUrl(input.chequeId),
    metadata: {
      customerName: input.customerName,
      chequeNumber: input.chequeNumber,
      amount: input.amount,
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
  taskTypeLabel: string;
  customerName?: string | null;
  dueDate: Date;
  assignedByName: string;
}) {
  return safeCreateNotification({
    shopId: input.shopId,
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
