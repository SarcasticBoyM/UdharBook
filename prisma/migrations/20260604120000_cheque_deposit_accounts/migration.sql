CREATE TABLE "ChequeDepositAccount" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "lastFourDigits" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ChequeDepositAccount_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ChequeDepositAccount"
ADD CONSTRAINT "ChequeDepositAccount_shopId_fkey"
FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Cheque"
ADD COLUMN "depositedAccountId" TEXT;

ALTER TABLE "Cheque"
ADD CONSTRAINT "Cheque_depositedAccountId_fkey"
FOREIGN KEY ("depositedAccountId") REFERENCES "ChequeDepositAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ChequeDepositAccount_shopId_isActive_idx" ON "ChequeDepositAccount"("shopId", "isActive");
CREATE INDEX "ChequeDepositAccount_shopId_bankName_idx" ON "ChequeDepositAccount"("shopId", "bankName");
CREATE INDEX "Cheque_shopId_depositedAccountId_idx" ON "Cheque"("shopId", "depositedAccountId");
