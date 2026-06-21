import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPostActive } from "@/lib/post-active";
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

  const allPosts = await prisma.post.findMany({ orderBy: { sortOrder: "asc" } });
  const posts = allPosts.filter(isPostActive).map((p) => ({
    id: p.id,
    name: p.name,
    shiftHours: p.shiftHours,
    modality: p.modality ?? "",
  }));

  const employeesRaw = await prisma.employee.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      rate: true,
      allowedPosts: true,
      postPreferences: true,
      postShiftPrefs: true,
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
    allowedPosts: safeJson<string[]>(e.allowedPosts, []),
    postPreferences: safeJson<Record<string, string>>(e.postPreferences, {}),
    postShiftPrefs: safeJson<Record<string, Record<string, string>>>(
      e.postShiftPrefs,
      {},
    ),
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Матрица аппаратов</h1>
        <p className="text-sm text-muted-foreground">
          Единый вид «кто на чём работает». Строки — сотрудники, столбцы —
          аппараты. В ячейке — отношение к допущенному аппарату (5 уровней); на
          суточных постах отдельно сутки / день / ночь. «Вообще не ставить» —
          жёсткий запрет: солвер не поставит (кроме ручного фикса). Пустая
          ячейка «—» означает, что сотрудник не допущен к аппарату; допуск
          меняется в карточке сотрудника.
        </p>
      </div>
      <AffinityMatrix posts={posts} employees={employees} months={monthRows} />
    </div>
  );
}
