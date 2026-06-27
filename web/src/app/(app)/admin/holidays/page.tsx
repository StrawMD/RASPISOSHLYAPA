"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Save } from "lucide-react";

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

type MonthNorm = {
  month: number;
  computed: number;
  override: number | null;
  value: number;
};

export default function HolidaysPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [norms, setNorms] = useState<MonthNorm[]>([]);
  const [normDrafts, setNormDrafts] = useState<Record<number, string>>({});

  const loadHolidays = useCallback(async () => {
    const res = await fetch(`/api/admin/holidays?year=${year}`);
    if (res.ok) {
      const data: string[] = await res.json();
      setHolidays(new Set(data));
    }
  }, [year]);

  const loadNorms = useCallback(async () => {
    const res = await fetch(`/api/admin/month-norm?year=${year}`);
    if (res.ok) {
      const data: { months: MonthNorm[] } = await res.json();
      setNorms(data.months ?? []);
      const drafts: Record<number, string> = {};
      for (const m of data.months ?? []) {
        drafts[m.month] = m.override != null ? String(m.override) : "";
      }
      setNormDrafts(drafts);
    }
  }, [year]);

  useEffect(() => {
    loadHolidays();
    loadNorms();
  }, [loadHolidays, loadNorms]);

  async function saveNorm(month: number) {
    const raw = (normDrafts[month] ?? "").trim();
    const override = raw === "" ? null : parseFloat(raw);
    const res = await fetch("/api/admin/month-norm", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, month, override }),
    });
    if (res.ok) {
      toast.success("Норма сохранена");
      loadNorms();
    } else {
      toast.error("Ошибка сохранения нормы");
    }
  }

  function toggleDate(dateStr: string) {
    setHolidays((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  }

  async function save() {
    setLoading(true);
    const res = await fetch("/api/admin/holidays", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year,
        dates: Array.from(holidays).sort(),
      }),
    });
    setLoading(false);
    if (res.ok) {
      toast.success("Праздники сохранены");
      loadNorms();
    } else toast.error("Ошибка");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Праздники</h1>
        <div className="flex items-center gap-2">
          <Select
            value={String(year)}
            onValueChange={(v) => v && setYear(parseInt(v))}
          >
            <SelectTrigger className="w-24">
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
          <Button onClick={save} disabled={loading}>
            <Save className="h-4 w-4 mr-1" />
            Сохранить
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Нажмите на день, чтобы отметить/снять праздник. Отмечено:{" "}
        {holidays.size} дн.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 12 }, (_, m) => m + 1).map((mo) => {
          const daysInMonth = new Date(year, mo, 0).getDate();
          const firstDow = (new Date(year, mo - 1, 1).getDay() + 6) % 7;
          const cells: (number | null)[] = [];
          for (let i = 0; i < firstDow; i++) cells.push(null);
          for (let d = 1; d <= daysInMonth; d++) cells.push(d);

          return (
            <Card key={mo}>
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-sm">{MONTH_NAMES[mo - 1]}</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <div className="grid grid-cols-7 gap-px text-center text-[10px] text-muted-foreground mb-0.5">
                  {DAY_NAMES.map((d) => (
                    <div key={d}>{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                  {cells.map((day, i) => {
                    if (day === null) return <div key={`e${i}`} />;
                    const dateStr = `${year}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const isHoliday = holidays.has(dateStr);
                    const date = new Date(year, mo - 1, day);
                    const weekend =
                      date.getDay() === 0 || date.getDay() === 6;

                    return (
                      <button
                        key={day}
                        onClick={() => toggleDate(dateStr)}
                        className={`aspect-square rounded text-[11px] font-medium transition-colors
                          ${isHoliday
                            ? "bg-red-500 text-white"
                            : weekend
                              ? "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400"
                              : "hover:bg-muted"
                          }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-base">
            Норма часов по месяцам ({year})
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-sm text-muted-foreground mb-3">
            «Эталон» считается автоматически из праздников (будни×6, минус
            праздники, предпраздничный день короче на час) и используется как
            источник истины при генерации. Заполните «Своё значение», только если
            нужно переопределить эталон — оно станет дефолтом для генерации
            (которое всё ещё можно поменять на отдельном прогоне).
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {norms.map((n) => {
              const draft = normDrafts[n.month] ?? "";
              const changed =
                (n.override != null ? String(n.override) : "") !== draft.trim();
              return (
                <div
                  key={n.month}
                  className="flex items-center gap-2 rounded border px-3 py-2 text-sm"
                >
                  <span className="w-20 font-medium">
                    {MONTH_NAMES[n.month - 1]}
                  </span>
                  <span className="text-muted-foreground tabular-nums w-14">
                    {n.computed}ч
                  </span>
                  <Input
                    type="number"
                    value={draft}
                    placeholder="свои"
                    className="h-8 w-20"
                    min={20}
                    max={400}
                    onChange={(e) =>
                      setNormDrafts((p) => ({
                        ...p,
                        [n.month]: e.target.value,
                      }))
                    }
                  />
                  <Button
                    size="sm"
                    variant={changed ? "default" : "outline"}
                    className="h-8"
                    disabled={!changed}
                    onClick={() => saveNorm(n.month)}
                  >
                    OK
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
