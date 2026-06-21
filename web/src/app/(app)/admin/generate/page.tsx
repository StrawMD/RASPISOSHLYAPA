"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export default function GeneratePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [normHours, setNormHours] = useState(120);
  const [timeLimit, setTimeLimit] = useState(120);
  const [seniorityFilter, setSeniorityFilter] = useState(false);
  const [ignoreFixedSlots, setIgnoreFixedSlots] = useState(false);
  const [versionName, setVersionName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    versionNumber: number;
    employeeHours: Record<string, number>;
    fixedSlotsApplied?: number;
    relaxed?: boolean;
    unfilled?: { post: string; day: number; kind: string; count: number }[];
    unfilledCount?: number;
    overtime?: { name: string; overTarget: number; overCeiling: number }[];
    emergencyOvertimeTotal?: number;
  } | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[] | null>(null);

  async function handleGenerate(relax = true) {
    setLoading(true);
    setResult(null);
    setDiagnostics(null);

    try {
      const res = await fetch("/api/schedule/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          month,
          normHours,
          timeLimit,
          seniorityFilter,
          ignoreFixedSlots,
          versionName: versionName || undefined,
          relax,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.infeasible && Array.isArray(data.diagnostics)) {
          setDiagnostics(data.diagnostics);
          toast.error("Расписание не сошлось — см. причины ниже");
        } else {
          toast.error(data.error || "Ошибка генерации");
        }
        return;
      }

      setResult({
        versionNumber: data.versionNumber,
        employeeHours: data.employeeHours,
        fixedSlotsApplied: data.fixedSlotsApplied,
        relaxed: data.relaxed,
        unfilled: data.unfilled,
        unfilledCount: data.unfilledCount,
        overtime: data.overtime,
        emergencyOvertimeTotal: data.emergencyOvertimeTotal,
      });
      const fs = typeof data.fixedSlotsApplied === "number" ? data.fixedSlotsApplied : 0;
      if (data.relaxed) {
        toast.success(
          `Черновик с пропусками v${data.versionNumber}: незакрытых позиций — ${data.unfilledCount ?? 0}. Список ниже.`,
        );
      } else if (data.emergencyOvertimeTotal > 0) {
        toast.success(
          `Версия ${data.versionNumber}: месяц закрыт с аварийной переработкой — ${data.emergencyOvertimeTotal}ч сверх желаемых потолков. Разбивка ниже.`,
        );
      } else {
        toast.success(
          fs > 0
            ? `Черновик v${data.versionNumber}: учтено фиксированных ячеек — ${fs}. На общей странице «Расписание» видна только опубликованная версия: откройте «Версии» и опубликуйте черновик или «Редактор».`
            : `Черновик v${data.versionNumber} создан без фиксов месяца (JSON в «Фикс. слоты» пуст или другой месяц). Опубликуйте в «Версии», чтобы обновить общее расписание.`,
        );
      }
    } catch {
      toast.error("Ошибка соединения");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold">Генерация расписания</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Параметры</CardTitle>
          <CardDescription>
            Настройте параметры и запустите солвер.
            Жёстко заданные ячейки для месяца (только админ) настраиваются в{" "}
            <Link href="/admin/fixed-slots" className="underline font-medium">
              Фикс. слоты
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Год</Label>
              <Select
                value={String(year)}
                onValueChange={(v) => v && setYear(parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[2025, 2026, 2027].map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Месяц</Label>
              <Select
                value={String(month)}
                onValueChange={(v) => v && setMonth(parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue>
                    {(val) => MONTH_NAMES[parseInt(val as string) - 1] ?? val}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((name, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Норма часов (на ставку)</Label>
              <Input
                type="number"
                value={normHours}
                onChange={(e) => setNormHours(parseFloat(e.target.value))}
                min={20}
                max={400}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Лимит солвера (сек)</Label>
              <Input
                type="number"
                value={timeLimit}
                onChange={(e) => setTimeLimit(parseInt(e.target.value))}
                min={10}
                max={600}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Название версии</Label>
              <Input
                placeholder="Черновик 1"
                value={versionName}
                onChange={(e) => setVersionName(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={seniorityFilter}
              onCheckedChange={(c) => setSeniorityFilter(!!c)}
            />
            Суточные (с) только при общем стаже &ge; 5 лет
          </label>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={ignoreFixedSlots}
              onCheckedChange={(c) => setIgnoreFixedSlots(!!c)}
            />
            <span>
              Игнорировать фиксированные слоты
              <span className="block text-xs text-muted-foreground">
                Экспериментальный прогон: версия генерируется так, будто фиксов
                месяца нет. Сами фиксы в БД не удаляются.
              </span>
            </span>
          </label>

          <Button
            onClick={() => handleGenerate(true)}
            disabled={loading}
            size="lg"
            className="w-full sm:w-auto"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Солвер работает...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Сгенерировать расписание
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            Солвер уважает все предпочтения и правила (в т.ч. потолок ночных
            ≤30%). Смены, которые нельзя закрыть без нарушения предпочтений,
            он оставит <strong>пустыми</strong> и покажет списком — их
            добавляете вручную в редакторе.
          </p>
        </CardContent>
      </Card>

      {diagnostics && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
          <CardHeader>
            <CardTitle className="text-base text-red-700 dark:text-red-400">
              Расписание не удалось составить
            </CardTitle>
            <CardDescription>
              Солвер не нашёл решения с текущими ограничениями. Вероятные
              причины:
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              {diagnostics.length === 0 ? (
                <li className="text-muted-foreground">
                  Точную причину определить не удалось. Проверьте отпуска,
                  лимиты ставок и требования к покрытию постов.
                </li>
              ) : (
                diagnostics.map((d, i) => <li key={i}>{d}</li>)
              )}
            </ul>
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => handleGenerate(true)}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Составить черновик с пропусками
              </Button>
              <span className="text-xs text-muted-foreground">
                Солвер закроет максимум позиций и честно покажет, что осталось
                незакрытым.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card
          className={
            result.relaxed
              ? "border-amber-200 bg-amber-50 dark:bg-amber-950/20"
              : "border-green-200 bg-green-50 dark:bg-green-950/20"
          }
        >
          <CardHeader>
            <CardTitle
              className={
                result.relaxed
                  ? "text-base text-amber-700 dark:text-amber-400"
                  : "text-base text-green-700 dark:text-green-400"
              }
            >
              {result.relaxed
                ? `Версия ${result.versionNumber}: черновик с пропусками (${result.unfilledCount ?? 0})`
                : `Версия ${result.versionNumber} создана`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result.relaxed &&
              result.unfilled &&
              result.unfilled.length > 0 && (
                <div className="mb-3 rounded border border-amber-300 bg-background/60 p-3">
                  <p className="text-sm font-medium mb-1.5">
                    Незакрытые позиции:
                  </p>
                  <ul className="list-disc pl-5 space-y-0.5 text-sm">
                    {result.unfilled.map((u, i) => (
                      <li key={i}>
                        {u.post}, день {u.day}: не закрыто ({u.kind}) — {u.count}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {(result.emergencyOvertimeTotal ?? 0) > 0 && (
              <div className="mb-3 rounded border border-orange-300 bg-orange-50/60 dark:bg-orange-950/20 p-3">
                <p className="text-sm font-medium mb-1.5 text-orange-700 dark:text-orange-400">
                  Аварийная переработка сверх желаемых потолков:{" "}
                  {result.emergencyOvertimeTotal}ч
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  Спрос не закрывался в пределах желаемых потолков, поэтому часть
                  людей выведена выше maxRate (но не выше 2.0 ставки). Распределено
                  пропорционально: больше — тем, у кого есть запас по потолку и
                  меньше стаж.
                </p>
                <ul className="space-y-0.5 text-sm">
                  {(result.overtime ?? [])
                    .filter((o) => o.overCeiling > 0)
                    .map((o, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span>{o.name}</span>
                        <span className="text-orange-600 dark:text-orange-400 font-medium tabular-nums">
                          +{o.overCeiling}ч сверх потолка
                          {o.overTarget > o.overCeiling
                            ? ` (всего +${o.overTarget}ч к цели)`
                            : ""}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
            <p className="text-sm text-muted-foreground mb-2">
              Это <strong>черновик</strong> — на странице «Расписание» для
              сотрудников по-прежнему показывается только{" "}
              <strong>опубликованная</strong> версия. Перейдите во{" "}
              <a href="/admin/versions" className="underline font-medium">
                Версии
              </a>{" "}
              и нажмите «Опубликовать» у нужной версии.
            </p>
            {typeof result.fixedSlotsApplied === "number" && (
              <p className="text-sm mb-3">
                Фиксированных ячеек в расчёте:{" "}
                <strong>{result.fixedSlotsApplied}</strong>
                {result.fixedSlotsApplied === 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    — проверьте «Фикс. слоты» для того же года и месяца и что вы
                    нажали «Сохранить» под учётной записью администратора.
                  </span>
                )}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {Object.entries(result.employeeHours)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, hours]) => (
                  <Badge key={name} variant="outline">
                    {name}: {hours}ч
                  </Badge>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
