import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
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
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

type CellValue = string | number | boolean | null | undefined;

function cellValue(val: CellValue): string | null {
  if (typeof val === "string") return val.trim() || null;
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "true" : "false";
  return null;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findField(row: Record<string, unknown>, ...keys: string[]): unknown {
  const normalizedKeys = keys.map(normalizeHeader);
  const match = Object.keys(row).find((header) => {
    const normalizedHeader = normalizeHeader(header);
    return normalizedKeys.some((key) => normalizedHeader.includes(key));
  });
  return match ? row[match] : undefined;
}

function parseBalance(value: string | null): number | null {
  if (!value) return 0;
  const cleaned = value.replace(/[,\s]/g, "").replace(/[^0-9.-]/g, "");
  if (!cleaned) return 0;
  const balance = Number.parseFloat(cleaned);
  return Number.isFinite(balance) && balance >= 0 ? balance : null;
}

export async function importCustomersFromExcel(buffer: Buffer): Promise<ImportSummary> {
  try {
    const rows = await parseWorkbook(buffer);

    if (rows.length === 0) {
      return {
        totalProcessed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [{ row: 0, message: "No data found in Excel file" }],
      };
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: ImportSummary["errors"] = [];
    const seenContacts = new Set<string>();

    for (let idx = 0; idx < rows.length; idx++) {
      const rowNumber = idx + 2;
      const row = rows[idx];
      const parsed = parseRow(row);

      if (!parsed) {
        skipped++;
        errors.push({
          row: rowNumber,
          message: "Valid customer name and non-negative outstanding balance are required",
        });
        continue;
      }

      const { partyName, contactNumber, outstandingBalance } = parsed;

      if (seenContacts.has(contactNumber)) {
        skipped++;
        errors.push({
          row: rowNumber,
          message: "Duplicate contact number in uploaded file",
        });
        continue;
      }
      seenContacts.add(contactNumber);

      try {
        const existing = await prisma.customer.findUnique({
          where: { contactNumber },
          select: { id: true },
        });

        await prisma.customer.upsert({
          where: { contactNumber },
          update: {
            outstandingBalance,
            updatedAt: new Date(),
          },
          create: {
            partyName,
            contactNumber,
            outstandingBalance,
            status: outstandingBalance === 0 ? "CLEARED" : "PENDING",
          },
        });
        if (existing) updated++;
        else created++;
      } catch (err: unknown) {
        skipped++;
        const errMsg =
          err instanceof Error ? err.message : String(err);
        errors.push({ row: rowNumber, message: errMsg });
      }
    }

    return {
      totalProcessed: rows.length,
      created,
      updated,
      skipped,
      errors,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);
    return {
      totalProcessed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [{ row: 0, message: `Failed to parse Excel file: ${message}` }],
    };
  }
}

function parseRow(row: Record<string, unknown>): {
  partyName: string;
  contactNumber: string;
  outstandingBalance: number;
} | null {
  const nameValue = cellValue(
    findField(row, "partyname", "customername", "clientname", "name") as CellValue
  );
  if (!nameValue) return null;

  const partyName = normalizeName(nameValue);

  const contactValue = cellValue(
    findField(row, "contactnumber", "mobile", "phone", "contact", "number") as CellValue
  );
  const contactNumber = parseContact(contactValue || "") || placeholderContact(partyName);

  const balanceValue = cellValue(
    findField(row, "outstandingbalance", "closingbalance", "pendingamount", "dueamount", "osamount", "balance", "amount") as CellValue
  );
  const outstandingBalance = parseBalance(balanceValue);
  if (outstandingBalance == null) return null;

  return { partyName, contactNumber, outstandingBalance };
}

async function parseWorkbook(buffer: Buffer): Promise<Record<string, unknown>[]> {
  const workbook = new ExcelJS.Workbook();
  const workbookBuffer = new Uint8Array(buffer).buffer;
  await workbook.xlsx.load(workbookBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headers: Record<number, string> = {};
  sheet.getRow(1).eachCell((cell, col) => {
    headers[col] = String(cellValue(cell.value as CellValue) ?? "").trim();
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
