import { NextResponse } from "next/server";
import { z } from "zod";
import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import { normalizePhone } from "@/lib/phone";
import { canUseOrders } from "@/lib/permissions";
import { notifyCustomerAdded, notifyOrderCreated, notifyOrderStatusChanged } from "@/lib/notifications";

const finalStatuses = ["DELIVERED", "CANCELLED"];
const prioritySchema = z.enum(["Normal", "High", "Urgent"]);
const legacyReceivedStatus = "PENDING" as OrderStatus;
const dateFilters = ["all", "today", "yesterday", "last7days", "thisMonth", "custom"] as const;
const orderFilters = ["all", "pending", "dispatched", "delivered", "cancelled", "high", "high-priority", "upcoming", "sales", "lead"] as const;
const localOffsetMinutes = 330;
const orderDateField = "createdAt" as const;
type OrderFilter = (typeof orderFilters)[number];

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
  clientRequestId: z.string().trim().min(8).max(120).optional(),
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
  return orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function filterFromStatus(status?: string | null): OrderFilter | null {
  const normalized = normalizeStatus(status);
  if (normalized === "ORDER_RECEIVED") return "pending";
  if (normalized === "DISPATCHED") return "dispatched";
  if (normalized === "DELIVERED") return "delivered";
  if (normalized === "CANCELLED") return "cancelled";
  return null;
}

function normalizeOrderFilter(filter?: string | null): OrderFilter {
  return orderFilters.includes(filter as OrderFilter) ? filter as OrderFilter : "all";
}

function parseDateOnly(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return { year, month: month - 1, day };
}

function localDayBoundary(parts: { year: number; month: number; day: number }, end = false) {
  const hour = end ? 23 : 0;
  const minute = end ? 59 : 0;
  const second = end ? 59 : 0;
  const millisecond = end ? 999 : 0;
  return new Date(Date.UTC(parts.year, parts.month, parts.day, hour, minute, second, millisecond) - localOffsetMinutes * 60 * 1000);
}

