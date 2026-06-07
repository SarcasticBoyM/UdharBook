import { NextResponse } from "next/server";
import { z } from "zod";
import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { logger } from "@/lib/logger";

const receivedStatuses: OrderStatus[] = ["ORDER_RECEIVED", "PENDING"];
const dispatchedStatuses: OrderStatus[] = ["DISPATCHED", "PROCESSING"];
const finalStatuses: OrderStatus[] = ["DELIVERED", "CANCELLED"];
const activeStatuses: OrderStatus[] = [...receivedStatuses, ...dispatchedStatuses];

const prioritySchema = z.enum(["Normal", "High", "Urgent"]);

const createSchema = z.object({
  customerId: z.string().min(1),
  orderDetails: z.string().trim().min(1),
  preferredDeliveryDate: z.string().optional().nullable(),
  priority: prioritySchema.default("Normal"),
});

const patchSchema = z.object({
  orderId: z.string().min(1),
  action: z.enum(["EDIT", "DISPATCH", "DELIVER", "CANCEL"]).optional(),
  status: z.enum(["ORDER_RECEIVED", "DISPATCHED", "PENDING", "PROCESSING", "DELIVERED", "CANCELLED"]).optional(),
  orderDetails: z.string().trim().min(1).optional(),
  preferredDeliveryDate: z.string().optional().nullable(),
  priority: prioritySchema.optional(),
});

const statusRank: Record<OrderStatus, number> = {
  ORDER_RECEIVED: 0,
  PENDING: 0,
  DISPATCHED: 1,
  PROCESSING: 1,
  DELIVERED: 3,
  CANCELLED: 4,
};

const priorityRank: Record<string, number> = {
  High: 0,
  Urgent: 1,
  Normal: 2,
};

function isOrderManager(role: string) {
  return role === "SHOP_ADMIN" || role === "STAFF";
}

function parseOptionalDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_DATE");
  return parsed;
}

function normalizeRequestedStatus(status?: OrderStatus) {
  if (!status) return null;
  if (status === "PENDING") return "ORDER_RECEIVED";
  if (status === "PROCESSING") return "DISPATCHED";
  return status;
}

function actionForStatus(status?: OrderStatus) {
  const normalized = normalizeRequestedStatus(status);
  if (normalized === "DISPATCHED") return "DISPATCH";
  if (normalized === "DELIVERED") return "DELIVER";
  if (normalized === "CANCELLED") return "CANCEL";
  return "EDIT";
}

