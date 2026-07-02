import { randomBytes } from "node:crypto";
import { normalizeFixedRole } from "@/lib/operational-roles";

export const SCHOOL_TRIP_STATUS = { RUNNING: "RUNNING", COMPLETED: "COMPLETED", CANCELLED: "CANCELLED" } as const;

export function isSchoolTransportAdmin(role: string) {
  return ["SHOP_ADMIN", "SCHOOL_ADMIN"].includes(String(normalizeFixedRole(role)));
}

export function isSchoolDriver(role: string) {
  return String(normalizeFixedRole(role)) === "SCHOOL_DRIVER";
}

export function canOperateSchoolTrip(role: string) {
  const normalized = String(normalizeFixedRole(role));
  return normalized === "SCHOOL_DRIVER" || normalized === "SHOP_ADMIN";
}

export function schoolTrackingToken() {
  return randomBytes(32).toString("base64url");
}

export function validSchoolCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

export function schoolTrackingUrl(token: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  return `${base}/school-track/${token}`;
}
