import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runSolver, SolverInput, SolverInfeasibleError } from "@/lib/solver-bridge";
import { computeTenure } from "@/lib/seniority";
import { prismaSchemaHint } from "@/lib/prisma-schema-hint";
import { validateFixedSlots } from "@/lib/validate-fixed-slots";
import { clampRates, workNormHours, isPartTime } from "@/lib/rates";

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

  try {
  const body = await req.json();
  const { year, month, normHours, timeLimit, seniorityFilter, versionName } =
    body;
  const relax = Boolean(body.relax);

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

  const fmtYmd = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  for (const p of posts) {
    const aw: number[] = safeJson(p.activeWeekdays, []);
    const sd: number[] = safeJson(p.specificDays, []);
    if (aw.length > 0 || sd.length > 0) {
      const weekdaySet = new Set(aw);
      const specificSet = new Set(sd);
      const days: number[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        // 12-часовые посты в праздник не работают (как и дефолтная логика
        // солвера). Суточные (24ч) посты — приёмник, работают всегда.
        if (p.shiftHours !== 24 && holidayDates.has(fmtYmd(year, month, d))) continue;
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
  const postShiftPrefs: Record<string, Record<string, Record<string, string>>> = {};
  const dowShiftAvoid: Record<string, Record<string, Record<string, boolean>>> = {};
  const shiftPreferences: Record<string, Record<string, boolean | null>> = {};
  const shiftTimeModes: Record<string, string> = {};
  const weekdayPrefs: Record<string, string> = {};
  const weekendPrefs: Record<string, string> = {};
  const dowPrefs: Record<string, Record<string, string>> = {};
  const desiredDates: Record<string, number[]> = {};
  const softUnavailableDays: Record<string, number[]> = {};
  const avoidWith: Record<string, string[]> = {};
  const preferWith: Record<string, string[]> = {};
  // Месячные переопределения (имя сотрудника → значение).
  const consecutiveOverride: Record<string, string> = {};
  const loadPrefByName: Record<string, string> = {};
  const maxNightsByName: Record<string, number> = {};
  const maxFullByName: Record<string, number> = {};
  const minShiftsByName: Record<string, number> = {};
  const avoidSamePostByName: Record<string, boolean> = {};

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
    "prefer_night",
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

    const pspRaw = safeJson<Record<string, Record<string, string>>>(
      pref.postShiftPrefs,
      {},
    );
    if (pspRaw && Object.keys(pspRaw).length > 0) {
      postShiftPrefs[emp.name] = pspRaw;
    }

    const dsaRaw = safeJson<Record<string, Record<string, boolean>>>(
      pref.dowShiftAvoid,
      {},
    );
    if (dsaRaw && Object.keys(dsaRaw).length > 0) {
      dowShiftAvoid[emp.name] = dsaRaw;
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

    const softDays: number[] = safeJson(pref.softUnavailableDays, []);
    if (softDays.length > 0) softUnavailableDays[emp.name] = softDays;

    const aw: string[] = safeJson(pref.avoidWith, []);
    if (aw.length > 0) avoidWith[emp.name] = aw;
    const pw: string[] = safeJson(pref.preferWith, []);
    if (pw.length > 0) preferWith[emp.name] = pw;

    if (pref.consecutivePrefOverride) {
      consecutiveOverride[emp.name] = pref.consecutivePrefOverride;
    }
    if (pref.loadPref) loadPrefByName[emp.name] = pref.loadPref;
    if (typeof pref.maxNights === "number") maxNightsByName[emp.name] = pref.maxNights;
    if (typeof pref.maxFull === "number") maxFullByName[emp.name] = pref.maxFull;
    if (typeof pref.minShifts === "number" && pref.minShifts > 0)
      minShiftsByName[emp.name] = pref.minShifts;
    if (pref.avoidSamePost) avoidSamePostByName[emp.name] = true;
  }

  // Регулярная недельная недоступность (профиль) → раскрываем в дни месяца.
  for (const emp of employees) {
    const dows: number[] = safeJson(emp.recurringUnavailableDows, []);
    if (dows.length === 0) continue;
    const dowSet = new Set(dows);
    const existing = new Set(absences[emp.name] ?? []);
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = (new Date(year, month - 1, d).getDay() + 6) % 7; // 0=Пн
      if (dowSet.has(dow)) existing.add(d);
    }
    if (existing.size > 0) {
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
  const employeeHardMaxHours: Record<string, number> = {};
  const employeeFloorHours: Record<string, number> = {};
  const employeeFairHours: Record<string, number> = {};
  const nh = normHours || monthRecord.normHours;

  // «Справедливый» уровень нагрузки: всех сперва загружаем до ~1.25 ставки
  // (независимо от личной целевой ставки), и лишь потом перегружаем тех, у кого
  // потолок выше (1.5/2.0). Полставочников держим на их личной цели.
  const FAIR_RATE = 1.25;

  // Аварийная переработка: когда суммарный спрос превышает сумму желаемых
  // потолков (maxRate), солвер может выйти за желаемый потолок до аварийного
  // = maxRate + буфер, но не выше абсолютного максимума по ТК (2.0 ставки).
  // Внутри этой зоны переработка штрафуется и честно распределяется (см. солвер).
  const EMERGENCY_BUFFER_RATE = 0.5;
  const ABSOLUTE_MAX_RATE = 2.0;

  // Эффективные ставки с учётом правил (полставочники ≤ 0.75) — единый источник
  // для ёмкости и для формулы переработки в солвере.
  const effRates = new Map<string, { rate: number; targetRate: number; maxRate: number }>();
  for (const emp of employees) {
    effRates.set(
      emp.name,
      clampRates(emp.rate, emp.targetRate ?? emp.rate, emp.maxRate),
    );
  }

  // Кадровый алгоритм нормы часов: будни (Пн–Пт) минус праздники × 6 ч,
  // предпраздничный день — на час короче. Доступность месяца с отпуском
  // считаем по РАБОЧИМ дням, а не по календарным: «пол» базовой ставки
  // снижается ровно на рабочие дни отпуска, а не пропорцией по всем дням.
  const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  const isHolidayDate = (d: Date) => holidayDates.has(fmtDate(d));
  const fullWorkNorm = workNormHours(year, month, isHolidayDate);

  for (const emp of employees) {
    const eff = effRates.get(emp.name)!;
    const absentSet = new Set(absences[emp.name] ?? []);
    const availWorkNorm = workNormHours(
      year,
      month,
      isHolidayDate,
      (day) => !absentSet.has(day),
    );
    // Доля доступной рабочей нормы (с учётом праздников/предпраздничных).
    // Отсутствия только в выходные не снижают её — как и требует алгоритм.
    const avail =
      fullWorkNorm > 0 ? Math.max(0, Math.min(1, availWorkNorm / fullWorkNorm)) : 0;
    // Есть ли хоть один календарный день, когда сотрудник доступен (включая
    // выходные) — чтобы не блокировать покрытие смен у того, чья рабочая норма
    // обнулилась отпуском, но кто всё ещё может выйти (напр. на выходной пост).
    const hasAvailableDay = absentSet.size < daysInMonth;
    let boundedTarget = eff.targetRate;
    // Желаемая нагрузка на месяц: мягко двигаем цель в пределах [rate, maxRate].
    const load = loadPrefByName[emp.name];
    if (load === "more") {
      boundedTarget = Math.min(eff.maxRate, boundedTarget + 0.25);
    } else if (load === "less") {
      boundedTarget = Math.max(eff.rate, boundedTarget - 0.25);
    }
    const hardRate = Math.min(
      ABSOLUTE_MAX_RATE,
      eff.maxRate + EMERGENCY_BUFFER_RATE,
    );
    employeeTargetHours[emp.name] = nh * boundedTarget * avail;
    employeeMaxHours[emp.name] = nh * eff.maxRate * avail;
    employeeHardMaxHours[emp.name] = nh * hardRate * avail;
    // Пол базовой ставки: договорная ставка (0.5/1.0) × норма × доступность.
    employeeFloorHours[emp.name] = nh * eff.rate * avail;
    // Справедливый уровень: полставочников — на их личной цели; всех остальных —
    // на единой планке ~1.25 (с поправкой на желаемую нагрузку), но не выше
    // личного потолка. К нему солвер тянет всех прежде, чем кого-то перегружать.
    let fairRate: number;
    if (isPartTime(eff.rate)) {
      fairRate = boundedTarget;
    } else {
      let base = FAIR_RATE;
      if (load === "more") base += 0.25;
      else if (load === "less") base -= 0.25;
      fairRate = Math.min(eff.maxRate, Math.max(eff.rate, base));
    }
    employeeFairHours[emp.name] = nh * fairRate * avail;

    // Гранулярность смены: если доступность так мала, что потолок часов
    // опускается ниже одной полной смены (напр. суточник, доступный только по
    // выходным), человека нельзя поставить вообще. Гарантируем потолок не ниже
    // одной смены (24ч для суточников, иначе 12ч), пока есть хоть один доступный
    // день — иначе договорную ставку для него физически не закрыть.
    if (hasAvailableDay) {
      const shiftUnit = emp.can24h ? 24 : 12;
      if (employeeMaxHours[emp.name] < shiftUnit) employeeMaxHours[emp.name] = shiftUnit;
      if (employeeHardMaxHours[emp.name] < shiftUnit) employeeHardMaxHours[emp.name] = shiftUnit;
    }
  }

  // Веса целевой функции из настроек (если заданы); иначе дефолты в солвере.
  const weightsSetting = await prisma.setting.findUnique({
    where: { key: "solverWeights" },
  });
  const solverWeights = weightsSetting
    ? safeJson<Record<string, number>>(weightsSetting.value, {})
    : {};

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
      const effectiveConsecutive =
        consecutiveOverride[e.name] ?? e.consecutivePref ?? "avoid";
      const eff = effRates.get(e.name)!;
      return {
        name: e.name,
        rate: e.rate,
        allowedPosts: safeJson(e.allowedPosts, []),
        maxRate: eff.maxRate,
        targetRate: eff.targetRate,
        seniority: e.seniority,
        hospitalYears: t.hospitalYears,
        careerYears: t.careerYears,
        seniorityScore: t.score,
        consecutivePref: effectiveConsecutive,
        medicalRestriction: e.medicalRestriction ?? "none",
        can24h: e.can24h,
        maxNights: maxNightsByName[e.name] ?? null,
        maxFull: maxFullByName[e.name] ?? null,
        minShifts: minShiftsByName[e.name] ?? null,
        avoidSamePost: avoidSamePostByName[e.name] ?? false,
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
      employeeHardMaxHours,
      employeeFloorHours,
      employeeFairHours,
      fixedSlots: fixedSlotsForSolver,
    },
    postPreferences,
    postShiftPrefs,
    dowShiftAvoid,
    shiftPreferences,
    shiftTimeModes,
    seniorityFilter: seniorityFilter ?? false,
    timeLimit: timeLimit ?? 120,
    weekdayPrefs,
    weekendPrefs,
    dowPrefs,
    desiredDates,
    softUnavailableDays,
    avoidWith,
    preferWith,
    weights: Object.keys(solverWeights).length > 0 ? solverWeights : undefined,
    relax,
  };

    const result = await runSolver(solverInput);

    const versionCount = await prisma.scheduleVersion.count({
      where: { monthId: monthRecord.id },
    });

    await prisma.month.update({
      where: { id: monthRecord.id },
      data: { normHours: nh },
    });

    const relaxedDraft = Boolean(result.relaxed);
    const unfilled = result.unfilled ?? [];
    const unfilledCount = result.unfilledCount ?? 0;
    const overtime = result.overtime ?? [];
    const emergencyOvertimeTotal = result.emergencyOvertimeTotal ?? 0;
    const baseName = versionName || `Версия ${versionCount + 1}`;
    const finalName = relaxedDraft
      ? `${baseName} (черновик с пропусками: ${unfilledCount})`
      : emergencyOvertimeTotal > 0
        ? `${baseName} (переработка сверх потолка: ${emergencyOvertimeTotal}ч)`
        : baseName;

    const version = await prisma.scheduleVersion.create({
      data: {
        monthId: monthRecord.id,
        versionNumber: versionCount + 1,
        name: finalName,
        status: "draft",
        data: JSON.stringify(result.schedule),
        employeeHours: JSON.stringify(result.employeeHours),
        solverParams: JSON.stringify({
          normHours: nh,
          timeLimit,
          seniorityFilter,
          fixedSlotsApplied: fixedSlotsCount,
          relaxed: relaxedDraft,
          unfilled,
          unfilledCount,
          overtime,
          emergencyOvertimeTotal,
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
      relaxed: relaxedDraft,
      unfilled,
      unfilledCount,
      overtime,
      emergencyOvertimeTotal,
    });
  } catch (e: unknown) {
    console.error("[api/schedule/generate]", e);
    if (e instanceof SolverInfeasibleError) {
      return NextResponse.json(
        { error: e.message, diagnostics: e.diagnostics, infeasible: true },
        { status: 422 },
      );
    }
    const message =
      prismaSchemaHint(e) ??
      (e instanceof Error ? e.message : "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
