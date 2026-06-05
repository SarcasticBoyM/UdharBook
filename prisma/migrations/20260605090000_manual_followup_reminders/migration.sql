ALTER TYPE "FollowUpStatus" ADD VALUE IF NOT EXISTS 'CALLBACK';
ALTER TYPE "FollowUpStatus" ADD VALUE IF NOT EXISTS 'FOLLOW_UP_REQUIRED';

ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "nextFollowUpDateTime" TIMESTAMP(3);
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "reminderEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "manualReminder" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "FollowUp_nextFollowUpDateTime_idx" ON "FollowUp"("nextFollowUpDateTime");
CREATE INDEX IF NOT EXISTS "FollowUp_shopId_manualReminder_reminderEnabled_reminderSentAt_idx" ON "FollowUp"("shopId", "manualReminder", "reminderEnabled", "reminderSentAt");
