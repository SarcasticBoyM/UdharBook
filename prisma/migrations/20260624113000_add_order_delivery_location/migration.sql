-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryLocationText" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryLocationUrl" TEXT;
