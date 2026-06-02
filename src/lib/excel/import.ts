import ExcelJS from "exceljs";
import { Prisma, type FollowUpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import type { ImportSummary } from "@/types";

const PLACEHOLDER_PREFIX = "NO-PH-";

export function isPlaceholderContact(contact: string): boolean {
  return contact.startsWith(PLACEHOLDER_PREFIX);
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function normalizeNameKey(name: string): string {
  return normalizeName(name).toLowerCase();
}

/** Stable placeholder when Excel has no contact number (satisfies unique contactNumber). */
function placeholderContact(partyName: string): string {
  const slug =
    normalizeNameKey(partyName).replace(/[^a-z0-9]/g, "").slice(0, 40) || "unknown";
  return `${PLACEHOLDER_PREFIX}${slug}`;
}

function parseContact(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\D/g, "").slice(-10) || null;
}

type CellValue = string | number | boolean | null | undefined;

function cellValue(val: CellValue): string | null {
  if (typeof val === "string") return val.trim() || null;
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "true" : "false";
  return null;
}

function findIncludes(...keys: string[]): string {
  const lowerKeys = keys.map((k) => k.toLowerCase());
  return lowerKeys.join("|")
}

export async function importCustomersFromExcel(buffer: Buffer): Promise<ImportSummary> {
  try {
    const rows = await parseWorkbook(buffer);

    if (rows.length === 0) {
      return {
        success: false,
        created: 0,
        skipped: 0,
        errors: "No data found in Excel file",
      };
    }

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const parsed = parseRow(row);

      if (!parsed) {
        skipped++;
        continue;
      }

      const { partyName, contactNumber, outstandingBalance } = parsed;

      try {
        await prisma.customer.upsert({
          where: { contactNumber },
          update: {
            name: partyName,
            outstandingBalance,
            updatedAt: new Date(),
          },
          create: {
            name: partyName,
            contactNumber,
            outstandingBalance,
          },
        });
        created++;
      } catch (err: unknown) {
        skipped++;
        const errMsg =
          err instanceof Error ? err.message : String(err);
        errors.push(`Row ${idx + 2}: ${errMsg}`);
      }
    }

    return {
      success: errors.length === 0,
      created,
      skipped,
      errors: errors.length > 0 ? errors.join("; ") : undefined,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);
    return {
      success: false,
      created: 0,
      skipped: 0,
      errors: `Failed to parse Excel file: ${message}`,
    };
  }
}

function parseRow(row: Record<string, unknown>): {
  partyName: string;
  contactNumber: string;
  outstandingBalance: number;
} | null {
  const nameValue = cellValue(
    row[findIncludes("party", "name", "customer", "clientname")] as CellValue
  );
  if (!nameValue) return null;

  const partyName = normalizeName(nameValue);

  const contactValue = cellValue(
    row[findIncludes("phone", "mobile", "contact", "number")] as CellValue
  );
  const contactNumber = parseContact(contactValue || "") || placeholderContact(partyName);

  const balanceValue = cellValue(
    row[findIncludes("balance", "outstanding", "pending", "dueamount", "osamount")] as CellValue
  );
  const outstandingBalance = parseFloat(balanceValue || "0") || 0;

  return { partyName, contactNumber, outstandingBalance };
}

async function parseWorkbook(buffer: Buffer): Promise<Record<string, unknown>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headers: Record<number, string> = {};
  sheet.getRow(1).eachCell((cell, col) => {
    headers[col] = String(cellValue(cell.value) ?? "").trim();
  });

  const rows: Record<string, unknown>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const obj: Record<string, unknown> = {};
    row.eachCell((cell, col) => {
      const header = headers[col];
      if (header) obj[header] = cell.value;
    });

    rows.push(obj);
  });

  return rows;
}
