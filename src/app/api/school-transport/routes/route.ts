import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isSchoolTransportAdmin } from "@/lib/school-transport";
const schema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).optional().nullable(), startPointName: z.string().max(200).optional().nullable(), endPointName: z.string().max(200).optional().nullable(), isActive: z.boolean().optional() });
export async function GET() { const s=await getSession(); if(!s)return NextResponse.json({error:"Unauthorized"},{status:401}); if(!isSchoolTransportAdmin(s.role))return NextResponse.json({error:"Forbidden"},{status:403}); return NextResponse.json({ routes: await prisma.schoolTransportRoute.findMany({where:{shopId:s.shopId},orderBy:{createdAt:"desc"}}) }); }
export async function POST(request:Request) { const s=await getSession(); if(!s)return NextResponse.json({error:"Unauthorized"},{status:401}); if(!isSchoolTransportAdmin(s.role))return NextResponse.json({error:"Forbidden"},{status:403}); const b=schema.parse(await request.json()); const route=await prisma.schoolTransportRoute.create({data:{shopId:s.shopId,...b}}); return NextResponse.json({route},{status:201}); }
