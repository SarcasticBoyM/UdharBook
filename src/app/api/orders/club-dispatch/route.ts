import { NextResponse } from "next/server";
import type { OrderStatus, Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { canUseOrders } from "@/lib/permissions";
import { requireShopId } from "@/lib/tenant";

type ChangedOrder = {
  id: string;
  customerId: string | null;
  previousStatus: OrderStatus | null;
};

type BodyType = "array" | "object" | "invalid";

type ClubDispatchDebug = {
  bodyType: BodyType;
  receivedIdsCount: number;
  normalizedIdsCount: number;
  foundOrdersCount: number;
  foundStatuses: string[];
  dispatchableCount: number;
  alreadyDispatchedCount: number;
  skippedCount: number;
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

const emptyDebug: ClubDispatchDebug = {
  bodyType: "invalid",
  receivedIdsCount: 0,
  normalizedIdsCount: 0,
  foundOrdersCount: 0,
  foundStatuses: [],
  dispatchableCount: 0,
  alreadyDispatchedCount: 0,
  skippedCount: 0,
};

function normalizeStatus(status: string) {
  if (["ORDER_RECEIVED", "PENDING", "RECEIVED", "ORDERED", "PENDING_ORDER"].includes(status)) return "ORDER_RECEIVED";
  if (["DISPATCHED", "PROCESSING"].includes(status)) return "DISPATCHED";
  if (["CANCELLED", "CANCELLED_ORDER"].includes(status)) return "CANCELLED";
  return status;
}

function isPendingDispatch(status: string) {
  return normalizeStatus(status) === "ORDER_RECEIVED";
}

function isAlreadyDispatched(status: string) {
  return normalizeStatus(status) === "DISPATCHED";
}

function isOrderStatus(status: string): status is OrderStatus {
  return ["ORDER_RECEIVED", "DISPATCHED", "PENDING", "PROCESSING", "DELIVERED", "CANCELLED"].includes(status);
}

function validationError(error: string, status = 400, debug: Partial<ClubDispatchDebug> = {}) {
  return NextResponse.json({
    success: false,
    error,
    debug: { ...emptyDebug, ...debug },
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
  if (!canUseOrders(session.role)) return validationError("You do not have permission to dispatch orders.", 403);

  const shopId = requireShopId(request, session);
  try {
    const body = await request.json().catch(() => ({}));
    const bodyType: BodyType = Array.isArray(body) ? "array" : body && typeof body === "object" ? "object" : "invalid";
    const payloadOrderIds = body?.orderIds || body?.ids || body?.selectedOrderIds;
    const rawOrderIds = Array.isArray(body) ? body : Array.isArray(payloadOrderIds) ? payloadOrderIds : [];
    const uniqueOrderIds = Array.from(
      new Set(
        rawOrderIds
          .filter(Boolean)
          .map((id: unknown) => String(id).trim())
          .filter(Boolean),
      ),
    ).slice(0, 100);
    if (!uniqueOrderIds.length) {
      return validationError("No orders selected for club dispatch.", 400, {
        bodyType,
        receivedIdsCount: rawOrderIds.length,
      });
    }

    let changedOrders: ChangedOrder[] = [];

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.order.findMany({
        where: { shopId, id: { in: uniqueOrderIds } },
        select: { id: true, customerId: true, status: true },
      });
      const foundStatuses = Array.from(new Set(existing.map((order) => String(order.status))));
      const existingIds = new Set(existing.map((order) => order.id));
      const missingOrderIds = uniqueOrderIds.filter((id) => !existingIds.has(id));
      const finalOrders = existing.filter((order) => {
        const normalized = normalizeStatus(String(order.status));
        return normalized === "DELIVERED" || normalized === "CANCELLED";
      });
      const pending = existing.filter((order) => isPendingDispatch(String(order.status)));
      const alreadyDispatched = existing.filter((order) => isAlreadyDispatched(String(order.status)));
      const skipped: { id: string; reason: string }[] = [
        ...missingOrderIds.map((id) => ({ id, reason: "ORDER_NOT_FOUND_FOR_SHOP" })),
        ...finalOrders.map((order) => ({ id: order.id, reason: normalizeStatus(String(order.status)) })),
      ];
      const handledIds = new Set([...pending, ...alreadyDispatched, ...finalOrders].map((order) => order.id));
      skipped.push(
        ...existing
          .filter((order) => !handledIds.has(order.id))
          .map((order) => ({ id: order.id, reason: `INVALID_STATUS_${String(order.status)}` })),
      );

      const debug: ClubDispatchDebug = {
        bodyType,
        receivedIdsCount: rawOrderIds.length,
        normalizedIdsCount: uniqueOrderIds.length,
        foundOrdersCount: existing.length,
        foundStatuses,
        dispatchableCount: pending.length,
        alreadyDispatchedCount: alreadyDispatched.length,
        skippedCount: skipped.length,
      };

      if (!existing.length) {
        return {
          success: false,
          status: 400,
          error: "No matching orders found for selected IDs in this shop.",
          debug,
          updatedCount: 0,
          alreadyDispatchedCount: 0,
          skipped,
          orders: [],
        };
      }

      changedOrders = pending.map((order) => ({
        id: order.id,
        customerId: order.customerId,
        previousStatus: isOrderStatus(String(order.status)) ? order.status : null,
      }));

      let updatedCount = 0;
      if (pending.length) {
        const updateResult = await tx.order.updateMany({
          where: { shopId, id: { in: pending.map((order) => order.id) } },
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
        debug,
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
            customerId: order.customerId ?? undefined,
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
            previousStatus: order.previousStatus ?? undefined,
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
      error: message,
      debug: emptyDebug,
      detail: process.env.NODE_ENV === "production" ? undefined : detail,
      updatedCount: 0,
      alreadyDispatchedCount: 0,
      skipped: [],
      orders: [],
    }, { status: 400 });
  }
}
