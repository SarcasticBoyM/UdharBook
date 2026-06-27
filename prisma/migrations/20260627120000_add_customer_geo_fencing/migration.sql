ALTER TABLE "Customer"
ADD COLUMN IF NOT EXISTS "locationName" TEXT,
ADD COLUMN IF NOT EXISTS "googleMapsUrl" TEXT,
ADD COLUMN IF NOT EXISTS "geofenceRadiusM" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN IF NOT EXISTS "locationVerifiedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "locationUpdatedById" TEXT;

CREATE INDEX IF NOT EXISTS "Customer_locationUpdatedById_idx" ON "Customer"("locationUpdatedById");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Customer_locationUpdatedById_fkey'
  ) THEN
    ALTER TABLE "Customer"
    ADD CONSTRAINT "Customer_locationUpdatedById_fkey"
    FOREIGN KEY ("locationUpdatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "StaffVisit"
ADD COLUMN IF NOT EXISTS "geoFenceStatus" TEXT,
ADD COLUMN IF NOT EXISTS "geoFenceRadiusM" INTEGER,
ADD COLUMN IF NOT EXISTS "locationCapturedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "deviceInfo" TEXT,
ADD COLUMN IF NOT EXISTS "geoFenceOverrideReason" TEXT;
