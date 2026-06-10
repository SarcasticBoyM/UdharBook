import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { z } from "zod";
import type { ChequeStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { resolveOperationalShopId, requireShopId } from "@/lib/tenant";
import { reportToCsv } from "@/lib/excel/export";
import { logActivity } from "@/lib/activity";
import { recordFollowUpActivity } from "@/lib/follow-up-service";
import { canViewReports } from "@/lib/permissions";
import { isSalesRole } from "@/lib/operational-roles";

const HIGH_VALUE = Number(process.env.HIGH_CHEQUE_AMOUNT ?? 50000);
const INDIA_TIMEZONE_OFFSET_MINUTES = 330;
const VALID_CHEQUE_STATUSES: ChequeStatus[] = ["COLLECTED", "PENDING_DEPOSIT", "DEPOSITED", "CLEARED", "BOUNCED", "REPLACED", "RETURNED_TO_PARTY", "CANCELLED"];
const PENDING_DEPOSIT_STATUSES: ChequeStatus[] = ["COLLECTED", "PENDING_DEPOSIT"];

const createSchema = z.object({
  customerId: z.string(),
  chequeNumber: z.string().min(1),
  bankName: z.string().min(1),
  branch: z.string().optional(),
  chequeDate: z.string().datetime(),
  amount: z.number().positive(),
  accountHolderName: z.string().min(1),
  collectionDateTime: z.string().datetime(),
  collectionNotes: z.string().optional(),
  staffVisitId: z.string().optional(),
  depositedAccountId: z.string().optional(),
  collectionLatitude: z.number().min(-90).max(90).optional(),
  collectionLongitude: z.number().min(-180).max(180).optional(),
  collectionAccuracy: z.number().optional(),
  frontImageUrl: z.string().optional(),
  micrCode: z.string().optional(),
  ifscCode: z.string().optional(),
  ocrRawText: z.string().optional(),
  ocrExtractedData: z.record(z.unknown()).optional(),
  ocrConfidence: z.number().min(0).max(1).optional(),
  ocrEditedFields: z.record(z.boolean()).optional(),
});

function businessDayRange(date = new Date(), offsetMinutes = INDIA_TIMEZONE_OFFSET_MINUTES) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  const startUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const start = new Date(startUtc - offsetMinutes * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

function startOfToday() {
  return businessDayRange().start;
}

function endOfToday() {
  return businessDayRange().end;
}

function asDate(value: string | null, end = false) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const localMidnightUtc = Date.UTC(year, month - 1, day) - INDIA_TIMEZONE_OFFSET_MINUTES * 60_000;
    const start = new Date(localMidnightUtc);
    return end ? new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1) : start;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return end ? businessDayRange(parsed).end : businessDayRange(parsed).start;
}

function asNumber(value: string | null) {
  if (!value) return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : undefined;
}

function safeText(value: unknown, fallback = "-") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function safeIso(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function safeDateOnly(value: unknown) {
  const iso = safeIso(value);
  return iso ? iso.slice(0, 10) : "";
}

function dateFieldForStatus(status?: ChequeStatus | null) {
  if (status === "CLEARED") return "clearedAt";
  if (status === "DEPOSITED") return "depositDateTime";
  if (status === "BOUNCED") return "bouncedAt";
  if (status === "RETURNED_TO_PARTY" || status === "CANCELLED") return "cancelledAt";
  return "collectionDateTime";
}

function dateFieldForQuick(quick: string, status?: ChequeStatus | null) {
  if (status) return dateFieldForStatus(status);
  if (quick === "due_today") return "chequeDate";
  if (quick === "deposited") return "depositDateTime";
  if (quick === "bounced") return "bouncedAt";
  if (quick === "returned") return "cancelledAt";
  return "collectionDateTime";
}

function dateRangeCondition(
  field: "collectionDateTime" | "depositDateTime" | "clearedAt" | "bouncedAt" | "cancelledAt" | "chequeDate",
  from?: Date,
  to?: Date,
): Prisma.ChequeWhereInput {
  return { [field]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } };
}

async function safeChequeCount(label: string, where: Prisma.ChequeWhereInput) {
  try {
    return await prisma.cheque.count({ where });
  } catch (error) {
    console.error("cheque_report_count_failed", {
      label,
      message: error instanceof Error ? error.message : "Unknown count failure",
      where,
    });
    return 0;
  }
}

