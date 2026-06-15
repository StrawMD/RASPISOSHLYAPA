import { prisma } from "@/lib/db";
import { getPlanningMonth, monthLabel } from "@/lib/planning-month";
import { EmployeeManager, type PrefSummary } from "./employee-manager";

/** Иначе при production-сборке в Docker данные берутся из пустой build-БД и «запекаются» в статику. */
export const dynamic = "force-dynamic";

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function countLevels(pp: Record<string, string>) {
  let prefer = 0;
  let avoid = 0;
  let ban = 0;
  for (const lvl of Object.values(pp)) {
    if (lvl === "prefer" || lvl === "prefer_strong") prefer++;
    else if (lvl === "avoid") avoid++;
    else if (lvl === "avoid_hard") ban++;
  }
  return { prefer, avoid, ban };
}

export default async function EmployeesPage() {
  const employees = await prisma.employee.findMany({ orderBy: { name: "asc" } });
  const posts = await prisma.post.findMany({ orderBy: { sortOrder: "asc" } });

  // Сводка реальных месячных пожеланий (планируемый месяц) — для вкладки обзора.
  const planning = await getPlanningMonth();
  const prefs = planning.monthId
    ? await prisma.preference.findMany({ where: { monthId: planning.monthId } })
    : [];
  const prefByEmp = new Map(prefs.map((p) => [p.employeeId, p]));

  const prefSummaries: PrefSummary[] = employees.map((e) => {
    const pr = prefByEmp.get(e.id);
    const pp = pr ? safeJson<Record<string, string>>(pr.postPreferences, {}) : {};
    const posic = countLevels(pp);

    // «вообще не ставить» по суточным сменам тоже считаем в бан-счётчик.
    const psp = pr
      ? safeJson<Record<string, Record<string, string>>>(pr.postShiftPrefs, {})
      : {};
    let shiftBan = 0;
    let shiftPrefer = 0;
    for (const byKind of Object.values(psp)) {
      for (const lvl of Object.values(byKind ?? {})) {
        if (lvl === "avoid_hard") shiftBan++;
        else if (lvl === "prefer" || lvl === "prefer_strong") shiftPrefer++;
      }
    }

    return {
      employeeId: e.id,
      name: e.name,
      rate: e.rate,
      targetRate: e.targetRate,
      maxRate: e.maxRate,
      modalities: safeJson<string[]>(e.modalities, []),
      can24h: e.can24h ?? false,
      medicalRestriction: e.medicalRestriction ?? "none",
      submitted: Boolean(pr),
      loadPref: pr?.loadPref ?? null,
      shiftTimeMode: pr?.shiftTimeMode ?? null,
      consec: pr?.consecutivePrefOverride ?? e.consecutivePref ?? "avoid",
      preferCount: posic.prefer + shiftPrefer,
      avoidCount: posic.avoid,
      banCount: posic.ban + shiftBan,
      unavailableCount: pr
        ? safeJson<number[]>(pr.unavailableDays, []).length
        : 0,
      softUnavailableCount: pr
        ? safeJson<number[]>(pr.softUnavailableDays, []).length
        : 0,
      desiredCount: pr ? safeJson<number[]>(pr.desiredDates, []).length : 0,
      minShifts: pr?.minShifts ?? null,
      maxFull: pr?.maxFull ?? null,
      maxNights: pr?.maxNights ?? null,
      avoidWithCount: pr ? safeJson<string[]>(pr.avoidWith, []).length : 0,
      preferWithCount: pr ? safeJson<string[]>(pr.preferWith, []).length : 0,
    };
  });

  return (
    <EmployeeManager
      initialEmployees={employees.map((e) => ({
        id: e.id,
        name: e.name,
        rate: e.rate,
        targetRate: e.targetRate,
        maxRate: e.maxRate,
        seniority: e.seniority,
        hospitalStartYear: e.hospitalStartYear,
        careerStartYear: e.careerStartYear,
        allowedPosts: safeJson(e.allowedPosts, []),
        modalities: safeJson(e.modalities, []),
        can24h: e.can24h ?? false,
        postPreferences: safeJson(e.postPreferences, {}),
        consecutivePref: e.consecutivePref ?? "avoid",
        medicalRestriction: e.medicalRestriction ?? "none",
        medicalNote: e.medicalNote,
        recurringUnavailableDows: safeJson(e.recurringUnavailableDows, []),
      }))}
      posts={posts.map((p) => ({
        id: p.id,
        name: p.name,
        shiftHours: p.shiftHours,
        modality: p.modality ?? "",
      }))}
      prefSummaries={prefSummaries}
      planningLabel={monthLabel(planning.year, planning.month)}
      submittedCount={prefs.length}
    />
  );
}
