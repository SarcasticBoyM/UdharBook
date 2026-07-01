-- Some production databases already contain OrderPublicLink from an earlier
-- manual/schema state. Preserve that table and all existing link data.
CREATE TABLE IF NOT EXISTS "OrderPublicLink" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "regeneratedAt" TIMESTAMP(3),

    CONSTRAINT "OrderPublicLink_pkey" PRIMARY KEY ("id")
);

-- Reconcile missing columns without replacing or rewriting existing rows.
-- Required identifiers intentionally have no fabricated fallback; PostgreSQL
-- will stop safely if populated legacy rows cannot satisfy them.
ALTER TABLE "OrderPublicLink"
    ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL,
    ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL,
    ADD COLUMN IF NOT EXISTS "token" TEXT NOT NULL,
    ADD COLUMN IF NOT EXISTS "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "regeneratedAt" TIMESTAMP(3);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"OrderPublicLink"'::regclass
          AND contype = 'p'
    ) THEN
        ALTER TABLE "OrderPublicLink"
            ADD CONSTRAINT "OrderPublicLink_pkey" PRIMARY KEY ("id");
    END IF;
END
$$;

-- Unique index creation deliberately fails on conflicting legacy values
-- instead of deleting or silently changing production links.
CREATE UNIQUE INDEX IF NOT EXISTS "OrderPublicLink_shopId_key" ON "OrderPublicLink"("shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrderPublicLink_token_key" ON "OrderPublicLink"("token");
CREATE INDEX IF NOT EXISTS "OrderPublicLink_shopId_idx" ON "OrderPublicLink"("shopId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"OrderPublicLink"'::regclass
          AND conname = 'OrderPublicLink_shopId_fkey'
    ) THEN
        ALTER TABLE "OrderPublicLink"
            ADD CONSTRAINT "OrderPublicLink_shopId_fkey"
            FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;
