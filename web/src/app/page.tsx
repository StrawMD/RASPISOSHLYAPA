import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPlanningMonth } from "@/lib/planning-month";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["admin", "schedule_manager"];

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Админ/ответственный — на общее расписание (далее сами решают, куда идти).
  if (ADMIN_ROLES.includes(session.user.role)) {
    redirect("/schedule");
  }

  // Сотрудник без привязки — на расписание (форма предпочтений покажет ошибку).
  const employeeId = session.user.employeeId;
  if (!employeeId) redirect("/schedule");

  // Если предпочтения на плановый месяц ещё не заполнены — ведём на отметку.
  const planning = await getPlanningMonth();
  if (planning.monthId && planning.status === "collecting") {
    const existing = await prisma.preference.findUnique({
      where: {
        employeeId_monthId: {
          employeeId,
          monthId: planning.monthId,
        },
      },
      select: { id: true },
    });
    if (!existing) redirect("/preferences");
  }

  redirect("/schedule");
}
