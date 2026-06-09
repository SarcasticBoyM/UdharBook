ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "batchTag" TEXT;

DROP INDEX IF EXISTS "Customer_shopId_contactNumber_key";

CREATE INDEX IF NOT EXISTS "Customer_shopId_batchTag_idx" ON "Customer"("shopId", "batchTag");
CREATE INDEX IF NOT EXISTS "Customer_shopId_batchTag_partyName_idx" ON "Customer"("shopId", "batchTag", "partyName");
CREATE INDEX IF NOT EXISTS "Customer_shopId_batchTag_contactNumber_idx" ON "Customer"("shopId", "batchTag", "contactNumber");
