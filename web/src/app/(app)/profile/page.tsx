import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeTenure, yearsWord } from "@/lib/seniority";
import { SignOutButton } from "./sign-out-button";

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  schedule_manager: "Ответственный за расписание",
  employee: "Сотрудник",
};

export default async function ProfilePage() {
  const session = await auth();
  const userName = session?.user?.name ?? "—";
  const role = (session?.user as { role?: string } | undefined)?.role ?? "";
  const employeeId =
    (session?.user as { employeeId?: string | null } | undefined)?.employeeId ??
    null;

  const employee = employeeId
    ? await prisma.employee.findUnique({
        where: { id: employeeId },
        select: {
          name: true,
          rate: true,
          hospitalStartYear: true,
          careerStartYear: true,
          seniority: true,
        },
      })
    : null;

  const tenure = employee ? computeTenure(employee) : null;

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-md">
      <h1 className="text-xl font-semibold mb-4">Профиль</h1>

      <Card>
        <CardHeader>
          <CardTitle>{userName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Роль:</span>
            <Badge>{ROLE_LABELS[role] ?? role}</Badge>
          </div>

          {employee && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Ставка:</span>
              <Badge variant="outline">{employee.rate}</Badge>
            </div>
          )}

          {tenure && (employee?.hospitalStartYear || employee?.careerStartYear) && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Стаж в больнице</span>
                <span className="font-medium">
                  {employee?.hospitalStartYear != null
                    ? `${tenure.hospitalYears} ${yearsWord(tenure.hospitalYears)}`
                    : "—"}
                  {employee?.hospitalStartYear != null && (
                    <span className="text-xs text-muted-foreground ml-1.5">
                      c {employee.hospitalStartYear}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Общий стаж</span>
                <span className="font-medium">
                  {employee?.careerStartYear != null
                    ? `${tenure.careerYears} ${yearsWord(tenure.careerYears)}`
                    : `${tenure.hospitalYears} ${yearsWord(tenure.hospitalYears)}`}
                  {employee?.careerStartYear != null && (
                    <span className="text-xs text-muted-foreground ml-1.5">
                      c {employee.careerStartYear}
                    </span>
                  )}
                </span>
              </div>
              {tenure.externalYears > 0 && (
                <p className="text-[11px] text-muted-foreground pt-0.5">
                  Из них вне больницы: {tenure.externalYears}{" "}
                  {yearsWord(tenure.externalYears)}.
                </p>
              )}
            </div>
          )}

          <SignOutButton />
        </CardContent>
      </Card>
    </div>
  );
}
