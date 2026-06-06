ALTER TABLE "StaffVisit"
  ADD COLUMN IF NOT EXISTS "outcome" TEXT,
  ADD COLUMN IF NOT EXISTS "nextAction" TEXT,
  ADD COLUMN IF NOT EXISTS "nextVisitDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "orderAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "orderExpectedDelivery" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "orderProductCategory" TEXT,
  ADD COLUMN IF NOT EXISTS "orderPriority" TEXT,
  ADD COLUMN IF NOT EXISTS "leadArea" TEXT,
  ADD COLUMN IF NOT EXISTS "leadContactPerson" TEXT,
  ADD COLUMN IF NOT EXISTS "visitMetadata" JSONB;

CREATE INDEX IF NOT EXISTS "StaffVisit_shopId_visitType_idx" ON "StaffVisit"("shopId", "visitType");
CREATE INDEX IF NOT EXISTS "StaffVisit_shopId_status_visitType_idx" ON "StaffVisit"("shopId", "status", "visitType");
CREATE INDEX IF NOT EXISTS "StaffVisit_shopId_nextVisitDate_idx" ON "StaffVisit"("shopId", "nextVisitDate");
CREATE INDEX IF NOT EXISTS "StaffVisit_shopId_staffId_createdAt_idx" ON "StaffVisit"("shopId", "staffId", "createdAt");
