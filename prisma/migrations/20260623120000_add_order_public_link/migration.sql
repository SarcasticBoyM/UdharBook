-- CreateTable
CREATE TABLE "OrderPublicLink" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "regeneratedAt" TIMESTAMP(3),

    CONSTRAINT "OrderPublicLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderPublicLink_shopId_key" ON "OrderPublicLink"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPublicLink_token_key" ON "OrderPublicLink"("token");

-- CreateIndex
CREATE INDEX "OrderPublicLink_shopId_idx" ON "OrderPublicLink"("shopId");

-- AddForeignKey
ALTER TABLE "OrderPublicLink" ADD CONSTRAINT "OrderPublicLink_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
