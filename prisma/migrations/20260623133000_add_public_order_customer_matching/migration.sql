-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "customerId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "customerMatchStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN "submittedCustomerName" TEXT;
ALTER TABLE "Order" ADD COLUMN "submittedCustomerMobile" TEXT;
ALTER TABLE "Order" ADD COLUMN "submittedAddress" TEXT;
