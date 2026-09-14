-- Enum values must be committed in a migration before they are used by a
-- later migration (for example, as a column default) during shadow replay.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'ORDER_RECEIVED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DISPATCHED';
