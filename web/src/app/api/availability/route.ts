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

export async function POST(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { employeeId, year, month, unavailableDays, comment } = body;

  let monthRecord = await prisma.month.findUnique({
    where: { year_month: { year, month } },
  });

  if (!monthRecord) {
    monthRecord = await prisma.month.create({
      data: { year, month, normHours: 0, status: "collecting" },
    });
  }

  const record = await prisma.availability.upsert({
    where: {
      employeeId_monthId: { employeeId, monthId: monthRecord.id },
    },
    update: {
      unavailableDays: JSON.stringify(unavailableDays),
      comment,
      submittedAt: new Date(),
    },
    create: {
      employeeId,
      monthId: monthRecord.id,
      unavailableDays: JSON.stringify(unavailableDays),
      comment,
    },
  });

  return NextResponse.json({ ok: true, id: record.id });
}

export async function DELETE(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.availability.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
