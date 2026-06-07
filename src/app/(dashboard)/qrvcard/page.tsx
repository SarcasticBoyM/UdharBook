"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { Copy, Download, Edit3, ExternalLink, Eye, Globe2, ImagePlus, Mail, MapPin, Phone, QrCode, Save, Share2 } from "lucide-react";
import { normalizePhone, qrCodeUrl } from "@/lib/qrvcard";

type CardForm = {
  businessName: string;
  tagline: string;
  gstNumber: string;
  ownerName: string;
  mobile1: string;
  mobile2: string;
  whatsappNumber: string;
  email: string;
  address: string;
  mapUrl: string;
  mapsLink: string;
  website: string;
  instagram: string;
  facebook: string;
  youtube: string;
  logoUrl: string;
  bannerUrl: string;
  category: string;
  aboutBusiness: string;
  categories: string[];
  socialLinks: { instagram: string; facebook: string; youtube: string; website: string };
  products: string[];
  galleryImages: string[];
  theme: string;
  isPublic: boolean;
  slug?: string;
};

const emptyForm: CardForm = {
  businessName: "",
  tagline: "",
  gstNumber: "",
  ownerName: "",
  mobile1: "",
  mobile2: "",
  whatsappNumber: "",
  email: "",
  address: "",
  mapUrl: "",
  mapsLink: "",
  website: "",
  instagram: "",
  facebook: "",
  youtube: "",
  logoUrl: "",
  bannerUrl: "",
  category: "",
  aboutBusiness: "",
  categories: [],
  socialLinks: { instagram: "", facebook: "", youtube: "", website: "" },
  products: [],
  galleryImages: [],
  theme: "professional-blue",
  isPublic: true,
};

const categoryOptions = ["Tiles", "Cement", "Hardware", "Steel", "Sanitary", "Paint", "Pipes", "Electrical", "Tools", "Plywood"];
const themes = [
  { id: "professional-blue", label: "Professional Blue" },
  { id: "dark-premium", label: "Dark Premium" },
  { id: "construction-gold", label: "Construction Gold" },
  { id: "minimal-white", label: "Minimal White" },
  { id: "business-red", label: "Business Red" },
];

