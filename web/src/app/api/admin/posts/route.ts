import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function checkAdmin() {
  const session = await auth();
  if (!session?.user || !["admin", "schedule_manager"].includes(session.user.role)) {
    return null;
  }
  return session;
}

function safeJson<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

export async function GET() {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const posts = await prisma.post.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(
    posts.map((p) => ({
      ...p,
      activeWeekdays: safeJson<number[]>(p.activeWeekdays, []),
      specificDays: safeJson<number[]>(p.specificDays, []),
    }))
  );
}

export async function POST(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const maxOrder = await prisma.post.aggregate({ _max: { sortOrder: true } });

  const post = await prisma.post.create({
    data: {
      id: body.id || `post_${randomUUID().slice(0, 8)}`,
      name: body.name,
      shiftHours: body.shiftHours ?? 12,
      staffRequired: body.staffRequired ?? 1,
      staffRequiredDay: body.staffRequiredDay ?? null,
      staffRequiredNight: body.staffRequiredNight ?? null,
      modality: body.modality ?? "",
      weekdayActive: body.weekdayActive ?? true,
      weekendActive: body.weekendActive ?? false,
      activeWeekdays: JSON.stringify(body.activeWeekdays ?? []),
      specificDays: JSON.stringify(body.specificDays ?? []),
      sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
    },
  });

  return NextResponse.json({
    ...post,
    activeWeekdays: safeJson<number[]>(post.activeWeekdays, []),
    specificDays: safeJson<number[]>(post.specificDays, []),
  });
}

export async function PUT(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const aw: number[] = body.activeWeekdays ?? [];
  const hasWeekday = aw.some((d: number) => d < 5);
  const hasWeekend = aw.some((d: number) => d >= 5);
  const post = await prisma.post.update({
    where: { id: body.id },
    data: {
      name: body.name,
      shiftHours: body.shiftHours,
      staffRequired: body.staffRequired,
      staffRequiredDay: body.staffRequiredDay ?? null,
      staffRequiredNight: body.staffRequiredNight ?? null,
      modality: body.modality ?? "",
      weekdayActive: aw.length > 0 ? hasWeekday : body.weekdayActive,
      weekendActive: aw.length > 0 ? hasWeekend : body.weekendActive,
      activeWeekdays: JSON.stringify(body.activeWeekdays ?? []),
      specificDays: JSON.stringify(body.specificDays ?? []),
      sortOrder: body.sortOrder,
    },
  });

  return NextResponse.json({
    ...post,
    activeWeekdays: safeJson<number[]>(post.activeWeekdays, []),
    specificDays: safeJson<number[]>(post.specificDays, []),
  });
}

export async function PATCH(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const ids: unknown = body?.order;
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) {
    return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  }

  await prisma.$transaction(
    (ids as string[]).map((id, index) =>
      prisma.post.update({
        where: { id },
        data: { sortOrder: index },
      })
    )
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await checkAdmin();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.post.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
