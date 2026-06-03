import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { scanChequeImage } from "@/lib/ocr/cheque-ocr";
import { requireShopId } from "@/lib/tenant";

const scanSchema = z.object({
  imageDataUrl: z.string().min(100),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  requireShopId(request, session);

  try {
    const { imageDataUrl } = scanSchema.parse(await request.json());
    const result = await scanChequeImage(imageDataUrl);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        provider: "manual",
        fields: {},
        rawText: "",
        confidence: 0,
        fieldConfidence: {
          chequeNumber: 0,
          bankName: 0,
          chequeDate: 0,
          accountHolderName: 0,
          amount: 0,
          micrCode: 0,
          ifscCode: 0,
          branch: 0,
        },
        warning: "Could not detect cheque details. Please enter or verify manually.",
      },
      { status: 200 }
    );
  }
}
