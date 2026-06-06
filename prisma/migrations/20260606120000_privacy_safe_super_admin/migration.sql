CREATE TABLE "SupportAccessGrant" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "superAdminId" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportAccessGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportAccessGrant_shopId_status_expiresAt_idx" ON "SupportAccessGrant"("shopId", "status", "expiresAt");
CREATE INDEX "SupportAccessGrant_superAdminId_status_expiresAt_idx" ON "SupportAccessGrant"("superAdminId", "status", "expiresAt");
CREATE INDEX "SupportAccessGrant_requestedById_createdAt_idx" ON "SupportAccessGrant"("requestedById", "createdAt");

ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_superAdminId_fkey" FOREIGN KEY ("superAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
