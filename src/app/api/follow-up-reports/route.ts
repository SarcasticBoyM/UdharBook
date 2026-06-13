import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { Prisma, type ChequeStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canViewReports } from "@/lib/permissions";
import { normalizeFixedRole } from "@/lib/operational-roles";
import { resolveOperationalShopId } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import { reportToCsv } from "@/lib/excel/export";

const PAGE_SIZE_MAX = 100;
const ACTIVITY_LIMIT = 2000;
const REPORT_TIME_ZONE = "Asia/Kolkata";
const VALID_FOLLOW_UP_STATUSES = new Set([
  "PENDING",
  "CALLBACK",
  "FOLLOW_UP_REQUIRED",
  "CONTACTED",
  "PAYMENT_PROMISED",
  "PARTIAL_PAID",
  "PAID",
  "NOT_REACHABLE",
  "WRONG_NUMBER",
  "COMPLETED",
  "MISSED",
  "RESCHEDULED",
]);

type StatusTone = "green" | "yellow" | "red" | "blue" | "slate";

type TimelineItem = {
  at: Date;
  type: string;
  summary: string;
  by: string;
  status: string;
  notes: string;
};

type ReportRow = {
  id: string;
  customerId: string;
  customerName: string;
  ledgerTag: string;
  mobileNumber: string;
  currentBalance: number;
  summary: string;
  detailedNotes: string;
  followUpType: string;
  recoveryAmount: number;
  paymentStatus: string;
  promiseDate: Date | null;
  nextAction: string;
  nextActionAt: Date | null;
  reminderStatus: string;
  status: string;
  statusTone: StatusTone;
  createdBy: string;
  userRole: string;
  staffId: string;
  visitStatus: string;
  chequeStatus: string;
  bankAccount: string;
  depositStatus: string;
  createdAt: Date;
  lastUpdatedAt: Date;
  latestActivityAt: Date;
  relativeActivityTime: string;
  isOverdue: boolean;
  isPromise: boolean;
  notes: string;
  timeline: TimelineItem[];
};

function istDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function businessDayBoundary(dateOnly: string, end = false) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!match) return undefined;
  const [, year, month, day] = match;
  const boundary = new Date(`${year}-${month}-${day}T00:00:00+05:30`);
  if (Number.isNaN(boundary.getTime())) return undefined;
  if (end) return new Date(boundary.getTime() + 24 * 60 * 60 * 1000 - 1);
  return boundary;
}

function asDate(value: string | null, end = false) {
  if (!value) return undefined;
  const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return dateOnly ? businessDayBoundary(dateOnly, end) : undefined;
}

