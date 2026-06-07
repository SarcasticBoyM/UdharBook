const DEFAULT_BUCKETS = {
  logo: "qrvcard-logos",
  banner: "qrvcard-banners",
  gallery: "qrvcard-gallery",
};

type AssetKind = keyof typeof DEFAULT_BUCKETS;

function supabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
}

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function bucketFor(kind: AssetKind) {
  if (kind === "logo") return process.env.SUPABASE_QRVCARD_LOGOS_BUCKET ?? DEFAULT_BUCKETS.logo;
  if (kind === "banner") return process.env.SUPABASE_QRVCARD_BANNERS_BUCKET ?? DEFAULT_BUCKETS.banner;
  return process.env.SUPABASE_QRVCARD_GALLERY_BUCKET ?? DEFAULT_BUCKETS.gallery;
}

export function qrvcardStorageConfigured() {
  return Boolean(supabaseUrl() && serviceKey());
}

export function qrvcardAssetPath(shopId: string, kind: AssetKind, fileName: string) {
  const safeName = fileName.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-");
  return `${shopId}/${kind}/${Date.now()}-${safeName}`;
}

export async function uploadQRVCardAsset({
  shopId,
  kind,
  file,
  fileName,
  contentType,
}: {
  shopId: string;
  kind: AssetKind;
  file: Uint8Array;
  fileName: string;
  contentType: string;
}) {
  const url = supabaseUrl();
  const key = serviceKey();
  if (!url || !key) throw new Error("QRVCard storage is not configured");

  const bucket = bucketFor(kind);
  const path = qrvcardAssetPath(shopId, kind, fileName);
  const body = new Uint8Array(file).buffer;
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body,
  });
  if (!res.ok) throw new Error(`QRVCard asset upload failed: ${res.status}`);
  return `${url}/storage/v1/object/public/${bucket}/${path}`;
}
