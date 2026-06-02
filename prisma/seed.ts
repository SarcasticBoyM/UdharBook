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
  shopId?: string | null;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);

  return prisma.user.upsert({
    where: { email: input.email.toLowerCase() },
    update: {
      name: input.name,
      passwordHash,
      role: input.role,
      shopId: input.shopId,
    },
    create: {
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash,
      role: input.role,
      shopId: input.shopId,
    },
  });
}

async function main() {
  const primaryShop = await prisma.shop.upsert({
    where: { id: "default-shop" },
    update: {
      name: process.env.SHOP_NAME ?? "UdharBook Default Shop",
      ownerName: process.env.SHOP_OWNER_NAME ?? "Owner",
      subscriptionStatus: "ACTIVE",
    },
    create: {
      id: "default-shop",
      name: process.env.SHOP_NAME ?? "UdharBook Default Shop",
      ownerName: process.env.SHOP_OWNER_NAME ?? "Owner",
      mobileNumber: process.env.SHOP_MOBILE,
      gstNumber: process.env.SHOP_GST,
      address: process.env.SHOP_ADDRESS,
      subscriptionStatus: "ACTIVE",
    },
  });

  const admin = await upsertUser({
    name: "Admin",
    email: process.env.ADMIN_EMAIL ?? "admin@udharbook.local",
    password: requiredPassword("ADMIN_PASSWORD", "admin12345"),
    role: UserRole.SHOP_ADMIN,
    shopId: primaryShop.id,
  });
  const superPassword = process.env.SUPER_ADMIN_PASSWORD;
  const superAdmin = superPassword
    ? await upsertUser({
        name: "Super Admin",
        email: process.env.SUPER_ADMIN_EMAIL ?? "superadmin@udharbook.local",
        password: superPassword,
        role: UserRole.SUPER_ADMIN,
        shopId: null,
      })
    : null;
  const staffPassword = process.env.STAFF_PASSWORD;
  const staff = staffPassword
    ? await upsertUser({
        name: "Staff User",
        email: "staff@udharbook.local",
        password: staffPassword,
        role: UserRole.STAFF,
        shopId: primaryShop.id,
      })
    : null;

  console.log(`Seeded shop: ${primaryShop.name}`);
  console.log(`Seeded users: ${[admin.email, staff?.email, superAdmin?.email].filter(Boolean).join(", ")}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
