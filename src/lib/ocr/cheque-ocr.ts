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
  provider: string;
  fields: ExtractedChequeFields;
  rawText: string;
  confidence: number;
  fieldConfidence: Record<keyof ExtractedChequeFields, number>;
  candidates?: Record<string, unknown>;
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

const knownBanks = [
  "State Bank of India",
  "SBI",
  "HDFC Bank",
  "ICICI Bank",
  "Axis Bank",
  "Bank of Baroda",
  "Punjab National Bank",
  "Canara Bank",
  "Union Bank",
  "Bank of India",
  "Kotak Mahindra Bank",
  "IndusInd Bank",
  "Yes Bank",
  "IDFC First Bank",
  "Federal Bank",
  "Central Bank",
  "Indian Bank",
  "Indian Overseas Bank",
  "Maharashtra Bank",
  "Saraswat Bank",
  "Janata Sahakari Bank",
  "Sahakari Bank",
  "Co-op Bank",
  "Co-operative Bank",
];

function normalizeNumericText(value: string) {
  return value
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[₹,]/g, "")
    .trim();
}

function isValidDateParts(day: number, month: number, year: number) {
  return day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2045;
}

function lineScorePosition(index: number, total: number) {
  if (total <= 1) return 0;
  return index / (total - 1);
}

function confidenceAverage(fieldConfidence: Record<keyof ExtractedChequeFields, number>) {
  const values = Object.values(fieldConfidence).filter(Boolean);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function findDate(lines: string[]) {
  const candidates: { value: string; score: number; line: string }[] = [];
  lines.forEach((line) => {
    const matches = [...line.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/g)];
    for (const match of matches) {
      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
      if (!isValidDateParts(day, month, year)) continue;
      let score = 0.72;
      if (/date|dt\.?/i.test(line)) score += 0.15;
      if (!/micr|ifsc|account|a\/c/i.test(line)) score += 0.05;
      candidates.push({
        value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        score: Math.min(score, 0.95),
        line,
      });
    }

    const boxed = line.match(/\b(\d)\s*(\d)\s*(\d)\s*(\d)\s*(\d)\s*(\d)\s*(\d)\s*(\d)\b/);
    if (boxed) {
      const digits = boxed.slice(1).join("");
      const day = Number(digits.slice(0, 2));
      const month = Number(digits.slice(2, 4));
      const year = Number(digits.slice(4, 8));
      if (isValidDateParts(day, month, year)) {
        candidates.push({
          value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          score: 0.82,
          line,
        });
      }
    }
  });
  return candidates.sort((a, b) => b.score - a.score)[0];
}

function findBankName(lines: string[]) {
  const candidates: { value: string; score: number; line: string }[] = [];
  lines.forEach((line, index) => {
    const clean = line.replace(/\s+/g, " ").trim();
    for (const bank of knownBanks) {
      if (clean.toLowerCase().includes(bank.toLowerCase())) {
        candidates.push({ value: bank, score: 0.92 - Math.min(index, 5) * 0.02, line });
      }
    }
    if (/\bbank\b|co-?op|co-?operative|sahakari/i.test(clean) && clean.length <= 80) {
      candidates.push({ value: clean, score: 0.72 - Math.min(index, 5) * 0.02, line });
    }
  });
  return candidates.sort((a, b) => b.score - a.score)[0];
}

function findMicr(lines: string[]) {
  const candidates: { value: string; score: number; line: string }[] = [];
  lines.forEach((line, index) => {
    const bottomBoost = lineScorePosition(index, lines.length) > 0.65 ? 0.12 : 0;
    for (const match of line.matchAll(/\b\d{9}\b/g)) {
      candidates.push({ value: match[0], score: 0.72 + bottomBoost, line });
    }
  });
  return candidates.sort((a, b) => b.score - a.score)[0];
}

function findChequeNumber(lines: string[], dateValue?: string, amountValue?: number) {
  const dateDigits = dateValue?.replace(/\D/g, "") ?? "";
  const amountDigits = amountValue ? String(Math.round(amountValue)) : "";
  const candidates: { value: string; score: number; line: string }[] = [];

  lines.forEach((line, index) => {
    const normalizedLine = normalizeNumericText(line);
    const position = lineScorePosition(index, lines.length);
    const isBottom = position >= 0.55;
    const isAmountLine = /₹|rs\.?|inr|rupees|amount|\*\*/i.test(line);
    const isDateLine = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|date|dt\.?/i.test(line);
    const hasMicrHint = /micr|codeline|⑆|⑈|⑉|chq|cheque/i.test(line) || isBottom;

    for (const match of normalizedLine.matchAll(/\b\d{6}\b/g)) {
      const value = match[0];
      if (value === dateDigits || value === amountDigits) continue;
      if (isDateLine) continue;
      if (isAmountLine && !hasMicrHint) continue;
      let score = 0.48;
      if (isBottom) score += 0.28;
      if (hasMicrHint) score += 0.12;
      if (/cheque|chq/i.test(line)) score += 0.08;
      if (/\b\d{9}\b/.test(normalizedLine)) score += 0.05;
      if (/[,.]/.test(line)) score -= 0.12;
      candidates.push({ value, score: Math.max(0, Math.min(score, 0.95)), line });
    }
  });

  return candidates.sort((a, b) => b.score - a.score)[0];
}

