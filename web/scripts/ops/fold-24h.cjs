/**
 * Разовый ops-рецепт: свернуть прежний допуск к суткам (can24h) и мед-ограничения
 * в посменные запреты avoid_hard на ВСЕХ суточных постах модальности сотрудника.
 *
 * Нужен после перехода на «допуск = модальность»: иначе бывшие can24h=false с
 * пустой матрицей суток внезапно стали бы доступны для суток/ночи.
 *
 *   • can24h=false  → сутки(full)=нельзя, ночь(night)=нельзя (день остаётся);
 *   • мед no_24h    → сутки=нельзя;
 *   • мед no_night  → ночь=нельзя;
 *   • мед day_only  → сутки=нельзя, ночь=нельзя.
 *
 * Идемпотентно. Запуск внутри контейнера:
 *   docker exec raspisoshlyapa-web-1 node /app/data/fold-24h.cjs '{"action":"apply"}'
 *   docker exec raspisoshlyapa-web-1 node /app/data/fold-24h.cjs '{"action":"dry"}'
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const HARD = "avoid_hard";

function safeJson(v, fallback) {
  if (!v) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

async function main() {
  const arg = process.argv[2] ? JSON.parse(process.argv[2]) : {};
  const dry = arg.action === "dry";

  const posts24 = await prisma.post.findMany({
    where: { shiftHours: 24 },
    select: { id: true, modality: true },
  });
  console.log(
    "Суточные посты:",
    posts24.map((p) => `${p.id}(${p.modality})`).join(", ") || "(нет)",
  );

  const employees = await prisma.employee.findMany({
    select: {
      id: true,
      name: true,
      can24h: true,
      medicalRestriction: true,
      modalities: true,
      postShiftPrefs: true,
    },
  });

  let changed = 0;
  for (const e of employees) {
    const mods = new Set(safeJson(e.modalities, []));
    const psp = safeJson(e.postShiftPrefs, {});
    const med = e.medicalRestriction || "none";
    const banFull = !e.can24h || med === "no_24h" || med === "day_only";
    const banNight = !e.can24h || med === "no_night" || med === "day_only";

    let touched = false;
    for (const p of posts24) {
      if (!p.modality || !mods.has(p.modality)) continue;
      const cur = { ...(psp[p.id] ?? {}) };
      if (banFull && cur.full !== HARD) {
        cur.full = HARD;
        touched = true;
      }
      if (banNight && cur.night !== HARD) {
        cur.night = HARD;
        touched = true;
      }
      if (Object.keys(cur).length > 0) psp[p.id] = cur;
    }

    if (touched) {
      changed++;
      console.log(
        `  ${dry ? "•" : "✓"} ${e.name}: can24h=${e.can24h} мед=${med} → запреты с/н`,
      );
      if (!dry) {
        await prisma.employee.update({
          where: { id: e.id },
          data: { postShiftPrefs: JSON.stringify(psp) },
        });
      }
    }
  }

  console.log(`\nИтог: ${dry ? "будет затронуто" : "обновлено"} ${changed} сотрудников.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