function finiteNumber(value: string | null) {
  if (!value?.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function positiveInteger(value: string | null, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeStatusFilter(value: string | null) {
  const normalized = value?.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!normalized) return undefined;
  if (normalized === "PROMISE_TO_PAY") return "PAYMENT_PROMISED";
  if (normalized === "FOLLOW_UP_LATER") return "RESCHEDULED";
  return VALID_FOLLOW_UP_STATUSES.has(normalized) ? normalized : null;
}

function normalizedRoleLabel(role: string | null | undefined) {
  return humanStatus(String(normalizeFixedRole(role ?? "ACCOUNT_STAFF")));
}

async function optionalReportQuery<T>(
  label: string,
  query: Promise<T>,
  fallback: T,
  context: { shopId: string; sessionUserId: string },
) {
  try {
    return await query;
  } catch (error) {
    logger.error("follow_up_report_optional_query_failed", {
      event: "follow_up_report_optional_query_failed",
      query: label,
      ...context,
      prismaCode: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

function formatDateTime(date: Date | null | undefined) {
  return date ? date.toISOString() : "";
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatShortDate(date: Date | null | undefined) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function relativeTime(date: Date) {
  const diffMs = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "Just now";
  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 2 * day) return "Yesterday";
  return `${Math.floor(diffMs / day)}d ago`;
}

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() || "";
}

function reportPaymentKey(customerId: string, amount: number, at: Date) {
  return `${customerId}:${amount}:${at.toISOString().slice(0, 10)}`;
}

function humanStatus(value: string) {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

function toneForStatus(status: string): StatusTone {
  if (["Paid", "Completed", "Recovered", "Cleared"].includes(status)) return "green";
  if (["Promise To Pay", "Rescheduled", "Callback", "Cheque Collected", "Deposited"].includes(status)) return "blue";
  if (["Pending", "Partial Paid", "Follow Up Required", "Collected"].includes(status)) return "yellow";
  if (["Not Reachable", "Wrong Number", "Missed", "Bounced", "Overdue"].includes(status)) return "red";
  return "slate";
}

function nextActionFor(customer: { nextFollowupDate: Date | null }, activityNext?: Date | null) {
  const next = activityNext ?? customer.nextFollowupDate;
  if (!next) return { text: "No next action set", at: null };
  return { text: `Follow up ${formatShortDate(next)}`, at: next };
}

function reminderStatusFor(followUp: {
  reminderSentAt: Date | null;
  manualReminder: boolean;
  reminderEnabled: boolean;
  nextFollowUpDateTime: Date | null;
  scheduledAt: Date | null;
}) {
  if (followUp.reminderSentAt) return `Reminder sent ${formatShortDate(followUp.reminderSentAt)}`;
  const reminderAt = followUp.nextFollowUpDateTime ?? followUp.scheduledAt;
  if (followUp.manualReminder && followUp.reminderEnabled && reminderAt) return `Reminder set ${formatShortDate(reminderAt)}`;
  return "No reminder";
}

function paymentStatusFor(balance: number, recovered: number) {
  if (balance <= 0) return "Recovered";
  if (recovered > 0) return "Partial";
  return "Pending";
}

function followUpSummary(input: {
  status: string;
  actor: string;
  notes: string;
  response: string;
  nextDate: Date | null;
  unreachableCount: number;
}) {
  const notes = input.notes || input.response;
  if (input.status === "PAYMENT_PROMISED") {
    return `${input.actor} recorded promise to pay${input.nextDate ? ` on ${formatShortDate(input.nextDate)}` : ""}`;
  }
  if (input.status === "NOT_REACHABLE") {
    return `Not responding since ${Math.max(1, input.unreachableCount)} follow-up${input.unreachableCount === 1 ? "" : "s"}`;
  }
  if (input.status === "CALLBACK" || input.status === "RESCHEDULED") {
    return notes || `Customer requested callback${input.nextDate ? ` ${formatShortDate(input.nextDate)}` : ""}`;
  }
  if (input.status === "PAID" || input.status === "COMPLETED") {
    return notes || `Follow-up completed by ${input.actor}`;
  }
  if (input.status === "PARTIAL_PAID") {
    return notes || `Partial payment discussed by ${input.actor}`;
  }
  if (notes) return notes;
  return `Follow-up ${humanStatus(input.status).toLowerCase()} by ${input.actor}`;
}

function chequeActivityDate(cheque: {
  status: ChequeStatus;
  collectionDateTime: Date;
  depositDateTime: Date | null;
  clearedAt: Date | null;
  bouncedAt: Date | null;
}) {
  if (cheque.status === "BOUNCED" && cheque.bouncedAt) return cheque.bouncedAt;
  if (cheque.status === "CLEARED" && cheque.clearedAt) return cheque.clearedAt;
  if (cheque.status === "DEPOSITED" && cheque.depositDateTime) return cheque.depositDateTime;
  return cheque.collectionDateTime;
}

function chequeSummary(cheque: {
  status: ChequeStatus;
  amount: number;
  bankName: string;
  depositedAccount: { bankName: string; accountName: string } | null;
  bounceReason: string | null;
  collectedBy: { name: string };
}) {
  if (cheque.status === "BOUNCED") {
    return `Cheque bounced${cheque.bounceReason ? `: ${cheque.bounceReason}` : ", customer informed"}`;
  }
  if (cheque.status === "CLEARED") return `Cheque cleared ${formatMoney(cheque.amount)}`;
  if (cheque.status === "DEPOSITED") {
    const bank = cheque.depositedAccount?.bankName ?? cheque.bankName;
    return `Cheque deposited in ${bank}`;
  }
  return `Visited by ${cheque.collectedBy.name}, cheque collected ${formatMoney(cheque.amount)}`;
}

function rowsToCsv(rows: ReportRow[]) {
  return reportToCsv(
    [
      "Customer Name",
      "Batch / Firm",
      "Mobile Number",
      "Balance Amount",
      "Follow-up Summary",
      "Detailed Notes",
      "Follow-up Type",
      "Recovery Amount",
      "Payment Status",
      "Promise Date",
      "Next Follow-up Date",
      "Reminder Status",
      "Follow-up By",
      "User Role",
      "Visit Status",
      "Cheque Status",
      "Bank Account",
      "Deposit Status",
      "Created Date & Time",
      "Last Updated Time",
    ],
    rows.map((row) => [
      row.customerName,
      row.ledgerTag,
      row.mobileNumber,
      String(row.currentBalance),
      row.summary,
      row.detailedNotes,
      row.followUpType,
      String(row.recoveryAmount),
      row.paymentStatus,
      formatDateTime(row.promiseDate),
      formatDateTime(row.nextActionAt),
      row.reminderStatus,
      row.createdBy,
      row.userRole,
      row.visitStatus,
      row.chequeStatus,
      row.bankAccount,
      row.depositStatus,
      formatDateTime(row.createdAt),
      formatDateTime(row.lastUpdatedAt),
    ]),
  );
}

async function rowsToExcel(rows: ReportRow[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Follow-up Reports");
  sheet.columns = [
    { header: "Customer Name", key: "customerName", width: 28 },
    { header: "Batch / Firm", key: "ledgerTag", width: 14 },
    { header: "Mobile Number", key: "mobileNumber", width: 16 },
    { header: "Balance Amount", key: "currentBalance", width: 18 },
    { header: "Follow-up Summary", key: "summary", width: 52 },
    { header: "Detailed Notes", key: "detailedNotes", width: 44 },
    { header: "Follow-up Type", key: "followUpType", width: 18 },
    { header: "Recovery Amount", key: "recoveryAmount", width: 18 },
    { header: "Payment Status", key: "paymentStatus", width: 18 },
    { header: "Promise Date", key: "promiseDate", width: 24 },
    { header: "Next Follow-up Date", key: "nextActionAt", width: 24 },
    { header: "Reminder Status", key: "reminderStatus", width: 24 },
    { header: "Follow-up By", key: "createdBy", width: 18 },
    { header: "User Role", key: "userRole", width: 16 },
    { header: "Visit Status", key: "visitStatus", width: 18 },
    { header: "Cheque Status", key: "chequeStatus", width: 18 },
    { header: "Bank Account", key: "bankAccount", width: 28 },
    { header: "Deposit Status", key: "depositStatus", width: 18 },
    { header: "Created Date & Time", key: "createdAt", width: 24 },
    { header: "Last Updated Time", key: "lastUpdatedAt", width: 24 },
  ];
  sheet.getRow(1).font = { bold: true };
  rows.forEach((row) =>
    sheet.addRow({
      ...row,
      promiseDate: formatDateTime(row.promiseDate),
      nextActionAt: formatDateTime(row.nextActionAt),
      createdAt: formatDateTime(row.createdAt),
      lastUpdatedAt: formatDateTime(row.lastUpdatedAt),
    }),
  );
  return workbook.xlsx.writeBuffer();
}

function rowsToPrintableHtml(rows: ReportRow[]) {
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Follow-up Reports</title><style>
body{font-family:Arial,sans-serif;padding:24px;color:#111827}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #d1d5db;padding:7px;text-align:left;vertical-align:top}th{background:#f3f4f6}h1{font-size:20px}
@media print{@page{size:landscape;margin:12mm}}
</style></head><body><h1>Follow-up Reports</h1><table><thead><tr>${[
    "Customer Name",
    "Batch / Firm",
    "Mobile Number",
    "Balance Amount",
    "Summary",
    "Next Action",
    "Status",
    "Created By",
    "Activity",
  ]
    .map((header) => `<th>${header}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr><td>${escape(row.customerName)}</td><td>${escape(row.ledgerTag)}</td><td>${escape(row.mobileNumber)}</td><td>${row.currentBalance}</td><td>${escape(row.summary)}</td><td>${escape(row.nextAction)}</td><td>${escape(row.status)}</td><td>${escape(row.createdBy)}</td><td>${escape(row.relativeActivityTime)}</td></tr>`,
    )
    .join("")}</tbody></table><script>window.print()</script></body></html>`;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, code: "UNAUTHORIZED", error: "Unauthorized" }, { status: 401 });
  const normalizedSessionRole = String(normalizeFixedRole(session.role));
  if (!canViewReports(session.role) && normalizedSessionRole !== "SUPER_ADMIN") {
    return NextResponse.json({ success: false, code: "FORBIDDEN", error: "You do not have access to follow-up reports." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const requestedShopId = searchParams.get("shopId")?.trim() || request.headers.get("x-shop-id")?.trim() || null;
  if (normalizedSessionRole !== "SUPER_ADMIN" && requestedShopId && requestedShopId !== session.shopId) {
    return NextResponse.json({ success: false, code: "SHOP_FORBIDDEN", error: "You do not have access to the requested shop." }, { status: 403 });
  }

  let resolvedShopId: string | null = null;
  try {
  const shopId = normalizedSessionRole === "SUPER_ADMIN"
    ? await resolveOperationalShopId(request, session)
    : session.shopId;
  resolvedShopId = shopId;
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } });
  if (!shop) {
    return NextResponse.json({
      success: false,
      code: "SHOP_NOT_FOUND",
      error: "The selected shop was not found.",
    }, { status: 404 });
  }

  const page = positiveInteger(searchParams.get("page"), 1);
  const limit = Math.min(PAGE_SIZE_MAX, positiveInteger(searchParams.get("limit"), 25));
  const format = searchParams.get("format");
  const from = asDate(searchParams.get("from"));
  const to = asDate(searchParams.get("to"), true);
  const staffId = searchParams.get("staffId")?.trim() || undefined;
  const customer = searchParams.get("customer")?.trim() || undefined;
  const batchTag = searchParams.get("batchTag")?.trim() || undefined;
  const includeArchived = searchParams.get("includeArchived") === "true";
  const status = normalizeStatusFilter(searchParams.get("status"));
  if (status === null) {
    return NextResponse.json({
      success: false,
      code: "INVALID_FILTER",
      error: "The selected follow-up status is not valid.",
    }, { status: 400 });
  }
  const outcome = searchParams.get("outcome")?.trim() || undefined;
  const minAmount = finiteNumber(searchParams.get("minAmount"));
  const maxAmount = finiteNumber(searchParams.get("maxAmount"));
  if (minAmount !== undefined && maxAmount !== undefined && minAmount > maxAmount) {
    return NextResponse.json({
      success: false,
      code: "INVALID_FILTER",
      error: "Minimum amount cannot be greater than maximum amount.",
    }, { status: 400 });
  }
  const overdueOnly = searchParams.get("overdueOnly") === "true";
  const todayOnly = searchParams.get("todayOnly") === "true";
  const promiseOnly = searchParams.get("promiseOnly") === "true";
  const completedOnly = searchParams.get("completedOnly") === "true";
  const pendingOnly = searchParams.get("pendingOnly") === "true";
  const todayDate = istDateParts();
  const todayStart = businessDayBoundary(todayDate)!;
  const todayEnd = businessDayBoundary(todayDate, true)!;
  const now = new Date();
  const activityFrom = todayOnly ? todayStart : from;
  const activityTo = todayOnly ? todayEnd : to;

  const activeCustomerWhere: Prisma.CustomerWhereInput = {
    shopId,
    ...(includeArchived ? {} : { isArchived: false }),
    ...(batchTag ? { batchTag: { equals: batchTag, mode: "insensitive" } } : {}),
    ...(customer
      ? {
          OR: [
            { partyName: { contains: customer, mode: "insensitive" } },
            ...(customer.replace(/\D/g, "") ? [{ contactNumber: { contains: customer.replace(/\D/g, "") } }] : []),
          ],
        }
      : {}),
    ...(minAmount !== undefined || maxAmount !== undefined
      ? { outstandingBalance: { ...(minAmount !== undefined ? { gte: minAmount } : {}), ...(maxAmount !== undefined ? { lte: maxAmount } : {}) } }
      : {}),
  };

  const customerWhere: Prisma.CustomerWhereInput = {
    shopId,
    ...(batchTag ? { batchTag: { equals: batchTag, mode: "insensitive" } } : {}),
    ...(customer
      ? {
          OR: [
            { partyName: { contains: customer, mode: "insensitive" } },
            ...(customer.replace(/\D/g, "") ? [{ contactNumber: { contains: customer.replace(/\D/g, "") } }] : []),
          ],
        }
      : {}),
    ...(minAmount !== undefined || maxAmount !== undefined
      ? { outstandingBalance: { ...(minAmount !== undefined ? { gte: minAmount } : {}), ...(maxAmount !== undefined ? { lte: maxAmount } : {}) } }
      : {}),
  };

  const followUpWhere: Prisma.FollowUpWhereInput = {
    shopId,
    ...(activityFrom || activityTo
      ? { followupDate: { ...(activityFrom ? { gte: activityFrom } : {}), ...(activityTo ? { lte: activityTo } : {}) } }
      : {}),
    ...(outcome ? { id: "__visit_outcome_filter__" } : {}),
    ...(staffId ? { createdById: staffId } : {}),
    ...(status ? { status: status as Prisma.EnumFollowUpStatusFilter["equals"] } : {}),
    ...(promiseOnly ? { status: "PAYMENT_PROMISED" } : {}),
    ...(completedOnly ? { status: { in: ["PAID", "COMPLETED"] } } : {}),
    ...(pendingOnly ? { status: { in: ["PENDING", "CALLBACK", "FOLLOW_UP_REQUIRED", "RESCHEDULED", "NOT_REACHABLE", "PAYMENT_PROMISED"] } } : {}),
    ...(overdueOnly
      ? {
          AND: [
            { status: { notIn: ["PAID", "COMPLETED", "WRONG_NUMBER"] } },
            {
              OR: [
                { nextFollowUpDateTime: { lt: now } },
                { nextFollowupDate: { lt: now } },
                { scheduledAt: { lt: now } },
              ],
            },
          ],
        }
      : {}),
    customer: customerWhere,
  };

  const visitWhere: Prisma.StaffVisitWhereInput = {
    shopId,
    status: "COMPLETED",
    ...(activityFrom || activityTo
      ? { checkOutAt: { ...(activityFrom ? { gte: activityFrom } : {}), ...(activityTo ? { lte: activityTo } : {}) } }
      : {}),
    ...(staffId ? { staffId } : {}),
    ...(outcome ? { outcome: { contains: outcome, mode: "insensitive" } } : {}),
    customer: customerWhere,
  };

  const paymentWhere: Prisma.PaymentEntryWhereInput = {
    shopId,
    ...(activityFrom || activityTo
      ? { paidAt: { ...(activityFrom ? { gte: activityFrom } : {}), ...(activityTo ? { lte: activityTo } : {}) } }
      : {}),
    ...(outcome ? { id: "__visit_outcome_filter__" } : {}),
    ...(staffId ? { createdById: staffId } : {}),
    customer: customerWhere,
  };

  const chequeWhere: Prisma.ChequeWhereInput = {
    shopId,
    ...(outcome ? { id: "__visit_outcome_filter__" } : {}),
    ...(activityFrom || activityTo
      ? {
          OR: [
            { collectionDateTime: { ...(activityFrom ? { gte: activityFrom } : {}), ...(activityTo ? { lte: activityTo } : {}) } },
            { depositDateTime: { ...(activityFrom ? { gte: activityFrom } : {}), ...(activityTo ? { lte: activityTo } : {}) } },
            { clearedAt: { ...(activityFrom ? { gte: activityFrom } : {}), ...(activityTo ? { lte: activityTo } : {}) } },
            { bouncedAt: { ...(activityFrom ? { gte: activityFrom } : {}), ...(activityTo ? { lte: activityTo } : {}) } },
          ],
        }
      : {}),
    ...(staffId ? { collectedById: staffId } : {}),
    customer: customerWhere,
    AND: [{ OR: [{ staffVisitId: null }, { staffVisit: { status: "COMPLETED" } }] }],
  };

  if (staffId) {
    const staffExists = await prisma.user.count({ where: { id: staffId, shopId } });
    if (!staffExists) {
      return NextResponse.json({
        success: false,
        code: "INVALID_FILTER",
        error: "The selected staff member does not belong to this shop.",
      }, { status: 400 });
    }
  }

  const debugMode = ["SHOP_ADMIN", "SUPER_ADMIN"].includes(normalizedSessionRole) && searchParams.get("debug") === "runtime";
  const isolateMode = debugMode && searchParams.get("isolate") === "1";
  const rawFollowUpCount = await prisma.followUp.count({ where: { shopId } });
  const filteredFollowUpCount = isolateMode ? rawFollowUpCount : await prisma.followUp.count({ where: followUpWhere });
  const incomingFilters = {
    from: searchParams.get("from") || null,
    to: searchParams.get("to") || null,
    staffId: staffId ?? null,
    customer: customer ?? null,
    batchTag: batchTag ?? null,
    status: searchParams.get("status") || null,
    outcome: outcome ?? null,
    minAmount: searchParams.get("minAmount") || null,
    maxAmount: searchParams.get("maxAmount") || null,
    overdueOnly,
    todayOnly,
    promiseOnly,
    completedOnly,
    pendingOnly,
    includeArchived,
  };

  logger.info("follow_up_report_query_started", {
    event: "follow_up_report_query_started",
    sessionUserId: session.id,
    sessionRole: normalizedSessionRole,
    sessionShopId: session.shopId,
    requestedShopId,
    resolvedShopId: shopId,
    incomingFilters,
    generatedWhereClause: followUpWhere,
    rawFollowUpCount,
    filteredFollowUpCount,
  });

  if (isolateMode) {
    const sampleRecords = await prisma.followUp.findMany({
      where: { shopId },
      orderBy: { followupDate: "desc" },
      take: 10,
      select: { id: true },
    });
    return NextResponse.json({
      success: true,
      summary: {
        dailyFollowUps: 0,
        recoveryToday: 0,
        pendingAmount: 0,
        pendingCases: 0,
        pendingCustomers: 0,
        promises: 0,
        notResponding: 0,
        overdue: 0,
        completed: 0,
      },
      rows: [],
      users: [],
      staffPerformance: [],
      collectionTrend: [],
      trend: [],
      filters: { staff: [], batchTags: [] },
      pagination: { page: 1, limit, total: 0, pages: 1 },
      debug: {
        sessionShopId: session.shopId,
        requestedShopId,
        resolvedShopId: shopId,
        rawFollowUpCount,
        filteredFollowUpCount,
        generatedWhereClause: isolateMode ? { shopId } : followUpWhere,
        sampleRecordIds: sampleRecords.map((record) => record.id),
        errorCode: null,
      },
    });
  }

  const [followUps, completedVisits, payments, cheques, users, batchTagRows] = await prisma.$transaction([
      prisma.followUp.findMany({
        where: followUpWhere,
        include: {
          customer: { include: { payments: { orderBy: { paidAt: "desc" }, take: 3 } } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: [{ actionLoggedAt: "desc" }, { followupDate: "desc" }],
        take: ACTIVITY_LIMIT,
      }),
      prisma.staffVisit.findMany({
        where: visitWhere,
        include: {
          customer: { select: { id: true, partyName: true, contactNumber: true, batchTag: true, outstandingBalance: true, nextFollowupDate: true } },
          staff: { select: { id: true, name: true } },
          photos: { orderBy: { createdAt: "desc" }, take: 6 },
          cheques: { orderBy: { createdAt: "desc" }, take: 3, include: { depositedAccount: { select: { bankName: true, accountName: true, lastFourDigits: true } } } },
        },
        orderBy: [{ checkOutAt: "desc" }, { updatedAt: "desc" }],
        take: ACTIVITY_LIMIT,
      }),
      prisma.paymentEntry.findMany({
        where: paymentWhere,
        include: {
          customer: { select: { id: true, partyName: true, contactNumber: true, batchTag: true, outstandingBalance: true, nextFollowupDate: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { paidAt: "desc" },
        take: ACTIVITY_LIMIT,
      }),
      prisma.cheque.findMany({
        where: chequeWhere,
        include: {
          customer: { select: { id: true, partyName: true, contactNumber: true, batchTag: true, outstandingBalance: true, nextFollowupDate: true } },
          collectedBy: { select: { id: true, name: true } },
          depositedAccount: { select: { bankName: true, accountName: true, lastFourDigits: true } },
        },
        orderBy: [{ collectionDateTime: "desc" }, { createdAt: "desc" }],
        take: ACTIVITY_LIMIT,
      }),
      prisma.$queryRaw<Array<{ id: string; name: string; role: string }>>(Prisma.sql`
        SELECT "id", "name", "role"::text AS "role"
        FROM "User"
        WHERE "shopId" = ${shopId}
        ORDER BY "name" ASC
      `),
      prisma.customer.findMany({
        where: { shopId, batchTag: { not: null } },
        distinct: ["batchTag"],
        select: { batchTag: true },
        orderBy: { batchTag: "asc" },
      }),
    ]);

  const queryContext = { shopId, sessionUserId: session.id };
  const paymentsToday = await optionalReportQuery("payments_today", prisma.paymentEntry.aggregate({
    where: { shopId, paidAt: { gte: todayStart, lte: todayEnd }, ...(batchTag ? { customer: activeCustomerWhere } : {}) },
    _sum: { amount: true },
  }), { _sum: { amount: null } }, queryContext);
  const outstanding = await optionalReportQuery("outstanding_summary", prisma.customer.aggregate({
    where: {
      ...activeCustomerWhere,
      outstandingBalance: { gt: 0 },
      NOT: { status: "CLEARED" },
    },
    _sum: { outstandingBalance: true },
    _count: { id: true },
  }), { _sum: { outstandingBalance: null }, _count: { id: 0 } }, queryContext);
  const allToday = await optionalReportQuery("today_follow_up_count", prisma.followUp.count({
    where: { shopId, followupDate: { gte: todayStart, lte: todayEnd }, ...(batchTag ? { customer: customerWhere } : {}) },
  }), 0, queryContext);
  const staffGroups = await optionalReportQuery("staff_performance", prisma.followUp.groupBy({
    by: ["createdById"],
    where: { shopId, followupDate: { gte: todayStart, lte: todayEnd }, ...(batchTag ? { customer: customerWhere } : {}) },
    orderBy: { createdById: "asc" },
    _count: { _all: true },
  }), [], queryContext);
  const trendRows = await optionalReportQuery("collection_trend", prisma.paymentEntry.findMany({
    where: { shopId, ...(batchTag ? { customer: customerWhere } : {}) },
    orderBy: { paidAt: "asc" },
    take: 180,
    select: { amount: true, paidAt: true },
  }), [], queryContext);

  const userRoleMap = new Map(users.map((user) => [user.id, user.role]));
  const notReachableCounts = new Map<string, number>();
  followUps.forEach((followUp) => {
    if (followUp.status === "NOT_REACHABLE") {
      notReachableCounts.set(followUp.customerId, (notReachableCounts.get(followUp.customerId) ?? 0) + 1);
    }
  });

  const activityRows: ReportRow[] = [];
  const pushActivity = (row: ReportRow) => activityRows.push(row);
  const seenVisitIds = new Set<string>();
  const seenChequeIds = new Set<string>();
  const seenPaymentKeys = new Set<string>();

  followUps.forEach((followUp) => {
    const next = nextActionFor(followUp.customer, followUp.nextFollowUpDateTime ?? followUp.nextFollowupDate ?? followUp.scheduledAt);
    const actor = followUp.createdBy.name;
    const notes = cleanText(followUp.notes) || cleanText(followUp.customerResponse);
    const statusLabel = humanStatus(followUp.status);
    const latestActivityAt = followUp.actionLoggedAt ?? followUp.followupDate;
    const recoveryAmount = followUp.recoveryAmount ?? followUp.customer.payments[0]?.amount ?? 0;
    const fallbackSummary = followUpSummary({
      status: followUp.status,
      actor,
      notes: cleanText(followUp.notes),
      response: cleanText(followUp.customerResponse),
      nextDate: followUp.nextFollowUpDateTime ?? followUp.nextFollowupDate ?? null,
      unreachableCount: notReachableCounts.get(followUp.customerId) ?? 0,
    });
    const summary = cleanText(followUp.summary) || fallbackSummary;
    if (followUp.visitId) seenVisitIds.add(followUp.visitId);
    if (followUp.chequeId) seenChequeIds.add(followUp.chequeId);
    if (recoveryAmount > 0 && followUp.sourceModule !== "CHEQUE_COLLECTION") {
      seenPaymentKeys.add(reportPaymentKey(followUp.customerId, recoveryAmount, latestActivityAt));
    }
    pushActivity({
      id: `followup-${followUp.id}`,
      customerId: followUp.customerId,
      customerName: followUp.customer.partyName,
      ledgerTag: followUp.customer.batchTag ?? "",
      mobileNumber: followUp.customer.contactNumber,
      currentBalance: followUp.customer.outstandingBalance,
      summary,
      detailedNotes: [cleanText(followUp.detailedNotes) || notes, cleanText(followUp.reminderNotes)].filter(Boolean).join(" | "),
      followUpType: cleanText(followUp.followUpType) || statusLabel,
      recoveryAmount,
      paymentStatus: cleanText(followUp.paymentStatus) || paymentStatusFor(followUp.customer.outstandingBalance, recoveryAmount),
      promiseDate: followUp.promiseDate ?? (followUp.status === "PAYMENT_PROMISED" ? followUp.nextFollowupDate : null),
      nextAction: followUp.reminderEnabled && followUp.nextFollowUpDateTime
        ? `Reminder ${formatShortDate(followUp.nextFollowUpDateTime)}`
        : next.text,
      nextActionAt: followUp.nextFollowUpDateTime ?? next.at,
      reminderStatus: reminderStatusFor(followUp),
      status: statusLabel,
      statusTone: toneForStatus(statusLabel),
      createdBy: actor,
      userRole: normalizedRoleLabel(userRoleMap.get(followUp.createdById)),
      staffId: followUp.createdById,
      visitStatus: followUp.visitId ? "Completed" : "-",
      chequeStatus: cleanText(followUp.chequeStatus) || "-",
      bankAccount: "-",
      depositStatus: "-",
      createdAt: followUp.createdAt,
      lastUpdatedAt: latestActivityAt,
      latestActivityAt,
      relativeActivityTime: relativeTime(latestActivityAt),
      isOverdue: !["PAID", "COMPLETED", "WRONG_NUMBER"].includes(followUp.status)
        && Boolean((followUp.nextFollowUpDateTime ?? followUp.nextFollowupDate ?? followUp.scheduledAt)
          && (followUp.nextFollowUpDateTime ?? followUp.nextFollowupDate ?? followUp.scheduledAt)! < now),
      isPromise: followUp.status === "PAYMENT_PROMISED" || Boolean(followUp.promiseDate),
      notes,
      timeline: [{ at: latestActivityAt, type: humanStatus(followUp.sourceModule), summary, by: actor, status: statusLabel, notes }],
    });
  });

  completedVisits.forEach((visit) => {
    if (seenVisitIds.has(visit.id)) return;
    const cheque = visit.cheques[0];
    const actor = visit.staff.name;
    const latestActivityAt = visit.checkOutAt ?? visit.updatedAt;
    const visitNotes = [
      cleanText(visit.outcome),
      cleanText(visit.result),
      cleanText(visit.nextAction ? `Next: ${visit.nextAction}` : ""),
      cleanText(visit.orderProductCategory ? `Order Details: ${visit.orderProductCategory}` : ""),
      visit.orderExpectedDelivery ? `Preferred Delivery: ${formatShortDate(visit.orderExpectedDelivery)}` : "",
      cleanText(visit.orderPriority ? `Priority: ${visit.orderPriority}` : ""),
      cleanText(visit.paymentMode ? `Payment mode: ${visit.paymentMode}` : ""),
      cleanText(visit.paymentReference ? `Reference: ${visit.paymentReference}` : ""),
      cleanText(visit.paymentBankName ? `Bank: ${visit.paymentBankName}` : ""),
      cleanText(visit.notes),
      visit.photos.length ? `${visit.photos.length} photo${visit.photos.length === 1 ? "" : "s"} uploaded` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    const orderReceived = (["Sales Visit", "New Lead Visit", "Prospect Visit"].includes(visit.visitType) && visit.outcome === "Order Received") || visit.visitType === "Order Booking";
    const orderSummary = visit.orderPriority === "Urgent" && visit.orderProductCategory
      ? `Urgent order discussed: ${visit.orderProductCategory}`
      : visit.orderExpectedDelivery
        ? `Order received, delivery requested for ${formatShortDate(visit.orderExpectedDelivery)}`
        : "Order received during sales visit";
    const summary = cheque
      ? `Visited by ${actor}, cheque collected ${formatMoney(cheque.amount)}`
      : orderReceived
        ? orderSummary
        : visit.visitType === "Payment Collection" && visit.paymentMode === "Cash" && visit.recoveryAmount > 0
          ? `Cash payment collected ${formatMoney(visit.recoveryAmount)}`
        : visit.visitType === "Payment Collection" && visit.paymentMode === "NEFT / RTGS"
          ? `NEFT payment received${visit.recoveryAmount > 0 ? ` ${formatMoney(visit.recoveryAmount)}` : ""}`
        : visit.visitType === "Payment Collection" && visit.paymentMode === "Cheque Collected"
          ? "Cheque collected during payment visit"
        : visit.recoveryAmount > 0
          ? `Visited by ${actor}, recovered ${formatMoney(visit.recoveryAmount)}`
          : visit.visitType === "Sales Visit" && visit.outcome
            ? `${visit.outcome}, ${visit.notes ? cleanText(visit.notes) : "sales visit completed"}`
            : cleanText(visit.outcome) || cleanText(visit.result) || cleanText(visit.notes) || `${visit.visitType} completed by ${actor}`;
    const statusLabel = visit.recoveryAmount > 0 ? "Recovered" : "Completed";
    const next = nextActionFor(visit.customer);
    pushActivity({
      id: `visit-${visit.id}`,
      customerId: visit.customerId,
      customerName: visit.customer.partyName,
      ledgerTag: visit.customer.batchTag ?? "",
      mobileNumber: visit.customer.contactNumber,
      currentBalance: visit.customer.outstandingBalance,
      summary,
      detailedNotes: visitNotes,
      followUpType: visit.visitType,
      recoveryAmount: visit.recoveryAmount,
      paymentStatus: paymentStatusFor(visit.customer.outstandingBalance, visit.recoveryAmount),
      promiseDate: null,
      nextAction: next.text,
      nextActionAt: next.at,
      reminderStatus: "No reminder",
      status: cheque || visit.paymentMode === "Cheque Collected" ? "Cheque Collected" : orderReceived ? "Order Received" : statusLabel,
      statusTone: cheque ? "blue" : toneForStatus(statusLabel),
      createdBy: actor,
      userRole: normalizedRoleLabel(userRoleMap.get(visit.staffId)),
      staffId: visit.staffId,
      visitStatus: humanStatus(visit.status),
      chequeStatus: cheque ? humanStatus(cheque.status) : "-",
      bankAccount: cheque?.depositedAccount ? `${cheque.depositedAccount.bankName} - ${cheque.depositedAccount.accountName} - ${cheque.depositedAccount.lastFourDigits}` : "-",
      depositStatus: cheque?.depositDateTime ? `Deposited ${formatShortDate(cheque.depositDateTime)}` : cheque ? "Pending deposit" : "-",
      createdAt: visit.createdAt,
      lastUpdatedAt: latestActivityAt,
      latestActivityAt,
      relativeActivityTime: relativeTime(latestActivityAt),
      isOverdue: Boolean(next.at && next.at < now),
      isPromise: false,
      notes: visitNotes,
      timeline: [{ at: latestActivityAt, type: visit.visitType, summary, by: actor, status: visit.outcome ?? visit.status, notes: visitNotes }],
    });
  });

  payments.forEach((payment) => {
    if (seenPaymentKeys.has(reportPaymentKey(payment.customerId, payment.amount, payment.paidAt))) return;
    const actor = payment.createdBy.name;
    const next = nextActionFor(payment.customer);
    pushActivity({
      id: `payment-${payment.id}`,
      customerId: payment.customerId,
      customerName: payment.customer.partyName,
      ledgerTag: payment.customer.batchTag ?? "",
      mobileNumber: payment.customer.contactNumber,
      currentBalance: payment.customer.outstandingBalance,
      summary: `Payment recovered ${formatMoney(payment.amount)}`,
      detailedNotes: cleanText(payment.notes),
      followUpType: "Payment Collected",
      recoveryAmount: payment.amount,
      paymentStatus: paymentStatusFor(payment.customer.outstandingBalance, payment.amount),
      promiseDate: null,
      nextAction: next.text,
      nextActionAt: next.at,
      reminderStatus: "No reminder",
      status: "Recovered",
      statusTone: "green",
      createdBy: actor,
      userRole: normalizedRoleLabel(userRoleMap.get(payment.createdById)),
      staffId: payment.createdById,
      visitStatus: "-",
      chequeStatus: "-",
      bankAccount: "-",
      depositStatus: "-",
      createdAt: payment.createdAt,
      lastUpdatedAt: payment.paidAt,
      latestActivityAt: payment.paidAt,
      relativeActivityTime: relativeTime(payment.paidAt),
      isOverdue: Boolean(next.at && next.at < now),
      isPromise: false,
      notes: cleanText(payment.notes),
      timeline: [{ at: payment.paidAt, type: "Payment", summary: `Recovered ${formatMoney(payment.amount)}`, by: actor, status: "Recovered", notes: cleanText(payment.notes) }],
    });
  });

  cheques.forEach((cheque) => {
    if (seenChequeIds.has(cheque.id)) return;
    const actor = cheque.collectedBy.name;
    const latestActivityAt = chequeActivityDate(cheque);
    const next = nextActionFor(cheque.customer);
    const statusLabel = cheque.status === "PENDING_DEPOSIT" ? "Pending Deposit" : humanStatus(cheque.status);
    const summary = chequeSummary(cheque);
    const bankAccount = cheque.depositedAccount
      ? `${cheque.depositedAccount.bankName} - ${cheque.depositedAccount.accountName} - ${cheque.depositedAccount.lastFourDigits}`
      : cheque.depositBankAccount || "-";
    const depositStatus =
      cheque.status === "BOUNCED"
        ? "Bounced"
        : cheque.status === "CLEARED"
          ? "Cleared"
          : cheque.depositDateTime
            ? `Deposited ${formatShortDate(cheque.depositDateTime)}`
            : "Pending deposit";
    const chequeNotes = [
      cleanText(cheque.collectionNotes),
      cheque.ocrConfidence ? `OCR ${Math.round(cheque.ocrConfidence * 100)}%` : "",
      cleanText(cheque.bounceReason),
    ].filter(Boolean).join(" | ");
    pushActivity({
      id: `cheque-${cheque.id}`,
      customerId: cheque.customerId,
      customerName: cheque.customer.partyName,
      ledgerTag: cheque.customer.batchTag ?? "",
      mobileNumber: cheque.customer.contactNumber,
      currentBalance: cheque.customer.outstandingBalance,
      summary,
      detailedNotes: chequeNotes,
      followUpType: "Payment Collection",
      recoveryAmount: cheque.status === "CLEARED" ? cheque.amount : 0,
      paymentStatus: cheque.status === "CLEARED" ? "Recovered" : "Pending",
      promiseDate: null,
      nextAction: next.text,
      nextActionAt: next.at,
      reminderStatus: "No reminder",
      status: statusLabel,
      statusTone: toneForStatus(statusLabel),
      createdBy: actor,
      userRole: normalizedRoleLabel(userRoleMap.get(cheque.collectedById)),
      staffId: cheque.collectedById,
      visitStatus: cheque.staffVisitId ? "Completed" : "-",
      chequeStatus: statusLabel,
      bankAccount,
      depositStatus,
      createdAt: cheque.createdAt,
      lastUpdatedAt: latestActivityAt,
      latestActivityAt,
      relativeActivityTime: relativeTime(latestActivityAt),
      isOverdue: Boolean(next.at && next.at < now),
      isPromise: false,
      notes: chequeNotes,
      timeline: [{ at: latestActivityAt, type: "Cheque", summary, by: actor, status: statusLabel, notes: chequeNotes }],
    });
  });

  const byCustomer = new Map<string, ReportRow>();
  activityRows
    .sort((a, b) => b.latestActivityAt.getTime() - a.latestActivityAt.getTime())
    .forEach((row) => {
      const existing = byCustomer.get(row.customerId);
      if (!existing) {
        byCustomer.set(row.customerId, row);
        return;
      }
      existing.timeline.push(...row.timeline);
      existing.timeline.sort((a, b) => b.at.getTime() - a.at.getTime());
    });

  const mergedRows = Array.from(byCustomer.values())
    .map((row) => ({ ...row, timeline: row.timeline.slice(0, 8) }))
    .sort((a, b) => b.latestActivityAt.getTime() - a.latestActivityAt.getTime());

  const total = mergedRows.length;
  const rows = format ? mergedRows.slice(0, 1000) : mergedRows.slice((page - 1) * limit, page * limit);

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
      recoveriesCompleted: mergedRows.filter((row) => row.staffId === group.createdById && row.status === "Recovered").length,
      recoveryAmount: payments
        .filter((payment) => payment.createdById === group.createdById)
        .reduce((sum, payment) => sum + payment.amount, 0),
      pendingCases: mergedRows.filter((row) => row.staffId === group.createdById && row.statusTone === "yellow").length,
      promisesCollected: mergedRows.filter((row) => row.staffId === group.createdById && row.isPromise).length,
      averageFollowUpTime: "Same day",
    }))
    .sort((a, b) => b.recoveryAmount - a.recoveryAmount || b.callsCompleted - a.callsCompleted);

  const trendMap = new Map<string, number>();
  for (const payment of trendRows) {
    const key = payment.paidAt.toISOString().slice(0, 10);
    trendMap.set(key, (trendMap.get(key) ?? 0) + payment.amount);
  }
  const collectionTrend = Array.from(trendMap.entries()).map(([date, amount]) => ({ date, amount }));
  const normalizedUsers = users.map((user) => ({
    ...user,
    role: String(normalizeFixedRole(user.role)),
  }));
  const summary = {
    dailyFollowUps: allToday,
    recoveryToday: paymentsToday._sum.amount ?? 0,
    pendingAmount: outstanding._sum.outstandingBalance ?? 0,
    pendingCases: outstanding._count.id,
    pendingCustomers: outstanding._count.id,
    promises: mergedRows.filter((row) => row.isPromise).length,
    notResponding: mergedRows.filter((row) => row.status === "Not Reachable").length,
    overdue: mergedRows.filter((row) => row.isOverdue).length,
    completed: mergedRows.filter((row) => row.statusTone === "green").length,
  };

  logger.info("follow_up_report_query_completed", {
    event: "follow_up_report_query_completed",
    sessionUserId: session.id,
    sessionRole: normalizedSessionRole,
    sessionShopId: session.shopId,
    requestedShopId,
    resolvedShopId: shopId,
    rawFollowUpCount,
    filteredFollowUpCount,
    activityResultCount: mergedRows.length,
    returnedRowCount: rows.length,
  });

  return NextResponse.json({
    success: true,
    rows,
    users: normalizedUsers,
    summary,
    staffPerformance,
    collectionTrend,
    trend: collectionTrend,
    filters: {
      staff: normalizedUsers,
      batchTags: batchTagRows.map((item) => item.batchTag).filter((value): value is string => Boolean(value)),
    },
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    ...(debugMode
      ? {
          debug: {
            sessionShopId: session.shopId,
            requestedShopId,
            resolvedShopId: shopId,
            rawFollowUpCount,
            filteredFollowUpCount,
            generatedWhereClause: followUpWhere,
            sampleRecordIds: followUps.slice(0, 10).map((record) => record.id),
            errorCode: null,
          },
        }
      : {}),
  });
  } catch (error) {
    const prismaCode = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
    logger.error("follow_up_report_query_failed", {
      event: "follow_up_report_query_failed",
      sessionUserId: session.id,
      sessionRole: normalizedSessionRole,
      sessionShopId: session.shopId,
      requestedShopId,
      resolvedShopId,
      incomingFilters: Object.fromEntries(searchParams.entries()),
      prismaCode,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({
      success: false,
      code: "REPORT_QUERY_FAILED",
      error: "Follow-up report data could not be loaded. Please retry.",
      ...(normalizedSessionRole === "SHOP_ADMIN" || normalizedSessionRole === "SUPER_ADMIN"
        ? {
            debug: {
              sessionShopId: session.shopId,
              requestedShopId,
              resolvedShopId,
              rawFollowUpCount: null,
              filteredFollowUpCount: null,
              generatedWhereClause: null,
              sampleRecordIds: [],
              errorCode: prismaCode ?? "REPORT_QUERY_FAILED",
            },
          }
        : {}),
    }, { status: 500 });
  }
}
