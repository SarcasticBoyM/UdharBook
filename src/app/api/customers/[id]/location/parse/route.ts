import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseGoogleMapsLocation } from "@/lib/geo";
import { isShopAdminRole } from "@/lib/operational-roles";
import { requireShopId } from "@/lib/tenant";

const schema = z.object({ url: z.string().trim().url().max(2000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!isShopAdminRole(session.role)) return NextResponse.json({ success: false, error: "Only shop admins can parse customer locations." }, { status: 403 });

  try {
    const { id } = await params;
    const shopId = requireShopId(request, session);
    const body = schema.parse(await request.json());
    const exists = await prisma.customer.findFirst({ where: { id, shopId }, select: { id: true } });
    if (!exists) return NextResponse.json({ success: false, error: "Customer not found." }, { status: 404 });

    let expandedUrl = body.url;
    let coordinates = parseGoogleMapsLocation(expandedUrl);
    const hostname = new URL(body.url).hostname.toLowerCase();
    if (!coordinates && ["maps.app.goo.gl", "goo.gl"].includes(hostname)) {
      try {
        const response = await fetch(body.url, { redirect: "follow", signal: AbortSignal.timeout(5000), headers: { "User-Agent": "UdharBook-Maps-Link-Resolver/1.0" } });
        expandedUrl = response.url;
        coordinates = parseGoogleMapsLocation(expandedUrl);
      } catch {
        // The actionable short-link response below is safer than guessing coordinates.
      }
    }
    if (!coordinates) {
      return NextResponse.json({ success: false, error: "Short link could not be parsed. Please paste expanded Google Maps link or enter latitude/longitude." }, { status: 400 });
    }
    return NextResponse.json({ success: true, ...coordinates, expandedUrl });
  } catch {
    return NextResponse.json({ success: false, error: "Enter a valid Google Maps link." }, { status: 400 });
  }
}
