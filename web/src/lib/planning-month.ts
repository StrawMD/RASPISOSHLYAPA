import { prisma } from "@/lib/db";

export interface PlanningMonth {
  year: number;
  month: number;
  monthId: string | null;
  status: string;
  source: "setting" | "collecting" | "latest" | "fallback";
}

const SETTING_KEY = "planningMonth";

function parseYearMonth(raw: string): { year: number; month: number } | null {
  const m = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    year < 2000 ||
    year > 2100
  ) {
    return null;
  }
  return { year, month };
}

function formatYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Returns the month currently being planned.
 *
 * Priority:
 *   1. Explicit admin choice (Setting "planningMonth" = "YYYY-MM").
 *   2. Earliest Month record with status === "collecting".
 *   3. Latest Month record (any status).
 *   4. Next calendar month relative to today.
 */
export async function getPlanningMonth(): Promise<PlanningMonth> {
  const setting = await prisma.setting.findUnique({
    where: { key: SETTING_KEY },
  });
  const parsed = setting ? parseYearMonth(setting.value) : null;
  if (parsed) {
    const record = await prisma.month.findUnique({
      where: { year_month: { year: parsed.year, month: parsed.month } },
    });
    return {
      year: parsed.year,
      month: parsed.month,
      monthId: record?.id ?? null,
      status: record?.status ?? "collecting",
      source: "setting",
    };
  }

  const collecting = await prisma.month.findFirst({
    where: { status: "collecting" },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  if (collecting) {
    return {
      year: collecting.year,
      month: collecting.month,
      monthId: collecting.id,
      status: collecting.status,
      source: "collecting",
    };
  }

  const latest = await prisma.month.findFirst({
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  if (latest) {
    return {
      year: latest.year,
      month: latest.month,
      monthId: latest.id,
      status: latest.status,
      source: "latest",
    };
  }

  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return {
    year: next.getFullYear(),
    month: next.getMonth() + 1,
    monthId: null,
    status: "collecting",
    source: "fallback",
  };
}

/**
 * Persist an explicit planning month. Creates the Month record if missing
 * so that preferences/availability can immediately reference it.
 */
export async function setPlanningMonth(
  year: number,
  month: number
): Promise<{ monthId: string }> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("Invalid year");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid month");
  }

  const existing = await prisma.month.findUnique({
    where: { year_month: { year, month } },
  });
  const record =
    existing ??
    (await prisma.month.create({
      data: { year, month, normHours: 0, status: "collecting" },
    }));

  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: formatYearMonth(year, month) },
    create: { key: SETTING_KEY, value: formatYearMonth(year, month) },
  });

  return { monthId: record.id };
}

export const MONTH_NAMES_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
] as const;

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES_RU[month - 1]} ${year}`;
}
