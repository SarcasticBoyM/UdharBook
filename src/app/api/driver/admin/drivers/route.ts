import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ensureDriverTrackingLink, isDriverAdminRole, publicTrackingUrl, trackingToken } from "@/lib/driver-tracking";

const patchSchema = z.object({
  driverId: z.string().min(1),
  action: z.enum(["REGENERATE", "REVOKE", "ENABLE"]),
});

function serializeDriver(driver: {
  id: string;
  name: string;
  email: string;
  disabledAt: Date | null;
  driverTrackingLink: { token: string; isEnabled: boolean } | null;
  driverTrips: {
    id: string;
    status: string;
    startedAt: Date;
    endedAt: Date | null;
    lastLat: number | null;
    lastLng: number | null;
    lastAccuracy: number | null;
    lastLocationAt: Date | null;
    totalDistanceMeters: number;
    pointCount: number;
  }[];
}, today: { totalDistanceMeters: number; tripCount: number }) {
  const trip = driver.driverTrips[0] ?? null;
  return {
    id: driver.id,
    name: driver.name,
    email: driver.email,
    disabled: Boolean(driver.disabledAt),
    linkEnabled: driver.driverTrackingLink?.isEnabled ?? false,
    trackingLink: driver.driverTrackingLink ? publicTrackingUrl(driver.driverTrackingLink.token) : null,
    trip,
    currentKm: trip ? Number((trip.totalDistanceMeters / 1000).toFixed(2)) : 0,
    todayKm: Number((today.totalDistanceMeters / 1000).toFixed(2)),
    tripCountToday: today.tripCount,
  };
}

async function loadDrivers(shopId: string) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const drivers = await prisma.user.findMany({
    where: { shopId, role: "DRIVER" },
    select: {
      id: true,
      name: true,
      email: true,
      disabledAt: true,
      driverTrackingLink: { select: { token: true, isEnabled: true } },
      driverTrips: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          startedAt: true,
          endedAt: true,
          lastLat: true,
          lastLng: true,
          lastAccuracy: true,
          lastLocationAt: true,
          totalDistanceMeters: true,
          pointCount: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });
  const todayTrips = await prisma.driverTrip.groupBy({
    by: ["driverId"],
    where: { shopId, startedAt: { gte: todayStart } },
    _sum: { totalDistanceMeters: true },
    _count: { id: true },
  });
  const todayByDriver = new Map(todayTrips.map((row) => [row.driverId, {
    totalDistanceMeters: row._sum.totalDistanceMeters ?? 0,
    tripCount: row._count.id,
  }]));
  return drivers.map((driver) => serializeDriver(driver, todayByDriver.get(driver.id) ?? { totalDistanceMeters: 0, tripCount: 0 }));
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDriverAdminRole(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.$transaction(async (tx) => {
    const drivers = await tx.user.findMany({ where: { shopId: session.shopId, role: "DRIVER" }, select: { id: true } });
    for (const driver of drivers) await ensureDriverTrackingLink(tx, { shopId: session.shopId, driverId: driver.id });
  });
  return NextResponse.json({ success: true, drivers: await loadDrivers(session.shopId) });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDriverAdminRole(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = patchSchema.parse(await request.json());
  const driver = await prisma.user.findFirst({ where: { id: body.driverId, shopId: session.shopId, role: "DRIVER" }, select: { id: true } });
  if (!driver) return NextResponse.json({ error: "Driver not found." }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    const link = await ensureDriverTrackingLink(tx, { shopId: session.shopId, driverId: body.driverId });
    if (body.action === "REGENERATE") {
      await tx.driverTrackingLink.update({ where: { id: link.id }, data: { token: trackingToken(), isEnabled: true } });
    } else if (body.action === "REVOKE") {
      await tx.driverTrackingLink.update({ where: { id: link.id }, data: { isEnabled: false } });
    } else {
      await tx.driverTrackingLink.update({ where: { id: link.id }, data: { isEnabled: true } });
    }
  });
  return NextResponse.json({ success: true, drivers: await loadDrivers(session.shopId) });
}
