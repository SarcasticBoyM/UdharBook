import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { customersToExcel, followUpsToExcel, reportToCsv } from "@/lib/excel/export";
import { agingBucket, agingBucketLabel } from "@/lib/aging";
import { resolveOperationalShopId } from "@/lib/tenant";

function printableReportHtml(input: {
  title: string;
  shopName: string;
  filters: string[];
  summary: Record<string, string | number>;
  headers: string[];
  rows: string[][];
}) {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const batchTag = searchParams.get("batchTag")?.trim();
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { shopName: true } });
  const shopName = shop?.shopName ?? "UdharBook";

  if (type === "outstanding") {
    const customers = await prisma.customer.findMany({
      where: { shopId, ...(batchTag ? { batchTag: { equals: batchTag, mode: "insensitive" } } : {}), outstandingBalance: { gt: 0 }, NOT: { status: "CLEARED" } },
      orderBy: { outstandingBalance: "desc" },
    });

    if (format === "xlsx") {
      const buffer = await customersToExcel(customers, "Outstanding");
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="outstanding-report.xlsx"',
        },
      });
    }

    const headers = ["Party Name", "Batch / Firm", "Contact", "Balance", "Status", "Next Follow-up"];
    const rows = customers.map((c) => [
        c.partyName,
        c.batchTag ?? "",
        c.contactNumber,
        String(c.outstandingBalance),
        c.status,
        c.nextFollowupDate?.toISOString().slice(0, 10) ?? "",
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
    const where: Prisma.FollowUpWhereInput = {
      shopId,
      ...(batchTag ? { customer: { is: { batchTag: { equals: batchTag, mode: "insensitive" } } } } : {}),
      ...(from && to ? { followupDate: { gte: new Date(from), lte: new Date(to) } } : {}),
    };

    const followUps = await prisma.followUp.findMany({
      where,
      include: {
        customer: true,
        createdBy: { select: { name: true } },
      },
      orderBy: { followupDate: "desc" },
    });

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
        f.followupDate.toISOString().slice(0, 10),
        f.customer.partyName,
        f.customer.batchTag ?? "",
        f.status,
        f.notes ?? "",
      ]);
    if (format === "pdf") {
      return new NextResponse(printableReportHtml({
        title: "Follow-up Report",
        shopName,
        filters: [from ? `From: ${new Date(from).toISOString().slice(0, 10)}` : "", to ? `To: ${new Date(to).toISOString().slice(0, 10)}` : "", batchTag ? `Batch: ${batchTag}` : ""].filter(Boolean),
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
    const customers = await prisma.customer.findMany({
      where: { shopId, ...(batchTag ? { batchTag: { equals: batchTag, mode: "insensitive" } } : {}), outstandingBalance: { gt: 0 }, NOT: { status: "CLEARED" } },
    });

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
        c.partyName,
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
