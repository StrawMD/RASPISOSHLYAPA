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

  if (!year || !month) {
    return NextResponse.json({ error: "year and month required" }, { status: 400 });
  }

  const monthRecord = await prisma.month.findUnique({
    where: { year_month: { year, month } },
  });

  if (!monthRecord) {
    return NextResponse.json([]);
  }

  const versions = await prisma.scheduleVersion.findMany({
    where: { monthId: monthRecord.id },
    orderBy: { versionNumber: "desc" },
    include: {
      createdBy: { select: { login: true, employee: { select: { name: true } } } },
      _count: { select: { edits: true } },
    },
  });

  return NextResponse.json(
    versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      name: v.name,
      status: v.status,
      objectiveValue: v.objectiveValue,
      createdAt: v.createdAt.toISOString(),
      createdBy: v.createdBy?.employee?.name ?? v.createdBy?.login ?? null,
      editCount: v._count.edits,
    }))
  );
}

export async function PUT(req: NextRequest) {
  const session = await checkAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { id, action } = body;

  if (action === "publish") {
    const version = await prisma.scheduleVersion.findUnique({
      where: { id },
      include: { month: true },
    });
    if (!version) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.scheduleVersion.updateMany({
        where: { monthId: version.monthId, status: "published" },
        data: { status: "archived" },
      }),
      prisma.scheduleVersion.update({
        where: { id },
        data: { status: "published" },
      }),
      prisma.month.update({
        where: { id: version.monthId },
        data: { status: "published" },
      }),
    ]);

    return NextResponse.json({ ok: true });
  }

  if (action === "archive") {
    await prisma.scheduleVersion.update({
      where: { id },
      data: { status: "archived" },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Only admin can delete" }, { status: 403 });
    }
    await prisma.scheduleVersion.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }

  if (action === "rename") {
    await prisma.scheduleVersion.update({
      where: { id },
      data: { name: body.name },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
