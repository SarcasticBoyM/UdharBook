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
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return normalizePhone(trimmed);
}

function parseBalance(value: unknown): { ok: true; balance: number } | { ok: false; message: string } {
  if (value == null || value === "") return { ok: true, balance: 0 };

  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      return { ok: false, message: "Outstanding balance must be a number" };
    }
    return { ok: true, balance: value };
  }

  // Handles "25,000", "₹25000", "25000.50", etc.
  const cleaned = String(value)
    .trim()
    .replace(/[₹$,\s]/g, "")
    .replace(/[^0-9.-]/g, "");
  if (!cleaned) return { ok: true, balance: 0 };

  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) {
    return { ok: false, message: `Outstanding balance must be a number (got "${value}")` };
  }
  if (n < 0) return { ok: false, message: "Outstanding balance must be >= 0" };
  return { ok: true, balance: n };
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value == null) return undefined;
  if (typeof value === "object" && "result" in value) return value.result;
  if (typeof value === "object" && "text" in value) return value.text;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mapHeaders(row: Record<string, unknown>) {
  const keys = Object.keys(row);
  const findExact = (...names: string[]) => {
    const key = keys.find((k) =>
      names.some((n) => normalizeHeader(k) === normalizeHeader(n))
    );
    return key ? row[key] : undefined;
  };
  const findIncludes = (...parts: string[]) => {
    const key = keys.find((k) => {
      const norm = normalizeHeader(k);
      return parts.some((p) => norm.includes(normalizeHeader(p)));
    });
    return key ? row[key] : undefined;
  };

  const partyName = String(
    findExact("Party Name", "Customer Name", "partyname", "customername", "name") ??
      findIncludes("customername", "partyname", "accountname", "dealername") ??
      ""
  ).trim();

  const contactNumber = String(
    findExact("Contact Number", "contactnumber", "phone", "mobile", "contact", "mobileno") ??
      findIncludes("contact", "phone", "mobile", "mobileno", "cell") ??
      ""
  ).trim();

  const outstandingBalance =
    findExact(
      "Outstanding Balance Amount",
      "Outstanding Balance",
      "outstandingbalance",
      "balance",
      "amount",
      "Closing Balance",
      "closingbalance",
      "Pending Amount",
      "pendingamount",
      "Due Amount",
      "dueamount",
      "OS Amount",
      "osamount"
    ) ??
    findIncludes("outstanding", "balance", "pending", "dueamount", "osamount", "closingbal");

  return { partyName, contactNumber, outstandingBalance };
}

async function parseWorkbook(buffer: Buffer): Promise<Record<string, unknown>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headers: Record<number, string> = {};
  sheet.getRow(1).eachCell((cell, col) => {
    headers[col] = String(cellValue(cell.value) ?? "").trim();
  });

  const rows: Record<string, unknown>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, unknown> = {};
    row.eachCell((cell, col) => {
      const header = headers[col];
      if (header) record[header] = cellValue(cell.value);
    });
    if (Object.keys(record).length > 0) rows.push(record);
  });

  return rows;
}

type CustomerRow = Awaited<ReturnType<typeof prisma.customer.findMany>>[number];

function findInCache(
  cache: CustomerRow[],
  partyName: string,
  contactNumber: string | null
): CustomerRow | null {
  if (contactNumber) {
    const byContact = cache.find((c) => c.contactNumber === contactNumber);
    if (byContact) return byContact;
  }

  if (partyName) {
    const key = normalizeNameKey(partyName);
    const matches = cache.filter((c) => normalizeNameKey(c.partyName) === key);
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    if (contactNumber) {
      return matches.find((c) => c.contactNumber === contactNumber) ?? matches[0];
    }
    return matches[0];
  }

  return null;
}

function resolveStatus(outstandingBalance: number, current: FollowUpStatus): FollowUpStatus {
  if (outstandingBalance === 0) return "PAID";
  if (current === "PAID") return "PENDING";
  return current;
}

