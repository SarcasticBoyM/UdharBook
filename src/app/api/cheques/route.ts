import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { z } from "zod";
import type { ChequeStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { reportToCsv } from "@/lib/excel/export";
import { logActivity } from "@/lib/activity";

const HIGH_VALUE = Number(process.env.HIGH_CHEQUE_AMOUNT ?? 50000);

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
  frontImageUrl: z.string().optional(),
  micrCode: z.string().optional(),
  ifscCode: z.string().optional(),
  ocrRawText: z.string().optional(),
  ocrExtractedData: z.record(z.unknown()).optional(),
  ocrConfidence: z.number().min(0).max(1).optional(),
  ocrEditedFields: z.record(z.boolean()).optional(),
});

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

function chequeInclude() {
  return {
    customer: { select: { id: true, partyName: true, contactNumber: true, outstandingBalance: true } },
    collectedBy: { select: { id: true, name: true, role: true } },
    depositedBy: { select: { id: true, name: true, role: true } },
    depositReceiptUploadedBy: { select: { id: true, name: true, role: true } },
    depositedAccount: { select: { id: true, accountName: true, bankName: true, lastFourDigits: true, isActive: true } },
    activities: {
      orderBy: { createdAt: "desc" as const },
      include: { user: { select: { name: true, role: true } } },
      take: 20,
    },
  };
}

function chequeRow(cheque: Prisma.ChequeGetPayload<{ include: ReturnType<typeof chequeInclude> }>) {
  return {
    id: cheque.id,
    customerName: cheque.customer.partyName,
    mobileNumber: cheque.customer.contactNumber,
    chequeNumber: cheque.chequeNumber,
    bankName: cheque.bankName,
    branch: cheque.branch ?? "",
    chequeDate: cheque.chequeDate,
    amount: cheque.amount,
    accountHolderName: cheque.accountHolderName,
    status: cheque.status,
    collectionDateTime: cheque.collectionDateTime,
    collectionNotes: cheque.collectionNotes ?? "",
    collectedBy: cheque.collectedBy.name,
    depositedBy: cheque.depositedBy?.name ?? "",
    depositedAccount: cheque.depositedAccount
      ? `${cheque.depositedAccount.bankName} - ${cheque.depositedAccount.accountName} - ${cheque.depositedAccount.lastFourDigits}`
      : "",
    depositDateTime: cheque.depositDateTime,
    depositBankAccount: cheque.depositBankAccount ?? "",
    depositReceiptUrl: cheque.depositReceiptUrl ?? "",
    depositReceiptType: cheque.depositReceiptType ?? "",
    depositReceiptUploadedAt: cheque.depositReceiptUploadedAt,
    depositReceiptUploadedBy: cheque.depositReceiptUploadedBy?.name ?? "",
    micrCode: cheque.micrCode ?? "",
    ifscCode: cheque.ifscCode ?? "",
    ocrConfidence: cheque.ocrConfidence ?? 0,
    bounceReason: cheque.bounceReason ?? "",
    clearedAt: cheque.clearedAt,
    bouncedAt: cheque.bouncedAt,
    createdAt: cheque.createdAt,
  };
}

