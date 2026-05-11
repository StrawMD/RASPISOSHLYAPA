/**
 * Записывает июльский CSV в Month.solverFixedSlots — при «Генерации» солвер
 * сохранит эти ячейки и достроит остальное.
 *
 * Usage: cd web && npx tsx scripts/csv-to-solver-fixed-slots.ts <file.csv> [year]
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";
import {
  compactJulyScheduleForFixedSlots,
  parseJulyScheduleCsv,
} from "../src/lib/july-csv-schedule";
import { validateFixedSlots } from "../src/lib/validate-fixed-slots";

config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** В CSV на сутках часто только фамилия — солверу нужен явный (с)/(д)/(н). По умолчанию (д). */
function ensure24hSuffixOnPlainNames(
  data: Record<string, Record<string, string[]>>,
  postsById: Map<string, { shiftHours: number }>
): Record<string, Record<string, string[]>> {
  const result: Record<string, Record<string, string[]>> = {};
  for (const [day, byPost] of Object.entries(data)) {
    const inner: Record<string, string[]> = {};
    for (const [postId, labels] of Object.entries(byPost)) {
      const post = postsById.get(postId);
      const next: string[] = [];
      for (const label of labels) {
        const trimmed = label.trim();
        if (!trimmed) continue;
        if (
          post?.shiftHours === 24 &&
          !/^(.+)\(([сдн])\)$/u.test(trimmed)
        ) {
          next.push(`${trimmed}(д)`);
        } else {
          next.push(trimmed);
        }
      }
      if (next.length > 0) inner[postId] = next;
    }
    if (Object.keys(inner).length > 0) result[day] = inner;
  }
  return result;
}

function baseNameFromSlotLabel(label: string): string {
  const m = label.trim().match(/^(.+)\(([сдн])\)$/u);
  return m ? m[1].trim() : label.trim();
}

/** Убирает ячейки, не проходящие по allowed_posts (таблица может расходиться с БД). */
function stripDisallowedAssignments(
  data: Record<string, Record<string, string[]>>,
  employees: { name: string; allowedPosts: string[] }[]
): Record<string, Record<string, string[]>> {
  const allowed = new Map(
    employees.map((e) => [e.name, new Set(e.allowedPosts)])
  );
  const out: Record<string, Record<string, string[]>> = {};
  for (const [day, byPost] of Object.entries(data)) {
    for (const [postId, labels] of Object.entries(byPost)) {
      for (const label of labels) {
        const name = baseNameFromSlotLabel(label);
        const set = allowed.get(name);
        if (!set?.has(postId)) {
          console.warn(
            `Пропуск (в БД нет допуска на пост): день ${day}, ${postId}, «${label}»`
          );
          continue;
        }
        if (!out[day]) out[day] = {};
        if (!out[day][postId]) out[day][postId] = [];
        out[day][postId].push(label);
      }
    }
  }
  return out;
}

async function main() {
  const csvPath = process.argv[2];
  const year = parseInt(process.argv[3] ?? "2026", 10);
  const month = 7;
  if (!csvPath) {
    console.error(
      "Usage: npx tsx scripts/csv-to-solver-fixed-slots.ts <file.csv> [year]"
    );
    process.exit(1);
  }

  const content = readFileSync(csvPath, "utf-8");
  const { schedule: fullSchedule, normHours } = parseJulyScheduleCsv(content);
  let compact = compactJulyScheduleForFixedSlots(fullSchedule);

  const prisma = new PrismaClient();
  try {
    const posts = await prisma.post.findMany({ orderBy: { sortOrder: "asc" } });
    const postMap = new Map(posts.map((p) => [p.id, p]));
    compact = ensure24hSuffixOnPlainNames(compact, postMap);
    const employees = await prisma.employee.findMany();
    const employeesForValidation = employees.map((e) => ({
      name: e.name,
      allowedPosts: safeJson<string[]>(e.allowedPosts, []),
    }));

    compact = stripDisallowedAssignments(compact, employeesForValidation);

    const check = validateFixedSlots(
      compact,
      year,
      month,
      posts.map((p) => ({ id: p.id, shiftHours: p.shiftHours })),
      employeesForValidation
    );

    if (!check.ok) {
      console.error("Ошибка проверки фиксов:", check.error);
      process.exit(1);
    }

    let fixedCount = 0;
    for (const byPost of Object.values(check.data)) {
      for (const labels of Object.values(byPost)) {
        fixedCount += labels.length;
      }
    }

    await prisma.month.upsert({
      where: { year_month: { year, month } },
      create: {
        year,
        month,
        normHours: normHours > 0 ? normHours : 138,
        status: "collecting",
        solverFixedSlots: JSON.stringify(check.data),
      },
      update: {
        solverFixedSlots: JSON.stringify(check.data),
        ...(normHours > 0 ? { normHours } : {}),
      },
    });

    await prisma.setting.upsert({
      where: { key: "planningMonth" },
      update: { value: `${year}-${String(month).padStart(2, "0")}` },
      create: {
        key: "planningMonth",
        value: `${year}-${String(month).padStart(2, "0")}`,
      },
    });

    console.log(
      `Готово: в solverFixedSlots записано ${fixedCount} ячеек для ${year}-${String(month).padStart(2, "0")}.`
    );
    console.log(
      "Открой «Генерация», выбери тот же месяц и нажми сгенерировать — фиксы подтянутся автоматически."
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
