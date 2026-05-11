/**
 * Import July schedule from Google Sheets CSV (UTF-8).
 * Maps columns: КТ ССК1→ssk1, КТ РСЦ→kt_pb, … (see JULY_CSV_POST_IDS).
 *
 * Usage: cd web && npx tsx scripts/import-schedule-csv.ts <file.csv> [year]
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";
import { parseJulyScheduleCsv } from "../src/lib/july-csv-schedule";

config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

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
  const { schedule, normHours } = parseJulyScheduleCsv(content);

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
