import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { vcfText } from "@/lib/qrvcard";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { slug } = await params;
  const card = await prisma.qRVCard.findFirst({ where: { slug, isPublic: true } });
  if (!card) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(vcfText(card), {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${card.slug}.vcf"`,
    },
  });
}
