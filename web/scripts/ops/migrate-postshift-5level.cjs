#!/usr/bin/env node
/*
 * Разовая миграция данных: пожелания по типам смен на суточных постах
 * (Preference.postShiftPrefs) переводятся с 3-уровневой шкалы на 5-уровневую.
 *
 *   prefer  -> prefer_strong   («Очень хочу»)
 *   avoid   -> avoid_hard      («Просьба не ставить»)
 *
 * Уже 5-уровневые значения (prefer_strong / prefer / avoid / avoid_hard) и
 * пустые записи не трогаются — скрипт идемпотентный, можно запускать повторно.
 *
 * Запуск ВНУТРИ контейнера:
 *   docker exec raspisoshlyapa-web-1 node /app/data/migrate-postshift-5level.cjs           // применить
 *   docker exec raspisoshlyapa-web-1 node /app/data/migrate-postshift-5level.cjs --dry-run // только показать
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const MAP = { prefer: "prefer_strong", avoid: "avoid_hard" };

function safeJson(v, fb) {
  if (!v) return fb;
  try {
    return JSON.parse(v);
  } catch {
    return fb;
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const prefs = await prisma.preference.findMany({
    select: { id: true, employeeId: true, postShiftPrefs: true },
  });

  let changed = 0;
  for (const p of prefs) {
    const data = safeJson(p.postShiftPrefs, {});
    if (!data || typeof data !== "object") continue;

    let touched = false;
    for (const postId of Object.keys(data)) {
      const byKind = data[postId];
      if (!byKind || typeof byKind !== "object") continue;
      for (const kind of Object.keys(byKind)) {
        const lvl = byKind[kind];
        if (MAP[lvl]) {
          byKind[kind] = MAP[lvl];
          touched = true;
        }
      }
    }

    if (touched) {
      changed++;
      console.log(
        `${dryRun ? "[dry] " : ""}Preference ${p.id} (emp ${p.employeeId}) -> ${JSON.stringify(data)}`,
      );
      if (!dryRun) {
        await prisma.preference.update({
          where: { id: p.id },
          data: { postShiftPrefs: JSON.stringify(data) },
        });
      }
    }
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}Готово. Затронуто записей: ${changed} из ${prefs.length}.`,
  );
}

main()
  .catch((e) => {
    console.error("ОШИБКА:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
