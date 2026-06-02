import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function isHostedDatabase() {
  return (process.env.DATABASE_URL ?? "").includes("supabase.com");
}

function requiredPassword(name: string, fallback: string) {
  const value = process.env[name];
  if (value) return value;
  if (!isHostedDatabase()) return fallback;
  throw new Error(`${name} is required when seeding a hosted database`);
}

async function upsertUser(input: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);

  return prisma.user.upsert({
    where: { email: input.email.toLowerCase() },
    update: {
      name: input.name,
      passwordHash,
      role: input.role,
    },
    create: {
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash,
      role: input.role,
    },
  });
}

async function main() {
  const admin = await upsertUser({
    name: "Admin",
    email: process.env.ADMIN_EMAIL ?? "admin@udharbook.local",
    password: requiredPassword("ADMIN_PASSWORD", "admin12345"),
    role: UserRole.ADMIN,
  });
  const staffPassword = process.env.STAFF_PASSWORD;
  const staff = staffPassword
    ? await upsertUser({
        name: "Staff User",
        email: "staff@udharbook.local",
        password: staffPassword,
        role: UserRole.STAFF,
      })
    : null;

  console.log(`Seeded users: ${[admin.email, staff?.email].filter(Boolean).join(", ")}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
