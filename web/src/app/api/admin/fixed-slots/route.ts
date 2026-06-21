import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { prismaSchemaHint } from "@/lib/prisma-schema-hint";
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

  try {
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

    const [posts, employees] = await Promise.all([
      prisma.post.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.employee.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, rate: true, allowedPosts: true },
      }),
    ]);

    return NextResponse.json({
      fixedSlots,
      posts: posts.map((p) => ({
        id: p.id,
        name: p.name,
        shiftHours: p.shiftHours,
        staffRequired: p.staffRequired,
      })),
      employees: employees.map((e) => ({
        id: e.id,
        name: e.name,
        rate: e.rate,
        allowedPosts: safeJson<string[]>(e.allowedPosts, []),
      })),
    });
  } catch (e: unknown) {
    console.error("[api/admin/fixed-slots GET]", e);
    const hint = prismaSchemaHint(e);
    return NextResponse.json(
      {
        error:
          hint ??
          (e instanceof Error ? e.message : "Ошибка загрузки фиксированных слотов"),
      },
      { status: 500 }
    );
  }
}

/** PATCH: сохранить JSON фиксированных слотов (только admin). */
export async function PATCH(req: NextRequest) {
  if (!(await requireAdminOnly())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
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
  } catch (e: unknown) {
    console.error("[api/admin/fixed-slots PATCH]", e);
    const hint = prismaSchemaHint(e);
    return NextResponse.json(
      {
        error:
          hint ??
          (e instanceof Error ? e.message : "Ошибка сохранения фиксированных слотов"),
      },
      { status: 500 }
    );
  }
}

/** POST: точечная правка ячейки (assign/remove/swap). Только admin. */
export async function POST(req: NextRequest) {
  if (!(await requireAdminOnly())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const year = body.year as number;
    const month = body.month as number;
    const day = body.day as number;
    const postId = body.postId as string;
    const editType = body.editType as string;
    const oldValue = body.oldValue as string | null;
    const newValue = body.newValue as string | null;

    if (!year || !month || !day || !postId || !editType) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const posts = await prisma.post.findMany({ orderBy: { sortOrder: "asc" } });
    const employees = await prisma.employee.findMany();
    const employeesForValidation = employees.map((e) => ({
      name: e.name,
      allowedPosts: safeJson<string[]>(e.allowedPosts, []),
    }));

    const record = await prisma.month.findUnique({
      where: { year_month: { year, month } },
      select: { solverFixedSlots: true },
    });
    const current = safeJson<Record<string, Record<string, string[]>>>(
      record?.solverFixedSlots ?? "{}",
      {},
    );

    const ds = String(day);
    const next = JSON.parse(JSON.stringify(current)) as Record<
      string,
      Record<string, string[]>
    >;
    if (!next[ds]) next[ds] = {};
    const cell = [...(next[ds][postId] ?? [])];

    if (editType === "assign" && newValue) {
      cell.push(newValue);
    } else if (editType === "remove" && oldValue) {
      const i = cell.indexOf(oldValue);
      if (i >= 0) cell.splice(i, 1);
    } else if (editType === "swap" && oldValue && newValue) {
      const i = cell.indexOf(oldValue);
      if (i >= 0) cell[i] = newValue;
    } else {
      return NextResponse.json({ error: "Invalid edit" }, { status: 400 });
    }

    if (cell.length > 0) next[ds][postId] = cell;
    else {
      delete next[ds][postId];
      if (Object.keys(next[ds]).length === 0) delete next[ds];
    }

    const check = validateFixedSlots(
      next,
      year,
      month,
      posts.map((p) => ({ id: p.id, shiftHours: p.shiftHours })),
      employeesForValidation,
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
  } catch (e: unknown) {
    console.error("[api/admin/fixed-slots POST]", e);
    const hint = prismaSchemaHint(e);
    return NextResponse.json(
      {
        error:
          hint ??
          (e instanceof Error ? e.message : "Ошибка правки фиксированных слотов"),
      },
      { status: 500 }
    );
  }
}
