"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Clock } from "lucide-react";

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

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const PREF_OPTIONS = [
  { value: "null", label: "Нейтрально" },
  { value: "prefer", label: "Предпочитаю" },
  { value: "avoid", label: "Не ставить" },
];

const PREF3 = [
  { value: "prefer", label: "Предпочитаю" },
  { value: "neutral", label: "Нейтрально" },
  { value: "avoid", label: "Не ставить" },
];

const PREF_COLOR: Record<string, string> = {
  prefer: "text-green-500",
  avoid: "text-red-400",
  neutral: "text-muted-foreground",
  null: "text-muted-foreground",
};

function prefLabel(v: string) {
  const label =
    [...PREF_OPTIONS, ...PREF3].find((o) => o.value === v)?.label ?? v;
  const color = PREF_COLOR[v] ?? "";
  return <span className={color}>{label}</span>;
}

type Post = { id: string; name: string; shiftHours: number };

interface Props {
  employeeId: string;
  employeeName: string;
  employeeRate: number;
  posts: Post[];
  has24h: boolean;
  year: number;
  month: number;
  monthId: string | null;
  deadline: string | null;
  monthStatus: string;
  isAdmin?: boolean;
  existing: {
    pref24hFull: string | null;
    pref24hDay: string | null;
    pref24hNight: string | null;
    postPreferences: Record<string, string>;
    unavailableDays: number[];
    weekdayPref: string | null;
    weekendPref: string | null;
    dayOfWeekPrefs: Record<string, string>;
    desiredDates: number[];
    comment: string | null;
  } | null;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function PreferencesForm({
  employeeId,
  employeeName,
  employeeRate,
  posts,
  has24h,
  year,
  month,
  monthId,
  deadline,
  monthStatus,
  isAdmin = false,
  existing,
}: Props) {
  const [pref24hFull, setPref24hFull] = useState(
    existing?.pref24hFull ?? "null",
  );
  const [pref24hDay, setPref24hDay] = useState(existing?.pref24hDay ?? "null");
  const [pref24hNight, setPref24hNight] = useState(
    existing?.pref24hNight ?? "null",
  );
  const [postPrefs, setPostPrefs] = useState<Record<string, string>>(
    existing?.postPreferences ?? {},
  );
  const [unavailable, setUnavailable] = useState<Set<number>>(
    new Set(existing?.unavailableDays ?? []),
  );
  const [desired, setDesired] = useState<Set<number>>(
    new Set(existing?.desiredDates ?? []),
  );
  const [weekdayPref, setWeekdayPref] = useState(
    existing?.weekdayPref ?? "null",
  );
  const [weekendPref, setWeekendPref] = useState(
    existing?.weekendPref ?? "null",
  );
  const [dowPrefs, setDowPrefs] = useState<Record<string, string>>(
    existing?.dayOfWeekPrefs ?? {},
  );
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [isPending, startTransition] = useTransition();

  const isLocked = monthStatus !== "collecting";
  const deadlineDate = deadline ? new Date(deadline) : null;
  const isPastDeadline = deadlineDate ? new Date() > deadlineDate : false;
  const readOnly = !isAdmin && (isLocked || isPastDeadline);

  const numDays = getDaysInMonth(year, month);
  const maxConsec = employeeRate >= 1.0 ? 3 : 6;

  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= numDays; d++) cells.push(d);