async function safeChequeAmount(label: string, where: Prisma.ChequeWhereInput) {
  try {
    const result = await prisma.cheque.aggregate({ where, _sum: { amount: true } });
    return result._sum.amount ?? 0;
  } catch (error) {
    console.error("cheque_report_amount_failed", {
      label,
      message: error instanceof Error ? error.message : "Unknown amount aggregation failure",
      where,
    });
    return 0;
  }
}

function chequeInclude() {
  return {
    customer: { select: { id: true, partyName: true, contactNumber: true, batchTag: true, outstandingBalance: true } },
    collectedBy: { select: { id: true, name: true, role: true } },
    depositedBy: { select: { id: true, name: true, role: true } },
    depositReceiptUploadedBy: { select: { id: true, name: true, role: true } },
    depositedAccount: { select: { id: true, accountName: true, bankName: true, lastFourDigits: true, isActive: true } },
    staffVisit: {
      select: {
        id: true,
        checkInAt: true,
        checkOutAt: true,
        checkInLat: true,
        checkInLng: true,
        notes: true,
        result: true,
        visitType: true,
        verified: true,
        staff: { select: { name: true, role: true } },
      },
    },
    activities: {
      orderBy: { createdAt: "desc" as const },
      include: { user: { select: { name: true, role: true } } },
      take: 20,
    },
  };
}

function chequeRow(cheque: Prisma.ChequeGetPayload<{ include: ReturnType<typeof chequeInclude> }>) {
  const depositAccount = cheque.depositedAccount
    ? `${cheque.depositedAccount.bankName} - ${cheque.depositedAccount.accountName} - ${cheque.depositedAccount.lastFourDigits}`
    : cheque.depositBankAccount ?? "";
  return {
    id: cheque.id,
    customerName: safeText(cheque.customer?.partyName),
    batchTag: cheque.customer?.batchTag ?? "",
    mobileNumber: safeText(cheque.customer?.contactNumber),
    chequeNumber: safeText(cheque.chequeNumber),
    bankName: safeText(cheque.bankName),
    branch: cheque.branch ?? "",
    chequeDate: cheque.chequeDate,
    amount: cheque.amount,
    accountHolderName: safeText(cheque.accountHolderName),
    status: cheque.status,
    collectionDateTime: cheque.collectionDateTime,
    collectionLatitude: cheque.collectionLatitude,
    collectionLongitude: cheque.collectionLongitude,
    collectionAccuracy: cheque.collectionAccuracy,
    collectionNotes: cheque.collectionNotes ?? "",
    staffVisitId: cheque.staffVisitId ?? "",
    visitNotes: cheque.staffVisit?.notes ?? "",
    visitResult: cheque.staffVisit?.result ?? "",
    visitType: cheque.staffVisit?.visitType ?? "",
    visitGps: cheque.staffVisit ? `${cheque.staffVisit.checkInLat},${cheque.staffVisit.checkInLng}` : "",
    collectedBy: safeText(cheque.collectedBy?.name),
    depositedBy: cheque.depositedBy?.name ?? "",
    depositedAccount: depositAccount,
    depositDateTime: cheque.depositDateTime,
    depositBankAccount: cheque.depositBankAccount ?? "",
    depositReceiptUrl: cheque.depositReceiptUrl ?? "",
    depositReceiptType: cheque.depositReceiptType ?? "",
    depositReceiptUploadedAt: cheque.depositReceiptUploadedAt,
    depositReceiptUploadedBy: cheque.depositReceiptUploadedBy?.name ?? "",
    micrCode: cheque.micrCode ?? "",
    ifscCode: cheque.ifscCode ?? "",
    ocrConfidence: cheque.ocrConfidence ?? 0,
    frontImageUrl: cheque.frontImageUrl ?? "",
    bounceReason: cheque.bounceReason ?? "",
    clearedAt: cheque.clearedAt,
    bouncedAt: cheque.bouncedAt,
    createdAt: cheque.createdAt,
    notes: cheque.collectionNotes || cheque.bounceReason || "",
    activitySummary: (cheque.activities ?? [])
      .map((activity) => `${activity.type}${activity.toStatus ? ` ${activity.toStatus}` : ""} by ${safeText(activity.user?.name)}`)
      .join(" | "),
  };
}

