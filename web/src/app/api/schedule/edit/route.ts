import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { workNormHours } from "@/lib/rates";

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

  const sp = safeJson<{
    normHours?: number;
    relaxed?: boolean;
    unfilled?: { postId: string; post: string; day: number; kind: string; count: number }[];
    unfilledCount?: number;
    overtime?: { name: string; overTarget: number; overCeiling: number }[];
    emergencyOvertimeTotal?: number;
  }>(version.solverParams, {});

  let normHours = version.month.normHours ?? 0;
  if (normHours <= 0 && typeof sp.normHours === "number" && sp.normHours > 0) {
    normHours = sp.normHours;
  }

  const posts = await prisma.post.findMany({ orderBy: { sortOrder: "asc" } });
  const employees = await prisma.employee.findMany({ orderBy: { name: "asc" } });

  // Пожелания на месяц этой версии — чтобы редактор мог подсветить
  // «принуждение к исключению» (вообще не ставить / медотвод / недоступный
  // день / не сутки-ночь по дню недели) и посчитать сводку.
  const prefRows = await prisma.preference.findMany({
    where: { monthId: version.month.id },
    include: { employee: { select: { name: true } } },
  });
  const empByName = new Map(employees.map((e) => [e.name, e]));

  // Доступность сотрудника на месяц (для честной цели/% в сводке): тот же расчёт,
  // что и в генерации — объединяем отсутствия из Availability, недоступные дни из
  // пожеланий и регулярную недельную недоступность профиля.
  const daysInMonth = new Date(version.month.year, version.month.month, 0).getDate();
  const availabilityRows = await prisma.availability.findMany({
    where: { monthId: version.month.id },
    include: { employee: { select: { name: true } } },
  });
  const absentByName: Record<string, Set<number>> = {};
  const addAbsent = (name: string, days: number[]) => {
    const set = absentByName[name] ?? (absentByName[name] = new Set<number>());
    for (const d of days) set.add(d);
  };
  for (const av of availabilityRows) {
    addAbsent(av.employee.name, safeJson<number[]>(av.unavailableDays, []));
  }
  for (const pr of prefRows) {
    addAbsent(pr.employee.name, safeJson<number[]>(pr.unavailableDays, []));
  }
  for (const e of employees) {
    const dows = safeJson<number[]>(e.recurringUnavailableDows, []);
    if (dows.length === 0) continue;
    const dowSet = new Set(dows);
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = (new Date(version.month.year, version.month.month - 1, d).getDay() + 6) % 7;
      if (dowSet.has(dow)) addAbsent(e.name, [d]);
    }
  }
  const availableDaysByName: Record<string, number> = {};
  for (const e of employees) {
    const absent = absentByName[e.name]?.size ?? 0;
    availableDaysByName[e.name] = Math.max(0, daysInMonth - absent);
  }

  // Коэффициент доступности по РАБОЧЕЙ норме (как в генерации): доступная норма
  // (будни×6 минус праздники/предпраздничные, без дней отпуска) ÷ полная норма
  // месяца. Так отображаемая цель совпадает с тем, что держит солвер.
  const holidays = await prisma.holiday.findMany({
    where: { year: version.month.year },
  });
  const holidaySet = new Set(holidays.map((h) => h.date));
  const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  const isHolidayDate = (d: Date) => holidaySet.has(fmtDate(d));
  const fullWorkNorm = workNormHours(
    version.month.year,
    version.month.month,
    isHolidayDate,
  );
  const availFactorByName: Record<string, number> = {};
  for (const e of employees) {
    const absentSet = absentByName[e.name] ?? new Set<number>();
    const availWorkNorm = workNormHours(
      version.month.year,
      version.month.month,
      isHolidayDate,
      (day) => !absentSet.has(day),
    );
    availFactorByName[e.name] =
      fullWorkNorm > 0
        ? Math.max(0, Math.min(1, availWorkNorm / fullWorkNorm))
        : 1;
  }

  const prefsByName: Record<string, unknown> = {};
  for (const pr of prefRows) {
    const name = pr.employee.name;
    const pp = safeJson<Record<string, string>>(pr.postPreferences, {});
    const avoidHardPosts = Object.entries(pp)
      .filter(([, lvl]) => lvl === "avoid_hard")
      .map(([pid]) => pid);
    const psp = safeJson<Record<string, Record<string, string>>>(
      pr.postShiftPrefs,
      {},
    );
    const postShiftAvoidHard: Record<string, { full?: boolean; day?: boolean; night?: boolean }> = {};
    for (const [pid, byKind] of Object.entries(psp)) {
      const flags: { full?: boolean; day?: boolean; night?: boolean } = {};
      if (byKind?.full === "avoid_hard") flags.full = true;
      if (byKind?.day === "avoid_hard") flags.day = true;
      if (byKind?.night === "avoid_hard") flags.night = true;
      if (Object.keys(flags).length > 0) postShiftAvoidHard[pid] = flags;
    }
    prefsByName[name] = {
      avoidHardPosts,
      postShiftAvoidHard,
      unavailableDays: safeJson<number[]>(pr.unavailableDays, []),
      dowShiftAvoid: safeJson<Record<string, { full?: boolean; night?: boolean }>>(
        pr.dowShiftAvoid,
        {},
      ),
      medicalRestriction: empByName.get(name)?.medicalRestriction ?? "none",
      maxFull: pr.maxFull,
      maxNights: pr.maxNights,
    };
  }

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
    relaxed: Boolean(sp.relaxed),
    unfilled: sp.unfilled ?? [],
    unfilledCount: sp.unfilledCount ?? 0,
    overtime: sp.overtime ?? [],
    emergencyOvertimeTotal: sp.emergencyOvertimeTotal ?? 0,
    posts,
    employees: employees.map((e) => ({
      id: e.id,
      name: e.name,
      rate: e.rate,
      targetRate: e.targetRate,
      maxRate: e.maxRate,
      medicalRestriction: e.medicalRestriction,
      allowedPosts: safeJson(e.allowedPosts, []),
      availableDays: availableDaysByName[e.name] ?? daysInMonth,
      daysInMonth,
      availFactor: availFactorByName[e.name] ?? 1,
    })),
    prefsByName,
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
