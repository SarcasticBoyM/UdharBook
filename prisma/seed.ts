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
  shopId: string;
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
      shopName: process.env.SHOP_NAME ?? "UdharBook Default Shop",
      ownerName: process.env.SHOP_OWNER_NAME ?? "Owner",
      subscriptionStatus: "ACTIVE",
    },
    create: {
      id: "default-shop",
      shopName: process.env.SHOP_NAME ?? "UdharBook Default Shop",
      ownerName: process.env.SHOP_OWNER_NAME ?? "Owner",
      mobile: process.env.SHOP_MOBILE,
      email: process.env.SHOP_EMAIL,
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
  const platformShop = await prisma.shop.upsert({
    where: { id: "platform-shop" },
    update: {},
    create: {
      id: "platform-shop",
      shopName: "UdharBook Platform",
      ownerName: "UdharBook",
      subscriptionStatus: "ACTIVE",
    },
  });
  const superPassword = process.env.SUPER_ADMIN_PASSWORD;
  const superAdmin = superPassword
    ? await upsertUser({
        name: "Super Admin",
        email: process.env.SUPER_ADMIN_EMAIL ?? "superadmin@udharbook.local",
        password: superPassword,
        role: UserRole.SUPER_ADMIN,
        shopId: platformShop.id,
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

  console.log(`Seeded shop: ${primaryShop.shopName}`);
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
