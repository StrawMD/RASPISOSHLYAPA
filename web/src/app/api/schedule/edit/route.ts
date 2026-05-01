import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !["admin", "schedule_manager"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const versionId = searchParams.get("versionId");

  if (!versionId) {
    return NextResponse.json({ error: "versionId required" }, { status: 400 });
  }

  const version = await prisma.scheduleVersion.findUnique({
    where: { id: versionId },
    include: {
      month: true,
      edits: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { user: { select: { login: true, employee: { select: { name: true } } } } },
      },
    },
  });

  if (!version) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let normHours = version.month.normHours ?? 0;
  if (normHours <= 0 && version.solverParams) {
    const sp = safeJson<{ normHours?: number }>(version.solverParams, {});
    if (typeof sp.normHours === "number" && sp.normHours > 0) {
      normHours = sp.normHours;
    }
  }

  const posts = await prisma.post.findMany({ orderBy: { sortOrder: "asc" } });
  const employees = await prisma.employee.findMany({ orderBy: { name: "asc" } });

  return NextResponse.json({
    version: {
      id: version.id,
      versionNumber: version.versionNumber,
      name: version.name,
      status: version.status,
      year: version.month.year,
      month: version.month.month,
      normHours,
    },
    schedule: safeJson(version.data, {}),
    employeeHours: safeJson(version.employeeHours, {}),
    posts,
    employees: employees.map((e) => ({
      id: e.id,
      name: e.name,
      rate: e.rate,
      maxRate: e.maxRate,
      allowedPosts: safeJson(e.allowedPosts, []),
    })),
    recentEdits: version.edits.map((e) => ({
      id: e.id,
      day: e.day,
      postId: e.postId,
      editType: e.editType,
      oldValue: e.oldValue,
      newValue: e.newValue,
      userName: e.user.employee?.name ?? e.user.login,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !["admin", "schedule_manager"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { versionId, day, postId, editType, oldValue, newValue } = body;

  const version = await prisma.scheduleVersion.findUnique({
    where: { id: versionId },
  });

  if (!version) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const schedule = safeJson<Record<string, Record<string, string[]>>>(version.data, {});
  const dayStr = String(day);

  if (!schedule[dayStr]) schedule[dayStr] = {};
  if (!schedule[dayStr][postId]) schedule[dayStr][postId] = [];

  if (editType === "assign") {
    if (!schedule[dayStr][postId].includes(newValue)) {
      schedule[dayStr][postId].push(newValue);
    }
  } else if (editType === "remove") {
    schedule[dayStr][postId] = schedule[dayStr][postId].filter(
      (p: string) => p !== oldValue
    );
  } else if (editType === "swap") {
    schedule[dayStr][postId] = schedule[dayStr][postId].map((p: string) =>
      p === oldValue ? newValue : p
    );
  }

  // Recalculate hours
  const posts = await prisma.post.findMany();
  const postMap = new Map(posts.map((p) => [p.id, p]));
  const hours: Record<string, number> = {};

  for (const [, dayData] of Object.entries(schedule)) {
    for (const [pid, people] of Object.entries(dayData)) {
      const post = postMap.get(pid);
      for (const person of people as string[]) {
        const name = person.replace(/\([сдн]\)$/, "");
        const typeMatch = person.match(/\(([сдн])\)$/);
        const h = typeMatch
          ? typeMatch[1] === "с" ? 24 : 12
          : (post?.shiftHours ?? 12);
        hours[name] = (hours[name] ?? 0) + h;
      }
    }
  }

  await prisma.$transaction([
    prisma.scheduleVersion.update({
      where: { id: versionId },
      data: {
        data: JSON.stringify(schedule),
        employeeHours: JSON.stringify(hours),
      },
    }),
    prisma.scheduleEdit.create({
      data: {
        versionId,
        userId: session.user.id,
        day,
        postId,
        editType,
        oldValue: oldValue ? JSON.stringify(oldValue) : null,
        newValue: newValue ? JSON.stringify(newValue) : null,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, schedule, employeeHours: hours });
}