async function chequesToExcel(rows: ReturnType<typeof chequeRow>[], sheetName = "Cheque Collections") {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = [
    { header: "Party Name", key: "customerName", width: 28 },
    { header: "Batch/Firm", key: "batchTag", width: 18 },
    { header: "Mobile Number", key: "mobileNumber", width: 16 },
    { header: "Amount", key: "amount", width: 16 },
    { header: "Cheque Number", key: "chequeNumber", width: 18 },
    { header: "Bank Name", key: "bankName", width: 22 },
    { header: "Cheque Date", key: "chequeDate", width: 18 },
    { header: "Collected Date", key: "collectionDateTime", width: 24 },
    { header: "Deposit Date", key: "depositDateTime", width: 24 },
    { header: "Clearance Date", key: "clearedAt", width: 24 },
    { header: "Bounce Date", key: "bouncedAt", width: 24 },
    { header: "Current Status", key: "status", width: 18 },
    { header: "Collected By", key: "collectedBy", width: 18 },
    { header: "Deposit Account", key: "depositedAccount", width: 32 },
    { header: "Notes", key: "notes", width: 42 },
    { header: "Created At", key: "createdAt", width: 24 },
    { header: "Cheque Image", key: "frontImageUrl", width: 28 },
    { header: "Deposit Receipt", key: "depositReceiptUrl", width: 28 },
    { header: "Activity Timeline", key: "activitySummary", width: 50 },
  ];
  sheet.getRow(1).font = { bold: true };
  rows.forEach((row) =>
    sheet.addRow({
      ...row,
      chequeDate: safeIso(row.chequeDate),
      collectionDateTime: safeIso(row.collectionDateTime),
      depositDateTime: safeIso(row.depositDateTime),
      clearedAt: safeIso(row.clearedAt),
      bouncedAt: safeIso(row.bouncedAt),
      createdAt: safeIso(row.createdAt),
    })
  );
  return workbook.xlsx.writeBuffer();
}

function chequesToCsv(rows: ReturnType<typeof chequeRow>[]) {
  return reportToCsv(
    [
      "Party Name",
      "Batch/Firm",
      "Mobile Number",
      "Amount",
      "Cheque Number",
      "Bank Name",
      "Cheque Date",
      "Collected Date",
      "Deposit Date",
      "Clearance Date",
      "Bounce Date",
      "Current Status",
      "Collected By",
      "Deposit Account",
      "Notes",
      "Created At",
      "Cheque Image",
      "Deposit Receipt",
      "Activity Timeline",
    ],
    rows.map((row) => [
      row.customerName,
      row.batchTag,
      row.mobileNumber,
      String(row.amount),
      row.chequeNumber,
      row.bankName,
      safeIso(row.chequeDate),
      safeIso(row.collectionDateTime),
      safeIso(row.depositDateTime),
      safeIso(row.clearedAt),
      safeIso(row.bouncedAt),
      row.status,
      row.collectedBy,
      row.depositedAccount,
      row.notes,
      safeIso(row.createdAt),
      row.frontImageUrl,
      row.depositReceiptUrl,
      row.activitySummary,
    ])
  );
}

