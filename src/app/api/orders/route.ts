import { NextResponse } from "next/server";
import { z } from "zod";
import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import { normalizePhone } from "@/lib/phone";

const finalStatuses = ["DELIVERED", "CANCELLED"];
const prioritySchema = z.enum(["Normal", "High", "Urgent"]);
const legacyReceivedStatus = "PENDING" as OrderStatus;

const createSchema = z.object({
  customerId: z.string().min(1).optional(),
  customerMode: z.enum(["EXISTING_CUSTOMER", "NEW_CUSTOMER"]).optional(),
  newCustomer: z.object({
    partyName: z.string().trim().min(1),
    contactNumber: z.string().trim().min(1),
    address: z.string().trim().optional(),
    area: z.string().trim().optional(),
    gstNumber: z.string().trim().optional(),
    notes: z.string().trim().optional(),
  }).optional(),
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
    return current === "PENDING" ? ("PROCESSING" as OrderStatus) : ("DISPATCHED" as OrderStatus);
  }
  if (action === "DELIVER") {
    if (!isDispatchedStatus(current)) throw new Error("ONLY_DISPATCHED_ORDERS_CAN_BE_DELIVERED");
    return "DELIVERED" as OrderStatus;
  }
  if (action === "CANCEL") return "CANCELLED" as OrderStatus;
  throw new Error("INVALID_ORDER_ACTION");
}

function emptyOrderSummary() {
  return {
    pendingOrders: 0,
    dispatchedOrders: 0,
    highPriorityOrders: 0,
    deliveredToday: 0,
    cancelledOrders: 0,
    upcomingDeliveries: 0,
  };
}

function clientOrderError(error: unknown) {
  if (error instanceof z.ZodError) return `Invalid order data: ${error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`;
  if (!(error instanceof Error)) return String(error);
  if (error.message === "CUSTOMER_NOT_FOUND") return "Customer was not found for this shop.";
  if (error.message === "CUSTOMER_REQUIRED") return "Select an existing customer or enter a new customer name and contact number.";
  if (error.message === "DUPLICATE_CUSTOMER") return "A customer with this contact number already exists. Use the existing customer or change the contact number.";
  if (error.message === "INVALID_DATE") return "Preferred delivery date is invalid.";
  if (error.message.includes("invalid input value for enum") || error.message.includes("Invalid enum value")) {
    return "Order status setup is not fully migrated. Saved using backward-compatible order status.";
  }
  if (error.message.includes("OrderActivity")) return "Order activity tracking is not fully migrated yet. Order data was preserved.";
  return error.message || "Could not save order.";
}

function freshCustomerNotes(input: NonNullable<z.infer<typeof createSchema>["newCustomer"]>) {
  return [
    input.notes,
    input.area ? `Area: ${input.area}` : "",
    input.address ? `Address: ${input.address}` : "",
    input.gstNumber ? `GST: ${input.gstNumber}` : "",
    "Source: New customer order",
  ].filter(Boolean).join("\n");
}

