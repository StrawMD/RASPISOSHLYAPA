import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

function maxConsecutive(days: number[], daysInMonth: number): number {
  if (days.length === 0) return 0;
  const set = new Set(days);
  let max = 0;
  let run = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (set.has(d)) {
      run++;
      if (run > max) max = run;
    } else {
      run = 0;
    }
  }
  return max;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    employeeId, year, month,
    pref24hFull, pref24hDay, pref24hNight, shiftTimeMode,
    postPreferences, unavailableDays, weekdayPref, weekendPref,
    dayOfWeekPrefs, desiredDates, comment,
    softUnavailableDays, loadPref, maxNights, maxFull, minShifts,
    avoidWith, preferWith, avoidSamePost,
    postShiftPrefs, dowShiftAvoid,
  } = body;

  const normAvoidSamePost = Boolean(avoidSamePost);

  const ALLOWED_MODES = new Set([
    "only_full",
    "prefer_full",
    "neutral",
    "prefer_day",
    "prefer_night",
  ]);

  // {postId: {full|day|night: "prefer"|"avoid"}} — пожелания по типу смены на
  // суточных постах. Нейтральные/мусорные значения отбрасываем.
  function normPostShiftPrefs(v: unknown): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    if (!v || typeof v !== "object") return out;
    for (const [postId, raw] of Object.entries(v as Record<string, unknown>)) {
      if (typeof postId !== "string" || !raw || typeof raw !== "object") continue;
      const inner: Record<string, string> = {};
      for (const kind of ["full", "day", "night"] as const) {
        const lvl = (raw as Record<string, unknown>)[kind];
        if (lvl === "prefer" || lvl === "avoid") inner[kind] = lvl;
      }
      if (Object.keys(inner).length > 0) out[postId] = inner;
    }
    return out;
  }

  // {dow("1".."7"): {full?|night?|day?: true}} — не ставить тип смены в этот
  // день недели. Только флаги === true, только валидные дни недели.
  function normDowShiftAvoid(v: unknown): Record<string, Record<string, boolean>> {
    const out: Record<string, Record<string, boolean>> = {};
    if (!v || typeof v !== "object") return out;
    for (const [dow, raw] of Object.entries(v as Record<string, unknown>)) {
      if (!/^[1-7]$/.test(dow) || !raw || typeof raw !== "object") continue;
      const inner: Record<string, boolean> = {};
      for (const kind of ["full", "night", "day"] as const) {
        if ((raw as Record<string, unknown>)[kind] === true) inner[kind] = true;
      }
      if (Object.keys(inner).length > 0) out[dow] = inner;
    }
    return out;
  }

  const normPostShift = normPostShiftPrefs(postShiftPrefs);
  const normDowAvoid = normDowShiftAvoid(dowShiftAvoid);
  const normalizedShiftTimeMode =
    typeof shiftTimeMode === "string" && ALLOWED_MODES.has(shiftTimeMode)
      ? shiftTimeMode
      : null;

  const ALLOWED_LOAD = new Set(["less", "normal", "more"]);
  const normalizedLoadPref =
    typeof loadPref === "string" && ALLOWED_LOAD.has(loadPref) && loadPref !== "normal"
      ? loadPref
      : null;

  function toCap(v: unknown): number | null {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 31) {
      return null;
    }
    return v;
  }
  function toNameArray(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return Array.from(
      new Set(
        v.filter((x): x is string => typeof x === "string" && x.trim().length > 0),
      ),
    );
  }

  const normSoftDays: number[] = Array.isArray(softUnavailableDays)
    ? softUnavailableDays.filter(
        (d: unknown) => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 31,
      )
    : [];
  const normAvoidWith = toNameArray(avoidWith);
  const normPreferWith = toNameArray(preferWith).filter(
    (n) => !normAvoidWith.includes(n),
  );

  const isAdmin = ["admin", "schedule_manager"].includes(session.user.role);
  if (!isAdmin && session.user.employeeId !== employeeId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let monthRecord = await prisma.month.findUnique({
    where: { year_month: { year, month } },
  });

  if (!monthRecord) {
    // Гонка при одновременном первом сохранении нескольких сотрудников:
    // месяца ещё нет, и параллельные create по unique [year,month] упали бы
    // с конфликтом. Ловим и перечитываем — победитель уже создал запись.
    try {
      monthRecord = await prisma.month.create({
        data: { year, month, normHours: 0, status: "collecting" },
      });
    } catch {
      monthRecord = await prisma.month.findUnique({
        where: { year_month: { year, month } },
      });
    }
    if (!monthRecord) {
      return NextResponse.json(
        { error: "Не удалось открыть месяц для сохранения" },
        { status: 500 },
      );
    }
  }

  if (!isAdmin) {
    if (monthRecord.status !== "collecting") {
      return NextResponse.json({ error: "Month is locked" }, { status: 400 });
    }
    if (monthRecord.deadline && new Date() > monthRecord.deadline) {
      return NextResponse.json({ error: "Deadline passed" }, { status: 400 });
    }
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const unavail: number[] = unavailableDays ?? [];
  const consecutive = maxConsecutive(unavail, daysInMonth);

  let needsApproval = false;
  if (!isAdmin && unavail.length > 0) {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (employee) {
      const limit = employee.rate >= 1.0 ? 3 : 6;
      if (consecutive > limit) {
        return NextResponse.json({
          error: `Максимум ${limit} дней подряд. У вас ${consecutive}.`,
        }, { status: 400 });
      }
      if (employee.rate >= 1.0 && consecutive > 3) {
        needsApproval = true;
      }
    }
  }

  await prisma.preference.upsert({
    where: {
      employeeId_monthId: { employeeId, monthId: monthRecord.id },
    },
    update: {
      pref24hFull: pref24hFull ?? null,
      pref24hDay: pref24hDay ?? null,
      pref24hNight: pref24hNight ?? null,
      shiftTimeMode: normalizedShiftTimeMode,
      postPreferences: JSON.stringify(postPreferences ?? {}),
      postShiftPrefs: JSON.stringify(normPostShift),
      dowShiftAvoid: JSON.stringify(normDowAvoid),
      unavailableDays: JSON.stringify(unavail),
      needsApproval,
      weekdayPref: weekdayPref ?? null,
      weekendPref: weekendPref ?? null,
      dayOfWeekPrefs: JSON.stringify(dayOfWeekPrefs ?? {}),
      desiredDates: JSON.stringify(desiredDates ?? []),
      comment: comment ?? null,
      softUnavailableDays: JSON.stringify(normSoftDays),
      loadPref: normalizedLoadPref,
      maxNights: toCap(maxNights),
      maxFull: toCap(maxFull),
      minShifts: toCap(minShifts),
      avoidSamePost: normAvoidSamePost,
      avoidWith: JSON.stringify(normAvoidWith),
      preferWith: JSON.stringify(normPreferWith),
      submittedAt: new Date(),
    },
    create: {
      employeeId,
      monthId: monthRecord.id,
      pref24hFull: pref24hFull ?? null,
      pref24hDay: pref24hDay ?? null,
      pref24hNight: pref24hNight ?? null,
      shiftTimeMode: normalizedShiftTimeMode,
      postPreferences: JSON.stringify(postPreferences ?? {}),
      postShiftPrefs: JSON.stringify(normPostShift),
      dowShiftAvoid: JSON.stringify(normDowAvoid),
      unavailableDays: JSON.stringify(unavail),
      needsApproval,
      weekdayPref: weekdayPref ?? null,
      weekendPref: weekendPref ?? null,
      dayOfWeekPrefs: JSON.stringify(dayOfWeekPrefs ?? {}),
      desiredDates: JSON.stringify(desiredDates ?? []),
      comment: comment ?? null,
      softUnavailableDays: JSON.stringify(normSoftDays),
      loadPref: normalizedLoadPref,
      maxNights: toCap(maxNights),
      maxFull: toCap(maxFull),
      minShifts: toCap(minShifts),
      avoidSamePost: normAvoidSamePost,
      avoidWith: JSON.stringify(normAvoidWith),
      preferWith: JSON.stringify(normPreferWith),
    },
  });

  return NextResponse.json({ ok: true });
}
