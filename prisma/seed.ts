import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("admin123", 12);

  await prisma.user.upsert({
    where: { email: "admin@shop.local" },
    update: {},
    create: {
      name: "Admin",
      email: "admin@shop.local",
      passwordHash,
      role: UserRole.ADMIN,
    },
  });

  await prisma.user.upsert({
    where: { email: "staff@shop.local" },
    update: {},
    create: {
      name: "Staff User",
      email: "staff@shop.local",
      passwordHash: await bcrypt.hash("staff123", 12),
      role: UserRole.STAFF,
    },
  });

  console.log("Seeded users: admin@shop.local / admin123, staff@shop.local / staff123");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
