"use client";

import { useMemo, useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Clock } from "lucide-react";
import { useRouter } from "next/navigation";

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

const MODALITIES = ["КТ", "МРТ"] as const;
const RATE_STEPS = [0.25, 0.5, 0.75, 1.0];
const TARGET_RATE_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

type ShiftTimeMode = "only_full" | "prefer_full" | "neutral" | "prefer_day";

const SHIFT_TIME_MODE_OPTIONS: { value: ShiftTimeMode; label: string }[] = [
  { value: "only_full", label: "Только суточные" },
  { value: "prefer_full", label: "Предпочитаю суточные" },
  { value: "neutral", label: "Нейтрально" },
  { value: "prefer_day", label: "Предпочитаю дневные" },
];

function isShiftTimeMode(v: unknown): v is ShiftTimeMode {
  return (
    v === "only_full" ||
    v === "prefer_full" ||
    v === "neutral" ||
    v === "prefer_day"
  );
}

/**
 * Backward-compat: derive the aggregate mode from the legacy per-24h-post
 * flags (pref24hFull/Day/Night).  Used when the explicit `shiftTimeMode`
 * wasn't saved yet on an old preference record.
 */
function deriveLegacyShiftTimeMode(
  full: string | null,
  day: string | null,
  night: string | null,
): ShiftTimeMode {
  if (full === "prefer" && day === "avoid" && night === "avoid")
    return "only_full";
  if (full === "prefer") return "prefer_full";
  if (day === "prefer") return "prefer_day";
  return "neutral";
}

function prefLabel(v: string) {
  const label =
    [...PREF_OPTIONS, ...PREF3].find((o) => o.value === v)?.label ?? v;
  const color = PREF_COLOR[v] ?? "";
  return <span className={color}>{label}</span>;
}

