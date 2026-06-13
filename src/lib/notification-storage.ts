import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const READY_CACHE_MS = 5 * 60 * 1000;

const requiredTables = ["Notification", "NotificationRetry"] as const;

const requiredColumns = {
  Notification: [
    "id",
    "shopId",
    "userId",
    "roleTarget",
    "targetType",
    "type",
    "title",
    "message",
    "entityType",
    "entityId",
    "actionUrl",
    "metadata",
    "idempotencyKey",
    "priority",
    "isRead",
    "readByUserIds",
    "deletedByUserIds",
    "createdAt",
  ],
  NotificationRetry: [
    "id",
    "shopId",
    "eventType",
    "entityType",
    "entityId",
    "targetUserId",
    "targetRole",
    "idempotencyKey",
    "payload",
    "retryCount",
    "maxRetries",
    "nextRetryAt",
    "lastError",
    "status",
    "createdAt",
    "updatedAt",
  ],
} as const;

const requiredIndexes = [
  "Notification_idempotencyKey_key",
  "Notification_shopId_type_entityType_entityId_idx",
  "Notification_shopId_createdAt_idx",
  "Notification_shopId_targetType_roleTarget_createdAt_idx",
  "Notification_shopId_userId_createdAt_idx",
  "Notification_shopId_isRead_createdAt_idx",
  "Notification_shopId_priority_createdAt_idx",
  "NotificationRetry_idempotencyKey_key",
  "NotificationRetry_shopId_status_nextRetryAt_idx",
  "NotificationRetry_status_nextRetryAt_idx",
  "NotificationRetry_shopId_eventType_entityType_entityId_idx",
] as const;

const requiredConstraints = [
  "Notification_pkey",
  "Notification_shopId_fkey",
  "Notification_userId_fkey",
  "NotificationRetry_pkey",
  "NotificationRetry_shopId_fkey",
  "NotificationRetry_targetUserId_fkey",
] as const;

const requiredEnums = {
  NotificationTargetType: ["SHOP", "ROLE", "USER"],
  NotificationPriority: ["CRITICAL", "IMPORTANT", "NORMAL"],
  NotificationRetryStatus: ["PENDING", "PROCESSING", "SENT", "FAILED"],
} as const;

export type NotificationStorageIssue = {
  kind: "TABLE" | "COLUMN" | "INDEX" | "CONSTRAINT" | "ENUM" | "QUERY";
  object: string;
  detail: string;
};

export type NotificationStorageReadiness = {
  ready: boolean;
  checkedAt: string;
  issues: NotificationStorageIssue[];
  prismaCode: string | null;
  failureReason: string | null;
};

let readyCache: { expiresAt: number; result: NotificationStorageReadiness } | null = null;

function prismaErrorCode(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  return null;
}