  function toggleUnavailable(day: number) {
    if (readOnly) return;
    setUnavailable((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
        desired.has(day) &&
          setDesired((p) => {
            const n = new Set(p);
            n.delete(day);
            return n;
          });
      }
      return next;
    });
  }

  function toggleDesired(day: number) {
    if (readOnly) return;
    setDesired((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
        unavailable.has(day) &&
          setUnavailable((p) => {
            const n = new Set(p);
            n.delete(day);
            return n;
          });
      }
      return next;
    });
  }

  function getConsecutiveWarning(): string | null {
    const arr = Array.from(unavailable).sort((a, b) => a - b);
    if (arr.length === 0) return null;
    let run = 1;
    let maxRun = 1;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] === arr[i - 1] + 1) {
        run++;
        if (run > maxRun) maxRun = run;
      } else run = 1;
    }
    if (maxRun > maxConsec) {
      return `${maxRun} дней подряд (макс. ${maxConsec}). ${employeeRate >= 1.0 ? "Более 3 дней подряд требует согласования с администратором." : ""}`;
    }
    return null;
  }

  const consecutiveWarning = getConsecutiveWarning();

  async function handleSave() {
    startTransition(async () => {
      const res = await fetch("/api/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          year,
          month,
          pref24hFull: pref24hFull === "null" ? null : pref24hFull,
          pref24hDay: pref24hDay === "null" ? null : pref24hDay,
          pref24hNight: pref24hNight === "null" ? null : pref24hNight,
          postPreferences: postPrefs,
          unavailableDays: Array.from(unavailable).sort((a, b) => a - b),
          weekdayPref: weekdayPref === "null" ? null : weekdayPref,
          weekendPref: weekendPref === "null" ? null : weekendPref,
          dayOfWeekPrefs: dowPrefs,
          desiredDates: Array.from(desired).sort((a, b) => a - b),
          comment: comment || null,
        }),
      });
      if (res.ok) {
        toast.success("Предпочтения сохранены");
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Ошибка сохранения");
      }
    });
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold">Предпочтения</h1>
        <p className="text-sm text-muted-foreground">
          {employeeName} — на {MONTH_NAMES[month - 1]} {year}
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
            {isPastDeadline && !isAdmin && (
              <Badge variant="destructive" className="ml-2">
                Дедлайн прошёл
              </Badge>
            )}
          </div>
        )}
      </div>

      {readOnly && (
        <Card className="border-yellow-500/30 bg-yellow-950/20">
          <CardContent className="py-3 text-sm">
            Сбор предпочтений завершён. Изменения больше не принимаются.
          </CardContent>
        </Card>
      )}

      {posts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Предпочтения по аппаратам
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {posts.map((post) => (
              <div
                key={post.id}
                className="flex items-center gap-3 rounded border px-3 py-1.5 text-sm"
              >
                <span className="flex-1">{post.name}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {post.shiftHours}ч
                </Badge>
                <Select
                  value={postPrefs[post.id] ?? "neutral"}
                  onValueChange={(v) => {
                    if (!v) return;
                    setPostPrefs((p) => {
                      const next = { ...p, [post.id]: v };
                      if (v === "neutral") delete next[post.id];
                      return next;
                    });
                  }}
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-36 h-7 text-xs">
                    <SelectValue>{prefLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PREF3.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        <span className={PREF_COLOR[o.value] ?? ""}>
                          {o.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {has24h && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Суточные смены</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                label: "Полные сутки (с)",
                val: pref24hFull,
                set: setPref24hFull,
              },
              { label: "Дневные (д)", val: pref24hDay, set: setPref24hDay },
              { label: "Ночные (н)", val: pref24hNight, set: setPref24hNight },
            ].map((item) => (
              <div key={item.label} className="space-y-1.5">
                <label className="text-sm font-medium">{item.label}</label>
                <Select
                  value={item.val}
                  onValueChange={(v) => v && item.set(v)}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue>{prefLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PREF_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        <span className={PREF_COLOR[o.value] ?? ""}>
                          {o.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Будни / Выходные</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Будни</label>
            <Select
              value={weekdayPref}
              onValueChange={(v) => v && setWeekdayPref(v)}
              disabled={readOnly}
            >
              <SelectTrigger>
                <SelectValue>{prefLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PREF_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <span className={PREF_COLOR[o.value] ?? ""}>{o.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Выходные</label>
            <Select
              value={weekendPref}
              onValueChange={(v) => v && setWeekendPref(v)}
              disabled={readOnly}
            >
              <SelectTrigger>
                <SelectValue>{prefLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PREF_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <span className={PREF_COLOR[o.value] ?? ""}>{o.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Дни недели</CardTitle>
          <CardDescription>
            Можно указать предпочтения по конкретным дням недели
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1">
            {DAY_NAMES.map((name, i) => {
              const key = String(i + 1);
              const val = dowPrefs[key] ?? "neutral";
              return (
                <div key={key} className="text-center">
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    {name}
                  </div>
                  <Select
                    value={val}
                    onValueChange={(v) => {
                      if (!v) return;
                      setDowPrefs((p) => {
                        const next = { ...p, [key]: v };
                        if (v === "neutral") delete next[key];
                        return next;
                      });
                    }}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-7 text-[10px] px-1">
                      <SelectValue>{prefLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {PREF3.map((o) => (
                        <SelectItem
                          key={o.value}
                          value={o.value}
                          className="text-xs"
                        >
                          <span className={PREF_COLOR[o.value] ?? ""}>
                            {o.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Желаемые даты</CardTitle>
          <CardDescription>
            Необязательно, повышает вероятность, но не гарантия. Отмечено:{" "}
            {desired.size}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-px text-center text-xs font-medium text-muted-foreground mb-1">
            {DAY_NAMES.map((d) => (
              <div key={d} className="py-0.5">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <div key={`e-${i}`} className="h-8" />;
              const isD = desired.has(day);
              const isU = unavailable.has(day);
              return (
                <button
                  key={day}
                  onClick={() => toggleDesired(day)}
                  disabled={readOnly}
                  className={`h-8 rounded text-xs font-medium transition-colors ${
                    isD
                      ? "bg-green-600/30 text-green-400 ring-1 ring-green-500/50"
                      : isU
                        ? "bg-destructive/20 text-destructive opacity-50 cursor-not-allowed"
                        : "bg-muted/30 hover:bg-muted"
                  } ${readOnly ? "cursor-default" : "cursor-pointer"}`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Дни, когда НЕ могу работать
          </CardTitle>
          <CardDescription>
            Отмечено: {unavailable.size}.
            {employeeRate >= 1.0
              ? " Основной: макс. 3 дня подряд (больше — согласование с админом)"
              : ` Совместитель: макс. ${maxConsec} дней подряд`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {consecutiveWarning && (
            <div className="mb-2 rounded bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {consecutiveWarning}
            </div>
          )}
          <div className="grid grid-cols-7 gap-px text-center text-xs font-medium text-muted-foreground mb-1">
            {DAY_NAMES.map((d) => (
              <div key={d} className="py-0.5">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <div key={`e2-${i}`} className="h-8" />;
              const isU = unavailable.has(day);
              const date = new Date(year, month - 1, day);
              const weekend = date.getDay() === 0 || date.getDay() === 6;
              return (
                <button
                  key={day}
                  onClick={() => toggleUnavailable(day)}
                  disabled={readOnly}
                  className={`h-8 rounded text-xs font-medium transition-colors ${
                    isU
                      ? "bg-destructive text-destructive-foreground"
                      : weekend
                        ? "bg-red-950/20 hover:bg-red-900/30"
                        : "bg-muted/30 hover:bg-muted"
                  } ${readOnly ? "cursor-default" : "cursor-pointer"}`}
                >
                  {day}
                </button>
              );
            })}
          </div>
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
        <Button
          onClick={handleSave}
          disabled={isPending}
          className="w-full sm:w-auto"
        >
          {isPending ? "Сохранение..." : "Сохранить предпочтения"}
        </Button>
      )}
    </div>
  );
}
