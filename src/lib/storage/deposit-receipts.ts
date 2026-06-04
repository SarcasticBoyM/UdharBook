const BUCKET = process.env.SUPABASE_DEPOSIT_RECEIPTS_BUCKET ?? "cheque-deposit-receipts";

function supabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
}

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function receiptStorageConfigured() {
  return Boolean(supabaseUrl() && serviceKey());
}

export function receiptPath(shopId: string, chequeId: string, fileName: string) {
  const safeName = fileName.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-");
  return `${shopId}/${chequeId}/${Date.now()}-${safeName}`;
}

export async function uploadDepositReceipt({
  path,
  file,
  contentType,
}: {
  path: string;
  file: Uint8Array;
  contentType: string;
}) {
  const url = supabaseUrl();
  const key = serviceKey();
  if (!url || !key) throw new Error("Receipt storage is not configured");

  const body = new Uint8Array(file).buffer;
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body,
  });
  if (!res.ok) throw new Error(`Receipt upload failed: ${res.status}`);
  return path;
}

export async function createReceiptSignedUrl(path: string) {
  const url = supabaseUrl();
  const key = serviceKey();
  if (!url || !key) throw new Error("Receipt storage is not configured");

  const res = await fetch(`${url}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  if (!res.ok) throw new Error(`Receipt signed URL failed: ${res.status}`);
  const payload = await res.json();
  return `${url}/storage/v1${payload.signedURL}`;
}
