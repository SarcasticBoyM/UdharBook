import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { reportToCsv } from "@/lib/excel/export";

type StaffRow = {
  staffId: string;
  staffName: string;
  role: UserRole;
  loginTime: Date | null;
  logoutTime: Date | null;
  firstActivity: Date | null;
  lastActivity: Date | null;
  totalActiveMinutes: number;
  totalVisits: number;
  completedVisits: number;
  ordersTaken: number;
  paymentsCollected: number;
  chequesCollected: number;
  followUpsHandled: number;
  chequeProcessing: number;
  gpsActiveStatus: string;
  currentStatus: "ACTIVE" | "IDLE" | "OFFLINE" | "LOGGED_OUT";
};

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

function rangeFromPreset(preset: string | null, fromParam: string | null, toParam: string | null) {
  const now = new Date();
  if (preset === "yesterday") {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    return { from: startOfDay(date), to: endOfDay(date), label: "Yesterday" };
  }
  if (preset === "week") {
    const from = startOfDay(now);
    from.setDate(from.getDate() - 6);
    return { from, to: endOfDay(now), label: "This Week" };
  }
  if (preset === "month") {
    const from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    return { from, to: endOfDay(now), label: "This Month" };
  }
  if (preset === "custom" && fromParam && toParam) {
    return { from: startOfDay(new Date(fromParam)), to: endOfDay(new Date(toParam)), label: "Custom Range" };
  }
  return { from: startOfDay(now), to: endOfDay(now), label: "Today" };
}

function minutesBetween(from: Date | null, to: Date | null) {
  if (!from || !to) return 0;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
}

function hours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function iso(value: Date | null) {
  return value ? value.toISOString() : "";
}

function aggregateCount(value: unknown) {
  if (!value || value === true) return 0;
  if (typeof value !== "object") return 0;
  const count = value as { id?: number; _all?: number };
  return count.id ?? count._all ?? 0;
}

function currentStatus(input: { attendanceStatus?: string; endedAt?: Date | null; lastActivity: Date | null }) {
  if (input.endedAt || input.attendanceStatus === "COMPLETED") return "LOGGED_OUT";
  if (!input.lastActivity) return "OFFLINE";
  const ageMinutes = (Date.now() - input.lastActivity.getTime()) / 60000;
  if (ageMinutes <= 15) return "ACTIVE";
  if (ageMinutes <= 60) return "IDLE";
  return "OFFLINE";
}