function findAmount(lines: string[], chequeNumber?: string, micrCode?: string) {
  const candidates: { value: number; score: number; line: string }[] = [];
  const excluded = new Set([chequeNumber, micrCode].filter(Boolean));

  lines.forEach((line, index) => {
    const isBottomMicrRegion = lineScorePosition(index, lines.length) > 0.65 && /\b\d{6}\b.*\b\d{9}\b|\b\d{9}\b.*\b\d{6}\b/.test(line);
    const hasCurrencyHint = /₹|rs\.?|inr|amount|rupees|\*\*/i.test(line);
    const hasDecimalOrComma = /[\d],[\d]|[\d]\.\d{1,2}/.test(line);

    const matches = [...line.matchAll(/(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+|\d{4,9})(?:\.\d{1,2})?/gi)];
    for (const match of matches) {
      const raw = match[0];
      const normalized = normalizeNumericText(raw).replace(/[^\d.]/g, "");
      if (!normalized) continue;
      if (excluded.has(normalized)) continue;
      if (/^\d{6}$/.test(normalized) && !hasCurrencyHint && !hasDecimalOrComma) continue;
      if (/^\d{9}$/.test(normalized)) continue;
      const value = Number(normalized);
      if (!Number.isFinite(value) || value <= 0) continue;
      if (value < 100 && !hasCurrencyHint) continue;

      let score = 0.4;
      if (hasCurrencyHint) score += 0.28;
      if (hasDecimalOrComma) score += 0.16;
      if (/amount|rupees/i.test(line)) score += 0.12;
      if (isBottomMicrRegion) score -= 0.28;
      if (value >= 1000) score += 0.08;
      candidates.push({ value, score: Math.max(0, Math.min(score, 0.95)), line });
    }
  });

  return candidates.sort((a, b) => b.score - a.score || b.value - a.value)[0];
}

