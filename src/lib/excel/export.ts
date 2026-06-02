import ExcelJS from "exceljs";
import type { Customer, FollowUp } from "@prisma/client";
import { agingBucket, agingBucketLabel } from "@/lib/aging";

export async function customersToExcel(customers: Customer[], sheetName: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = [
    { header: "Party Name", key: "partyName", width: 28 },
    { header: "Contact Number", key: "contactNumber", width: 18 },
    { header: "Outstanding Balance", key: "outstandingBalance", width: 20 },
    { header: "Status", key: "status", width: 18 },
    { header: "Last Follow-up", key: "lastFollowupDate", width: 16 },
    { header: "Next Follow-up", key: "nextFollowupDate", width: 16 },
    { header: "Aging Bucket", key: "aging", width: 14 },
    { header: "Total Calls", key: "totalCallsMade", width: 12 },
  ];

  sheet.getRow(1).font = { bold: true };

  for (const c of customers) {
    sheet.addRow({
      partyName: c.partyName,
      contactNumber: c.contactNumber,
      outstandingBalance: c.outstandingBalance,
      status: c.status,
      lastFollowupDate: c.lastFollowupDate?.toISOString().slice(0, 10) ?? "",
      nextFollowupDate: c.nextFollowupDate?.toISOString().slice(0, 10) ?? "",
      aging: agingBucketLabel(agingBucket(c.balanceAsOfDate)),
      totalCallsMade: c.totalCallsMade,
    });
  }

  return workbook.xlsx.writeBuffer();
}

export async function followUpsToExcel(
  rows: (FollowUp & { customer: Customer; createdBy: { name: string } })[]
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Follow-ups");

  sheet.columns = [
    { header: "Date", key: "followupDate", width: 14 },
    { header: "Party Name", key: "partyName", width: 28 },
    { header: "Contact", key: "contactNumber", width: 16 },
    { header: "Status", key: "status", width: 18 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Next Follow-up", key: "nextFollowupDate", width: 16 },
    { header: "By", key: "createdBy", width: 20 },
  ];

  sheet.getRow(1).font = { bold: true };

  for (const r of rows) {
    sheet.addRow({
      followupDate: r.followupDate.toISOString().slice(0, 10),
      partyName: r.customer.partyName,
      contactNumber: r.customer.contactNumber,
      status: r.status,
      notes: r.notes ?? "",
      nextFollowupDate: r.nextFollowupDate?.toISOString().slice(0, 10) ?? "",
      createdBy: r.createdBy.name,
    });
  }

  return workbook.xlsx.writeBuffer();
}

/** Simple CSV-based "PDF alternative" — full PDF needs puppeteer; export HTML table as printable */
export function reportToCsv(headers: string[], rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}
