"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
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

export default function HolidaysPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const loadHolidays = useCallback(async () => {
    const res = await fetch(`/api/admin/holidays?year=${year}`);
    if (res.ok) {
      const data: string[] = await res.json();
      setHolidays(new Set(data));
    }
  }, [year]);

  useEffect(() => {
    loadHolidays();
  }, [loadHolidays]);

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
    if (res.ok) toast.success("Праздники сохранены");
    else toast.error("Ошибка");
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
    </div>
  );
}
