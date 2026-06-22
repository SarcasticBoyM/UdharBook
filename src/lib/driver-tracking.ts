import crypto from "crypto";
import type { Prisma } from "@prisma/client";

export type DbClient = Prisma.TransactionClient;

export function isDriverRole(role: string) {
  return role === "DRIVER";
}

export function isDriverAdminRole(role: string) {
  return role === "SHOP_ADMIN";
}

export function validCoordinate(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
}

export function trackingToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export async function ensureDriverTrackingLink(tx: DbClient, input: { shopId: string; driverId: string }) {
  const existing = await tx.driverTrackingLink.findUnique({ where: { driverId: input.driverId } });
  if (existing) return existing;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await tx.driverTrackingLink.create({
        data: {
          shopId: input.shopId,
          driverId: input.driverId,
          token: trackingToken(),
        },
      });
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  throw new Error("TRACKING_LINK_CREATE_FAILED");
}

export function publicTrackingUrl(token: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  return `${base}/track/driver/${token}`;
}

export function lastUpdatedLabel(value?: string | Date | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