function shiftTimeModeLabel(v: string) {
  return SHIFT_TIME_MODE_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

type Post = {
  id: string;
  name: string;
  shiftHours: number;
  modality: string;
};

interface Props {
  employeeId: string;
  employeeName: string;
  employee: {
    rate: number;
    targetRate: number;
    maxRate: number;
    modalities: string[];
    can24h: boolean;
    hospitalStartYear: number | null;
    careerStartYear: number | null;
  };
  posts: Post[];
  has24hPostsInSystem: boolean;
  year: number;
  month: number;
  monthId?: string | null;
  deadline: string | null;
  monthStatus: string;
  isAdmin?: boolean;
  existing: {
    pref24hFull: string | null;
    pref24hDay: string | null;
    pref24hNight: string | null;
    shiftTimeMode: string | null;
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
  employee,
  posts,
  has24hPostsInSystem,
  year,
  month,
  deadline,
  monthStatus,
  isAdmin = false,
  existing,
}: Props) {
  const router = useRouter();

  const initialRate =
    typeof employee.rate === "number" && employee.rate > 0
      ? employee.rate
      : 1.0;
  const initialMaxRate =
    typeof employee.maxRate === "number" && employee.maxRate >= initialRate
      ? employee.maxRate
      : Math.max(1.5, initialRate);
  const initialTargetRate =
    typeof employee.targetRate === "number" && employee.targetRate > 0
      ? Math.min(Math.max(employee.targetRate, initialRate), initialMaxRate)
      : initialRate;

  const [rate, setRate] = useState(initialRate);
  const [targetRate, setTargetRate] = useState(initialTargetRate);
  const [maxRate, setMaxRate] = useState(initialMaxRate);
  const [modalities, setModalities] = useState<string[]>(employee.modalities);
  const [can24h, setCan24h] = useState(employee.can24h);
  const [hospitalYearStr, setHospitalYearStr] = useState(() =>
    employee.hospitalStartYear != null ? String(employee.hospitalStartYear) : "",
  );
  const [careerYearStr, setCareerYearStr] = useState(() =>
    employee.careerStartYear != null ? String(employee.careerStartYear) : "",
  );

  const initialShiftTimeMode: ShiftTimeMode = isShiftTimeMode(
    existing?.shiftTimeMode,
  )
    ? (existing!.shiftTimeMode as ShiftTimeMode)
    : deriveLegacyShiftTimeMode(
        existing?.pref24hFull ?? null,
        existing?.pref24hDay ?? null,
        existing?.pref24hNight ?? null,
      );
  const [shiftTimeMode, setShiftTimeMode] =
    useState<ShiftTimeMode>(initialShiftTimeMode);
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
  const maxConsec = rate >= 1.0 ? 3 : 6;

  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= numDays; d++) cells.push(d);

  const visiblePosts = useMemo(() => {
    const modSet = new Set(modalities);
    return posts.filter((p) => p.modality && modSet.has(p.modality));
  }, [posts, modalities]);

  const has24h =
    can24h &&
    modalities.includes("КТ") &&
    has24hPostsInSystem &&
    visiblePosts.some((p) => p.shiftHours === 24);

  function toggleModality(mod: string) {
    if (readOnly) return;
    setModalities((prev) => {
      const next = prev.includes(mod)
        ? prev.filter((m) => m !== mod)
        : [...prev, mod];
      if (mod === "КТ" && !next.includes("КТ")) {
        setCan24h(false);
      }
      return next;
    });
  }

  function changeRate(next: number) {
    if (readOnly) return;
    setRate(next);
    const nextMax = Math.max(maxRate, next);
    setMaxRate(nextMax);
    setTargetRate((t) => Math.min(Math.max(t, next), nextMax));
  }

  function changeTargetRate(next: number) {
    if (readOnly) return;
    if (Number.isNaN(next)) return;
    const clamped = Math.min(Math.max(next, rate), maxRate);
    setTargetRate(clamped);
  }

  function changeMaxRate(next: number) {
    if (readOnly) return;
    if (Number.isNaN(next)) return;
    const clamped = Math.max(next, rate);
    setMaxRate(clamped);
    setTargetRate((t) => Math.min(t, clamped));
  }

  function toggleUnavailable(day: number) {
    if (readOnly) return;
    setUnavailable((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
        if (desired.has(day)) {
          setDesired((p) => {
            const n = new Set(p);
            n.delete(day);
            return n;
          });
        }
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
        if (unavailable.has(day)) {
          setUnavailable((p) => {
            const n = new Set(p);
            n.delete(day);
            return n;
          });
        }
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
      return `${maxRun} дней подряд (макс. ${maxConsec}). ${rate >= 1.0 ? "Более 3 дней подряд требует согласования с администратором." : ""}`;
    }
    return null;
  }

  const consecutiveWarning = getConsecutiveWarning();

  async function handleSave() {
    startTransition(async () => {
      const cy = new Date().getFullYear();
      const minY = cy - 60;
      const maxY = cy;

      function parseYearField(s: string): number | null | "bad" {
        const t = s.trim();
        if (!t) return null;
        const n = parseInt(t, 10);
        if (Number.isNaN(n) || n < minY || n > maxY) return "bad";
        return n;
      }

      const hospitalParsed = parseYearField(hospitalYearStr);
      const careerParsed = parseYearField(careerYearStr);
      if (hospitalParsed === "bad" || careerParsed === "bad") {
        toast.error(
          `Год введите числом от ${minY} до ${maxY} или оставьте поле пустым`,
        );
        return;
      }

      const profileRes = await fetch("/api/employees/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rate,
          targetRate,
          maxRate,
          modalities,
          can24h,
          hospitalStartYear: hospitalParsed,
          careerStartYear: careerParsed,
        }),
      });

      if (!profileRes.ok) {
        const data = await profileRes.json().catch(() => null);
        toast.error(data?.error ?? "Ошибка сохранения профиля");
        return;
      }

      if (!readOnly) {
        const filteredPostPrefs: Record<string, string> = {};
        const visibleIds = new Set(visiblePosts.map((p) => p.id));
        for (const [pid, v] of Object.entries(postPrefs)) {
          if (visibleIds.has(pid)) filteredPostPrefs[pid] = v;
        }

        const prefsRes = await fetch("/api/preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId,
            year,
            month,
            shiftTimeMode,
            pref24hFull: null,
            pref24hDay: null,
            pref24hNight: null,
            postPreferences: filteredPostPrefs,
            unavailableDays: Array.from(unavailable).sort((a, b) => a - b),
            weekdayPref: weekdayPref === "null" ? null : weekdayPref,
            weekendPref: weekendPref === "null" ? null : weekendPref,
            dayOfWeekPrefs: dowPrefs,
            desiredDates: Array.from(desired).sort((a, b) => a - b),
            comment: comment || null,
          }),
        });

        if (!prefsRes.ok) {
          const data = await prefsRes.json().catch(() => null);
          toast.error(data?.error ?? "Ошибка сохранения предпочтений");
          return;
        }
      }

      toast.success("Сохранено");
      router.refresh();
    });
  }

  const currentYear = new Date().getFullYear();
  const minYear = currentYear - 60;
  const maxYear = currentYear;

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
            Сбор предпочтений на этот месяц завершён — предпочтения не
            изменятся, но профиль можно обновить.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Мои данные</CardTitle>
          <CardDescription>
            Основная информация о вас, используется при расстановке смен.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="mb-2 block">Модальности</Label>
            <div className="flex flex-wrap gap-4">
              {MODALITIES.map((mod) => (
                <label
                  key={mod}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={modalities.includes(mod)}
                    disabled={readOnly}
                    onCheckedChange={() => toggleModality(mod)}
                  />
                  {mod}
                </label>
              ))}
              {modalities.includes("КТ") && has24hPostsInSystem && (
                <label className="flex items-center gap-2 text-sm ml-4 border-l pl-4 cursor-pointer">
                  <Checkbox
                    checked={can24h}
                    disabled={readOnly}
                    onCheckedChange={(c) => setCan24h(!!c)}
                  />
                  Могу работать суточные КТ
                </label>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Ставка</Label>
              <Select
                value={String(rate)}
                onValueChange={(v) => v && changeRate(parseFloat(v))}
                disabled={readOnly}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RATE_STEPS.map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Официальная ставка по договору.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Целевая ставка</Label>
              <Select
                value={String(targetRate)}
                onValueChange={(v) => v && changeTargetRate(parseFloat(v))}
                disabled={readOnly}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_RATE_STEPS.filter(
                    (r) => r >= rate && r <= maxRate,
                  ).map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Желаемая загрузка — график будет стремиться к ней.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Макс. ставка (потолок)</Label>
              <Input
                type="number"
                step={0.25}
                min={rate}
                max={2.0}
                value={maxRate}
                onChange={(e) => changeMaxRate(parseFloat(e.target.value))}
                disabled={readOnly}
              />
              <p className="text-[11px] text-muted-foreground">
                Абсолютный потолок допустимой переработки.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Год начала работы в больнице</Label>
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="напр. 2015"
                value={hospitalYearStr}
                onChange={(e) =>
                  setHospitalYearStr(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                disabled={readOnly}
              />
              <p className="text-[11px] text-muted-foreground">
                Допустимо: {minYear}–{maxYear}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Год начала работы в профессии</Label>
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="напр. 2010"
                value={careerYearStr}
                onChange={(e) =>
                  setCareerYearStr(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                disabled={readOnly}
              />
              <p className="text-[11px] text-muted-foreground">
                Допустимо: {minYear}–{maxYear}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {has24h && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Предпочтения по сменам</CardTitle>
            <CardDescription>
              Какие смены по длительности вы предпочитаете — сутки (24ч) или
              обычные 12-часовые дневные.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={shiftTimeMode}
              onValueChange={(v) => v && setShiftTimeMode(v as ShiftTimeMode)}
              disabled={readOnly}
            >
              <SelectTrigger className="w-full sm:w-80">
                <SelectValue>{shiftTimeModeLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SHIFT_TIME_MODE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-2 text-xs text-muted-foreground leading-relaxed">
              {shiftTimeMode === "only_full" && (
                <>
                  Вам будут ставить <strong>только полные сутки</strong>
                  &nbsp;— никаких 12-часовых дневных или ночных смен.
                </>
              )}
              {shiftTimeMode === "prefer_full" && (
                <>
                  Солвер будет стараться отдавать вам{" "}
                  <strong>полные суточные смены</strong>, но при необходимости
                  возможны 12-часовые.
                </>
              )}
              {shiftTimeMode === "neutral" && (
                <>Без особых предпочтений — как удобнее графику.</>
              )}
              {shiftTimeMode === "prefer_day" && (
                <>
                  Солвер будет стараться ставить вас на{" "}
                  <strong>12-часовые дневные смены</strong> — и на обычных, и на
                  суточных постах (избегая полных суток и ночных).
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {visiblePosts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Предпочтения по аппаратам
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {visiblePosts.map((post) => (
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
            {rate >= 1.0
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

      <Button
        onClick={handleSave}
        disabled={isPending}
        className="w-full sm:w-auto"
      >
        {isPending
          ? "Сохранение..."
          : readOnly
            ? "Сохранить профиль"
            : "Сохранить"}
      </Button>
    </div>
  );
}
