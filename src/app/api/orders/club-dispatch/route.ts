import { NextResponse } from "next/server";
import { z } from "zod";
import type { OrderStatus, Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { canUseOrders } from "@/lib/permissions";
import { requireShopId } from "@/lib/tenant";

const payloadSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(100),
});

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

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseOrders(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = requireShopId(request, session);
  try {
    const body = payloadSchema.parse(await request.json());
    const uniqueOrderIds = Array.from(new Set(body.orderIds));

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.order.findMany({
        where: { shopId, id: { in: uniqueOrderIds } },
        select: { id: true, customerId: true, status: true },
      });
      const foundIds = new Set(existing.map((order) => order.id));
      const skipped = uniqueOrderIds
        .filter((id) => !foundIds.has(id))
        .map((id) => ({ id, reason: "NOT_FOUND" }));
      const finalOrders = existing.filter((order) => {
        const normalized = normalizeStatus(order.status);
        return normalized === "DELIVERED" || normalized === "CANCELLED";
      });
      if (finalOrders.length) {
        return {
          success: false,
          status: 400,
          updatedCount: 0,
          alreadyDispatchedCount: 0,
          skipped: [
            ...skipped,
            ...finalOrders.map((order) => ({ id: order.id, reason: normalizeStatus(order.status) ?? order.status })),
          ],
          orders: [],
        };
      }

      const pending = existing.filter((order) => isPendingDispatch(order.status));
      const alreadyDispatched = existing.filter((order) => isAlreadyDispatched(order.status));

      if (pending.length) {
        await tx.order.updateMany({
          where: { shopId, id: { in: pending.map((order) => order.id) }, status: { in: ["ORDER_RECEIVED", "PENDING"] } },
          data: { status: "DISPATCHED" },
        });
        await tx.activityLog.createMany({
          data: pending.map((order) => ({
            shopId,
            userId: session.id,
            customerId: order.customerId,
            action: "order_status_updated",
            details: "Dispatched via Club Dispatch",
          })),
        });
        await tx.orderActivity.createMany({
          data: pending.map((order) => ({
            shopId,
            orderId: order.id,
            userId: session.id,
            action: "DISPATCH",
            previousStatus: order.status,
            newStatus: "DISPATCHED",
            notes: "Dispatched via Club Dispatch",
          })),
        });
      }

      const orders = await tx.order.findMany({
        where: { shopId, id: { in: [...pending.map((order) => order.id), ...alreadyDispatched.map((order) => order.id)] } },
        include: responseInclude,
        orderBy: { createdAt: "desc" },
      });

      return {
        success: true,
        status: 200,
        updatedCount: pending.length,
        alreadyDispatchedCount: alreadyDispatched.length,
        skipped,
        orders,
      };
    });

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
    logger.error("club_dispatch_failed", {
      requestId,
      shopId,
      userId: session.id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    const message = error instanceof z.ZodError ? "Select at least one order to dispatch." : "Could not dispatch selected orders.";
    return NextResponse.json({ success: false, error: message, updatedCount: 0, alreadyDispatchedCount: 0, skipped: [], orders: [] }, { status: 400 });
  }
}
