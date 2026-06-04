-- CreateEnum
CREATE TYPE "StaffTrackingStatus" AS ENUM ('ACTIVE', 'ON_VISIT', 'IDLE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "StaffVisitStatus" AS ENUM ('CHECKED_IN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "Customer" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "Customer" ADD COLUMN "geoAddress" TEXT;

-- CreateTable
CREATE TABLE "StaffLocation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "status" "StaffTrackingStatus" NOT NULL DEFAULT 'ACTIVE',
    "battery" DOUBLE PRECISION,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "activeMinutes" INTEGER NOT NULL DEFAULT 0,
    "idleMinutes" INTEGER NOT NULL DEFAULT 0,
    "travelKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffVisit" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "StaffVisitStatus" NOT NULL DEFAULT 'CHECKED_IN',
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutAt" TIMESTAMP(3),
    "checkInLat" DOUBLE PRECISION NOT NULL,
    "checkInLng" DOUBLE PRECISION NOT NULL,
    "checkOutLat" DOUBLE PRECISION,
    "checkOutLng" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "distanceMeters" DOUBLE PRECISION,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "outsideWarning" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "result" TEXT,
    "recoveryAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "travelKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitPhoto" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileType" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteHistory" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "routeDate" TIMESTAMP(3) NOT NULL,
    "totalKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalVisits" INTEGER NOT NULL DEFAULT 0,
    "productiveHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "path" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffLocation_shopId_createdAt_idx" ON "StaffLocation"("shopId", "createdAt");
CREATE INDEX "StaffLocation_staffId_createdAt_idx" ON "StaffLocation"("staffId", "createdAt");
CREATE INDEX "StaffLocation_shopId_staffId_createdAt_idx" ON "StaffLocation"("shopId", "staffId", "createdAt");
CREATE INDEX "StaffLocation_shopId_status_idx" ON "StaffLocation"("shopId", "status");
CREATE UNIQUE INDEX "Attendance_staffId_workDate_key" ON "Attendance"("staffId", "workDate");
CREATE INDEX "Attendance_shopId_workDate_idx" ON "Attendance"("shopId", "workDate");
CREATE INDEX "Attendance_shopId_status_idx" ON "Attendance"("shopId", "status");
CREATE INDEX "StaffVisit_shopId_checkInAt_idx" ON "StaffVisit"("shopId", "checkInAt");
CREATE INDEX "StaffVisit_staffId_checkInAt_idx" ON "StaffVisit"("staffId", "checkInAt");
CREATE INDEX "StaffVisit_customerId_checkInAt_idx" ON "StaffVisit"("customerId", "checkInAt");
CREATE INDEX "StaffVisit_shopId_status_idx" ON "StaffVisit"("shopId", "status");
CREATE INDEX "VisitPhoto_shopId_createdAt_idx" ON "VisitPhoto"("shopId", "createdAt");
CREATE INDEX "VisitPhoto_visitId_idx" ON "VisitPhoto"("visitId");
CREATE UNIQUE INDEX "RouteHistory_staffId_routeDate_key" ON "RouteHistory"("staffId", "routeDate");
CREATE INDEX "RouteHistory_shopId_routeDate_idx" ON "RouteHistory"("shopId", "routeDate");

-- AddForeignKey
ALTER TABLE "StaffLocation" ADD CONSTRAINT "StaffLocation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffLocation" ADD CONSTRAINT "StaffLocation_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffVisit" ADD CONSTRAINT "StaffVisit_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffVisit" ADD CONSTRAINT "StaffVisit_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffVisit" ADD CONSTRAINT "StaffVisit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitPhoto" ADD CONSTRAINT "VisitPhoto_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitPhoto" ADD CONSTRAINT "VisitPhoto_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "StaffVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitPhoto" ADD CONSTRAINT "VisitPhoto_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteHistory" ADD CONSTRAINT "RouteHistory_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RouteHistory" ADD CONSTRAINT "RouteHistory_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
