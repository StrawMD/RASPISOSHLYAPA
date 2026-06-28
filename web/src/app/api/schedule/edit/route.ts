import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { workNormHours, resolveMonthNorm } from "@/lib/rates";

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
    ignoreFixedSlots?: boolean;
  }>(version.solverParams, {});

  // Источник истины нормы для ЧЕРНОВИКА — то, с чем его реально сгенерировали
  // (solverParams.normHours): кастомное значение, заданное админом перед
  // генерацией, либо рассчитанная норма месяца. Снимок month.normHours и
  // повторный resolveMonthNorm — только запасной вариант для старых версий.
  let normHours =
    typeof sp.normHours === "number" && sp.normHours > 0
      ? sp.normHours
      : version.month.normHours ?? 0;

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
  // Отпуск (Availability) — единственный источник, который урезает цель/часы
  // в сводке (как и в генерации). Регулярная недоступность по дням недели,
  // «не могу» из анкеты и белый список ограничивают только расстановку, но
  // НЕ снижают норму: ставка 1.0 = полные часы, распределённые по доступным дням.
  const vacationByName: Record<string, Set<number>> = {};
  for (const av of availabilityRows) {
    const days = safeJson<number[]>(av.unavailableDays, []);
    vacationByName[av.employee.name] = new Set(days);
  }
  // «Доступно дней» для сводки — по отпуску (то, что реально влияет на норму).
  const availableDaysByName: Record<string, number> = {};
  for (const e of employees) {
    const absent = vacationByName[e.name]?.size ?? 0;
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

  // Запасной источник нормы (для старых версий без solverParams.normHours):
  // override из Setting `monthNorms` или авто-расчёт по кадровой формуле.
  // Если версия знает свою норму (sp.normHours) — её НЕ перетираем, чтобы в
  // черновике часы считались от того, с чем он реально сгенерирован
  // (в т.ч. от кастомной цели, заданной админом).
  if (normHours <= 0) {
    const monthNormsRow = await prisma.setting.findUnique({
      where: { key: "monthNorms" },
    });
    const normOverrides = safeJson<Record<string, number>>(
      monthNormsRow?.value ?? "{}",
      {},
    );
    const resolvedNorm = resolveMonthNorm(
      version.month.year,
      version.month.month,
      isHolidayDate,
      normOverrides,
    );
    if (resolvedNorm > 0) {
      normHours = resolvedNorm;
    }
  }
  const availFactorByName: Record<string, number> = {};
  for (const e of employees) {
    const vacationSet = vacationByName[e.name] ?? new Set<number>();
    const availWorkNorm = workNormHours(
      version.month.year,
      version.month.month,
      isHolidayDate,
      (day) => !vacationSet.has(day),
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
    fixedSlots: safeJson<Record<string, Record<string, string[]>>>(
      version.month.solverFixedSlots ?? "{}",
      {},
    ),
    employeeHours: safeJson(version.employeeHours, {}),
    relaxed: Boolean(sp.relaxed),
    unfilled: sp.unfilled ?? [],
    unfilledCount: sp.unfilledCount ?? 0,
    overtime: sp.overtime ?? [],
    emergencyOvertimeTotal: sp.emergencyOvertimeTotal ?? 0,
    ignoreFixedSlots: Boolean(sp.ignoreFixedSlots),
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