function findPayee(lines: string[]) {
  const candidates: { value: string; score: number; line: string }[] = [];
  lines.forEach((line) => {
    const clean = line.replace(/\s+/g, " ").trim();
    const payMatch = clean.match(/(?:pay(?:\s+to)?|payee|name)\s*[:\-]?\s*(.+?)(?:\s+or\s+order|\s+bearer|$)/i);
    if (payMatch?.[1]) {
      const value = payMatch[1].replace(/rupees|amount|₹|rs\.?/gi, "").trim();
      if (value.length >= 3 && !/\d{4,}/.test(value)) candidates.push({ value: value.slice(0, 80), score: 0.72, line });
    }
    if (/account holder|a\/c holder/i.test(clean)) {
      const value = clean.replace(/account holder|a\/c holder|name|[:\-]/gi, "").trim();
      if (value.length >= 3) candidates.push({ value: value.slice(0, 80), score: 0.6, line });
    }
  });
  return candidates.sort((a, b) => b.score - a.score)[0];
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

  const dateCandidate = findDate(lines);
  if (dateCandidate) {
    fields.chequeDate = dateCandidate.value;
    fieldConfidence.chequeDate = dateCandidate.score;
  }

  const micrCandidate = findMicr(lines);
  if (micrCandidate) {
    fields.micrCode = micrCandidate.value;
    fieldConfidence.micrCode = micrCandidate.score;
  }

  const amountCandidate = findAmount(lines, undefined, fields.micrCode);
  if (amountCandidate) {
    fields.amount = amountCandidate.value;
    fieldConfidence.amount = amountCandidate.score;
  }

  const chequeCandidate = findChequeNumber(lines, fields.chequeDate, fields.amount);
  if (chequeCandidate) {
    fields.chequeNumber = chequeCandidate.value;
    fieldConfidence.chequeNumber = chequeCandidate.score;
    if (fields.amount && String(Math.round(fields.amount)) === fields.chequeNumber) {
      delete fields.amount;
      fieldConfidence.amount = 0;
    }
  }

  if (!fields.amount) {
    const retryAmount = findAmount(lines, fields.chequeNumber, fields.micrCode);
    if (retryAmount) {
      fields.amount = retryAmount.value;
      fieldConfidence.amount = retryAmount.score;
    }
  }

  const bankCandidate = findBankName(lines);
  if (bankCandidate) {
    fields.bankName = bankCandidate.value;
    fieldConfidence.bankName = bankCandidate.score;
  }

  const branchLine = lines.find((line) => /branch/i.test(line));
  if (branchLine) {
    fields.branch = branchLine.replace(/branch/gi, "").replace(/[:|-]/g, "").trim();
    fieldConfidence.branch = 0.55;
  }

  const payeeCandidate = findPayee(lines);
  if (payeeCandidate) {
    fields.accountHolderName = payeeCandidate.value;
    fields.customerName = payeeCandidate.value;
    fieldConfidence.accountHolderName = payeeCandidate.score;
    fieldConfidence.customerName = payeeCandidate.score;
  }

  const confidence = confidenceAverage(fieldConfidence);

  return {
    fields,
    fieldConfidence,
    confidence,
    candidates: {
      chequeNumber: chequeCandidate,
      amount: amountCandidate,
      date: dateCandidate,
      bank: bankCandidate,
      micr: micrCandidate,
      payee: payeeCandidate,
    },
  };
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
  formData.append("detectOrientation", "true");
  formData.append("isOverlayRequired", "true");
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

function parseJsonFromText(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  return JSON.parse(candidate);
}

async function scanWithOpenAI(imageDataUrl: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Extract Indian bank cheque fields as JSON only.",
                "Rules: chequeNumber must be exactly 6 digits from bottom/MICR region.",
                "Do not use amount, date, IFSC, MICR, or account number as chequeNumber.",
                "Amount must be the payable rupee amount, not cheque number or MICR.",
                "Return fields, rawText, confidence, and per-field confidence 0-1.",
              ].join(" "),
            },
            { type: "input_image", image_url: imageDataUrl },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI OCR failed: ${res.status}`);

  const payload = await res.json();
  const outputText =
    payload.output_text ??
    payload.output?.flatMap((item: { content?: { text?: string }[] }) => item.content ?? [])
      ?.map((content: { text?: string }) => content.text)
      ?.filter(Boolean)
      ?.join("\n");
  if (!outputText) return null;
  const parsed = parseJsonFromText(outputText);
  const fields: ExtractedChequeFields = {
    customerName: parsed.fields?.customerName ?? parsed.customerName ?? undefined,
    chequeNumber: parsed.fields?.chequeNumber ?? parsed.chequeNumber ?? undefined,
    bankName: parsed.fields?.bankName ?? parsed.bankName ?? undefined,
    chequeDate: normalizeDate(parsed.fields?.chequeDate ?? parsed.chequeDate) ?? undefined,
    accountHolderName: parsed.fields?.accountHolderName ?? parsed.accountHolderName ?? undefined,
    amount: Number(parsed.fields?.amount ?? parsed.amount) || undefined,
    micrCode: parsed.fields?.micrCode ?? parsed.micrCode ?? undefined,
    ifscCode: parsed.fields?.ifscCode ?? parsed.ifscCode ?? undefined,
    branch: parsed.fields?.branch ?? parsed.branch ?? undefined,
  };
  const fieldConfidence = { ...emptyFieldConfidence, ...(parsed.fieldConfidence ?? parsed.field_confidence ?? {}) };
  return {
    ok: true,
    provider: "openai" as const,
    fields,
    rawText: parsed.rawText ?? outputText,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || confidenceAverage(fieldConfidence))),
    fieldConfidence,
  };
}

const providers: OcrProvider[] = [
  { name: "ocrspace", scan: scanWithOcrSpace },
  { name: "openai", scan: scanWithOpenAI },
];

function mergeResults(primary: ChequeOcrResult, fallback: ChequeOcrResult) {
  const fields = { ...primary.fields };
  const fieldConfidence = { ...primary.fieldConfidence };

  for (const key of Object.keys(emptyFieldConfidence) as (keyof ExtractedChequeFields)[]) {
    const fallbackValue = fallback.fields[key];
    if (fallbackValue === undefined || fallbackValue === null || fallbackValue === "") continue;
    if (!fields[key] || (fallback.fieldConfidence[key] ?? 0) > (fieldConfidence[key] ?? 0)) {
      (fields as Record<keyof ExtractedChequeFields, unknown>)[key] = fallbackValue;
      fieldConfidence[key] = fallback.fieldConfidence[key] ?? fallback.confidence;
    }
  }

  return {
    ...primary,
    provider: `${primary.provider}+${fallback.provider}` as ChequeOcrResult["provider"],
    fields,
    rawText: [primary.rawText, fallback.rawText].filter(Boolean).join("\n\n--- fallback OCR ---\n\n"),
    confidence: Math.max(primary.confidence, confidenceAverage(fieldConfidence)),
    fieldConfidence,
    warning:
      primary.confidence < 0.75
        ? "OCR confidence was low, so fallback extraction was used. Please verify highlighted fields."
        : primary.warning,
  };
}

export async function scanChequeImage(imageDataUrl: string): Promise<ChequeOcrResult> {
  let bestResult: ChequeOcrResult | null = null;

  for (const provider of providers) {
    try {
      const result = await provider.scan(imageDataUrl);
      if (!result) continue;
      if (!bestResult) {
        bestResult = result;
      } else {
        bestResult = mergeResults(bestResult, result);
      }
      if (bestResult.confidence >= 0.75 && provider.name === "ocrspace") return bestResult;
    } catch {
      continue;
    }
  }

  if (bestResult) return bestResult;

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