function sortOrders<T extends { status: OrderStatus; priority: string; preferredDeliveryDate: Date | null; createdAt: Date }>(orders: T[]) {
  return orders.sort((a, b) => {
    const statusDiff = statusRank[a.status] - statusRank[b.status];
    if (statusDiff) return statusDiff;
    if (activeStatuses.includes(a.status)) {
      const priorityDiff = (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2);
      if (priorityDiff) return priorityDiff;
      const aDelivery = a.preferredDeliveryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bDelivery = b.preferredDeliveryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (aDelivery !== bDelivery) return aDelivery - bDelivery;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

function transitionStatus(current: OrderStatus, action: string) {
  if (finalStatuses.includes(current)) throw new Error("ORDER_READ_ONLY");

  if (action === "EDIT") {
    if (!receivedStatuses.includes(current)) throw new Error("ONLY_RECEIVED_ORDERS_CAN_BE_EDITED");
    return current;
  }
  if (action === "DISPATCH") {
    if (!receivedStatuses.includes(current)) throw new Error("ONLY_RECEIVED_ORDERS_CAN_BE_DISPATCHED");
    return "DISPATCHED" as OrderStatus;
  }
  if (action === "DELIVER") {
    if (!dispatchedStatuses.includes(current)) throw new Error("ONLY_DISPATCHED_ORDERS_CAN_BE_DELIVERED");
    return "DELIVERED" as OrderStatus;
  }
  if (action === "CANCEL") return "CANCELLED" as OrderStatus;
  throw new Error("INVALID_ORDER_ACTION");
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = requireShopId(request, session);
  const { searchParams } = new URL(request.url);
  const filter = searchParams.get("filter") ?? "all";
  const now = new Date();
  const upcoming = new Date(now);
  upcoming.setDate(upcoming.getDate() + 7);

  const where: Prisma.OrderWhereInput = { shopId };
  if (session.role === "FIELD_SALES") where.createdById = session.id;
  if (filter === "pending") where.status = { in: receivedStatuses };
  if (filter === "dispatched") where.status = { in: dispatchedStatuses };
  if (filter === "delivered") where.status = "DELIVERED";
  if (filter === "cancelled") where.status = "CANCELLED";
  if (filter === "high") where.priority = "High";
  if (filter === "upcoming") {
    where.status = { in: activeStatuses };
    where.preferredDeliveryDate = { gte: now, lte: upcoming };
  }
  if (filter === "sales") where.visitSource = "Sales Visit";
  if (filter === "lead") where.visitSource = { in: ["New Lead Visit", "Prospect Visit"] };
  const summaryScope: Prisma.OrderWhereInput = session.role === "FIELD_SALES" ? { shopId, createdById: session.id } : { shopId };

  const [orders, pendingOrders, dispatchedOrders, highPriorityOrders, deliveredToday, cancelledOrders, upcomingDeliveries] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      include: {
        customer: { select: { partyName: true, contactNumber: true } },
        createdBy: { select: { name: true, role: true } },
      },
      take: 300,
    }),
    prisma.order.count({ where: { ...summaryScope, status: { in: receivedStatuses } } }),
    prisma.order.count({ where: { ...summaryScope, status: { in: dispatchedStatuses } } }),
    prisma.order.count({ where: { ...summaryScope, status: { in: activeStatuses }, priority: "High" } }),
    prisma.order.count({
      where: {
        ...summaryScope,
        status: "DELIVERED",
        deliveredAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) },
      },
    }),
    prisma.order.count({ where: { ...summaryScope, status: "CANCELLED" } }),
    prisma.order.count({
      where: {
        ...summaryScope,
        status: { in: activeStatuses },
        preferredDeliveryDate: { gte: now, lte: upcoming },
      },
    }),
  ]);

  return NextResponse.json({
    orders: sortOrders(orders),
    summary: { pendingOrders, dispatchedOrders, highPriorityOrders, deliveredToday, cancelledOrders, upcomingDeliveries },
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOrderManager(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = requireShopId(request, session);
  try {
    const body = createSchema.parse(await request.json());
    const preferredDeliveryDate = parseOptionalDate(body.preferredDeliveryDate);
    const order = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: body.customerId, shopId }, select: { id: true } });
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

      const created = await tx.order.create({
        data: {
          shopId,
          customerId: customer.id,
          createdById: session.id,
          orderDetails: body.orderDetails,
          preferredDeliveryDate,
          priority: body.priority,
          status: "ORDER_RECEIVED",
          sourceModule: "ORDER_DESK",
          visitSource: "Order Desk",
        },
      });
      await tx.orderActivity.create({
        data: {
          shopId,
          orderId: created.id,
          userId: session.id,
          action: "order_created",
          newStatus: created.status,
          notes: "Order created from Order Desk",
        },
      });
      await tx.activityLog.create({
        data: {
          shopId,
          userId: session.id,
          customerId: customer.id,
          action: "order_created",
          details: "Order created from Order Desk",
        },
      });
      return created;
    });
    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    logger.warn("order_create_failed", {
      userId: session.id,
      shopId,
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error && error.message === "CUSTOMER_NOT_FOUND" ? "Customer was not found for this shop." : "Could not create order.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOrderManager(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = requireShopId(request, session);
  try {
    const body = patchSchema.parse(await request.json());
    const action = body.action ?? actionForStatus(body.status as OrderStatus | undefined);
    const preferredDeliveryDate = body.preferredDeliveryDate === undefined ? undefined : parseOptionalDate(body.preferredDeliveryDate);
    const now = new Date();

    const order = await prisma.$transaction(async (tx) => {
      const existing = await tx.order.findFirst({
        where: { id: body.orderId, shopId },
        select: { id: true, customerId: true, status: true, deliveredAt: true, cancelledAt: true },
      });
      if (!existing) throw new Error("ORDER_NOT_FOUND");

      const nextStatus = transitionStatus(existing.status, action);
      const isEdit = action === "EDIT";
      const updated = await tx.order.update({
        where: { id: existing.id },
        data: {
          ...(body.orderDetails ? { orderDetails: body.orderDetails } : {}),
          ...(preferredDeliveryDate !== undefined ? { preferredDeliveryDate } : {}),
          ...(body.priority ? { priority: body.priority } : {}),
          status: nextStatus,
          deliveredAt: nextStatus === "DELIVERED" ? now : existing.deliveredAt,
          cancelledAt: nextStatus === "CANCELLED" ? now : existing.cancelledAt,
        },
        include: {
          customer: { select: { id: true, partyName: true, contactNumber: true } },
          createdBy: { select: { name: true, role: true } },
        },
      });

      await tx.orderActivity.create({
        data: {
          shopId,
          orderId: updated.id,
          userId: session.id,
          action: isEdit ? "order_edited" : `order_${nextStatus.toLowerCase()}`,
          previousStatus: existing.status,
          newStatus: updated.status,
          notes: isEdit ? "Order details edited" : `Order moved from ${existing.status} to ${updated.status}`,
        },
      });
      await tx.activityLog.create({
        data: {
          shopId,
          userId: session.id,
          customerId: updated.customerId,
          action: isEdit ? "order_edited" : "order_status_updated",
          details: isEdit ? "Order details edited" : `Order status changed from ${existing.status} to ${updated.status}`,
        },
      });
      return updated;
    });
    return NextResponse.json({ order });
  } catch (error) {
    logger.warn("order_update_failed", {
      userId: session.id,
      shopId,
      error: error instanceof Error ? error.message : String(error),
    });
    const message =
      error instanceof Error && error.message === "ORDER_READ_ONLY"
        ? "Delivered or cancelled orders are read-only."
        : error instanceof Error && error.message === "ONLY_RECEIVED_ORDERS_CAN_BE_EDITED"
          ? "Only received orders can be edited."
          : error instanceof Error && error.message === "ONLY_RECEIVED_ORDERS_CAN_BE_DISPATCHED"
            ? "Only received orders can be dispatched."
            : error instanceof Error && error.message === "ONLY_DISPATCHED_ORDERS_CAN_BE_DELIVERED"
              ? "Only dispatched orders can be marked delivered."
              : "Could not update order.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
