-- UdharBook multi-shop tenant isolation, follow-up scheduling, and activity timestamps.

CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

CREATE TABLE "Shop" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "ownerName" TEXT NOT NULL,
  "gstNumber" TEXT,
  "mobileNumber" TEXT,
  "address" TEXT,
  "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Shop" ("id", "name", "ownerName", "subscriptionStatus")
VALUES ('default-shop', 'UdharBook Default Shop', 'Owner', 'ACTIVE')
ON CONFLICT ("id") DO NOTHING;

CREATE TYPE "UserRole_new" AS ENUM ('SUPER_ADMIN', 'SHOP_ADMIN', 'STAFF');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "UserRole_new"
  USING (
    CASE "role"::text
      WHEN 'ADMIN' THEN 'SHOP_ADMIN'
      WHEN 'SUPER_ADMIN' THEN 'SUPER_ADMIN'
      ELSE 'STAFF'
    END
  )::"UserRole_new";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'STAFF';
DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";

ALTER TYPE "FollowUpStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "FollowUpStatus" ADD VALUE IF NOT EXISTS 'MISSED';
ALTER TYPE "FollowUpStatus" ADD VALUE IF NOT EXISTS 'RESCHEDULED';

ALTER TABLE "User" ADD COLUMN "shopId" TEXT;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
UPDATE "User" SET "shopId" = 'default-shop' WHERE "shopId" IS NULL AND "role" <> 'SUPER_ADMIN';

ALTER TABLE "Customer" ADD COLUMN "shopId" TEXT;
UPDATE "Customer" SET "shopId" = 'default-shop' WHERE "shopId" IS NULL;
ALTER TABLE "Customer" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "FollowUp" ADD COLUMN "shopId" TEXT;
ALTER TABLE "FollowUp" ADD COLUMN "scheduledAt" TIMESTAMP(3);
ALTER TABLE "FollowUp" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "FollowUp" ADD COLUMN "remindedAt" TIMESTAMP(3);
ALTER TABLE "FollowUp" ADD COLUMN "reminderNotes" TEXT;
ALTER TABLE "FollowUp" ADD COLUMN "customerResponse" TEXT;
UPDATE "FollowUp" f SET "shopId" = c."shopId" FROM "Customer" c WHERE f."customerId" = c."id";
UPDATE "FollowUp" SET "shopId" = 'default-shop' WHERE "shopId" IS NULL;
ALTER TABLE "FollowUp" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "PaymentEntry" ADD COLUMN "shopId" TEXT;
UPDATE "PaymentEntry" p SET "shopId" = c."shopId" FROM "Customer" c WHERE p."customerId" = c."id";
UPDATE "PaymentEntry" SET "shopId" = 'default-shop' WHERE "shopId" IS NULL;
ALTER TABLE "PaymentEntry" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "CustomerNote" ADD COLUMN "shopId" TEXT;
UPDATE "CustomerNote" n SET "shopId" = c."shopId" FROM "Customer" c WHERE n."customerId" = c."id";
UPDATE "CustomerNote" SET "shopId" = 'default-shop' WHERE "shopId" IS NULL;
ALTER TABLE "CustomerNote" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "ActivityLog" ADD COLUMN "shopId" TEXT;
UPDATE "ActivityLog" a SET "shopId" = c."shopId" FROM "Customer" c WHERE a."customerId" = c."id";
UPDATE "ActivityLog" a SET "shopId" = u."shopId" FROM "User" u WHERE a."shopId" IS NULL AND a."userId" = u."id";

ALTER TABLE "User" ADD CONSTRAINT "User_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentEntry" ADD CONSTRAINT "PaymentEntry_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "Customer_contactNumber_key";
CREATE UNIQUE INDEX "Customer_shopId_contactNumber_key" ON "Customer"("shopId", "contactNumber");
CREATE INDEX "Shop_subscriptionStatus_idx" ON "Shop"("subscriptionStatus");
CREATE INDEX "Shop_createdAt_idx" ON "Shop"("createdAt");
CREATE INDEX "User_shopId_idx" ON "User"("shopId");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "Customer_shopId_nextFollowupDate_idx" ON "Customer"("shopId", "nextFollowupDate");
CREATE INDEX "Customer_shopId_status_idx" ON "Customer"("shopId", "status");
CREATE INDEX "FollowUp_scheduledAt_idx" ON "FollowUp"("scheduledAt");
CREATE INDEX "FollowUp_shopId_scheduledAt_idx" ON "FollowUp"("shopId", "scheduledAt");
CREATE INDEX "FollowUp_shopId_status_idx" ON "FollowUp"("shopId", "status");
CREATE INDEX "PaymentEntry_shopId_paidAt_idx" ON "PaymentEntry"("shopId", "paidAt");
CREATE INDEX "CustomerNote_shopId_createdAt_idx" ON "CustomerNote"("shopId", "createdAt");
CREATE INDEX "ActivityLog_shopId_createdAt_idx" ON "ActivityLog"("shopId", "createdAt");