function printableHtml(rows: ReturnType<typeof chequeRow>[], input: { shopName: string; filters: string[]; summary: Record<string, string | number>; title?: string }) {
  const escape = (value: unknown) =>
    safeText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const generatedAt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const reportTitle = input.title ?? "Cheques Report";
  const statusClass = (status: string) => status === "CLEARED" ? "green" : status === "BOUNCED" || status === "CANCELLED" || status === "REPLACED" || status === "RETURNED_TO_PARTY" ? "red" : status === "DEPOSITED" ? "blue" : "yellow";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(reportTitle)}</title><style>
    body{font-family:Arial,sans-serif;color:#0f172a;margin:0;padding:20px;background:#fff}
    header{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #e2e8f0;padding-bottom:12px;margin-bottom:14px}
    h1{margin:0;font-size:22px} .muted{color:#64748b;font-size:12px}
    .summary{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:12px 0}
    .card{border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#f8fafc}.card b{display:block;font-size:15px;margin-top:4px}
    .filters{font-size:11px;color:#475569;margin:8px 0 12px}
    table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #d1d5db;padding:5px;text-align:left;vertical-align:top}th{background:#f1f5f9}
    .badge{border-radius:999px;padding:2px 6px;font-weight:700;white-space:nowrap}.green{background:#dcfce7;color:#166534}.red{background:#fee2e2;color:#991b1b}.blue{background:#dbeafe;color:#1e40af}.yellow{background:#fef3c7;color:#92400e}
    footer{margin-top:14px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:10px;color:#64748b;text-align:center}
    tr{break-inside:avoid}
    @media print{@page{size:landscape;margin:10mm}body{padding:0}.no-print{display:none}}
    @media(max-width:760px){.summary{grid-template-columns:1fr 1fr}table{font-size:9px}}
  </style></head><body><header><div><h1>${escape(reportTitle)}</h1><div class="muted">${escape(input.shopName)} | Generated ${escape(generatedAt)}</div></div><button class="no-print" onclick="window.print()">Print / Save PDF</button></header>
  <section class="summary">${Object.entries(input.summary).map(([key, value]) => `<div class="card"><span class="muted">${escape(key)}</span><b>${escape(String(value))}</b></div>`).join("")}</section>
  <div class="filters"><b>Filters:</b> ${input.filters.length ? input.filters.map(escape).join(" | ") : "All cheques"}</div>
  <table><thead><tr>${[
    "Party Name",
    "Batch/Firm",
    "Mobile",
    "Amount",
    "Cheque No",
    "Bank",
    "Cheque Date",
    "Collected Date",
    "Deposit Date",
    "Clearance Date",
    "Bounce Date",
    "Status",
    "Collected By",
    "Deposit Account",
    "Notes",
    "Created At",
  ].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr><td>${escape(r.customerName)}</td><td>${escape(r.batchTag)}</td><td>${escape(r.mobileNumber)}</td><td>${safeText(r.amount)}</td><td>${escape(r.chequeNumber)}</td><td>${escape(r.bankName)}</td><td>${safeDateOnly(r.chequeDate)}</td><td>${safeDateOnly(r.collectionDateTime)}</td><td>${safeDateOnly(r.depositDateTime)}</td><td>${safeDateOnly(r.clearedAt)}</td><td>${safeDateOnly(r.bouncedAt)}</td><td><span class="badge ${statusClass(r.status)}">${r.status === "RETURNED_TO_PARTY" ? "RETURNED" : safeText(r.status)}</span></td><td>${escape(r.collectedBy)}</td><td>${escape(r.depositedAccount)}</td><td>${escape(r.notes)}</td><td>${safeDateOnly(r.createdAt)}</td></tr>`).join("")}</tbody></table><footer>Page numbers are available from the browser print dialog. UdharBook ${escape(reportTitle)}.</footer><script>window.print()</script></body></html>`;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const shopId = await resolveOperationalShopId(request, session);
  const { searchParams } = new URL(request.url);
  const rawStatus = searchParams.get("status")?.trim();
  const status = rawStatus && VALID_CHEQUE_STATUSES.includes(rawStatus as ChequeStatus) ? rawStatus as ChequeStatus : null;
  const q = searchParams.get("q")?.trim();
  const partyName = searchParams.get("partyName")?.trim();
  const chequeNumber = searchParams.get("chequeNumber")?.trim();
  const bankName = searchParams.get("bankName")?.trim();
  const batchTag = searchParams.get("batchTag")?.trim();
  const staffId = searchParams.get("staffId") || undefined;
  const depositedAccountId = searchParams.get("depositedAccountId") || undefined;
  const minAmount = asNumber(searchParams.get("minAmount"));
  const maxAmount = asNumber(searchParams.get("maxAmount"));
  const from = asDate(searchParams.get("from"));
  const to = asDate(searchParams.get("to"), true);
  const quick = searchParams.get("quick") || "all";
  const format = searchParams.get("format");
  const report = searchParams.get("report");
  const isTrackerReport = report === "tracker";
  const reportTitle = isTrackerReport ? "Cheque Tracker Report" : "Cheques Report";
  const exportFileName = isTrackerReport ? "cheque-tracker-report" : "cheque-collections";
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 30)));
  const skip = (page - 1) * limit;
  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - 1);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const tomorrowEnd = new Date(todayEnd);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

  const conditions: Prisma.ChequeWhereInput[] = [{ shopId }];
  if (!canViewReports(session.role) && format) {
    return NextResponse.json({ error: "This role cannot export cheque reports" }, { status: 403 });
  }
  if (rawStatus && !status) {
    console.warn("cheque_report_invalid_status_filter", { rawStatus, shopId, report: report || null });
  }

  if (q) {
    const phoneQuery = q.replace(/\D/g, "");
    conditions.push({
      OR: [
        { chequeNumber: { contains: q, mode: "insensitive" } },
        { bankName: { contains: q, mode: "insensitive" } },
        { branch: { contains: q, mode: "insensitive" } },
        { customer: { partyName: { contains: q, mode: "insensitive" } } },
        { customer: { batchTag: { contains: q, mode: "insensitive" } } },
        ...(phoneQuery ? [{ customer: { contactNumber: { contains: phoneQuery } } }] : []),
        ...(Number.isFinite(Number(q)) ? [{ amount: Number(q) }] : []),
      ],
    });
  }
  if (partyName) conditions.push({ customer: { partyName: { contains: partyName, mode: "insensitive" } } });
  if (batchTag) conditions.push({ customer: { batchTag: { equals: batchTag, mode: "insensitive" } } });
  if (bankName) conditions.push({ bankName: { contains: bankName, mode: "insensitive" } });

  const quickStatus: ChequeStatus | undefined =
    quick === "bounced" ? "BOUNCED" : quick === "deposited" ? "DEPOSITED" : quick === "returned" ? "RETURNED_TO_PARTY" : undefined;
  const dateField = dateFieldForQuick(quick, status || quickStatus);
  if (from || to) {
    conditions.push(dateRangeCondition(dateField, from, to));
  }

  if (status === "PENDING_DEPOSIT") conditions.push({ status: { in: PENDING_DEPOSIT_STATUSES } });
  else if (status) conditions.push({ status });
  else if (quick === "pending") conditions.push({ status: { in: PENDING_DEPOSIT_STATUSES } });
  else if (quick === "due_today") {
    conditions.push({ status: { in: PENDING_DEPOSIT_STATUSES } });
    conditions.push({ chequeDate: { gte: todayStart, lte: todayEnd } });
  } else if (quickStatus) {
    conditions.push({ status: quickStatus });
  }
  if (chequeNumber) conditions.push({ chequeNumber: { contains: chequeNumber, mode: "insensitive" } });
  if (depositedAccountId) conditions.push({ depositedAccountId });
  if (staffId) conditions.push({ collectedById: staffId });
  if (minAmount !== undefined) conditions.push({ amount: { gte: minAmount } });
  if (maxAmount !== undefined) conditions.push({ amount: { lte: maxAmount } });

  const where: Prisma.ChequeWhereInput = { AND: conditions };

  const include = chequeInclude();
  const [items, total, users, shop] =
    await prisma.$transaction([
      prisma.cheque.findMany({
        where,
        include,
        orderBy: [
          { status: "desc" },
          { depositDateTime: { sort: "asc", nulls: "first" } },
          { amount: "desc" },
          { chequeDate: "asc" },
        ],
        skip: format ? 0 : skip,
        take: format ? 1000 : limit,
      }),
      prisma.cheque.count({ where }),
      prisma.user.findMany({ where: { shopId, role: { in: ["SHOP_ADMIN", "ACCOUNT_STAFF", "SALES_PERSON", "SALES_PERSON_CUM_ACCOUNTS"] } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
      prisma.shop.findUnique({ where: { id: shopId }, select: { shopName: true } }),
    ]).catch((error: unknown) => {
      console.error("cheque_report_prisma_query_failed", {
        message: error instanceof Error ? error.message : "Unknown Prisma query failure",
        shopId,
        report: report || null,
        format: format || null,
        quick,
        status: status || null,
        hasSearch: Boolean(q),
        hasDateRange: Boolean(from || to),
      });
      throw error;
    });

  const [
    collectedToday,
    depositedToday,
    clearedToday,
    pendingDeposit,
    bounced,
    highValue,
    totalCollected,
    stale,
    chequeDateTomorrow,
    underClearingAmount,
    clearedAmount,
    bouncedAmount,
    pendingDepositAmount,
    depositedTodayAmount,
    clearedTodayAmount,
    filteredTotalAmount,
    filteredDepositedAmount,
    filteredPendingAmount,
    filteredClearedAmount,
    filteredBouncedAmount,
  ] = await Promise.all([
    safeChequeCount("collectedToday", { shopId, collectionDateTime: { gte: todayStart, lte: todayEnd } }),
    safeChequeCount("depositedToday", { shopId, depositDateTime: { gte: todayStart, lte: todayEnd } }),
    safeChequeCount("clearedToday", { shopId, clearedAt: { gte: todayStart, lte: todayEnd } }),
    safeChequeCount("pendingDeposit", { shopId, status: { in: ["COLLECTED", "PENDING_DEPOSIT"] } }),
    safeChequeCount("bounced", { shopId, status: "BOUNCED" }),
    safeChequeCount("highValue", { shopId, amount: { gte: HIGH_VALUE } }),
    safeChequeCount("totalCollected", { shopId }),
    safeChequeCount("stale", { shopId, status: { in: ["COLLECTED", "PENDING_DEPOSIT"] }, collectionDateTime: { lt: staleDate } }),
    safeChequeCount("chequeDateTomorrow", { shopId, chequeDate: { gte: tomorrowStart, lte: tomorrowEnd }, status: { in: ["COLLECTED", "PENDING_DEPOSIT"] } }),
    safeChequeAmount("underClearingAmount", { shopId, status: "DEPOSITED" }),
    safeChequeAmount("clearedAmount", { shopId, status: "CLEARED" }),
    safeChequeAmount("bouncedAmount", { shopId, status: "BOUNCED" }),
    safeChequeAmount("pendingDepositAmount", { shopId, status: { in: ["COLLECTED", "PENDING_DEPOSIT"] } }),
    safeChequeAmount("depositedTodayAmount", { shopId, depositDateTime: { gte: todayStart, lte: todayEnd } }),
    safeChequeAmount("clearedTodayAmount", { shopId, clearedAt: { gte: todayStart, lte: todayEnd } }),
    safeChequeAmount("filteredTotalAmount", where),
    safeChequeAmount("filteredDepositedAmount", { AND: [where, { status: "DEPOSITED" }] }),
    safeChequeAmount("filteredPendingAmount", { AND: [where, { status: { in: PENDING_DEPOSIT_STATUSES } }] }),
    safeChequeAmount("filteredClearedAmount", { AND: [where, { status: "CLEARED" }] }),
    safeChequeAmount("filteredBouncedAmount", { AND: [where, { status: "BOUNCED" }] }),
  ]);

  const rows = items.map(chequeRow);
  if (!format) {
    console.info("cheque_filter_query", {
      report: report || null,
      incomingFilters: {
        status: rawStatus || null,
        q: q || null,
        partyName: partyName || null,
        chequeNumber: chequeNumber || null,
        bankName: bankName || null,
        batchTag: batchTag || null,
        staffId: staffId || null,
        depositedAccountId: depositedAccountId || null,
        from: searchParams.get("from") || null,
        to: searchParams.get("to") || null,
        minAmount: searchParams.get("minAmount") || null,
        maxAmount: searchParams.get("maxAmount") || null,
      },
      where,
      quick,
      advanced: {
        status,
        customer: partyName || null,
        chequeNumber: chequeNumber || null,
        bankName: bankName || null,
        batchTag: batchTag || null,
        staffId: staffId || null,
        depositedAccountId: depositedAccountId || null,
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
        minAmount: minAmount ?? null,
        maxAmount: maxAmount ?? null,
      },
      timezone: {
        offsetMinutes: INDIA_TIMEZONE_OFFSET_MINUTES,
        todayStart: todayStart.toISOString(),
        todayEnd: todayEnd.toISOString(),
      },
      resultCount: total,
      renderedCount: items.length,
      page,
      limit,
    });
    if (total === 0) {
      console.info("cheque_report_empty_state", {
        reason: "No cheques matched current query",
        quick,
        report: report || null,
        activeFilters: {
          status: status || null,
          q: q || null,
          partyName: partyName || null,
          chequeNumber: chequeNumber || null,
          bankName: bankName || null,
          batchTag: batchTag || null,
          staffId: staffId || null,
          depositedAccountId: depositedAccountId || null,
          hasFrom: Boolean(from),
          hasTo: Boolean(to),
          hasMinAmount: minAmount !== undefined,
          hasMaxAmount: maxAmount !== undefined,
        },
      });
    }
  }
  if (quick === "due_today") {
    const chequeDateMatches = await prisma.cheque.findMany({
      where: { shopId, chequeDate: { gte: todayStart, lte: todayEnd } },
      select: { id: true, chequeDate: true, status: true },
      take: 5,
    });
    console.info("cheque_due_today_filter", {
      quick,
      todayStart: todayStart.toISOString(),
      todayEnd: todayEnd.toISOString(),
      resultCount: total,
      sampleChequeDateMatches: chequeDateMatches.map((item) => ({
        id: item.id,
        chequeDate: item.chequeDate.toISOString(),
        status: item.status,
      })),
      sampleChequeDates: items.slice(0, 5).map((item) => ({
        id: item.id,
        chequeDate: item.chequeDate.toISOString(),
        status: item.status,
      })),
    });
  }
  if (format === "xlsx") {
    const buffer = await chequesToExcel(rows, reportTitle);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${exportFileName}.xlsx"`,
      },
    });
  }
  if (format === "csv") {
    return new NextResponse(chequesToCsv(rows), {
      headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${exportFileName}.csv"` },
    });
  }
  if (format === "pdf") {
    const filters = [
      quick && quick !== "all" ? `Quick filter: ${quick.replace(/_/g, " ")}` : "",
      status ? `Status: ${status === "RETURNED_TO_PARTY" ? "RETURNED" : status}` : "",
      q ? `Search: ${q}` : "",
      partyName ? `Party: ${partyName}` : "",
      chequeNumber ? `Cheque number: ${chequeNumber}` : "",
      bankName ? `Bank: ${bankName}` : "",
      staffId ? "Collected by selected staff" : "",
      depositedAccountId ? "Deposit account selected" : "",
      from ? `From: ${from.toISOString().slice(0, 10)}` : "",
      to ? `To: ${to.toISOString().slice(0, 10)}` : "",
      minAmount !== undefined ? `Min amount: ${minAmount}` : "",
      maxAmount !== undefined ? `Max amount: ${maxAmount}` : "",
    ].filter(Boolean);
    try {
      const html = printableHtml(rows, {
          shopName: shop?.shopName ?? "UdharBook",
          title: reportTitle,
          filters,
          summary: {
          "Total Cheques": total,
          "Total Amount": filteredTotalAmount,
          "Pending Clearance": filteredPendingAmount,
          "Cleared Amount": clearedAmount,
          "Bounced Amount": bouncedAmount,
          },
        });
      console.info("cheque_pdf_report_generated", {
        report: report || null,
        rowCount: rows.length,
        fileName: `${exportFileName}-print.html`,
      });
      return new NextResponse(html, {
        headers: { "Content-Type": "text/html", "Content-Disposition": `inline; filename="${exportFileName}-print.html"` },
      });
    } catch (error: unknown) {
      console.error("cheque_pdf_report_failed", {
        message: error instanceof Error ? error.message : "Unknown PDF report failure",
        report: report || null,
        rowCount: rows.length,
        sampleRowIds: rows.slice(0, 5).map((row) => row.id),
      });
      const fallbackHtml = printableHtml([], {
        shopName: shop?.shopName ?? "UdharBook",
        title: reportTitle,
        filters: [...filters, "Export warning: one or more rows could not be rendered"],
        summary: {
          "Total Cheques": total,
          "Rows Rendered": 0,
        },
      });
      return new NextResponse(fallbackHtml, {
        headers: { "Content-Type": "text/html", "Content-Disposition": `inline; filename="${exportFileName}-print.html"` },
      });
    }
  }

  return NextResponse.json({
    items,
    users,
    alerts: {
      pendingDeposit,
      bounced,
      highValue,
      stale,
      chequeDateTomorrow,
    },
    summary: {
      collectedToday,
      pendingDeposit,
      depositedToday,
      clearedToday,
      bounced,
      highValue,
      totalCollected,
      underClearingAmount,
      clearedAmount,
      bouncedAmount,
      pendingDepositAmount,
      depositedTodayAmount,
      clearedTodayAmount,
      filteredChequeCount: total,
      filteredTotalAmount,
      filteredDepositedAmount,
      filteredPendingAmount,
      filteredClearedAmount,
      filteredBouncedAmount,
    },
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const shopId = requireShopId(request, session);
    const body = createSchema.parse(await request.json());
    const customer = await prisma.customer.findFirst({ where: { id: body.customerId, shopId } });
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    const linkedVisit = body.staffVisitId
      ? await prisma.staffVisit.findFirst({
          where: { id: body.staffVisitId, shopId, customerId: body.customerId },
          select: { id: true, staffId: true, status: true, notes: true, result: true },
        })
      : null;
    if (body.staffVisitId && !linkedVisit) {
      return NextResponse.json({ error: "Linked visit not found for this customer" }, { status: 404 });
    }
    if (linkedVisit && !["CHECKED_IN", "COMPLETED"].includes(linkedVisit.status)) {
      return NextResponse.json({ error: "Linked visit cannot accept cheque collection" }, { status: 403 });
    }
    if (linkedVisit && isSalesRole(session.role) && linkedVisit.staffId !== session.id) {
      return NextResponse.json({ error: "Linked visit cannot be modified by this user" }, { status: 403 });
    }
    const depositAccount = body.depositedAccountId
      ? await prisma.chequeDepositAccount.findFirst({
          where: { id: body.depositedAccountId, shopId, isActive: true },
          select: { id: true, bankName: true, accountName: true, lastFourDigits: true },
        })
      : null;
    if (body.depositedAccountId && !depositAccount) {
      return NextResponse.json({ error: "Deposit bank not found" }, { status: 404 });
    }

    const cheque = await prisma.$transaction(async (tx) => {
      const created = await tx.cheque.create({
        data: {
          shopId,
          customerId: body.customerId,
          chequeNumber: body.chequeNumber,
          bankName: body.bankName,
          branch: body.branch,
          chequeDate: new Date(body.chequeDate),
          amount: body.amount,
          accountHolderName: body.accountHolderName,
          collectedById: session.id,
          staffVisitId: body.staffVisitId,
          depositedAccountId: depositAccount?.id,
          depositBankAccount: depositAccount ? `${depositAccount.bankName} - ${depositAccount.accountName} - ${depositAccount.lastFourDigits}` : undefined,
          collectionLatitude: body.collectionLatitude,
          collectionLongitude: body.collectionLongitude,
          collectionAccuracy: body.collectionAccuracy,
          collectionDateTime: new Date(body.collectionDateTime),
          collectionNotes: body.collectionNotes,
          frontImageUrl: body.frontImageUrl,
          micrCode: body.micrCode,
          ifscCode: body.ifscCode,
          ocrRawText: body.ocrRawText,
          ocrExtractedData: body.ocrExtractedData as Prisma.InputJsonValue | undefined,
          ocrConfidence: body.ocrConfidence,
          ocrEditedFields: body.ocrEditedFields as Prisma.InputJsonValue | undefined,
          status: "COLLECTED",
        },
        include: chequeInclude(),
      });
      await tx.chequeActivity.create({
        data: {
          shopId,
          chequeId: created.id,
          userId: session.id,
          type: "CREATED",
          toStatus: "COLLECTED",
          notes: body.collectionNotes ?? "Cheque collected",
        },
      });
      await recordFollowUpActivity(tx, {
        shopId,
        customerId: body.customerId,
        createdById: session.id,
        status: "CONTACTED",
        priority: body.amount >= HIGH_VALUE ? "HIGH" : "MEDIUM",
        notes: body.collectionNotes ?? `Cheque collected: ${body.chequeNumber}`,
        recoveryAmount: body.amount,
        paymentStatus: "CHEQUE_COLLECTED",
        chequeId: created.id,
        chequeStatus: "COLLECTED",
        sourceModule: "CHEQUE_COLLECTION",
        followUpType: "CHEQUE_PICKUP",
        summary: `Cheque collected Rs ${body.amount}`,
        detailedNotes: body.collectionNotes,
        visitId: body.staffVisitId,
        activitySource: "cheque-collection",
        metadata: {
          chequeNumber: body.chequeNumber,
          bankName: body.bankName,
          chequeDate: body.chequeDate,
          ocrConfidence: body.ocrConfidence ?? null,
        },
        recordPayment: false,
      });
      const nextBalance = Math.max(0, customer.outstandingBalance - body.amount);
      const nextStatus = nextBalance <= 0 ? "CLEARED" : customer.status === "CLEARED" ? "PENDING" : customer.status;
      await tx.customer.update({
        where: { id: body.customerId },
        data: {
          outstandingBalance: nextBalance,
          status: nextStatus,
        },
      });
      await tx.paymentEntry.create({
        data: {
          shopId,
          customerId: body.customerId,
          amount: body.amount,
          method: "CHEQUE",
          notes: `Cheque collected: ${body.chequeNumber}`,
          paidAt: new Date(body.collectionDateTime),
          createdById: session.id,
        },
      });
      await tx.statusHistory.create({
        data: {
          customerId: body.customerId,
          fromStatus: customer.status,
          toStatus: nextStatus,
          notes: `Cheque collected: ${body.chequeNumber}. Balance reduced by ${body.amount}`,
          changedById: session.id,
        },
      });
      if (linkedVisit) {
        await tx.staffVisit.update({
          where: { id: linkedVisit.id },
          data: {
            paymentMode: "Cheque Collected",
            notes: [
              linkedVisit.notes,
              `Cheque collected: ${body.chequeNumber} | ${body.bankName} | ${body.amount}`,
            ].filter(Boolean).join("\n"),
          },
        });
      }
      return created;
    });

    await logActivity({
      action: "cheque_collected",
      userId: session.id,
      shopId,
      customerId: body.customerId,
      details: `${body.chequeNumber} ${body.bankName} ${body.amount}`,
    });

    return NextResponse.json(cheque, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid cheque details" }, { status: 400 });
    }
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Cheque number already exists for this bank" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not create cheque" }, { status: 500 });
  }
}
