import { prisma } from "@/lib/db";
import { VacationManager } from "./vacation-manager";
import { getPlanningMonth } from "@/lib/planning-month";

export const dynamic = "force-dynamic";

function safeJson<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

interface Props {
  searchParams: Promise<{ year?: string; month?: string }>;
}

export default async function VacationsPage({ searchParams }: Props) {
  const params = await searchParams;

  const planning = await getPlanningMonth();
  const year = params.year ? parseInt(params.year) : planning.year;
  const month = params.month ? parseInt(params.month) : planning.month;

  const employees = await prisma.employee.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, rate: true },
  });

  const monthRecord = await prisma.month.findUnique({
    where: { year_month: { year, month } },
  });

  const availabilities = monthRecord
    ? await prisma.availability.findMany({
        where: { monthId: monthRecord.id },
      })
    : [];

  const vacationMap: Record<string, { id: string; days: number[]; comment: string | null }> = {};
  for (const a of availabilities) {
    vacationMap[a.employeeId] = {
      id: a.id,
      days: safeJson<number[]>(a.unavailableDays, []),
      comment: a.comment,
    };
  }

  return (
    <VacationManager
      key={`${year}-${month}`}
      employees={employees}
      vacationMap={vacationMap}
      year={year}
      month={month}
    />
  );
}
