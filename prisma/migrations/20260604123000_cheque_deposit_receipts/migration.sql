ALTER TABLE "Cheque"
ADD COLUMN "depositReceiptUrl" TEXT,
ADD COLUMN "depositReceiptType" TEXT,
ADD COLUMN "depositReceiptUploadedAt" TIMESTAMP(3),
ADD COLUMN "depositReceiptUploadedById" TEXT;

ALTER TABLE "Cheque"
ADD CONSTRAINT "Cheque_depositReceiptUploadedById_fkey"
FOREIGN KEY ("depositReceiptUploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Cheque_depositReceiptUploadedById_idx" ON "Cheque"("depositReceiptUploadedById");
