const DEFAULT_CONNECTION_LIMIT = "5";
const DEFAULT_POOL_TIMEOUT = "20";

export type DatabaseUrlInfo = {
  configured: boolean;
  host: string | null;
  port: string | null;
  isSupabase: boolean;
  isPooler: boolean;
  isLikelyTransactionPooler: boolean;
  hasConnectionLimit: boolean;
  connectionLimit: string | null;
  hasPoolTimeout: boolean;
  normalized: boolean;
};

export function normalizeDatabaseUrl(value = process.env.DATABASE_URL) {
  if (!value) return value;
  try {
    const url = new URL(value);
    const isSupabase = url.hostname.includes("supabase.com");
    const isPooler = url.hostname.includes(".pooler.supabase.com");
    let normalized = false;

    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", process.env.PRISMA_CONNECTION_LIMIT ?? DEFAULT_CONNECTION_LIMIT);
      normalized = true;
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", process.env.PRISMA_POOL_TIMEOUT ?? DEFAULT_POOL_TIMEOUT);
      normalized = true;
    }
    if (isPooler && !url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
      normalized = true;
    }
    if (isSupabase && isPooler && url.port === "5432" && process.env.PRISMA_KEEP_SUPABASE_SESSION_POOLER !== "true") {
      url.port = "6543";
      normalized = true;
    }

    return normalized ? url.toString() : value;
  } catch {
    return value;
  }
}

export function databaseUrlInfo(value = process.env.DATABASE_URL): DatabaseUrlInfo {
  if (!value) {
    return {
      configured: false,
      host: null,
      port: null,
      isSupabase: false,
      isPooler: false,
      isLikelyTransactionPooler: false,
      hasConnectionLimit: false,
      connectionLimit: null,
      hasPoolTimeout: false,
      normalized: false,
    };
  }
  try {
    const original = new URL(value);
    const normalized = new URL(normalizeDatabaseUrl(value) ?? value);
    const isSupabase = original.hostname.includes("supabase.com");
    const isPooler = original.hostname.includes(".pooler.supabase.com");
    return {
      configured: true,
      host: original.hostname,
      port: original.port || null,
      isSupabase,
      isPooler,
      isLikelyTransactionPooler: isPooler && (original.port === "6543" || normalized.port === "6543"),
      hasConnectionLimit: normalized.searchParams.has("connection_limit"),
      connectionLimit: normalized.searchParams.get("connection_limit"),
      hasPoolTimeout: normalized.searchParams.has("pool_timeout"),
      normalized: normalized.toString() !== original.toString(),
    };
  } catch {
    return {
      configured: true,
      host: null,
      port: null,
      isSupabase: false,
      isPooler: false,
      isLikelyTransactionPooler: false,
      hasConnectionLimit: false,
      connectionLimit: null,
      hasPoolTimeout: false,
      normalized: false,
    };
  }
}

export function isTransientPrismaConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "max clients reached",
    "EMAXCONNSESSION",
    "Timed out fetching a new connection",
    "Can't reach database server",
    "too many connections",
    "remaining connection slots are reserved",
  ].some((needle) => message.toLowerCase().includes(needle.toLowerCase()));
}
