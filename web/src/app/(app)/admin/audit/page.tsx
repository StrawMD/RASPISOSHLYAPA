import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const edits = await prisma.scheduleEdit.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      user: { select: { login: true, employee: { select: { name: true } } } },
      version: {
        select: {
          versionNumber: true,
          name: true,
          month: { select: { year: true, month: true } },
        },
      },
    },
  });

  const MONTH_NAMES_SHORT = [
    "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
    "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Журнал изменений</h1>

      {edits.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Нет записей
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1">
          {edits.map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-3 py-2 px-3 border-b text-sm"
            >
              <span className="text-xs text-muted-foreground w-36 shrink-0">
                {e.createdAt.toLocaleString("ru-RU")}
              </span>
              <span className="font-medium w-28 shrink-0">
                {e.user.employee?.name ?? e.user.login}
              </span>
              <Badge variant="outline" className="text-xs shrink-0">
                {e.editType}
              </Badge>
              <span className="text-muted-foreground text-xs">
                {MONTH_NAMES_SHORT[e.version.month.month - 1]}{" "}
                {e.version.month.year} v{e.version.versionNumber}
              </span>
              <span>
                день {e.day}, {e.postId}
              </span>
              {e.oldValue && (
                <span className="text-red-500 text-xs line-through">
                  {e.oldValue}
                </span>
              )}
              {e.newValue && (
                <span className="text-green-600 text-xs">{e.newValue}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
