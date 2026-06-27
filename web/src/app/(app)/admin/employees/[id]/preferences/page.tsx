import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPlanningMonth } from "@/lib/planning-month";
import { isPostActive } from "@/lib/post-active";
import { PreferencesForm } from "@/app/(app)/preferences/preferences-form";

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export const dynamic = "force-dynamic";

export default async function AdminEmployeePreferencesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (
    !session?.user ||
    !["admin", "schedule_manager"].includes(session.user.role)
  ) {
    return (
      <div className="container mx-auto p-4 md:p-6">
        <p className="text-muted-foreground">Доступ только для администратора.</p>
      </div>
    );
  }

  const { id } = await params;
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) {
    return (
      <div className="container mx-auto p-4 md:p-6">
        <p className="text-muted-foreground">Сотрудник не найден.</p>
      </div>
    );
  }

  const allPosts = await prisma.post.findMany({ orderBy: { sortOrder: "asc" } });
  const posts = allPosts.filter(isPostActive);
  const modalities: string[] = safeJson(employee.modalities, []);
  const has24hPostsInSystem = posts.some(
    (p) => p.shiftHours === 24 && p.modality === "КТ",
  );

  const planning = await getPlanningMonth();
  const nextMonth = { year: planning.year, month: planning.month };

  const month = planning.monthId
    ? await prisma.month.findUnique({ where: { id: planning.monthId } })
    : await prisma.month.findUnique({ where: { year_month: nextMonth } });

  const coworkers = (
    await prisma.employee.findMany({
      where: { id: { not: employee.id } },
      select: { name: true },
      orderBy: { name: "asc" },
    })
  ).map((e) => e.name);

  const existing = month
    ? await prisma.preference.findUnique({
        where: {
          employeeId_monthId: { employeeId: employee.id, monthId: month.id },
        },
      })
    : null;

  const prevYm =
    nextMonth.month === 1
      ? { year: nextMonth.year - 1, month: 12 }
      : { year: nextMonth.year, month: nextMonth.month - 1 };
  const prevMonthRec = await prisma.month.findUnique({
    where: { year_month: prevYm },
  });
  const prevPref = prevMonthRec
    ? await prisma.preference.findUnique({
        where: {
          employeeId_monthId: {
            employeeId: employee.id,
            monthId: prevMonthRec.id,
          },
        },
      })
    : null;
  const previous = prevPref
    ? {
        shiftTimeMode: prevPref.shiftTimeMode,
        postPreferences: safeJson(prevPref.postPreferences, {}),
        weekdayPref: prevPref.weekdayPref,
        weekendPref: prevPref.weekendPref,
        dayOfWeekPrefs: safeJson(prevPref.dayOfWeekPrefs, {}),
        postShiftPrefs: safeJson(prevPref.postShiftPrefs, {}),
        dowShiftAvoid: safeJson(prevPref.dowShiftAvoid, {}),
        softUnavailableDays: safeJson(prevPref.softUnavailableDays, []),
        consecutivePrefOverride: prevPref.consecutivePrefOverride,
        loadPref: prevPref.loadPref,
        maxNights: prevPref.maxNights,
        maxFull: prevPref.maxFull,
        minShifts: prevPref.minShifts,
        avoidSamePost: prevPref.avoidSamePost,
        avoidWith: safeJson(prevPref.avoidWith, []),
        preferWith: safeJson(prevPref.preferWith, []),
        availabilityMode: prevPref.availabilityMode,
        availableDays: safeJson<number[]>(prevPref.availableDays, []),
        postVarietyPref: prevPref.postVarietyPref,
      }
    : null;

  return (
    <div className="container mx-auto p-4 md:p-6">
      <PreferencesForm
        key={`${employee.id}-${employee.updatedAt.toISOString()}-${existing?.updatedAt?.toISOString() ?? "nopref"}`}
        employeeId={employee.id}
        employeeName={employee.name}
        isAdmin
        adminOnBehalf
        allPostsForAllowed={allPosts.map((p) => ({
          id: p.id,
          modality: p.modality ?? "",
        }))}
        employee={{
          rate: employee.rate,
          targetRate: employee.targetRate,
          maxRate: employee.maxRate,
          seniority: employee.seniority,
          modalities,
          can24h: employee.can24h,
          hospitalStartYear: employee.hospitalStartYear,
          careerStartYear: employee.careerStartYear,
          consecutivePref: employee.consecutivePref,
          medicalRestriction: employee.medicalRestriction,
          medicalNote: employee.medicalNote,
          recurringUnavailableDows: safeJson(
            employee.recurringUnavailableDows,
            [],
          ),
        }}
        coworkers={coworkers}
        previous={previous}
        posts={posts.map((p) => ({
          id: p.id,
          name: p.name,
          shiftHours: p.shiftHours,
          modality: p.modality ?? "",
        }))}
        has24hPostsInSystem={has24hPostsInSystem}
        year={nextMonth.year}
        month={nextMonth.month}
        monthId={month?.id ?? null}
        deadline={month?.deadline?.toISOString() ?? null}
        monthStatus={month?.status ?? "collecting"}
        existing={
          existing
            ? {
                pref24hFull: existing.pref24hFull,
                pref24hDay: existing.pref24hDay,
                pref24hNight: existing.pref24hNight,
                shiftTimeMode: existing.shiftTimeMode,
                postPreferences: safeJson(existing.postPreferences, {}),
                postShiftPrefs: safeJson(existing.postShiftPrefs, {}),
                dowShiftAvoid: safeJson(existing.dowShiftAvoid, {}),
                unavailableDays: safeJson(existing.unavailableDays, []),
                weekdayPref: existing.weekdayPref,
                weekendPref: existing.weekendPref,
                dayOfWeekPrefs: safeJson(existing.dayOfWeekPrefs, {}),
                desiredDates: safeJson(existing.desiredDates, []),
                comment: existing.comment,
                softUnavailableDays: safeJson(existing.softUnavailableDays, []),
                consecutivePrefOverride: existing.consecutivePrefOverride,
                loadPref: existing.loadPref,
                maxNights: existing.maxNights,
                maxFull: existing.maxFull,
                minShifts: existing.minShifts,
                avoidSamePost: existing.avoidSamePost,
                avoidWith: safeJson(existing.avoidWith, []),
                preferWith: safeJson(existing.preferWith, []),
                availabilityMode: existing.availabilityMode,
                availableDays: safeJson<number[]>(existing.availableDays, []),
                postVarietyPref: existing.postVarietyPref,
              }
            : null
        }
      />
    </div>
  );
}
