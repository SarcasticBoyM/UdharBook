-- UdharBook production upgrade: customer statuses, follow-up priority,
-- payments, notes, activity logging, and password reset tokens.

CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'PENDING', 'HIGH_RISK', 'CLEARED');
CREATE TYPE "FollowUpPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

ALTER TABLE "Customer"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "CustomerStatus"
  USING (
    CASE "status"::text
      WHEN 'PAID' THEN 'CLEARED'
      WHEN 'NOT_REACHABLE' THEN 'HIGH_RISK'
      WHEN 'CONTACTED' THEN 'ACTIVE'
      WHEN 'PAYMENT_PROMISED' THEN 'ACTIVE'
      ELSE 'PENDING'
    END
  )::"CustomerStatus",
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "StatusHistory"
  ALTER COLUMN "fromStatus" TYPE "CustomerStatus"
  USING (
    CASE "fromStatus"::text
      WHEN 'PAID' THEN 'CLEARED'
      WHEN 'NOT_REACHABLE' THEN 'HIGH_RISK'
      WHEN 'CONTACTED' THEN 'ACTIVE'
      WHEN 'PAYMENT_PROMISED' THEN 'ACTIVE'
      WHEN 'PENDING' THEN 'PENDING'
      ELSE NULL
    END
  )::"CustomerStatus",
  ALTER COLUMN "toStatus" TYPE "CustomerStatus"
  USING (
    CASE "toStatus"::text
      WHEN 'PAID' THEN 'CLEARED'
      WHEN 'NOT_REACHABLE' THEN 'HIGH_RISK'
      WHEN 'CONTACTED' THEN 'ACTIVE'
      WHEN 'PAYMENT_PROMISED' THEN 'ACTIVE'
      ELSE 'PENDING'
    END
  )::"CustomerStatus";

ALTER TABLE "FollowUp" ADD COLUMN "priority" "FollowUpPriority" NOT NULL DEFAULT 'MEDIUM';

CREATE TABLE "PaymentEntry" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "method" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerNote" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActivityLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "customerId" TEXT,
  "action" TEXT NOT NULL,
  "details" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "Customer_partyName_idx" ON "Customer"("partyName");
CREATE INDEX "Customer_createdAt_idx" ON "Customer"("createdAt");
CREATE INDEX "FollowUp_customerId_followupDate_idx" ON "FollowUp"("customerId", "followupDate");
CREATE INDEX "FollowUp_nextFollowupDate_idx" ON "FollowUp"("nextFollowupDate");
CREATE INDEX "FollowUp_priority_idx" ON "FollowUp"("priority");
CREATE INDEX "StatusHistory_customerId_createdAt_idx" ON "StatusHistory"("customerId", "createdAt");
CREATE INDEX "PaymentEntry_customerId_paidAt_idx" ON "PaymentEntry"("customerId", "paidAt");
CREATE INDEX "PaymentEntry_paidAt_idx" ON "PaymentEntry"("paidAt");
CREATE INDEX "CustomerNote_customerId_createdAt_idx" ON "CustomerNote"("customerId", "createdAt");
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog"("userId");
CREATE INDEX "ActivityLog_customerId_idx" ON "ActivityLog"("customerId");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

ALTER TABLE "PaymentEntry" ADD CONSTRAINT "PaymentEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentEntry" ADD CONSTRAINT "PaymentEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