function localDateParts(date: Date) {
  const shifted = new Date(date.getTime() + localOffsetMinutes * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function addLocalDays(parts: { year: number; month: number; day: number }, days: number) {
  const shifted = new Date(Date.UTC(parts.year, parts.month, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function orderDateRange(searchParams: URLSearchParams, now = new Date()) {
  const requested = searchParams.get("dateFilter") ?? "all";
  const dateFilter = dateFilters.includes(requested as (typeof dateFilters)[number])
    ? requested as (typeof dateFilters)[number]
    : "all";
  if (dateFilter === "all") return null;

  const today = localDateParts(now);
  if (dateFilter === "today") {
    return { gte: localDayBoundary(today), lte: localDayBoundary(today, true) };
  }
  if (dateFilter === "yesterday") {
    const yesterday = addLocalDays(today, -1);
    return { gte: localDayBoundary(yesterday), lte: localDayBoundary(yesterday, true) };
  }
  if (dateFilter === "last7days") {
    return { gte: localDayBoundary(addLocalDays(today, -6)), lte: localDayBoundary(today, true) };
  }
  if (dateFilter === "thisMonth") {
    const start = { year: today.year, month: today.month, day: 1 };
    return { gte: localDayBoundary(start), lte: localDayBoundary(today, true) };
  }

  const from = parseDateOnly(searchParams.get("fromDate"));
  const to = parseDateOnly(searchParams.get("toDate"));
  if (!from || !to) throw new Error("INVALID_DATE_RANGE");
  const gte = localDayBoundary(from);
  const lte = localDayBoundary(to, true);
  if (gte.getTime() > lte.getTime()) throw new Error("INVALID_DATE_RANGE");
  return { gte, lte };
}

function orderDateCondition(dateRange: NonNullable<ReturnType<typeof orderDateRange>>): Prisma.OrderWhereInput {
  return { [orderDateField]: dateRange };
}

function latestOrderSort(): Prisma.OrderOrderByWithRelationInput[] {
  return [{ [orderDateField]: "desc" }];
}

function orderFilterCondition(filter: OrderFilter, now: Date, upcoming: Date): Prisma.OrderWhereInput | null {
  if (filter === "pending") return { status: { in: ["ORDER_RECEIVED", "PENDING"] } };
  if (filter === "dispatched") return { status: "DISPATCHED" };
  if (filter === "delivered") return { status: "DELIVERED" };
  if (filter === "cancelled") return { status: "CANCELLED" };
  if (filter === "high" || filter === "high-priority") return { priority: "High" };
  if (filter === "sales") return { visitSource: "Sales Visit" };
  if (filter === "lead") return { visitSource: { in: ["New Lead Visit", "Prospect Visit"] } };
  if (filter === "upcoming") {
    return {
      status: { in: ["ORDER_RECEIVED", "PENDING", "DISPATCHED", "PROCESSING"] },
      preferredDeliveryDate: { gte: now, lte: upcoming },
    };
  }
  return null;
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
  if (error.message === "DUPLICATE_RAPID_ORDER") return "This order was already submitted. Please wait before saving it again.";
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
  const filter = normalizeOrderFilter(searchParams.get("filter") ?? filterFromStatus(searchParams.get("status")));
  const now = new Date();
  const upcoming = new Date(now);
  upcoming.setDate(upcoming.getDate() + 7);

  try {
    logger.info("orders_fetch_start", { requestId, shopId, userId: session.id, role: session.role, filter });
    const conditions: Prisma.OrderWhereInput[] = [];
    const dateRange = orderDateRange(searchParams, now);
    const filterCondition = orderFilterCondition(filter, now, upcoming);
    if (filterCondition) conditions.push(filterCondition);
    if (dateRange) conditions.push(orderDateCondition(dateRange));
    const where: Prisma.OrderWhereInput = {
      shopId,
      ...(conditions.length > 0 ? { AND: conditions } : {}),
    };

    const baseInclude = {
      customer: { select: { id: true, partyName: true, contactNumber: true, batchTag: true } },
      createdBy: { select: { name: true } },
    } satisfies Prisma.OrderInclude;
    const fullInclude = {
      ...baseInclude,
      activities: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { user: { select: { name: true } } },
      },
    } satisfies Prisma.OrderInclude;

    let rows;
    try {
      rows = await prisma.order.findMany({
        where,
        include: fullInclude,
        orderBy: latestOrderSort(),
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
        orderBy: latestOrderSort(),
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
      returnedRows: rows.length,
      pendingOrders,
      dispatchedOrders,
      deliveredToday,
      cancelledOrders,
    });

    return NextResponse.json({
      success: true,
      orders: sortOrders(rows),
      total: rows.length,
      summary: { pendingOrders, dispatchedOrders, highPriorityOrders, deliveredToday, cancelledOrders, upcomingDeliveries },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_DATE_RANGE") {
      return NextResponse.json({ success: false, error: "Invalid date range", orders: [], total: 0, summary: emptyOrderSummary() }, { status: 400 });
    }
    logger.error("orders_fetch_failed", {
      requestId,
      shopId,
      userId: session.id,
      role: session.role,
      filter,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        success: false,
        error: process.env.NODE_ENV === "development" ? message : "Could not load orders.",
        orders: [],
        total: 0,
        summary: emptyOrderSummary(),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseOrders(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
        const existingCustomer = await tx.customer.findFirst({ where: { id: body.customerId, shopId, isArchived: false }, select: { id: true } });
        if (!existingCustomer) throw new Error("CUSTOMER_NOT_FOUND");
        customer = existingCustomer;
      } else if (body.newCustomer) {
        const contactNumber = normalizePhone(body.newCustomer.contactNumber);
        const sameContact = await tx.customer.findFirst({
          where: { shopId, contactNumber, isArchived: false },
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

      const duplicateWindowStart = new Date(Date.now() - 15_000);
      const rapidDuplicate = await tx.order.findFirst({
        where: {
          shopId,
          customerId: customer.id,
          createdById: session.id,
          orderDetails: body.orderDetails,
          preferredDeliveryDate,
          priority: body.priority,
          createdAt: { gte: duplicateWindowStart },
        },
        select: { id: true },
      });
      if (rapidDuplicate) throw new Error("DUPLICATE_RAPID_ORDER");

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
        include: {
          customer: { select: { id: true, partyName: true, contactNumber: true, batchTag: true } },
          createdBy: { select: { name: true } },
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
    const orderNotification = await notifyOrderCreated({
      shopId,
      orderId: order.id,
      customerName: order.customer.partyName,
      createdById: session.id,
      createdByName: order.createdBy.name,
    });
    const customerNotification = order.sourceModule === "NEW_CUSTOMER_ORDER"
      ? await notifyCustomerAdded({
          shopId,
          customerId: order.customerId,
          customerName: order.customer.partyName,
          createdByName: order.createdBy.name,
        })
      : undefined;
    const notification = customerNotification
      ? {
          queued: orderNotification.queued && customerNotification.queued,
          retryQueued: orderNotification.retryQueued || customerNotification.retryQueued,
        }
      : orderNotification;
    return NextResponse.json({ success: true, order, data: order, notification }, { status: 201 });
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
    return NextResponse.json({ error: clientOrderError(error), existingCustomer }, {
      status: error instanceof Error && (error.message === "DUPLICATE_CUSTOMER" || error.message === "DUPLICATE_RAPID_ORDER") ? 409 : 400,
    });
  }
}

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseOrders(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
          customer: { select: { id: true, partyName: true, contactNumber: true, batchTag: true } },
          createdBy: { select: { name: true } },
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
    const notification =
      action === "DISPATCH" || action === "DELIVER"
        ? await notifyOrderStatusChanged({
            shopId,
            orderId: order.id,
            type: action === "DISPATCH" ? "ORDER_DISPATCHED" : "ORDER_DELIVERED",
            customerName: order.customer.partyName,
            actorName: session.name,
          })
        : undefined;
    return NextResponse.json({ success: true, order, data: order, ...(notification ? { notification } : {}) });
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
