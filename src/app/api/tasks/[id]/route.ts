import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireShopId } from "@/lib/tenant";
import { canAccessTasks, canAssignTasks } from "@/lib/operational-roles";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessTasks(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const shopId = requireShopId(request, session);
  const task = await prisma.task.findFirst({
    where: {
      id,
      shopId,
      ...(!canAssignTasks(session.role) ? { assignedToId: session.id } : {}),
    },
    include: {
      customer: { select: { id: true, partyName: true, outstandingBalance: true, contactNumber: true } },
      assignedTo: { select: { id: true, name: true, role: true } },
      assignedBy: { select: { id: true, name: true, role: true } },
    },
  });

  if (!task) return NextResponse.json({ success: false, error: "Task not found or no longer available." }, { status: 404 });
  return NextResponse.json({ success: true, task });
}
