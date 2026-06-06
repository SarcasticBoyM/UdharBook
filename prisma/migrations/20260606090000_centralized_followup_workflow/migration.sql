ALTER TABLE "FollowUp"
  ADD COLUMN IF NOT EXISTS "sourceModule" TEXT NOT NULL DEFAULT 'TODAY_FOLLOWUPS',
  ADD COLUMN IF NOT EXISTS "followUpType" TEXT,
  ADD COLUMN IF NOT EXISTS "summary" TEXT,
  ADD COLUMN IF NOT EXISTS "detailedNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "recoveryAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "chequeId" TEXT,
  ADD COLUMN IF NOT EXISTS "chequeStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "promiseDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "visitId" TEXT,
  ADD COLUMN IF NOT EXISTS "activitySource" TEXT,
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

CREATE INDEX IF NOT EXISTS "FollowUp_shopId_sourceModule_idx" ON "FollowUp"("shopId", "sourceModule");
CREATE INDEX IF NOT EXISTS "FollowUp_shopId_activitySource_idx" ON "FollowUp"("shopId", "activitySource");
CREATE INDEX IF NOT EXISTS "FollowUp_chequeId_idx" ON "FollowUp"("chequeId");
CREATE INDEX IF NOT EXISTS "FollowUp_visitId_idx" ON "FollowUp"("visitId");
CREATE INDEX IF NOT EXISTS "FollowUp_promiseDate_idx" ON "FollowUp"("promiseDate");
