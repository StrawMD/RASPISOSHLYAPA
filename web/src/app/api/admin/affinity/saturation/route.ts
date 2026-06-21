import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPostActive } from "@/lib/post-active";
import { workNormHours } from "@/lib/rates";
import {
  computeSaturation,
  type SatEmployee,
  type SatPost,
} from "@/lib/saturation";

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const fmtYmd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Полностью ли запрещён сотрудник на посту (не может работать вообще). */
function isFullyBanned(
  post: { id: string; shiftHours: number },
  postPrefs: Record<string, string>,
  shiftPrefs: Record<string, Record<string, string>>,
): boolean {
  if (post.shiftHours === 24) {
    const kinds = shiftPrefs[post.id] ?? {};
    // запрещён, только если перекрыты ВСЕ типы смен (сутки, день и ночь)
    return (
      kinds.full === "avoid_hard" &&
      kinds.day === "avoid_hard" &&
      kinds.night === "avoid_hard"
    );
  }
  return postPrefs[post.id] === "avoid_hard";
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (
    !session?.user ||
    !["admin", "schedule_manager"].includes(session.user.role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const year = parseInt(searchParams.get("year") ?? "");
  const month = parseInt(searchParams.get("month") ?? "");
  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: "Нужны year и month" }, { status: 400 });
  }

  const daysInMonth = new Date(year, month, 0).getDate();

  const [allPosts, postConfigs, employees, holidays, monthRecord] =
    await Promise.all([
      prisma.post.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.monthPostConfig
        .findMany({ where: { month: { year, month } } })
        .catch(() => []),
      prisma.employee.findMany({ orderBy: { name: "asc" } }),
      prisma.holiday.findMany({ where: { year } }),
      prisma.month.findUnique({ where: { year_month: { year, month } } }),
    ]);

  const holidayDates = new Set(holidays.map((h) => h.date));
  const isHolidayDate = (d: Date) =>
    holidayDates.has(fmtYmd(d.getFullYear(), d.getMonth() + 1, d.getDate()));

  const posts = allPosts.filter(isPostActive);

  // Активные дни поста (повторяем логику генерации/солвера).
  const postOverrides: Record<string, number[]> = {};
  for (const p of posts) {
    const aw: number[] = safeJson(p.activeWeekdays, []);
    const sd: number[] = safeJson(p.specificDays, []);
    if (aw.length > 0 || sd.length > 0) {
      const weekdaySet = new Set(aw);
      const specificSet = new Set(sd);
      const days: number[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        if (p.shiftHours !== 24 && holidayDates.has(fmtYmd(year, month, d)))
          continue;
        const dow = (new Date(year, month - 1, d).getDay() + 6) % 7;
        if (weekdaySet.has(dow) || specificSet.has(d)) days.push(d);
      }
      postOverrides[p.id] = days;
    }
  }
  for (const pc of postConfigs) {
    if (pc.mode === "specific") {
      postOverrides[pc.postId] = safeJson(pc.activeDays, []);
    } else if (pc.mode === "weekdays") {
      const config = safeJson<{ weekdays?: number[] }>(pc.config, {});
      const weekdays = new Set(config.weekdays ?? []);
      postOverrides[pc.postId] = Array.from(
        { length: daysInMonth },
        (_, i) => i + 1,
      ).filter((d) => weekdays.has((new Date(year, month - 1, d).getDay() + 6) % 7));
    }
  }

  function activeDaysOf(p: (typeof posts)[number]): number {
    if (postOverrides[p.id]) return postOverrides[p.id].length;
    let n = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, month - 1, d);
      const isWknd = dt.getDay() === 0 || dt.getDay() === 6;
      if (p.shiftHours === 24) {
        n++;
      } else if (isHolidayDate(dt)) {
        // праздник: 12ч-посты не работают
      } else if (isWknd) {
        if (p.weekendActive) n++;
      } else if (p.weekdayActive) {
        n++;
      }
    }
    return n;
  }

  const satPosts: SatPost[] = posts.map((p) => ({
    id: p.id,
    name: p.name,
    shiftHours: p.shiftHours,
    staffRequired: p.staffRequired,
    staffRequiredDay: p.staffRequiredDay,
    staffRequiredNight: p.staffRequiredNight,
    activeDays: activeDaysOf(p),
  }));

  // Недоступность месяца (если месяц заведён).
  const absencesByName = new Map<string, Set<number>>();
  if (monthRecord) {
    const avail = await prisma.availability.findMany({
      where: { monthId: monthRecord.id },
    });
    const empById = new Map(employees.map((e) => [e.id, e.name]));
    for (const a of avail) {
      const name = empById.get(a.employeeId);
      if (name)
        absencesByName.set(name, new Set(safeJson<number[]>(a.unavailableDays, [])));
    }
  }

  const fullNorm = workNormHours(year, month, isHolidayDate);

  const satEmployees: SatEmployee[] = employees.map((e) => {
    const allowed = new Set(safeJson<string[]>(e.allowedPosts, []));
    const postPrefs = safeJson<Record<string, string>>(e.postPreferences, {});
    const shiftPrefs = safeJson<Record<string, Record<string, string>>>(
      e.postShiftPrefs,
      {},
    );
    const recurringDows = new Set(
      safeJson<number[]>(e.recurringUnavailableDows, []),
    );
    const absent = absencesByName.get(e.name) ?? new Set<number>();
    const isAvailableDay = (d: number) => {
      if (absent.has(d)) return false;
      const dow = (new Date(year, month - 1, d).getDay() + 6) % 7;
      return !recurringDows.has(dow);
    };
    const availNorm =
      absent.size > 0 || recurringDows.size > 0
        ? workNormHours(year, month, isHolidayDate, isAvailableDay)
        : fullNorm;

    const eligiblePosts = satPosts
      .filter(
        (p) => allowed.has(p.id) && !isFullyBanned(p, postPrefs, shiftPrefs),
      )
      .map((p) => p.id);

    return {
      name: e.name,
      availableHours: e.rate * availNorm,
      eligiblePosts,
    };
  });

  const results = computeSaturation(satPosts, satEmployees);

  return NextResponse.json({
    year,
    month,
    normHours: monthRecord?.normHours ?? fullNorm,
    posts: results.map((r) => {
      const p = satPosts.find((sp) => sp.id === r.postId)!;
      return { ...r, activeDays: p.activeDays };
    }),
  });
}
