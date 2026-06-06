import { NextResponse } from "next/server";
import { z } from "zod";
import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { logger } from "@/lib/logger";

const statusSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(["PENDING", "PROCESSING", "DELIVERED", "CANCELLED"]),
});

const statusRank: Record<OrderStatus, number> = {
  PENDING: 0,
  PROCESSING: 0,
  DELIVERED: 3,
  CANCELLED: 4,
};

const priorityRank: Record<string, number> = {
  High: 0,
  Urgent: 1,
  Normal: 2,
};

function sortOrders<T extends { status: OrderStatus; priority: string; preferredDeliveryDate: Date | null; createdAt: Date }>(orders: T[]) {
  return orders.sort((a, b) => {
    const statusDiff = statusRank[a.status] - statusRank[b.status];
    if (statusDiff) return statusDiff;
    if (a.status === "PENDING" || a.status === "PROCESSING") {
      const priorityDiff = (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2);
      if (priorityDiff) return priorityDiff;
      const aDelivery = a.preferredDeliveryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bDelivery = b.preferredDeliveryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (aDelivery !== bDelivery) return aDelivery - bDelivery;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
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
  if (filter === "pending") where.status = { in: ["PENDING", "PROCESSING"] };
  if (filter === "delivered") where.status = "DELIVERED";
  if (filter === "high") where.priority = "High";
  if (filter === "upcoming") {
    where.status = { in: ["PENDING", "PROCESSING"] };
    where.preferredDeliveryDate = { gte: now, lte: upcoming };
  }
  if (filter === "sales") where.visitSource = "Sales Visit";
  if (filter === "lead") where.visitSource = { in: ["New Lead Visit", "Prospect Visit"] };

  const [orders, pendingOrders, highPriorityOrders, deliveredToday, upcomingDeliveries] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      include: {
        customer: { select: { partyName: true, contactNumber: true } },
        createdBy: { select: { name: true, role: true } },
      },
      take: 300,
    }),
    prisma.order.count({ where: { shopId, status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.order.count({ where: { shopId, status: { in: ["PENDING", "PROCESSING"] }, priority: "High" } }),
    prisma.order.count({
      where: {
        shopId,
        status: "DELIVERED",
        deliveredAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) },
      },
    }),
    prisma.order.count({
      where: {
        shopId,
        status: { in: ["PENDING", "PROCESSING"] },
        preferredDeliveryDate: { gte: now, lte: upcoming },
      },
    }),
  ]);

  return NextResponse.json({
    orders: sortOrders(orders),
    summary: { pendingOrders, highPriorityOrders, deliveredToday, upcomingDeliveries },
  });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "STAFF") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (session.role === "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = requireShopId(request, session);
  try {
    const body = statusSchema.parse(await request.json());
    const now = new Date();
    const order = await prisma.$transaction(async (tx) => {
      const existing = await tx.order.findFirst({ where: { id: body.orderId, shopId }, select: { id: true } });
      if (!existing) throw new Error("ORDER_NOT_FOUND");
      const updated = await tx.order.update({
        where: { id: existing.id },
        data: {
          status: body.status,
          deliveredAt: body.status === "DELIVERED" ? now : null,
          cancelledAt: body.status === "CANCELLED" ? now : null,
        },
        include: { customer: { select: { id: true, partyName: true } } },
      });
      await tx.activityLog.create({
        data: {
          shopId,
          userId: session.id,
          customerId: updated.customerId,
          action: body.status === "DELIVERED" ? "order_delivered" : "order_status_updated",
          details: body.status === "DELIVERED" ? "Order marked delivered" : `Order status changed to ${body.status}`,
        },
      });
      return updated;
    });
    return NextResponse.json({ order });
  } catch (error) {
    logger.warn("order_status_update_failed", {
      userId: session.id,
      shopId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not update order" }, { status: 400 });
  }
}