export async function importCustomersFromBuffer(buffer: Buffer): Promise<ImportSummary> {
  let rows: Record<string, unknown>[];
  try {
    rows = await parseWorkbook(buffer);
  } catch {
    return {
      totalProcessed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [
        {
          row: 0,
          message:
            "Could not read file. Use .xlsx format (Excel 2007+). Legacy .xls is not supported.",
        },
      ],
    };
  }

  const summary: ImportSummary = {
    totalProcessed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  const seenContacts = new Set<string>();
  const seenNames = new Set<string>();
  const customerCache = await prisma.customer.findMany();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const mapped = mapHeaders(rows[i]);
    const partyName = normalizeName(mapped.partyName);
    const rawContact = mapped.contactNumber.trim();
    const contactNumber = parseContact(rawContact);

    if (!partyName && !rawContact) {
      continue;
    }

    summary.totalProcessed++;

    const balanceResult = parseBalance(mapped.outstandingBalance);
    if (!balanceResult.ok) {
      summary.errors.push({ row: rowNum, message: balanceResult.message });
      summary.skipped++;
      continue;
    }
    const outstandingBalance = balanceResult.balance;

    const displayName = partyName || `Customer ${contactNumber ?? rawContact}`;

    if (contactNumber && seenContacts.has(contactNumber)) {
      summary.errors.push({
        row: rowNum,
        message: "Duplicate contact number in this file",
      });
      summary.skipped++;
      continue;
    }

    const nameKey = partyName ? normalizeNameKey(partyName) : "";
    if (!contactNumber && nameKey && seenNames.has(nameKey)) {
      summary.errors.push({
        row: rowNum,
        message: "Duplicate customer name in this file (no contact to distinguish)",
      });
      summary.skipped++;
      continue;
    }

    if (!partyName && !contactNumber) {
      summary.errors.push({
        row: rowNum,
        message: "Valid customer name or contact number (10+ digits) is required",
      });
      summary.skipped++;
      continue;
    }

    const finalContact = contactNumber ?? placeholderContact(displayName);

    try {
      const existing = findInCache(customerCache, partyName || displayName, contactNumber);

      if (existing) {
        const updateData: Prisma.CustomerUpdateInput = {
          partyName: displayName,
          outstandingBalance,
          balanceAsOfDate: new Date(),
          status: resolveStatus(outstandingBalance, existing.status),
        };

        if (contactNumber && isPlaceholderContact(existing.contactNumber)) {
          const taken = await prisma.customer.findUnique({
            where: { contactNumber },
          });
          if (!taken || taken.id === existing.id) {
            updateData.contactNumber = contactNumber;
          }
        }

        const updated = await prisma.customer.update({
          where: { id: existing.id },
          data: updateData,
        });
        const idx = customerCache.findIndex((c) => c.id === existing.id);
        if (idx >= 0) customerCache[idx] = updated;
        summary.updated++;
      } else {
        const taken = customerCache.find((c) => c.contactNumber === finalContact);
        if (taken) {
          summary.errors.push({
            row: rowNum,
            message: "Contact number already belongs to another customer",
          });
          summary.skipped++;
          continue;
        }

        const created = await prisma.customer.create({
          data: {
            partyName: displayName,
            contactNumber: finalContact,
            outstandingBalance,
            balanceAsOfDate: new Date(),
            status: outstandingBalance === 0 ? "PAID" : "PENDING",
          },
        });
        customerCache.push(created);
        summary.created++;
      }

      if (contactNumber) seenContacts.add(contactNumber);
      if (nameKey) seenNames.add(nameKey);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        summary.errors.push({
          row: rowNum,
          message: "Duplicate contact number — customer may already exist",
        });
      } else {
        summary.errors.push({
          row: rowNum,
          message: e instanceof Error ? e.message : "Import failed",
        });
      }
      summary.skipped++;
    }
  }

  return summary;
}
