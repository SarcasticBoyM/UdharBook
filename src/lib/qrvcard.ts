import type { QRVCard } from "@prisma/client";

export const QRVCARD_THEMES = [
  "professional-blue",
  "dark-premium",
  "construction-gold",
  "minimal-white",
  "business-red",
] as const;

export type QRVCardTheme = (typeof QRVCARD_THEMES)[number];

export type SocialLinks = {
  instagram?: string;
  facebook?: string;
  youtube?: string;
  website?: string;
};

export type QRVCardPayload = Omit<QRVCard, "createdAt" | "updatedAt" | "socialLinks" | "products" | "galleryImages"> & {
  createdAt: string | Date;
  updatedAt: string | Date;
  socialLinks: SocialLinks | null;
  products: string[] | null;
  galleryImages: string[] | null;
};

export function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return slug || `business-${Date.now()}`;
}

export function normalizePhone(value?: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

export function ensureUrl(value?: string | null) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function publicVCardUrl(slug: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  return `${base}/vcard/${slug}`;
}

export function qrCodeUrl(url: string, size = 220) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=10&data=${encodeURIComponent(url)}`;
}

export function vcfText(card: {
  businessName: string;
  ownerName?: string | null;
  mobile1?: string | null;
  mobile2?: string | null;
  email?: string | null;
  address?: string | null;
  website?: string | null;
}) {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${card.ownerName || card.businessName}`,
    `ORG:${card.businessName}`,
    card.mobile1 ? `TEL;TYPE=CELL:${card.mobile1}` : "",
    card.mobile2 ? `TEL;TYPE=WORK:${card.mobile2}` : "",
    card.email ? `EMAIL:${card.email}` : "",
    card.address ? `ADR;TYPE=WORK:;;${card.address.replace(/\n/g, " ")}` : "",
    card.website ? `URL:${ensureUrl(card.website)}` : "",
    "END:VCARD",
  ];
  return lines.filter(Boolean).join("\n");
}
