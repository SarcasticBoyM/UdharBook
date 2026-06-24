-- AlterTable
ALTER TABLE "DriverTrip" ADD COLUMN "totalDistanceMeters" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "DriverTrip" ADD COLUMN "movingDurationSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DriverTrip" ADD COLUMN "idleDurationSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DriverTrip" ADD COLUMN "pointCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DriverTrip" ADD COLUMN "maxSpeedKmph" DOUBLE PRECISION;
ALTER TABLE "DriverTrip" ADD COLUMN "avgSpeedKmph" DOUBLE PRECISION;
ALTER TABLE "DriverTrip" ADD COLUMN "lastMovementAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DriverLocationPoint" ADD COLUMN "distanceFromPreviousMeters" DOUBLE PRECISION;
ALTER TABLE "DriverLocationPoint" ADD COLUMN "calculatedSpeedKmph" DOUBLE PRECISION;
ALTER TABLE "DriverLocationPoint" ADD COLUMN "isDistanceIgnored" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DriverLocationPoint" ADD COLUMN "ignoreReason" TEXT;
