CREATE TYPE "ChequeStatus" AS ENUM ('COLLECTED', 'PENDING_DEPOSIT', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'REPLACED', 'CANCELLED');
CREATE TYPE "ChequeActivityType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'REPLACED', 'CANCELLED', 'NOTE');

CREATE TABLE "Cheque" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "customerCode" TEXT,
  "chequeNumber" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "branch" TEXT,
  "chequeDate" TIMESTAMP(3) NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "accountHolderName" TEXT NOT NULL,
  "collectedById" TEXT NOT NULL,
  "collectionDateTime" TIMESTAMP(3) NOT NULL,
  "collectionNotes" TEXT,
  "frontImageUrl" TEXT,
  "backImageUrl" TEXT,
  "depositDateTime" TIMESTAMP(3),
  "depositBankAccount" TEXT,
  "depositSlipUrl" TEXT,
  "depositedById" TEXT,
  "status" "ChequeStatus" NOT NULL DEFAULT 'COLLECTED',
  "bounceReason" TEXT,
  "bouncedAt" TIMESTAMP(3),
  "clearedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "replacedByChequeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Cheque_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChequeActivity" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "chequeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "ChequeActivityType" NOT NULL,
  "fromStatus" "ChequeStatus",
  "toStatus" "ChequeStatus",
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChequeActivity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Cheque_shopId_chequeNumber_bankName_key" ON "Cheque"("shopId", "chequeNumber", "bankName");
CREATE INDEX "Cheque_shopId_status_idx" ON "Cheque"("shopId", "status");
CREATE INDEX "Cheque_shopId_chequeDate_idx" ON "Cheque"("shopId", "chequeDate");
CREATE INDEX "Cheque_shopId_collectionDateTime_idx" ON "Cheque"("shopId", "collectionDateTime");
CREATE INDEX "Cheque_shopId_depositDateTime_idx" ON "Cheque"("shopId", "depositDateTime");
CREATE INDEX "Cheque_customerId_createdAt_idx" ON "Cheque"("customerId", "createdAt");
CREATE INDEX "Cheque_collectedById_collectionDateTime_idx" ON "Cheque"("collectedById", "collectionDateTime");
CREATE INDEX "ChequeActivity_shopId_createdAt_idx" ON "ChequeActivity"("shopId", "createdAt");
CREATE INDEX "ChequeActivity_chequeId_createdAt_idx" ON "ChequeActivity"("chequeId", "createdAt");
CREATE INDEX "ChequeActivity_userId_createdAt_idx" ON "ChequeActivity"("userId", "createdAt");

ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_depositedById_fkey" FOREIGN KEY ("depositedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChequeActivity" ADD CONSTRAINT "ChequeActivity_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChequeActivity" ADD CONSTRAINT "ChequeActivity_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "Cheque"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChequeActivity" ADD CONSTRAINT "ChequeActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
