ALTER TABLE "Cheque"
ADD COLUMN "micrCode" TEXT,
ADD COLUMN "ifscCode" TEXT,
ADD COLUMN "ocrRawText" TEXT,
ADD COLUMN "ocrExtractedData" JSONB,
ADD COLUMN "ocrConfidence" DOUBLE PRECISION,
ADD COLUMN "ocrEditedFields" JSONB;
