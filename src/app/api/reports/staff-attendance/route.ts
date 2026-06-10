import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { resolveOperationalShopId } from "@/lib/tenant";
import { reportToCsv } from "@/lib/excel/export";

const VALID_USER_ROLES: UserRole[] = ["SUPER_ADMIN", "SHOP_ADMIN", "ACCOUNT_STAFF", "SALES_PERSON", "SALES_PERSON_CUM_ACCOUNTS"];
const VALID_ACTIVE_FILTERS = new Set(["", "active", "inactive"]);

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

type StaffUserRow = {
  id: string;
  name: string;
  role: UserRole;
  disabledAt: Date | null;
};

type SimpleAttendanceRow = {
  id: string;
  staffId: string;
  staffName: string;
  role: string;
  workDate: Date;
  startedAt: Date;
  endedAt: Date | null;
  activeMinutes: number;
  status: string;
};

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function canUseRuntimeDebug(role: string) {
  return role === "SUPER_ADMIN" || role === "SHOP_ADMIN";
}

function endOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

function rangeFromPreset(preset: string | null, fromParam: string | null, toParam: string | null) {
  const now = new Date();
  const safeDate = (value: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
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
    const customFrom = safeDate(fromParam);
    const customTo = safeDate(toParam);
    if (customFrom && customTo) {
      return { from: startOfDay(customFrom), to: endOfDay(customTo), label: "Custom Range" };
    }
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

function settledValue<T>(result: PromiseSettledResult<T>, fallback: T, label: string) {
  if (result.status === "fulfilled") return result.value;
  console.error("staff_attendance_aggregation_failed", {
    label,
    message: result.reason instanceof Error ? result.reason.message : String(result.reason),
  });
  return fallback;
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

  const shopId = await resolveOperationalShopId(request, session);
  const { searchParams } = new URL(request.url);
  const { from, to, label } = rangeFromPreset(searchParams.get("preset"), searchParams.get("from"), searchParams.get("to"));
  const staffName = searchParams.get("staffName")?.trim();
  const rawRole = searchParams.get("role")?.trim();
  const role = rawRole && VALID_USER_ROLES.includes(rawRole as UserRole) ? rawRole as UserRole : null;
  const rawActiveFilter = searchParams.get("active")?.trim() ?? "";
  const activeFilter = VALID_ACTIVE_FILTERS.has(rawActiveFilter) ? rawActiveFilter : "";
  const format = searchParams.get("format");
  const debugMode = canUseRuntimeDebug(session.role) && searchParams.get("debug") === "runtime";
  const isolateMode = debugMode && searchParams.get("isolate") === "1";
  if (rawRole && !role) {
    console.warn("staff_attendance_invalid_role_filter", { rawRole, shopId });
  }
  if (rawActiveFilter && !VALID_ACTIVE_FILTERS.has(rawActiveFilter)) {
    console.warn("staff_attendance_invalid_active_filter", { rawActiveFilter, shopId });
  }

  const userWhere: Prisma.UserWhereInput = {
    shopId,
    ...(isolateMode ? {} : {
      ...(staffName ? { name: { contains: staffName, mode: "insensitive" } } : {}),
      ...(role ? { role } : {}),
      ...(activeFilter === "active" ? { disabledAt: null } : {}),
      ...(activeFilter === "inactive" ? { disabledAt: { not: null } } : {}),
    }),
  };
  const rawAttendanceWhere: Prisma.AttendanceWhereInput = { shopId };
  const filteredAttendanceWhere: Prisma.AttendanceWhereInput = { shopId, workDate: { gte: from, lte: to } };
  const attendanceWhere = isolateMode ? rawAttendanceWhere : filteredAttendanceWhere;
  const rawAttendanceCount = await prisma.attendance.count({ where: rawAttendanceWhere }).catch((error: unknown) => {
    console.error("staff_attendance_raw_count_failed", {
      message: error instanceof Error ? error.message : "Unknown raw attendance count failure",
      shopId,
    });
    return 0;
  });
  const simpleRawRows = await prisma.$queryRaw<SimpleAttendanceRow[]>(Prisma.sql`
    SELECT
      a."id",
      a."staffId",
      COALESCE(u."name", 'Staff') AS "staffName",
      CASE
        WHEN u."role"::text = 'SUPER_ADMIN' THEN 'SUPER_ADMIN'
        WHEN u."role"::text = 'SHOP_ADMIN' THEN 'SHOP_ADMIN'
        WHEN u."role"::text = 'SALES_PERSON_CUM_ACCOUNTS' OR (u."role"::text LIKE '%SALES%' AND (u."role"::text LIKE '%ACCOUNT%' OR u."role"::text LIKE '%ACCOUNTING%')) THEN 'SALES_PERSON_CUM_ACCOUNTS'
        WHEN u."role"::text = 'SALES_PERSON' OR u."role"::text = 'SALES' OR u."role"::text LIKE '%FIELD%' THEN 'SALES_PERSON'
        ELSE 'ACCOUNT_STAFF'
      END AS "role",
      a."workDate",
      a."startedAt",
      a."endedAt",
      a."activeMinutes",
      a."status"::text AS "status"
    FROM "Attendance" a
    LEFT JOIN "User" u ON u."id" = a."staffId"
    WHERE a."shopId" = ${shopId}
    ORDER BY a."startedAt" DESC
    LIMIT 500
  `);

  if (isolateMode) {
    const debug = {
      enabled: true,
      isolateMode,
      session: {
        userId: session.id,
        role: session.role,
        sessionShopId: session.shopId,
        resolvedShopId: shopId,
      },
      filtersReceived: {
        preset: searchParams.get("preset") || "today",
        from: searchParams.get("from") || null,
        to: searchParams.get("to") || null,
        staffName: staffName || null,
        role: role || null,
        active: activeFilter || null,
        format: format || null,
      },
      rawWhere: rawAttendanceWhere,
      generatedWhereClause: filteredAttendanceWhere,
      effectiveWhereClause: rawAttendanceWhere,
      rawAttendanceCount,
      returnedRawRows: simpleRawRows.length,
    };
    console.info("staff_attendance_runtime_isolation_debug", debug);
    return NextResponse.json({ success: true, range: { from, to, label }, debug, rawRows: simpleRawRows });
  }

  if (!format) {
    const summary = {
      staffPresentToday: simpleRawRows.length,
      activeInField: simpleRawRows.filter((row) => row.status === "ACTIVE").length,
      totalVisits: 0,
      ordersTakenToday: 0,
      paymentsCollectedToday: 0,
      pendingStaffCheckouts: 0,
    };
    console.info("staff_attendance_simple_response", {
      shopId,
      rawAttendanceCount,
      returnedRawRows: simpleRawRows.length,
      reason: "Temporary simple attendance response while aggregation/rendering mismatch is isolated",
    });
    return NextResponse.json({ success: true, range: { from, to, label }, rows: [], rawRows: simpleRawRows, summary });
  }

  console.info("staff_attendance_report_query", {
    incomingFilters: {
      preset: searchParams.get("preset") || "today",
      from: searchParams.get("from") || null,
      to: searchParams.get("to") || null,
      staffName: staffName || null,
      role: role || null,
      active: activeFilter || null,
      format: format || null,
    },
    range: { from: from.toISOString(), to: to.toISOString(), label },
    userWhere,
    attendanceWhere,
  });

  const userConditions: Prisma.Sql[] = [Prisma.sql`u."shopId" = ${shopId}`];
  if (staffName) userConditions.push(Prisma.sql`u."name" ILIKE ${`%${staffName}%`}`);
  if (role) userConditions.push(Prisma.sql`
    CASE
      WHEN u."role"::text = 'SALES_PERSON_CUM_ACCOUNTS' OR (u."role"::text LIKE '%SALES%' AND (u."role"::text LIKE '%ACCOUNT%' OR u."role"::text LIKE '%ACCOUNTING%')) THEN 'SALES_PERSON_CUM_ACCOUNTS'
      WHEN u."role"::text = 'SALES_PERSON' OR u."role"::text = 'SALES' OR u."role"::text LIKE '%FIELD%' THEN 'SALES_PERSON'
      WHEN u."role"::text = 'SUPER_ADMIN' THEN 'SUPER_ADMIN'
      WHEN u."role"::text = 'SHOP_ADMIN' THEN 'SHOP_ADMIN'
      ELSE 'ACCOUNT_STAFF'
    END = ${role}
  `);
  if (activeFilter === "active") userConditions.push(Prisma.sql`u."disabledAt" IS NULL`);
  if (activeFilter === "inactive") userConditions.push(Prisma.sql`u."disabledAt" IS NOT NULL`);
  const users = await prisma.$queryRaw<StaffUserRow[]>(Prisma.sql`
    SELECT
      u."id",
      u."name",
      CASE
        WHEN u."role"::text = 'SALES_PERSON_CUM_ACCOUNTS' OR (u."role"::text LIKE '%SALES%' AND (u."role"::text LIKE '%ACCOUNT%' OR u."role"::text LIKE '%ACCOUNTING%')) THEN 'SALES_PERSON_CUM_ACCOUNTS'
        WHEN u."role"::text = 'SALES_PERSON' OR u."role"::text = 'SALES' OR u."role"::text LIKE '%FIELD%' THEN 'SALES_PERSON'
        WHEN u."role"::text = 'SUPER_ADMIN' THEN 'SUPER_ADMIN'
        WHEN u."role"::text = 'SHOP_ADMIN' THEN 'SHOP_ADMIN'
        ELSE 'ACCOUNT_STAFF'
      END AS "role",
      u."disabledAt"
    FROM "User" u
    WHERE ${Prisma.join(userConditions, " AND ")}
    ORDER BY u."name" ASC
  `).catch((error: unknown) => {
    console.error("staff_attendance_prisma_query_failed", {
      label: "users",
      message: error instanceof Error ? error.message : "Unknown Prisma query failure",
      shopId,
      range: { from: from.toISOString(), to: to.toISOString(), label },
      userWhere,
    });
    throw error;
  });
  const aggregationResults = await Promise.allSettled([
    prisma.attendance.findMany({ where: attendanceWhere, orderBy: { startedAt: "asc" } }),
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
  const attendances = settledValue(aggregationResults[0], [], "attendance");
  const visits = settledValue(aggregationResults[1], [], "visits");
  const orders = settledValue(aggregationResults[2], [], "orders");
  const payments = settledValue(aggregationResults[3], [], "payments");
  const cheques = settledValue(aggregationResults[4], [], "cheques");
  const locations = settledValue(aggregationResults[5], [], "locations");
  const activity = settledValue(aggregationResults[6], [], "activity");
  const followUps = settledValue(aggregationResults[7], [], "followUps");
  const chequeActivities = settledValue(aggregationResults[8], [], "chequeActivities");

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

  let rows: StaffRow[] = users.map((user) => {
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
  let usedRawAttendanceFallback = false;
  if (rows.length === 0 && rawAttendanceCount && rawAttendanceCount > 0) {
    rows = simpleRawRows.map((item) => ({
      staffId: item.staffId,
      staffName: item.staffName,
      role: item.role as UserRole,
      loginTime: item.startedAt,
      logoutTime: item.endedAt,
      firstActivity: item.startedAt,
      lastActivity: item.endedAt ?? item.startedAt,
      totalActiveMinutes: item.activeMinutes || minutesBetween(item.startedAt, item.endedAt ?? new Date()),
      totalVisits: 0,
      completedVisits: 0,
      ordersTaken: 0,
      paymentsCollected: 0,
      chequesCollected: 0,
      followUpsHandled: 0,
      chequeProcessing: 0,
      gpsActiveStatus: "Not checked",
      currentStatus: currentStatus({ attendanceStatus: item.status, endedAt: item.endedAt, lastActivity: item.endedAt ?? item.startedAt }),
    }));
    usedRawAttendanceFallback = true;
    console.warn("staff_attendance_raw_fallback_used", {
      shopId,
      rawAttendanceCount,
      fallbackRows: rows.length,
      reason: "Aggregated staff report produced no rows while raw attendance exists",
    });
  }

  const pendingStaffCheckouts = await prisma.staffVisit.count({ where: { shopId, status: "CHECKED_IN", checkInAt: { gte: from, lte: to } } }).catch((error: unknown) => {
    console.error("staff_attendance_pending_checkout_count_failed", {
      message: error instanceof Error ? error.message : "Unknown pending checkout count failure",
      shopId,
      range: { from: from.toISOString(), to: to.toISOString(), label },
    });
    return 0;
  });

  const summary = {
    staffPresentToday: rows.filter((row) => row.loginTime || row.firstActivity).length,
    activeInField: rows.filter((row) => row.currentStatus === "ACTIVE").length,
    totalVisits: rows.reduce((sum, row) => sum + row.totalVisits, 0),
    ordersTakenToday: rows.reduce((sum, row) => sum + row.ordersTaken, 0),
    paymentsCollectedToday: rows.reduce((sum, row) => sum + row.paymentsCollected, 0),
    pendingStaffCheckouts,
  };
  const runtimeDebug = debugMode
    ? {
        enabled: true,
        isolateMode,
        session: {
          userId: session.id,
          role: session.role,
          sessionShopId: session.shopId,
          resolvedShopId: shopId,
        },
        filtersReceived: {
          preset: searchParams.get("preset") || "today",
          from: searchParams.get("from") || null,
          to: searchParams.get("to") || null,
          staffName: staffName || null,
          role: role || null,
          active: activeFilter || null,
          format: format || null,
        },
        rawWhere: rawAttendanceWhere,
        generatedWhereClause: filteredAttendanceWhere,
        effectiveWhereClause: attendanceWhere,
        rawAttendanceCount: rawAttendanceCount ?? null,
        filteredAttendanceRows: attendances.length,
        returnedReportRows: rows.length,
        usedRawAttendanceFallback,
        rowsDisappearAfterFilters: typeof rawAttendanceCount === "number" ? rawAttendanceCount > 0 && attendances.length === 0 : null,
      }
    : undefined;
  if (runtimeDebug) {
    console.info("staff_attendance_runtime_isolation_debug", runtimeDebug);
  }

  console.info("staff_attendance_report_result", {
    userCount: users.length,
    attendanceCount: attendances.length,
    visitGroups: visits.length,
    responseRows: rows.length,
    usedRawAttendanceFallback,
    summary,
  });

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

  return NextResponse.json({ success: true, range: { from, to, label }, rows, summary, ...(runtimeDebug ? { debug: runtimeDebug } : {}) });
}
