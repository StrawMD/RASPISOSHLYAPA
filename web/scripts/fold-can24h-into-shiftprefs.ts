/**
 * Разовая миграция: свернуть допуск к суточным (can24h) и мед-ограничения в
 * посменные предпочтения "avoid_hard" (Employee.postShiftPrefs).
 *
 * После этого «Вообще не ставить» в матрице = жёсткий запрет, а отдельный флаг
 * can24h как гейт в солвере больше не нужен.
 *
 *   • can24h = false        → на суточных постах: сутки(с)=нельзя, ночь(н)=нельзя
 *                              (дневная 12ч-смена остаётся доступной);
 *   • мед no_24h            → сутки(с)=нельзя;
 *   • мед no_night          → ночь(н)=нельзя;
 *   • мед day_only          → сутки(с)=нельзя, ночь(н)=нельзя.
 *
 * Запуск: DATABASE_URL=... npx tsx scripts/fold-can24h-into-shiftprefs.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const HARD = "avoid_hard";

function safeJson<T>(v: string | null | undefined, fallback: T): T {
  if (!v) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

async function main() {
  const posts24 = await prisma.post.findMany({
    where: { shiftHours: 24 },
    select: { id: true },
  });
  const ids24 = posts24.map((p) => p.id);
  console.log("Суточные посты:", ids24.join(", ") || "(нет)");

  const employees = await prisma.employee.findMany({
    select: {
      id: true,
      name: true,
      can24h: true,
      medicalRestriction: true,
      allowedPosts: true,
      postShiftPrefs: true,
    },
  });

  let changed = 0;
  for (const e of employees) {
    const allowed = new Set(safeJson<string[]>(e.allowedPosts, []));
    const psp = safeJson<Record<string, Record<string, string>>>(
      e.postShiftPrefs,
      {},
    );
    const med = e.medicalRestriction || "none";
    const banFull = !e.can24h || med === "no_24h" || med === "day_only";
    const banNight =
      !e.can24h || med === "no_night" || med === "day_only";

    let touched = false;
    for (const pid of ids24) {
      if (!allowed.has(pid)) continue; // нет допуска — переменных всё равно нет
      const cur = { ...(psp[pid] ?? {}) };
      if (banFull && cur.full !== HARD) {
        cur.full = HARD;
        touched = true;
      }
      if (banNight && cur.night !== HARD) {
        cur.night = HARD;
        touched = true;
      }
      if (Object.keys(cur).length > 0) psp[pid] = cur;
    }

    if (touched) {
      await prisma.employee.update({
        where: { id: e.id },
        data: { postShiftPrefs: JSON.stringify(psp) },
      });
      changed++;
      console.log(
        `  ✓ ${e.name}: can24h=${e.can24h} мед=${med} → запреты с/н проставлены`,
      );
    }
  }

  console.log(`\nИтог: обновлено ${changed} сотрудников.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
