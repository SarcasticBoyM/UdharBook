import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { ImportSummary } from "@/types";

const PLACEHOLDER_PREFIX = "NO-PH-";
const IMPORT_BATCH_SIZE = 100;
const EXISTING_LOOKUP_BATCH_SIZE = 500;
const MAX_ERROR_ROWS = 500;

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

export async function importCustomersFromExcel(buffer: Buffer, shopId: string): Promise<ImportSummary> {
  const startedAt = Date.now();
  try {
    logger.info("customer_import_parse_start", {
      shopId,
      fileBytes: buffer.length,
      memoryMb: memorySnapshotMb(),
    });
    const rows = await parseWorkbook(buffer);
    logger.info("customer_import_parse_complete", {
      shopId,
      totalRowsDetected: rows.length,
      durationMs: Date.now() - startedAt,
      memoryMb: memorySnapshotMb(),
    });

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
    const validRows: Array<{
      rowNumber: number;
      partyName: string;
      contactNumber: string;
      outstandingBalance: number;
    }> = [];

    for (let idx = 0; idx < rows.length; idx++) {
      const rowNumber = idx + 2;
      const row = rows[idx];
      const parsed = parseRow(row);

      if (!parsed) {
        skipped++;
        addImportError(errors, {
          row: rowNumber,
          message: "Valid customer name and non-negative outstanding balance are required",
        });
        continue;
      }

      const { partyName, contactNumber, outstandingBalance } = parsed;

      if (seenContacts.has(contactNumber)) {
        skipped++;
        addImportError(errors, {
          row: rowNumber,
          message: "Duplicate contact number in uploaded file",
        });
        continue;
      }
      seenContacts.add(contactNumber);
      validRows.push({ rowNumber, partyName, contactNumber, outstandingBalance });
    }

    logger.info("customer_import_validation_complete", {
      shopId,
      parsedRows: rows.length,
      validRows: validRows.length,
      skippedRows: skipped,
      durationMs: Date.now() - startedAt,
      memoryMb: memorySnapshotMb(),
    });

    const existingContacts = await loadExistingContacts(shopId, validRows.map((row) => row.contactNumber));
    logger.info("customer_import_existing_lookup_complete", {
      shopId,
      lookupContacts: validRows.length,
      existingCount: existingContacts.size,
      durationMs: Date.now() - startedAt,
      memoryMb: memorySnapshotMb(),
    });

    const batches = chunk(validRows, IMPORT_BATCH_SIZE);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batchStartedAt = Date.now();
      const batch = batches[batchIndex];
      const updates = batch.filter((row) => existingContacts.has(row.contactNumber));
      const creates = batch.filter((row) => !existingContacts.has(row.contactNumber));
      logger.info("customer_import_batch_start", {
        shopId,
        batch: batchIndex + 1,
        totalBatches: batches.length,
        rows: batch.length,
        updates: updates.length,
        creates: creates.length,
      });

      try {
        let batchCreated = 0;
        await prisma.$transaction(async (tx) => {
          if (creates.length > 0) {
            const createResult = await tx.customer.createMany({
              data: creates.map((row) => ({
                shopId,
                partyName: row.partyName,
                contactNumber: row.contactNumber,
                outstandingBalance: row.outstandingBalance,
                status: row.outstandingBalance === 0 ? "CLEARED" : "PENDING",
              })),
              skipDuplicates: true,
            });
            batchCreated = createResult.count;
          }

          for (const row of updates) {
            await tx.customer.update({
              where: { shopId_contactNumber: { shopId, contactNumber: row.contactNumber } },
              data: { outstandingBalance: row.outstandingBalance },
            });
          }
        }, { timeout: 20000 });

        const skippedDuplicates = creates.length - batchCreated;
        created += batchCreated;
        updated += updates.length;
        skipped += skippedDuplicates;
        logger.info("customer_import_batch_complete", {
          shopId,
          batch: batchIndex + 1,
          totalBatches: batches.length,
          rows: batch.length,
          created: batchCreated,
          updated: updates.length,
          skippedDuplicates,
          durationMs: Date.now() - batchStartedAt,
          totalDurationMs: Date.now() - startedAt,
          memoryMb: memorySnapshotMb(),
        });
      } catch (err: unknown) {
        skipped += batch.length;
        const errMsg = err instanceof Error ? err.message : String(err);
        batch.forEach((row) => addImportError(errors, { row: row.rowNumber, message: errMsg }));
        logger.error("customer_import_batch_failed", {
          shopId,
          batch: batchIndex + 1,
          totalBatches: batches.length,
          rows: batch.length,
          error: errMsg,
          durationMs: Date.now() - batchStartedAt,
          totalDurationMs: Date.now() - startedAt,
        });
      }
    }

    logger.info("customer_import_complete", {
      shopId,
      totalProcessed: rows.length,
      created,
      updated,
      skipped,
      errors: errors.length,
      durationMs: Date.now() - startedAt,
      memoryMb: memorySnapshotMb(),
    });

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
    logger.error("customer_import_failed", {
      shopId,
      error: message,
      durationMs: Date.now() - startedAt,
      memoryMb: memorySnapshotMb(),
    });
    return {
      totalProcessed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [{ row: 0, message: `Failed to parse Excel file: ${message}` }],
    };
  }
}

function addImportError(errors: ImportSummary["errors"], error: { row: number; message: string }) {
  if (errors.length < MAX_ERROR_ROWS) errors.push(error);
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function loadExistingContacts(shopId: string, contacts: string[]) {
  const uniqueContacts = Array.from(new Set(contacts));
  const existingContacts = new Set<string>();
  const batches = chunk(uniqueContacts, EXISTING_LOOKUP_BATCH_SIZE);
  for (const batch of batches) {
    const existing = await prisma.customer.findMany({
      where: { shopId, contactNumber: { in: batch } },
      select: { contactNumber: true },
    });
    existing.forEach((customer) => existingContacts.add(customer.contactNumber));
  }
  return existingContacts;
}

function memorySnapshotMb() {
  const memory = process.memoryUsage();
  return {
    rss: Math.round(memory.rss / 1024 / 1024),
    heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
  };
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

    const hasAnyValue = Object.values(obj).some((value) => cellValue(value as CellValue));
    if (hasAnyValue) rows.push(obj);
  });

  return rows;
}
