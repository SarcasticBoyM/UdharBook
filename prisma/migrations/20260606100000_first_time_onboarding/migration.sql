ALTER TABLE "Shop"
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "businessType" TEXT,
  ADD COLUMN IF NOT EXISTS "logoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "onboardingCompleted" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "setupStep" TEXT,
  ADD COLUMN IF NOT EXISTS "setupCompletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recoveryPreferences" JSONB;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "mobile" TEXT,
  ADD COLUMN IF NOT EXISTS "jobTitle" TEXT,
  ADD COLUMN IF NOT EXISTS "firstLoginAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Shop_onboardingCompleted_idx" ON "Shop"("onboardingCompleted");
CREATE INDEX IF NOT EXISTS "User_firstLoginAt_idx" ON "User"("firstLoginAt");
