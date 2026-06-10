DROP INDEX IF EXISTS "Customer_shopId_contactNumber_key";

CREATE INDEX IF NOT EXISTS "Customer_shopId_contactNumber_idx" ON "Customer"("shopId", "contactNumber");
CREATE INDEX IF NOT EXISTS "Customer_shopId_batchTag_contactNumber_idx" ON "Customer"("shopId", "batchTag", "contactNumber");
