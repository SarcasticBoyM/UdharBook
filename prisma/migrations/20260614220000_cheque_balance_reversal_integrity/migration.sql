ALTER TABLE "Cheque"
  ADD COLUMN IF NOT EXISTS "balanceAppliedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "balanceAppliedAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "balanceAppliedCustomerId" TEXT,
  ADD COLUMN IF NOT EXISTS "balancePaymentEntryId" TEXT,
  ADD COLUMN IF NOT EXISTS "balanceReversedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "balanceReversalReason" TEXT,
  ADD COLUMN IF NOT EXISTS "balanceReversalTransactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "balanceReappliedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Cheque_balancePaymentEntryId_key"
  ON "Cheque"("balancePaymentEntryId");

CREATE UNIQUE INDEX IF NOT EXISTS "Cheque_balanceReversalTransactionId_key"
  ON "Cheque"("balanceReversalTransactionId");

CREATE INDEX IF NOT EXISTS "Cheque_shopId_balanceAppliedCustomerId_idx"
  ON "Cheque"("shopId", "balanceAppliedCustomerId");

CREATE INDEX IF NOT EXISTS "Cheque_shopId_balanceReversedAt_idx"
  ON "Cheque"("shopId", "balanceReversedAt");
