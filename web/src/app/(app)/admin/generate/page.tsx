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
  const [versionName, setVersionName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    versionNumber: number;
    employeeHours: Record<string, number>;
    fixedSlotsApplied?: number;
  } | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setResult(null);

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
          versionName: versionName || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Ошибка генерации");
        return;
      }

      setResult({
        versionNumber: data.versionNumber,
        employeeHours: data.employeeHours,
        fixedSlotsApplied: data.fixedSlotsApplied,
      });
      const fs = typeof data.fixedSlotsApplied === "number" ? data.fixedSlotsApplied : 0;
      toast.success(
        fs > 0
          ? `Черновик v${data.versionNumber}: учтено фиксированных ячеек — ${fs}. На общей странице «Расписание» видна только опубликованная версия: откройте «Версии» и опубликуйте черновик или «Редактор».`
          : `Черновик v${data.versionNumber} создан без фиксов месяца (JSON в «Фикс. слоты» пуст или другой месяц). Опубликуйте в «Версии», чтобы обновить общее расписание.`
      );
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
            Суточные (с) только для стажа &ge; 5 лет
          </label>

          <Button
            onClick={handleGenerate}
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
        </CardContent>
      </Card>

      {result && (
        <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
          <CardHeader>
            <CardTitle className="text-base text-green-700 dark:text-green-400">
              Версия {result.versionNumber} создана
            </CardTitle>
          </CardHeader>
          <CardContent>
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
