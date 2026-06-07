import { prisma } from "@/lib/db";
import { getPlanningMonth, monthLabel } from "@/lib/planning-month";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function safeJson<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

const MEDICAL_LABEL: Record<string, string> = {
  no_night: "без ночей",
  no_24h: "без суток",
  day_only: "только день",
};

const LOAD_LABEL: Record<string, string> = {
  less: "хочет меньше",
  more: "хочет больше",
};

export default async function AdminPreferencesPage() {
  const planning = await getPlanningMonth();

  const employees = await prisma.employee.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      medicalRestriction: true,
      consecutivePref: true,
    },
  });

  const prefs = planning.monthId
    ? await prisma.preference.findMany({
        where: { monthId: planning.monthId },
      })
    : [];
  const prefByEmp = new Map(prefs.map((p) => [p.employeeId, p]));

  const submitted = employees.filter((e) => prefByEmp.has(e.id));
  const missing = employees.filter((e) => !prefByEmp.has(e.id));

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Сбор предпочтений</h1>
        <p className="text-sm text-muted-foreground">
          Плановый месяц: <strong>{monthLabel(planning.year, planning.month)}</strong>
          {planning.status !== "collecting" && (
            <Badge variant="secondary" className="ml-2">
              статус: {planning.status}
            </Badge>
          )}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Сдали: {submitted.length} из {employees.length}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {missing.length === 0 ? (
            <p className="text-sm text-green-500">Все сотрудники заполнили предпочтения.</p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Ещё не сдали ({missing.length}):</p>
              <div className="flex flex-wrap gap-1.5">
                {missing.map((e) => (
                  <Badge key={e.id} variant="outline" className="text-destructive">
                    {e.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Что отметили</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-1.5 pr-3">Сотрудник</th>
                <th className="py-1.5 pr-3">Статус</th>
                <th className="py-1.5 pr-3">Не могу</th>
                <th className="py-1.5 pr-3">Мягко</th>
                <th className="py-1.5 pr-3">Желает</th>
                <th className="py-1.5 pr-3">Очерёдность</th>
                <th className="py-1.5 pr-3">Мед.</th>
                <th className="py-1.5 pr-3">Нагрузка</th>
                <th className="py-1.5 pr-3">Мин. смен</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const p = prefByEmp.get(e.id);
                const unavail = safeJson<number[]>(p?.unavailableDays, []);
                const soft = safeJson<number[]>(p?.softUnavailableDays, []);
                const desired = safeJson<number[]>(p?.desiredDates, []);
                const med =
                  e.medicalRestriction && e.medicalRestriction !== "none"
                    ? MEDICAL_LABEL[e.medicalRestriction] ?? e.medicalRestriction
                    : "";
                const load = p?.loadPref ? LOAD_LABEL[p.loadPref] ?? "" : "";
                return (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{e.name}</td>
                    <td className="py-1.5 pr-3">
                      {p ? (
                        <span className="text-green-500">✓ сдал</span>
                      ) : (
                        <span className="text-destructive">—</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">{unavail.length || ""}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{soft.length || ""}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{desired.length || ""}</td>
                    <td className="py-1.5 pr-3 text-xs">
                      {e.consecutivePref && e.consecutivePref !== "avoid"
                        ? e.consecutivePref.replace("prefer_", "по ")
                        : ""}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-amber-500">{med}</td>
                    <td className="py-1.5 pr-3 text-xs">{load}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-xs">
                      {p?.minShifts ? `≥ ${p.minShifts}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