async function recordOrderActivitySafe(input: {
  requestId: string;
  shopId: string;
  orderId: string;
  userId: string;
  action: string;
  previousStatus?: OrderStatus | null;
  newStatus?: OrderStatus | null;
  notes: string;
}) {
  try {
    await prisma.orderActivity.create({
      data: {
        shopId: input.shopId,
        orderId: input.orderId,
        userId: input.userId,
        action: input.action,
        previousStatus: input.previousStatus ?? undefined,
        newStatus: input.newStatus ?? undefined,
        notes: input.notes,
      },
    });
    logger.info("order_activity_recorded", {
      requestId: input.requestId,
      shopId: input.shopId,
      orderId: input.orderId,
      userId: input.userId,
      action: input.action,
    });
  } catch (error) {
    logger.error("order_activity_record_failed_non_blocking", {
      requestId: input.requestId,
      shopId: input.shopId,
      orderId: input.orderId,
      userId: input.userId,
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
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
    logger.info("orders_fetch_start", { requestId, shopId, userId: session.id, role: session.role, filter });
    const where: Prisma.OrderWhereInput = { shopId };
    if (filter === "high") where.priority = "High";
    if (filter === "sales") where.visitSource = "Sales Visit";
    if (filter === "lead") where.visitSource = { in: ["New Lead Visit", "Prospect Visit"] };
    if (filter === "upcoming") where.preferredDeliveryDate = { gte: now, lte: upcoming };

    const baseInclude = {
      customer: { select: { partyName: true, contactNumber: true } },
      createdBy: { select: { name: true, role: true } },
    } satisfies Prisma.OrderInclude;
    const fullInclude = {
      ...baseInclude,
      activities: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { user: { select: { name: true, role: true } } },
      },
    } satisfies Prisma.OrderInclude;

    let rows;
    try {
      rows = await prisma.order.findMany({
        where,
        include: fullInclude,
        orderBy: { createdAt: "desc" },
        take: 500,
      });
    } catch (error) {
      logger.error("orders_fetch_with_activity_failed_retrying_without_activity", {
        requestId,
        shopId,
        userId: session.id,
        role: session.role,
        filter,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      const fallbackRows = await prisma.order.findMany({
        where,
        include: baseInclude,
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      rows = fallbackRows.map((order) => ({ ...order, activities: [] }));
    }

    logger.info("orders_fetch_query_counts", {
      requestId,
      shopId,
      userId: session.id,
      filter,
      totalRows: rows.length,
      statuses: rows.reduce<Record<string, number>>((counts, order) => {
        counts[order.status] = (counts[order.status] ?? 0) + 1;
        return counts;
      }, {}),
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
      requestId,
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
      requestId,
      shopId,
      userId: session.id,
      role: session.role,
      filter,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: "Could not load orders.", detail: error instanceof Error ? error.message : String(error), orders: [], summary: emptyOrderSummary() }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOrderOperator(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = requireShopId(request, session);
  try {
    logger.info("order_create_request_start", { requestId, shopId, userId: session.id, role: session.role });
    const payload = await request.json();
    logger.info("order_create_payload_received", {
      requestId,
      shopId,
      userId: session.id,
      role: session.role,
      hasCustomerId: Boolean(payload?.customerId),
      hasOrderDetails: Boolean(payload?.orderDetails),
      preferredDeliveryDate: payload?.preferredDeliveryDate ?? null,
      priority: payload?.priority ?? null,
    });
    const body = createSchema.parse(payload);
    if (!body.customerId && !body.newCustomer) throw new Error("CUSTOMER_REQUIRED");
    const preferredDeliveryDate = parseOptionalDate(body.preferredDeliveryDate);
    const order = await prisma.$transaction(async (tx) => {
      logger.info("order_create_transaction_start", { requestId, shopId, userId: session.id, role: session.role, customerId: body.customerId ?? null, hasNewCustomer: Boolean(body.newCustomer) });
      let customer: { id: string };
      let orderSource = "EXISTING_CUSTOMER";
      if (body.customerId) {
        const existingCustomer = await tx.customer.findFirst({ where: { id: body.customerId, shopId }, select: { id: true } });
        if (!existingCustomer) throw new Error("CUSTOMER_NOT_FOUND");
        customer = existingCustomer;
      } else if (body.newCustomer) {
        const contactNumber = normalizePhone(body.newCustomer.contactNumber);
        const sameContact = await tx.customer.findFirst({
          where: { shopId, contactNumber },
          select: { id: true, partyName: true, contactNumber: true, outstandingBalance: true },
        });
        if (sameContact) {
          const error = new Error("DUPLICATE_CUSTOMER");
          Object.assign(error, { existingCustomer: sameContact });
          throw error;
        }
        customer = await tx.customer.create({
          data: {
            shopId,
            partyName: body.newCustomer.partyName.trim().replace(/\s+/g, " "),
            contactNumber,
            outstandingBalance: 0,
            status: "CLEARED",
            geoAddress: [body.newCustomer.area, body.newCustomer.address].filter(Boolean).join(", ") || undefined,
            notes: freshCustomerNotes(body.newCustomer),
          },
          select: { id: true },
        });
        orderSource = "NEW_CUSTOMER";
      } else {
        throw new Error("CUSTOMER_REQUIRED");
      }

      const created = await tx.order.create({
        data: {
          shopId,
          customerId: customer.id,
          createdById: session.id,
          orderDetails: body.orderDetails,
          preferredDeliveryDate,
          priority: body.priority,
          status: legacyReceivedStatus,
          sourceModule: body.customerMode === "NEW_CUSTOMER" || orderSource === "NEW_CUSTOMER" ? "NEW_CUSTOMER_ORDER" : "ORDER_DESK",
          visitSource: body.customerMode === "NEW_CUSTOMER" || orderSource === "NEW_CUSTOMER" ? "New Customer Order" : "Order Desk",
        },
      });
      await tx.activityLog.create({
        data: {
          shopId,
          userId: session.id,
          customerId: customer.id,
          action: "order_created",
          details: orderSource === "NEW_CUSTOMER" ? "Order created from Order Desk for new customer" : "Order created from Order Desk",
        },
      });
      logger.info("order_create_transaction_success", { requestId, shopId, userId: session.id, orderId: created.id, status: created.status });
      return created;
    });
    await recordOrderActivitySafe({
      requestId,
      shopId,
      orderId: order.id,
      userId: session.id,
      action: "CREATED",
      newStatus: order.status,
      notes: order.sourceModule === "NEW_CUSTOMER_ORDER" ? "Order created from Order Desk for new customer" : "Order created from Order Desk",
    });
    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    logger.error("order_create_failed", {
      requestId,
      userId: session.id,
      role: session.role,
      shopId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    const existingCustomer = error instanceof Error && "existingCustomer" in error
      ? (error as Error & { existingCustomer?: unknown }).existingCustomer
      : undefined;
    return NextResponse.json({ error: clientOrderError(error), existingCustomer }, { status: error instanceof Error && error.message === "DUPLICATE_CUSTOMER" ? 409 : 400 });
  }
}

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOrderOperator(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = requireShopId(request, session);
  try {
    logger.info("order_update_request_start", { requestId, shopId, userId: session.id, role: session.role });
    const payload = await request.json();
    logger.info("order_update_payload_received", {
      requestId,
      shopId,
      userId: session.id,
      role: session.role,
      orderId: payload?.orderId ?? null,
      action: payload?.action ?? null,
      status: payload?.status ?? null,
      hasOrderDetails: Boolean(payload?.orderDetails),
    });
    const body = patchSchema.parse(payload);
    const action = body.action ?? actionForStatus(body.status as OrderStatus | undefined);
    const preferredDeliveryDate = body.preferredDeliveryDate === undefined ? undefined : parseOptionalDate(body.preferredDeliveryDate);
    const now = new Date();
    let previousStatusForActivity: OrderStatus | null = null;

    const order = await prisma.$transaction(async (tx) => {
      const existing = await tx.order.findFirst({
        where: { id: body.orderId, shopId },
        select: { id: true, customerId: true, status: true, deliveredAt: true, cancelledAt: true },
      });
      if (!existing) throw new Error("ORDER_NOT_FOUND");

      const nextStatus = transitionStatus(existing.status, action);
      const isEdit = action === "EDIT";
      previousStatusForActivity = existing.status;
      logger.info("order_transition_validated", {
        requestId,
        shopId,
        userId: session.id,
        role: session.role,
        orderId: existing.id,
        currentStatus: existing.status,
        normalizedCurrentStatus: normalizeStatus(existing.status),
        requestedAction: action,
        nextStatus,
        normalizedNextStatus: normalizeStatus(nextStatus),
      });
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
      logger.info("order_transition_update_success", {
        requestId,
        shopId,
        userId: session.id,
        orderId: updated.id,
        previousStatus: existing.status,
        newStatus: updated.status,
        action,
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
    await recordOrderActivitySafe({
      requestId,
      shopId,
      orderId: order.id,
      userId: session.id,
      action: action === "EDIT" ? "EDITED" : action,
      previousStatus: previousStatusForActivity,
      newStatus: order.status,
      notes: action === "EDIT" ? "Order details edited" : `Order status changed from ${previousStatusForActivity ?? "UNKNOWN"} to ${order.status}`,
    });
    logger.info("order_update_success", {
      requestId,
      shopId,
      userId: session.id,
      role: session.role,
      orderId: order.id,
      action,
      previousStatus: previousStatusForActivity,
      newStatus: order.status,
    });
    return NextResponse.json({ order });
  } catch (error) {
    logger.error("order_update_failed", {
      requestId,
      userId: session.id,
      role: session.role,
      shopId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
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
