CREATE INDEX IF NOT EXISTS "Customer_shopId_outstandingBalance_idx" ON "Customer"("shopId", "outstandingBalance");
CREATE INDEX IF NOT EXISTS "Customer_shopId_outstandingBalance_nextFollowupDate_idx" ON "Customer"("shopId", "outstandingBalance", "nextFollowupDate");
CREATE INDEX IF NOT EXISTS "Customer_shopId_lastFollowupDate_idx" ON "Customer"("shopId", "lastFollowupDate");
CREATE INDEX IF NOT EXISTS "Customer_shopId_updatedAt_idx" ON "Customer"("shopId", "updatedAt");

CREATE INDEX IF NOT EXISTS "FollowUp_manual_reminder_due_idx" ON "FollowUp"("shopId", "manualReminder", "reminderEnabled", "reminderSentAt", "nextFollowUpDateTime");
CREATE INDEX IF NOT EXISTS "FollowUp_shopId_createdById_followupDate_idx" ON "FollowUp"("shopId", "createdById", "followupDate");
CREATE INDEX IF NOT EXISTS "FollowUp_shopId_customerId_followupDate_idx" ON "FollowUp"("shopId", "customerId", "followupDate");
CREATE INDEX IF NOT EXISTS "FollowUp_shopId_status_followupDate_idx" ON "FollowUp"("shopId", "status", "followupDate");

CREATE INDEX IF NOT EXISTS "Cheque_shopId_status_amount_idx" ON "Cheque"("shopId", "status", "amount");
CREATE INDEX IF NOT EXISTS "Cheque_shopId_status_collectionDateTime_idx" ON "Cheque"("shopId", "status", "collectionDateTime");
CREATE INDEX IF NOT EXISTS "Cheque_shopId_status_depositDateTime_idx" ON "Cheque"("shopId", "status", "depositDateTime");
CREATE INDEX IF NOT EXISTS "Cheque_shopId_depositedAccountId_status_idx" ON "Cheque"("shopId", "depositedAccountId", "status");
CREATE INDEX IF NOT EXISTS "Cheque_shopId_collectedById_collectionDateTime_idx" ON "Cheque"("shopId", "collectedById", "collectionDateTime");

CREATE INDEX IF NOT EXISTS "StaffVisit_shopId_staffId_status_checkInAt_idx" ON "StaffVisit"("shopId", "staffId", "status", "checkInAt");
CREATE INDEX IF NOT EXISTS "StaffVisit_shopId_customerId_checkInAt_idx" ON "StaffVisit"("shopId", "customerId", "checkInAt");

CREATE INDEX IF NOT EXISTS "StatusHistory_changedById_createdAt_idx" ON "StatusHistory"("changedById", "createdAt");
CREATE INDEX IF NOT EXISTS "ActivityLog_shopId_action_createdAt_idx" ON "ActivityLog"("shopId", "action", "createdAt");