export default function QRVCardPage() {
  const [form, setForm] = useState<CardForm>(emptyForm);
  const [productText, setProductText] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cardExists, setCardExists] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [origin, setOrigin] = useState("");

  const publicUrl = useMemo(() => {
    if (!form.slug) return "";
    return `${origin}/vcard/${form.slug}`;
  }, [form.slug, origin]);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/qrvcard")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Could not load QRVCard.");
        return data;
      })
      .then((data) => {
        if (!data.card) {
          setCardExists(false);
          setEditMode(true);
          setLoading(false);
          return;
        }
        setForm({
          ...emptyForm,
          ...data.card,
          tagline: data.card.tagline ?? "",
          gstNumber: data.card.gstNumber ?? "",
          ownerName: data.card.ownerName ?? "",
          mobile1: data.card.mobile1 ?? "",
          mobile2: data.card.mobile2 ?? "",
          whatsappNumber: data.card.whatsappNumber ?? "",
          email: data.card.email ?? "",
          address: data.card.address ?? "",
          mapUrl: data.card.mapsLink ?? data.card.mapUrl ?? "",
          mapsLink: data.card.mapsLink ?? data.card.mapUrl ?? "",
          website: data.card.website ?? "",
          instagram: data.card.instagram ?? data.card.socialLinks?.instagram ?? "",
          facebook: data.card.facebook ?? data.card.socialLinks?.facebook ?? "",
          youtube: data.card.youtube ?? data.card.socialLinks?.youtube ?? "",
          logoUrl: data.card.logoUrl ?? "",
          bannerUrl: data.card.bannerUrl ?? "",
          category: data.card.category ?? "",
          aboutBusiness: data.card.aboutBusiness ?? "",
          categories: data.card.categories ?? [],
          socialLinks: { ...emptyForm.socialLinks, ...(data.card.socialLinks ?? {}) },
          products: data.card.products ?? [],
          galleryImages: data.card.galleryImages ?? [],
        });
        setProductText((data.card.products ?? []).join("\n"));
        setCardExists(true);
        setEditMode(false);
        setLoading(false);
      })
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : "Could not load QRVCard.");
        setLoading(false);
      });
  }, []);

  function setValue<K extends keyof CardForm>(key: K, value: CardForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleCategory(category: string) {
    setForm((prev) => ({
      ...prev,
      categories: prev.categories.includes(category)
        ? prev.categories.filter((item) => item !== category)
        : [...prev.categories, category],
    }));
  }

  async function upload(kind: "logo" | "banner" | "gallery", file?: File) {
    if (!file) return;
    setMessage("Uploading image...");
    try {
      const body = new FormData();
      body.append("kind", kind);
      body.append("file", file);
      const res = await fetch("/api/qrvcard/upload", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error ?? "Image upload failed. You can still save the card without this image.");
        return;
      }
      if (kind === "logo") setValue("logoUrl", data.url);
      if (kind === "banner") setValue("bannerUrl", data.url);
      if (kind === "gallery") setValue("galleryImages", [...form.galleryImages, data.url]);
      setMessage("Image uploaded. Save the card to publish this change.");
    } catch (error) {
      setMessage(error instanceof Error ? `Image upload failed: ${error.message}` : "Image upload failed. You can still save the card without this image.");
    }
  }

  async function save() {
    setSaving(true);
    setMessage("");
    const products = productText.split("\n").map((item) => item.trim()).filter(Boolean);
    try {
      const res = await fetch("/api/qrvcard", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, mapUrl: form.mapsLink || form.mapUrl, products }),
      });
      const data = await res.json().catch(() => ({}));
      setSaving(false);
      if (!res.ok) {
        setMessage(data.error ?? "Could not save QRVCard. Check server logs for qrvcard_save_failed.");
        return;
      }
      setForm((prev) => ({ ...prev, ...data.card, products: data.card.products ?? products }));
      setCardExists(true);
      setEditMode(false);
      setMessage("QRVCard saved.");
    } catch (error) {
      setSaving(false);
      setMessage(error instanceof Error ? `Could not save QRVCard: ${error.message}` : "Could not save QRVCard.");
    }
  }

  async function copyPublicLink() {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setMessage("QRVCard link copied.");
  }

  async function sharePublicLink() {
    if (!publicUrl) return;
    if (navigator.share) {
      await navigator.share({ title: form.businessName || "QRVCard", text: form.tagline || "My digital visiting card", url: publicUrl });
      return;
    }
    await copyPublicLink();
  }

  if (loading) {
    return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">Loading QRVCard...</div>;
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
        <h1 className="text-xl font-bold">Could not load QRVCard</h1>
        <p className="mt-2 text-sm">{loadError}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-4 min-h-11 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white">
          Retry
        </button>
      </div>
    );
  }

  if (cardExists && !editMode) {
    return (
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <main className="space-y-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Digital Business Card</p>
              <h1 className="text-2xl font-bold md:text-3xl">Your QRVCard</h1>
              <p className="text-sm text-slate-500">Your saved business profile is ready to share with customers and vendors.</p>
            </div>
            <button type="button" onClick={() => { setEditMode(true); setMessage(""); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white">
              <Edit3 className="h-4 w-4" /> Edit QRVCard
            </button>
          </div>

          {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}

          <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-bold">{form.businessName}</h2>
                <p className="mt-1 text-sm text-slate-500">{form.isPublic ? "Public sharing is enabled" : "Public sharing is disabled"}</p>
                {publicUrl && <p className="mt-2 break-all rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-950 dark:text-slate-300">{publicUrl}</p>}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:min-w-72">
                <a href={publicUrl} target="_blank" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold" rel="noreferrer">
                  <Eye className="h-4 w-4" /> Open
                </a>
                <button type="button" onClick={copyPublicLink} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold">
                  <Copy className="h-4 w-4" /> Copy
                </button>
                <button type="button" onClick={sharePublicLink} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white">
                  <Share2 className="h-4 w-4" /> Share
                </button>
                <a href={qrCodeUrl(publicUrl, 600)} download="qrvcard-qr.png" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white">
                  <Download className="h-4 w-4" /> QR
                </a>
              </div>
            </div>
          </section>

          <CardPreview form={form} publicUrl={publicUrl} />
        </main>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <section className="rounded-lg border bg-white p-4 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-center gap-2">
              <QrCode className="h-5 w-5 text-brand-600" />
              <h2 className="font-bold">QR Code</h2>
            </div>
            {publicUrl ? (
              <>
                <img src={qrCodeUrl(publicUrl, 260)} alt="QR code" className="mx-auto mt-4 h-56 w-56 rounded-lg bg-white p-2" />
                <p className="mt-3 text-sm text-slate-500">Scan to open your digital visiting card</p>
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Public link not available.</p>
            )}
          </section>
          <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h2 className="font-bold">Quick Actions</h2>
            <div className="mt-3 grid gap-2">
              <a href={`/vcard/${form.slug}/contact.vcf`} className="rounded-lg border px-3 py-3 text-center text-sm font-semibold">Download Contact</a>
              <a href={`https://wa.me/?text=${encodeURIComponent(publicUrl)}`} target="_blank" className="rounded-lg bg-emerald-600 px-3 py-3 text-center text-sm font-semibold text-white" rel="noreferrer">Share on WhatsApp</a>
            </div>
          </section>
        </aside>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <main className="space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Digital Business Card</p>
            <h1 className="text-2xl font-bold md:text-3xl">Your QRVCard</h1>
            <p className="text-sm text-slate-500">{cardExists ? "Update your saved QRVCard details." : "Setup your QRVCard once, then manage it from your business profile dashboard."}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {cardExists && (
              <button type="button" onClick={() => { setEditMode(false); setMessage(""); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-semibold">
                Cancel Edit
              </button>
            )}
            {publicUrl && (
              <a href={publicUrl} target="_blank" className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-semibold" rel="noreferrer">
                <Eye className="h-4 w-4" /> Preview
              </a>
            )}
            <button type="button" onClick={save} disabled={saving || !form.businessName.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60">
              <Save className="h-4 w-4" /> {saving ? "Saving" : "Save Card"}
            </button>
          </div>
        </div>

        {!cardExists && (
          <section className="rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-brand-950">
            <h2 className="font-bold">Setup Your QRVCard</h2>
            <p className="mt-1">Add your business details, branding, and contact actions. After the first save, this page will open directly to your live card dashboard.</p>
          </section>
        )}

        {message && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>}

        <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="font-bold">Business Details</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Input label="Business Name" value={form.businessName} onChange={(v) => setValue("businessName", v)} />
            <Input label="Tagline" value={form.tagline} onChange={(v) => setValue("tagline", v)} />
            <Input label="Owner Name" value={form.ownerName} onChange={(v) => setValue("ownerName", v)} />
            <Input label="GST Number" value={form.gstNumber} onChange={(v) => setValue("gstNumber", v)} />
            <Input label="Mobile Number 1" value={form.mobile1} onChange={(v) => setValue("mobile1", v)} />
            <Input label="Mobile Number 2" value={form.mobile2} onChange={(v) => setValue("mobile2", v)} />
            <Input label="WhatsApp Number" value={form.whatsappNumber} onChange={(v) => setValue("whatsappNumber", v)} />
            <Input label="Email" value={form.email} onChange={(v) => setValue("email", v)} />
            <Input label="Website" value={form.website} onChange={(v) => setValue("website", v)} />
            <Input label="Google Maps Link" value={form.mapsLink || form.mapUrl} onChange={(v) => { setValue("mapsLink", v); setValue("mapUrl", v); }} />
            <Input label="Primary Category" value={form.category} onChange={(v) => setValue("category", v)} />
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block font-medium">Address</span>
              <textarea value={form.address} onChange={(e) => setValue("address", e.target.value)} rows={3} className="w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block font-medium">About Business</span>
              <textarea value={form.aboutBusiness} onChange={(e) => setValue("aboutBusiness", e.target.value)} rows={4} className="w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
            </label>
          </div>
        </section>

        <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="font-bold">Branding</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <UploadBox label="Business Logo" image={form.logoUrl} onFile={(file) => upload("logo", file)} onUrl={(url) => setValue("logoUrl", url)} />
            <UploadBox label="Cover / Banner Image" image={form.bannerUrl} onFile={(file) => upload("banner", file)} onUrl={(url) => setValue("bannerUrl", url)} />
          </div>
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium">Theme</p>
            <div className="flex flex-wrap gap-2">
              {themes.map((theme) => (
                <button key={theme.id} type="button" onClick={() => setValue("theme", theme.id)} className={`rounded-full border px-3 py-2 text-xs font-semibold ${form.theme === theme.id ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300"}`}>
                  {theme.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="font-bold">Products, Categories & Social Links</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {categoryOptions.map((category) => (
              <button key={category} type="button" onClick={() => toggleCategory(category)} className={`rounded-full border px-3 py-2 text-xs font-semibold ${form.categories.includes(category) ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-300"}`}>
                {category}
              </button>
            ))}
          </div>
          <label className="mt-4 block text-sm">
            <span className="mb-1 block font-medium">Products / Dealership Brands</span>
            <textarea value={productText} onChange={(e) => setProductText(e.target.value)} rows={5} placeholder={"UltraTech Cement\nAsian Paints\nTMT Steel"} className="w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Input label="Instagram" value={form.instagram || form.socialLinks.instagram} onChange={(v) => { setValue("instagram", v); setValue("socialLinks", { ...form.socialLinks, instagram: v }); }} />
            <Input label="Facebook" value={form.facebook || form.socialLinks.facebook} onChange={(v) => { setValue("facebook", v); setValue("socialLinks", { ...form.socialLinks, facebook: v }); }} />
            <Input label="YouTube" value={form.youtube || form.socialLinks.youtube} onChange={(v) => { setValue("youtube", v); setValue("socialLinks", { ...form.socialLinks, youtube: v }); }} />
            <Input label="Website Social Link" value={form.socialLinks.website} onChange={(v) => setValue("socialLinks", { ...form.socialLinks, website: v })} />
          </div>
        </section>

        <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold">Gallery</h2>
            <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-semibold">
              <ImagePlus className="h-4 w-4" /> Add Image
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => upload("gallery", e.target.files?.[0])} />
            </label>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {form.galleryImages.map((url) => (
              <button key={url} type="button" onClick={() => setValue("galleryImages", form.galleryImages.filter((item) => item !== url))} className="group relative overflow-hidden rounded-lg border">
                <img src={url} alt="" className="aspect-square w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 bg-black/60 py-1 text-xs text-white opacity-0 group-hover:opacity-100">Remove</span>
              </button>
            ))}
          </div>
        </section>
      </main>

      <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <CardPreview form={form} publicUrl={publicUrl} />
        <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-brand-600" />
            <h2 className="font-bold">Share & QR</h2>
          </div>
          {publicUrl ? (
            <div className="mt-4 space-y-3">
              <img src={qrCodeUrl(publicUrl)} alt="QR code" className="mx-auto h-44 w-44 rounded-lg bg-white p-2" />
              <input readOnly value={publicUrl} className="w-full rounded-lg border px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => navigator.clipboard.writeText(publicUrl)} className="rounded-lg border px-3 py-2 text-sm font-semibold">Copy Link</button>
                <a href={`https://wa.me/?text=${encodeURIComponent(publicUrl)}`} target="_blank" className="rounded-lg bg-emerald-600 px-3 py-2 text-center text-sm font-semibold text-white" rel="noreferrer">WhatsApp</a>
              </div>
            </div>
          ) : <p className="mt-3 text-sm text-slate-500">Save card to generate public link and QR code.</p>}
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isPublic} onChange={(e) => setValue("isPublic", e.target.checked)} />
            Public visibility enabled
          </label>
        </section>
      </aside>
    </div>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="min-h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
    </label>
  );
}

function UploadBox({ label, image, onFile, onUrl }: { label: string; image: string; onFile: (file?: File) => void; onUrl: (url: string) => void }) {
  return (
    <div className="rounded-lg border border-dashed p-3 dark:border-slate-700">
      <p className="text-sm font-medium">{label}</p>
      {image ? <img src={image} alt="" className="mt-2 h-28 w-full rounded-lg object-cover" /> : <div className="mt-2 flex h-28 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500 dark:bg-slate-800">No image</div>}
      <div className="mt-2 grid gap-2">
        <input value={image} onChange={(e) => onUrl(e.target.value)} placeholder="Paste image URL" className="rounded-lg border px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onFile(e.target.files?.[0])} className="text-xs" />
      </div>
    </div>
  );
}

function CardPreview({ form, publicUrl }: { form: CardForm; publicUrl: string }) {
  const phone = normalizePhone(form.mobile1);
  const whatsapp = normalizePhone(form.whatsappNumber || form.mobile1);
  return (
    <section className={`overflow-hidden rounded-lg border bg-white shadow-sm dark:border-slate-700 ${themeClass(form.theme)}`}>
      <div className="relative h-36 bg-slate-900">
        {form.bannerUrl && <img src={form.bannerUrl} alt="" className="h-full w-full object-cover opacity-90" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        <div className="absolute bottom-4 left-4 flex items-end gap-3">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border-4 border-white bg-white shadow">
            {form.logoUrl ? <img src={form.logoUrl} alt="" className="h-full w-full object-cover" /> : <Globe2 className="h-8 w-8 text-slate-400" />}
          </div>
          <div className="pb-1 text-white">
            <h2 className="text-xl font-bold">{form.businessName || "Your Business Name"}</h2>
            <p className="text-sm text-white/80">{form.tagline || "Premium digital visiting card"}</p>
          </div>
        </div>
      </div>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2">
          <a href={phone ? `tel:+${phone}` : undefined} className="rounded-lg bg-slate-950 px-3 py-3 text-center text-sm font-semibold text-white"><Phone className="mx-auto mb-1 h-4 w-4" />Call Now</a>
          <a href={whatsapp ? `https://wa.me/${whatsapp}` : undefined} className="rounded-lg bg-emerald-600 px-3 py-3 text-center text-sm font-semibold text-white"><Share2 className="mx-auto mb-1 h-4 w-4" />WhatsApp</a>
          <a href={form.mapsLink || form.mapUrl || undefined} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-3 text-center text-sm font-semibold"><MapPin className="mx-auto mb-1 h-4 w-4" />Navigate</a>
          <a href={form.email ? `mailto:${form.email}` : undefined} className="rounded-lg border px-3 py-3 text-center text-sm font-semibold"><Mail className="mx-auto mb-1 h-4 w-4" />Email</a>
        </div>
        <div className="rounded-lg bg-white/70 p-3 text-sm dark:bg-slate-900/70">
          <p className="font-semibold">{form.ownerName || "Owner Name"}</p>
          {form.category && <p className="text-xs font-bold uppercase text-slate-500">{form.category}</p>}
          <p className="text-slate-600 dark:text-slate-300">{form.address || "Business address will appear here"}</p>
          {form.aboutBusiness && <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{form.aboutBusiness}</p>}
          {form.gstNumber && <p className="mt-1 text-xs text-slate-500">GST: {form.gstNumber}</p>}
        </div>
        {form.categories.length > 0 && <div className="flex flex-wrap gap-2">{form.categories.map((item) => <span key={item} className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold dark:bg-slate-900/70">{item}</span>)}</div>}
        {form.products.length > 0 && <div className="grid grid-cols-2 gap-2">{form.products.slice(0, 6).map((item) => <span key={item} className="rounded-lg border bg-white/70 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900/70">{item}</span>)}</div>}
        {publicUrl && <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700"><ExternalLink className="h-4 w-4" />Open public card</a>}
      </div>
    </section>
  );
}

function themeClass(theme: string) {
  if (theme === "dark-premium") return "bg-slate-950 text-white";
  if (theme === "construction-gold") return "bg-amber-50 text-slate-950";
  if (theme === "minimal-white") return "bg-white text-slate-950";
  if (theme === "business-red") return "bg-red-50 text-slate-950";
  return "bg-blue-50 text-slate-950";
}
