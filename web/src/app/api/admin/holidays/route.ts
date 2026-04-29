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
  const year = parseInt(searchParams.get("year") ?? String(new Date().getFullYear()));

  const holidays = await prisma.holiday.findMany({
    where: { year },
    orderBy: { date: "asc" },
  });

  return NextResponse.json(holidays.map((h) => h.date));
}

export async function PUT(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { year, dates } = body as { year: number; dates: string[] };

  await prisma.$transaction(async (tx) => {
    await tx.holiday.deleteMany({ where: { year } });
    if (dates.length > 0) {
      await tx.holiday.createMany({
        data: dates.map((d) => ({ date: d, year })),
      });
    }
  });

  return NextResponse.json({ ok: true });
}
