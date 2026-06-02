import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { customersToExcel, followUpsToExcel, reportToCsv } from "@/lib/excel/export";
import { agingBucket, agingBucketLabel } from "@/lib/aging";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ type: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { type } = await params;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "xlsx";
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (type === "outstanding") {
    const customers = await prisma.customer.findMany({
      where: { outstandingBalance: { gt: 0 }, NOT: { status: "CLEARED" } },
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

    const csv = reportToCsv(
      ["Party Name", "Contact", "Balance", "Status", "Next Follow-up"],
      customers.map((c) => [
        c.partyName,
        c.contactNumber,
        String(c.outstandingBalance),
        c.status,
        c.nextFollowupDate?.toISOString().slice(0, 10) ?? "",
      ])
    );
    return new NextResponse(csv, {
      headers: {
        "Content-Type": format === "pdf" ? "application/pdf" : "text/csv",
        "Content-Disposition": `attachment; filename="outstanding-report.${format === "pdf" ? "csv" : "csv"}"`,
      },
    });
  }

  if (type === "follow-up") {
    const where =
      from && to
        ? {
            followupDate: {
              gte: new Date(from),
              lte: new Date(to),
            },
          }
        : {};

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

    const csv = reportToCsv(
      ["Date", "Party", "Status", "Notes"],
      followUps.map((f) => [
        f.followupDate.toISOString().slice(0, 10),
        f.customer.partyName,
        f.status,
        f.notes ?? "",
      ])
    );
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="follow-up-report.csv"',
      },
    });
  }

  if (type === "aging") {
    const customers = await prisma.customer.findMany({
      where: { outstandingBalance: { gt: 0 }, NOT: { status: "CLEARED" } },
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

    const csv = reportToCsv(
      ["Party Name", "Balance", "Aging Bucket"],
      customers.map((c) => [
        c.partyName,
        String(c.outstandingBalance),
        agingBucketLabel(agingBucket(c.balanceAsOfDate)),
      ])
    );
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="aging-report.csv"',
      },
    });
  }

  return NextResponse.json({ error: "Unknown report type" }, { status: 404 });
}
