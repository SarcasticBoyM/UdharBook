import type { StaffTrackingStatus } from "@prisma/client";
import type { SessionUser } from "@/types";
import { isSalesRole, isShopAdminRole } from "@/lib/operational-roles";

export function startOfDay(value = new Date()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(value = new Date()) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function isFieldAdmin(session: SessionUser) {
  return isShopAdminRole(session.role);
}

export function isFieldWorker(session: SessionUser) {
  return isSalesRole(session.role);
}

export function visibleStaffId(session: SessionUser, requested?: string | null) {
  return isFieldAdmin(session) ? requested || undefined : session.id;
}

export function distanceMeters(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
) {
  const radius = 6371000;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(toLat - fromLat);
  const dLng = toRad(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(fromLat)) *
      Math.cos(toRad(toLat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function freshnessStatus(lastSeen?: Date | null, visitOpen = false): StaffTrackingStatus {
  if (visitOpen) return "ON_VISIT";
  if (!lastSeen) return "OFFLINE";
  const ageMinutes = (Date.now() - lastSeen.getTime()) / 60000;
  if (ageMinutes <= 7) return "ACTIVE";
  if (ageMinutes <= 20) return "IDLE";
  return "OFFLINE";
}

export function workDate(value = new Date()) {
  return startOfDay(value);
}
