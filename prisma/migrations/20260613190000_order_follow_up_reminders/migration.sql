ALTER TABLE "FollowUp"
  ADD COLUMN IF NOT EXISTS "assignedToId" TEXT,
  ADD COLUMN IF NOT EXISTS "orderId" TEXT,
  ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowUp_assignedToId_fkey') THEN
    ALTER TABLE "FollowUp"
      ADD CONSTRAINT "FollowUp_assignedToId_fkey"
      FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowUp_orderId_fkey') THEN
    ALTER TABLE "FollowUp"
      ADD CONSTRAINT "FollowUp_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "FollowUp_order_reminder_due_idx"
  ON "FollowUp"("shopId", "followUpType", "reminderEnabled", "reminderSentAt", "nextFollowUpDateTime");
CREATE INDEX IF NOT EXISTS "FollowUp_shopId_assignedToId_nextFollowUpDateTime_idx"
  ON "FollowUp"("shopId", "assignedToId", "nextFollowUpDateTime");
CREATE INDEX IF NOT EXISTS "FollowUp_orderId_idx" ON "FollowUp"("orderId");
CREATE INDEX IF NOT EXISTS "FollowUp_supersededAt_idx" ON "FollowUp"("supersededAt");
CREATE INDEX IF NOT EXISTS "FollowUp_cancelledAt_idx" ON "FollowUp"("cancelledAt");
