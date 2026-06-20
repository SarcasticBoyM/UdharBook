/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Globe2, MapPin, MessageCircle, Phone, UserPlus } from "lucide-react";
import { prisma } from "@/lib/db";
import { ensureUrl, normalizePhone, publicVCardUrl, qrCodeUrl } from "@/lib/qrvcard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

async function loadCard(slug: string) {
  const card = await prisma.qRVCard.findFirst({
    where: { slug, isPublic: true },
    include: {
      gallery: { orderBy: { sortOrder: "asc" } },
      brands: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!card) return null;
  prisma.qRVCard.update({ where: { id: card.id }, data: { viewCount: { increment: 1 } } }).catch(() => {});
  return {
    ...card,
    socialLinks: {
      ...((card.socialLinks ?? {}) as Record<string, string>),
      instagram: card.instagram ?? ((card.socialLinks ?? {}) as Record<string, string>).instagram ?? "",
      facebook: card.facebook ?? ((card.socialLinks ?? {}) as Record<string, string>).facebook ?? "",
      youtube: card.youtube ?? ((card.socialLinks ?? {}) as Record<string, string>).youtube ?? "",
      website: card.website ?? ((card.socialLinks ?? {}) as Record<string, string>).website ?? "",
    },
    products: Array.isArray(card.products) ? card.products as string[] : card.brands.map((brand) => brand.name),
    galleryImages: Array.isArray(card.galleryImages) ? card.galleryImages as string[] : card.gallery.map((image) => image.imageUrl),
  };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const card = await prisma.qRVCard.findFirst({ where: { slug, isPublic: true }, select: { businessName: true, tagline: true, logoUrl: true } });
  if (!card) return { title: "QRVCard" };
  return {
    title: `${card.businessName} | QRVCard`,
    description: card.tagline ?? `Digital visiting card for ${card.businessName}`,
    openGraph: {
      title: card.businessName,
      description: card.tagline ?? undefined,
      images: card.logoUrl ? [card.logoUrl] : undefined,
    },
  };
}

export default async function PublicQRVCardPage({ params }: Params) {
  const { slug } = await params;
  const card = await loadCard(slug);
  if (!card) notFound();

  const pageUrl = publicVCardUrl(card.slug);
  const phone = normalizePhone(card.mobile1);
  const phone2 = normalizePhone(card.mobile2);
  const whatsappUrl = buildWhatsappUrl({
    businessName: card.businessName,
    tagline: card.tagline,
    whatsappNumber: card.whatsappNumber,
    mobile1: card.mobile1,
    mobile2: card.mobile2,
  }, pageUrl);
  const theme = themeClasses(card.theme);

  return (
    <main className={`min-h-screen ${theme.page}`}>
      <div className="mx-auto max-w-5xl px-3 py-4 md:px-6 md:py-8">
        <section className={`overflow-hidden rounded-2xl shadow-2xl ${theme.card}`}>
          <div className="relative min-h-[260px] md:min-h-[340px]">
            {card.bannerUrl ? (
              <img src={card.bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className={`absolute inset-0 ${theme.banner}`} />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-5 md:p-8">
              <div className="flex flex-col gap-4 md:flex-row md:items-end">
                <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border-4 border-white bg-white shadow-xl md:h-32 md:w-32">
                  {card.logoUrl ? <img src={card.logoUrl} alt={card.businessName} className="h-full w-full object-cover" /> : <Globe2 className="h-10 w-10 text-slate-400" />}
                </div>
                <div className="text-white">
                  <h1 className="text-3xl font-black md:text-5xl">{card.businessName}</h1>
                  {card.tagline && <p className="mt-2 max-w-2xl text-sm text-white/85 md:text-lg">{card.tagline}</p>}
                  {card.ownerName && <p className="mt-3 text-sm font-semibold text-white/90">Owner: {card.ownerName}</p>}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 p-4 md:grid-cols-[minmax(0,1fr)_320px] md:p-8">
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Action href={phone ? `tel:+${phone}` : "#"} icon={<Phone className="h-5 w-5" />} label="Call Now" primary />
                {whatsappUrl && <Action href={whatsappUrl} icon={<MessageCircle className="h-5 w-5" />} label="WhatsApp" />}
                <Action href={card.mapsLink || card.mapUrl || "#"} icon={<MapPin className="h-5 w-5" />} label="Navigate" />
                <Action href={`/vcard/${card.slug}/contact.vcf`} icon={<UserPlus className="h-5 w-5" />} label="Save Contact" />
              </div>

              <InfoBlock title="Contact Details">
                <InfoLine label="Mobile" value={[card.mobile1, card.mobile2].filter(Boolean).join(" / ")} />
                <InfoLine label="Email" value={card.email ?? ""} href={card.email ? `mailto:${card.email}` : undefined} />
                <InfoLine label="Website" value={card.website ?? ""} href={card.website ? ensureUrl(card.website) : undefined} />
                <InfoLine label="GST" value={card.gstNumber ?? ""} />
                <InfoLine label="Category" value={card.category ?? ""} />
              </InfoBlock>

              {card.aboutBusiness && (
                <InfoBlock title="About Business">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{card.aboutBusiness}</p>
                </InfoBlock>
              )}

              {card.address && (
                <InfoBlock title="Address">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{card.address}</p>
                  {(card.mapsLink || card.mapUrl) && <a href={card.mapsLink || card.mapUrl || "#"} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-blue-700"><MapPin className="h-4 w-4" /> Open in Google Maps</a>}
                </InfoBlock>
              )}

              {card.categories.length > 0 && (
                <InfoBlock title="Business Categories">
                  <div className="flex flex-wrap gap-2">{card.categories.map((item) => <span key={item} className={`rounded-full px-3 py-1 text-xs font-bold ${theme.pill}`}>{item}</span>)}</div>
                </InfoBlock>
              )}

              {card.products.length > 0 && (
                <InfoBlock title="Products & Brands">
                  <div className="grid gap-2 sm:grid-cols-2">{card.products.map((item) => <div key={item} className="rounded-xl border border-slate-200 bg-white/80 p-3 text-sm font-semibold">{item}</div>)}</div>
                </InfoBlock>
              )}

              {card.galleryImages.length > 0 && (
                <InfoBlock title="Gallery">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{card.galleryImages.map((url) => <img key={url} src={url} alt="" loading="lazy" className="aspect-square rounded-xl object-cover" />)}</div>
                </InfoBlock>
              )}
            </div>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                <img src={qrCodeUrl(pageUrl, 240)} alt="QR code" className="mx-auto h-48 w-48" />
                <p className="mt-3 text-sm font-bold">Scan to open QRVCard</p>
                <p className="mt-1 break-all text-xs text-slate-500">{pageUrl}</p>
              </div>
              <InfoBlock title="Social Links">
                <div className="grid gap-2">
                  {Object.entries(card.socialLinks).filter(([, value]) => value).map(([key, value]) => (
                    <a key={key} href={ensureUrl(value)} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold capitalize">{key}</a>
                  ))}
                  {Object.values(card.socialLinks).filter(Boolean).length === 0 && <p className="text-sm text-slate-500">No social links added.</p>}
                </div>
              </InfoBlock>
              {phone2 && <a href={`tel:+${phone2}`} className="block rounded-2xl bg-slate-950 p-4 text-center font-bold text-white">Call Alternate Number</a>}
              {whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noreferrer" className="block rounded-2xl bg-green-600 p-4 text-center font-bold text-white">WhatsApp Now</a>}
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

function buildWhatsappUrl(input: {
  businessName: string;
  tagline?: string | null;
  whatsappNumber?: string | null;
  mobile1?: string | null;
  mobile2?: string | null;
}, pageUrl: string) {
  const phone = normalizePhone(input.whatsappNumber || input.mobile1 || input.mobile2 || "");
  if (!phone) return "";
  const message = [
    `Hi ${input.businessName}`,
    input.tagline ? `I saw your QRVCard: ${input.tagline}` : "I saw your QRVCard.",
    `Link: ${pageUrl}`,
  ].join("\n");
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function Action({ href, icon, label, primary = false }: { href: string; icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl px-2 text-center text-xs font-black shadow-sm ${primary ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-900"}`}>
      {icon}
      {label}
    </a>
  );
}

function InfoBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
      <h2 className="mb-3 text-base font-black">{title}</h2>
      {children}
    </section>
  );
}

function InfoLine({ label, value, href }: { label: string; value: string; href?: string }) {
  if (!value) return null;
  const content = <span className="font-semibold text-slate-900">{value}</span>;
  return <p className="flex justify-between gap-3 border-b border-slate-100 py-2 text-sm"><span className="text-slate-500">{label}</span>{href ? <a href={href} className="text-blue-700">{content}</a> : content}</p>;
}

function themeClasses(theme: string) {
  if (theme === "dark-premium") return { page: "bg-slate-950", card: "bg-slate-100 text-slate-950", banner: "bg-slate-900", pill: "bg-slate-900 text-white" };
  if (theme === "construction-gold") return { page: "bg-amber-100", card: "bg-orange-50 text-slate-950", banner: "bg-amber-700", pill: "bg-amber-200 text-amber-950" };
  if (theme === "business-red") return { page: "bg-red-100", card: "bg-red-50 text-slate-950", banner: "bg-red-700", pill: "bg-red-100 text-red-900" };
  if (theme === "minimal-white") return { page: "bg-slate-100", card: "bg-white text-slate-950", banner: "bg-slate-300", pill: "bg-slate-100 text-slate-800" };
  return { page: "bg-blue-100", card: "bg-blue-50 text-slate-950", banner: "bg-blue-700", pill: "bg-blue-100 text-blue-900" };
}
