import { NextResponse } from "next/server";
import { z } from "zod";
import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { logger } from "@/lib/logger";

const finalStatuses = ["DELIVERED", "CANCELLED"];
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

const statusRank: Record<string, number> = {
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

function isOrderOperator(role: string) {
  return role === "SHOP_ADMIN" || role === "STAFF" || role === "FIELD_SALES";
}

function parseOptionalDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_DATE");
  return parsed;
}

function normalizeStatus(status?: string | null) {
  if (!status) return null;
  if (status === "PENDING") return "ORDER_RECEIVED";
  if (status === "PROCESSING") return "DISPATCHED";
  return status;
}

function actionForStatus(status?: OrderStatus) {
  const normalized = normalizeStatus(status);
  if (normalized === "DISPATCHED") return "DISPATCH";
  if (normalized === "DELIVERED") return "DELIVER";
  if (normalized === "CANCELLED") return "CANCEL";
  return "EDIT";
}

function isReceivedStatus(status: string) {
  return normalizeStatus(status) === "ORDER_RECEIVED";
}

function isDispatchedStatus(status: string) {
  return normalizeStatus(status) === "DISPATCHED";
}

function isActiveStatus(status: string) {
  return isReceivedStatus(status) || isDispatchedStatus(status);
}

function sortOrders<T extends { status: OrderStatus; priority: string; preferredDeliveryDate: Date | null; createdAt: Date }>(orders: T[]) {
  return orders.sort((a, b) => {
    const statusDiff = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    if (statusDiff) return statusDiff;
    if (isActiveStatus(a.status)) {
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
  const normalized = normalizeStatus(current);
  if (normalized && finalStatuses.includes(normalized)) throw new Error("ORDER_READ_ONLY");

  if (action === "EDIT") {
    if (!isReceivedStatus(current)) throw new Error("ONLY_RECEIVED_ORDERS_CAN_BE_EDITED");
    return current;
  }
  if (action === "DISPATCH") {
    if (!isReceivedStatus(current)) throw new Error("ONLY_RECEIVED_ORDERS_CAN_BE_DISPATCHED");
    return "PROCESSING" as OrderStatus;
  }
  if (action === "DELIVER") {
    if (!isDispatchedStatus(current)) throw new Error("ONLY_DISPATCHED_ORDERS_CAN_BE_DELIVERED");
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

  try {
    logger.info("orders_fetch_start", { shopId, userId: session.id, role: session.role, filter });
    const where: Prisma.OrderWhereInput = { shopId };
    if (filter === "high") where.priority = "High";
    if (filter === "sales") where.visitSource = "Sales Visit";
    if (filter === "lead") where.visitSource = { in: ["New Lead Visit", "Prospect Visit"] };
    if (filter === "upcoming") where.preferredDeliveryDate = { gte: now, lte: upcoming };

    const rows = await prisma.order.findMany({
      where,
      include: {
        customer: { select: { partyName: true, contactNumber: true } },
        createdBy: { select: { name: true, role: true } },
        activities: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { user: { select: { name: true, role: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const orders = rows.filter((order) => {
      if (filter === "pending") return isReceivedStatus(order.status);
      if (filter === "dispatched") return isDispatchedStatus(order.status);
      if (filter === "delivered") return normalizeStatus(order.status) === "DELIVERED";
      if (filter === "cancelled") return normalizeStatus(order.status) === "CANCELLED";
      if (filter === "upcoming") return isActiveStatus(order.status);
      return true;
    });

    const pendingOrders = rows.filter((order) => isReceivedStatus(order.status)).length;
    const dispatchedOrders = rows.filter((order) => isDispatchedStatus(order.status)).length;
    const highPriorityOrders = rows.filter((order) => isActiveStatus(order.status) && order.priority === "High").length;
    const deliveredToday = rows.filter(
      (order) => normalizeStatus(order.status) === "DELIVERED" && order.deliveredAt && order.deliveredAt >= new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    ).length;
    const cancelledOrders = rows.filter((order) => normalizeStatus(order.status) === "CANCELLED").length;
    const upcomingDeliveries = rows.filter((order) => isActiveStatus(order.status) && order.preferredDeliveryDate && order.preferredDeliveryDate >= now && order.preferredDeliveryDate <= upcoming).length;
    const unknownStatuses = Array.from(new Set(rows.map((order) => order.status).filter((status) => !(status in statusRank))));
    if (unknownStatuses.length > 0) {
      logger.warn("orders_fetch_unknown_statuses", { shopId, userId: session.id, unknownStatuses });
    }

    logger.info("orders_fetch_success", {
      shopId,
      userId: session.id,
      filter,
      totalRows: rows.length,
      returnedRows: orders.length,
      pendingOrders,
      dispatchedOrders,
      deliveredToday,
      cancelledOrders,
    });

    return NextResponse.json({
      orders: sortOrders(orders),
      summary: { pendingOrders, dispatchedOrders, highPriorityOrders, deliveredToday, cancelledOrders, upcomingDeliveries },
    });
  } catch (error) {
    logger.error("orders_fetch_failed", {
      shopId,
      userId: session.id,
      role: session.role,
      filter,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: "Could not load orders.", detail: error instanceof Error ? error.message : String(error), orders: [], summary: { pendingOrders: 0, dispatchedOrders: 0, highPriorityOrders: 0, deliveredToday: 0, cancelledOrders: 0, upcomingDeliveries: 0 } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOrderOperator(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
          action: "CREATED",
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
  if (!isOrderOperator(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
          activities: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { user: { select: { name: true, role: true } } },
          },
        },
      });

      await tx.orderActivity.create({
        data: {
          shopId,
          orderId: updated.id,
          userId: session.id,
          action: isEdit ? "EDITED" : action,
          previousStatus: existing.status,
          newStatus: updated.status,
          notes: isEdit ? "Order details edited" : `Order status changed from ${existing.status} to ${updated.status}`,
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
