-- Allow public orders to be submitted before a customer match is confirmed.
-- DROP NOT NULL is safe to repeat and does not rewrite existing Order data.
ALTER TABLE "Order" ALTER COLUMN "customerId" DROP NOT NULL;

-- Some production databases already have customer matching columns from an
-- earlier manual/schema state. Preserve them and add only missing columns.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerMatchStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "submittedCustomerName" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "submittedCustomerMobile" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "submittedAddress" TEXT;
