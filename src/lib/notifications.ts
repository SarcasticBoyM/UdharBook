import { Prisma, type NotificationTargetType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeFixedRole } from "@/lib/operational-roles";
import { logger } from "@/lib/logger";

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

export type NotificationActor = {
  id: string;
  name: string;
  role: string;
  shopId: string;
};

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

export async function createNotification(input: CreateNotificationInput) {
  const target = targetData(input.target);
  try {
    return await prisma.notification.upsert({
      where: {
        shopId_type_entityType_entityId: {
          shopId: input.shopId,
          type: input.type,
          entityType: input.entityType ?? "",
          entityId: input.entityId ?? "",
        },
      },
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
      },
    });
  } catch (error) {
    logger.error("notification_create_failed_non_blocking", {
      shopId: input.shopId,
      type: input.type,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      target: input.target,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function notifyOrderCreated(input: {
  shopId: string;
  orderId: string;
  customerName: string;
  createdByName: string;
  amountText?: string | null;
}) {
  return createNotification({
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
  return createNotification({
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
  return createNotification({
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
  return createNotification({
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

export async function notifyAttendanceEvent(input: {
  shopId: string;
  attendanceId: string;
  type: "STAFF_CHECK_IN" | "STAFF_CHECK_OUT";
  title: string;
  staffName: string;
}) {
  return createNotification({
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