function failureReason(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

export async function checkNotificationStorage(options: { force?: boolean } = {}): Promise<NotificationStorageReadiness> {
  const now = Date.now();
  if (!options.force && readyCache && readyCache.expiresAt > now) return readyCache.result;

  try {
    const [tables, columns, indexes, constraints, enumValues] = await Promise.all([
      prisma.$queryRaw<Array<{ tableName: string }>>(Prisma.sql`
        SELECT table_name AS "tableName"
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('Notification', 'NotificationRetry')
      `),
      prisma.$queryRaw<Array<{ tableName: string; columnName: string }>>(Prisma.sql`
        SELECT table_name AS "tableName", column_name AS "columnName"
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('Notification', 'NotificationRetry')
      `),
      prisma.$queryRaw<Array<{ indexName: string }>>(Prisma.sql`
        SELECT indexname AS "indexName"
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename IN ('Notification', 'NotificationRetry')
      `),
      prisma.$queryRaw<Array<{ constraintName: string }>>(Prisma.sql`
        SELECT con.conname AS "constraintName"
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        WHERE ns.nspname = 'public'
          AND rel.relname IN ('Notification', 'NotificationRetry')
      `),
      prisma.$queryRaw<Array<{ enumName: string; enumValue: string }>>(Prisma.sql`
        SELECT typ.typname AS "enumName", enum.enumlabel AS "enumValue"
        FROM pg_type typ
        JOIN pg_enum enum ON enum.enumtypid = typ.oid
        JOIN pg_namespace ns ON ns.oid = typ.typnamespace
        WHERE ns.nspname = 'public'
          AND typ.typname IN ('NotificationTargetType', 'NotificationPriority', 'NotificationRetryStatus')
      `),
    ]);

    const issues: NotificationStorageIssue[] = [];
    const tableSet = new Set(tables.map((item) => item.tableName));
    const columnSet = new Set(columns.map((item) => `${item.tableName}.${item.columnName}`));
    const indexSet = new Set(indexes.map((item) => item.indexName));
    const constraintSet = new Set(constraints.map((item) => item.constraintName));
    const enumSet = new Set(enumValues.map((item) => `${item.enumName}.${item.enumValue}`));

    for (const table of requiredTables) {
      if (!tableSet.has(table)) {
        issues.push({ kind: "TABLE", object: table, detail: `Missing public."${table}" table` });
      }
    }
    for (const [table, tableColumns] of Object.entries(requiredColumns)) {
      for (const column of tableColumns) {
        if (!columnSet.has(`${table}.${column}`)) {
          issues.push({ kind: "COLUMN", object: `${table}.${column}`, detail: `Missing "${column}" column on public."${table}"` });
        }
      }
    }
    for (const index of requiredIndexes) {
      if (!indexSet.has(index)) {
        issues.push({ kind: "INDEX", object: index, detail: `Missing "${index}" index` });
      }
    }
    for (const constraint of requiredConstraints) {
      if (!constraintSet.has(constraint)) {
        issues.push({ kind: "CONSTRAINT", object: constraint, detail: `Missing "${constraint}" constraint` });
      }
    }
    for (const [enumName, values] of Object.entries(requiredEnums)) {
      for (const value of values) {
        if (!enumSet.has(`${enumName}.${value}`)) {
          issues.push({ kind: "ENUM", object: `${enumName}.${value}`, detail: `Missing ${enumName} value "${value}"` });
        }
      }
    }

    if (issues.length === 0) {
      await prisma.$transaction([
        prisma.notification.findFirst({
          select: {
            id: true,
            shopId: true,
            userId: true,
            roleTarget: true,
            targetType: true,
            type: true,
            title: true,
            message: true,
            entityType: true,
            entityId: true,
            actionUrl: true,
            metadata: true,
            idempotencyKey: true,
            priority: true,
            isRead: true,
            readByUserIds: true,
            deletedByUserIds: true,
            createdAt: true,
          },
        }),
        prisma.notificationRetry.findFirst({
          select: {
            id: true,
            shopId: true,
            eventType: true,
            entityType: true,
            entityId: true,
            targetUserId: true,
            targetRole: true,
            idempotencyKey: true,
            payload: true,
            retryCount: true,
            maxRetries: true,
            nextRetryAt: true,
            lastError: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ]);
    }

    const result: NotificationStorageReadiness = {
      ready: issues.length === 0,
      checkedAt: new Date().toISOString(),
      issues,
      prismaCode: null,
      failureReason: null,
    };
    if (result.ready) readyCache = { expiresAt: now + READY_CACHE_MS, result };
    return result;
  } catch (error) {
    return {
      ready: false,
      checkedAt: new Date().toISOString(),
      issues: [{
        kind: "QUERY",
        object: "notification-storage",
        detail: "Notification storage readiness query failed",
      }],
      prismaCode: prismaErrorCode(error),
      failureReason: failureReason(error),
    };
  }
}

export function notificationStorageAdminMessage(readiness: NotificationStorageReadiness) {
  const missing = readiness.issues.slice(0, 5).map((issue) => issue.object).join(", ");
  const code = readiness.prismaCode ? ` (${readiness.prismaCode})` : "";
  return missing
    ? `Notification storage is not ready${code}. Missing: ${missing}. Apply scripts/notification-safe-apply.sql.`
    : `Notification storage is not ready${code}. Apply scripts/notification-safe-apply.sql and retry.`;
}