async function chequesToExcel(rows: ReturnType<typeof chequeRow>[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Cheque Collections");
  sheet.columns = [
    { header: "Customer Name", key: "customerName", width: 28 },
    { header: "Mobile", key: "mobileNumber", width: 16 },
    { header: "Cheque Number", key: "chequeNumber", width: 18 },
    { header: "Bank", key: "bankName", width: 22 },
    { header: "Branch", key: "branch", width: 18 },
    { header: "Cheque Date", key: "chequeDate", width: 18 },
    { header: "Amount", key: "amount", width: 16 },
    { header: "Account Holder", key: "accountHolderName", width: 24 },
    { header: "Status", key: "status", width: 18 },
    { header: "Collected By", key: "collectedBy", width: 18 },
    { header: "Collection Date", key: "collectionDateTime", width: 24 },
    { header: "Deposited By", key: "depositedBy", width: 18 },
    { header: "Deposited Account", key: "depositedAccount", width: 28 },
    { header: "Deposit Date", key: "depositDateTime", width: 24 },
    { header: "Deposit Account", key: "depositBankAccount", width: 22 },
    { header: "Deposit Receipt", key: "depositReceiptUrl", width: 28 },
    { header: "Receipt Uploaded By", key: "depositReceiptUploadedBy", width: 20 },
    { header: "MICR", key: "micrCode", width: 16 },
    { header: "IFSC", key: "ifscCode", width: 16 },
    { header: "OCR Confidence", key: "ocrConfidence", width: 16 },
    { header: "Bounce Reason", key: "bounceReason", width: 30 },
    { header: "Notes", key: "collectionNotes", width: 36 },
  ];
  sheet.getRow(1).font = { bold: true };
  rows.forEach((row) =>
    sheet.addRow({
      ...row,
      chequeDate: row.chequeDate.toISOString(),
      collectionDateTime: row.collectionDateTime.toISOString(),
      depositDateTime: row.depositDateTime?.toISOString() ?? "",
    })
  );
  return workbook.xlsx.writeBuffer();
}

function chequesToCsv(rows: ReturnType<typeof chequeRow>[]) {
  return reportToCsv(
    [
      "Customer Name",
      "Mobile",
      "Cheque Number",
      "Bank",
      "Branch",
      "Cheque Date",
      "Amount",
      "Account Holder",
      "Status",
      "Collected By",
      "Collection Date",
      "Deposited By",
      "Deposit Date",
      "Deposit Account",
      "MICR",
      "IFSC",
      "OCR Confidence",
      "Bounce Reason",
      "Notes",
    ],
    rows.map((row) => [
      row.customerName,
      row.mobileNumber,
      row.chequeNumber,
      row.bankName,
      row.branch,
      row.chequeDate.toISOString(),
      String(row.amount),
      row.accountHolderName,
      row.status,
      row.collectedBy,
      row.collectionDateTime.toISOString(),
      row.depositedBy,
      row.depositedAccount,
      row.depositDateTime?.toISOString() ?? "",
      row.depositBankAccount,
      row.depositReceiptUrl,
      row.depositReceiptUploadedBy,
      row.micrCode,
      row.ifscCode,
      String(row.ocrConfidence),
      row.bounceReason,
      row.collectionNotes,
    ])
  );
}

function printableHtml(rows: ReturnType<typeof chequeRow>[]) {
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cheque Report</title><style>body{font-family:Arial;padding:24px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #d1d5db;padding:6px;text-align:left}th{background:#f3f4f6}@media print{@page{size:landscape}}</style></head><body><h1>Cheque Collections</h1><table><thead><tr>${[
    "Customer",
    "Mobile",
    "Cheque No",
    "Bank",
    "Cheque Date",
    "Amount",
    "Status",
    "Collected By",
    "Collection Date",
    "Deposit Date",
    "Bounce Reason",
  ].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr><td>${escape(r.customerName)}</td><td>${escape(r.mobileNumber)}</td><td>${escape(r.chequeNumber)}</td><td>${escape(r.bankName)}</td><td>${r.chequeDate.toISOString()}</td><td>${r.amount}</td><td>${r.status}</td><td>${escape(r.collectedBy)}</td><td>${r.collectionDateTime.toISOString()}</td><td>${r.depositDateTime?.toISOString() ?? ""}</td><td>${escape(r.bounceReason)}</td></tr>`).join("")}</tbody></table><script>window.print()</script></body></html>`;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const shopId = requireShopId(request, session);
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") as ChequeStatus | null;
  const q = searchParams.get("q")?.trim();
  const staffId = searchParams.get("staffId") || undefined;
  const depositedAccountId = searchParams.get("depositedAccountId") || undefined;
  const from = asDate(searchParams.get("from"));
  const to = asDate(searchParams.get("to"), true);
  const quick = searchParams.get("quick");
  const format = searchParams.get("format");
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

  const where: Prisma.ChequeWhereInput = {
    shopId,
    ...(status ? { status } : {}),
    ...(staffId ? { collectedById: staffId } : {}),
    ...(depositedAccountId ? { depositedAccountId } : {}),
    ...(from || to ? { collectionDateTime: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q
      ? {
          OR: [
            { chequeNumber: { contains: q } },
            { bankName: { contains: q } },
            { customer: { partyName: { contains: q } } },
            { customer: { contactNumber: { contains: q.replace(/\D/g, "") } } },
            ...(Number.isFinite(Number(q)) ? [{ amount: Number(q) }] : []),
          ],
        }
      : {}),
    ...(quick === "today" ? { collectionDateTime: { gte: todayStart, lte: todayEnd } } : {}),
    ...(quick === "pending" ? { status: { in: ["COLLECTED", "PENDING_DEPOSIT"] } } : {}),
    ...(quick === "bounced" ? { status: "BOUNCED" } : {}),
    ...(quick === "high" ? { amount: { gte: HIGH_VALUE } } : {}),
    ...(quick === "cleared" ? { status: "CLEARED" } : {}),
    ...(quick === "overdue" ? { status: { in: ["COLLECTED", "PENDING_DEPOSIT"] }, collectionDateTime: { lt: staleDate } } : {}),
  };

  const include = chequeInclude();
  const [items, total, users, collectedToday, depositedToday, clearedToday, pendingDeposit, bounced, highValue] =
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
      prisma.user.findMany({ where: { shopId }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
      prisma.cheque.count({ where: { shopId, collectionDateTime: { gte: todayStart, lte: todayEnd } } }),
      prisma.cheque.count({ where: { shopId, depositDateTime: { gte: todayStart, lte: todayEnd } } }),
      prisma.cheque.count({ where: { shopId, clearedAt: { gte: todayStart, lte: todayEnd } } }),
      prisma.cheque.count({ where: { shopId, status: { in: ["COLLECTED", "PENDING_DEPOSIT"] } } }),
      prisma.cheque.count({ where: { shopId, status: "BOUNCED" } }),
      prisma.cheque.count({ where: { shopId, amount: { gte: HIGH_VALUE } } }),
    ]);

  const rows = items.map(chequeRow);
  if (format === "xlsx") {
    const buffer = await chequesToExcel(rows);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="cheque-collections.xlsx"',
      },
    });
  }
  if (format === "csv") {
    return new NextResponse(chequesToCsv(rows), {
      headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="cheque-collections.csv"' },
    });
  }
  if (format === "pdf") {
    return new NextResponse(printableHtml(rows), { headers: { "Content-Type": "text/html" } });
  }

  return NextResponse.json({
    items,
    users,
    alerts: {
      pendingDeposit,
      bounced,
      highValue,
      stale: await prisma.cheque.count({
        where: { shopId, status: { in: ["COLLECTED", "PENDING_DEPOSIT"] }, collectionDateTime: { lt: staleDate } },
      }),
      chequeDateTomorrow: await prisma.cheque.count({
        where: { shopId, chequeDate: { gte: tomorrowStart, lte: tomorrowEnd }, status: { in: ["COLLECTED", "PENDING_DEPOSIT"] } },
      }),
    },
    summary: { collectedToday, pendingDeposit, depositedToday, clearedToday, bounced, highValue },
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
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
          collectionDateTime: new Date(body.collectionDateTime),
          collectionNotes: body.collectionNotes,
          frontImageUrl: body.frontImageUrl,
          micrCode: body.micrCode,
          ifscCode: body.ifscCode,
          ocrRawText: body.ocrRawText,
          ocrExtractedData: body.ocrExtractedData as Prisma.InputJsonValue | undefined,
          ocrConfidence: body.ocrConfidence,
          ocrEditedFields: body.ocrEditedFields as Prisma.InputJsonValue | undefined,
          status: "PENDING_DEPOSIT",
        },
        include: chequeInclude(),
      });
      await tx.chequeActivity.create({
        data: {
          shopId,
          chequeId: created.id,
          userId: session.id,
          type: "CREATED",
          toStatus: "PENDING_DEPOSIT",
          notes: body.collectionNotes ?? "Cheque collected",
        },
      });
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
