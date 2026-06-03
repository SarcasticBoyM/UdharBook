import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canViewReports } from "@/lib/permissions";
import { requireShopId } from "@/lib/tenant";
import { reportToCsv } from "@/lib/excel/export";

const PAGE_SIZE_MAX = 100;

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

function asDate(value: string | null, end = false) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  if (end) date.setHours(23, 59, 59, 999);
  else date.setHours(0, 0, 0, 0);
  return date;
}

function formatDateTime(date: Date | null | undefined) {
  return date ? date.toISOString() : "";
}

function rowFromFollowUp(row: Prisma.FollowUpGetPayload<{
  include: {
    customer: { include: { payments: true } };
    createdBy: { select: { id: true; name: true; role: true } };
  };
}>) {
  const lastPayment = row.customer.payments[0];
  const recoveryAmount = row.status === "PAID" ? row.customer.outstandingBalance : (lastPayment?.amount ?? 0);
  return {
    id: row.id,
    customerId: row.customerId,
    customerName: row.customer.partyName,
    mobileNumber: row.customer.contactNumber,
    outstandingAmount: row.customer.outstandingBalance,
    followUpDateTime: row.followupDate,
    reminderStatus: row.remindedAt ? "Reminder sent" : row.scheduledAt ? "Reminder scheduled" : "No reminder",
    lastFollowUp: row.customer.lastFollowupDate ?? row.followupDate,
    nextFollowUp: row.nextFollowupDate ?? row.customer.nextFollowupDate,
    staffId: row.createdById,
    staffName: row.createdBy.name,
    userRole: row.createdBy.role,
    followUpStatus: row.status,
    promiseDate: row.status === "PAYMENT_PROMISED" ? row.nextFollowupDate : null,
    recoveryAmount,
    paymentStatus: row.customer.outstandingBalance <= 0 ? "Recovered" : recoveryAmount > 0 ? "Partial" : "Pending",
    notes: row.notes ?? row.customerResponse ?? "",
    completionStatus: row.completedAt ? "Completed" : row.status === "PAID" || row.status === "COMPLETED" ? "Completed" : "Open",
    createdAt: row.createdAt,
    lastActivityTimestamp: row.actionLoggedAt ?? row.followupDate,
  };
}

