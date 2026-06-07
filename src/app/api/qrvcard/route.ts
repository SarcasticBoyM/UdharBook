import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { ensureUrl, slugify } from "@/lib/qrvcard";
import { logger } from "@/lib/logger";

const schema = z.object({
  businessName: z.string().min(1).max(120),
  tagline: z.string().max(160).optional().nullable(),
  gstNumber: z.string().max(40).optional().nullable(),
  ownerName: z.string().max(100).optional().nullable(),
  mobile1: z.string().max(30).optional().nullable(),
  mobile2: z.string().max(30).optional().nullable(),
  whatsappNumber: z.string().max(30).optional().nullable(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  address: z.string().max(700).optional().nullable(),
  mapUrl: z.string().max(700).optional().nullable(),
  website: z.string().max(250).optional().nullable(),
  logoUrl: z.string().max(1000).optional().nullable(),
  bannerUrl: z.string().max(1000).optional().nullable(),
  categories: z.array(z.string().max(40)).max(30).default([]),
  socialLinks: z.object({
    instagram: z.string().max(250).optional(),
    facebook: z.string().max(250).optional(),
    youtube: z.string().max(250).optional(),
    website: z.string().max(250).optional(),
  }).optional().nullable(),
  products: z.array(z.string().max(80)).max(40).optional().nullable(),
  galleryImages: z.array(z.string().max(1000)).max(20).optional().nullable(),
  theme: z.enum(["professional-blue", "dark-premium", "construction-gold", "minimal-white", "business-red"]).default("professional-blue"),
  isPublic: z.boolean().default(true),
});

function clean(value?: string | null) {
  return value?.trim() || null;
}

async function uniqueSlug(base: string, existingId?: string) {
  const slug = slugify(base);
  for (let index = 0; index < 20; index += 1) {
    const candidate = index === 0 ? slug : `${slug}-${index + 1}`;
    const existing = await prisma.qRVCard.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing || existing.id === existingId) return candidate;
  }
  return `${slug}-${Date.now()}`;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const shopId = requireShopId(request, session);
    const card = await prisma.qRVCard.findUnique({ where: { shopId } });
    return NextResponse.json({ card });
  } catch (error) {
    logger.error("qrvcard_load_failed", {
      userId: session.id,
      shopId: session.shopId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: qrvcardDbErrorMessage(error, "Could not load QRVCard") }, { status: qrvcardDbErrorStatus(error) });
  }
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "SHOP_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const shopId = requireShopId(request, session);
    logger.info("qrvcard_save_start", { userId: session.id, shopId });
    const rawBody = await request.json();
    const body = schema.parse(rawBody);
    logger.info("qrvcard_save_validated", {
      userId: session.id,
      shopId,
      businessName: body.businessName,
      hasLogo: Boolean(body.logoUrl),
      hasBanner: Boolean(body.bannerUrl),
      galleryCount: body.galleryImages?.length ?? 0,
      productCount: body.products?.length ?? 0,
      isPublic: body.isPublic,
    });
    const existing = await prisma.qRVCard.findUnique({ where: { shopId }, select: { id: true } });
    const slug = await uniqueSlug(body.businessName, existing?.id);
    const data = {
      businessName: body.businessName.trim(),
      tagline: clean(body.tagline),
      gstNumber: clean(body.gstNumber),
      ownerName: clean(body.ownerName),
      mobile1: clean(body.mobile1),
      mobile2: clean(body.mobile2),
      whatsappNumber: clean(body.whatsappNumber),
      email: clean(body.email),
      address: clean(body.address),
      mapUrl: clean(body.mapUrl),
      website: clean(ensureUrl(body.website)),
      logoUrl: clean(body.logoUrl),
      bannerUrl: clean(body.bannerUrl),
      categories: body.categories.map((item) => item.trim()).filter(Boolean),
      socialLinks: body.socialLinks ?? {},
      products: body.products ?? [],
      galleryImages: body.galleryImages ?? [],
      theme: body.theme,
      isPublic: body.isPublic,
    };

    logger.info("qrvcard_save_db_upsert_start", { userId: session.id, shopId, existingId: existing?.id ?? null, slug });
    const card = await prisma.qRVCard.upsert({
      where: { shopId },
      create: { shopId, slug, ...data },
      update: { ...data },
    });
    logger.info("qrvcard_save_success", { userId: session.id, shopId, cardId: card.id, slug: card.slug });
    return NextResponse.json({ card });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn("qrvcard_save_validation_failed", { userId: session.id, shopId: session.shopId, issues: error.issues });
      return NextResponse.json({ error: `Invalid QRVCard details: ${error.issues.map((issue) => issue.message).join(", ")}` }, { status: 400 });
    }
    logger.error("qrvcard_save_failed", {
      userId: session.id,
      shopId: session.shopId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: qrvcardDbErrorMessage(error, "Could not save QRVCard") }, { status: qrvcardDbErrorStatus(error) });
  }
}

function qrvcardDbErrorStatus(error: unknown) {
  return isMissingQRVCardTable(error) ? 503 : 500;
}

function qrvcardDbErrorMessage(error: unknown, fallback: string) {
  if (isMissingQRVCardTable(error)) {
    return "QRVCard database table is missing. Apply migration 20260607090000_add_qrvcard_module before saving cards.";
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return "A QRVCard with this public URL already exists. Please change the business name slightly and save again.";
  }
  return error instanceof Error ? error.message : fallback;
}

function isMissingQRVCardTable(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("QRVCard") && (message.includes("does not exist") || message.includes("not exist"));
}
