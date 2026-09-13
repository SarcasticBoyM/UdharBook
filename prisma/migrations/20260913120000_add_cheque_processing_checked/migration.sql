ALTER TABLE "Cheque"
ADD COLUMN "processingChecked" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Cheque_shopId_processingChecked_status_chequeDate_idx"
ON "Cheque"("shopId", "processingChecked", "status", "chequeDate");