async function rowsToExcel(rows: StaffRow[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Staff Attendance");
  sheet.columns = [
    { header: "Staff Name", key: "staffName", width: 24 },
    { header: "Role", key: "role", width: 18 },
    { header: "Login Time", key: "loginTime", width: 24 },
    { header: "Logout Time", key: "logoutTime", width: 24 },
    { header: "First Activity", key: "firstActivity", width: 24 },
    { header: "Last Activity", key: "lastActivity", width: 24 },
    { header: "Total Active Hours", key: "totalActiveHours", width: 18 },
    { header: "Total Visits", key: "totalVisits", width: 14 },
    { header: "Completed Visits", key: "completedVisits", width: 18 },
    { header: "Orders Taken", key: "ordersTaken", width: 16 },
    { header: "Payments Collected", key: "paymentsCollected", width: 20 },
    { header: "Cheques Collected", key: "chequesCollected", width: 18 },
    { header: "Follow-ups Handled", key: "followUpsHandled", width: 20 },
    { header: "Cheque Processing", key: "chequeProcessing", width: 18 },
    { header: "GPS Active Status", key: "gpsActiveStatus", width: 18 },
    { header: "Current Status", key: "currentStatus", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  rows.forEach((row) =>
    sheet.addRow({
      ...row,
      loginTime: iso(row.loginTime),
      logoutTime: iso(row.logoutTime),
      firstActivity: iso(row.firstActivity),
      lastActivity: iso(row.lastActivity),
      totalActiveHours: hours(row.totalActiveMinutes),
    })
  );
  return workbook.xlsx.writeBuffer();
}

function rowsToCsv(rows: StaffRow[]) {
  return reportToCsv(
    [
      "Staff Name",
      "Role",
      "Login Time",
      "Logout Time",
      "First Activity",
      "Last Activity",
      "Total Active Hours",
      "Total Visits",
      "Completed Visits",
      "Orders Taken",
      "Payments Collected",
      "Cheques Collected",
      "GPS Active Status",
      "Current Status",
    ],
    rows.map((row) => [
      row.staffName,
      row.role,
      iso(row.loginTime),
      iso(row.logoutTime),
      iso(row.firstActivity),
      iso(row.lastActivity),
      hours(row.totalActiveMinutes),
      String(row.totalVisits),
      String(row.completedVisits),
      String(row.ordersTaken),
      String(row.paymentsCollected),
      String(row.chequesCollected),
      row.gpsActiveStatus,
      row.currentStatus,
    ])
  );
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const shopId = requireShopId(request, session);
  const { searchParams } = new URL(request.url);
  const { from, to, label } = rangeFromPreset(searchParams.get("preset"), searchParams.get("from"), searchParams.get("to"));
  const staffName = searchParams.get("staffName")?.trim();
  const role = searchParams.get("role") as UserRole | null;
  const activeFilter = searchParams.get("active") ?? "";
  const format = searchParams.get("format");

  const userWhere: Prisma.UserWhereInput = {
    shopId,
    ...(staffName ? { name: { contains: staffName, mode: "insensitive" } } : {}),
    ...(role ? { role } : {}),
    ...(activeFilter === "active" ? { disabledAt: null } : {}),
    ...(activeFilter === "inactive" ? { disabledAt: { not: null } } : {}),
  };

  const [users, attendances, visits, orders, payments, cheques, locations, activity, followUps, chequeActivities] = await prisma.$transaction([
    prisma.user.findMany({ where: userWhere, select: { id: true, name: true, role: true, disabledAt: true }, orderBy: { name: "asc" } }),
    prisma.attendance.findMany({ where: { shopId, workDate: { gte: from, lte: to } }, orderBy: { startedAt: "asc" } }),
    prisma.staffVisit.groupBy({
      by: ["staffId", "status"],
      where: { shopId, checkInAt: { gte: from, lte: to } },
      orderBy: [{ staffId: "asc" }, { status: "asc" }],
      _count: { id: true },
      _sum: { recoveryAmount: true },
    }),
    prisma.order.groupBy({ by: ["createdById"], where: { shopId, createdAt: { gte: from, lte: to } }, orderBy: { createdById: "asc" }, _count: { id: true } }),
    prisma.paymentEntry.groupBy({ by: ["createdById"], where: { shopId, paidAt: { gte: from, lte: to } }, orderBy: { createdById: "asc" }, _count: { id: true }, _sum: { amount: true } }),
    prisma.cheque.groupBy({ by: ["collectedById"], where: { shopId, collectionDateTime: { gte: from, lte: to } }, orderBy: { collectedById: "asc" }, _count: { id: true } }),
    prisma.staffLocation.groupBy({ by: ["staffId"], where: { shopId, createdAt: { gte: from, lte: to } }, orderBy: { staffId: "asc" }, _max: { createdAt: true }, _count: { id: true } }),
    prisma.activityLog.groupBy({ by: ["userId"], where: { shopId, createdAt: { gte: from, lte: to }, userId: { not: null } }, orderBy: { userId: "asc" }, _min: { createdAt: true }, _max: { createdAt: true }, _count: { id: true } }),
    prisma.followUp.groupBy({ by: ["createdById"], where: { shopId, followupDate: { gte: from, lte: to } }, orderBy: { createdById: "asc" }, _count: { id: true } }),
    prisma.chequeActivity.groupBy({ by: ["userId"], where: { shopId, createdAt: { gte: from, lte: to } }, orderBy: { userId: "asc" }, _count: { id: true } }),
  ]);

  const attendanceByStaff = new Map<string, typeof attendances>();
  for (const item of attendances) attendanceByStaff.set(item.staffId, [...(attendanceByStaff.get(item.staffId) ?? []), item]);
  const visitMap = new Map<string, { total: number; completed: number; recovery: number }>();
  for (const item of visits) {
    const current = visitMap.get(item.staffId) ?? { total: 0, completed: 0, recovery: 0 };
    const count = aggregateCount(item._count);
    current.total += count;
    if (item.status === "COMPLETED") current.completed += count;
    current.recovery += item._sum?.recoveryAmount ?? 0;
    visitMap.set(item.staffId, current);
  }
  const orderMap = new Map(orders.map((item) => [item.createdById, aggregateCount(item._count)]));
  const paymentMap = new Map(payments.map((item) => [item.createdById, aggregateCount(item._count)]));
  const chequeMap = new Map(cheques.map((item) => [item.collectedById, aggregateCount(item._count)]));
  const locationMap = new Map(locations.map((item) => [item.staffId, item]));
  const activityMap = new Map(activity.map((item) => [item.userId, item]));
  const followUpMap = new Map(followUps.map((item) => [item.createdById, aggregateCount(item._count)]));
  const chequeActivityMap = new Map(chequeActivities.map((item) => [item.userId, aggregateCount(item._count)]));

  const rows: StaffRow[] = users.map((user) => {
    const staffAttendances = attendanceByStaff.get(user.id) ?? [];
    const loginTime = staffAttendances[0]?.startedAt ?? null;
    const logoutTime = [...staffAttendances].reverse().find((item) => item.endedAt)?.endedAt ?? null;
    const activeMinutes = staffAttendances.reduce((sum, item) => sum + (item.activeMinutes || minutesBetween(item.startedAt, item.endedAt ?? new Date())), 0);
    const activityInfo = activityMap.get(user.id);
    const locationInfo = locationMap.get(user.id);
    const visitInfo = visitMap.get(user.id) ?? { total: 0, completed: 0, recovery: 0 };
    const firstCandidates = [loginTime, activityInfo?._min?.createdAt ?? null].filter(Boolean) as Date[];
    const lastCandidates = [logoutTime, activityInfo?._max?.createdAt ?? null, locationInfo?._max?.createdAt ?? null].filter(Boolean) as Date[];
    const firstActivity = firstCandidates.length ? new Date(Math.min(...firstCandidates.map((date) => date.getTime()))) : null;
    const lastActivity = lastCandidates.length ? new Date(Math.max(...lastCandidates.map((date) => date.getTime()))) : null;
    const gpsActiveStatus = locationInfo?._max?.createdAt && Date.now() - locationInfo._max.createdAt.getTime() <= 15 * 60000 ? "Active" : locationInfo ? "Seen" : "No GPS";
    return {
      staffId: user.id,
      staffName: user.name,
      role: user.role,
      loginTime,
      logoutTime,
      firstActivity,
      lastActivity,
      totalActiveMinutes: activeMinutes,
      totalVisits: visitInfo.total,
      completedVisits: visitInfo.completed,
      ordersTaken: orderMap.get(user.id) ?? 0,
      paymentsCollected: paymentMap.get(user.id) ?? 0,
      chequesCollected: chequeMap.get(user.id) ?? 0,
      followUpsHandled: followUpMap.get(user.id) ?? 0,
      chequeProcessing: chequeActivityMap.get(user.id) ?? 0,
      gpsActiveStatus,
      currentStatus: currentStatus({ attendanceStatus: staffAttendances.at(-1)?.status, endedAt: logoutTime, lastActivity }),
    };
  });

  const summary = {
    staffPresentToday: rows.filter((row) => row.loginTime || row.firstActivity).length,
    activeInField: rows.filter((row) => row.currentStatus === "ACTIVE").length,
    totalVisits: rows.reduce((sum, row) => sum + row.totalVisits, 0),
    ordersTakenToday: rows.reduce((sum, row) => sum + row.ordersTaken, 0),
    paymentsCollectedToday: rows.reduce((sum, row) => sum + row.paymentsCollected, 0),
    pendingStaffCheckouts: await prisma.staffVisit.count({ where: { shopId, status: "CHECKED_IN", checkInAt: { gte: from, lte: to } } }),
  };

  if (format === "xlsx") {
    const buffer = await rowsToExcel(rows);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="staff-attendance-report.xlsx"',
      },
    });
  }
  if (format === "csv") {
    return new NextResponse(rowsToCsv(rows), {
      headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="staff-attendance-report.csv"' },
    });
  }

  return NextResponse.json({ success: true, range: { from, to, label }, rows, summary });
}
