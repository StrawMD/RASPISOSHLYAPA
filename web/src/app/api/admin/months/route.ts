import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function checkAdmin() {
  const session = await auth();
  if (!session?.user || !["admin", "schedule_manager"].includes(session.user.role)) {
    return null;
  }
  return session;
}

export async function GET(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const year = parseInt(searchParams.get("year") ?? "0");
  const month = parseInt(searchParams.get("month") ?? "0");

  if (year && month) {
    const m = await prisma.month.findUnique({
      where: { year_month: { year, month } },
    });
    return NextResponse.json(m);
  }

  const months = await prisma.month.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take: 24,
  });
  return NextResponse.json(months);
}

export async function PUT(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { year, month, normHours, deadline, status } = body;

  const data: Record<string, unknown> = {};
  if (normHours !== undefined) data.normHours = normHours;
  if (deadline !== undefined) data.deadline = deadline ? new Date(deadline) : null;
  if (status !== undefined) data.status = status;

  const m = await prisma.month.upsert({
    where: { year_month: { year, month } },
    update: data,
    create: {
      year,
      month,
      normHours: normHours ?? 0,
      deadline: deadline ? new Date(deadline) : null,
      status: status ?? "collecting",
    },
  });

  return NextResponse.json(m);
}
