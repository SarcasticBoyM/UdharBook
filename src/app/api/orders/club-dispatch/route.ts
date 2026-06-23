import { NextResponse } from "next/server";
import type { OrderStatus, Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { canUseOrders } from "@/lib/permissions";
import { requireShopId } from "@/lib/tenant";

type ChangedOrder = {
  id: string;
  customerId: string;
  previousStatus: OrderStatus;
};

const responseInclude = {
  customer: { select: { id: true, partyName: true, contactNumber: true, batchTag: true } },
  createdBy: { select: { name: true } },
  activities: {
    orderBy: { createdAt: "desc" },
    take: 1,
    include: { user: { select: { name: true } } },
  },
} satisfies Prisma.OrderInclude;

function normalizeStatus(status: OrderStatus) {
  if (status === "PENDING") return "ORDER_RECEIVED";
  if (status === "PROCESSING") return "DISPATCHED";
  return status;
}

function isPendingDispatch(status: OrderStatus) {
  return normalizeStatus(status) === "ORDER_RECEIVED";
}

function isAlreadyDispatched(status: OrderStatus) {
  return normalizeStatus(status) === "DISPATCHED";
}

function validationError(error: string, status = 400) {
  return NextResponse.json({
    success: false,
    error,
    updatedCount: 0,
    alreadyDispatchedCount: 0,
    skipped: [],
    orders: [],
  }, { status });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseOrders(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = requireShopId(request, session);
  try {
    const body = await request.json();
    const rawOrderIds = body?.orderIds ?? body?.ids ?? body?.selectedOrderIds;
    if (!Array.isArray(rawOrderIds)) {
      return validationError("orderIds must be an array.");
    }
    if (rawOrderIds.length === 0) {
      return validationError("Select at least one order to dispatch.");
    }
    if (rawOrderIds.some((id) => typeof id !== "string" || id.trim().length === 0)) {
      return validationError("orderIds must contain non-empty order ids.");
    }

    const uniqueOrderIds = Array.from(new Set(rawOrderIds.map((id: string) => id.trim()))).slice(0, 100);
    let changedOrders: ChangedOrder[] = [];

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.order.findMany({
        where: { shopId, id: { in: uniqueOrderIds } },
        select: { id: true, customerId: true, status: true },
      });
      const skipped: { id: string; reason: string }[] = [];
      const existingIds = new Set(existing.map((order) => order.id));
      skipped.push(
        ...uniqueOrderIds
          .filter((id) => !existingIds.has(id))
          .map((id) => ({ id, reason: "ORDER_NOT_FOUND_FOR_SHOP" })),
      );

      const finalOrders = existing.filter((order) => {
        const normalized = normalizeStatus(order.status);
        return normalized === "DELIVERED" || normalized === "CANCELLED";
      });
      skipped.push(...finalOrders.map((order) => ({ id: order.id, reason: normalizeStatus(order.status) })));

      const pending = existing.filter((order) => isPendingDispatch(order.status));
      const alreadyDispatched = existing.filter((order) => isAlreadyDispatched(order.status));
      const handledIds = new Set([...pending, ...alreadyDispatched, ...finalOrders].map((order) => order.id));
      skipped.push(
        ...existing
          .filter((order) => !handledIds.has(order.id))
          .map((order) => ({ id: order.id, reason: `INVALID_STATUS_${order.status}` })),
      );
      changedOrders = pending.map((order) => ({ id: order.id, customerId: order.customerId, previousStatus: order.status }));

      let updatedCount = 0;
      if (pending.length) {
        const updateResult = await tx.order.updateMany({
          where: { shopId, id: { in: pending.map((order) => order.id) }, status: { in: ["ORDER_RECEIVED", "PENDING"] } },
          data: { status: "DISPATCHED" },
        });
        updatedCount = updateResult.count;
      }

      const orders = await tx.order.findMany({
        where: { shopId, id: { in: existing.map((order) => order.id) } },
        include: responseInclude,
        orderBy: { createdAt: "desc" },
      });

      return {
        success: true,
        status: 200,
        updatedCount,
        alreadyDispatchedCount: alreadyDispatched.length,
        skipped,
        orders,
      };
    });

    for (const order of changedOrders) {
      try {
        await prisma.activityLog.create({
          data: {
            shopId,
            userId: session.id,
            customerId: order.customerId,
            action: "order_status_updated",
            details: "Dispatched via Club Dispatch",
          },
        });
        await prisma.orderActivity.create({
          data: {
            shopId,
            orderId: order.id,
            userId: session.id,
            action: "DISPATCH",
            previousStatus: order.previousStatus,
            newStatus: "DISPATCHED",
            notes: "Dispatched via Club Dispatch",
          },
        });
      } catch (activityError) {
        logger.error("club_dispatch_order_activity_failed_non_blocking", {
          requestId,
          shopId,
          orderId: order.id,
          userId: session.id,
          error: activityError instanceof Error ? activityError.message : String(activityError),
        });
      }
    }

    logger.info("club_dispatch_completed", {
      requestId,
      shopId,
      userId: session.id,
      updatedCount: result.updatedCount,
      alreadyDispatchedCount: result.alreadyDispatchedCount,
      skippedCount: result.skipped.length,
    });

    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error("club_dispatch_failed", {
      requestId,
      shopId,
      userId: session.id,
      error: detail,
      stack: error instanceof Error ? error.stack : undefined,
    });
    const message = error instanceof Error ? error.message : "Could not dispatch selected orders.";
    return NextResponse.json({
      success: false,
      error: process.env.NODE_ENV === "production" ? "Could not dispatch selected orders." : message,
      detail: process.env.NODE_ENV === "production" ? undefined : detail,
      updatedCount: 0,
      alreadyDispatchedCount: 0,
      skipped: [],
      orders: [],
    }, { status: 400 });
  }
}
