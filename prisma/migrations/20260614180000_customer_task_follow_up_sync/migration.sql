ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "linkedFollowUpId" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Task"
    WHERE "linkedFollowUpId" IS NOT NULL
    GROUP BY "linkedFollowUpId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create Task_linkedFollowUpId_key: duplicate non-null linkedFollowUpId values exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Task"
    WHERE "idempotencyKey" IS NOT NULL
    GROUP BY "idempotencyKey"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create Task_idempotencyKey_key: duplicate non-null idempotencyKey values exist.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "Task_linkedFollowUpId_key"
  ON "Task"("linkedFollowUpId");

CREATE UNIQUE INDEX IF NOT EXISTS "Task_idempotencyKey_key"
  ON "Task"("idempotencyKey");

CREATE INDEX IF NOT EXISTS "Task_shopId_linkedFollowUpId_idx"
  ON "Task"("shopId", "linkedFollowUpId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"Task"'::regclass
      AND conname = 'Task_linkedFollowUpId_fkey'
  ) THEN
    ALTER TABLE "Task"
      ADD CONSTRAINT "Task_linkedFollowUpId_fkey"
      FOREIGN KEY ("linkedFollowUpId") REFERENCES "FollowUp"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
