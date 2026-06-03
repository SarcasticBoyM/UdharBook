export type ExtractedChequeFields = {
  customerName?: string;
  chequeNumber?: string;
  bankName?: string;
  chequeDate?: string;
  accountHolderName?: string;
  amount?: number;
  micrCode?: string;
  ifscCode?: string;
  branch?: string;
};

export type ChequeOcrResult = {
  ok: boolean;
  provider: "ocrspace" | "manual";
  fields: ExtractedChequeFields;
  rawText: string;
  confidence: number;
  fieldConfidence: Record<keyof ExtractedChequeFields, number>;
  warning?: string;
};

type OcrProvider = {
  name: ChequeOcrResult["provider"];
  scan: (imageDataUrl: string) => Promise<ChequeOcrResult | null>;
};

export const emptyFieldConfidence: Record<keyof ExtractedChequeFields, number> = {
  customerName: 0,
  chequeNumber: 0,
  bankName: 0,
  chequeDate: 0,
  accountHolderName: 0,
  amount: 0,
  micrCode: 0,
  ifscCode: 0,
  branch: 0,
};

function dataUrlToBase64(imageDataUrl: string) {
  const [, base64] = imageDataUrl.split(",");
  return base64 ?? imageDataUrl;
}

function normalizeDate(value?: string) {
  if (!value) return undefined;
  const clean = value.trim();
  const iso = clean.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  const indian = clean.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!indian) return undefined;
  const day = indian[1].padStart(2, "0");
  const month = indian[2].padStart(2, "0");
  const year = indian[3].length === 2 ? `20${indian[3]}` : indian[3];
  return `${year}-${month}-${day}`;
}

function parseAmount(value?: string) {
  if (!value) return undefined;
  const number = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function extractFromRawText(rawText: string) {
  const text = rawText.replace(/\s+/g, " ").trim();
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const fields: ExtractedChequeFields = {};
  const fieldConfidence = { ...emptyFieldConfidence };

  const ifsc = text.match(/\b[A-Z]{4}0[A-Z0-9]{6}\b/i)?.[0]?.toUpperCase();
  if (ifsc) {
    fields.ifscCode = ifsc;
    fieldConfidence.ifscCode = 0.9;
  }

  const micr = text.match(/\b\d{9}\b/)?.[0];
  if (micr) {
    fields.micrCode = micr;
    fieldConfidence.micrCode = 0.75;
  }

  const chequeNumber =
    lines.find((line) => /cheque|chq/i.test(line))?.match(/\b\d{6,12}\b/)?.[0] ??
    text.match(/\b\d{6}\b/)?.[0];
  if (chequeNumber) {
    fields.chequeNumber = chequeNumber;
    fieldConfidence.chequeNumber = 0.65;
  }

  const bankLine = lines.find((line) => /bank/i.test(line) && line.length < 60);
  if (bankLine) {
    fields.bankName = bankLine.replace(/^\W+|\W+$/g, "");
    fieldConfidence.bankName = 0.7;
  }

  const branchLine = lines.find((line) => /branch/i.test(line));
  if (branchLine) {
    fields.branch = branchLine.replace(/branch/gi, "").replace(/[:|-]/g, "").trim();
    fieldConfidence.branch = 0.55;
  }

  const date = normalizeDate(text.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/)?.[0]);
  if (date) {
    fields.chequeDate = date;
    fieldConfidence.chequeDate = 0.7;
  }

  const amount =
    parseAmount(text.match(/(?:rs\.?|inr|rupees|amount)[^\d]{0,12}([\d,]+(?:\.\d{1,2})?)/i)?.[1]) ??
    parseAmount(text.match(/\*\*?\s*([\d,]+(?:\.\d{1,2})?)\s*\*?/)?.[1]);
  if (amount) {
    fields.amount = amount;
    fieldConfidence.amount = 0.55;
  }

  const holderLine = lines.find((line) => /pay|bearer|holder|name/i.test(line));
  if (holderLine) {
    const detectedName = holderLine
      .replace(/pay|bearer|holder|name|or order|rupees/gi, "")
      .replace(/[:|-]/g, "")
      .trim()
      .slice(0, 80);
    fields.accountHolderName = detectedName;
    fields.customerName = detectedName;
    fieldConfidence.accountHolderName = 0.45;
    fieldConfidence.customerName = 0.45;
  }

  const confidenceValues = Object.values(fieldConfidence).filter(Boolean);
  const confidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 0;

  return { fields, fieldConfidence, confidence };
}

async function scanWithOcrSpace(imageDataUrl: string) {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) return null;

  const formData = new FormData();
  formData.append(
    "base64Image",
    imageDataUrl.startsWith("data:") ? imageDataUrl : `data:image/jpeg;base64,${dataUrlToBase64(imageDataUrl)}`
  );
  formData.append("language", "eng");
  formData.append("scale", "true");
  formData.append("isTable", "false");
  formData.append("OCREngine", "2");

  const res = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { apikey: apiKey },
    body: formData,
  });
  if (!res.ok) throw new Error(`OCRSpace failed: ${res.status}`);

  const payload = await res.json();
  const rawText = payload.ParsedResults?.[0]?.ParsedText ?? "";
  const parsed = extractFromRawText(rawText);
  return { ok: true, provider: "ocrspace" as const, rawText, ...parsed };
}

const providers: OcrProvider[] = [
  { name: "ocrspace", scan: scanWithOcrSpace },
  // Future: add an OpenAI Vision provider here without changing API/frontend code.
];

export async function scanChequeImage(imageDataUrl: string): Promise<ChequeOcrResult> {
  for (const provider of providers) {
    try {
      const result = await provider.scan(imageDataUrl);
      if (result) return result;
    } catch {
      continue;
    }
  }

  return {
    ok: false,
    provider: "manual",
    fields: {},
    rawText: "",
    confidence: 0,
    fieldConfidence: emptyFieldConfidence,
    warning: "Could not detect cheque details. Please enter or verify manually.",
  };
}
