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

function radians(value: number) {
  return value * Math.PI / 180;
}

export function haversineMeters(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const earthRadiusMeters = 6371000;
  const deltaLat = radians(to.lat - from.lat);
  const deltaLng = radians(to.lng - from.lng);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(deltaLng / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function calculateDriverDistance(input: {
  previous?: { lat: number; lng: number; capturedAt: Date } | null;
  current: { lat: number; lng: number; accuracy?: number | null; capturedAt: Date };
}) {
  if (!validCoordinate(input.current.lat, input.current.lng)) {
    return { distanceMeters: 0, speedKmph: null, ignored: true, reason: "INVALID_COORDINATES" };
  }
  if (input.current.accuracy !== null && input.current.accuracy !== undefined && input.current.accuracy > 100) {
    return { distanceMeters: 0, speedKmph: null, ignored: true, reason: "LOW_ACCURACY" };
  }
  if (!input.previous || !validCoordinate(input.previous.lat, input.previous.lng)) {
    return { distanceMeters: 0, speedKmph: null, ignored: false, reason: null };
  }
  const seconds = (input.current.capturedAt.getTime() - input.previous.capturedAt.getTime()) / 1000;
  if (seconds <= 0) return { distanceMeters: 0, speedKmph: null, ignored: true, reason: "NON_POSITIVE_TIME_DIFF" };
  const distanceMeters = haversineMeters(input.previous, input.current);
  const speedKmph = distanceMeters / seconds * 3.6;
  if (distanceMeters < 10) return { distanceMeters, speedKmph, ignored: true, reason: "MOVEMENT_UNDER_10M" };
  if (speedKmph > 120) return { distanceMeters, speedKmph, ignored: true, reason: "UNREALISTIC_SPEED" };
  if (distanceMeters > 5000 && seconds < 300) return { distanceMeters, speedKmph, ignored: true, reason: "GPS_JUMP" };
  return { distanceMeters, speedKmph, ignored: false, reason: null };
}

export function km(value?: number | null) {
  return Number(((value ?? 0) / 1000).toFixed(2));
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
