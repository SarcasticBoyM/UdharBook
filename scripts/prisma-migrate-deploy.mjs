import { spawnSync } from "node:child_process";

function normalizeDatabaseUrl(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    const isSupabase = url.hostname.includes("supabase.com");
    const isPooler = url.hostname.includes(".pooler.supabase.com");

    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", process.env.PRISMA_CONNECTION_LIMIT ?? "5");
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", process.env.PRISMA_POOL_TIMEOUT ?? "20");
    }
    if (isPooler && !url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
    }
    if (isSupabase && isPooler && url.port === "5432" && process.env.PRISMA_KEEP_SUPABASE_SESSION_POOLER !== "true") {
      url.port = "6543";
    }

    return url.toString();
  } catch {
    return value;
  }
}

const env = {
  ...process.env,
  DATABASE_URL: normalizeDatabaseUrl(process.env.DATABASE_URL),
};

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
