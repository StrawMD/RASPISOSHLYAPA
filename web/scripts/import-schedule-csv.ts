/**
 * Import July schedule from Google Sheets CSV (UTF-8).
 * Maps columns: КТ ССК1→ssk1, КТ РСЦ→kt_pb, … (see POST_IDS).
 * Converts "Фамилия д/н" → "Фамилия(д)" so часики считаются как в редакторе.
 *
 * Usage: cd web && npx tsx scripts/import-schedule-csv.ts <file.csv> [year]
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";

config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

const POST_IDS = [
  "ssk1",
  "kt_pb",
  "kt_ssk2",
  "kt_2013",
  "ge_siemens",
  "kt_2011",
  "kt_4str",
  "mrt_ssk",
  "mrt_22_1",
  "mrt_21_1",
] as const;

/** Распространённые обрезки из экспорта / PDF */
const NAME_FIXES: Record<string, string> = {
  Мхитаря: "Мхитарян",
  Карабаев: "Карабаева",
  Василен: "Василенко",
  Гончару: "Гончарук",
};

function normalizeCell(raw: string): string {
  const s = raw.trim();
  if (!s || s === "-") return "";

  const spaced = s.match(/^(.+?)\s+([сдн])$/u);
  if (spaced) {
    let base = spaced[1].trim();
    base = NAME_FIXES[base] ?? base;
    return `${base}(${spaced[2]})`;
  }

  if (/\([сдн]\)$/u.test(s)) {
    const m = s.match(/\(([сдн])\)$/u);
    const suf = m?.[1];
    const baseRaw = s.replace(/\([сдн]\)$/u, "");
    const base = NAME_FIXES[baseRaw] ?? baseRaw;
    return suf ? `${base}(${suf})` : s;
  }

  return NAME_FIXES[s] ?? s;
}

function parseJulyCsv(content: string): {
  schedule: Record<string, Record<string, string[]>>;
  normHours: number;
} {
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  let normHours = 0;
  const header = lines[0] ?? "";
  const normMatch = header.match(/(\d+)\s*ч/u);
  if (normMatch) normHours = parseInt(normMatch[1], 10);

  type Block = { day: number; rows: string[] };
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const first = line.split(";")[0]?.trim() ?? "";
    const dayMatch = first.match(/^(\d{2})\.июл/i);
    if (dayMatch) {
      if (current) blocks.push(current);
      current = { day: parseInt(dayMatch[1], 10), rows: [line] };
    } else if (current) {
      current.rows.push(line);
    }
  }
  if (current) blocks.push(current);

  const schedule: Record<string, Record<string, string[]>> = {};

  for (const block of blocks) {
    const dayStr = String(block.day);
    schedule[dayStr] = {};
    for (const pid of POST_IDS) {
      schedule[dayStr][pid] = [];
    }

    for (const row of block.rows) {
      const cols = row.split(";");
      for (let c = 2; c < 2 + POST_IDS.length; c++) {
        const cell = cols[c]?.trim() ?? "";
        const norm = normalizeCell(cell);
        if (!norm) continue;
        const postId = POST_IDS[c - 2];
        const arr = schedule[dayStr][postId];
        if (!arr.includes(norm)) arr.push(norm);
      }
    }
  }

  return { schedule, normHours };
}

function computeEmployeeHours(
  schedule: Record<string, Record<string, string[]>>,
  postMap: Map<string, { shiftHours: number }>
): Record<string, number> {
  const hours: Record<string, number> = {};
  for (const dayData of Object.values(schedule)) {
    for (const [pid, people] of Object.entries(dayData)) {
      const post = postMap.get(pid);
      for (const person of people) {
        const name = person.replace(/\([сдн]\)$/u, "");
        const typeMatch = person.match(/\(([сдн])\)$/u);
        const h = typeMatch
          ? typeMatch[1] === "с"
            ? 24
            : 12
          : (post?.shiftHours ?? 12);
        hours[name] = (hours[name] ?? 0) + h;
      }
    }
  }
  return hours;
}

async function removeSedova(prisma: PrismaClient) {
  const sedova = await prisma.employee.findUnique({ where: { name: "Седова" } });
  if (!sedova) return;
  await prisma.user.updateMany({
    where: { employeeId: sedova.id },
    data: { employeeId: null },
  });
  await prisma.employee.delete({ where: { id: sedova.id } });
  console.log("Сотрудник Седова удалён из базы.");
}

async function main() {
  const csvPath = process.argv[2];
  const year = parseInt(process.argv[3] ?? "2026", 10);
  const month = 7;
  if (!csvPath) {
    console.error("Usage: npx tsx scripts/import-schedule-csv.ts <file.csv> [year]");
    process.exit(1);
  }

  const content = readFileSync(csvPath, "utf-8");
  const { schedule, normHours } = parseJulyCsv(content);

  const prisma = new PrismaClient();
  try {
    await removeSedova(prisma);

    const posts = await prisma.post.findMany();
    const postMap = new Map(posts.map((p) => [p.id, p]));
    const employees = await prisma.employee.findMany();
    const employeeNames = new Set(employees.map((e) => e.name));

    for (const [day, dayData] of Object.entries(schedule)) {
      for (const [pid, people] of Object.entries(dayData)) {
        for (const person of people) {
          const name = person.replace(/\([сдн]\)$/u, "");
          if (!employeeNames.has(name)) {
            console.warn(
              `Неизвестная фамилия "${name}" (день ${day}, пост ${pid}, значение "${person}")`
            );
          }
        }
      }
    }

    const employeeHours = computeEmployeeHours(schedule, postMap);

    let monthRecord = await prisma.month.findUnique({
      where: { year_month: { year, month } },
    });
    if (!monthRecord) {
      monthRecord = await prisma.month.create({
        data: {
          year,
          month,
          normHours: normHours > 0 ? normHours : 138,
          status: "collecting",
        },
      });
    } else {
      monthRecord = await prisma.month.update({
        where: { id: monthRecord.id },
        data: {
          normHours: normHours > 0 ? normHours : monthRecord.normHours,
        },
      });
    }

    await prisma.setting.upsert({
      where: { key: "planningMonth" },
      update: { value: `${year}-${String(month).padStart(2, "0")}` },
      create: {
        key: "planningMonth",
        value: `${year}-${String(month).padStart(2, "0")}`,
      },
    });

    let version = await prisma.scheduleVersion.findFirst({
      where: { monthId: monthRecord.id },
      orderBy: { versionNumber: "desc" },
    });

    if (!version) {
      version = await prisma.scheduleVersion.create({
        data: {
          monthId: monthRecord.id,
          versionNumber: 1,
          name: "Импорт CSV",
          status: "draft",
          data: "{}",
          employeeHours: "{}",
        },
      });
    }

    await prisma.$transaction([
      prisma.scheduleVersion.updateMany({
        where: { monthId: monthRecord.id, status: "published" },
        data: { status: "archived" },
      }),
      prisma.scheduleVersion.update({
        where: { id: version.id },
        data: {
          data: JSON.stringify(schedule),
          employeeHours: JSON.stringify(employeeHours),
          status: "published",
        },
      }),
      prisma.month.update({
        where: { id: monthRecord.id },
        data: { status: "published" },
      }),
    ]);

    console.log(
      `Готово: опубликована v${version.versionNumber} (${version.id}), ${year}-${String(month).padStart(2, "0")}`
    );
    console.log(`Дней в расписании: ${Object.keys(schedule).length}, норма часов: ${monthRecord.normHours}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
