import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  Users,
  Monitor,
  CalendarDays,
  FileText,
  Palmtree,
  ClipboardList,
  Sparkles,
  ArrowRight,
  Settings2,
} from "lucide-react";
import { getPlanningMonth, monthLabel } from "@/lib/planning-month";
import { PlanningMonthSwitcher } from "./planning-month-switcher";

const MONTH_NAMES_SHORT = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

export default async function AdminPage() {
  const planning = await getPlanningMonth();

  const [employeeCount, postCount, recentMonths, planningDetail, planningAvailabilitiesCount] =
    await Promise.all([
      prisma.employee.count(),
      prisma.post.count(),
      prisma.month.findMany({
        orderBy: [{ year: "desc" }, { month: "desc" }],
        take: 6,
        include: {
          versions: { orderBy: { versionNumber: "desc" }, take: 1 },
          _count: { select: { preferences: true } },
          availabilities: { select: { unavailableDays: true } },
        },
      }),
      planning.monthId
        ? prisma.month.findUnique({
            where: { id: planning.monthId },
            include: {
              versions: { orderBy: { versionNumber: "desc" }, take: 1 },
              _count: { select: { preferences: true, versions: true } },
            },
          })
        : Promise.resolve(null),
      planning.monthId
        ? prisma.availability.count({
            where: {
              monthId: planning.monthId,
              NOT: { unavailableDays: "[]" },
            },
          })
        : Promise.resolve(0),
    ]);

  const monthsWithVersions = recentMonths.map((m) => ({
    ...m,
    availabilitiesCount: m.availabilities.reduce(
      (s, a) => s + (a.unavailableDays !== "[]" ? 1 : 0),
      0
    ),
  }));

  const preferencesCount = planningDetail?._count.preferences ?? 0;
  const availabilitiesCount = planningAvailabilitiesCount;
  const versionsCount = planningDetail?._count.versions ?? 0;
  const latestVersion = planningDetail?.versions[0];
  const currentStatus = planningDetail?.status ?? planning.status;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Управление</h1>

      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-background to-primary/10 shadow-sm">
        <CardContent className="p-5 md:p-6 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-primary/80 font-medium">
                <Sparkles className="h-3.5 w-3.5" />
                Планируемый месяц
              </div>
              <div className="mt-1">
                <PlanningMonthSwitcher
                  year={planning.year}
                  month={planning.month}
                  status={currentStatus}
                  source={planning.source}
                />
              </div>
              {planning.source === "fallback" && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Месяц ещё не создан в базе — создастся автоматически при первом сохранении данных.
                </p>
              )}
            </div>
            <Link
              href="/admin/generate"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Sparkles className="h-4 w-4" />
              Сгенерировать
              <ArrowRight className="h-3.5 w-3.5 ml-0.5" />
            </Link>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 pt-2">
            <PlanningStat
              icon={<Settings2 className="h-4 w-4" />}
              label="Предпочтения"
              value={preferencesCount}
              href="/preferences"
            />
            <PlanningStat
              icon={<Palmtree className="h-4 w-4" />}
              label="Отпуска"
              value={availabilitiesCount}
              href="/admin/vacations"
            />
            <PlanningStat
              icon={<FileText className="h-4 w-4" />}
              label="Версий"
              value={versionsCount}
              href="/admin/versions"
            />
            <PlanningStat
              icon={<ClipboardList className="h-4 w-4" />}
              label="Последняя версия"
              value={latestVersion ? `v${latestVersion.versionNumber}` : "—"}
              hint={latestVersion?.name ?? undefined}
              href="/admin/versions"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/admin/employees">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Сотрудники</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{employeeCount}</div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/posts">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Аппараты</CardTitle>
              <Monitor className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{postCount}</div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/generate">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Генерация</CardTitle>
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {monthsWithVersions.length > 0
                  ? `${monthsWithVersions[0].versions.length > 0 ? "Есть" : "Нет"} версий`
                  : "—"}
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/versions">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Версии</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {monthsWithVersions.reduce((s, m) => s + m.versions.length, 0)}
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      <h2 className="text-lg font-semibold mt-6">Последние месяцы</h2>
      <div className="space-y-3">
        {monthsWithVersions.map((m) => (
          <Card key={m.id}>
            <CardContent className="flex items-center justify-between py-3 px-4">
              <div>
                <span className="font-medium">
                  {MONTH_NAMES_SHORT[m.month - 1]} {m.year}
                </span>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Предпочтений: {m._count.preferences} | Отпусков:{" "}
                  {m.availabilitiesCount}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    m.status === "published"
                      ? "default"
                      : m.status === "locked"
                      ? "secondary"
                      : "outline"
                  }
                >
                  {m.status === "published"
                    ? "Опубликован"
                    : m.status === "locked"
                    ? "Заблокирован"
                    : "Сбор данных"}
                </Badge>
                {m.versions[0] && (
                  <Badge variant="outline">v{m.versions[0].versionNumber}</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {monthsWithVersions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Нет данных. Начните с генерации расписания на{" "}
            <span className="font-medium text-foreground">
              {monthLabel(planning.year, planning.month)}
            </span>
            .
          </p>
        )}
      </div>
    </div>
  );
}

function PlanningStat({
  icon,
  label,
  value,
  hint,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
}) {
  const content = (
    <div className="rounded-lg border bg-background/60 px-3 py-2 flex items-center gap-3 h-full">
      <div className="text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {label}
        </div>
        <div className="text-base font-semibold truncate">{value}</div>
        {hint && (
          <div className="text-[10px] text-muted-foreground truncate">{hint}</div>
        )}
      </div>
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block hover:bg-muted/40 rounded-lg transition-colors">
        {content}
      </Link>
    );
  }
  return content;
}

