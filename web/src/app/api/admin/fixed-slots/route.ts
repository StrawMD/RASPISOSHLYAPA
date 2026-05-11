import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validateFixedSlots } from "@/lib/validate-fixed-slots";

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function requireAdminOnly() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return null;
  }
  return session;
}

async function requirePlannerOrAdmin() {
  const session = await auth();
  if (
    !session?.user ||
    !["admin", "schedule_manager"].includes(session.user.role)
  ) {
    return null;
  }
  return session;
}

/** GET: загрузить фиксированные слоты месяца (админ и составитель графика). */
export async function GET(req: NextRequest) {
  if (!(await requirePlannerOrAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const year = parseInt(searchParams.get("year") ?? "0", 10);
  const month = parseInt(searchParams.get("month") ?? "0", 10);
  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: "year and month required" }, { status: 400 });
  }

  const record = await prisma.month.findUnique({
    where: { year_month: { year, month } },
    select: { solverFixedSlots: true },
  });

  const fixedSlots = safeJson<Record<string, Record<string, string[]>>>(
    record?.solverFixedSlots ?? "{}",
    {}
  );

  return NextResponse.json({ fixedSlots });
}

/** PATCH: сохранить JSON фиксированных слотов (только admin). */
export async function PATCH(req: NextRequest) {
  if (!(await requireAdminOnly())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const year = body.year as number;
  const month = body.month as number;
  const rawFixed = body.fixedSlots;

  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: "year and month required" }, { status: 400 });
  }

  const posts = await prisma.post.findMany({ orderBy: { sortOrder: "asc" } });
  const employees = await prisma.employee.findMany();
  const employeesForValidation = employees.map((e) => ({
    name: e.name,
    allowedPosts: safeJson<string[]>(e.allowedPosts, []),
  }));

  const check = validateFixedSlots(
    rawFixed,
    year,
    month,
    posts.map((p) => ({ id: p.id, shiftHours: p.shiftHours })),
    employeesForValidation
  );

  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  await prisma.month.upsert({
    where: { year_month: { year, month } },
    create: {
      year,
      month,
      normHours: 0,
      status: "collecting",
      solverFixedSlots: JSON.stringify(check.data),
    },
    update: { solverFixedSlots: JSON.stringify(check.data) },
  });

  return NextResponse.json({ ok: true, fixedSlots: check.data });
}
