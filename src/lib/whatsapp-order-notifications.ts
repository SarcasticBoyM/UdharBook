import type { Order, OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export const ORDER_WHATSAPP_EVENTS = [
  "ORDER_CREATED",
  "ORDER_EDITED",
  "ORDER_DISPATCHED",
  "ORDER_DELIVERED",
  "ORDER_CANCELLED",
] as const;

export type OrderWhatsAppEvent = (typeof ORDER_WHATSAPP_EVENTS)[number];

type OrderForNotification = Pick<Order, "id" | "shopId" | "orderDetails" | "preferredDeliveryDate" | "priority" | "status"> & {
  customer: { partyName: string; contactNumber: string };
  createdBy: { name: string };
};

function displayDate(value?: Date | null) {
  if (!value) return "-";
  return value.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function actorLine(event: OrderWhatsAppEvent) {
  if (event === "ORDER_CREATED") return "Created By";
  if (event === "ORDER_DISPATCHED") return "Dispatched By";
  if (event === "ORDER_DELIVERED") return "Delivered By";
  if (event === "ORDER_CANCELLED") return "Cancelled By";
  return "Edited By";
}

function titleForEvent(event: OrderWhatsAppEvent) {
  if (event === "ORDER_CREATED") return "NEW ORDER RECEIVED";
  if (event === "ORDER_EDITED") return "ORDER EDITED";
  if (event === "ORDER_DISPATCHED") return "ORDER DISPATCHED";
  if (event === "ORDER_DELIVERED") return "ORDER DELIVERED";
  return "ORDER CANCELLED";
}

function iconForEvent(event: OrderWhatsAppEvent) {
  if (event === "ORDER_CREATED") return "📦";
  if (event === "ORDER_DISPATCHED") return "🚚";
  if (event === "ORDER_DELIVERED") return "✅";
  if (event === "ORDER_CANCELLED") return "❌";
  return "✏️";
}

export function eventForOrderAction(action: string, status?: OrderStatus | string | null): OrderWhatsAppEvent {
  if (action === "CREATED") return "ORDER_CREATED";
  if (action === "EDIT" || action === "EDITED") return "ORDER_EDITED";
  if (action === "DISPATCH" || status === "DISPATCHED" || status === "PROCESSING") return "ORDER_DISPATCHED";
  if (action === "DELIVER" || status === "DELIVERED") return "ORDER_DELIVERED";
  return "ORDER_CANCELLED";
}

export function formatOrderWhatsAppMessage(input: {
  event: OrderWhatsAppEvent;
  order: OrderForNotification;
  actorName: string;
  notes?: string | null;
}) {
  const { event, order, actorName, notes } = input;
  if (event === "ORDER_DISPATCHED") {
    return [
      "🚚 ORDER DISPATCHED",
      "",
      "Customer:",
      order.customer.partyName,
      "",
      notes?.trim() ? `Vehicle:\n${notes.trim()}\n` : null,
      "Dispatched By:",
      actorName,
    ].filter(Boolean).join("\n");
  }

  if (event === "ORDER_DELIVERED") {
    return ["✅ ORDER DELIVERED", "", "Customer:", order.customer.partyName, "", "Delivered By:", actorName].join("\n");
  }

  if (event === "ORDER_CANCELLED") {
    return ["❌ ORDER CANCELLED", "", "Customer:", order.customer.partyName, "", "Cancelled By:", actorName].join("\n");
  }

  return [
    `${iconForEvent(event)} ${titleForEvent(event)}`,
    "",
    "👤 Customer:",
    order.customer.partyName,
    "",
    "📞 Contact:",
    order.customer.contactNumber,
    "",
    "🛒 Order:",
    order.orderDetails,
    "",
    "🚚 Delivery:",
    displayDate(order.preferredDeliveryDate),
    "",
    "⚡ Priority:",
    order.priority,
    "",
    `👨 ${actorLine(event)}:`,
    actorName,
  ].join("\n");
}

export async function enqueueOrderWhatsAppNotification(input: {
  requestId: string;
  shopId: string;
  order: OrderForNotification;
  event: OrderWhatsAppEvent;
  actorName: string;
  notes?: string | null;
}) {
  try {
    const setting = await prisma.whatsAppOrderNotificationSetting.findUnique({ where: { shopId: input.shopId } });
    if (!setting?.enabled || !setting.groupJid) return null;
    if (!setting.selectedEvents.includes(input.event)) return null;

    const message = formatOrderWhatsAppMessage({
      event: input.event,
      order: input.order,
      actorName: input.actorName,
      notes: input.notes,
    });

    return await prisma.whatsAppNotificationJob.create({
      data: {
        shopId: input.shopId,
        orderId: input.order.id,
        event: input.event,
        targetGroupJid: setting.groupJid,
        targetGroupName: setting.groupName,
        message,
        payload: {
          orderId: input.order.id,
          customerName: input.order.customer.partyName,
          contactNumber: input.order.customer.contactNumber,
          orderDetails: input.order.orderDetails,
          priority: input.order.priority,
          preferredDeliveryDate: input.order.preferredDeliveryDate?.toISOString() ?? null,
          status: input.order.status,
          actorName: input.actorName,
        } satisfies Prisma.InputJsonObject,
      },
    });
  } catch (error) {
    logger.error("order_whatsapp_enqueue_failed_non_blocking", {
      requestId: input.requestId,
      shopId: input.shopId,
      orderId: input.order.id,
      event: input.event,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return null;
  }
}
