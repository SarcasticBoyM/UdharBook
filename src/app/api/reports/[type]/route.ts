import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { customersToExcel, followUpsToExcel, reportToCsv } from "@/lib/excel/export";
import { agingBucket, agingBucketLabel } from "@/lib/aging";
import { resolveOperationalShopId } from "@/lib/tenant";

function safeText(value: unknown, fallback = "-") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function canUseRuntimeDebug(role: string) {
  return role === "SUPER_ADMIN" || role === "SHOP_ADMIN";
}

function safeDate(value: string | null, end = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (end) date.setHours(23, 59, 59, 999);
  else date.setHours(0, 0, 0, 0);
  return date;
}

function safeDateOnly(value: Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function normalizeCustomerSearch(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function customerTextContains(field: "partyName" | "geoAddress", value: string): Prisma.CustomerWhereInput {
  return { [field]: { contains: value, mode: "insensitive" } };
}

function customerSearchWhere(search: string): Prisma.CustomerWhereInput {
  const phoneSearch = search.replace(/\D/g, "");
  const terms = search.split(" ").filter(Boolean);
  return {
    OR: [
      customerTextContains("partyName", search),
      customerTextContains("geoAddress", search),
      ...(terms.length > 1
        ? [
            { AND: terms.map((term) => customerTextContains("partyName", term)) },
            { AND: terms.map((term) => customerTextContains("geoAddress", term)) },
          ]
        : []),
      ...(phoneSearch ? [{ contactNumber: { contains: phoneSearch } }] : []),
      { batchTag: { contains: search, mode: "insensitive" } },
    ],
  };
}

function customerViewWhere(view: string): Prisma.CustomerWhereInput {
  if (view === "active" || view === "pending") return { outstandingBalance: { gt: 0 }, NOT: { status: "CLEARED" } };
  if (view === "inactive") {
    return {
      OR: [
        { outstandingBalance: { lte: 0 } },
        { status: "CLEARED" },
      ],
    };
  }
  return {};
}

function printableReportHtml(input: {
  title: string;
  shopName: string;
  filters: string[];
  summary: Record<string, string | number>;
  headers: string[];
  rows: string[][];
}) {
  const escape = (value: unknown) => safeText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const generatedAt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(input.title)}</title><style>
    body{font-family:Arial,sans-serif;color:#0f172a;margin:0;padding:20px;background:#fff}
    header{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #e2e8f0;padding-bottom:12px;margin-bottom:14px}
    h1{margin:0;font-size:22px}.muted{color:#64748b;font-size:12px}
    .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0}.card{border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#f8fafc}.card b{display:block;font-size:15px;margin-top:4px}
    .filters{font-size:11px;color:#475569;margin:8px 0 12px}
    table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #d1d5db;padding:5px;text-align:left;vertical-align:top}th{background:#f1f5f9}tr{break-inside:avoid}
    footer{margin-top:14px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:10px;color:#64748b;text-align:center}
    @media print{@page{size:landscape;margin:10mm}body{padding:0}.no-print{display:none}}
    @media(max-width:760px){.summary{grid-template-columns:1fr 1fr}table{font-size:9px}}
  </style></head><body><header><div><h1>${escape(input.title)}</h1><div class="muted">${escape(input.shopName)} | Generated ${escape(generatedAt)}</div></div><button class="no-print" onclick="window.print()">Print / Save PDF</button></header>
  <section class="summary">${Object.entries(input.summary).map(([key, value]) => `<div class="card"><span class="muted">${escape(key)}</span><b>${escape(String(value))}</b></div>`).join("")}</section>
  <div class="filters"><b>Filters:</b> ${input.filters.length ? input.filters.map(escape).join(" | ") : "All records"}</div>
  <table><thead><tr>${input.headers.map((header) => `<th>${escape(header)}</th>`).join("")}</tr></thead><tbody>${input.rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table><footer>UdharBook report. Page numbers are available from the browser print dialog.</footer><script>window.print()</script></body></html>`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ type: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { type } = await params;
  const shopId = await resolveOperationalShopId(request, session);
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "xlsx";
  const from = safeDate(searchParams.get("from"));
  const to = safeDate(searchParams.get("to"), true);
  const batchTag = searchParams.get("batchTag")?.trim();
  const view = searchParams.get("view") ?? "active";
  const includeArchived = searchParams.get("includeArchived") === "true" || view === "all_with_archived";
  const customerSearch = normalizeCustomerSearch(searchParams.get("search") ?? "");
  const selectedCustomerIds = (searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const customerStatus = searchParams.get("status");
  const customerSort = searchParams.get("sort") ?? "balance";
  const customerOrder = searchParams.get("order") === "asc" ? "asc" : "desc";
  const customerExportMode = searchParams.get("mode") === "customers";
  const debugMode = canUseRuntimeDebug(session.role) && searchParams.get("debug") === "runtime";
  const isolateMode = debugMode && searchParams.get("isolate") === "1";
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { shopName: true } });
  const shopName = shop?.shopName ?? "UdharBook";

  console.info("generic_report_query", {
    type,
    shopId,
    role: session.role,
      incomingFilters: {
        format,
        from: searchParams.get("from") || null,
        to: searchParams.get("to") || null,
        batchTag: batchTag || null,
        includeArchived,
      },
      normalizedFilters: {
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
        batchTag: batchTag || null,
        includeArchived,
      },
  });

  if (type === "outstanding") {
    const rawWhere: Prisma.CustomerWhereInput = { shopId, ...(includeArchived ? {} : { isArchived: false }) };
    const customerExportWhere: Prisma.CustomerWhereInput = {
      shopId,
      ...(selectedCustomerIds.length
        ? { id: { in: selectedCustomerIds } }
        : {
            ...(view === "archived" ? { isArchived: true } : includeArchived ? {} : { isArchived: false }),
            ...(batchTag ? { batchTag: { equals: batchTag, mode: "insensitive" } } : {}),
            ...(customerStatus ? { status: customerStatus as Prisma.EnumCustomerStatusFilter["equals"] } : {}),
            ...(customerSearch ? customerSearchWhere(customerSearch) : {}),
            ...customerViewWhere(view),
          }),
    };
    const where: Prisma.CustomerWhereInput = {
      shopId,
      ...(includeArchived ? {} : { isArchived: false }),
      ...(isolateMode ? {} : {
        ...(batchTag ? { batchTag: { equals: batchTag, mode: "insensitive" } } : {}),
        outstandingBalance: { gt: 0 },
        NOT: { status: "CLEARED" },
      }),
    };
    const orderBy: Prisma.CustomerOrderByWithRelationInput =
      customerSort === "nextFollowup"
        ? { nextFollowupDate: customerOrder }
        : { outstandingBalance: customerOrder };
    const effectiveWhere = customerExportMode || selectedCustomerIds.length ? customerExportWhere : where;
    const customers = await prisma.customer.findMany({ where: effectiveWhere, orderBy });
    const rawCount = debugMode ? await prisma.customer.count({ where: rawWhere }) : undefined;
    const runtimeDebug = debugMode
      ? {
          enabled: true,
          isolateMode,
          session: { userId: session.id, role: session.role, sessionShopId: session.shopId, resolvedShopId: shopId },
          filtersReceived: { format, from: searchParams.get("from") || null, to: searchParams.get("to") || null, batchTag: batchTag || null, includeArchived },
          rawWhere,
          generatedWhereClause: {
            shopId,
            ...(includeArchived ? {} : { isArchived: false }),
            ...(batchTag ? { batchTag: { equals: batchTag, mode: "insensitive" } } : {}),
            outstandingBalance: { gt: 0 },
            NOT: { status: "CLEARED" },
          },
          effectiveWhereClause: effectiveWhere,
          rawCount,
          rowCount: customers.length,
          rowsDisappearAfterFilters: typeof rawCount === "number" ? rawCount > 0 && customers.length === 0 && !isolateMode : null,
        }
      : undefined;
    console.info("generic_report_result", { type, shopId, where: effectiveWhere, rowCount: customers.length, debug: runtimeDebug });
    if (debugMode && format === "json") return NextResponse.json({ success: true, type, rows: customers.slice(0, 100), debug: runtimeDebug });

    if (format === "xlsx") {
      const buffer = await customersToExcel(customers, selectedCustomerIds.length ? "Selected Customers" : customerExportMode ? "Customers" : "Outstanding");
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${selectedCustomerIds.length ? "selected-customers" : customerExportMode ? "customers" : "outstanding-report"}.xlsx"`,
        },
      });
    }

    const headers = ["Party Name", "Batch / Firm", "Contact", "Balance", "Status", "Next Follow-up"];
    const rows = customers.map((c) => [
        safeText(c.partyName),
        c.batchTag ?? "",
        safeText(c.contactNumber),
        String(c.outstandingBalance),
        safeText(c.status),
        safeDateOnly(c.nextFollowupDate),
      ]);
    if (format === "pdf") {
      return new NextResponse(printableReportHtml({
        title: "Outstanding Report",
        shopName,
        filters: ["Outstanding customers only", batchTag ? `Batch: ${batchTag}` : ""].filter(Boolean),
        summary: {
          Customers: customers.length,
          "Total Outstanding": customers.reduce((sum, item) => sum + item.outstandingBalance, 0),
        },
        headers,
        rows,
      }), { headers: { "Content-Type": "text/html", "Content-Disposition": 'inline; filename="outstanding-report-print.html"' } });
    }
    const csv = reportToCsv(headers, rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="outstanding-report.csv"',
      },
    });
  }

  if (type === "follow-up") {
    const rawWhere: Prisma.FollowUpWhereInput = { shopId };
    const where: Prisma.FollowUpWhereInput = {
      shopId,
      ...(isolateMode ? {} : {
        customer: { is: { ...(includeArchived ? {} : { isArchived: false }), ...(batchTag ? { batchTag: { equals: batchTag, mode: "insensitive" } } : {}) } },
        ...(from || to ? { followupDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      }),
    };

    const followUps = await prisma.followUp.findMany({
      where,
      include: {
        customer: true,
        createdBy: { select: { name: true } },
      },
      orderBy: { followupDate: "desc" },
    });
    const rawCount = debugMode ? await prisma.followUp.count({ where: rawWhere }) : undefined;
    const generatedWhere: Prisma.FollowUpWhereInput = {
      shopId,
      customer: { is: { ...(includeArchived ? {} : { isArchived: false }), ...(batchTag ? { batchTag: { equals: batchTag, mode: "insensitive" } } : {}) } },
      ...(from || to ? { followupDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const runtimeDebug = debugMode
      ? {
          enabled: true,
          isolateMode,
          session: { userId: session.id, role: session.role, sessionShopId: session.shopId, resolvedShopId: shopId },
          filtersReceived: { format, from: searchParams.get("from") || null, to: searchParams.get("to") || null, batchTag: batchTag || null, includeArchived },
          rawWhere,
          generatedWhereClause: generatedWhere,
          effectiveWhereClause: where,
          rawCount,
          rowCount: followUps.length,
          rowsDisappearAfterFilters: typeof rawCount === "number" ? rawCount > 0 && followUps.length === 0 && !isolateMode : null,
        }
      : undefined;
    console.info("generic_report_result", { type, shopId, where, rowCount: followUps.length, debug: runtimeDebug });
    if (debugMode && format === "json") return NextResponse.json({ success: true, type, rows: followUps.slice(0, 100), debug: runtimeDebug });

    if (format === "xlsx") {
      const buffer = await followUpsToExcel(followUps);
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="follow-up-report.xlsx"',
        },
      });
    }

    const headers = ["Date", "Party", "Batch / Firm", "Status", "Notes"];
    const rows = followUps.map((f) => [
        safeDateOnly(f.followupDate),
        safeText(f.customer.partyName),
        f.customer.batchTag ?? "",
        safeText(f.status),
        f.notes ?? "",
      ]);
    if (format === "pdf") {
      return new NextResponse(printableReportHtml({
        title: "Follow-up Report",
        shopName,
        filters: [from ? `From: ${safeDateOnly(from)}` : "", to ? `To: ${safeDateOnly(to)}` : "", batchTag ? `Batch: ${batchTag}` : ""].filter(Boolean),
        summary: { "Follow-ups": followUps.length },
        headers,
        rows,
      }), { headers: { "Content-Type": "text/html", "Content-Disposition": 'inline; filename="follow-up-report-print.html"' } });
    }
    const csv = reportToCsv(headers, rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="follow-up-report.csv"',
      },
    });
  }

  if (type === "aging") {
    const rawWhere: Prisma.CustomerWhereInput = { shopId, ...(includeArchived ? {} : { isArchived: false }) };
    const where: Prisma.CustomerWhereInput = {
      shopId,
      ...(includeArchived ? {} : { isArchived: false }),
      ...(isolateMode ? {} : {
        ...(batchTag ? { batchTag: { equals: batchTag, mode: "insensitive" } } : {}),
        outstandingBalance: { gt: 0 },
        NOT: { status: "CLEARED" },
      }),
    };
    const customers = await prisma.customer.findMany({ where });
    const rawCount = debugMode ? await prisma.customer.count({ where: rawWhere }) : undefined;
    const runtimeDebug = debugMode
      ? {
          enabled: true,
          isolateMode,
          session: { userId: session.id, role: session.role, sessionShopId: session.shopId, resolvedShopId: shopId },
          filtersReceived: { format, from: searchParams.get("from") || null, to: searchParams.get("to") || null, batchTag: batchTag || null, includeArchived },
          rawWhere,
          generatedWhereClause: {
            shopId,
            ...(includeArchived ? {} : { isArchived: false }),
            ...(batchTag ? { batchTag: { equals: batchTag, mode: "insensitive" } } : {}),
            outstandingBalance: { gt: 0 },
            NOT: { status: "CLEARED" },
          },
          effectiveWhereClause: where,
          rawCount,
          rowCount: customers.length,
          rowsDisappearAfterFilters: typeof rawCount === "number" ? rawCount > 0 && customers.length === 0 && !isolateMode : null,
        }
      : undefined;
    console.info("generic_report_result", { type, shopId, where, rowCount: customers.length, debug: runtimeDebug });
    if (debugMode && format === "json") return NextResponse.json({ success: true, type, rows: customers.slice(0, 100), debug: runtimeDebug });

    const buckets: Record<string, typeof customers> = {
      "0-30": [],
      "31-60": [],
      "61-90": [],
      "90+": [],
    };
    for (const c of customers) {
      buckets[agingBucket(c.balanceAsOfDate)].push(c);
    }

    if (format === "xlsx") {
      const all = customers.map((c) => ({
        ...c,
        partyName: `${c.partyName} (${agingBucketLabel(agingBucket(c.balanceAsOfDate))})`,
      }));
      const buffer = await customersToExcel(all, "Aging");
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="aging-report.xlsx"',
        },
      });
    }

    const headers = ["Party Name", "Batch / Firm", "Balance", "Aging Bucket"];
    const rows = customers.map((c) => [
        safeText(c.partyName),
        c.batchTag ?? "",
        String(c.outstandingBalance),
        agingBucketLabel(agingBucket(c.balanceAsOfDate)),
      ]);
    if (format === "pdf") {
      return new NextResponse(printableReportHtml({
        title: "Customer Aging Report",
        shopName,
        filters: ["Outstanding customers only", batchTag ? `Batch: ${batchTag}` : ""].filter(Boolean),
        summary: {
          Customers: customers.length,
          "Total Outstanding": customers.reduce((sum, item) => sum + item.outstandingBalance, 0),
        },
        headers,
        rows,
      }), { headers: { "Content-Type": "text/html", "Content-Disposition": 'inline; filename="aging-report-print.html"' } });
    }
    const csv = reportToCsv(headers, rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="aging-report.csv"',
      },
    });
  }

  return NextResponse.json({ error: "Unknown report type" }, { status: 404 });
}
