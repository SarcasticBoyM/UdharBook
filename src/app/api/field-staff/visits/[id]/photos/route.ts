import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { isFieldWorker } from "@/lib/field-tracking";

const photoSchema = z.object({
  url: z.string().url(),
  fileType: z.string().optional(),
  notes: z.string().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const shopId = requireShopId(request, session);
    const body = photoSchema.parse(await request.json());
    const visit = await prisma.staffVisit.findFirst({ where: { id, shopId } });
    if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    if (!isFieldWorker(session) || visit.staffId !== session.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const photo = await prisma.visitPhoto.create({
      data: {
        shopId,
        visitId: id,
        uploadedById: session.id,
        url: body.url,
        fileType: body.fileType,
        notes: body.notes,
      },
    });

    return NextResponse.json({ success: true, photo });
  } catch (error) {
    console.error("Visit photo save failed", error);
    return NextResponse.json({ success: false, error: "Could not save visit photo" }, { status: 400 });
  }
}
