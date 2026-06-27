/**
 * Машинный тест солвера на боевых данных (read-only, без записи в БД).
 *
 * Повторяет сборку входа из src/app/api/schedule/generate/route.ts один-в-один,
 * запускает НОВЫЙ солвер и печатает отчёт. В БД ничего не пишет.
 *
 * Usage:
 *   cd web && DATABASE_URL="file:/abs/path.db" npx tsx scripts/machine-test.ts 2026 8
 */

import { PrismaClient } from "@prisma/client";
import { runSolver, SolverInput } from "../src/lib/solver-bridge";
import { computeTenure } from "../src/lib/seniority";
import { validateFixedSlots } from "../src/lib/validate-fixed-slots";
import { clampRates, workNormHours, isPartTime } from "../src/lib/rates";

const prisma = new PrismaClient();

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function main() {
  const year = parseInt(process.argv[2] ?? "2026", 10);
  const month = parseInt(process.argv[3] ?? "8", 10);
  const relax = process.argv.includes("--relax");

  const posts = await prisma.post.findMany({ orderBy: { sortOrder: "asc" } });
  const employees = await prisma.employee.findMany();

  const monthRecord = await prisma.month.findUnique({
    where: { year_month: { year, month } },
  });
  if (!monthRecord) throw new Error(`No Month ${year}-${month}`);

  const postConfigs = await prisma.monthPostConfig.findMany({ where: { monthId: monthRecord.id } });
  const empConfigs = await prisma.employeeMonthConfig.findMany({ where: { monthId: monthRecord.id } });
  const availabilities = await prisma.availability.findMany({ where: { monthId: monthRecord.id } });
  const preferences = await prisma.preference.findMany({ where: { monthId: monthRecord.id } });
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
      postOverrides[pc.postId] = Array.from({ length: daysInMonth }, (_, i) => i + 1).filter((d) => {
        const dow = new Date(year, month - 1, d).getDay();
        return weekdays.has((dow + 6) % 7);
      });
    }
  }

  const absences: Record<string, number[]> = {};
  for (const av of availabilities) {
    const emp = employees.find((e) => e.id === av.employeeId);
    if (emp) absences[emp.name] = safeJson(av.unavailableDays, []);
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
      for (let d = 1; d <= daysInMonth; d++) if (!allowed.has(d)) existing.add(d);
    }
    for (const d of config.excludedDays ?? []) existing.add(d);
    if (existing.size > 0) absences[emp.name] = Array.from(existing).sort((a, b) => a - b);
  }

  // exclusions: prev month published tail
  const exclusions: Record<string, number[]> = {};
  const prevMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const prevMonthRecord = await prisma.month.findUnique({ where: { year_month: prevMonth } });
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
  const consecutiveOverride: Record<string, string> = {};
  const loadPrefByName: Record<string, string> = {};
  const maxNightsByName: Record<string, number> = {};
  const maxFullByName: Record<string, number> = {};
  const minShiftsByName: Record<string, number> = {};
  const avoidSamePostByName: Record<string, boolean> = {};
  const preferSamePostByName: Record<string, boolean> = {};

  function deriveLegacyShiftTimeMode(full: string | null, day: string | null, night: string | null): string {
    if (full === "prefer" && day === "avoid" && night === "avoid") return "only_full";
    if (full === "prefer") return "prefer_full";
    if (day === "prefer") return "prefer_day";
    return "neutral";
  }
  const VALID_MODES = new Set(["only_full", "prefer_full", "neutral", "prefer_day", "prefer_night"]);

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
      pref_24h_full: pref.pref24hFull === "prefer" ? true : pref.pref24hFull === "avoid" ? false : null,
      pref_24h_day: pref.pref24hDay === "prefer" ? true : pref.pref24hDay === "avoid" ? false : null,
      pref_24h_night: pref.pref24hNight === "prefer" ? true : pref.pref24hNight === "avoid" ? false : null,
    };
    const mode = pref.shiftTimeMode && VALID_MODES.has(pref.shiftTimeMode)
      ? pref.shiftTimeMode
      : deriveLegacyShiftTimeMode(pref.pref24hFull, pref.pref24hDay, pref.pref24hNight);
    if (mode && mode !== "neutral") shiftTimeModes[emp.name] = mode;

    const pspRaw = safeJson<Record<string, Record<string, string>>>(pref.postShiftPrefs, {});
    if (pspRaw && Object.keys(pspRaw).length > 0) postShiftPrefs[emp.name] = pspRaw;
    const dsaRaw = safeJson<Record<string, Record<string, boolean>>>(pref.dowShiftAvoid, {});
    if (dsaRaw && Object.keys(dsaRaw).length > 0) dowShiftAvoid[emp.name] = dsaRaw;
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
    if (pref.consecutivePrefOverride) consecutiveOverride[emp.name] = pref.consecutivePrefOverride;
    if (pref.loadPref) loadPrefByName[emp.name] = pref.loadPref;
    if (typeof pref.maxNights === "number") maxNightsByName[emp.name] = pref.maxNights;
    if (typeof pref.maxFull === "number") maxFullByName[emp.name] = pref.maxFull;
    if (typeof pref.minShifts === "number" && pref.minShifts > 0) minShiftsByName[emp.name] = pref.minShifts;
    if (pref.postVarietyPref === "variety" || pref.avoidSamePost) avoidSamePostByName[emp.name] = true;
    if (pref.postVarietyPref === "same") preferSamePostByName[emp.name] = true;
  }

  for (const emp of employees) {
    const dows: number[] = safeJson(emp.recurringUnavailableDows, []);
    if (dows.length === 0) continue;
    const dowSet = new Set(dows);
    const existing = new Set(absences[emp.name] ?? []);
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = (new Date(year, month - 1, d).getDay() + 6) % 7;
      if (dowSet.has(dow)) existing.add(d);
    }
    if (existing.size > 0) absences[emp.name] = Array.from(existing).sort((a, b) => a - b);
  }
  // Предпочтения по аппаратам — только из админ-набора Employee (как в генерации).
  for (const emp of employees) {
    const empPrefs = safeJson<Record<string, string>>(emp.postPreferences, {});
    if (Object.keys(empPrefs).length > 0) postPreferences[emp.name] = empPrefs;
    const empShift = safeJson<Record<string, Record<string, string>>>(
      (emp as { postShiftPrefs?: string }).postShiftPrefs,
      {},
    );
    if (Object.keys(empShift).length > 0) postShiftPrefs[emp.name] = empShift;
  }

  const employeeTargetHours: Record<string, number> = {};
  const employeeMaxHours: Record<string, number> = {};
  const employeeHardMaxHours: Record<string, number> = {};
  const employeeFloorHours: Record<string, number> = {};
  const employeeFairHours: Record<string, number> = {};
  const nh = monthRecord.normHours;
  const FAIR_RATE = 1.25;
  const EMERGENCY_BUFFER_RATE = 0.5;
  const ABSOLUTE_MAX_RATE = 2.0;

  const effRates = new Map<string, { rate: number; targetRate: number; maxRate: number }>();
  for (const emp of employees) {
    effRates.set(emp.name, clampRates(emp.rate, emp.targetRate ?? emp.rate, emp.maxRate));
  }

  const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const isHolidayDate = (d: Date) => holidayDates.has(fmtDate(d));
  const fullWorkNorm = workNormHours(year, month, isHolidayDate);

  for (const emp of employees) {
    const eff = effRates.get(emp.name)!;
    const absentSet = new Set(absences[emp.name] ?? []);
    const availWorkNorm = workNormHours(year, month, isHolidayDate, (day) => !absentSet.has(day));
    const avail = fullWorkNorm > 0 ? Math.max(0, Math.min(1, availWorkNorm / fullWorkNorm)) : 0;
    const hasAvailableDay = absentSet.size < daysInMonth;
    let boundedTarget = eff.targetRate;
    const load = loadPrefByName[emp.name];
    if (load === "more") boundedTarget = Math.min(eff.maxRate, boundedTarget + 0.25);
    else if (load === "less") boundedTarget = Math.max(eff.rate, boundedTarget - 0.25);
    const hardRate = Math.min(ABSOLUTE_MAX_RATE, eff.maxRate + EMERGENCY_BUFFER_RATE);
    employeeTargetHours[emp.name] = nh * boundedTarget * avail;
    employeeMaxHours[emp.name] = nh * eff.maxRate * avail;
    employeeHardMaxHours[emp.name] = nh * hardRate * avail;
    employeeFloorHours[emp.name] = nh * eff.rate * avail;
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
    if (hasAvailableDay) {
      const shiftUnit = emp.can24h ? 24 : 12;
      if (employeeMaxHours[emp.name] < shiftUnit) employeeMaxHours[emp.name] = shiftUnit;
      if (employeeHardMaxHours[emp.name] < shiftUnit) employeeHardMaxHours[emp.name] = shiftUnit;
    }
  }

  const weightsSetting = await prisma.setting.findUnique({ where: { key: "solverWeights" } });
  const solverWeights = weightsSetting ? safeJson<Record<string, number>>(weightsSetting.value, {}) : {};

  const rawFixed = safeJson<unknown>(monthRecord.solverFixedSlots ?? "{}", {});
  const employeesForValidation = employees.map((e) => ({ name: e.name, allowedPosts: safeJson<string[]>(e.allowedPosts, []) }));
  const fixedCheck = validateFixedSlots(rawFixed, year, month, posts.map((p) => ({ id: p.id, shiftHours: p.shiftHours })), employeesForValidation);
  if (!fixedCheck.ok) throw new Error("fixed slots invalid: " + fixedCheck.error);
  const fixedSlotsForSolver = Object.keys(fixedCheck.data).length > 0 ? fixedCheck.data : undefined;
  let fixedSlotsCount = 0;
  if (fixedSlotsForSolver) for (const byPost of Object.values(fixedSlotsForSolver)) for (const labels of Object.values(byPost)) fixedSlotsCount += labels.length;

  const solverInput: SolverInput = {
    posts: posts.map((p) => ({
      id: p.id, name: p.name, shiftHours: p.shiftHours, staffRequired: p.staffRequired,
      staffRequiredDay: p.staffRequiredDay, staffRequiredNight: p.staffRequiredNight,
      weekdayActive: p.weekdayActive, weekendActive: p.weekendActive,
    })),
    employees: employees.map((e) => {
      const t = computeTenure(e, year);
      const effectiveConsecutive = consecutiveOverride[e.name] ?? e.consecutivePref ?? "avoid";
      const eff = effRates.get(e.name)!;
      return {
        name: e.name, rate: e.rate, allowedPosts: safeJson(e.allowedPosts, []),
        maxRate: eff.maxRate, targetRate: eff.targetRate, seniority: e.seniority,
        hospitalYears: t.hospitalYears, careerYears: t.careerYears, seniorityScore: t.score,
        consecutivePref: effectiveConsecutive, medicalRestriction: e.medicalRestriction ?? "none",
        can24h: e.can24h, maxNights: maxNightsByName[e.name] ?? null, maxFull: maxFullByName[e.name] ?? null,
        minShifts: minShiftsByName[e.name] ?? null, avoidSamePost: avoidSamePostByName[e.name] ?? false,
        preferSamePost: preferSamePostByName[e.name] ?? false,
      };
    }),
    config: {
      year, month, normHours: nh,
      postOverrides: Object.keys(postOverrides).length > 0 ? postOverrides : undefined,
      absences, exclusions, employeeTargetHours, employeeMaxHours, employeeHardMaxHours,
      employeeFloorHours, employeeFairHours, fixedSlots: fixedSlotsForSolver,
    },
    postPreferences, postShiftPrefs, dowShiftAvoid, shiftPreferences, shiftTimeModes,
    seniorityFilter: false, timeLimit: 120,
    weekdayPrefs, weekendPrefs, dowPrefs, desiredDates, softUnavailableDays, avoidWith, preferWith,
    weights: Object.keys(solverWeights).length > 0 ? solverWeights : undefined,
    relax,
  };

  const t0 = Date.now();
  const result = await runSolver(solverInput);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // ---- report ----
  const postById = new Map(posts.map((p) => [p.id, p]));
  type Row = { name: string; rate: number; target: number; max: number; hours: number; shifts: number; n: number; d: number; f: number; reg: number };
  const rows = new Map<string, Row>();
  const ensure = (name: string): Row => {
    let r = rows.get(name);
    if (!r) {
      const e = employees.find((x) => x.name === name)!;
      const eff = effRates.get(name)!;
      r = { name, rate: e?.rate ?? 0, target: eff?.maxRate ?? 0, max: eff?.maxRate ?? 0, hours: 0, shifts: 0, n: 0, d: 0, f: 0, reg: 0 };
      rows.set(name, r);
    }
    return r;
  };
  type Cell = { day: number; post: string; kind: "с" | "д" | "н" | "reg" };
  const shiftsByName = new Map<string, Cell[]>();
  for (const [dayStr, byPost] of Object.entries(result.schedule)) {
    const day = parseInt(dayStr, 10);
    for (const [pid, people] of Object.entries(byPost)) {
      const post = postById.get(pid);
      for (const label of people) {
        const m = label.match(/\(([сдн])\)$/);
        const name = label.replace(/\([сдн]\)$/, "");
        const r = ensure(name);
        r.shifts += 1;
        let kind: Cell["kind"] = "reg";
        if (m) {
          if (m[1] === "с") { r.hours += 24; r.f += 1; kind = "с"; }
          else if (m[1] === "д") { r.hours += 12; r.d += 1; kind = "д"; }
          else { r.hours += 12; r.n += 1; kind = "н"; }
        } else { r.hours += post?.shiftHours ?? 12; r.reg += 1; }
        if (!shiftsByName.has(name)) shiftsByName.set(name, []);
        shiftsByName.get(name)!.push({ day, post: pid, kind });
      }
    }
  }

  const employeeHours = result.employeeHours;
  const list = employees.map((e) => e.name).sort((a, b) => a.localeCompare(b, "ru"));
  console.log(`\n==== МАШИННЫЙ ТЕСТ №5 (финальный) — ${year}-${String(month).padStart(2, "0")} ====`);
  console.log(`Норма: ${nh}ч · сотрудников: ${employees.length} · постов: ${posts.length} · solve ${elapsed}s` + (result.relaxed ? `  [RELAXED, пропусков: ${result.unfilledCount}]` : ""));
  console.log(`Справедливый уровень FAIR=${FAIR_RATE} ставки → ${(nh * FAIR_RATE).toFixed(0)}ч (для maxRate≥1.25)`);
  console.log("\n%-14s %4s %5s %6s  %-9s  %5s  %4s  %s".replace(/%-?\d*s/g, (x) => x));
  console.log("ФИО            став  часы  смен   н/д/с/12   ночь%   цель  отпуск(дн)");
  let sumH = 0; let minH = 1e9; let maxH = -1; const nightShares: number[] = []; let nightTotal = 0; let nightPeople = 0;
  for (const name of list) {
    const e = employees.find((x) => x.name === name)!;
    const eff = effRates.get(name)!;
    const r = rows.get(name);
    const hours = employeeHours[name] ?? r?.hours ?? 0;
    const shifts = r?.shifts ?? 0;
    const n = r?.n ?? 0, d = r?.d ?? 0, f = r?.f ?? 0, reg = r?.reg ?? 0;
    const nightPct = shifts ? Math.round((100 * n) / shifts) : 0;
    const absent = (absences[name] ?? []).length;
    const fairH = employeeFairHours[name] ?? 0;
    const pct = fairH > 0 ? Math.round((100 * hours) / fairH) : 0;
    if (shifts > 0) { sumH += hours; minH = Math.min(minH, hours); maxH = Math.max(maxH, hours); }
    if (n > 0) { nightTotal += n; nightPeople += 1; }
    if (shifts > 0) nightShares.push(nightPct);
    console.log(
      `${name.padEnd(14)} ${eff.rate.toFixed(2).padStart(4)} ${String(hours).padStart(5)} ${String(shifts).padStart(5)}   ${n}/${d}/${f}/${reg}`.padEnd(46) +
      `${String(nightPct + "%").padStart(5)}  ${String(pct + "%").padStart(5)}   ${absent ? absent : ""}`,
    );
  }
  const worked = list.filter((n) => (rows.get(n)?.shifts ?? 0) > 0).length;
  console.log(`\nИтог: работают ${worked}/${employees.length}; часы min=${minH} max=${maxH} avg=${(sumH / Math.max(1, worked)).toFixed(0)} (разброс ${maxH - minH}ч)`);
  console.log(`Ночные (н): всего ${nightTotal} смен у ${nightPeople} чел; макс доля ночных у одного = ${Math.max(0, ...nightShares)}%`);
  if (result.overtime?.length) {
    const ot = result.overtime.filter((o) => o.overCeiling > 0);
    console.log(`Аварийная переработка: ${result.emergencyOvertimeTotal ?? 0}ч; людей сверх потолка: ${ot.length}`);
  }
  if (result.relaxed && result.unfilled?.length) {
    console.log(`\nНЕЗАКРЫТЫЕ СЛОТЫ (${result.unfilledCount}):`);
    for (const u of result.unfilled) console.log(`  д.${u.day} ${u.post} (${u.kind}) ×${u.count}`);
  }

  // ============ ОТЧЁТ ПО СОБЛЮДЕНИЮ ПОЖЕЛАНИЙ ============
  const cellsOf = (n: string): Cell[] => shiftsByName.get(n) ?? [];
  const didWork = (n: string) => (rows.get(n)?.shifts ?? 0) > 0;
  const pad2 = (x: number, y: number) => `${x}/${y}`;
  const pct = (x: number, y: number) => (y > 0 ? Math.round((100 * x) / y) : 100);
  const line = (label: string, ok: number, tot: number, viol: string[]) => {
    const head = `${label.padEnd(40)} ${pad2(ok, tot).padStart(7)}  (${pct(ok, tot)}%)`;
    console.log(viol.length ? `${head}  ✗ ${viol.slice(0, 12).join(", ")}${viol.length > 12 ? ` …+${viol.length - 12}` : ""}` : head);
  };
  console.log(`\n==== СОБЛЮДЕНИЕ ПОЖЕЛАНИЙ (август ${year}) ====`);

  // 1. Посты: avoid_hard / avoid не должны использоваться; prefer — желательны
  const ahViol: string[] = []; let ahTot = 0;
  const avViol: string[] = []; let avTot = 0;
  let prefOk = 0, prefTot = 0;
  for (const [name, prefs] of Object.entries(postPreferences)) {
    if (!didWork(name)) continue;
    const usedPosts = new Set(cellsOf(name).map((c) => c.post));
    const preferred: string[] = [];
    for (const [pid, val] of Object.entries(prefs)) {
      if (val === "avoid_hard") { ahTot++; if (usedPosts.has(pid)) ahViol.push(`${name}:${pid}`); }
      else if (val === "avoid") { avTot++; if (usedPosts.has(pid)) avViol.push(`${name}:${pid}`); }
      else if (val === "prefer" || val === "prefer_strong") preferred.push(pid);
    }
    if (preferred.length) { prefTot++; if (preferred.some((p) => usedPosts.has(p))) prefOk++; }
  }
  line("Жёсткий запрет поста (avoid_hard)", ahTot - ahViol.length, ahTot, ahViol);
  line("Мягкий «лучше не этот пост» (avoid)", avTot - avViol.length, avTot, avViol);
  line("Получил предпочитаемый пост (prefer)", prefOk, prefTot, []);

  // 2. Режим смен
  const ofViol: string[] = []; let ofTot = 0;
  const pdViol: string[] = []; let pdTot = 0;
  for (const [name, mode] of Object.entries(shiftTimeModes)) {
    if (!didWork(name)) continue;
    const cs = cellsOf(name);
    if (mode === "only_full") {
      ofTot++;
      const bad = cs.filter((c) => c.kind !== "с").length;
      if (bad > 0) ofViol.push(`${name}(${bad} не-сут)`);
    } else if (mode === "prefer_day") {
      pdTot++;
      const nights = cs.filter((c) => c.kind === "н").length;
      if (nights > 0) pdViol.push(`${name}(${nights}ноч)`);
    }
  }
  line("Режим «только сутки» (only_full)", ofTot - ofViol.length, ofTot, ofViol);
  line("Режим «предпочитаю день» — без ночей", pdTot - pdViol.length, pdTot, pdViol);

  // 3. Покомпонентные «не хочу» сутки/день/ночь (pref_24h_*=avoid)
  const navViol: string[] = []; let navTot = 0;
  const favViol: string[] = []; let favTot = 0;
  for (const [name, sp] of Object.entries(shiftPreferences)) {
    if (!didWork(name)) continue;
    const cs = cellsOf(name);
    if (sp.pref_24h_night === false) { navTot++; const n = cs.filter((c) => c.kind === "н").length; if (n > 0) navViol.push(`${name}(${n})`); }
    if (sp.pref_24h_full === false) { favTot++; const f = cs.filter((c) => c.kind === "с").length; if (f > 0) favViol.push(`${name}(${f})`); }
  }
  line("«Не хочу ночные» соблюдено", navTot - navViol.length, navTot, navViol);
  line("«Не хочу сутки» соблюдено", favTot - favViol.length, favTot, favViol);

  // 4. Лимиты maxNights / maxFull / minShifts
  const mnViol: string[] = []; let mnTot = 0;
  for (const [name, lim] of Object.entries(maxNightsByName)) {
    if (!didWork(name)) continue; mnTot++;
    const n = cellsOf(name).filter((c) => c.kind === "н").length;
    if (n > lim) mnViol.push(`${name}(${n}>${lim})`);
  }
  line("Лимит ночей (maxNights)", mnTot - mnViol.length, mnTot, mnViol);
  const mfViol: string[] = []; let mfTot = 0;
  for (const [name, lim] of Object.entries(maxFullByName)) {
    if (!didWork(name)) continue; mfTot++;
    const f = cellsOf(name).filter((c) => c.kind === "с").length;
    if (f > lim) mfViol.push(`${name}(${f}>${lim})`);
  }
  line("Лимит суток (maxFull)", mfTot - mfViol.length, mfTot, mfViol);
  const msViol: string[] = []; let msTot = 0;
  for (const [name, m] of Object.entries(minShiftsByName)) {
    msTot++;
    const s = rows.get(name)?.shifts ?? 0;
    if (s < m) msViol.push(`${name}(${s}<${m})`);
  }
  line("Мин. число смен (minShifts)", msTot - msViol.length, msTot, msViol);

  // 5. Желаемые даты
  let ddOk = 0, ddTot = 0; const ddViol: string[] = [];
  for (const [name, dates] of Object.entries(desiredDates)) {
    if (!didWork(name)) continue;
    const days = new Set(cellsOf(name).map((c) => c.day));
    for (const d of dates) { ddTot++; if (days.has(d)) ddOk++; else ddViol.push(`${name}:${d}`); }
  }
  line("Желаемые даты (desiredDates)", ddOk, ddTot, ddViol);

  // 6. Мягкие выходные (нежелательно ставить)
  let suOk = 0, suTot = 0; const suViol: string[] = [];
  for (const [name, days] of Object.entries(softUnavailableDays)) {
    if (!didWork(name)) continue;
    const used = new Set(cellsOf(name).map((c) => c.day));
    for (const d of days) { suTot++; if (used.has(d)) suViol.push(`${name}:${d}`); else suOk++; }
  }
  line("Мягкие «лучше не в этот день»", suOk, suTot, suViol);

  // 7. avoidWith — не в одной ячейке (день+пост) с нежелательным коллегой
  const cellOwners = new Map<string, Set<string>>();
  for (const [name, cs] of shiftsByName) for (const c of cs) {
    const k = `${c.day}|${c.post}`;
    if (!cellOwners.has(k)) cellOwners.set(k, new Set());
    cellOwners.get(k)!.add(name);
  }
  const awViol: string[] = []; let awTot = 0;
  for (const [name, others] of Object.entries(avoidWith)) {
    if (!didWork(name)) continue;
    for (const c of cellsOf(name)) {
      const mates = cellOwners.get(`${c.day}|${c.post}`);
      if (!mates) continue;
      for (const o of others) if (mates.has(o)) { awTot++; awViol.push(`${name}+${o} д.${c.day}`); }
    }
  }
  line("Не в паре с нежелательным (avoidWith)", awTot - awViol.length, awTot, awViol);

  const fs = await import("fs/promises");
  const out = `/tmp/machine_test5_${year}_${String(month).padStart(2, "0")}.json`;
  await fs.writeFile(out, JSON.stringify({ schedule: result.schedule, employeeHours, overtime: result.overtime, relaxed: result.relaxed, unfilled: result.unfilled }, null, 2));
  console.log(`\nРасписание сохранено (файл): ${out}`);

  // ============ ОПЦИОНАЛЬНОЕ СОХРАНЕНИЕ ВЕРСИИ В БД ============
  const saveArg = process.argv.find((a) => a.startsWith("--save="));
  if (saveArg) {
    const saveName = saveArg.slice("--save=".length).replace(/^["']|["']$/g, "").trim() || "Черновик машинный";
    const user = await prisma.user.findFirst({ where: { role: "admin" } }) ?? await prisma.user.findFirst();
    if (!user) throw new Error("Нет ни одного пользователя для createdById");
    await prisma.month.update({ where: { id: monthRecord.id }, data: { normHours: nh } });
    const versionCount = await prisma.scheduleVersion.count({ where: { monthId: monthRecord.id } });
    const version = await prisma.scheduleVersion.create({
      data: {
        monthId: monthRecord.id,
        versionNumber: versionCount + 1,
        name: saveName,
        status: "draft",
        data: JSON.stringify(result.schedule),
        employeeHours: JSON.stringify(employeeHours),
        solverParams: JSON.stringify({
          normHours: nh, source: "machine-test", relaxed: Boolean(result.relaxed),
          unfilled: result.unfilled ?? [], unfilledCount: result.unfilledCount ?? 0,
          overtime: result.overtime ?? [], emergencyOvertimeTotal: result.emergencyOvertimeTotal ?? 0,
        }),
        createdById: user.id,
      },
    });
    console.log(`\nСохранено в БД: версия #${version.versionNumber} «${version.name}» (id=${version.id}, monthId=${monthRecord.id})`);
  }
}

main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