async function rowsToExcel(rows: ReturnType<typeof rowFromFollowUp>[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Follow-up Reports");
  sheet.columns = [
    { header: "Customer Name", key: "customerName", width: 28 },
    { header: "Mobile Number", key: "mobileNumber", width: 16 },
    { header: "Outstanding Amount", key: "outstandingAmount", width: 18 },
    { header: "Follow-up Date & Time", key: "followUpDateTime", width: 24 },
    { header: "Reminder Status", key: "reminderStatus", width: 20 },
    { header: "Last Follow-up", key: "lastFollowUp", width: 24 },
    { header: "Next Follow-up", key: "nextFollowUp", width: 24 },
    { header: "Created By", key: "staffName", width: 18 },
    { header: "User Role", key: "userRole", width: 16 },
    { header: "Follow-up Status", key: "followUpStatus", width: 18 },
    { header: "Promise Date", key: "promiseDate", width: 24 },
    { header: "Recovery Amount", key: "recoveryAmount", width: 18 },
    { header: "Payment Status", key: "paymentStatus", width: 16 },
    { header: "Notes/Remarks", key: "notes", width: 42 },
    { header: "Completion Status", key: "completionStatus", width: 18 },
    { header: "Created At", key: "createdAt", width: 24 },
    { header: "Last Activity Timestamp", key: "lastActivityTimestamp", width: 28 },
  ];
  sheet.getRow(1).font = { bold: true };
  rows.forEach((row) =>
    sheet.addRow({
      ...row,
      followUpDateTime: formatDateTime(row.followUpDateTime),
      lastFollowUp: formatDateTime(row.lastFollowUp),
      nextFollowUp: formatDateTime(row.nextFollowUp),
      promiseDate: formatDateTime(row.promiseDate),
      createdAt: formatDateTime(row.createdAt),
      lastActivityTimestamp: formatDateTime(row.lastActivityTimestamp),
    })
  );
  return workbook.xlsx.writeBuffer();
}

function rowsToCsv(rows: ReturnType<typeof rowFromFollowUp>[]) {
  return reportToCsv(
    [
      "Customer Name",
      "Mobile Number",
      "Outstanding Amount",
      "Follow-up Date & Time",
      "Reminder Status",
      "Last Follow-up",
      "Next Follow-up",
      "Created By",
      "User Role",
      "Follow-up Status",
      "Promise Date",
      "Recovery Amount",
      "Payment Status",
      "Notes/Remarks",
      "Completion Status",
      "Created At",
      "Last Activity Timestamp",
    ],
    rows.map((row) => [
      row.customerName,
      row.mobileNumber,
      String(row.outstandingAmount),
      formatDateTime(row.followUpDateTime),
      row.reminderStatus,
      formatDateTime(row.lastFollowUp),
      formatDateTime(row.nextFollowUp),
      row.staffName,
      row.userRole,
      row.followUpStatus,
      formatDateTime(row.promiseDate),
      String(row.recoveryAmount),
      row.paymentStatus,
      row.notes,
      row.completionStatus,
      formatDateTime(row.createdAt),
      formatDateTime(row.lastActivityTimestamp),
    ])
  );
}

function rowsToPrintableHtml(rows: ReturnType<typeof rowFromFollowUp>[]) {
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Follow-up Reports</title><style>
body{font-family:Arial,sans-serif;padding:24px;color:#111827}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #d1d5db;padding:6px;text-align:left;vertical-align:top}th{background:#f3f4f6}h1{font-size:20px}
@media print{@page{size:landscape;margin:12mm}}
</style></head><body><h1>Follow-up Reports</h1><table><thead><tr>${[
    "Customer",
    "Mobile",
    "Outstanding",
    "Last Follow-up",
    "Next Follow-up",
    "Staff",
    "Status",
    "Promise Date",
    "Recovery",
    "Payment",
    "Notes",
    "Last Activity",
  ]
    .map((header) => `<th>${header}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr><td>${escape(row.customerName)}</td><td>${escape(row.mobileNumber)}</td><td>${row.outstandingAmount}</td><td>${formatDateTime(row.lastFollowUp)}</td><td>${formatDateTime(row.nextFollowUp)}</td><td>${escape(row.staffName)}</td><td>${escape(row.followUpStatus)}</td><td>${formatDateTime(row.promiseDate)}</td><td>${row.recoveryAmount}</td><td>${escape(row.paymentStatus)}</td><td>${escape(row.notes)}</td><td>${formatDateTime(row.lastActivityTimestamp)}</td></tr>`
    )
    .join("")}</tbody></table><script>window.print()</script></body></html>`;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewReports(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = requireShopId(request, session);
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(searchParams.get("limit") ?? 25)));
  const skip = (page - 1) * limit;
  const format = searchParams.get("format");
  const from = asDate(searchParams.get("from"));
  const to = asDate(searchParams.get("to"), true);
  const staffId = searchParams.get("staffId") || undefined;
  const customer = searchParams.get("customer")?.trim();
  const status = searchParams.get("status") || undefined;
  const minAmount = Number(searchParams.get("minAmount") || "");
  const maxAmount = Number(searchParams.get("maxAmount") || "");
  const overdueOnly = searchParams.get("overdueOnly") === "true";
  const todayOnly = searchParams.get("todayOnly") === "true";
  const promiseOnly = searchParams.get("promiseOnly") === "true";
  const completedOnly = searchParams.get("completedOnly") === "true";
  const pendingOnly = searchParams.get("pendingOnly") === "true";
  const todayStart = startOfToday();
  const todayEnd = endOfToday();

  const where: Prisma.FollowUpWhereInput = {
    shopId,
    ...(todayOnly
      ? { followupDate: { gte: todayStart, lte: todayEnd } }
      : from || to
        ? { followupDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    ...(staffId ? { createdById: staffId } : {}),
    ...(status ? { status: status as Prisma.EnumFollowUpStatusFilter["equals"] } : {}),
    ...(promiseOnly ? { status: "PAYMENT_PROMISED" } : {}),
    ...(completedOnly ? { status: { in: ["PAID", "COMPLETED"] } } : {}),
    ...(pendingOnly ? { status: { in: ["PENDING", "RESCHEDULED", "NOT_REACHABLE", "PAYMENT_PROMISED"] } } : {}),
    ...(overdueOnly ? { nextFollowupDate: { lt: todayStart } } : {}),
    customer: {
      shopId,
      ...(customer
        ? {
            OR: [
              { partyName: { contains: customer } },
              { contactNumber: { contains: customer.replace(/\D/g, "") } },
            ],
          }
        : {}),
      ...(Number.isFinite(minAmount) ? { outstandingBalance: { gte: minAmount } } : {}),
      ...(Number.isFinite(maxAmount)
        ? { outstandingBalance: { ...(Number.isFinite(minAmount) ? { gte: minAmount } : {}), lte: maxAmount } }
        : {}),
    },
  };

  const include = {
    customer: {
      include: {
        payments: { orderBy: { paidAt: "desc" as const }, take: 1 },
      },
    },
    createdBy: { select: { id: true, name: true, role: true } },
  };

  const [followUps, total, users, paymentsToday, outstanding, allToday, staffGroups, trendRows] =
    await prisma.$transaction([
      prisma.followUp.findMany({
        where,
        include,
        orderBy: [
          { nextFollowupDate: { sort: "asc", nulls: "last" } },
          { scheduledAt: { sort: "asc", nulls: "last" } },
          { followupDate: "asc" },
        ],
        skip: format ? 0 : skip,
        take: format ? 1000 : limit,
      }),
      prisma.followUp.count({ where }),
      prisma.user.findMany({ where: { shopId }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
      prisma.paymentEntry.aggregate({
        where: { shopId, paidAt: { gte: todayStart, lte: todayEnd } },
        _sum: { amount: true },
      }),
      prisma.customer.aggregate({
        where: { shopId, outstandingBalance: { gt: 0 } },
        _sum: { outstandingBalance: true },
        _count: { id: true },
      }),
      prisma.followUp.count({ where: { shopId, followupDate: { gte: todayStart, lte: todayEnd } } }),
      prisma.followUp.groupBy({
        by: ["createdById"],
        where: { shopId, followupDate: { gte: todayStart, lte: todayEnd } },
        orderBy: { createdById: "asc" },
        _count: { _all: true },
      }),
      prisma.paymentEntry.findMany({
        where: { shopId },
        orderBy: { paidAt: "asc" },
        take: 180,
        select: { amount: true, paidAt: true },
      }),
    ]);

  const rows = followUps.map(rowFromFollowUp);
  if (format === "xlsx") {
    const buffer = await rowsToExcel(rows);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="follow-up-reports.xlsx"',
      },
    });
  }
  if (format === "csv") {
    return new NextResponse(rowsToCsv(rows), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="follow-up-reports.csv"',
      },
    });
  }
  if (format === "pdf") {
    return new NextResponse(rowsToPrintableHtml(rows), {
      headers: {
        "Content-Type": "text/html",
        "Content-Disposition": 'inline; filename="follow-up-reports-print.html"',
      },
    });
  }

  const userMap = new Map(users.map((user) => [user.id, user.name]));
  const staffPerformance = staffGroups
    .map((group) => ({
      staffId: group.createdById,
      staffName: userMap.get(group.createdById) ?? "Staff",
      callsCompleted: typeof group._count === "object" ? group._count._all ?? 0 : 0,
      recoveriesCompleted: rows.filter((row) => row.staffId === group.createdById && row.paymentStatus !== "Pending").length,
      recoveryAmount: rows
        .filter((row) => row.staffId === group.createdById)
        .reduce((sum, row) => sum + row.recoveryAmount, 0),
      pendingCases: rows.filter((row) => row.staffId === group.createdById && row.paymentStatus === "Pending").length,
      promisesCollected: rows.filter((row) => row.staffId === group.createdById && row.followUpStatus === "PAYMENT_PROMISED").length,
      averageFollowUpTime: "Same day",
    }))
    .sort((a, b) => b.recoveryAmount - a.recoveryAmount || b.callsCompleted - a.callsCompleted);

  const trendMap = new Map<string, number>();
  for (const payment of trendRows) {
    const key = payment.paidAt.toISOString().slice(0, 10);
    trendMap.set(key, (trendMap.get(key) ?? 0) + payment.amount);
  }

  return NextResponse.json({
    rows,
    users,
    summary: {
      dailyFollowUps: allToday,
      recoveryToday: paymentsToday._sum.amount ?? 0,
      pendingAmount: outstanding._sum.outstandingBalance ?? 0,
      pendingCustomers: outstanding._count.id,
      promises: rows.filter((row) => row.followUpStatus === "PAYMENT_PROMISED").length,
      notResponding: rows.filter((row) => row.followUpStatus === "NOT_REACHABLE").length,
      overdue: rows.filter((row) => row.nextFollowUp && row.nextFollowUp < todayStart).length,
      completed: rows.filter((row) => ["PAID", "COMPLETED"].includes(row.followUpStatus)).length,
    },
    staffPerformance,
    trend: Array.from(trendMap.entries()).map(([date, amount]) => ({ date, amount })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}
