/**
 * Разовый импорт предпочтений ПО АППАРАТАМ из августовских анкет в Employee.
 *
 * Источник: Preference (год/месяц задаётся аргументами, по умолчанию 2026-08).
 *   • postPreferences  — уровни по 12ч-постам;
 *   • postShiftPrefs   — посменные (с/д/н) уровни на суточных постах.
 * Назначение: Employee.postPreferences / Employee.postShiftPrefs — админ-набор,
 * на который сотрудники больше не влияют. Генерация для ЛЮБОГО месяца берёт
 * эти предпочтения отсюда.
 *
 * Запуск:
 *   DATABASE_URL=... npx tsx scripts/import-affinity-from-august.ts [year] [month]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function safeJson<T>(v: string | null | undefined, fallback: T): T {
  if (!v) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

async function main() {
  const year = Number(process.argv[2] ?? 2026);
  const month = Number(process.argv[3] ?? 8);

  const monthRec = await prisma.month.findUnique({
    where: { year_month: { year, month } },
  });
  if (!monthRec) {
    console.error(`Месяц ${year}-${month} не найден.`);
    process.exit(1);
  }

  const prefs = await prisma.preference.findMany({
    where: { monthId: monthRec.id },
    include: { employee: { select: { id: true, name: true } } },
  });

  console.log(`Найдено анкет за ${year}-${month}: ${prefs.length}`);

  let updated = 0;
  let withPost = 0;
  let withShift = 0;

  for (const p of prefs) {
    const postPreferences = safeJson<Record<string, string>>(
      p.postPreferences,
      {},
    );
    const postShiftPrefs = safeJson<Record<string, Record<string, string>>>(
      p.postShiftPrefs,
      {},
    );
    const hasPost = Object.keys(postPreferences).length > 0;
    const hasShift = Object.keys(postShiftPrefs).length > 0;
    if (!hasPost && !hasShift) {
      console.log(`  · ${p.employee.name}: пусто — пропуск`);
      continue;
    }
    if (hasPost) withPost++;
    if (hasShift) withShift++;

    await prisma.employee.update({
      where: { id: p.employeeId },
      data: {
        postPreferences: JSON.stringify(postPreferences),
        postShiftPrefs: JSON.stringify(postShiftPrefs),
      },
    });
    updated++;
    console.log(
      `  ✓ ${p.employee.name}: постов=${Object.keys(postPreferences).length}, суточных=${Object.keys(postShiftPrefs).length}`,
    );
  }

  console.log(
    `\nИтог: обновлено сотрудников ${updated} (с предпочтениями по постам ${withPost}, по суточным сменам ${withShift}).`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
