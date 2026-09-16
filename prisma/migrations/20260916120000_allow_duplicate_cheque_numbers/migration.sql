-- Cheque numbers are operational data, not identifiers. Multiple cheque records
-- may legitimately share a number and bank; the Cheque.id remains unique.
DROP INDEX IF EXISTS "Cheque_shopId_chequeNumber_bankName_key";

-- Preserve lookup performance without enforcing uniqueness.
CREATE INDEX IF NOT EXISTS "Cheque_shopId_chequeNumber_bankName_idx"
ON "Cheque"("shopId", "chequeNumber", "bankName");
