-- Some production databases already contain driver-distance columns from an
-- earlier manual/schema state. Preserve existing trip data and add only the
-- columns that are still missing.
ALTER TABLE "DriverTrip" ADD COLUMN IF NOT EXISTS "totalDistanceMeters" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "DriverTrip" ADD COLUMN IF NOT EXISTS "movingDurationSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DriverTrip" ADD COLUMN IF NOT EXISTS "idleDurationSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DriverTrip" ADD COLUMN IF NOT EXISTS "pointCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DriverTrip" ADD COLUMN IF NOT EXISTS "maxSpeedKmph" DOUBLE PRECISION;
ALTER TABLE "DriverTrip" ADD COLUMN IF NOT EXISTS "avgSpeedKmph" DOUBLE PRECISION;
ALTER TABLE "DriverTrip" ADD COLUMN IF NOT EXISTS "lastMovementAt" TIMESTAMP(3);

-- Location-point columns may have been deployed alongside DriverTrip manually.
ALTER TABLE "DriverLocationPoint" ADD COLUMN IF NOT EXISTS "distanceFromPreviousMeters" DOUBLE PRECISION;
ALTER TABLE "DriverLocationPoint" ADD COLUMN IF NOT EXISTS "calculatedSpeedKmph" DOUBLE PRECISION;
ALTER TABLE "DriverLocationPoint" ADD COLUMN IF NOT EXISTS "isDistanceIgnored" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DriverLocationPoint" ADD COLUMN IF NOT EXISTS "ignoreReason" TEXT;
