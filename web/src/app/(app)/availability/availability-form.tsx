"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Clock, X } from "lucide-react";

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

interface Interval {
  start: number;
  end: number;
}

interface Props {
  employeeId: string;
  year: number;
  month: number;
  monthId: string | null;
  deadline: string | null;
  monthStatus: string;
  existing: {
    unavailableDays: number[];
    comment: string | null;
  } | null;
  isAdmin: boolean;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function daysToIntervals(days: number[]): Interval[] {
  if (days.length === 0) return [];
  const sorted = [...days].sort((a, b) => a - b);
  const intervals: Interval[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
    } else {
      intervals.push({ start, end: prev });
      start = sorted[i];
      prev = sorted[i];
    }
  }
  intervals.push({ start, end: prev });
  return intervals;
}

function intervalsToDays(intervals: Interval[]): number[] {
  const days = new Set<number>();
  for (const iv of intervals) {
    for (let d = iv.start; d <= iv.end; d++) days.add(d);
  }
  return Array.from(days).sort((a, b) => a - b);
}

export function AvailabilityForm({
  employeeId,
  year,
  month,
  monthId,
  deadline,
  monthStatus,
  existing,
  isAdmin,
}: Props) {
  const numDays = daysInMonth(year, month);
  const [intervals, setIntervals] = useState<Interval[]>(
    daysToIntervals(existing?.unavailableDays ?? [])
  );
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [isPending, startTransition] = useTransition();
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);

  const isLocked = monthStatus !== "collecting" && !isAdmin;
  const deadlineDate = deadline ? new Date(deadline) : null;
  const isPastDeadline = deadlineDate ? new Date() > deadlineDate : false;
  const readOnly = (isLocked || isPastDeadline) && !isAdmin;

  const selectedDays = new Set(intervalsToDays(intervals));

  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= numDays; d++) cells.push(d);

  function getPreviewRange(): Set<number> {
    if (selectionStart === null || hoveredDay === null) return new Set();
    const from = Math.min(selectionStart, hoveredDay);
    const to = Math.max(selectionStart, hoveredDay);
    const s = new Set<number>();
    for (let d = from; d <= to; d++) s.add(d);
    return s;
  }

  const preview = getPreviewRange();

  function handleDayDown(day: number) {
    if (readOnly) return;
    setSelectionStart(day);
    setHoveredDay(day);
  }

  function handleDayHover(day: number) {
    if (selectionStart !== null) {
      setHoveredDay(day);
    }
  }

  function handleDayUp() {
    if (readOnly || selectionStart === null || hoveredDay === null) return;
    const from = Math.min(selectionStart, hoveredDay);
    const to = Math.max(selectionStart, hoveredDay);

    const allSelected = Array.from({ length: to - from + 1 }, (_, i) => from + i).every(
      (d) => selectedDays.has(d)
    );

    if (allSelected) {
      const removeDays = new Set(
        Array.from({ length: to - from + 1 }, (_, i) => from + i)
      );
      const remaining = intervalsToDays(intervals).filter((d) => !removeDays.has(d));
      setIntervals(daysToIntervals(remaining));
    } else {
      const newIv: Interval = { start: from, end: to };
      const allDays = intervalsToDays([...intervals, newIv]);
      setIntervals(daysToIntervals(allDays));
    }

    setSelectionStart(null);
    setHoveredDay(null);
  }

  function removeInterval(idx: number) {
    setIntervals((prev) => prev.filter((_, i) => i !== idx));
  }

  function formatInterval(iv: Interval): string {
    if (iv.start === iv.end) return `${iv.start}`;
    return `${iv.start}–${iv.end}`;
  }

  async function handleSave() {
    startTransition(async () => {
      const res = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          year,
          month,
          unavailableDays: intervalsToDays(intervals),
          comment: comment || null,
        }),
      });
      if (res.ok) {
        toast.success("Отпуска / недоступность сохранены");
      } else {
        toast.error("Ошибка сохранения");
      }
    });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold">Отпуска и недоступность</h1>
        <p className="text-sm text-muted-foreground">
          На {MONTH_NAMES[month - 1]} {year}
        </p>
        {deadlineDate && (
          <div className="flex items-center gap-1.5 mt-2 text-sm">
            <Clock className="h-4 w-4" />
            <span>
              Дедлайн:{" "}
              <strong>
                {deadlineDate.toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "long",
                })}
              </strong>
            </span>
            {isPastDeadline && (
              <Badge variant="destructive" className="ml-2">
                Дедлайн прошёл
              </Badge>
            )}
          </div>
        )}
      </div>

      {readOnly && (
        <Card className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20">
          <CardContent className="py-3 text-sm">
            Сбор данных завершён. Изменения больше не принимаются.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Выделите интервалы недоступности
          </CardTitle>
          <CardDescription>
            Зажмите и проведите по дням, чтобы выделить интервал.
            Нажмите на выделенный интервал, чтобы снять выделение.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="select-none"
            onMouseUp={handleDayUp}
            onMouseLeave={() => {
              if (selectionStart !== null) handleDayUp();
            }}
          >
            <div className="grid grid-cols-7 gap-px text-center text-xs font-medium text-muted-foreground mb-1">
              {DAY_NAMES.map((d) => (
                <div key={d} className="py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((day, i) => {
                if (day === null) {
                  return <div key={`empty-${i}`} className="h-8" />;
                }
                const isOff = selectedDays.has(day);
                const isPreviewing = preview.has(day);
                const date = new Date(year, month - 1, day);
                const weekend = date.getDay() === 0 || date.getDay() === 6;

                let bg = "bg-muted/30 hover:bg-muted";
                if (isOff) bg = "bg-destructive/80 text-destructive-foreground";
                if (isPreviewing && !isOff) bg = "bg-destructive/40 text-foreground";
                if (isPreviewing && isOff) bg = "bg-destructive text-destructive-foreground";
                if (!isOff && !isPreviewing && weekend) bg = "bg-red-50 dark:bg-red-950/20 hover:bg-red-100";

                return (
                  <button
                    key={day}
                    onMouseDown={() => handleDayDown(day)}
                    onMouseEnter={() => handleDayHover(day)}
                    disabled={readOnly}
                    className={`h-8 rounded text-sm font-medium transition-colors cursor-pointer ${bg} ${readOnly ? "cursor-default" : ""}`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          {intervals.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {intervals.map((iv, idx) => (
                <Badge
                  key={idx}
                  variant="destructive"
                  className="gap-1 pr-1"
                >
                  {formatInterval(iv)} ({iv.end - iv.start + 1} дн.)
                  {!readOnly && (
                    <button
                      onClick={() => removeInterval(idx)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-white/20"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              ))}
              <span className="text-xs text-muted-foreground self-center ml-1">
                Всего: {intervalsToDays(intervals).length} дн.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Комментарий</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Дополнительные пожелания..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={readOnly}
            rows={3}
          />
        </CardContent>
      </Card>

      {!readOnly && (
        <Button onClick={handleSave} disabled={isPending} className="w-full sm:w-auto">
          {isPending ? "Сохранение..." : "Сохранить"}
        </Button>
      )}
    </div>
  );
}
