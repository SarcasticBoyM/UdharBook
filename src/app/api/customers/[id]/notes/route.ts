import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

const schema = z.object({
  note: z.string().min(1).max(2000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const body = schema.parse(await request.json());
    const note = await prisma.customerNote.create({
      data: {
        customerId: id,
        note: body.note,
        createdById: session.id,
      },
      include: { createdBy: { select: { name: true } } },
    });

    await logActivity({
      action: "customer_note_added",
      userId: session.id,
      customerId: id,
    });

    return NextResponse.json(note, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
