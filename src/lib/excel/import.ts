import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { ImportSummary } from "@/types";
import { batchTagKey, normalizeBatchTag } from "@/lib/batch-tags";

const PLACEHOLDER_PREFIX = "NO-PH-";
const IMPORT_BATCH_SIZE = 50;
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

/** Stable placeholder when Excel has no usable contact number. */
function placeholderContact(partyName: string, suffix?: string | number): string {
  const slug =
    normalizeNameKey(partyName).replace(/[^a-z0-9]/g, "").slice(0, 32) || "unknown";
  return `${PLACEHOLDER_PREFIX}${slug}${suffix ? `-${suffix}` : ""}`;
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
  if (!Number.isFinite(balance)) return null;
  return Math.max(0, balance);
}

export async function importCustomersFromExcel(buffer: Buffer, shopId: string, options: { batchTag?: string | null } = {}): Promise<ImportSummary> {
  const startedAt = Date.now();
  const batchTag = normalizeBatchTag(options.batchTag);
  try {
    logger.info("customer_import_parse_start", {
      shopId,
      batchTag,
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
        skippedZeroBalance: 0,
        batchTag,
        errors: [{ row: 0, message: "No data found in Excel file" }],
      };
    }

    let created = 0;
    let duplicateNameCreated = 0;
    let updated = 0;
    let skipped = 0;
    let skippedZeroBalance = 0;
    const errors: ImportSummary["errors"] = [];
    const validRows: Array<{
      rowNumber: number;
      partyName: string;
      nameKey: string;
      contactNumber: string | null;
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
          message: "Valid customer name and outstanding balance are required",
        });
        continue;
      }

      const { partyName, contactNumber, outstandingBalance } = parsed;
      validRows.push({ rowNumber, partyName, nameKey: normalizeNameKey(partyName), contactNumber, outstandingBalance });
    }

    logger.info("customer_import_validation_complete", {
      shopId,
      parsedRows: rows.length,
      validRows: validRows.length,
      skippedRows: skipped,
      durationMs: Date.now() - startedAt,
      memoryMb: memorySnapshotMb(),
    });

    const existingLookup = await loadExistingCustomerLookup(shopId);
    logger.info("customer_import_existing_name_lookup_complete", {
      shopId,
      lookupNames: existingLookup.byName.size,
      existingCustomers: existingLookup.contactNumbers.size,
      batchTag,
      durationMs: Date.now() - startedAt,
      memoryMb: memorySnapshotMb(),
    });

    const reservedContacts = new Set<string>();
    const batches = chunk(validRows, IMPORT_BATCH_SIZE);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batchStartedAt = Date.now();
      const batch = batches[batchIndex];
      const updates: Array<(typeof batch)[number] & { customerId: string; assignBatchTag: boolean }> = [];
      const creates: Array<(typeof batch)[number] & { contactNumber: string; duplicateName: boolean }> = [];

      for (const row of batch) {
        const match = findExistingLedgerMatch(existingLookup, row.nameKey, row.contactNumber, batchTag);
        if (match) {
          updates.push({ ...row, customerId: match.id, assignBatchTag: Boolean(batchTag && !match.batchTag) });
          continue;
        }
        if (row.outstandingBalance <= 0) {
          skipped++;
          skippedZeroBalance++;
          continue;
        }

        const contactNumber = reserveContactNumber(row.partyName, row.rowNumber, row.contactNumber, reservedContacts);
        const existingNameCount = existingLookup.byName.get(row.nameKey)?.length ?? 0;
        creates.push({ ...row, contactNumber, duplicateName: existingNameCount > 0 });
      }
      logger.info("customer_import_batch_start", {
        shopId,
        batch: batchIndex + 1,
        totalBatches: batches.length,
        rows: batch.length,
        updates: updates.length,
        creates: creates.length,
        duplicateNameCreates: creates.filter((row) => row.duplicateName).length,
      });

      try {
        const updateResults = await Promise.allSettled(
          updates.map((row) =>
            prisma.customer.update({
              where: { id: row.customerId },
              data: {
                outstandingBalance: row.outstandingBalance,
                status: row.outstandingBalance <= 0 ? "CLEARED" : "PENDING",
                nextFollowupDate: row.outstandingBalance <= 0 ? null : undefined,
                ...(row.assignBatchTag ? { batchTag } : {}),
              },
            })
          )
        );
        const createResults = await Promise.allSettled(
          creates.map((row) =>
            prisma.customer.create({
              data: {
                shopId,
                partyName: row.partyName,
                contactNumber: row.contactNumber,
                batchTag,
                outstandingBalance: row.outstandingBalance,
                status: row.outstandingBalance === 0 ? "CLEARED" : "PENDING",
              },
            })
          )
        );

        const batchUpdated = countFulfilled(updateResults);
        const batchCreated = countFulfilled(createResults);
        const failedUpdates = updateResults.length - batchUpdated;
        const failedCreates = createResults.length - batchCreated;
        const batchDuplicateNameCreated = creates
          .filter((row, index) => row.duplicateName && createResults[index].status === "fulfilled")
          .length;

        updateResults.forEach((result, index) => {
          if (result.status === "fulfilled" && updates[index].assignBatchTag) {
            updateCustomerLookupTag(existingLookup, updates[index].customerId, batchTag);
          }
        });
        createResults.forEach((result) => {
          if (result.status === "fulfilled") {
            addCustomerToLookup(existingLookup, {
              id: result.value.id,
              partyName: result.value.partyName,
              contactNumber: result.value.contactNumber,
              batchTag: result.value.batchTag,
            });
          }
        });

        updateResults.forEach((result, index) => {
          if (result.status === "rejected") {
            addImportError(errors, { row: updates[index].rowNumber, message: importErrorMessage(result.reason) });
          }
        });
        createResults.forEach((result, index) => {
          if (result.status === "rejected") {
            addImportError(errors, { row: creates[index].rowNumber, message: importErrorMessage(result.reason) });
          }
        });

        created += batchCreated;
        duplicateNameCreated += batchDuplicateNameCreated;
        updated += batchUpdated;
        skipped += failedUpdates + failedCreates;
        logger.info("customer_import_batch_complete", {
          shopId,
          batch: batchIndex + 1,
          totalBatches: batches.length,
          rows: batch.length,
          created: batchCreated,
          duplicateNameCreated: batchDuplicateNameCreated,
          updated: batchUpdated,
          failedRows: failedUpdates + failedCreates,
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
      duplicateNameCreated,
      updated,
      skipped,
      skippedZeroBalance,
      errors: errors.length,
      durationMs: Date.now() - startedAt,
      memoryMb: memorySnapshotMb(),
    });

    return {
      totalProcessed: rows.length,
      created,
      duplicateNameCreated,
      updated,
      skipped,
      skippedZeroBalance,
      errors,
      batchTag,
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
      duplicateNameCreated: 0,
      updated: 0,
      skipped: 0,
      skippedZeroBalance: 0,
      batchTag,
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

function countFulfilled<T>(results: PromiseSettledResult<T>[]) {
  return results.filter((result) => result.status === "fulfilled").length;
}

function importErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function loadExistingCustomerLookup(shopId: string) {
  const customers = await prisma.customer.findMany({
    where: { shopId },
    select: { id: true, partyName: true, contactNumber: true, batchTag: true },
  });
  const byName = new Map<string, Array<{ id: string; batchTag: string | null; contactNumber: string }>>();
  const byContact = new Map<string, Array<{ id: string; batchTag: string | null; nameKey: string }>>();
  const contactNumbers = new Set<string>();
  customers.forEach((customer) => {
    const key = normalizeNameKey(customer.partyName);
    const matches = byName.get(key) ?? [];
    matches.push({ id: customer.id, batchTag: customer.batchTag, contactNumber: customer.contactNumber });
    byName.set(key, matches);
    const contactMatches = byContact.get(customer.contactNumber) ?? [];
    contactMatches.push({ id: customer.id, batchTag: customer.batchTag, nameKey: key });
    byContact.set(customer.contactNumber, contactMatches);
    contactNumbers.add(customer.contactNumber);
  });
  return { byName, byContact, contactNumbers };
}

function findExistingLedgerMatch(
  lookup: Awaited<ReturnType<typeof loadExistingCustomerLookup>>,
  nameKey: string,
  contactNumber: string | null,
  batchTag: string | null,
) {
  const targetTagKey = batchTagKey(batchTag);
  const nameMatches = lookup.byName.get(nameKey) ?? [];
  const contactMatches = contactNumber ? lookup.byContact.get(contactNumber) ?? [] : [];
  const candidates = [
    ...nameMatches,
    ...contactMatches.map((match) => ({ id: match.id, batchTag: match.batchTag, contactNumber: contactNumber ?? "" })),
  ].filter((candidate, index, all) => all.findIndex((item) => item.id === candidate.id) === index);

  const sameTag = candidates.find((candidate) => batchTagKey(candidate.batchTag) === targetTagKey);
  if (sameTag) return sameTag;

  if (batchTag) {
    const untagged = candidates.filter((candidate) => !candidate.batchTag);
    if (untagged.length === 1) return untagged[0];
    logger.info("customer_import_separate_ledger_required", {
      nameKey,
      contactNumber,
      uploadedBatchTag: batchTag,
      candidateTags: candidates.map((candidate) => candidate.batchTag ?? null),
    });
    return null;
  }

  return candidates.length === 1 ? candidates[0] : null;
}

function addCustomerToLookup(
  lookup: Awaited<ReturnType<typeof loadExistingCustomerLookup>>,
  customer: { id: string; partyName: string; contactNumber: string; batchTag: string | null },
) {
  const key = normalizeNameKey(customer.partyName);
  const nameMatches = lookup.byName.get(key) ?? [];
  nameMatches.push({ id: customer.id, batchTag: customer.batchTag, contactNumber: customer.contactNumber });
  lookup.byName.set(key, nameMatches);

  const contactMatches = lookup.byContact.get(customer.contactNumber) ?? [];
  contactMatches.push({ id: customer.id, batchTag: customer.batchTag, nameKey: key });
  lookup.byContact.set(customer.contactNumber, contactMatches);
  lookup.contactNumbers.add(customer.contactNumber);
}

function updateCustomerLookupTag(
  lookup: Awaited<ReturnType<typeof loadExistingCustomerLookup>>,
  customerId: string,
  batchTag: string | null,
) {
  for (const matches of lookup.byName.values()) {
    const match = matches.find((item) => item.id === customerId);
    if (match) match.batchTag = batchTag;
  }
  for (const matches of lookup.byContact.values()) {
    const match = matches.find((item) => item.id === customerId);
    if (match) match.batchTag = batchTag;
  }
}

function reserveContactNumber(partyName: string, rowNumber: number, contactNumber: string | null, reservedContacts: Set<string>) {
  if (contactNumber && !reservedContacts.has(contactNumber)) {
    reservedContacts.add(contactNumber);
    return contactNumber;
  }

  let suffix = rowNumber;
  let placeholder = placeholderContact(partyName, suffix);
  while (reservedContacts.has(placeholder)) {
    suffix++;
    placeholder = placeholderContact(partyName, suffix);
  }
  reservedContacts.add(placeholder);
  return placeholder;
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
  contactNumber: string | null;
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
  const contactNumber = parseContact(contactValue || "");

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
