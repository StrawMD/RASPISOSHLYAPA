import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runSolver, SolverInput } from "@/lib/solver-bridge";
import { computeTenure } from "@/lib/seniority";
import { validateFixedSlots } from "@/lib/validate-fixed-slots";

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (
    !session?.user ||
    !["admin", "schedule_manager"].includes(session.user.role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { year, month, normHours, timeLimit, seniorityFilter, versionName } =
    body;

  const posts = await prisma.post.findMany({ orderBy: { sortOrder: "asc" } });
  const employees = await prisma.employee.findMany();

  let monthRecord = await prisma.month.findUnique({
    where: { year_month: { year, month } },
  });

  if (!monthRecord) {
    monthRecord = await prisma.month.create({
      data: { year, month, normHours: normHours ?? 0, status: "collecting" },
    });
  }

  const postConfigs = await prisma.monthPostConfig.findMany({
    where: { monthId: monthRecord.id },
  });

  const empConfigs = await prisma.employeeMonthConfig.findMany({
    where: { monthId: monthRecord.id },
  });

  const availabilities = await prisma.availability.findMany({
    where: { monthId: monthRecord.id },
  });

  const preferences = await prisma.preference.findMany({
    where: { monthId: monthRecord.id },
  });

  const holidays = await prisma.holiday.findMany({ where: { year } });
  const holidayDates = new Set(holidays.map((h) => h.date));

  const daysInMonth = new Date(year, month, 0).getDate();

  const postOverrides: Record<string, number[]> = {};

  for (const p of posts) {
    const aw: number[] = safeJson(p.activeWeekdays, []);
    const sd: number[] = safeJson(p.specificDays, []);
    if (aw.length > 0 || sd.length > 0) {
      const weekdaySet = new Set(aw);
      const specificSet = new Set(sd);
      const days: number[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
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
        (_, i) => i + 1
      ).filter((d) => {
        const dow = new Date(year, month - 1, d).getDay();
        return weekdays.has((dow + 6) % 7);
      });
    }
  }

  const absences: Record<string, number[]> = {};
  for (const av of availabilities) {
    const emp = employees.find((e) => e.id === av.employeeId);
    if (emp) {
      absences[emp.name] = safeJson(av.unavailableDays, []);
    }
  }

  for (const ec of empConfigs) {
    const emp = employees.find((e) => e.id === ec.employeeId);
    if (!emp) continue;
    const config = safeJson<{ weekdays?: number[]; specificDays?: number[]; excludedDays?: number[] }>(ec.config, {});
    const existing = new Set(absences[emp.name] ?? []);

    if (ec.mode === "weekdays") {
      const allowed = new Set(config.weekdays ?? []);
      for (let d = 1; d <= daysInMonth; d++) {
        const dow = (new Date(year, month - 1, d).getDay() + 6) % 7;
        if (!allowed.has(dow)) existing.add(d);
      }
    } else if (ec.mode === "specific") {
      const allowed = new Set(config.specificDays ?? []);
      for (let d = 1; d <= daysInMonth; d++) {
        if (!allowed.has(d)) existing.add(d);
      }
    }

    const excluded = config.excludedDays ?? [];
    for (const d of excluded) existing.add(d);

    if (existing.size > 0) {
      absences[emp.name] = Array.from(existing).sort((a, b) => a - b);
    }
  }

  // Cross-month constraints: load previous month's tail
  const exclusions: Record<string, number[]> = {};
  const prevMonth =
    month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

  const prevMonthRecord = await prisma.month.findUnique({
    where: { year_month: prevMonth },
  });

  if (prevMonthRecord) {
    const prevPublished = await prisma.scheduleVersion.findFirst({
      where: { monthId: prevMonthRecord.id, status: "published" },
      orderBy: { versionNumber: "desc" },
    });

    if (prevPublished) {
      const prevSchedule = safeJson<Record<string, Record<string, string[]>>>(prevPublished.data, {});
      const prevDaysInMonth = new Date(prevMonth.year, prevMonth.month, 0).getDate();
      const lastDayData = prevSchedule[String(prevDaysInMonth)] ?? {};

      for (const [, people] of Object.entries(lastDayData)) {
        for (const person of people) {
          const name = person.replace(/\([сдн]\)$/, "");
          if (!exclusions[name]) exclusions[name] = [];
          if (!exclusions[name].includes(1)) exclusions[name].push(1);
        }
      }
    }
  }

  const postPreferences: Record<string, Record<string, string>> = {};
  const shiftPreferences: Record<string, Record<string, boolean | null>> = {};
  const shiftTimeModes: Record<string, string> = {};
  const weekdayPrefs: Record<string, string> = {};
  const weekendPrefs: Record<string, string> = {};
  const dowPrefs: Record<string, Record<string, string>> = {};
  const desiredDates: Record<string, number[]> = {};

  function deriveLegacyShiftTimeMode(
    full: string | null,
    day: string | null,
    night: string | null,
  ): string {
    if (full === "prefer" && day === "avoid" && night === "avoid")
      return "only_full";
    if (full === "prefer") return "prefer_full";
    if (day === "prefer") return "prefer_day";
    return "neutral";
  }

  const VALID_MODES = new Set([
    "only_full",
    "prefer_full",
    "neutral",
    "prefer_day",
  ]);

  for (const pref of preferences) {
    const emp = employees.find((e) => e.id === pref.employeeId);
    if (!emp) continue;

    const ppRaw = safeJson<Record<string, string>>(pref.postPreferences, {});
    if (Object.keys(ppRaw).length > 0) {
      postPreferences[emp.name] = ppRaw;
    } else {
      const legacy: string[] = safeJson(pref.postPriority, []);
      if (legacy.length > 0) {
        const map: Record<string, string> = {};
        legacy.forEach((pid, i) => { map[pid] = i === 0 ? "prefer" : "neutral"; });
        postPreferences[emp.name] = map;
      }
    }

    shiftPreferences[emp.name] = {
      pref_24h_full:
        pref.pref24hFull === "prefer" ? true : pref.pref24hFull === "avoid" ? false : null,
      pref_24h_day:
        pref.pref24hDay === "prefer" ? true : pref.pref24hDay === "avoid" ? false : null,
      pref_24h_night:
        pref.pref24hNight === "prefer" ? true : pref.pref24hNight === "avoid" ? false : null,
    };

    const mode =
      pref.shiftTimeMode && VALID_MODES.has(pref.shiftTimeMode)
        ? pref.shiftTimeMode
        : deriveLegacyShiftTimeMode(
            pref.pref24hFull,
            pref.pref24hDay,
            pref.pref24hNight,
          );
    if (mode && mode !== "neutral") {
      shiftTimeModes[emp.name] = mode;
    }

    if (pref.weekdayPref) weekdayPrefs[emp.name] = pref.weekdayPref;
    if (pref.weekendPref) weekendPrefs[emp.name] = pref.weekendPref;

    const dpRaw = safeJson<Record<string, string>>(pref.dayOfWeekPrefs, {});
    if (Object.keys(dpRaw).length > 0) dowPrefs[emp.name] = dpRaw;

    const ddRaw: number[] = safeJson(pref.desiredDates, []);
    if (ddRaw.length > 0) desiredDates[emp.name] = ddRaw;

    const prefUnavail: number[] = safeJson(pref.unavailableDays, []);
    if (prefUnavail.length > 0) {
      const existing = new Set(absences[emp.name] ?? []);
      for (const d of prefUnavail) existing.add(d);
      absences[emp.name] = Array.from(existing).sort((a, b) => a - b);
    }
  }

  for (const emp of employees) {
    if (!postPreferences[emp.name]) {
      const empPrefs = safeJson<Record<string, string>>(emp.postPreferences, {});
      if (Object.keys(empPrefs).length > 0) {
        postPreferences[emp.name] = empPrefs;
      }
    }
  }

  const employeeTargetHours: Record<string, number> = {};
  const employeeMaxHours: Record<string, number> = {};
  const nh = normHours || monthRecord.normHours;

  for (const emp of employees) {
    const absentDays = (absences[emp.name] ?? []).length;
    const avail = Math.max(0, (daysInMonth - absentDays) / daysInMonth);
    const target = emp.targetRate ?? emp.rate;
    const boundedTarget = Math.min(Math.max(target, emp.rate), emp.maxRate);
    employeeTargetHours[emp.name] = nh * boundedTarget * avail;
    employeeMaxHours[emp.name] = nh * emp.maxRate * avail;
  }

  /** Актуальные фиксы из БД (не только снимок в начале запроса). */
  const monthRow = await prisma.month.findUnique({
    where: { id: monthRecord.id },
    select: { solverFixedSlots: true },
  });
  const rawFixed = safeJson<unknown>(monthRow?.solverFixedSlots ?? "{}", {});
  const employeesForValidation = employees.map((e) => ({
    name: e.name,
    allowedPosts: safeJson<string[]>(e.allowedPosts, []),
  }));
  const fixedCheck = validateFixedSlots(
    rawFixed,
    year,
    month,
    posts.map((p) => ({ id: p.id, shiftHours: p.shiftHours })),
    employeesForValidation
  );
  if (!fixedCheck.ok) {
    return NextResponse.json({ error: fixedCheck.error }, { status: 400 });
  }
  const fixedSlotsForSolver =
    Object.keys(fixedCheck.data).length > 0 ? fixedCheck.data : undefined;
  let fixedSlotsCount = 0;
  if (fixedSlotsForSolver) {
    for (const byPost of Object.values(fixedSlotsForSolver)) {
      for (const labels of Object.values(byPost)) {
        fixedSlotsCount += labels.length;
      }
    }
  }

  const solverInput: SolverInput = {
    posts: posts.map((p) => ({
      id: p.id,
      name: p.name,
      shiftHours: p.shiftHours,
      staffRequired: p.staffRequired,
      staffRequiredDay: p.staffRequiredDay,
      staffRequiredNight: p.staffRequiredNight,
      weekdayActive: p.weekdayActive,
      weekendActive: p.weekendActive,
    })),
    employees: employees.map((e) => {
      const t = computeTenure(e, year);
      return {
        name: e.name,
        rate: e.rate,
        allowedPosts: safeJson(e.allowedPosts, []),
        maxRate: e.maxRate,
        seniority: e.seniority,
        hospitalYears: t.hospitalYears,
        careerYears: t.careerYears,
        seniorityScore: t.score,
      };
    }),
    config: {
      year,
      month,
      normHours: nh,
      postOverrides: Object.keys(postOverrides).length > 0 ? postOverrides : undefined,
      absences,
      exclusions,
      employeeTargetHours,
      employeeMaxHours,
      fixedSlots: fixedSlotsForSolver,
    },
    postPreferences,
    shiftPreferences,
    shiftTimeModes,
    seniorityFilter: seniorityFilter ?? false,
    timeLimit: timeLimit ?? 120,
    weekdayPrefs,
    weekendPrefs,
    dowPrefs,
    desiredDates,
  };

  try {
    const result = await runSolver(solverInput);

    const versionCount = await prisma.scheduleVersion.count({
      where: { monthId: monthRecord.id },
    });

    await prisma.month.update({
      where: { id: monthRecord.id },
      data: { normHours: nh },
    });

    const version = await prisma.scheduleVersion.create({
      data: {
        monthId: monthRecord.id,
        versionNumber: versionCount + 1,
        name: versionName || `Версия ${versionCount + 1}`,
        status: "draft",
        data: JSON.stringify(result.schedule),
        employeeHours: JSON.stringify(result.employeeHours),
        solverParams: JSON.stringify({
          normHours: nh,
          timeLimit,
          seniorityFilter,
          fixedSlotsApplied: fixedSlotsCount,
        }),
        createdById: session.user.id,
      },
    });

    return NextResponse.json({
      ok: true,
      versionId: version.id,
      versionNumber: version.versionNumber,
      employeeHours: result.employeeHours,
      fixedSlotsApplied: fixedSlotsCount,
      status: "draft",
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
