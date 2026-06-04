ALTER TABLE "Cheque" ADD COLUMN IF NOT EXISTS "staffVisitId" TEXT;
ALTER TABLE "Cheque" ADD COLUMN IF NOT EXISTS "collectionLatitude" DOUBLE PRECISION;
ALTER TABLE "Cheque" ADD COLUMN IF NOT EXISTS "collectionLongitude" DOUBLE PRECISION;
ALTER TABLE "Cheque" ADD COLUMN IF NOT EXISTS "collectionAccuracy" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "Cheque_staffVisitId_idx" ON "Cheque"("staffVisitId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Cheque_staffVisitId_fkey'
  ) THEN
    ALTER TABLE "Cheque"
      ADD CONSTRAINT "Cheque_staffVisitId_fkey"
      FOREIGN KEY ("staffVisitId") REFERENCES "StaffVisit"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
