import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function upsertUser(input: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);

  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      name: input.name,
      passwordHash,
      role: input.role,
    },
    create: {
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role,
    },
  });
}

async function main() {
  const admin = await upsertUser({
    name: "Admin",
    email: "admin@shop.local",
    password: "admin123",
    role: UserRole.ADMIN,
  });
  const staff = await upsertUser({
    name: "Staff User",
    email: "staff@shop.local",
    password: "staff123",
    role: UserRole.STAFF,
  });

  console.log(`Seeded users: ${admin.email}, ${staff.email}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
