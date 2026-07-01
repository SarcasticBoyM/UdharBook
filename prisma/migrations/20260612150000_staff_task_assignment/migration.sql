-- Some production databases already have Task from an earlier manual/schema
-- state. Keep that table and all existing rows; create it only when absent.
CREATE TABLE IF NOT EXISTS "Task" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerId" TEXT,
    "assignedToId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "progressNotes" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "sourceEntityType" TEXT,
    "sourceEntityId" TEXT,
    "referenceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- Reconcile a pre-existing Task table without replacing or deleting data.
-- Required columns deliberately have no fabricated business-data fallback;
-- PostgreSQL will stop safely if legacy rows cannot satisfy a required field.
ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS "customerId" TEXT,
  ADD COLUMN IF NOT EXISTS "assignedToId" TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS "assignedById" TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS "taskType" TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS "title" TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "progressNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3) NOT NULL,
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sourceEntityType" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceEntityId" TEXT,
  ADD COLUMN IF NOT EXISTS "referenceUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"Task"'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE "Task" ADD CONSTRAINT "Task_pkey" PRIMARY KEY ("id");
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "Task_shopId_assignedToId_status_dueDate_idx" ON "Task"("shopId", "assignedToId", "status", "dueDate");
CREATE INDEX IF NOT EXISTS "Task_shopId_status_dueDate_idx" ON "Task"("shopId", "status", "dueDate");
CREATE INDEX IF NOT EXISTS "Task_shopId_assignedById_createdAt_idx" ON "Task"("shopId", "assignedById", "createdAt");
CREATE INDEX IF NOT EXISTS "Task_shopId_customerId_createdAt_idx" ON "Task"("shopId", "customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "Task_shopId_sourceEntityType_sourceEntityId_idx" ON "Task"("shopId", "sourceEntityType", "sourceEntityId");

-- Add each expected foreign key only when its Task constraint is missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"Task"'::regclass
      AND conname = 'Task_shopId_fkey'
  ) THEN
    ALTER TABLE "Task" ADD CONSTRAINT "Task_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"Task"'::regclass
      AND conname = 'Task_customerId_fkey'
  ) THEN
    ALTER TABLE "Task" ADD CONSTRAINT "Task_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"Task"'::regclass
      AND conname = 'Task_assignedToId_fkey'
  ) THEN
    ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToId_fkey"
      FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"Task"'::regclass
      AND conname = 'Task_assignedById_fkey'
  ) THEN
    ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedById_fkey"
      FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
