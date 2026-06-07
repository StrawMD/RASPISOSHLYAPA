import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ScheduleView } from "./schedule-view";
import { getPlanningMonth } from "@/lib/planning-month";

interface Props {
  searchParams: Promise<{ year?: string; month?: string }>;
}

export default async function SchedulePage({ searchParams }: Props) {
  const session = await auth();
  const params = await searchParams;

  const publishedMonths = await prisma.month.findMany({
    where: { versions: { some: { status: "published" } } },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { id: true, year: true, month: true },
  });

  const planning = await getPlanningMonth();

  const requestedYear = params.year ? parseInt(params.year) : null;
  const requestedMonth = params.month ? parseInt(params.month) : null;

  let year: number;
  let month: number;
  if (
    requestedYear &&
    requestedMonth &&
    publishedMonths.some(
      (m) => m.year === requestedYear && m.month === requestedMonth
    )
  ) {
    year = requestedYear;
    month = requestedMonth;
  } else {
    const planningPublished = publishedMonths.find(
      (m) => m.year === planning.year && m.month === planning.month
    );
    if (planningPublished) {
      year = planningPublished.year;
      month = planningPublished.month;
    } else if (publishedMonths.length > 0) {
      year = publishedMonths[0].year;
      month = publishedMonths[0].month;
    } else {
      year = planning.year;
      month = planning.month;
    }
  }

  const monthRecord = await prisma.month.findUnique({
    where: { year_month: { year, month } },
  });

  let publishedVersion = null;
  if (monthRecord) {
    publishedVersion = await prisma.scheduleVersion.findFirst({
      where: { monthId: monthRecord.id, status: "published" },
      orderBy: { versionNumber: "desc" },
    });
  }

  const allPosts = await prisma.post.findMany({ orderBy: { sortOrder: "asc" } });

  const scheduleData: Record<string, Record<string, string[]>> | null =
    publishedVersion?.data ? JSON.parse(publishedVersion.data) : null;

  // Посты, у которых есть назначения в показываемом расписании (чтобы не прятать историю).
  const postsWithData = new Set<string>();
  if (scheduleData) {
    for (const byPost of Object.values(scheduleData)) {
      for (const [postId, people] of Object.entries(byPost)) {
        if (Array.isArray(people) && people.length > 0) postsWithData.add(postId);
      }
    }
  }

  // Скрываем отключённые посты (неактивны и в будни, и в выходные), если в этом
  // расписании по ним нет назначений.
  const posts = allPosts.filter(
    (p) => p.weekdayActive || p.weekendActive || postsWithData.has(p.id)
  );

  return (
    <ScheduleView
      year={year}
      month={month}
      availableMonths={publishedMonths.map((m) => ({
        year: m.year,
        month: m.month,
      }))}
      schedule={scheduleData}
      employeeHours={
        publishedVersion?.employeeHours
          ? JSON.parse(publishedVersion.employeeHours)
          : null
      }
      posts={posts}
      normHours={monthRecord?.normHours ?? null}
      employeeName={session?.user?.name ?? null}
      userRole={session?.user?.role ?? "employee"}
    />
  );
}
