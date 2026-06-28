import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPostActive } from "@/lib/post-active";
import { getPlanningMonth, monthLabel } from "@/lib/planning-month";
import { resolveMonthNorm } from "@/lib/rates";
import { AffinityMatrix } from "./affinity-matrix";

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export const dynamic = "force-dynamic";

export default async function AdminAffinityPage() {
  const session = await auth();
  if (
    !session?.user ||
    !["admin", "schedule_manager"].includes(session.user.role)
  ) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-muted-foreground">Доступ только для администратора.</p>
      </div>
    );
  }

  const allPostsRaw = await prisma.post.findMany({
    orderBy: { sortOrder: "asc" },
  });
  const posts = allPostsRaw.filter(isPostActive).map((p) => ({
    id: p.id,
    name: p.name,
    shiftHours: p.shiftHours,
    modality: p.modality ?? "",
  }));
  // Все посты (вкл. отключённые) с модальностью — для вывода allowedPosts из
  // модальностей при сохранении профиля в модалке.
  const allPostsModality = allPostsRaw.map((p) => ({
    id: p.id,
    modality: p.modality ?? "",
  }));

  const employeesRaw = await prisma.employee.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      rate: true,
      targetRate: true,
      maxRate: true,
      seniority: true,
      hospitalStartYear: true,
      careerStartYear: true,
      allowedPosts: true,
      modalities: true,
      postPreferences: true,
      postShiftPrefs: true,
      consecutivePref: true,
      medicalRestriction: true,
      medicalNote: true,
      recurringUnavailableDows: true,
    },
  });

  const monthRows = await prisma.month.findMany({
    orderBy: [{ year: "asc" }, { month: "asc" }],
    select: { year: true, month: true },
  });

  const employees = employeesRaw.map((e) => ({
    id: e.id,
    name: e.name,
    rate: e.rate,
    targetRate: e.targetRate,
    maxRate: e.maxRate,
    seniority: e.seniority,
    hospitalStartYear: e.hospitalStartYear,
    careerStartYear: e.careerStartYear,
    allowedPosts: safeJson<string[]>(e.allowedPosts, []),
    modalities: safeJson<string[]>(e.modalities, []),
    postPreferences: safeJson<Record<string, string>>(e.postPreferences, {}),
    postShiftPrefs: safeJson<Record<string, Record<string, string>>>(
      e.postShiftPrefs,
      {},
    ),
    consecutivePref: e.consecutivePref ?? "avoid",
    medicalRestriction: e.medicalRestriction ?? "none",
    medicalNote: e.medicalNote,
    recurringUnavailableDows: safeJson<number[]>(e.recurringUnavailableDows, []),
  }));

  // Норма часов на ставку для планируемого месяца — чтобы в модалке показать
  // эквивалент целевой ставки в часах.
  const planning = await getPlanningMonth();
  const normsRow = await prisma.setting.findUnique({
    where: { key: "monthNorms" },
  });
  const normOverrides = safeJson<Record<string, number>>(
    normsRow?.value ?? "{}",
    {},
  );
  const holidaysThis = await prisma.holiday.findMany({
    where: { year: planning.year },
  });
  const holidaysNext = await prisma.holiday.findMany({
    where: { year: planning.year + 1 },
  });
  const holidaySet = new Set([
    ...holidaysThis.map((h) => h.date),
    ...holidaysNext.map((h) => h.date),
  ]);
  const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  const planNorm = resolveMonthNorm(
    planning.year,
    planning.month,
    (d) => holidaySet.has(fmtDate(d)),
    normOverrides,
  );
  const planLabel = monthLabel(planning.year, planning.month);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Матрица аппаратов</h1>
        <p className="text-sm text-muted-foreground">
          Единый вид «кто на чём работает». Строки — сотрудники, столбцы —
          аппараты. В ячейке — отношение к аппарату (5 уровней); на
          суточных постах отдельно сутки / день / ночь. «Вообще не ставить» —
          жёсткий запрет: солвер не поставит (кроме ручного фикса). Пустая
          ячейка «—» означает, что сотрудник не работает в этой модальности;
          модальности задаются в карточке сотрудника (карандаш у фамилии).
        </p>
      </div>
      <AffinityMatrix
        posts={posts}
        allPostsModality={allPostsModality}
        employees={employees}
        months={monthRows}
        planNorm={planNorm}
        planLabel={planLabel}
      />
    </div>
  );
}
