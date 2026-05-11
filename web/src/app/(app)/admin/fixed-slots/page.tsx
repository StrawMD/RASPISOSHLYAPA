"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Pin } from "lucide-react";

const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const EXAMPLE = `{
  "15": {
    "ssk1": ["Иванов(д)", "Петров(н)"],
    "kt_2011": ["Сидорова"]
  }
}`;

export default function FixedSlotsPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [text, setText] = useState("{}");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/fixed-slots?year=${year}&month=${month}`
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Ошибка загрузки");
        return;
      }
      setText(JSON.stringify(data.fixedSlots ?? {}, null, 2));
    } catch {
      toast.error("Ошибка соединения");
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      toast.error("Некорректный JSON");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/fixed-slots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month, fixedSlots: parsed }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Ошибка сохранения");
        return;
      }
      toast.success("Сохранено");
      setText(JSON.stringify(data.fixedSlots ?? {}, null, 2));
    } catch {
      toast.error("Ошибка соединения");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Pin className="h-7 w-7" />
          Фиксированные слоты для генератора
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Только администратор. Эти ячейки солвер обязан соблюдать при запуске
          из раздела «Генерация». Формат совпадает с расписанием: день → пост →
          список фамилий; на суточных постах указывайте{" "}
          <span className="font-mono text-xs">(с)</span>,{" "}
          <span className="font-mono text-xs">(д)</span> или{" "}
          <span className="font-mono text-xs">(н)</span>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Месяц</CardTitle>
          <CardDescription>
            Выберите месяц и отредактируйте JSON, затем сохраните.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Год</Label>
              <Select
                value={String(year)}
                onValueChange={(v) => v && setYear(parseInt(v, 10))}
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
                onValueChange={(v) => v && setMonth(parseInt(v, 10))}
              >
                <SelectTrigger>
                  <SelectValue>
                    {(val) =>
                      MONTH_NAMES[parseInt(val as string, 10) - 1] ?? val
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((name, i) => (
                    <SelectItem key={name} value={String(i + 1)}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>JSON</Label>
            <Textarea
              className="font-mono text-xs min-h-[280px]"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={loading}
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Пример:{" "}
              <code className="whitespace-pre-wrap break-all">{EXAMPLE}</code>
            </p>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button onClick={handleSave} disabled={saving || loading}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Сохранить"
              )}
            </Button>
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Перезагрузить"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
